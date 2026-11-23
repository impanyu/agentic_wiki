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
 return {daily,byModel,spend};
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
