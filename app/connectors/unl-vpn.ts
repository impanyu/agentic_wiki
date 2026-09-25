import {mkdirSync,existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {lock,unlock} from '@/db/store';

// UNL VPN (GlobalProtect at nu-vpn.nebraska.edu) sessions for one wiki user.
// The portal signs in through the University of Nebraska single sign-on page
// (fed.nebraska.edu) with TrueYou credentials and Duo. A headless browser fills that
// page with the password the user typed into the connector form (never stored),
// waits for the user's Duo approval, and captures the portal's prelogin cookie.
// openconnect then runs in the user's own network namespace (scripts/vpn/aw-vpn),
// so the tunnel carries only that user's campus traffic, e.g. the ADAPT file share.
const PORTAL='https://nu-vpn.nebraska.edu';
const credentials=z.object({username:z.string().regex(/^[A-Za-z0-9._@+-]{1,120}$/)}).passthrough();
const chromiumPath=()=>[process.env.CHROMIUM_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&existsSync(p));
const dataDir=()=>process.env.DATA_DIR||join(process.cwd(),'data');

// Namespaces are numbered 1..250; the mapping connector id -> slot is kept on disk.
async function slotFor(connectorId:string){
 const file=join(dataDir(),'vpn-slots.json');mkdirSync(dataDir(),{recursive:true});
 const lease=await lock('vpn-slots',10000);if(!lease)throw Error('VPN is busy. Try again.');
 try{const slots:Record<string,number>=JSON.parse(await readFile(file,'utf8').catch(()=>'{}'));if(slots[connectorId])return slots[connectorId];const used=new Set(Object.values(slots));let n=1;while(used.has(n))n++;if(n>250)throw Error('No VPN session slots are free.');slots[connectorId]=n;await writeFile(file,JSON.stringify(slots),{mode:0o600});return n;}
 finally{await unlock(lease);}
}
// Requests go to the root broker (scripts/vpn/aw-vpn-daemon.cjs) over its group-only socket.
const SOCKET='/run/agenticwiki-vpn.sock';
export async function helper(args:string[],input?:string,timeout=60000){
 const net=await import('node:net');
 return await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve)=>{
  if(!existsSync(SOCKET)){resolve({code:-1,stdout:'',stderr:'The UNL VPN service is not installed on this server.'});return;}
  const conn=net.createConnection(SOCKET);let raw='';const timer=setTimeout(()=>{conn.destroy();resolve({code:-1,stdout:'',stderr:'The UNL VPN service did not respond in time.'});},timeout+5000);
  conn.on('connect',()=>conn.write(JSON.stringify({args,input,timeout})+'\n'));
  conn.on('data',c=>{raw+=c;});
  conn.on('end',()=>{clearTimeout(timer);try{resolve(JSON.parse(raw.trim()));}catch{resolve({code:-1,stdout:'',stderr:'Invalid response from the UNL VPN service.'});}});
  conn.on('error',e=>{clearTimeout(timer);resolve({code:-1,stdout:'',stderr:e.message});});
 });
}
export async function vpnSlot(connectorId:string){return slotFor(connectorId);}
export async function vpnIsUp(connectorId:string){const slot=await slotFor(connectorId);return (await helper(['status',String(slot)],undefined,15000)).stdout.trim()==='up';}
export async function vpnDisconnect(connectorId:string){const slot=await slotFor(connectorId);await helper(['down',String(slot)],undefined,30000);}

type Attempt={done:boolean;startedAt:number;stage:string;error?:string};
const attempts=new Map<string,Attempt>();
const report=(a:Attempt)=>a.done?(a.error?{connected:false,pending:false,error:a.error}:{connected:true,pending:false,message:'UNL VPN connected. Campus-only services such as the ADAPT share are now reachable for your connectors.'}):{connected:false,pending:true,message:a.stage};

async function samlLogin(username:string,password:string,duo:string,attempt:Attempt){
 const prelogin=await (await fetch(PORTAL+'/global-protect/prelogin.esp?tmp=tmp&clientVer=4100&clientos=Linux',{headers:{'User-Agent':'PAN GlobalProtect'},signal:AbortSignal.timeout(20000)})).text();
 const request=prelogin.match(/<saml-request>([^<]+)/)?.[1];if(!request)throw Error('The UNL VPN portal did not offer single sign-on.');
 const start=Buffer.from(request,'base64').toString();if(!/^https:\/\/fed\.nebraska\.edu\//.test(start))throw Error('Unexpected sign-in page for the UNL VPN.');
 const executablePath=chromiumPath();if(!executablePath)throw Error('The server cannot run the sign-in browser.');
 const {chromium}=await import('playwright-core');
 const browser=await chromium.launch({executablePath,headless:true,args:['--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'});
  let result:{cookie:string;user:string}|null=null;
  const trail:string[]=[];const note=(m:string)=>{trail.push(m);if(trail.length>30)trail.shift();};
  // The portal answers the SAML post with the prelogin cookie, in headers or in an HTML comment.
  page.on('response',async(r:any)=>{try{const h=await r.allHeaders();let cookie=h['prelogin-cookie'],user=h['saml-username'];if((!cookie||!user)&&/nu-vpn\.nebraska\.edu/.test(r.url())){const body=await r.text().catch(()=>'');cookie=cookie||body.match(/<prelogin-cookie>([^<]+)</)?.[1];user=user||body.match(/<saml-username>([^<]+)</)?.[1];}if(cookie&&user)result={cookie,user};}catch{}});
  page.on('framenavigated',(f:any)=>{if(f===page.mainFrame())note('nav '+String(f.url()).replace(/[?#].*$/,''));});
  attempt.stage='Opening the University of Nebraska sign-in page…';
  await page.goto(start,{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('input[name="j_username"]').fill(username,{timeout:15000});
  await page.locator('input[name="j_password"]').fill(password);
  attempt.stage='Signing in with your TrueYou credentials…';
  await Promise.all([page.waitForLoadState('domcontentloaded').catch(()=>{}),page.locator('button[name="_eventId_proceed"]').click()]);
  const deadline=Date.now()+150000;let chose=false,lastText='';
  const click=async(names:RegExp,css='')=>{const target=(css?page.locator(css):page.locator('__none__')).or(page.getByRole('button',{name:names})).or(page.getByRole('link',{name:names}));if(await target.count().catch(()=>0)){await target.first().click({timeout:5000}).catch(()=>{});return true;}return false;};
  while(Date.now()<deadline&&!result){
   await page.waitForTimeout(1500);
   const url=page.url(),text=(await page.locator('body').innerText({timeout:3000}).catch(()=>'')as string).replace(/\s+/g,' ').trim();
   if(text&&text!==lastText){lastText=text;note('page '+url.replace(/[?#].*$/,'')+' :: '+text.slice(0,160));}
   if(/fed\.nebraska\.edu/.test(url)&&/incorrect|invalid|could not be verified|unknown user|not recognized/i.test(text)&&await page.locator('input[name="j_password"]').count().catch(()=>0))throw Error('The University of Nebraska sign-in rejected the username or password.');
   if(/duosecurity\.com/.test(url)){
    attempt.stage=duo==='phone'?'Duo is calling your phone; answer and approve…':'Duo sent a push; approve it on your phone…';
    // "Is this your device?" comes after approval: never remember this server's browser.
    if(/is this your device|trust this browser/i.test(text)){await click(/no, other people use this device|don.?t trust/i,'#dont-trust-browser-button');continue;}
    // The prompt starts the user's default method automatically; switch only when a phone call was chosen.
    if(!chose&&duo==='phone'&&/push|duo mobile|other options/i.test(text)){
     if(await click(/other options/i)){await page.waitForTimeout(1500);}
     if(await click(/^\s*phone call\s*$|call me|phone call/i)){chose=true;note('chose phone call');}
    }
    if(!chose&&duo==='push')chose=true;
   }
  }
  if(!result){console.error('UNL VPN sign-in trail',trail.join(' | ').slice(-3000));throw Error(chose?'Duo approval did not complete the sign-in. Try again; if it keeps failing, the server log shows where it stopped.':'Sign-in did not reach Duo. Check the TrueYou username (NUID@nebraska.edu) and password.');}
  return result as {cookie:string;user:string};
 }finally{await browser.close().catch(()=>{});}
}

export function vpnLoginReport(connectorId:string){const a=attempts.get(connectorId);if(!a)return null;if(a.done)attempts.delete(connectorId);return report(a);}
export async function vpnSessionReport(secret:string,connectorId:string){credentials.parse(JSON.parse(secret));return vpnLoginReport(connectorId)||{connected:await vpnIsUp(connectorId),pending:false};}
export async function startVpnSession(secret:string,connectorId:string,password:string,duo='push'){
 const auth=credentials.parse(JSON.parse(secret));if(!password||password.length>500)throw Error('Enter your TrueYou password.');if(!/^(push|phone)$/.test(duo))throw Error('Choose Duo Push or phone call.');
 const running=attempts.get(connectorId);if(running&&!running.done)return report(running);
 const attempt:Attempt={done:false,startedAt:Date.now(),stage:'Starting…'};attempts.set(connectorId,attempt);
 const work=(async()=>{
  const {cookie,user}=await samlLogin(auth.username,password,duo,attempt);
  attempt.stage='Starting the VPN tunnel…';
  const slot=await slotFor(connectorId),r=await helper(['up',String(slot),user],cookie,90000);
  if(r.code!==0||!/connected/.test(r.stdout)){console.error('UNL VPN tunnel failed',{slot,code:r.code,stderr:r.stderr.slice(-800)});throw Error('Signed in, but the VPN tunnel did not start: '+(r.stderr.trim().split('\n').slice(-2).join(' ')||'unknown error').slice(0,300));}
  console.log('UNL VPN connected',{slot,user});
 })().then(()=>{attempt.done=true;},e=>{attempt.error=e instanceof Error?e.message:'VPN login failed.';attempt.done=true;console.error('UNL VPN login failed',attempt.error);});
 await Promise.race([work,new Promise(r=>setTimeout(r,15000))]);
 return vpnLoginReport(connectorId)||report(attempt);
}
