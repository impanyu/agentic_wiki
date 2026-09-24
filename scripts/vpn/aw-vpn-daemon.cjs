// Root-side broker for UNL VPN sessions. The web service runs with NoNewPrivileges, so
// it cannot sudo; instead it sends one JSON request per connection over a unix socket
// that only the service user's group can open. The broker runs the fixed helper
// (aw-vpn), which validates every argument, and returns its exit code and output.
const net=require('node:net'),fs=require('node:fs'),{spawn}=require('node:child_process');
const SOCKET='/run/agenticwiki-vpn.sock',HELPER='/usr/local/lib/agenticwiki/aw-vpn',OWNER=process.env.AW_OWNER||'impanyu';
const COMMANDS=new Set(['up','down','status','resolve','smb']);
try{fs.unlinkSync(SOCKET);}catch{}
const server=net.createServer(conn=>{
 let raw='';conn.setTimeout(150000,()=>conn.destroy());
 conn.on('data',chunk=>{raw+=chunk;if(raw.length>100000){conn.destroy();return;}const end=raw.indexOf('\n');if(end<0)return;conn.removeAllListeners('data');
  let req;try{req=JSON.parse(raw.slice(0,end));}catch{conn.end(JSON.stringify({code:64,stdout:'',stderr:'bad request'})+'\n');return;}
  const args=Array.isArray(req.args)?req.args.map(String):[];
  if(!COMMANDS.has(args[0])){conn.end(JSON.stringify({code:64,stdout:'',stderr:'unknown command'})+'\n');return;}
  const child=spawn(HELPER,args,{stdio:[typeof req.input==='string'?'pipe':'ignore','pipe','pipe'],env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',SUDO_USER:OWNER}});
  let out='',err='';child.stdout.on('data',c=>{out=(out+c).slice(-50000);});child.stderr.on('data',c=>{err=(err+c).slice(-20000);});
  if(typeof req.input==='string'){child.stdin.on('error',()=>{});child.stdin.end(req.input);}
  const timer=setTimeout(()=>child.kill('SIGKILL'),Math.min(Number(req.timeout)||60000,140000));
  child.on('close',code=>{clearTimeout(timer);conn.end(JSON.stringify({code,stdout:out,stderr:err})+'\n');});
 });
 conn.on('error',()=>{});
});
server.listen(SOCKET,()=>{const gid=Number(require('node:child_process').execSync('id -g '+OWNER).toString().trim());fs.chownSync(SOCKET,0,gid);fs.chmodSync(SOCKET,0o660);console.log('aw-vpn broker listening');});
