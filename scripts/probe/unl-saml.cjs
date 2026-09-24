// Temporary probe: load the UNL VPN single sign-on page headlessly and describe its form. Signs nothing in.
const {chromium}=require(process.env.HOME+'/agenticwiki/node_modules/playwright-core');
(async()=>{
 const x=await (await fetch('https://nu-vpn.nebraska.edu/global-protect/prelogin.esp?tmp=tmp&clientVer=4100&clientos=Linux',{headers:{'User-Agent':'PAN GlobalProtect'}})).text();
 const url=Buffer.from(x.match(/<saml-request>([^<]+)/)[1],'base64').toString();
 console.log('SAML start',new URL(url).host+new URL(url).pathname);
 const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
 const p=await b.newPage();
 await p.goto(url,{waitUntil:'networkidle',timeout:40000});
 console.log('URL',p.url().replace(/\?.*/,''));console.log('TITLE',await p.title());
 console.log('FIELDS',JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('input,button,a.button')].filter(e=>e.type!=='hidden').map(e=>[e.tagName,e.name||e.id||'',e.type||'',(e.value||e.innerText||'').trim().slice(0,40)]))));
 console.log('TEXT',(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ').slice(0,500));
 await b.close();
})().catch(e=>console.log('ERR',e.message));
