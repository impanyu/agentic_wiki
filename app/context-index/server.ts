import {database,model} from '@/db/store';import type {AnswerPage} from '@/app/page-types';import {parametersSchema} from '@/app/components-registry/contracts';
export type ContextIndexItem={id:string;title:string;pageId?:string;kind:string;state?:string;createdAt:string;visitedAt?:string;summary?:string};
export function personalArticleYear(question:string){const match=question.match(/\b(?:articles?|pages?)\s+(?:that\s+)?i\s+(?:wrote|created|authored)\s+in\s+((?:19|20)\d{2})\b/i);return match?Number(match[1]):undefined;}
export function registeredContextIndexPage(page:AnswerPage):AnswerPage{
 const year=personalArticleYear(page.question||'');if(!year)return page;
 return {...page,title:`Your ${year} articles`,summary:`Pages you created in ${year}, loaded from your current saved pages.`,body:'',labels:{...page.labels,templateId:'wiki-v1'},dynamic:{template:'context-index-v1',executor:'context-index-v1',version:1,indexKind:'pages',labels:page.dynamic?.labels||{},inputFields:[{name:'source',type:'string',description:'visited (pages the user opened, newest visit first) or created (pages the user made)',required:false},{name:'page_kind',type:'string',description:'static, dynamic or all',required:false},{name:'topic_terms',type:'string',description:'JSON array of synonymous topic keywords; [] for all',required:false},{name:'created_year',type:'number',description:'Four-digit year in which the page was created.',required:false}]}} as AnswerPage;
}
export const myContextsSql=`SELECT id,title,kind,category,summary,created_at createdAt FROM pages WHERE owner_id=? AND (?='all' OR kind=?) AND (?='' OR created_at>=?) AND (?='' OR created_at<?) AND NOT EXISTS(SELECT 1 FROM page_aliases a WHERE a.id=pages.id) ORDER BY created_at DESC,id`;
// Pages the user opened, newest visit first (history is keyed by user, not by page owner).
export const visitedContextsSql=`SELECT p.id,p.title,p.kind,p.category,p.summary,max(v.visited_at) visitedAt,p.created_at createdAt FROM page_visits v JOIN pages p ON p.id=v.page_id WHERE v.owner_key=? AND (p.owner_id=? OR p.visibility='public') AND (?='all' OR p.kind=?) AND NOT EXISTS(SELECT 1 FROM page_aliases a WHERE a.id=p.id) GROUP BY p.id ORDER BY visitedAt DESC LIMIT 300`;
export function wantsVisited(question:string){return /\b(visit(?:ed|s)?|viewed|seen|opened|browsed)\b|浏览|访问|看过|打开过/i.test(question)&&!/\b(i\s+(?:wrote|created|authored|made|generated))\b|我(?:写|创建|生成)的/i.test(question);}
// Topic relevance by meaning, not substring: "history" must keep a page on Ulysses S. Grant
// and drop "historical volatility" or a GDP comparison. One bounded model call over titles
// and summaries; falls back to the keyword filter when the call fails.
async function relevantByMeaning(question:string,terms:string[],rows:(ContextIndexItem&{category?:string})[]){
 if(!rows.length||(!terms.length&&!question.trim()))return rows;
 const candidates=rows.slice(0,150).map((r,i)=>({i,title:r.title,category:r.category||'',summary:(r.summary||'').slice(0,240),kind:r.kind}));
 try{
  const {api,output}=await import('@/app/api/ask/ai');
  const response=await api('responses',{model:model('coding'),store:false,instructions:'You filter a user\u2019s own wiki pages for a personal index page. Given the user\u2019s request and optional topic terms, return the indices of the candidate pages whose SUBJECT matches the requested topic by meaning, in any language (for example the topic history includes historical figures, wars, dynasties and eras, but not financial "historical volatility" or an economics comparison that merely uses past data). Be strict: keep a page only when its MAIN subject clearly belongs to the topic. A page that merely has a history section, mentions dates or is loosely related does not qualify (for the topic history, a page about a country, city, bridge, disease or company is excluded unless the page itself is about a historical period, event or figure). When unsure, exclude. Ignore words about time, recency, visiting or page type; those filters were already applied. If the request names no topic, return every index. Return only JSON {"keep":[indices]}.',input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({request:question.slice(0,500),topicTerms:terms,candidates})}]}]});
  const text=output(response),json=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1)) as {keep?:unknown};
  const keep=new Set((Array.isArray(json.keep)?json.keep:[]).filter((n):n is number=>Number.isInteger(n)));
  return candidates.filter(c=>keep.has(c.i)).map(c=>rows[c.i]);
 }catch{return filterContexts(rows,terms);}
}
export function contextYearBounds(raw:unknown){
 const year=typeof raw==='number'&&Number.isInteger(raw)&&raw>=1970&&raw<=9998?raw:undefined;
 return year?{start:`${year}-01-01T00:00:00.000Z`,end:`${year+1}-01-01T00:00:00.000Z`}:{start:'',end:''};
}
export function filterContexts(rows:(ContextIndexItem&{category?:string})[],terms:string[]){return rows.filter(p=>!terms.length||terms.some(t=>[p.title,p.category||'',p.summary||''].join(' ').toLocaleLowerCase().includes(t.toLocaleLowerCase())));}
export async function executeContextIndex(page:AnswerPage,raw:unknown,userId:string){
 const parameters=parametersSchema.parse(raw||{}),questionYear=personalArticleYear(page.question||'');if(questionYear&&!parameters.created_year)parameters.created_year=questionYear;let items:ContextIndexItem[]=[];
 if(page.dynamic?.indexKind==='jobs'){
  const jobs=await database().prepare("SELECT id,title,page_id pageId,kind,state,created_at createdAt FROM context_jobs WHERE owner_id=? AND state='running' AND expires>? AND NOT(kind='navigation' AND title=?) ORDER BY created_at DESC").bind(userId,Date.now(),String(parameters.query||'')).all<ContextIndexItem>();
  const sandboxes=await database().prepare("SELECT id,kind,state,created_at FROM sandbox_sessions WHERE owner_id=? AND state IN ('starting','active') AND expires_at>?").bind(userId,Date.now()).all<{id:string;kind:string;state:string;created_at:number}>();
  items=[...jobs.results,...sandboxes.results.map(s=>({id:s.id,title:s.kind==='desktop'?'Sandbox desktop':'Sandbox code execution',kind:'sandbox',state:s.state,createdAt:new Date(s.created_at).toISOString()}))];
 }else{
  const kind=['static','dynamic'].includes(String(parameters.page_kind))?String(parameters.page_kind):'all';
  const bounds=contextYearBounds(parameters.created_year);
  let terms:string[]=[];try{const value=JSON.parse(String(parameters.topic_terms||'[]'));if(Array.isArray(value))terms=value.filter((v):v is string=>typeof v==='string'&&v.trim().length>0).slice(0,12);}catch{}
  const question=String(parameters.query||page.question||'');
  const source=parameters.source==='visited'||parameters.source==='created'?parameters.source:wantsVisited(question)?'visited':'created';
  const rows=source==='visited'
   ?(await database().prepare(visitedContextsSql).bind('user:'+userId,userId,kind,kind).all<ContextIndexItem&{category:string;visitedAt:number}>()).results.filter(r=>!bounds.start||(r.createdAt>=bounds.start&&r.createdAt<bounds.end)).map(r=>({...r,visitedAt:r.visitedAt?new Date(r.visitedAt).toISOString():undefined}))
   :(await database().prepare(myContextsSql).bind(userId,kind,kind,bounds.start,bounds.start,bounds.end,bounds.end).all<ContextIndexItem&{category:string}>()).results;
  items=(await relevantByMeaning(question,terms,rows.filter(r=>r.id!==page.id))).map(p=>({...p,pageId:p.id}));
  (parameters as Record<string,unknown>).source=source;
 }
 return {...page,parameters,contextIndex:{kind:page.dynamic?.indexKind||'pages',items},runtimeError:undefined};
}
export async function queryContexts(userId:string,filters:unknown){const page={id:'tool',title:'Context search',labels:{},dynamic:{indexKind:'pages'}} as unknown as AnswerPage;return (await executeContextIndex(page,filters,userId)).contextIndex;}
export async function listRunningJobs(userId:string){const page={id:'tool',title:'Running jobs',labels:{},dynamic:{indexKind:'jobs'}} as unknown as AnswerPage;return (await executeContextIndex(page,{},userId)).contextIndex;}
