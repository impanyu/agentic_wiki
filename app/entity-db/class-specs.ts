import type {Queryable} from './client';
// The class tree's researched specifications (scratchpad universe/out + fields/out, merged per class): for each
// class, where its complete member list comes from (lists ordered by authority, expected count, admission rule,
// gaps) and its full field set (metrics and attributes, each with the sources that publish it). Merged into the
// class schema: the universe is replaced by the researched one (old notes kept), fields are united by key (a field
// researched again takes the new label, unit, direction and sources), fields marked for removal are flagged
// deprecated (kept, so data loaded under them stays readable). New metric keys get their public definition.
type Row=Record<string,unknown>;
export type NationalSpec={key:string;label:string;country_iso3:string;why?:string;metrics?:Row[];attributes?:Row[]};
export type ClassSpec={national?:NationalSpec[];rankingCriteria?:string[];composites?:Row[];universe?:{expected?:number;admission?:string;lists?:Row[];gaps?:string;expected_total?:number;union_of?:string[]};
 metrics?:Row[];attributes?:Row[];remove?:(string|Row)[];notes?:string};

const KEY=/^[a-z][a-z0-9_]{0,63}$/;
// "US state" → "US states", "UK university" → "UK universities", "School in England" → "Schools in England",
// "US law school (ABA disclosures)" → "US law schools (ABA disclosures)".
export function pluralLabel(label:string):string{
 const m=/^(.*?)(\s*\(.*)?$/.exec(label)!;const head=m[1],tail=m[2]||'';
 const o=/^(.*?)(\s+(?:of|in|for|by|with|under)\s+.*)$/.exec(head);const core=o?o[1]:head,rest=o?o[2]:'';
 const i=core.lastIndexOf(' ');const w=core.slice(i+1);
 const p=/^(equipment|software|series|species|aircraft|apparatus)$/i.test(w)||/[^s]s$/.test(w)?w:/[^aeiou]y$/.test(w)?w.slice(0,-1)+'ies':/(s|x|z|ch|sh)$/.test(w)?w+'es':w+'s';
 return core.slice(0,i+1)+p+rest+tail;
}
const unite=(cur:unknown,next:Row[]):Row[]=>{
 const list=(v:unknown):Row[]=>Array.isArray(v)?v as Row[]:v&&typeof v==='object'?Object.entries(v as Row).map(([key,x])=>({key,...(x as Row)})):[];
 const m=new Map(list(cur).map(x=>[String(x.key),x]));
 for(const x of next){if(!x||!KEY.test(String(x.key)))continue;m.set(String(x.key),{...(m.get(String(x.key))||{}),...x});}
 return [...m.values()];
};
export async function importClassSpecs(db:Queryable,specs:Record<string,ClassSpec>,{dryRun=true}:{dryRun?:boolean}={}){
 const classes=new Map((await db.query<{type:string;schema:Row}>(`select type, schema from entity_types where schema->>'kind'='class'`)).rows.map(r=>[r.type,r.schema||{}]));
 const known=new Set((await db.query<{key:string}>('select distinct key from metrics')).rows.map(r=>r.key));
 const out={classes:0,unknown:[] as string[],metricsDeclared:0,attributesDeclared:0,newMetricKeys:0,deprecated:0};
 const newMetrics=new Map<string,Row>();
 for(const [key,s] of Object.entries(specs)){
  const cur=classes.get(key);if(!cur){out.unknown.push(key);continue;}
  const metrics=unite(cur.metrics,(s.metrics||[]).map(m=>({...m,kind:undefined})));
  const attributes=unite(cur.attributes,s.attributes||[]);
  const removeKeys=new Set((s.remove||[]).map(r=>typeof r==='string'?r.split(/[\s:—(-]/)[0]:String((r as Row).key||'')).filter(k=>KEY.test(k)));
  for(const f of [...metrics,...attributes])if(removeKeys.has(String(f.key))){f.deprecated=true;out.deprecated++;}
  for(const m of s.metrics||[])if(KEY.test(String(m.key))&&!known.has(String(m.key)))newMetrics.set(String(m.key),m);
  const u=s.universe||{};
  const universe={...((cur.universe as Row)||{}),...(u.expected!=null?{expectedCount:u.expected}:{}),...(u.expected_total!=null?{expectedTotal:u.expected_total}:{}),
   ...(u.admission?{admission:u.admission}:{}),...(u.lists?{lists:u.lists}:{}),...(u.gaps?{gaps:u.gaps}:{}),...(u.union_of?{unionOf:u.union_of}:{}),researched:'2026-11-27'};
  out.classes++;out.metricsDeclared+=metrics.length;out.attributesDeclared+=attributes.length;
  if(dryRun)continue;
  // Readers' ranking criteria and the composite indices experts use, for the editors (and page builds).
  if(s.rankingCriteria?.length||s.composites?.length)await db.query(`update entity_types set schema = schema || jsonb_build_object('rankingCriteria',$2::jsonb,'composites',$3::jsonb) where type=$1::text`,
   [key,JSON.stringify(s.rankingCriteria||[]),JSON.stringify(s.composites||[])]);
  await db.query(`update entity_types set schema = schema || jsonb_build_object('metrics',$2::jsonb,'attributes',$3::jsonb,'universe',$4::jsonb)
    || case when $5::text<>'' then jsonb_build_object('fieldNotes',$5::text) else '{}'::jsonb end, updated_at=now() where type=$1::text`,
   [key,JSON.stringify(metrics),JSON.stringify(attributes),JSON.stringify(universe),String(s.notes||'').slice(0,4000)]);
 }
 // National subclasses: a class whose members in one country come from a national statistics system with its own
 // fields gets a subclass for that country (split by country_iso3); the country's members move into it.
 let nationals=0,moved=0;
 for(const [parent,s] of Object.entries(specs))for(const n of s.national||[]){
  if(!classes.has(parent)||!KEY.test(n.key)||!/^[A-Z]{3}$/.test(n.country_iso3||''))continue;
  for(const m of n.metrics||[])if(KEY.test(String(m.key))&&!known.has(String(m.key)))newMetrics.set(String(m.key),m);
  nationals++;if(dryRun)continue;
  const pschema=classes.get(parent)!;
  await db.query(`insert into entity_types(type,label,plural,description,schema,status,updated_by) values ($1::text,$2::text,$3::text,$4::text,$5::jsonb,'published','class-specs')
    on conflict (type) do update set schema = (entity_types.schema - 'retiredInto') || excluded.schema, label=excluded.label, status='published', updated_at=now()`,
   [n.key,n.label,pluralLabel(n.label),n.why||'',JSON.stringify({kind:'class',extends:parent,value:[n.country_iso3],area:pschema.area,metrics:n.metrics||[],attributes:n.attributes||[],universe:{admission:`Members of ${parent} in ${n.country_iso3}.`}})]);
  await db.query(`update entity_types set schema = schema || '{"splitBy":{"key":"country_iso3","label":"country"}}'::jsonb where type=$1::text and coalesce(schema->>'splitBy','null')='null'`,[parent]);
  const r=await db.query<{id:string}>(`update entities set type=$2::text, updated_at=now() where type=$1::text and attributes->>'country_iso3'=$3::text returning id`,[parent,n.key,n.country_iso3]);
  moved+=r.rows.length;
 }
 out.newMetricKeys=newMetrics.size;
 if(!dryRun)for(const [k,m] of newMetrics){
  const order=m.order==='asc'?'asc':'desc';
  await db.query(`insert into metrics(key,version,label,unit,description,sort_order,kind,created_by,status,used) values ($1::text,1,$2::text,$3::text,$4::text,$5::text,'observed','class-specs','published',false)
    on conflict do nothing`,[k,String(m.label||k.replace(/_/g,' ')).slice(0,200),String(m.unit||'').slice(0,60),String(m.description||'').slice(0,1000),order]);
 }
 return {...out,nationals,moved,unknown:out.unknown.slice(0,50)};
}
