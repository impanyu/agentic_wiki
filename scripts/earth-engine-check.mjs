// Checks the platform Earth Engine credentials end to end: token, algorithm list, a computation
// and a thumbnail. Usage on the server: node scripts/earth-engine-check.mjs
import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {createSign} from 'node:crypto';
const file=process.env.EARTH_ENGINE_SERVICE_ACCOUNT_KEY_FILE||resolve(process.env.DATA_DIR||resolve(process.env.HOME,'agenticwiki/data'),'secrets/earthengine-service-account.json');
const key=JSON.parse(readFileSync(file,'utf8')),project=process.env.EARTH_ENGINE_PROJECT||key.project_id;
console.log('service account',key.client_email,'project',project);
const b=v=>Buffer.from(v).toString('base64url'),now=Math.floor(Date.now()/1000),h=b(JSON.stringify({alg:'RS256',typ:'JWT'})),c=b(JSON.stringify({iss:key.client_email,scope:'https://www.googleapis.com/auth/earthengine',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
const t=await (await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:h+'.'+c+'.'+createSign('RSA-SHA256').update(h+'.'+c).sign(key.private_key).toString('base64url')})})).json();
if(!t.access_token){console.log('TOKEN FAILED',t);process.exit(1);}console.log('token ok');
const api=(path,body)=>fetch('https://earthengine.googleapis.com/v1/projects/'+project+'/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+t.access_token,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
let r=await api('algorithms?prettyPrint=false');const alg=await r.json();console.log('algorithms',r.status,alg.algorithms?.length??JSON.stringify(alg).slice(0,300));
const dem={functionInvocationValue:{functionName:'Image.load',arguments:{id:{constantValue:'USGS/SRTMGL1_003'}}}};
r=await api('value:compute',{expression:{result:'0',values:{'0':{functionInvocationValue:{functionName:'Image.bandNames',arguments:{image:dem}}}}}});console.log('value:compute',r.status,(await r.text()).slice(0,300));
r=await api('thumbnails?fields=name',{expression:{result:'0',values:{'0':dem}},fileFormat:'PNG',visualizationOptions:{ranges:[{min:0,max:3000}]},grid:{dimensions:{width:64,height:64},affineTransform:{scaleX:0.1,translateX:-100,scaleY:-0.1,translateY:45},crsCode:'EPSG:4326'}});
const thumb=await r.json();console.log('thumbnails',r.status,JSON.stringify(thumb).slice(0,300));
if(thumb.name){const p=await fetch('https://earthengine.googleapis.com/v1/'+thumb.name+':getPixels',{headers:{Authorization:'Bearer '+t.access_token}});console.log('getPixels',p.status,p.headers.get('content-type'),(await p.arrayBuffer()).byteLength,'bytes');}
