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
// The portal hands out Prisma Access gateways that each require their own single sign-on, so
// the sign-in is done directly at the gateway nearest the server (us-central1) and the tunnel
// connects to that gateway; one Duo approval covers it.
// The official client picked US Central (nearest to the server in us-central1) and logged in there
// with the portal's auth cookie.
export const GATEWAY=process.env.UNL_VPN_GATEWAY||'us-central-g-universi.gpo2ojjg5cnn.gw.gpcloudservice.com';
// Identify as the official macOS client (GlobalProtect 6.3.3). The portal hands its reusable
// gateway auth cookie only to the desktop client configuration; Linux clients get none.
const GP_VERSION='6.3.3-1016',GP_OS='Apple Mac OS X 26.6.2',GP_UA=`PAN GlobalProtect/${GP_VERSION} (${GP_OS})`;
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

type Attempt={done:boolean;startedAt:number;finishedAt?:number;stage:string;error?:string};
const attempts=new Map<string,Attempt>();
const report=(a:Attempt)=>a.done?(a.error?{connected:false,pending:false,error:a.error}:{connected:true,pending:false,message:'UNL VPN connected. Campus-only services such as the ADAPT share are now reachable for your connectors.'}):{connected:false,pending:true,message:a.stage};

// GlobalProtect prelogin: the portal (or a gateway) returns the single sign-on request to open.
// Sent the way the official client does, so the SAML request is recorded against a real client.
async function preloginStart(host:string,path:string,hostId:string){
 // Field order and values as the macOS client sends them (strings in PanGPS); data = {"cas_embedded_browser":"yes"}.
 const body=`tmp=tmp&clientVer=4100&host-id=${hostId}&clientos=Mac&os-version=${encodeURIComponent(GP_OS)}&ipv6-support=yes&default-browser=0&cas-support=yes&data=eyJjYXNfZW1iZWRkZWRfYnJvd3NlciI6InllcyJ9`;
 const text=await (await fetch('https://'+host+path+'/prelogin.esp',{method:'POST',headers:{'User-Agent':GP_UA,'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(20000)})).text();
 const request=text.match(/<saml-request>([^<]+)/)?.[1];if(!request)throw Error(host+' did not offer single sign-on: '+(text.match(/<msg>([^<]+)/)?.[1]||text.slice(0,120)));
 const url=Buffer.from(request,'base64').toString();if(!/^https:\/\/fed\.nebraska\.edu\//.test(url))throw Error('Unexpected sign-in page for the UNL VPN.');
 return url;
}
// A stable GlobalProtect host id for this server and connection (never another device's).
async function hostIdFor(connectorId:string){
 const {createHash}=await import('node:crypto');
 const h=createHash('sha256').update('agenticwiki-vpn:'+connectorId).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`.toUpperCase();
}
const form=(fields:[string,string][])=>fields.map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
const tag=(xml:string,name:string)=>(xml.match(new RegExp('<'+name+'[^>]*>([^<]*)<'))?.[1]||'').trim();
// After the portal sign-in the official client asks the portal for its configuration, which
// carries the portal-userauthcookie; the gateway accepts that cookie directly (no second
// single sign-on). Returns an empty cookie when the portal withholds it.
// Portal configuration request, in the macOS client's field order (PanGPS). The same host id
// as the prelogin; the portal answers with the portal-userauthcookie for the gateway.
async function portalConfig(hostId:string,user:string,preloginCookie:string){
 const body=form([['user',user],['passwd',''],['inputStr',''],['ok','Login'],['clientVer','4100'],['portal-userauthcookie',''],['portal-prelogonuserauthcookie',''],['clientos','Mac'],['clientgpversion',GP_VERSION],['computer','agenticwiki'],['os-version',GP_OS],['host-id',hostId],['prelogin-cookie',preloginCookie],['ipv6-support','yes'],['serialno',''],['csc-digest',''],['config-digest',''],['csc-support','yes'],['token',''],['host',''],['swg-auth-token',''],['swg-nonce','0']]);
 const res=await fetch(PORTAL+'/global-protect/getconfig.esp',{method:'POST',headers:{'User-Agent':GP_UA,'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(30000)});
 const text=await res.text(),cookie=tag(text,'portal-userauthcookie'),prelogon=tag(text,'portal-prelogonuserauthcookie');
 const debugDir=join(dataDir(),'vpn-debug');mkdirSync(debugDir,{recursive:true,mode:0o700});
 await writeFile(join(debugDir,'getconfig.xml'),text.replace(/(<portal-(?:prelogon)?userauthcookie[^>]*>)[^<]*/g,'$1REDACTED'),{mode:0o600}).catch(()=>{});
 const ok=(v:string)=>v&&v!=='empty'?v:'';
 return {cookie:ok(cookie),prelogon:ok(prelogon),summary:`HTTP ${res.status}, ${text.length} bytes, portal-userauthcookie=${cookie?(cookie==='empty'?'empty':'set'):'absent'}`};
}
// Gateway login with the portal cookie, as the macOS client does; returns openconnect's gateway
// cookie (authcookie, portal, user, domain, computer) for --cookie-on-stdin.
async function gatewayLogin(hostId:string,user:string,portalCookie:string,prelogonCookie:string){
 const body=form([['prot','https:'],['server',GATEWAY],['inputStr',''],['jnlpReady','jnlpReady'],['user',user],['passwd',''],['computer','agenticwiki'],['ok','Login'],['direct','yes'],['clientVer','4100'],['os-version',GP_OS],['preferred-ip',''],['preferred-ipv6',''],['clientos','Mac'],['clientgpversion',GP_VERSION],['portal-userauthcookie',portalCookie],['portal-prelogonuserauthcookie',prelogonCookie],['host-id',hostId],['prelogin-cookie',''],['ipv6-support','yes'],['client-ip',''],['client-ipv6',''],['internal','no'],['serialno',''],['connect-method','on-demand'],['selection-type','auto'],['token',''],['host',''],['gw',''],['gateway-name','']]);
 const res=await fetch('https://'+GATEWAY+'/ssl-vpn/login.esp',{method:'POST',headers:{'User-Agent':GP_UA,'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(30000)});
 const text=await res.text(),args=[...text.matchAll(/<argument>([^<]*)<\/argument>/g)].map(m=>m[1].replace(/&amp;/g,'&').trim());
 if(res.status!==200||args.length<8||!args[1]){console.error('UNL VPN gateway login failed',res.status,text.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,400));throw Error('The VPN gateway did not accept the portal sign-in (HTTP '+res.status+(tag(text,'error')?': '+tag(text,'error'):'')+').');}
 return form([['authcookie',args[1]],['portal',args[3]],['user',args[4]],['domain',args[7]],['computer','agenticwiki']]);
}
// The University of Nebraska VPN is Prisma Access: the portal (nu-vpn.nebraska.edu) and each
// gateway require their own single sign-on, and the portal issues no reusable cookie. Like the
// official client, sign in at the portal (password + Duo), then immediately at the gateway in
// the same browser session, where the university sign-in page recognizes the session and needs
// nothing more from the user. The gateway's prelogin cookie starts the tunnel.
async function samlLogin(connectorId:string,username:string,password:string,duo:string,attempt:Attempt){
 const hostId=await hostIdFor(connectorId);
 const portalStart=await preloginStart(PORTAL.replace('https://',''),'/global-protect',hostId);
 const executablePath=chromiumPath();if(!executablePath)throw Error('The server cannot run the sign-in browser.');
 const {chromium}=await import('playwright-core');
 // One saved browser profile per connection and Duo method: Duo's prompt starts the method last
 // used in that browser, so after the first sign-in "phone call" only calls and "push" only pushes.
 const profile=join(dataDir(),'vpn-browser',connectorId.replace(/[^a-z0-9-]/gi,''),duo==='phone'?'phone':'push');mkdirSync(profile,{recursive:true,mode:0o700});
 const browser=await chromium.launchPersistentContext(profile,{executablePath,headless:true,args:['--disable-dev-shm-usage'],userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'});
 try{
  const page=browser.pages()[0]||await browser.newPage();
  // Always start from the sign-in page: forget the previous single sign-on session, keep Duo's method memory.
  await browser.clearCookies({domain:/nebraska\.edu$|gpcloudservice\.com$/}).catch(()=>{});
  const captured:{portal?:{cookie:string;user:string};gateway?:{cookie:string;user:string}}={};
  let acsFailure='';
  const trail:string[]=[];const note=(m:string)=>{trail.push(m);if(trail.length>40)trail.shift();};
  // The portal or gateway answers the SAML post with the prelogin cookie, in headers or in an HTML comment.
  page.on('response',async(r:any)=>{try{const url=String(r.url());const which=/nu-vpn\.nebraska\.edu/.test(url)?'portal':/gpcloudservice\.com/.test(url)?'gateway':null;if(!which)return;const h=await r.allHeaders();let cookie=h['prelogin-cookie'],user=h['saml-username'];const body=await r.text().catch(()=>'');cookie=cookie||body.match(/<prelogin-cookie>([^<]+)</)?.[1];user=user||body.match(/<saml-username>([^<]+)</)?.[1];if(cookie&&user)captured[which]={cookie,user};else if(/Authentication Failed|Error code/i.test(body)&&which==='gateway')acsFailure=body.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,600);}catch{}});
  page.on('framenavigated',(f:any)=>{if(f===page.mainFrame())note('nav '+String(f.url()).replace(/[?#].*$/,''));});
  const click=async(names:RegExp,css='')=>{const target=(css?page.locator(css):page.locator('__none__')).or(page.getByRole('button',{name:names})).or(page.getByRole('link',{name:names}));if(await target.count().catch(()=>0)){await target.first().click({timeout:5000}).catch(()=>{});return true;}return false;};
  let chose=false,lastText='';
  // Drives one single sign-on round trip until `done` reports the cookie or the deadline passes.
  const run=async(deadline:number,done:()=>boolean,label:string)=>{
   while(Date.now()<deadline&&!done()&&!acsFailure){
    await page.waitForTimeout(1500);
    const url=page.url(),text=(await page.locator('body').innerText({timeout:3000}).catch(()=>'')as string).replace(/\s+/g,' ').trim();
    if(text&&text!==lastText){lastText=text;note(label+' page '+url.replace(/[?#].*$/,'')+' :: '+text.slice(0,160));}
    if(/fed\.nebraska\.edu/.test(url)&&/incorrect|invalid|could not be verified|unknown user|not recognized/i.test(text)&&await page.locator('input[name="j_password"]').count().catch(()=>0))throw Error('The University of Nebraska sign-in rejected the username or password.');
    // After Duo, the university sign-in site may show an interstitial (for example a required-
    // training reminder) that waits for a click before returning to the VPN.
    if(/fed\.nebraska\.edu/.test(url)&&!await page.locator('input[name="j_password"]').count().catch(()=>0)&&(chose||label==='gateway')){
     const buttons=await page.locator('button,input[type=submit],a.button,a[role=button]').evaluateAll((els:Element[])=>els.map(e=>((e as HTMLElement).innerText||(e as HTMLInputElement).value||'').trim()).filter(Boolean).slice(0,8)).catch(()=>[] as string[]);
     if(buttons.length)note(label+' interstitial buttons: '+buttons.join(' / '));
     attempt.stage='Continuing past a university notice…';
     // Prefer postponing; never follow a link into the training itself.
     const pick=async(names:RegExp)=>{const t=page.getByRole('button',{name:names}).or(page.getByRole('link',{name:names})).or(page.locator('input[type=submit]').filter({hasText:names})).filter({hasNotText:/training|course|start now|take now/i});if(await t.count().catch(()=>0)){await t.first().click({timeout:5000}).catch(()=>{});return true;}return false;};
     if(await pick(/remind me later|not now|later|skip/i)||await click(/__never__/,'button[name="_eventId_proceed"]')||await pick(/^\s*(continue|proceed|ok|acknowledge|accept|next)\s*$/i))continue;
    }
    if(/duosecurity\.com/.test(url)){
     attempt.stage=duo==='phone'?'Duo is calling your phone; answer and approve…':'Duo sent a push; approve it on your phone…';
     // "Is this your device?" comes after approval: never remember this server's browser.
     if(/is this your device|trust this browser/i.test(text)){await click(/no, other people use this device|don.?t trust/i,'#dont-trust-browser-button');continue;}
     // Duo already started the chosen method (it remembers it per saved browser profile): just wait.
     if(!chose&&duo==='phone'&&/calling|we.?re calling|answer the (?:phone|call)/i.test(text)){chose=true;note('duo is calling');}
     if(!chose&&duo==='phone'&&/push|duo mobile|other options/i.test(text)){
      if(await click(/other options/i)){await page.waitForTimeout(1500);}
      // In the options list the call entry reads "Send to phone number ending in NNNN" (SMS entries say "Text message").
      const call=page.getByText(/phone number ending in/i).filter({hasNotText:/text message|sms/i});
      if(await call.count().catch(()=>0)){await call.first().click({timeout:5000}).catch(()=>{});chose=true;note('chose phone call');}
      else if(await click(/phone call|call me/i)){chose=true;note('chose phone call');}
     }
     if(!chose&&duo==='push')chose=true;
    }
   }
  };
  // Stage 1: the portal, with password and Duo.
  attempt.stage='Opening the University of Nebraska sign-in page…';
  await page.goto(portalStart,{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('input[name="j_username"]').fill(username,{timeout:15000});
  await page.locator('input[name="j_password"]').fill(password);
  attempt.stage='Signing in with your TrueYou credentials…';
  await Promise.all([page.waitForLoadState('domcontentloaded').catch(()=>{}),page.locator('button[name="_eventId_proceed"]').click()]);
  await run(Date.now()+150000,()=>!!captured.portal,'portal');
  if(!captured.portal){console.error('UNL VPN sign-in trail',trail.join(' | ').slice(-3000));const reachedDuo=trail.some(t=>/duosecurity\.com/.test(t));throw Error(!reachedDuo?'Sign-in did not reach Duo. Check the TrueYou username (NUID@nebraska.edu) and password.':!chose?'Duo did not offer the phone-call option. Choose Duo Push and try again.':'Duo approval did not complete the sign-in. Try again; if it keeps failing, the server log shows where it stopped.');}
  note('portal signed in');
  // Like the official client: exchange the portal sign-in for the portal auth cookie and log in
  // to the gateway with it. The gateway's own single sign-on is never used: at UNL its SAML
  // endpoint rejects every sign-in (ACS error -1), and the official client does not use it.
  attempt.stage='Getting the VPN configuration…';
  const portal=captured.portal,config=await portalConfig(hostId,portal.user,portal.cookie);
  if(config.cookie){
   note('portal auth cookie received');attempt.stage='Signing in at the VPN gateway…';
   return {user:portal.user,cookie:await gatewayLogin(hostId,portal.user,config.cookie,config.prelogon),kind:'gateway-cookie' as const};
  }
  console.error('UNL VPN portal issued no auth cookie',config.summary);
  throw Error('The UNL VPN portal signed you in but did not issue the gateway cookie ('+config.summary+'). The server kept the portal reply for diagnosis.');
 }finally{await browser.close().catch(()=>{});}
}

// A finished attempt's result stays readable for five minutes, so background status checks
// from the panel cannot swallow it before the waiting form reads it.
export function vpnLoginReport(connectorId:string){const a=attempts.get(connectorId);if(!a)return null;if(a.done&&Date.now()-(a.finishedAt||0)>300000){attempts.delete(connectorId);return null;}return report(a);}
export async function vpnSessionReport(secret:string,connectorId:string){credentials.parse(JSON.parse(secret));return vpnLoginReport(connectorId)||{connected:await vpnIsUp(connectorId),pending:false};}
export async function startVpnSession(secret:string,connectorId:string,password:string,duo='push'){
 const auth=credentials.parse(JSON.parse(secret));if(!password||password.length>500)throw Error('Enter your TrueYou password.');if(!/^(push|phone)$/.test(duo))throw Error('Choose Duo Push or phone call.');
 const running=attempts.get(connectorId);if(running&&!running.done)return report(running);
 const attempt:Attempt={done:false,startedAt:Date.now(),stage:'Starting…'};attempts.set(connectorId,attempt);
 const work=(async()=>{
  const signedIn=await samlLogin(connectorId,auth.username,password,duo,attempt);
  // Header values can carry stray whitespace or line breaks; the portal expects the plain name.
  const user=signedIn.user.replace(/[\x00-\x1f\x7f]/g,'').trim(),cookie=signedIn.cookie.replace(/[\x00-\x1f\x7f]/g,'').trim();
  console.log('UNL VPN portal username',JSON.stringify(user));
  attempt.stage='Starting the VPN tunnel…';
  const slot=await slotFor(connectorId),r=await helper(['up',String(slot),user,signedIn.kind],cookie,90000);
  if(r.code!==0||!/connected/.test(r.stdout)){console.error('UNL VPN tunnel failed',{slot,code:r.code,stderr:r.stderr.slice(-800)});throw Error('Signed in, but the VPN tunnel did not start: '+(r.stderr.trim().split('\n').slice(-2).join(' ')||'unknown error').slice(0,300));}
  console.log('UNL VPN connected',{slot,user,via:signedIn.kind});
 })().then(()=>{attempt.done=true;attempt.finishedAt=Date.now();},e=>{attempt.error=e instanceof Error?e.message:'VPN login failed.';attempt.done=true;attempt.finishedAt=Date.now();console.error('UNL VPN login failed',attempt.error);});
 await Promise.race([work,new Promise(r=>setTimeout(r,15000))]);
 return vpnLoginReport(connectorId)||report(attempt);
}
