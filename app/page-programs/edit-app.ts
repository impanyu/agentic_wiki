import {Script} from 'node:vm';
import {pageCodeSchema,pageCodeContract} from './page-code';
import {registeredAdmaPage} from './deferred';
import {customStyleSchema,normalizeCustomStyle} from './custom-style';
import {visualThemes} from './visual-style';
import {canWritePage} from '@/app/page-permissions';
import {env} from '@/server/runtime';import {z} from 'zod';
import {database,getPage,lock,unlock} from '@/db/store';import {askAgent,type Agent} from '@/app/agents/runtime';
import {getComponent} from '@/app/components-registry/registry';import {composePageProgram} from './composer';import {sandboxStatus} from '@/app/sandboxes/service';
import type {AnswerPage} from '@/app/page-types';import type {EditDraft} from '@/app/chat/edit-draft';import type {FilePart} from '@/app/context-files/server';
const bucket=()=>(env as unknown as {FILES:R2Bucket}).FILES;
const path=(agent:Agent)=>'app-edit-drafts/'+agent.id+'.json';
type Draft=EditDraft&{pageBody?:string;ownerId:string;pageId:string;base:string;config:NonNullable<AnswerPage['dynamic']>;templateId:AnswerPage['labels']['templateId'];saved?:boolean};
const revision=(page:AnswerPage)=>JSON.stringify([page.title,page.summary,page.body,page.dynamic?.template,page.dynamic?.components,page.dynamic?.inputFields,page.dynamic?.sessionInstructions,page.dynamic?.visualTheme,page.dynamic?.visualDesign,page.dynamic?.ui,page.dynamic?.pageCode,page.dynamic?.customized,page.labels.templateId]);
const basemaps=['osm','streets-vector','satellite','hybrid','topo-vector','terrain','gray-vector','dark-gray-vector'] as const;
const renderedUiRequest=(message:string)=>/\b(?:ui|interface|layout|panel|button|control|menu|icon|map|basemap|default|display|show|hide|move|position|reader|viewer|frontend|front-end)\b|(?:界面|布局|面板|按钮|控件|菜单|图标|地图|底图|默认|显示|隐藏|移动|前端)/i.test(message);
export function appEditCapabilities(page:AnswerPage){
 const configurable={mapBasemap:basemaps};
 return {appearance:true,agentBehavior:true,configurable,frontendCode:pageCodeContract,replacement:'supported; preserve unrelated functionality'};
}
async function stored(agent:Agent,pageId:string){const object=await bucket().get(path(agent));if(!object)return null;const draft=await object.json<Draft>();return draft.ownerId===agent.ownerId&&draft.pageId===pageId?draft:null;}
const preview=(draft:Draft):EditDraft=>({id:draft.id,title:draft.title,summary:draft.summary,body:draft.body,pageCode:draft.config.pageCode});
export async function readAppDraft(agent:Agent,pageId:string){const draft=await stored(agent,pageId);return draft&&!draft.saved?preview(draft):null;}
export async function discardAppDraft(agent:Agent){await bucket().delete(path(agent));}
export async function stageAppRevision(page:AnswerPage,raw:unknown,agent:Agent,request=''){
 if(!canWritePage(page))throw Error('PAGE_READ_ONLY');
 page=registeredAdmaPage(page);
 const change=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('appearance'),visualTheme:z.enum(visualThemes),visualDesign:customStyleSchema.nullable().optional(),description:z.string().max(10000)}).strict(),
  z.object({kind:z.literal('session'),instructions:z.string().min(1).max(10000)}).strict(),
  z.object({kind:z.literal('code'),code:pageCodeSchema}).strict(),
  z.object({kind:z.literal('configuration'),mapBasemap:z.enum(basemaps)}).strict(),
  z.object({kind:z.literal('replacement'),draft:z.unknown()}).strict()
 ]).parse(raw);
 let config:NonNullable<AnswerPage['dynamic']>=page.dynamic||{template:'agent-chat-v1',executor:'page-agent-v1',version:1,labels:page.labels as any},title=page.title,summary=page.summary,body='',templateId=page.labels.templateId,pageBody=page.body;
 if(change.kind==='appearance'){config={...config,visualTheme:change.visualTheme,visualDesign:change.visualTheme==='custom'?normalizeCustomStyle(change.visualDesign):null};body=change.description;}
 else if(change.kind==='session'){
  if(renderedUiRequest(request))throw Error('Agent instructions cannot change rendered controls or layout. Use a supported configuration edit or a concrete application revision.');
  config={...config,sessionInstructions:change.instructions};body=change.instructions;
 }
 else if(change.kind==='code'){try{new Script(change.code.frontend.javascript);}catch(e){throw Error('Frontend JavaScript syntax error: '+(e instanceof Error?e.message:'Invalid JavaScript'));}config={...config,pageCode:change.code,customized:true};body='Frontend code ('+change.code.placement+')';}
 else if(change.kind==='configuration'){
  config={...config,ui:{...config.ui,mapBasemap:change.mapBasemap}};body='Map basemap: '+change.mapBasemap;
 }
 else{

  const {validateGenerationDraft,materializeGenerationDraft}=await import('./generation-draft');
  const context={pageId:page.id,userId:agent.ownerId,ownerId:agent.ownerId,language:page.language,visibility:'private' as const,agent};
  const draft=validateGenerationDraft(change.draft,page.question||page.title,context,true),result=await materializeGenerationDraft(draft,context);
  if(!result.definition)throw Error('An app revision must contain an application definition.');

  config={...result.definition.config,customized:true,contextDomain:page.dynamic?.contextDomain};title=draft.title;summary=draft.summary;templateId=result.templateId;pageBody=draft.body;body=draft.program?.code||draft.body||draft.summary;
 }
 if(JSON.stringify([title,summary,pageBody,config,templateId])===JSON.stringify([page.title,page.summary,page.body,page.dynamic,page.labels.templateId]))throw Error('This proposal does not change any saved, renderable page property.');
 const draft:Draft={id:crypto.randomUUID(),ownerId:agent.ownerId,pageId:page.id,base:revision(page),title,summary,body,pageBody,config,templateId};
 await bucket().put(path(agent),JSON.stringify(draft));return {editDraft:preview(draft),saved:false};
}
export async function saveAppDraft(agent:Agent,pageId:string,draftId:string){
 const lease=await lock('refresh:'+pageId,90000);if(!lease)throw Error('This page is being updated. Try again.');
 try{const rawPage=await getPage(pageId,agent.ownerId),page=rawPage?registeredAdmaPage(rawPage):null,draft=await stored(agent,pageId);if(!page||!canWritePage(page)||!draft||draft.id!==draftId)throw Error('This app proposal is unavailable.');if(draft.saved)return {page,alreadySaved:true};if(revision(page)!==draft.base)throw Error('The app changed. Ask the agent to revise its proposal.');
  const refs=Object.entries(draft.config.components||{}).map(([role,ref])=>({role,ref})).filter(r=>r.ref);
  const deps=refs.flatMap(({role,ref})=>[
   ...(page.visibility==='public'?[database().prepare("UPDATE components SET visibility='public' WHERE id=? AND owner_id=? AND type IN ('frontend_template','backend_code','data','workflow')").bind(ref!.id,agent.ownerId)]:[]),
   database().prepare('INSERT INTO component_dependencies(parent_id,role,component_id,version) VALUES(?,?,?,?) ON CONFLICT(parent_id,role) DO UPDATE SET component_id=excluded.component_id,version=excluded.version').bind(page.id,role,ref!.id,ref!.version),
  ]);
  const now=new Date().toISOString();await database().batch([...deps,database().prepare("UPDATE pages SET title=?,summary=?,body=?,dynamic_config=?,labels=?,updated_at=? WHERE id=? AND (owner_id=? OR (visibility='public' AND public_write=1)) AND EXISTS(SELECT 1 FROM generation_locks WHERE token=? AND expires>?)").bind(draft.title,draft.summary,draft.pageBody??'',JSON.stringify(draft.config),JSON.stringify({...page.labels,templateId:draft.templateId}),now,pageId,agent.ownerId,lease,Date.now())]);
  const updated=await getPage(pageId,agent.ownerId);if(updated?.updatedAt!==now)throw Error('Could not save the app revision.');await bucket().put(path(agent),JSON.stringify({...draft,saved:true}));return {page:updated?registeredAdmaPage(updated):updated,alreadySaved:false};
 }finally{await unlock(lease);}
}
