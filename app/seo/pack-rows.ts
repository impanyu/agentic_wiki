// Compact form of a ranking's long rows (one row per entity and period) for the page: the fields an entity keeps
// in every period are sent once per entity, the changing ones as arrays. 217 countries × 60 years shrink from
// ~8 MB to well under 1 MB; the browser expands them back before the ranking component sees them.
type Row=Record<string,unknown>;
export type PackedRows={packed:1;keys:string[];entities:Row[];data:unknown[][]};
const round=(v:unknown)=>typeof v==='number'&&!Number.isInteger(v)?Number(v.toPrecision(7)):v;
// exact keeps every number as is (stored copies); the page's copy rounds to 7 significant digits.
export function packRows(rows:Row[],idKey='entity_id',{exact=false}:{exact?:boolean}={}):PackedRows{
 const groups=new Map<string,Row[]>();
 for(const r of rows){const id=String(r[idKey]??r.name??'');const g=groups.get(id);if(g)g.push(r);else groups.set(id,[r]);}
 // A field varies when any entity has two different values (or it is missing in some rows) for it.
 const all=new Set<string>();for(const r of rows)for(const k of Object.keys(r))all.add(k);
 const varying=new Set<string>();
 for(const g of groups.values())if(g.length>1)for(const k of all){if(varying.has(k))continue;const v0=JSON.stringify(g[0][k]);if(g.some(r=>JSON.stringify(r[k])!==v0))varying.add(k);}
 const keys=[...varying];const entities:Row[]=[];const data:unknown[][]=[];
 for(const g of groups.values()){
  const e:Row={};for(const k of all)if(!varying.has(k)&&g[0][k]!==undefined)e[k]=g[0][k];
  const ei=entities.push(e)-1;
  for(const r of g)data.push([ei,...keys.map(k=>r[k]===undefined?null:exact?r[k]:round(r[k]))]);
 }
 return {packed:1,keys,entities,data};
}
export function unpackRows(p:PackedRows):Row[]{
 return p.data.map(([ei,...vals])=>{const r:Row={...p.entities[ei as number]};p.keys.forEach((k,i)=>{if(vals[i]!==null)r[k]=vals[i];});return r;});
}
export const isPacked=(v:unknown):v is PackedRows=>!!v&&typeof v==='object'&&(v as PackedRows).packed===1;
