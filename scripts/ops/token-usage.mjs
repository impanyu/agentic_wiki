// Token usage per agent run over the last N days (default 60), by agent role: model calls,
// input / cached / output tokens (p50, p90). Usage: node scripts/ops/token-usage.mjs [db path] [days]
const {DatabaseSync}=await import('node:sqlite');
const db=new DatabaseSync(process.argv[2]||((process.env.DATA_DIR||'./data')+'/agenticwiki.sqlite'),{readOnly:true});
const rows=db.prepare("SELECT i.role role,e.run_id run,e.data data FROM agent_run_events e JOIN agent_instances i ON i.id=e.agent_id WHERE e.kind='model_finished' AND e.created_at>date('now',?)").all('-'+(Number(process.argv[3])||60)+' day');
const runs=new Map();
for(const r of rows){let d;try{d=JSON.parse(r.data)}catch{continue}const u=d.usage||{};const k=r.role.replace(/:.*/,'')+'|'+r.run;const x=runs.get(k)||{role:r.role.replace(/:.*/,''),calls:0,inp:0,cached:0,out:0,reason:0,models:{}};x.calls++;x.inp+=u.input_tokens||0;x.cached+=u.input_tokens_details?.cached_tokens||0;x.out+=u.output_tokens||0;x.reason+=u.output_tokens_details?.reasoning_tokens||0;x.models[d.model]=(x.models[d.model]||0)+1;runs.set(k,x);}
const by={};for(const x of runs.values()){(by[x.role]??=[]).push(x);}
const q=(a,p)=>{const s=[...a].sort((m,n)=>m-n);return s[Math.floor((s.length-1)*p)]||0};
for(const [role,a] of Object.entries(by)){if(a.length<3)continue;const f=k=>a.map(x=>x[k]);const models={};for(const x of a)for(const [m,n] of Object.entries(x.models))models[m]=(models[m]||0)+n;
console.log(role,'runs',a.length,'calls p50',q(f('calls'),.5),'in p50/p90',q(f('inp'),.5),q(f('inp'),.9),'cached p50',q(f('cached'),.5),'out p50/p90',q(f('out'),.5),q(f('out'),.9),'reasoning p50',q(f('reason'),.5),JSON.stringify(models));}
