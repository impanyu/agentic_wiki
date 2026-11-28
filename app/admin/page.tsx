import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {serverUi} from '@/app/i18n/request';
import {DbShell} from '@/app/rankings/view';
import {isAdmin,overview,traffic,costs,teams,config,listIssues,services,modelLayer} from '@/app/ops/admin';
import {entityDb} from '@/app/entity-db/client';
import {IssueActions} from './issue-actions';
// /admin: the operators' view of the site and its agents (administrators only: ADMIN_EMAILS). Overview, problems
// the agents could not solve, traffic and searches, model costs, teams and data collection, configuration.
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Admin · RankWiki',robots:{index:false,follow:false}};
type Props={searchParams:Promise<Record<string,string|string[]|undefined>>};
const TABS=[['overview','Overview'],['progress','Progress'],['sitemap','Site map'],['classes','Classes'],['fields','Fields and sources'],['sources','Sources'],['issues','Issues'],['traffic','Traffic'],['models','Models now'],['costs','Model costs'],['services','Services'],['teams','Teams and data'],['config','Configuration']] as const;
const fmt=(v:unknown)=>typeof v==='number'?v.toLocaleString('en'):String(v??'');
const usd=(v:unknown)=>'$'+(Number(v)||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2});

// A small bar chart (server-drawn SVG) of values by day.
function Bars({points,label}:{points:{day:string;v:number}[];label:string}){
 if(!points.length)return <p className="adm-empty">No data yet.</p>;
 // Thirty slots (one per day of the window), so a few days of data stay narrow bars on the left.
 const max=Math.max(...points.map(p=>p.v),1),slots=Math.max(30,points.length),w=24;
 return <figure className="adm-chart"><svg viewBox={`0 0 ${slots*w} 120`} role="img" aria-label={label} preserveAspectRatio="none">
  {points.map((p,i)=>{const h=Math.max(1,Math.round(p.v/max*110));return <rect key={p.day} x={i*w+1} y={120-h} width={w-2} height={h} rx={2}><title>{p.day}: {fmt(p.v)}</title></rect>;})}
 </svg><figcaption>{label} · {points[0].day} → {points[points.length-1].day} · max {fmt(max)}</figcaption></figure>;
}
function Table({rows,cols}:{rows:Record<string,unknown>[];cols:[string,string,((v:unknown,r:Record<string,unknown>)=>React.ReactNode)?][]}){
 if(!rows.length)return <p className="adm-empty">Nothing here yet.</p>;
 return <div className="adm-tablewrap"><table className="adm-table"><thead><tr>{cols.map(([k,l])=><th key={k}>{l}</th>)}</tr></thead>
  <tbody>{rows.map((r,i)=><tr key={i}>{cols.map(([k,,f])=><td key={k}>{f?f(r[k],r):fmt(r[k])}</td>)}</tr>)}</tbody></table></div>;
}
const Stat=({label,value,note,tone}:{label:string;value:string;note?:string;tone?:string})=><div className={'adm-stat'+(tone?' '+tone:'')}><span>{label}</span><b>{value}</b>{note&&<small>{note}</small>}</div>;

export default async function AdminPage({searchParams}:Props){
 const user=await getChatGPTUser();
 if(!isAdmin(user))notFound();
 const ui=await serverUi();
 const tab=String((await searchParams).tab||'overview');
 const account={name:user!.displayName};
 let body:React.ReactNode=null;
 if(tab==='overview'){
  const o=await overview();const open=(o.issues.blocker||0)+(o.issues.major||0)+(o.issues.minor||0);
  body=<>
   <div className="adm-stats">
    <Stat label="Open issues" value={fmt(open)} note={`${o.issues.blocker||0} blocker · ${o.issues.major||0} major · ${o.issues.minor||0} minor`} tone={o.issues.blocker?'bad':open?'warn':'ok'}/>
    <Stat label="Model spend this month" value={usd(o.spend?.spentUsd)} note={o.spend?`of ${usd(o.spend.budgetUsd)} budget`:''} tone={o.spend?.overBudget?'bad':undefined}/>
    <Stat label="Page views (7 days)" value={fmt(o.views7)}/>
    <Stat label="Searches (7 days)" value={fmt(o.searches7)} note={`${fmt(o.unanswered7)} found nothing`}/>
    <Stat label="Entity pages" value={fmt(o.pages)} note={`${fmt(o.entities)} entities`}/>
    <Stat label="Observations" value={fmt(o.observations)}/>
    <Stat label="Published rankings" value={fmt(o.rankings)}/>
    <Stat label="Topics" value={fmt(o.topics)}/>
    <Stat label="Collection rules" value={fmt(o.recipes)}/>
    <Stat label="Teams" value={`${fmt(o.running)} running`} note={`${fmt(o.queued)} queued`}/>
   </div>
   {open>0&&<p className="adm-note"><a href="/admin?tab=issues">{fmt(open)} open issues need attention →</a></p>}
  </>;
 }else if(tab==='progress'){
  // How complete the data is, class by class: rows, columns, sources, open problems (the Auditor's checks).
  const {classProgress}=await import('@/app/work/progress');const {rows,tot}=await classProgress(await entityDb());
  const pct=(a:number,b:number)=>b?Math.round(a/b*100)+'%':'–';
  body=<>
   <div className="adm-stats">
    <Stat label="Classes tracked" value={fmt(tot?.classes)} note={`${fmt(tot?.ranked)} with a published ranking`}/>
    <Stat label="Members (rows)" value={fmt(tot?.members)} note={tot?.expected?`expected ${fmt(tot.expected)} where known`:''}/>
    <Stat label="Classes with complete rows" value={fmt(tot?.complete_rows)} note="at least 90% of the expected members" tone={(tot?.complete_rows||0)<(tot?.classes||0)?'warn':'ok'}/>
    <Stat label="Measures collected (columns)" value={pct(tot?.covered||0,tot?.declared||0)} note={`${fmt(tot?.covered)} of ${fmt(tot?.declared)} declared, for most members`} tone="warn"/>
    <Stat label="Classes with 2+ sources" value={fmt(tot?.two_sources)} note="member lists and values" tone={(tot?.two_sources||0)<(tot?.classes||0)?'warn':'ok'}/>
   </div>
   <Table rows={rows as Record<string,unknown>[]} cols={[
    ['label','Class',(v,r)=>r.ranking?<a href={'/rankings/'+String(r.ranking)}>{String(v||r.type)}</a>:<a href={'/admin?tab=classes&type='+String(r.type)}>{String(v||r.type)}</a>],
    ['members','Members',(v,r)=>fmt(v)+(r.expected?' / '+fmt(r.expected):'')],
    ['covered','Columns filled',(v,r)=>`${fmt(v)} / ${fmt(r.declared)} (${pct(Number(v),Number(r.declared))})`],
    ['sources','Sources',(v,r)=>`${fmt(v)} values · ${fmt(r.member_lists)} member lists`],
    ['single_source_metrics','One-source measures'],
    ['open_problems','Open problems',(v,r)=>Number(v)?<span title={(r.problems as string[]).join('\n')}>{fmt(v)}</span>:'0'],
    ['updated_at','Checked',(v)=>(v instanceof Date?v.toISOString():String(v)).slice(0,16).replace('T',' ')],
   ]}/>
  </>;
 }else if(tab==='sitemap'){
  // The pages readers browse, as a tree (topics, rankings and their narrowing-down levels).
  const {siteTree}=await import('@/app/ops/structure');const t=await siteTree(await entityDb());
  const Node=({n}:{n:import('@/app/ops/structure').SiteNode})=>n.children.length
   ?<li><details><summary><a href={n.path}>{n.name}</a> <small className="adm-muted">{n.kind}{n.live?'':' · not live'} · {n.children.length} below</small></summary><ul className="adm-tree">{n.children.map(c=><Node key={c.path} n={c}/>)}</ul></details></li>
   :<li><a href={n.path}>{n.name}</a> <small className="adm-muted">{n.kind}{n.live?'':' · not live'}</small></li>;
  body=<><p className="adm-note">{fmt(t.nodes)} pages. Open a branch to see what is below it.</p><ul className="adm-tree">{t.roots.map(n=><Node key={n.path} n={n}/>)}</ul></>;
 }else if(tab==='classes'){
  const sp=await searchParams;const type=String(sp.type||'');const q=String(sp.q||'').trim().toLowerCase();
  const {classTree,classDetail}=await import('@/app/ops/structure');const db=await entityDb();
  if(type){
   const d=await classDetail(db,type);
   body=!d?<p className="adm-empty">No such class.</p>:<>
    <p className="adm-note"><a href="/admin?tab=classes">All classes</a> / {d.chain.map(c=><span key={c}><a href={'/admin?tab=classes&type='+c}>{c}</a> / </span>)}<b>{d.label}</b> <code>{d.type}</code>{d.national.length?' · national subclass '+d.national.join(','):''}</p>
    {d.description&&<p>{d.description}</p>}
    <div className="adm-stats">
     <Stat label="Members" value={fmt(d.members)} note={d.universe.expected?`expected ${fmt(d.universe.expected)}`:'expected count unknown'}/>
     <Stat label="Fields" value={fmt(d.fields.length)} note={`${fmt(d.fields.filter(f=>f.own).length)} own · ${fmt(d.fields.filter(f=>!f.own).length)} inherited`}/>
     <Stat label="Fields with data" value={fmt(d.fields.filter(f=>f.filled>0).length)} note={`${fmt(d.fields.filter(f=>f.filled>=d.members*0.5&&d.members>0).length)} for at least half the members`}/>
     <Stat label="Member lists" value={fmt(d.universe.lists.length)} tone={d.universe.lists.length<2?'warn':undefined}/>
    </div>
    {d.children.length>0&&<p className="adm-note">Subclasses: {d.children.map((c,i)=><span key={c.type}>{i?', ':''}<a href={'/admin?tab=classes&type='+c.type}>{c.label}</a></span>)}</p>}
    {d.rankings.length>0&&<p className="adm-note">Rankings: {d.rankings.map((r,i)=><span key={r.slug}>{i?', ':''}<a href={'/rankings/'+r.slug}>{r.title}</a>{r.status!=='published'?' ('+r.status+')':''}</span>)}</p>}
    <h2>Members: where the complete list comes from</h2>
    {d.universe.admission&&<p className="adm-note">Admission: {d.universe.admission}</p>}
    <Table rows={d.universe.lists} cols={[['name','List',(v,r)=>r.url?<a href={String(r.url)} rel="nofollow noopener" target="_blank">{String(v||r.url)}</a>:String(v||'')],['covers','Covers'],['access','Access']]}/>
    {d.universe.gaps&&<p className="adm-note">Gaps: {d.universe.gaps}</p>}
    <h2>Fields and their sources</h2>
    <Table rows={d.fields as unknown as Record<string,unknown>[]} cols={[
     ['label','Field',(v,r)=><span title={String(r.key)}>{String(v)}{r.deprecated?' (removed)':''}<br/><small className="adm-muted">{String(r.key)} · {String(r.kind)}{r.own?'':' · inherited'}{r.aspect?' · '+String(r.aspect):''}</small></span>],
     ['unit','Unit'],
     ['filled','Members with data',(v)=>d.members?`${fmt(v)} (${Math.round(Number(v)/d.members*100)}%)`:fmt(v)],
     ['planned','Planned sources',(v,r)=>(v as {name:string;url:string;field:string;access:string}[]).length?<ol className="adm-srcs">{(v as {name:string;url:string;field:string;access:string}[]).map((x,i)=><li key={i}>{x.url?<a href={x.url} rel="nofollow noopener" target="_blank">{x.name||x.url}</a>:x.name}{x.field?<small className="adm-muted"> · {x.field}</small>:null}{x.access?<small className="adm-muted"> · {x.access}</small>:null}</li>)}</ol>:<span className="adm-bad">{r.sourceNeeded?'source needed':'none'}</span>],
     ['loaded','Loaded from',(v,r)=>Number(r.loadedSources)?<span>{fmt(r.loadedSources)}: {(v as string[]).join('; ')}</span>:'—'],
    ]}/>
   </>;
  }else{
   const t=await classTree(db);
   const match=(n:import('@/app/ops/structure').ClassNode):boolean=>!q||n.type.includes(q)||n.label.toLowerCase().includes(q)||n.children.some(match);
   const Node=({n}:{n:import('@/app/ops/structure').ClassNode})=>{const kids=n.children.filter(match);const label=<><a href={'/admin?tab=classes&type='+n.type}>{n.label}</a> <small className="adm-muted">{n.type} · {fmt(n.members)} members{n.national?' · '+n.national:''}</small></>;
    return kids.length?<li><details open={!!q}><summary>{label} <small className="adm-muted">· {n.children.length} subclasses</small></summary><ul className="adm-tree">{kids.map(c=><Node key={c.type} n={c}/>)}</ul></details></li>:<li>{label}</li>;};
   body=<><form className="adm-search"><input type="hidden" name="tab" value="classes"/><input name="q" defaultValue={q} placeholder="Find a class"/><button>Search</button></form>
    <p className="adm-note">{fmt(t.classes)} classes. Open a branch, or a class for its fields, sources and member lists.</p>
    <ul className="adm-tree">{t.roots.filter(match).map(n=><Node key={n.type} n={n}/>)}</ul></>;
  }
 }else if(tab==='fields'){
  const sp=await searchParams;const q=String(sp.q||'');const problem=String(sp.problem||'');
  const {fieldSearch}=await import('@/app/ops/structure');const rows=await fieldSearch(await entityDb(),{q,problem});
  body=<><form className="adm-search"><input type="hidden" name="tab" value="fields"/><input name="q" defaultValue={q} placeholder="Field or class"/>
    <select name="problem" defaultValue={problem}><option value="">All fields</option><option value="one-source">Only one planned source</option><option value="no-source">No source yet</option></select><button>Show</button></form>
   <p className="adm-note">{fmt(rows.length)}{rows.length>=500?'+':''} fields (own fields of each class; open a class for inherited ones and what is loaded).</p>
   <Table rows={rows as unknown as Record<string,unknown>[]} cols={[['label','Class',(v,r)=><a href={'/admin?tab=classes&type='+String(r.type)}>{String(v||r.type)}</a>],['key','Field'],['kind','Kind'],['sources','Planned sources',(v,r)=>r.need?<span className="adm-bad">needed</span>:fmt(v)]]}/></>;
 }else if(tab==='sources'){
  // The Sources layer: every source host, how it is reached, whether it is open over the last 7 days, the classes it
  // feeds, and the backups when it is stuck.
  const sp=await searchParams;const status=String(sp.status||'');const q=String(sp.q||'');
  const {listSources}=await import('@/app/sources/registry');const {rows,totals}=await listSources(await entityDb(),{status,q});
  const t=(k:string)=>totals[k]||0;const stuckN=t('blocked')+t('down')+t('failing')+t('limited');
  body=<>
   <div className="adm-stats">
    <Stat label="Sources" value={fmt(Object.values(totals).reduce((a,b)=>a+b,0))}/>
    <Stat label="Open" value={fmt(t('ok'))} note={`${fmt(t('degraded'))} degraded · ${fmt(t('idle'))} not used this week`} tone="ok"/>
    <Stat label="Stuck" value={fmt(stuckN)} note={`${t('blocked')} blocked · ${t('down')} down · ${t('failing')} failing · ${t('limited')} rate limited`} tone={stuckN?'warn':'ok'}/>
   </div>
   <p className="adm-note">Rebuilt hourly from collection rules, the fields' planned sources and every collector request of the last 7 days. A stuck source sends its classes' collectors to the backups (source review); one with no backup anywhere also opens an issue.</p>
   <form className="adm-search"><input type="hidden" name="tab" value="sources"/><input name="q" defaultValue={q} placeholder="Host, name or class"/>
    <select name="status" defaultValue={status}><option value="">All</option><option value="stuck">Stuck</option>{['ok','degraded','limited','blocked','down','failing','idle'].map(x=><option key={x} value={x}>{x}</option>)}</select><button>Filter</button></form>
   <Table rows={rows as Record<string,unknown>[]} cols={[
    ['host','Source',(v,r)=><span title={String(r.name||'')}>{String(v)}{r.name?<small className="adm-muted"> {String(r.name).slice(0,40)}</small>:null}</span>],
    ['status','Status',(v)=><span className={v==='ok'?'':v==='degraded'||v==='idle'?'adm-muted':'adm-bad'}>{String(v)}</span>],
    ['access','Access'],
    ['classes','Feeds',(v)=>{const l=v as string[];return l.length?<span title={l.join(', ')}>{l.length} class{l.length>1?'es':''}: {l.slice(0,3).join(', ')}{l.length>3?' …':''}</span>:'–';}],
    ['recipes','Rules',(v,r)=>fmt(v)+(Number(r.failing_recipes)?' ('+fmt(r.failing_recipes)+' failing)':'')],
    ['calls7','7 days',(v,r)=>Number(v)?`${fmt(r.ok7)}/${fmt(v)} ok`+(Number(r.denied7)?` · ${fmt(r.denied7)} denied`:'')+(Number(r.limited7)?` · ${fmt(r.limited7)} limited`:'')+(Number(r.failed7)?` · ${fmt(r.failed7)} failed`:''):'–'],
    ['backups','Backups',(v)=>{const l=(v as {class:string;hosts:string[]}[])||[];if(!l.length)return '';const none=l.filter(b=>!b.hosts.length).length;return <span title={l.map(b=>b.class+': '+(b.hosts.join(', ')||'none')).join('\n')}>{none?<span className="adm-bad">{none} class{none>1?'es':''} without</span>:'all classes covered'}</span>;}],
    ['last_error','Last error',(v,r)=><span title={String(r.needs||'')}>{String(v||'').slice(0,80)}</span>],
   ]}/>
  </>;
 }else if(tab==='issues'){
  const status=String((await searchParams).status||'open') as 'open'|'resolved'|'ignored'|'all';
  const list=await listIssues(await entityDb(),{status});
  body=<>
   <nav className="adm-subtabs">{(['open','resolved','ignored','all'] as const).map(s=><a key={s} href={'/admin?tab=issues&status='+s} aria-current={s===status?'page':undefined}>{s}</a>)}</nav>
   {!list.length?<p className="adm-empty">No {status==='all'?'':status+' '}issues.</p>:<ul className="adm-issues">{list.map(i=><li key={i.id} id={'issue-'+i.id} className={i.severity}>
    <header><span className={'adm-sev '+i.severity}>{i.severity}</span><b>{i.title}</b></header>
    <p className="adm-meta">{i.source}{i.topic&&' · '+i.topic} · seen {i.occurrences}× · first {i.createdAt.slice(0,16).replace('T',' ')} · last {i.lastSeenAt.slice(0,16).replace('T',' ')}{i.status!=='open'&&` · ${i.status} by ${i.resolvedBy||'—'}`}</p>
    {i.detail&&<pre>{i.detail}</pre>}
    {i.resolution&&<p className="adm-resolution"><b>Resolution:</b> {i.resolution}</p>}
    <IssueActions id={i.id} status={i.status}/>
   </li>)}</ul>}
  </>;
 }else if(tab==='traffic'){
  const t=await traffic(30);
  const byDay=new Map<string,number>();for(const r of t.daily)byDay.set(r.day,(byDay.get(r.day)||0)+r.n);
  body=<>
   <h2>Page views by day (30 days)</h2><Bars points={[...byDay].map(([day,v])=>({day,v}))} label="Page views"/>
   <h2>Searches by day</h2><Bars points={t.searches.map(r=>({day:r.day,v:r.n}))} label="Searches"/>
   <h2>Most viewed pages</h2><Table rows={t.top} cols={[['kind','Kind'],['key','Page',(v)=><a href={String(v)}>{String(v)}</a>],['n','Views']]}/>
   <h2>Searches that found nothing</h2><Table rows={t.unanswered} cols={[['query','Query'],['n','Times'],['handled','Seen by the manager',(v)=>v?'yes':'not yet']]}/>
  </>;
 }else if(tab==='models'){
  const m=await modelLayer();const st=m.state as {at?:string;models?:Record<string,unknown>[];classes?:Record<string,unknown>[];waiting?:number;error?:string};
  const used=(st.models||[]).reduce((n,x)=>n+Number(x.active||0),0),slots=(st.models||[]).reduce((n,x)=>n+Number(x.slots||0),0);
  body=<>
   <p className="adm-note">Live view of the model scheduler{st.at?` at ${st.at.slice(11,19)} UTC`:''}. Every model request of the site goes through it: each task class tries its models in order and waits in its queue when all are full.{st.error?` Scheduler unreachable: ${st.error}`:''}</p>
   <div className="adm-stats"><Stat label="Requests running" value={fmt(used)} note={slots?`of ${fmt(slots)} limited slots`:''}/><Stat label="Requests waiting" value={fmt(st.waiting||0)} tone={(st.waiting||0)>0?'warn':undefined}/><Stat label="GPU workers online" value={fmt(m.workers.filter(w=>Number(w.seen)<90).length)} note={`${fmt(m.workers.filter(w=>Number(w.seen)<90).reduce((n,w)=>n+Number(w.busy||0),0))} of ${fmt(m.workers.filter(w=>Number(w.seen)<90).reduce((n,w)=>n+Number(w.slots||0),0))} GPU slots busy`}/></div>
   <h2>Models</h2><Table rows={st.models||[]} cols={[['id','Model'],['slots','Slots',(v)=>v==null?'no limit':fmt(v)],['active','Running'],['today','Calls today (this process)'],['cooldownReason','Paused',(v,r)=>v?`${String(v)} until ${String(r.cooldownUntil||'').slice(11,16)}`:'']]}/>
   <h2>Queues by task class</h2><Table rows={st.classes||[]} cols={[['cls','Class'],['priority','Priority'],['chain','Models in order',(v)=>(v as string[]).join(' → ')],['waiting','Waiting'],['oldestWaitS','Oldest wait (s)']]}/>
   <h2>Our GPU workers</h2><Table rows={m.workers} cols={[['id','Worker'],['model','Serves'],['slots','Slots'],['busy','Busy'],['done','Done'],['failed','Failed'],['seen','Last seen (s ago)']]}/>
   <h2>GPU job table</h2><Table rows={m.queue} cols={[['model','Pool'],['queued','Queued'],['claimed','Being answered']]}/>
   <h2>Last hour by model</h2><Table rows={m.hour} cols={[['model','Model'],['calls','Calls'],['failed','Failed'],['avg_s','Avg time (s)'],['out_tokens','Output tokens'],['cost','Cost',(v)=>usd(v)]]}/>
  </>;
 }else if(tab==='costs'){
  const c=await costs(30);
  body=<>
   <div className="adm-stats"><Stat label="This month (paid models)" value={usd(c.spend?.spentUsd)} note={c.spend?`budget ${usd(c.spend.budgetUsd)} · resets ${String(c.spend.resetsAt||'').slice(0,10)}`:''} tone={c.spend?.overBudget?'bad':undefined}/>
    <Stat label="Month projected" value={c.projected==null?'—':usd(c.projected)} note="at this month's average daily spend" tone={c.spend&&c.projected!=null&&c.projected>Number(c.spend.budgetUsd)?'warn':undefined}/>
    {c.today.map(t=><Stat key={t.provider} label={`Today · ${t.provider}`} value={usd(t.spent)} note={`cap ${usd(t.cap)} · ${t.reached?'reached: free models only until 00:00 UTC':usd(t.left)+' left'} · ${fmt(t.calls)} calls`} tone={t.reached?'warn':undefined}/>)}</div>
   <h2>Spend by day</h2><Table rows={c.byDay} cols={[['day','Day (UTC)'],['openai','OpenAI',(v)=>usd(v)],['deepseek','DeepSeek',(v)=>usd(v)],['paid','Total paid',(v)=>usd(v)],['paid_calls','Paid calls'],['free_calls','Free calls (our GPUs, free tiers)'],['failed','Failed calls']]}/>
   <h2>Cost by day (30 days)</h2><Bars points={c.daily.map(r=>({day:r.day,v:Number(r.cost)}))} label="USD per day"/>
   <h2>By model and task class (30 days)</h2><Table rows={c.byModel} cols={[['provider','Provider'],['model','Model'],['class','Class'],['calls','Calls'],['failed','Failed'],['input','Input tokens'],['output','Output tokens'],['cost','Cost',(v)=>usd(v)]]}/>
  </>;
 }else if(tab==='services'){
  const v=await services();
  body=<>
   <p className="adm-note">Every model, search provider and data API the agents use: whether it is configured, its plan and cap, and this month's use. Secrets are never shown.</p>
   <h2>Services</h2><Table rows={v.rows} cols={[['kind','Kind'],['name','Service'],['configured','Key'],['plan','Plan'],['cap','Daily cap'],['today','Today'],['month','This month'],['errors','Errors'],['cost','Cost',(x)=>x==null?'':usd(x)]]}/>
   <h2>Access the agents asked for</h2>{v.access.length?<Table rows={v.access} cols={[['title','Request'],['topic','First topic'],['occurrences','Requests'],['last','Last asked']]}/>:<p className="adm-note">No open requests.</p>}
  </>;
 }else if(tab==='teams'){
  const t=await teams();
  const m=t.manager?.value as Record<string,unknown>|undefined;
  body=<>
   <h2>Manager</h2><p className="adm-note">{m?`Last daily review ${t.manager!.at}: ${String(m.status||'')}${m.summary?' — '+String(m.summary):''}`:'The manager has not run its daily review yet.'}</p>
   <h2>Team queue</h2><Table rows={t.queue} cols={[['slug','Topic'],['name','Name'],['status','Status'],['note','Note'],['created','Queued'],['started','Started'],['finished','Finished']]}/>
   <h2>Recent agent runs</h2><Table rows={t.runs} cols={[['topic','Topic'],['role','Role'],['status','Status'],['cost','Cost',(v)=>usd(v)],['started','Started'],['seconds','Seconds']]}/>
   <h2>Collection rules</h2><Table rows={t.recipes} cols={[['type','Type'],['name','Rule'],['status','Last result'],['last_run','Last run'],['error','Error']]}/>
  </>;
 }else if(tab==='config'){
  const c=config();
  body=<>{Object.entries(c).map(([group,vals])=><section key={group}><h2>{group[0].toUpperCase()+group.slice(1)}</h2>
   <Table rows={Object.entries(vals).map(([k,v])=>({k,v}))} cols={[['k','Setting'],['v','Value',(v)=><code>{String(v)}</code>]]}/></section>)}
   <p className="adm-note">Settings live in the server's environment (.env.local); secrets are never shown here, only whether they are set.</p></>;
 }
 return <DbShell locale={ui.locale} dictionary={ui.dict} askTargets={{}} className="answer template-admin-v1" account={account}>
  <header className="wiki-heading db-hero"><span className="db-kicker">Admin</span><h1>System</h1></header>
  <nav className="adm-tabs">{TABS.map(([k,l])=><a key={k} href={'/admin?tab='+k} aria-current={k===tab?'page':undefined}>{l}</a>)}</nav>
  {body}
 </DbShell>;
}
