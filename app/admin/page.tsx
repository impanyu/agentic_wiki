import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {serverUi} from '@/app/i18n/request';
import {DbShell} from '@/app/rankings/view';
import {isAdmin,overview,traffic,costs,teams,config,listIssues,services} from '@/app/ops/admin';
import {entityDb} from '@/app/entity-db/client';
import {IssueActions} from './issue-actions';
// /admin: the operators' view of the site and its agents (administrators only: ADMIN_EMAILS). Overview, problems
// the agents could not solve, traffic and searches, model costs, teams and data collection, configuration.
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Admin · RankWiki',robots:{index:false,follow:false}};
type Props={searchParams:Promise<Record<string,string|string[]|undefined>>};
const TABS=[['overview','Overview'],['issues','Issues'],['traffic','Traffic'],['costs','Model costs'],['services','Services'],['teams','Teams and data'],['config','Configuration']] as const;
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
