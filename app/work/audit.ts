import type {Queryable} from '@/app/entity-db/client';
// The gap between what the class tree asks for and what is collected: for every class with members (or a page), the
// declared measures and attributes (its own and inherited) against how many members have each.
type Row=Record<string,unknown>;
export async function classGaps(db:Queryable,{limit=4000}:{limit?:number}={}):Promise<Row[]>{
 const {effectiveType}=await import('@/app/entity-db/inherit');
 const classes=(await db.query<{type:string;n:number;page:boolean}>(`select et.type, (select count(*)::int from entities e where e.type=et.type) n, (et.topic_id is not null) page
  from entity_types et where et.schema->>'kind'='class' order by 2 desc limit $1::int`,[limit])).rows.filter(c=>c.n>0||c.page);
 const out:Row[]=[];
 for(const c of classes){
  const eff=await effectiveType(db,c.type).catch(()=>null);const s=(eff?.schema||{}) as Row;
  const metrics=(Array.isArray(s.metrics)?s.metrics:[]).map(m=>String((m as Row).key)).filter(Boolean);
  const attrs=(Array.isArray(s.attributes)?s.attributes:[]).map(a=>String((a as Row).key)).filter(Boolean);
  const have=c.n?new Map((await db.query<{metric:string;n:number}>(`select o.metric, count(distinct o.entity_id)::int n from observations o join entities e on e.id=o.entity_id where e.type=$1 group by 1`,[c.type])).rows.map(r=>[r.metric,r.n])):new Map<string,number>();
  const haveA=c.n?new Map((await db.query<{k:string;n:number}>(`select k, count(*)::int n from entities e, jsonb_object_keys(e.attributes) k where e.type=$1 group by 1`,[c.type])).rows.map(r=>[r.k,r.n])):new Map<string,number>();
  const cov=(m:Map<string,number>,k:string)=>c.n?Math.round(100*(m.get(k)||0)/c.n):0;
  const mGood=metrics.filter(k=>cov(have,k)>=60).length,aGood=attrs.filter(k=>cov(haveA,k)>=60).length;
  out.push({class:c.type,members:c.n,page:c.page,metrics:metrics.length,metricsCovered:mGood,attributes:attrs.length,attributesCovered:aGood,
   missingMetrics:metrics.filter(k=>cov(have,k)<60).slice(0,40),missingAttributes:attrs.filter(k=>cov(haveA,k)<60).slice(0,40)});
 }
 return out;
}
