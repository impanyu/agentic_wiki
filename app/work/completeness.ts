import type {Queryable} from '@/app/entity-db/client';
// The two dimensions of a class's completeness, each checked by program:
//  - rows: every entity that belongs to the class is collected. A member list is trusted only when at least two
//    independent lists (registries, official directories, rosters, Wikidata…) have been checked against it and each
//    is ≥ 90% matched (schema.universe.checks, written by record_universe_check);
//  - columns: the class declares what exists about its entities (an expert's list: at least 15 measures and 30
//    fields in all, with inherited ones), each measure with its source, and most declared measures are collected.
type Row=Record<string,unknown>;
export type UniverseCheck={source:string;url:string;listed:number;matched:number;missingSample:string;at:string;by:string};
export const MIN_LISTS=Number(process.env.UNIVERSE_MIN_LISTS||2),MIN_MATCH=Number(process.env.UNIVERSE_MIN_MATCH||0.9);
export const MIN_METRICS=15,MIN_FIELDS=30;

export async function recordUniverseCheck(db:Queryable,a:{type:string;source:string;url:string;listed:number;matched:number;missingSample:string;by:string}){
 if(!a.source.trim())throw Error('source: the name of the independent list.');
 if(!(a.listed>0))throw Error('listed: how many entities the list has (more than 0).');
 if(a.matched<0||a.matched>a.listed)throw Error('matched: between 0 and listed.');
 const et=(await db.query<{schema:Row}>('select schema from entity_types where type=$1::text',[a.type])).rows[0];if(!et)throw Error('No class '+a.type+'.');
 const u=(et.schema?.universe&&typeof et.schema.universe==='object'?et.schema.universe:{}) as Row;
 const check:UniverseCheck={source:a.source.trim().slice(0,200),url:a.url.slice(0,500),listed:Math.round(a.listed),matched:Math.round(a.matched),missingSample:a.missingSample.slice(0,1500),at:new Date().toISOString(),by:a.by};
 // The latest check per source, at most 12 sources.
 const checks=[check,...((Array.isArray(u.checks)?u.checks:[]) as UniverseCheck[]).filter(c=>c.source.toLowerCase()!==check.source.toLowerCase())].slice(0,12);
 await db.query(`update entity_types set schema=jsonb_set(coalesce(schema,'{}'::jsonb),'{universe}',coalesce(schema->'universe','{}'::jsonb)||jsonb_build_object('checks',$2::jsonb)) where type=$1::text`,[a.type,JSON.stringify(checks)]);
 const v=await universeVerdict(db,a.type);
 return {recorded:check,...v};
}
// Rows: what is still missing for the member list to count as complete (undefined when it is).
export async function universeVerdict(db:Queryable,type:string):Promise<{complete:boolean;problem?:string;checks:UniverseCheck[]}>{
 const s=(await db.query<{schema:Row}>('select schema from entity_types where type=$1::text',[type])).rows[0]?.schema||{};
 const u=(s.universe&&typeof s.universe==='object'?s.universe:{}) as Row;
 const recent=((Array.isArray(u.checks)?u.checks:[]) as UniverseCheck[]).filter(c=>Date.parse(c.at)>Date.now()-180*86400_000);
 const good=recent.filter(c=>c.listed>0&&c.matched/c.listed>=MIN_MATCH);
 if(good.length>=MIN_LISTS)return {complete:true,checks:recent};
 const weak=recent.filter(c=>!good.includes(c)).map(c=>`${c.source}: ${c.matched} of ${c.listed} (${Math.round(100*c.matched/c.listed)}%)`);
 return {complete:false,checks:recent,problem:`The member list is confirmed by ${good.length} independent list(s) of the ${MIN_LISTS} needed (each matched ≥ ${Math.round(MIN_MATCH*100)}%).`+(weak.length?' Not yet matched: '+weak.join('; ')+'.':'')+' Check the class against independent lists (official registries and directories, federations, Wikidata, industry databases), load the members they have and you lack, and record each check (record_universe_check).'};
}
// Columns: the class's declared specification (with inherited fields) and how many of its own measures name a source.
export async function specVerdict(db:Queryable,type:string):Promise<{complete:boolean;problem?:string;metrics:number;fields:number}>{
 const {effectiveType}=await import('@/app/entity-db/inherit');const eff=await effectiveType(db,type).catch(()=>null);
 const sc=(eff?.schema||{}) as Row;
 const metrics=Array.isArray(sc.metrics)?sc.metrics as Row[]:[];const attrs=Array.isArray(sc.attributes)?sc.attributes as Row[]:[];
 const own=((await db.query<{schema:Row}>('select schema from entity_types where type=$1::text',[type])).rows[0]?.schema?.metrics) as Row[]|undefined;
 const unsourced=(own||[]).filter(m=>!String(m.source||'').trim()).map(m=>String(m.key));
 const problems:string[]=[];
 if(metrics.length<MIN_METRICS)problems.push(`it declares ${metrics.length} measures (at least ${MIN_METRICS})`);
 if(metrics.length+attrs.length<MIN_FIELDS)problems.push(`it declares ${metrics.length+attrs.length} fields in all (at least ${MIN_FIELDS})`);
 if(unsourced.length>Math.max(2,(own||[]).length*0.2))problems.push(`${unsourced.length} of its measures name no source (${unsourced.slice(0,10).join(', ')})`);
 return problems.length?{complete:false,metrics:metrics.length,fields:metrics.length+attrs.length,problem:'The class specification is not complete: '+problems.join('; ')+'. Research what exists about these entities (experts\' and buyers\' lists, the data dictionaries of every source) and declare it with set_entity_schema, each measure with its source.'}
  :{complete:true,metrics:metrics.length,fields:metrics.length+attrs.length};
}
