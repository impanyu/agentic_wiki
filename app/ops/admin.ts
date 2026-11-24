import {database} from '@/db/store';
import {entityDb} from '@/app/entity-db/client';
import {llmSpend} from '@/app/llm';
import {issueCounts,listIssues} from './issues';
import type {User} from '@/server/auth';
// What the operators see on /admin: the state of the site and its agents, read from the entity database (pages,
// teams, queue, searches, views, issues) and the app database (model calls and their cost). Read-only except
// resolving issues. Administrators are the signed-in users whose email is listed in ADMIN_EMAILS.
export function isAdmin(user:User|null):boolean{
 if(!user?.email)return false;
 const list=String(process.env.ADMIN_EMAILS||'').toLowerCase().split(/[,\s]+/).filter(Boolean);
 return list.includes(user.email.toLowerCase());
}
const n=(v:unknown)=>Number(v)||0;

export async function overview(){
 const db=await entityDb();
 const one=async(sql:string)=>n((await db.query<{n:number}>(sql)).rows[0]?.n);
 const [entities,pages,observations,rankings,topics,recipes,queued,running,views7,searches7,unanswered7]=await Promise.all([
  one('select count(*)::bigint n from entities'),one('select count(*)::bigint n from entities where has_page'),one('select count(*)::bigint n from observations'),
  one("select count(*)::int n from rankings where status='published'"),one("select count(*)::int n from topics where status<>'archived'"),one('select count(*)::int n from recipes'),
  one("select count(*)::int n from team_queue where status='queued'"),one("select count(*)::int n from team_queue where status='running'"),
  one("select coalesce(sum(n),0)::bigint n from page_views where day > current_date - 7"),one("select count(*)::int n from search_log where at > now() - interval '7 days'"),
  one("select count(*)::int n from search_log where at > now() - interval '7 days' and results = 0")]);
 const spend=await llmSpend().catch(()=>null);
 return {entities,pages,observations,rankings,topics,recipes,queued,running,views7,searches7,unanswered7,issues:await issueCounts(db),spend};
}

export async function traffic(days=30){
 const db=await entityDb();
 const daily=(await db.query<{day:string;kind:string;n:number}>(`select to_char(day,'YYYY-MM-DD') as day, kind, sum(n)::int n from page_views where day > current_date - $1::int group by day, kind order by day`,[days])).rows;
 const top=(await db.query<{kind:string;key:string;n:number}>(`select kind, key, sum(n)::int n from page_views where day > current_date - $1::int and kind <> 'search' group by kind, key order by n desc limit 25`,[days])).rows;
 const searches=(await db.query<{day:string;n:number;zero:number}>(`select to_char(at::date,'YYYY-MM-DD') as day, count(*)::int n, count(*) filter (where results=0)::int zero from search_log where at > now() - ($1::int || ' days')::interval group by 1 order by 1`,[days])).rows;
 const unanswered=(await db.query<{query:string;n:number;handled:boolean}>(`select max(query) query, count(*)::int n, bool_and(handled) handled from search_log where results=0 and at > now() - ($1::int || ' days')::interval group by norm order by n desc limit 30`,[days])).rows;
 return {daily,top,searches,unanswered};
}

export async function costs(days=30){
 const since=new Date(Date.now()-days*86400_000).toISOString();
 const q=async<T,>(sql:string,...args:unknown[])=>((await database().prepare(sql).bind(...args).all<T>()).results||[]) as T[];
 const daily=await q<{day:string;cost:number;calls:number}>("SELECT substr(created_at,1,10) day, ROUND(SUM(cost_usd),4) cost, COUNT(*) calls FROM llm_usage WHERE created_at>=? GROUP BY day ORDER BY day",since);
 const byModel=await q<{provider:string;model:string;class:string;calls:number;failed:number;input:number;output:number;cost:number}>(
  "SELECT provider, model, class, COUNT(*) calls, SUM(CASE WHEN status<>'ok' THEN 1 ELSE 0 END) failed, SUM(input_tokens) input, SUM(output_tokens) output, ROUND(SUM(cost_usd),4) cost FROM llm_usage WHERE created_at>=? GROUP BY provider, model, class ORDER BY cost DESC, calls DESC LIMIT 40",since);
 const spend=await llmSpend().catch(()=>null);
 // Paid providers: today's spend against each daily cap, and every day's spend by provider (one row per day).
 const {DAILY_CAPPED}=await import('@/app/llm/core');
 const day=new Date().toISOString().slice(0,10);
 const today=await Promise.all(Object.keys(DAILY_CAPPED).map(async provider=>{
  const cap=Number(process.env[provider.toUpperCase()+'_DAILY_USD']??DAILY_CAPPED[provider]);
  const r=(await q<{spent:number;calls:number}>("SELECT COALESCE(SUM(cost_usd),0) spent, COUNT(*) calls FROM llm_usage WHERE created_at>=? AND provider=?",day,provider))[0];
  return {provider,spent:Number(r?.spent||0),cap,left:Math.max(0,cap-Number(r?.spent||0)),calls:Number(r?.calls||0),reached:Number(r?.spent||0)>=cap};
 }));
 const byDay=await q<{day:string;openai:number;deepseek:number;paid:number;paid_calls:number;free_calls:number;failed:number}>(`SELECT substr(created_at,1,10) day,
   ROUND(SUM(CASE WHEN provider='openai' THEN cost_usd ELSE 0 END),2) openai, ROUND(SUM(CASE WHEN provider='deepseek' THEN cost_usd ELSE 0 END),2) deepseek,
   ROUND(SUM(cost_usd),2) paid, SUM(CASE WHEN provider IN ('openai','deepseek') AND status='ok' THEN 1 ELSE 0 END) paid_calls,
   SUM(CASE WHEN provider NOT IN ('openai','deepseek') AND status='ok' THEN 1 ELSE 0 END) free_calls, SUM(CASE WHEN status<>'ok' THEN 1 ELSE 0 END) failed
   FROM llm_usage WHERE created_at>=? GROUP BY day ORDER BY day DESC`,since);
 const now=new Date(),dim=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)).getUTCDate();
 const projected=spend?Math.round(Number(spend.spentUsd||0)/now.getUTCDate()*dim*100)/100:null;
 return {daily,byModel,spend,today,byDay,projected};
}

// Every external service the platform and its agents use, in one place: models (calls, failures, cost) per provider,
// search providers and public data APIs (calls and errors per day), with whether each is configured and its cap.
const SERVICES:{id:string;name:string;kind:'model'|'search'|'data';keyEnv?:string;plan:string;cap?:string}[]=[
 {id:'openai',name:'OpenAI (gpt-5.6-terra, gpt-5.6-luna, embeddings)',kind:'model',keyEnv:'OPENAI_API_KEY',plan:'paid, per token',cap:'OPENAI_DAILY_USD (default $8/day)'},
 {id:'deepseek',name:'DeepSeek (v4-flash)',kind:'model',keyEnv:'DEEPSEEK_API_KEY',plan:'paid, per token',cap:'DEEPSEEK_DAILY_USD (default $8/day)'},
 {id:'pool',name:'Our GPUs (HCC L40S Qwen3.5-122B; V100 and RTX 6000 small models)',kind:'model',plan:'free (own hardware)'},
 {id:'gemini',name:'Google Gemini',kind:'model',keyEnv:'GEMINI_API_KEY',plan:'free tier (project without billing)'},
 {id:'openrouter',name:'OpenRouter',kind:'model',keyEnv:'OPENROUTER_API_KEY',plan:'free models + paid'},
 {id:'groq',name:'Groq',kind:'model',keyEnv:'GROQ_API_KEY',plan:'free tier, rate-limited'},
 {id:'search:jina',name:'Jina search',kind:'search',keyEnv:'JINA_API_KEY',plan:'free tokens (10k per search), then paid'},
 {id:'search:exa',name:'Exa search',kind:'search',keyEnv:'EXA_API_KEY',plan:'free credit, then paid',cap:'EXA_DAILY_CAP (default 300/day)'},
 {id:'search:tavily',name:'Tavily search',kind:'search',keyEnv:'TAVILY_API_KEY',plan:'1,000 free credits/month, then pay-as-you-go',cap:'TAVILY_DAILY_CAP (default 30/day)'},
 {id:'source:youtube',name:'YouTube Data API',kind:'data',keyEnv:'YOUTUBE_API_KEY',plan:'free, 10,000 units/day'},
 {id:'source:github',name:'GitHub API',kind:'data',keyEnv:'GITHUB_TOKEN',plan:'60/hour without a token, 5,000/hour with'},
 {id:'source:openalex',name:'OpenAlex',kind:'data',keyEnv:'OPENALEX_API_KEY',plan:'free (key optional)'},
 {id:'source:coingecko',name:'CoinGecko',kind:'data',keyEnv:'COINGECKO_API_KEY',plan:'free demo key optional'},
];
export async function services(){
 const db=await entityDb();
 const usage=(await db.query<{service:string;today:number;today_errors:number;month:number;month_errors:number}>(`select service,
   sum(calls) filter (where day=current_date)::int today, sum(errors) filter (where day=current_date)::int today_errors,
   sum(calls) filter (where day>=date_trunc('month',current_date))::int month, sum(errors) filter (where day>=date_trunc('month',current_date))::int month_errors
   from service_usage where day > current_date - 40 group by service`).catch(()=>({rows:[]}))).rows;
 const use=new Map(usage.map(u=>[u.service,u]));
 const since=new Date(new Date().getUTCFullYear(),new Date().getUTCMonth(),1).toISOString();
 const models=((await database().prepare("SELECT provider, COUNT(*) calls, SUM(CASE WHEN status<>'ok' THEN 1 ELSE 0 END) failed, ROUND(SUM(cost_usd),2) cost FROM llm_usage WHERE created_at>=? GROUP BY provider").bind(since).all<{provider:string;calls:number;failed:number;cost:number}>()).results||[]);
 const byProvider=new Map(models.map(m=>[m.provider,m]));
 const rows=SERVICES.map(s=>{const u=use.get(s.id),m=s.kind==='model'?byProvider.get(s.id):undefined;
  return {kind:s.kind,name:s.name,configured:s.keyEnv?(process.env[s.keyEnv]?'yes':'no'):'—',plan:s.plan,cap:s.cap?s.cap.replace(/\(default (\d+)\/day\)/,(_x,d)=>'('+(process.env[s.cap!.split(' ')[0]]||d)+'/day)'):'',
   today:m?'':u?.today??0,month:m?m.calls:u?.month??0,errors:m?m.failed:u?.month_errors??0,cost:m?m.cost:null};});
 // Public data sources called by name (source:<id>) that are not listed above.
 const known=new Set(SERVICES.map(s=>s.id));
 const others=usage.filter(u=>!known.has(u.service)).map(u=>({kind:u.service.split(':')[0],name:u.service.split(':').slice(1).join(':'),configured:'—',plan:'',cap:'',today:u.today??0,month:u.month??0,errors:u.month_errors??0,cost:null}));
 const access=(await db.query(`select title, topic, occurrences, to_char(last_seen_at,'YYYY-MM-DD HH24:MI') last from issues where source='access' and status='open' order by occurrences desc, last_seen_at desc limit 50`).catch(()=>({rows:[]}))).rows;
 // Keys the operators set for sources the agents asked for (names only).
 const sourceKeys=Object.keys(process.env).filter(k=>k.startsWith('SOURCE_KEY_')&&process.env[k]).sort().map(k=>({kind:'data',name:k.slice(11).toLowerCase().replace(/_/g,' ')+' (agent-requested key)',configured:'yes',plan:'{{secret:'+k+'}}',cap:'',today:'',month:'',errors:'',cost:null}));
 return {rows:[...rows,...sourceKeys,...others.sort((a,b)=>b.month-a.month)],access};
}

export async function teams(){
 const db=await entityDb();
 const queue=(await db.query(`select slug, name, status, note, priority, to_char(created_at,'YYYY-MM-DD HH24:MI') created, to_char(started_at,'YYYY-MM-DD HH24:MI') started, to_char(finished_at,'YYYY-MM-DD HH24:MI') finished from team_queue order by case status when 'running' then 0 when 'queued' then 1 else 2 end, coalesce(finished_at, started_at, created_at) desc limit 100`)).rows;
 const runs=(await db.query(`select t.slug topic, r.role, r.status, round(r.cost_usd::numeric,3) cost, to_char(r.started_at,'YYYY-MM-DD HH24:MI') started, extract(epoch from (coalesce(r.finished_at, now()) - r.started_at))::int seconds
  from team_runs r left join topics t on t.id = r.topic_id order by r.started_at desc limit 60`).catch(()=>({rows:[]}))).rows;
 const recipes=(await db.query(`select type, name, case when last_result is null then 'never run' when (last_result->>'ok')::boolean then 'ok' else 'failed' end status, to_char(last_run_at,'YYYY-MM-DD HH24:MI') last_run, left(coalesce(last_result->>'error',''),200) error from recipes order by last_run_at desc nulls last limit 60`).catch(()=>({rows:[]}))).rows;
 const manager=(await db.query(`select value, to_char(updated_at,'YYYY-MM-DD HH24:MI') at from platform_state where key='manager.daily'`)).rows[0]??null;
 return {queue,runs,recipes,manager};
}

// The configuration in effect. Secrets are never shown: only whether each key is set.
export function config(){
 const env=process.env;
 const set=(k:string)=>env[k]?'set':'not set';
 return {
  models:{agentModel:env.OPENAI_AGENT_MODEL||'gpt-5.6-terra (default)',model:env.OPENAI_MODEL||'gpt-5.4-mini (default)',embedModel:env.ENTITY_EMBED_MODEL||'(default)',embedDim:env.ENTITY_EMBED_DIM||'768 (default)'},
  limits:{llmMonthlyBudgetUsd:env.LLM_MONTHLY_BUDGET_USD||'300 (default)',teamMonthlyBudgetUsd:env.TEAM_MONTHLY_BUDGET_USD||'200 (default)',teamConcurrency:env.TEAM_CONCURRENCY||'2 (default)'},
  providers:{OPENAI_API_KEY:set('OPENAI_API_KEY'),NRP_LLM_TOKEN:set('NRP_LLM_TOKEN'),GEMINI_API_KEY:set('GEMINI_API_KEY'),OPENROUTER_API_KEY:set('OPENROUTER_API_KEY'),GROQ_API_KEY:set('GROQ_API_KEY'),
   JINA_API_KEY:set('JINA_API_KEY'),TAVILY_API_KEY:set('TAVILY_API_KEY'),EXA_API_KEY:set('EXA_API_KEY')},
  notifications:{ISSUE_WEBHOOK_URL:set('ISSUE_WEBHOOK_URL'),GITHUB_ISSUES:env.GITHUB_ISSUES_TOKEN&&env.GITHUB_ISSUES_REPO?'set ('+env.GITHUB_ISSUES_REPO+')':'not set'},
  site:{APP_URL:env.APP_URL||'',edition:'public (RankWiki)',admins:String(env.ADMIN_EMAILS||'').split(/[,\s]+/).filter(Boolean).length+' configured'},
 };
}
export {listIssues};

// The model layer now: the scheduler's slots, use and queues; our GPU workers; the last hour per model.
export async function modelLayer(){
 const {schedulerState}=await import('@/app/llm');
 const state=await schedulerState().catch(e=>({error:(e as Error).message}) as never);
 const db=await entityDb();
 const workers=(await db.query<{id:string;model:string;slots:number;busy:number;done:number;failed:number;seen:number}>(`select id, array_to_string(models,',') model, (info->>'slots')::int slots, (info->>'busy')::int busy, (info->>'done')::int done, (info->>'failed')::int failed,
   extract(epoch from now()-last_seen)::int seen from llm_workers where last_seen > now() - interval '1 day' order by last_seen desc`)).rows;
 const queue=(await db.query<{model:string;queued:number;claimed:number}>(`select model, count(*) filter (where status='queued')::int queued, count(*) filter (where status='claimed')::int claimed from llm_jobs where status in ('queued','claimed') group by model`)).rows;
 const since=new Date(Date.now()-3600_000).toISOString();
 const hour=((await database().prepare(`SELECT provider||':'||model model, COUNT(*) calls, SUM(CASE WHEN status<>'ok' THEN 1 ELSE 0 END) failed, ROUND(AVG(CASE WHEN status='ok' THEN latency_ms END)/1000.0,1) avg_s, SUM(output_tokens) out_tokens, ROUND(SUM(cost_usd),2) cost
   FROM llm_usage WHERE created_at>=? AND class NOT IN ('embed','site-embed') GROUP BY 1 ORDER BY calls DESC`).bind(since).all<Record<string,unknown>>()).results||[]);
 return {state,workers,queue,hour};
}
