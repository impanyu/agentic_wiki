import {Script} from 'node:vm';
import {unreachableImages} from '@/app/chat/image-check';
import {pageCodeSchema,pageCodeContract} from './page-code';
import {codeSchema} from '@/app/sandboxes/contracts';
import {inputFieldsSchema} from './inputs';
import {registeredAdmaPage} from './deferred';
import {customStyleSchema,normalizeCustomStyle} from './custom-style';
import {visualThemes} from './visual-style';
import {canWritePage} from '@/app/page-permissions';
import {env} from '@/server/runtime';import {z} from 'zod';
import {database,getPage,lock,unlock} from '@/db/store';import {askAgent,type Agent} from '@/app/agents/runtime';
import {getComponent,createComponent} from '@/app/components-registry/registry';import {composePageProgram} from './composer';import {sandboxStatus} from '@/app/sandboxes/service';
import type {AnswerPage} from '@/app/page-types';import type {EditDraft} from '@/app/chat/edit-draft';import type {FilePart} from '@/app/context-files/server';
const bucket=()=>(env as unknown as {FILES:R2Bucket}).FILES;
const path=(agent:Agent)=>'app-edit-drafts/'+agent.id+'.json';
// config is null when a replacement turns the page back into a static article.
type Draft=EditDraft&{pageBody?:string;ownerId:string;pageId:string;base:string;config:NonNullable<AnswerPage['dynamic']>|null;kind?:'static'|'dynamic';sources?:AnswerPage['sources'];category?:string;labels?:Record<string,unknown>;templateId:AnswerPage['labels']['templateId'];saved?:boolean};
const revision=(page:AnswerPage)=>JSON.stringify([page.kind,page.title,page.summary,page.body,page.dynamic?.template,page.dynamic?.components,page.dynamic?.inputFields,page.dynamic?.sessionInstructions,page.dynamic?.visualTheme,page.dynamic?.visualDesign,page.dynamic?.ui,page.dynamic?.pageCode,page.dynamic?.customized,page.labels.templateId]);
const basemaps=['osm','streets-vector','satellite','hybrid','topo-vector','terrain','gray-vector','dark-gray-vector'] as const;
const renderedUiRequest=(message:string)=>/\b(?:ui|interface|layout|panel|button|control|menu|icon|map|basemap|default|display|show|hide|move|position|reader|viewer|frontend|front-end)\b|(?:界面|布局|面板|按钮|控件|菜单|图标|地图|底图|默认|显示|隐藏|移动|前端)/i.test(message);
export function appEditCapabilities(page:AnswerPage){
 const configurable={mapBasemap:basemaps};
 return {appearance:true,agentBehavior:true,configurable,frontendCode:pageCodeContract,content:'{kind:"content",title?,summary?,body?,sources?,category?} edits the page title, summary, Markdown body, source list and category in place',backendProgram:page.dynamic?.template==='page-program-v1'?'{kind:"program",program:{kind:"sandbox-program",language:"javascript"|"python",code},inputFields?} replaces only the saved backend program; the pre-coded renderer and other components stay':'this page has no backend program; use a replacement draft with kind=program to add one',replacement:'supported; preserve unrelated functionality'};
}
async function stored(agent:Agent,pageId:string){const object=await bucket().get(path(agent));if(!object)return null;const draft=await object.json<Draft>();return draft.ownerId===agent.ownerId&&draft.pageId===pageId?draft:null;}
const preview=(draft:Draft):EditDraft=>({id:draft.id,title:draft.title,summary:draft.summary,body:draft.body,pageCode:draft.config?.pageCode});
export async function readAppDraft(agent:Agent,pageId:string){const draft=await stored(agent,pageId);return draft&&!draft.saved?preview(draft):null;}
export async function discardAppDraft(agent:Agent){await bucket().delete(path(agent));}
export async function stageAppRevision(page:AnswerPage,raw:unknown,agent:Agent,request=''){
 if(!canWritePage(page))throw Error('PAGE_READ_ONLY');
 page=registeredAdmaPage(page);
 const change=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('appearance'),visualTheme:z.enum(visualThemes),visualDesign:customStyleSchema.nullable().optional(),description:z.string().max(10000)}).strict(),
  z.object({kind:z.literal('session'),instructions:z.string().min(1).max(10000)}).strict(),
  z.object({kind:z.literal('code'),code:pageCodeSchema.nullable()}).strict(),
  z.object({kind:z.literal('configuration'),mapBasemap:z.enum(basemaps)}).strict(),
  z.object({kind:z.literal('content'),title:z.string().trim().min(1).max(200).optional(),summary:z.string().max(1200).optional(),body:z.string().max(40000).optional(),sources:z.array(z.object({title:z.string().trim().min(1).max(300),url:z.string().url().max(2000)}).strict()).max(60).optional(),category:z.string().trim().max(100).optional()}).strict(),
  z.object({kind:z.literal('program'),program:codeSchema,inputFields:inputFieldsSchema.optional()}).strict(),
  z.object({kind:z.literal('replacement'),draft:z.unknown()}).strict()
 ]).parse(raw);
 let config:NonNullable<AnswerPage['dynamic']>=page.dynamic||{template:'agent-chat-v1',executor:'page-agent-v1',version:1,labels:page.labels as any},title=page.title,summary=page.summary,body='',templateId=page.labels.templateId,pageBody=page.body;
 let pageKind:'static'|'dynamic'=page.kind==='static'?'static':'dynamic',nextConfig:NonNullable<AnswerPage['dynamic']>|null|undefined,sources=page.sources,category=page.category,extraLabels:Record<string,unknown>={};
 if(change.kind==='appearance'){config={...config,visualTheme:change.visualTheme,visualDesign:change.visualTheme==='custom'?normalizeCustomStyle(change.visualDesign):null};body=change.description;}
 else if(change.kind==='session'){
  if(renderedUiRequest(request))throw Error('Agent instructions cannot change rendered controls or layout. Use a supported configuration edit or a concrete application revision.');
  config={...config,sessionInstructions:change.instructions};body=change.instructions;
 }
 else if(change.kind==='code'){
  if(!change.code){
   if(!config.pageCode)throw Error('This page has no saved custom code panel to remove.');
   const {pageCode:_removed,...rest}=config;config=rest as typeof config;body='Remove the custom frontend code panel and restore the native workspace';
  }
  else{try{new Script(change.code.frontend.javascript);}catch(e){throw Error('Frontend JavaScript syntax error: '+(e instanceof Error?e.message:'Invalid JavaScript'));}config={...config,pageCode:change.code,customized:true};body='Frontend code ('+change.code.placement+')';}
 }
 else if(change.kind==='content'){
  if(change.title===undefined&&change.summary===undefined&&change.body===undefined&&change.sources===undefined&&change.category===undefined)throw Error('A content edit needs a title, summary, body, sources or category.');
  if(change.sources!==undefined)sources=change.sources;if(change.category!==undefined)category=change.category;
  title=change.title??title;summary=change.summary??summary;pageBody=change.body!==undefined?change.body.split('\n').map(line=>line.replace(/^(!\[[^\]]*\]\()\s*([^\s)]+)\s*\)\s*$/,'$1$2)')).join('\n'):pageBody;if(change.body!==undefined){const broken=await unreachableImages(change.body);if(broken.length)throw Error('These image URLs do not serve an image and would render as gaps: '+broken.join(', ')+'. Use find_images or a page file, one image per line as ![caption](url).');}body=[change.title!==undefined?'title':'',change.summary!==undefined?'summary':'',change.body!==undefined?'body':'',change.sources!==undefined?'sources':'',change.category!==undefined?'category':''].filter(Boolean).join(', ')+' updated';
 }
 else if(change.kind==='program'){
  if(config.template!=='page-program-v1')throw Error('This page has no backend program to edit. Propose a replacement draft with kind=program to give it one.');
  // Backend programs are ES modules; strip export keywords so the classic-script syntax check applies.
  if(change.program.language==='javascript'){try{new Script(change.program.code.replace(/^\s*export\s+(?:default\s+)?/gm,''));}catch(e){throw Error('Backend JavaScript syntax error: '+(e instanceof Error?e.message:'Invalid JavaScript'));}}
  const backend=await createComponent(page.title+' — page view program','backend_code',change.program,{pageId:page.id,userId:agent.ownerId,ownerId:agent.ownerId,language:page.language,visibility:'private',agent});
  config={...config,components:{...config.components,frontend:config.components?.frontend as NonNullable<NonNullable<typeof config.components>['frontend']>,backend:{id:backend.id,version:backend.version}},...(change.inputFields?{inputFields:change.inputFields}:{}),customized:true};body=change.program.code;
 }
 else if(change.kind==='configuration'){
  config={...config,ui:{...config.ui,mapBasemap:change.mapBasemap}};body='Map basemap: '+change.mapBasemap;
 }
 else{

  const {validateGenerationDraft,materializeGenerationDraft}=await import('./generation-draft');
  const context={pageId:page.id,userId:agent.ownerId,ownerId:agent.ownerId,language:page.language,visibility:'private' as const,agent};
  const draft=validateGenerationDraft(change.draft,page.question||page.title,context,true),result=await materializeGenerationDraft(draft,context);
  title=draft.title;summary=draft.summary;templateId=result.templateId;pageBody=draft.body;body=draft.program?.code||draft.body||draft.summary;sources=draft.sources;category=draft.category;
  if(result.definition){config={...result.definition.config,customized:true,contextDomain:page.dynamic?.contextDomain};pageKind='dynamic';}
  else{
   // A researched article or disambiguation index: the page becomes (or stays) a static wiki page.
   const answer=result.answer as {title:string;summary:string;body:string;sources?:AnswerPage['sources'];labels?:Record<string,unknown>;category?:string};
   title=answer.title;summary=answer.summary;pageBody=answer.body;sources=answer.sources||sources;category=answer.category||category;extraLabels=answer.labels||{};nextConfig=null;pageKind='static';
  }
 }
 const savedConfig=nextConfig===undefined?config:nextConfig;
 if(JSON.stringify([pageKind,title,summary,pageBody,savedConfig,templateId,sources,category])===JSON.stringify([page.kind==='static'?'static':'dynamic',page.title,page.summary,page.body,page.dynamic,page.labels.templateId,page.sources,page.category]))throw Error('This proposal does not change any saved, renderable page property.');
 const draft:Draft={id:crypto.randomUUID(),ownerId:agent.ownerId,pageId:page.id,base:revision(page),title,summary,body,pageBody,config:savedConfig,kind:pageKind,sources,category,labels:extraLabels,templateId};
 await bucket().put(path(agent),JSON.stringify(draft));return {editDraft:preview(draft),saved:false};
}
export async function saveAppDraft(agent:Agent,pageId:string,draftId:string){
 const lease=await lock('refresh:'+pageId,90000);if(!lease)throw Error('This page is being updated. Try again.');
 try{const rawPage=await getPage(pageId,agent.ownerId),page=rawPage?registeredAdmaPage(rawPage):null,draft=await stored(agent,pageId);if(!page||!canWritePage(page)||!draft||draft.id!==draftId)throw Error('This app proposal is unavailable.');if(draft.saved)return {page,alreadySaved:true};if(revision(page)!==draft.base)throw Error('The app changed. Ask the agent to revise its proposal.');
  const refs=Object.entries(draft.config?.components||{}).map(([role,ref])=>({role,ref})).filter(r=>r.ref);
  const deps=refs.flatMap(({role,ref})=>[
   ...(page.visibility==='public'?[database().prepare("UPDATE components SET visibility='public' WHERE id=? AND owner_id=? AND type IN ('frontend_template','backend_code','data','workflow')").bind(ref!.id,agent.ownerId)]:[]),
   database().prepare('INSERT INTO component_dependencies(parent_id,role,component_id,version) VALUES(?,?,?,?) ON CONFLICT(parent_id,role) DO UPDATE SET component_id=excluded.component_id,version=excluded.version').bind(page.id,role,ref!.id,ref!.version),
  ]);
  const now=new Date().toISOString();await database().batch([...deps,database().prepare("UPDATE pages SET title=?,summary=?,body=?,dynamic_config=?,labels=?,kind=?,sources=?,category=?,updated_at=? WHERE id=? AND (owner_id=? OR (visibility='public' AND public_write=1)) AND EXISTS(SELECT 1 FROM generation_locks WHERE token=? AND expires>?)").bind(draft.title,draft.summary,draft.pageBody??'',draft.config?JSON.stringify(draft.config):null,JSON.stringify({...page.labels,templateId:draft.templateId,...(draft.labels||{})}),draft.kind||(draft.config?'dynamic':'static'),JSON.stringify(draft.sources||page.sources||[]),draft.category??page.category??'',now,pageId,agent.ownerId,lease,Date.now())]);
  const updated=await getPage(pageId,agent.ownerId);if(updated?.updatedAt!==now)throw Error('Could not save the app revision.');await bucket().put(path(agent),JSON.stringify({...draft,saved:true}));return {page:updated?registeredAdmaPage(updated):updated,alreadySaved:false};
 }finally{await unlock(lease);}
}
