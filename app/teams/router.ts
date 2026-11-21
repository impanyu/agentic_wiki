import {entityDb} from '@/app/entity-db/client';
import {getEntity,nearestTopics,createTopic,getTopic,addInbox,listMetrics} from '@/app/entity-db/repo';
import {slugify} from '@/app/seo/urls';
import {listRankingDefs,getEntityType,type RankingDef} from './config';
import {topicEditorId} from './tools';
// The router's database step (public edition), after no saved page matched: a published ranking or an
// entity of a type with a template answers the query; otherwise the answer is honestly "not yet" and the
// query goes to the inbox of the closest topic's editor (or the general topic), who decides in the next
// planning pass whether to cover it. Nothing is generated on the fly.

const STOP=new Set(['the','a','an','of','in','by','and','for','to','on','with','list','ranking','rankings','rank','ranked','top','best','largest','biggest','most','highest','lowest','all','every','which','what','is','are','how','many','per']);
const stem=(w:string)=>w.replace(/ies$/,'y').replace(/(ches|shes|sses|xes)$/,m=>m.slice(0,-2)).replace(/([^s])s$/,'$1');
const words=(s:string)=>String(s||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').split(/[^a-z0-9一-鿿]+/).filter(w=>w&&!STOP.has(w)).map(stem);

// The best published ranking for a query, and the criterion it names: every word of the ranking's scope
// (its title without "Rankings") must appear in the query; criteria are matched by their metric labels.
async function matchRanking(query:string):Promise<{def:RankingDef;rank?:string}|null>{
 const db=await entityDb(),q=new Set(words(query));if(!q.size)return null;
 const defs=(await listRankingDefs(db)).filter(d=>d.status==='published');
 const metrics=new Map((await listMetrics(db,{})).map(m=>[m.key,m.label]));
 let best:{def:RankingDef;score:number;rank?:string}|null=null;
 for(const def of defs){
  const type=def.scope.type?await getEntityType(db,def.scope.type):null;
  const scope=words(def.title);if(!scope.length)continue;
  const names=new Set([...scope,...words(type?.plural||''),...words(type?.label||''),...words(def.scope.type||'')]);
  const core=scope.filter(w=>!q.has(w));
  // The title's scope words must all be in the query (a type's label/plural counts for its own noun).
  if(core.length&&!core.every(w=>[...names].some(n=>q.has(n)&&(n===w||stem(n)===stem(w)))))continue;
  const criterion=def.criteria.map(k=>({k,w:words(metrics.get(k)||k.replace(/_/g,' '))})).filter(x=>x.w.length&&x.w.every(w=>q.has(w))).sort((a,b)=>b.w.length-a.w.length)[0];
  const score=scope.filter(w=>q.has(w)).length*2+(criterion?criterion.w.length:0)-Object.keys(def.scope.filters||{}).length*(core.length?1:0);
  if(!best||score>best.score)best={def,score,rank:criterion?.k};
 }
 return best?{def:best.def,rank:best.rank}:null;
}
// An entity named by the query ("France", "France (country)", "iso3:FRA", "Q142") whose type has a page template.
async function matchEntity(query:string):Promise<{type:string;name:string}|null>{
 const db=await entityDb();const m=/^(.*?)\s*\(([^)]+)\)\s*$/.exec(query.trim());
 const name=(m?m[1]:query).trim(),typeHint=m?m[2].trim().toLowerCase().replace(/\s+/g,'_'):undefined;
 if(!name||name.length>200)return null;
 const e=await getEntity(db,name,typeHint).catch(()=>null)??(typeHint?await getEntity(db,name).catch(()=>null):null);
 if(!e)return null;
 const t=await getEntityType(db,e.type);if(!t||!Object.keys(t.template||{}).length)return null;
 return {type:e.type,name:e.name};
}
export type RouteResult={href:string}|{unavailable:true;message:string};
export async function routeToDatabase(query:string,language:string):Promise<RouteResult>{
 const q=String(query||'').trim().slice(0,500);
 const ranking=await matchRanking(q).catch(()=>null);
 if(ranking)return {href:'/rankings/'+ranking.def.slug+(ranking.rank&&ranking.rank!==(ranking.def.config.default||ranking.def.criteria[0])?'?rank='+encodeURIComponent(ranking.rank):'')};
 const entity=await matchEntity(q).catch(()=>null);
 if(entity)return {href:'/e/'+encodeURIComponent(entity.type)+'/'+encodeURIComponent(slugify(entity.name))};
 // Not covered yet: hand the query to the closest topic's editor (the general topic when none fits).
 const db=await entityDb();
 const topic=(await nearestTopics(db,q,1).catch(()=>[]))[0]??await getTopic(db,'general')??await createTopic(db,{slug:'general',name:'General',description:'Queries no topic covers yet; the router reassigns them as topics are created.'});
 const editorId=await topicEditorId(db,topic.id);
 if(editorId)await addInbox(db,{editorId,query:q,language});
 return {unavailable:true,message:`RankWiki has no page for “${q}” yet. We only publish pages built from verified data, so nothing is made up on the spot — your question has been passed to the ${topic.name} editors, who plan which entities and rankings to add next.`};
}
