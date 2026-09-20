import {database} from '@/db/store';import type {AnswerPage} from '@/app/page-types';import {parametersSchema} from '@/app/components-registry/contracts';
export type ContextIndexItem={id:string;title:string;pageId?:string;kind:string;state?:string;createdAt:string;summary?:string};
export const myContextsSql=`SELECT id,title,kind,category,summary,created_at createdAt FROM pages WHERE owner_id=? AND (?='all' OR kind=?) AND (?='' OR created_at>=?) AND (?='' OR created_at<?) AND NOT EXISTS(SELECT 1 FROM page_aliases a WHERE a.id=pages.id) ORDER BY created_at DESC,id`;
export function contextYearBounds(raw:unknown){
 const year=typeof raw==='number'&&Number.isInteger(raw)&&raw>=1970&&raw<=9998?raw:undefined;
 return year?{start:`${year}-01-01T00:00:00.000Z`,end:`${year+1}-01-01T00:00:00.000Z`}:{start:'',end:''};
}
export function filterContexts(rows:(ContextIndexItem&{category?:string})[],terms:string[]){return rows.filter(p=>!terms.length||terms.some(t=>[p.title,p.category||'',p.summary||''].join(' ').toLocaleLowerCase().includes(t.toLocaleLowerCase())));}
export async function executeContextIndex(page:AnswerPage,raw:unknown,userId:string){
 const parameters=parametersSchema.parse(raw||{});let items:ContextIndexItem[]=[];
 if(page.dynamic?.indexKind==='jobs'){
  const jobs=await database().prepare("SELECT id,title,page_id pageId,kind,state,created_at createdAt FROM context_jobs WHERE owner_id=? AND state='running' AND expires>? AND NOT(kind='navigation' AND title=?) ORDER BY created_at DESC").bind(userId,Date.now(),String(parameters.query||'')).all<ContextIndexItem>();
  const sandboxes=await database().prepare("SELECT id,kind,state,created_at FROM sandbox_sessions WHERE owner_id=? AND state IN ('starting','active') AND expires_at>?").bind(userId,Date.now()).all<{id:string;kind:string;state:string;created_at:number}>();
  items=[...jobs.results,...sandboxes.results.map(s=>({id:s.id,title:s.kind==='desktop'?'Sandbox desktop':'Sandbox code execution',kind:'sandbox',state:s.state,createdAt:new Date(s.created_at).toISOString()}))];
 }else{
  const kind=['static','dynamic'].includes(String(parameters.page_kind))?String(parameters.page_kind):'all';
  const bounds=contextYearBounds(parameters.created_year);
  let terms:string[]=[];try{const value=JSON.parse(String(parameters.topic_terms||'[]'));if(Array.isArray(value))terms=value.filter((v):v is string=>typeof v==='string'&&v.trim().length>0).slice(0,12);}catch{}
  const rows=await database().prepare(myContextsSql).bind(userId,kind,kind,bounds.start,bounds.start,bounds.end,bounds.end).all<ContextIndexItem&{category:string}>();
  items=filterContexts(rows.results,terms).map(p=>({...p,pageId:p.id}));
 }
 return {...page,parameters,contextIndex:{kind:page.dynamic?.indexKind||'pages',items},runtimeError:undefined};
}
export async function queryContexts(userId:string,filters:unknown){const page={id:'tool',title:'Context search',labels:{},dynamic:{indexKind:'pages'}} as unknown as AnswerPage;return (await executeContextIndex(page,filters,userId)).contextIndex;}
export async function listRunningJobs(userId:string){const page={id:'tool',title:'Running jobs',labels:{},dynamic:{indexKind:'jobs'}} as unknown as AnswerPage;return (await executeContextIndex(page,{},userId)).contextIndex;}
