import {getPage,database} from '@/db/store';
import {env} from '@/server/runtime';
import {contextFiles} from '@/app/context-files/server';
import {editionPageSql} from '@/app/edition';
import {blockWorkflow,excludedComponents} from '@/app/workflows/component-block';
import {runClientAction,parseCsv} from '@/app/workflows/client-run';
import type {AnswerPage} from '@/app/page-types';
import {pagePath,askOf,questionKey} from './urls';
// Server side of the crawlable pages: loads a public page as an anonymous reader, runs the
// load action of each ```component block (reading its Page files from storage) so the ranking
// is in the HTML, resolves /?ask= links to existing pages (agent-written pages first, then the
// entity database's rankings and entities), and lists pages for the sitemap.
const READER='seo-reader';// an id no user has: only public pages are visible
const MAX_FILE=4*1024*1024;

export async function loadPublicPage(id:string):Promise<AnswerPage|null>{
 const page=await getPage(id,READER).catch(()=>null);
 if(!page||page.visibility!=='public'||page.kind==='resource'||page.kind==='dynamic')return null;
 return page;
}

export function componentBlocks(body:string):string[]{
 return [...String(body||'').matchAll(/```component\n([\s\S]*?)\n```/g)].map(m=>m[1]);
}

async function readPublicFile(pageId:string,args:Record<string,unknown>){
 const files=await contextFiles(pageId,READER);
 const f=files.find(x=>x.row.id===args.fileId||(x.row.display_name||x.data.fileName)===args.name);
 if(!f)throw Error('No Page file named '+String(args.name??args.fileId)+'.');
 const location=String(f.data.location||'');if(!location.startsWith('r2://FILES/uploads/'))throw Error('The file could not be read.');
 if(Number(f.data.size)>MAX_FILE)throw Error('The file is too large to render on the server.');
 const object=await env.FILES.get(location.slice('r2://FILES/'.length));if(!object)throw Error('The file could not be read.');
 const text=await object.text();
 const name=String(f.row.display_name||f.data.fileName);
 const as=String(args.as||(/\.(csv|tsv)$/i.test(name)?'csv':/\.(json|geojson)$/i.test(name)?'json':'text'));
 return as==='csv'?parseCsv({text}):as==='json'?JSON.parse(text):text;
}

// {block source → state after its load action}. A block whose load fails is left to the browser.
export async function preloadBlocks(page:AnswerPage):Promise<Record<string,Record<string,unknown>>>{
 const out:Record<string,Record<string,unknown>>={};
 for(const code of componentBlocks(page.body).slice(0,6)){
  try{
   const w=blockWorkflow(JSON.parse(code));if(excludedComponents(w).length||!w.actions.load?.client)continue;
   const r=await runClientAction(w,'load',{state:{...w.state},values:{},event:{type:'load'}},{id:page.id,title:page.title},{readFile:readPublicFile});
   if(!('error' in r&&r.error))out[code]=r.state;
  }catch(e){console.warn('seo: block preload failed',page.id,(e as Error).message);}
 }
 return out;
}

// Questions a page links to: /?ask= links in its body and the "question" column of ranking rows.
export function linkedQuestions(page:AnswerPage,preloaded:Record<string,Record<string,unknown>>):string[]{
 const qs=new Set<string>();
 for(const m of page.body.matchAll(/\]\((\/\?ask=[^)\s]+)\)/g)){const q=askOf(m[1]);if(q)qs.add(q);}
 for(const state of Object.values(preloaded))for(const v of Object.values(state))if(Array.isArray(v))for(const row of v.slice(0,3000))if(row&&typeof row==='object'){
  const q=(row as Record<string,unknown>).question??(row as Record<string,unknown>).name;if(typeof q==='string'&&q.trim())qs.add(q.trim());}
 return [...qs].slice(0,3000);
}
// {questionKey → canonical path} for questions an existing public page answers (same title or question).
export async function resolveQuestions(questions:string[]):Promise<Record<string,string>>{
 const keys=[...new Set(questions.map(questionKey).filter(Boolean))];const out:Record<string,string>={};
 for(let i=0;i<keys.length;i+=200){
  const chunk=keys.slice(i,i+200),marks=chunk.map(()=>'?').join(',');
  const rows=await database().prepare(`SELECT id,title,question FROM pages p WHERE p.visibility='public' AND ${editionPageSql('p')} AND (lower(p.title) IN (${marks}) OR lower(p.question) IN (${marks}))
   AND NOT EXISTS(SELECT 1 FROM page_aliases a WHERE a.id=p.id) ORDER BY p.created_at`).bind(...chunk,...chunk).all<{id:string;title:string;question:string}>();
  for(const r of rows.results){const path=pagePath(r.id,r.title);for(const k of [questionKey(r.title),questionKey(r.question||'')])if(k&&chunk.includes(k)&&!out[k])out[k]=path;}
 }
 // The rest: a ranking or an entity of the entity database with that name has its own page (/rankings/…, /e/…).
 const rest=keys.filter(k=>!out[k]);
 if(rest.length)try{
  const [{entityDb},{resolveNamedTargets}]=await Promise.all([import('@/app/entity-db/client'),import('@/app/entity-db/pages')]);
  Object.assign(out,await resolveNamedTargets(await entityDb(),rest));
 }catch(e){console.warn('seo: entity database links unavailable',(e as Error).message);}
 return out;
}

// ───────────── sitemap ─────────────
// Pages per sitemap file; a ranking page adds one URL per extra criterion (at most 8), so a file stays under 50,000 URLs.
export const SITEMAP_SIZE=5_000;
const listSql=`FROM pages p WHERE p.visibility='public' AND p.kind<>'dynamic' AND ${editionPageSql('p')} AND NOT EXISTS(SELECT 1 FROM page_aliases a WHERE a.id=p.id)`;
export async function countSitemapPages():Promise<number>{
 return Number((await database().prepare(`SELECT count(*) n ${listSql}`).first<{n:number}>())?.n||0);
}
// body only for ranking pages (their criteria become ?rank= URLs).
export async function sitemapPages(part:number):Promise<{id:string;title:string;updatedAt:string;body:string|null}[]>{
 const r=await database().prepare(`SELECT p.id,p.title,COALESCE(p.updated_at,p.created_at) updatedAt,CASE WHEN json_extract(p.labels,'$.templateId')='ranking-v1' THEN p.body END body ${listSql} ORDER BY p.created_at,p.id LIMIT ? OFFSET ?`)
  .bind(SITEMAP_SIZE,part*SITEMAP_SIZE).all<{id:string;title:string;updatedAt:string;body:string|null}>();
 return r.results;
}
