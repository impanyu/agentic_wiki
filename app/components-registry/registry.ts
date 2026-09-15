import type {GenerationIntent} from '@/app/page-programs/generation-intent';
import {codeSchema} from '@/app/sandboxes/contracts';
import {chartSchema} from './chart-contracts';
import {memory,recordAction,type Agent} from './agents';
import {database,normalize} from '@/db/store';
import {embed,cosine,verify,type Candidate} from '@/app/api/ask/ai';
import {nearestQuestions} from '@/app/api/ask/ranking';
import {componentTypeSchema,formSchema,validateProgram,dataReferenceSchema,type ComponentRef,type ComponentType} from './contracts';
export type Component={id:string;type:ComponentType;version:number;owner_id:string;visibility:'public'|'private';language:string;title:string;description:string;payload:string};
export type AgentContext={generationIntent?:GenerationIntent;generationFeedback?:string;pageId?:string;userId:string;language:string;ownerId:string;visibility:'public'|'private';pageIntent?:'article'|'chart'|'application';agent?:Agent};
export async function getComponent(ref:ComponentRef,context:Pick<AgentContext,'userId'>,type?:ComponentType){
 const row=await database().prepare("SELECT * FROM components WHERE id=? AND version=? AND (visibility='public' OR owner_id=?)").bind(ref.id,ref.version,context.userId).first<Component>();
 if(!row||type&&row.type!==type)throw new Error('COMPONENT_UNAVAILABLE');return row;
}
// Shared typed lookup for agents and the browser; the browser defaults to page.
export async function searchComponent(question:string,type:ComponentType,context:AgentContext,vector?:number[],signal?:AbortSignal){
 componentTypeSchema.parse(type);
 vector??=await embed(question);let candidates:Candidate[]=[],after='';
 while(true){
  const rows=await database().prepare(`SELECT q.id,q.question,q.embedding,q.language,json_extract(c.payload,'$.capability') capability FROM component_questions q JOIN components c ON c.id=q.component_id WHERE q.type=? AND q.language=? AND q.id>? AND (c.visibility='public' OR c.owner_id=?) AND (?=0 OR c.visibility='public') AND NOT EXISTS(SELECT 1 FROM page_aliases a WHERE a.id=c.id) AND NOT EXISTS(SELECT 1 FROM page_replacements r WHERE r.source_id=c.id AND r.user_id=?) ORDER BY q.id LIMIT 100`).bind(type,context.language,after,context.userId,context.visibility==='public'&&['frontend_template','backend_code','workflow'].includes(type)?1:0,context.userId).all<Candidate&{embedding:string}>();
  candidates=nearestQuestions(candidates.concat(rows.results.map(({embedding,...row})=>({...row,score:cosine(vector!,JSON.parse(embedding))}))));
  if(rows.results.length<100)break;after=rows.results.at(-1)!.id;
 }
 if(type==='page'&&context.pageIntent)candidates=candidates.filter(c=>context.pageIntent==='chart'?c.capability==='chart':context.pageIntent==='application'?['application','browser-application','unit-converter-v1','google-drive-folders'].includes(c.capability||''):(!c.capability||c.capability==='article'));
 const id=await verify(question,candidates,context.language,signal,type,context.agent?await memory(context.agent):[]);if(context.agent)await recordAction(context.agent,'Search '+type,{question,candidates:candidates.map(c=>c.id),matchedQuestionId:id});if(!id)return null;
 return await database().prepare(`SELECT c.* FROM component_questions q JOIN components c ON c.id=q.component_id WHERE q.id=? AND q.type=? AND (c.visibility='public' OR c.owner_id=?)`).bind(id,type,context.userId).first<Component>();
}
export async function rememberComponent(question:string,component:Component,context:AgentContext,vector?:number[]){
 vector??=await embed(question);
 const scope=component.visibility==='public'?'public':component.owner_id;
 await database().prepare(`INSERT INTO component_questions(id,component_id,type,scope,language,question,normalized,embedding,created_at) SELECT ?,id,type,?,language,?,?,?,? FROM components WHERE id=? AND (visibility='public' OR owner_id=?) ON CONFLICT(scope,type,language,normalized) DO UPDATE SET component_id=excluded.component_id,question=excluded.question,embedding=excluded.embedding`).bind(crypto.randomUUID(),scope,question,normalize(question),JSON.stringify(vector),new Date().toISOString(),component.id,context.userId).run();
}
export async function createComponent(question:string,type:Exclude<ComponentType,'page'>,payload:unknown,context:AgentContext,dependencies:{role:string;component:Component}[]=[]){
 context={...context,ownerId:context.userId,visibility:'private'};
 if(context.agent&&context.agent.ownerId!==context.userId)throw new Error('AGENT_PRINCIPAL_MISMATCH');
 componentTypeSchema.parse(type);if(type==='page')throw new Error('PAGES_REQUIRE_PAGE_COMPOSER');
 const checkSecrets=(value:unknown):void=>{if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(/^(api[_-]?key|password|secret|token|access[_-]?token|refresh[_-]?token|authorization|private[_-]?key)$/i.test(key)&&item!==null&&item!=='')throw new Error('STORE_SECRET_REFERENCE_ONLY');checkSecrets(item);}};
 checkSecrets(payload);
 const serialized=JSON.stringify(payload);if(serialized.length>64000||/sk-[A-Za-z0-9_-]{16,}|-----BEGIN .*PRIVATE KEY-----/.test(serialized))throw new Error('INVALID_COMPONENT_PAYLOAD');
 if(type==='frontend_template'){
  const p=payload as Record<string,unknown>;if(p?.kind==='sandbox-app')throw new Error('USE_PRECODED_TEMPLATE');else if(p?.kind==='chart')chartSchema.parse(payload);else if(p?.kind!=='registered')formSchema.parse(payload);else if(!['unit-converter-v1','google-drive-folders-v1','page-view-v1'].includes(String(p.implementation)))throw new Error('UNKNOWN_TEMPLATE');
 }
 if(type==='backend_code'){
  const p=payload as Record<string,unknown>;
  if(p?.kind==='sandbox-program')codeSchema.parse(payload);
  else if(p?.kind==='registered'){if(!['unit-converter-v1','google-drive-folders-v1','page-view-v1'].includes(String(p.implementation)))throw new Error('UNKNOWN_EXECUTOR');}
  else {const inputs=new Set<string>();const visit=(v:unknown)=>{if(v&&typeof v==='object'){if('input'in v&&typeof v.input==='string')inputs.add(v.input);Object.values(v).forEach(visit);}};visit(payload);validateProgram(payload,[...inputs]);}
 }
 if(type==='data')dataReferenceSchema.parse(payload);
 if(type==='api_adapter'){const {externalApiSchema}=await import('./api-discovery');externalApiSchema.parse(payload);}
 if(type==='workflow'){
  const p=payload as {kind?:string;steps?:{name:string;component:ComponentRef}[]};
  if(p?.kind!=='workflow'||!Array.isArray(p.steps)||p.steps.length<1||p.steps.length>12)throw new Error('INVALID_WORKFLOW');
  dependencies=await Promise.all(p.steps.map(async step=>{const component=await getComponent(step.component,context);if(!['backend_code','api_adapter'].includes(component.type))throw new Error('INVALID_WORKFLOW_COMPONENT');return {role:componentTypeSchema.parse(step.name),component};}));
 }
 // Unknown types remain reusable data. Only known validated types can execute.

 if(type==='credential'&&(payload as Record<string,unknown>)?.connectionRef==='google_drive'){
  const p=payload as Record<string,unknown>;if(p.provider!=='google_drive'||Object.keys(p).some(k=>!['provider','connectionRef'].includes(k)))throw new Error('INVALID_CONNECTION_REFERENCE');
 }else if(type==='credential'){
  const p=payload as Record<string,unknown>;
  if(!p||Object.keys(p).some(k=>!['secretRef','provider'].includes(k))||typeof p.secretRef!=='string'||!/^COMPONENT_SECRET_[A-Z0-9_]+$/.test(p.secretRef))throw new Error('INVALID_SECRET_REFERENCE');
  context={...context,visibility:'private'};
 }
 for(const d of dependencies){await getComponent(d.component,context);if(context.visibility==='public'&&d.component.visibility!=='public')throw new Error('PRIVATE_DEPENDENCY');}
 const id=crypto.randomUUID(),now=new Date().toISOString(),vector=await embed(question),scope=context.visibility==='public'?'public':context.ownerId;
 // First writer wins for the exact typed key; no orphan duplicates on concurrent creation.
 await database().batch([
  database().prepare(`INSERT INTO components(id,type,version,owner_id,visibility,language,title,description,payload,created_at) SELECT ?,?,1,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM component_questions WHERE scope=? AND type=? AND language=? AND normalized=?)`).bind(id,type,context.ownerId,context.visibility,context.language,question.slice(0,200),question,JSON.stringify(payload),now,scope,type,context.language,normalize(question)),
  database().prepare(`INSERT OR IGNORE INTO component_questions SELECT ?,id,type,?,language,?,?,?,? FROM components WHERE id=?`).bind(crypto.randomUUID(),scope,question,normalize(question),JSON.stringify(vector),now,id),
  ...dependencies.map(d=>database().prepare('INSERT INTO component_dependencies SELECT id,?,?,? FROM components WHERE id=?').bind(d.role,d.component.id,d.component.version,id)),
 ]);
 const row=await database().prepare(`SELECT c.* FROM component_questions q JOIN components c ON c.id=q.component_id WHERE q.scope=? AND q.type=? AND q.language=? AND q.normalized=?`).bind(scope,type,context.language,normalize(question)).first<Component>();
 if(!row)throw new Error('REGISTRATION_FAILED');return row;
}
export async function attachComponents(pageId:string,refs:{role:string;component:Component}[],context:AgentContext){
 for(const r of refs){await getComponent(r.component,context);if(context.visibility==='public'&&r.component.visibility!=='public')throw new Error('PRIVATE_DEPENDENCY');}
 await database().batch(refs.map(r=>database().prepare('INSERT OR IGNORE INTO component_dependencies(parent_id,role,component_id,version) VALUES(?,?,?,?)').bind(pageId,r.role,r.component.id,r.component.version)));
}

// Native notebook edges are separate from free-text descriptions and searchable aliases.
export async function linkComponents(source:ComponentRef,role:string,target:ComponentRef,context:AgentContext){
 componentTypeSchema.parse(role);
 const from=await getComponent(source,context),to=await getComponent(target,context);
 if(from.owner_id!==context.ownerId)throw new Error('ONLY_COMPONENT_OWNER_CAN_LINK');
 if(source.id===target.id)throw new Error('SELF_LINK');
 if(from.visibility==='public'&&to.visibility==='private'&&to.type!=='credential')throw new Error('PRIVATE_DEPENDENCY');
 await database().prepare('INSERT INTO component_dependencies(parent_id,role,component_id,version) VALUES(?,?,?,?) ON CONFLICT(parent_id,role) DO UPDATE SET component_id=excluded.component_id,version=excluded.version').bind(source.id,role,target.id,target.version).run();
 return {source:{id:from.id,version:from.version},role,target:{id:to.id,version:to.version}};
}
export async function componentLinks(ref:ComponentRef,context:AgentContext){
 await getComponent(ref,context);
 const rows=await database().prepare(`SELECT d.role,c.id,c.version,c.type,c.title FROM component_dependencies d JOIN components c ON c.id=d.component_id AND c.version=d.version WHERE d.parent_id=? AND (c.visibility='public' OR c.owner_id=?) ORDER BY d.role`).bind(ref.id,context.userId).all<{role:string;id:string;version:number;type:string;title:string}>();
 return rows.results;
}
