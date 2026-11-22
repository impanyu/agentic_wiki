// The address tree of sets, top level down (built in app/entity-db/pages.ts pathMaps) —
//   /geography                                  a broad topic: a directory of its children
//   /geography/countries                        a topic and its main ranking (?rank=<criterion>&year=<y>)
//   /geography/countries/europe-central-asia    a subset: a ranking of the countries in that region
// Entities are outside the tree, at /e/<num>/<slug> (the tree may deepen; an entity's address never changes).
// Page data is built with the stable internal forms (/topics/<slug>, /rankings/<slug>);
// canonicalLinks maps them to these addresses at render time, so moving a topic in the tree moves its pages
// without touching stored data (the old address then redirects; see resolvePath in app/entity-db/pages.ts).
export type PathMaps={topics:Map<string,string>;rankings:Map<string,string>;types:Map<string,string>};
export {RESERVED_SEGMENTS} from '@/app/entity-db/reserved';
const enc=encodeURIComponent;
// One internal page address → its address in the tree (unchanged when its node is unknown).
export function canonicalPath(href:string,maps:PathMaps):string{
 const q=href.search(/[?#]/),path=q<0?href:href.slice(0,q),rest=q<0?'':href.slice(q);
 let m=/^\/topics\/([^/]+)$/.exec(path);
 if(m){const t=maps.topics.get(decodeURIComponent(m[1]));return t?t+rest:href;}
 m=/^\/rankings\/([^/]+)$/.exec(path);
 if(m){const t=maps.rankings.get(decodeURIComponent(m[1]));return t?t+rest:href;}
 return href;
}
const INTERNAL=/^\/(?:topics\/[^/?#]+|rankings\/[^/?#]+)(?:[?#].*)?$/;
export function canonicalLinks<T>(value:T,maps:PathMaps):T{
 const walk=(v:unknown):unknown=>{
  if(typeof v==='string')return INTERNAL.test(v)?canonicalPath(v,maps):v;
  if(Array.isArray(v))return v.map(walk);
  if(v&&typeof v==='object'&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)){
   const o:Record<string,unknown>={};for(const [k,x] of Object.entries(v))o[k]=walk(x);return o;
  }
  return v;
 };
 return walk(value) as T;
}
// The topic paths of the whole tree: slug → "/root/…/slug".
export function topicPaths(topics:{id:string;parentId:string|null;slug:string}[]):Map<string,string>{
 const byId=new Map(topics.map(t=>[t.id,t]));const out=new Map<string,string>();
 const pathOf=(t:{id:string;parentId:string|null;slug:string},seen=new Set<string>()):string=>{
  if(out.has(t.slug))return out.get(t.slug)!;
  const parent=t.parentId&&!seen.has(t.parentId)?byId.get(t.parentId):undefined;seen.add(t.id);
  const p=(parent?pathOf(parent,seen):'')+'/'+enc(t.slug);out.set(t.slug,p);return p;
 };
 for(const t of topics)pathOf(t);
 return out;
}
