import type {Queryable} from './client';
// The class tree's researched specifications (scratchpad universe/out + fields/out, merged per class): for each
// class, where its complete member list comes from (lists ordered by authority, expected count, admission rule,
// gaps) and its full field set (metrics and attributes, each with the sources that publish it). Merged into the
// class schema: the universe is replaced by the researched one (old notes kept), fields are united by key (a field
// researched again takes the new label, unit, direction and sources), fields marked for removal are flagged
// deprecated (kept, so data loaded under them stays readable). New metric keys get their public definition.
type Row=Record<string,unknown>;
export type ClassSpec={universe?:{expected?:number;admission?:string;lists?:Row[];gaps?:string;expected_total?:number;union_of?:string[]};
 metrics?:Row[];attributes?:Row[];remove?:(string|Row)[];notes?:string};

const KEY=/^[a-z][a-z0-9_]{0,63}$/;
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
  await db.query(`update entity_types set schema = schema || jsonb_build_object('metrics',$2::jsonb,'attributes',$3::jsonb,'universe',$4::jsonb)
    || case when $5::text<>'' then jsonb_build_object('fieldNotes',$5::text) else '{}'::jsonb end, updated_at=now() where type=$1::text`,
   [key,JSON.stringify(metrics),JSON.stringify(attributes),JSON.stringify(universe),String(s.notes||'').slice(0,4000)]);
 }
 out.newMetricKeys=newMetrics.size;
 if(!dryRun)for(const [k,m] of newMetrics){
  const order=m.order==='asc'?'asc':'desc';
  await db.query(`insert into metrics(key,version,label,unit,description,sort_order,kind,created_by,status,used) values ($1::text,1,$2::text,$3::text,$4::text,$5::text,'observed','class-specs','published',false)
    on conflict do nothing`,[k,String(m.label||k.replace(/_/g,' ')).slice(0,200),String(m.unit||'').slice(0,60),String(m.description||'').slice(0,1000),order]);
 }
 return {...out,unknown:out.unknown.slice(0,50)};
}
