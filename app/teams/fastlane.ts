import type {EntityDb} from '@/app/entity-db/client';
// Fast lane: a topic gets a first ranking and entity pages within minutes, from Wikidata, before its team's full
// workflow has run. One model call maps the topic to Wikidata classes and numeric properties (reusing the measures the
// type's schema already defines); programs query the top entities by the main measure (SI-normalised values, one
// unit per measure), their other measures, Wikipedia article, picture and homepage, load them and publish the
// ranking. A topic whose query finds too few entities is left to its team. The team deepens every topic later
// (better sources, more measures, sub-rankings, indices).
const UA='RankWiki/1.0 (https://rankwiki.aisoup.net; fast lane)';
const SPARQL='https://query.wikidata.org/sparql';
const MIN_ENTITIES=15,TOP=1000;
type Metric={prop:string;key:string;label:string;order:'asc'|'desc'};
type Plan={ok:boolean;reason:string;classes:string[];filters:{prop:string;value:string}[];title:string;typeLabel:string;plural:string;metrics:Metric[];anchors:{name:string;value:number}[]};
type Topic={id:string;slug:string;name:string;description:string;scope:Record<string,unknown>;trail:string};

async function sparql(query:string,signal:AbortSignal):Promise<Record<string,{value:string;type:string}>[]>{
 const r=await fetch(SPARQL,{method:'POST',headers:{'user-agent':UA,accept:'application/sparql-results+json','content-type':'application/x-www-form-urlencoded'},body:'query='+encodeURIComponent(query),signal});
 if(!r.ok)throw Error('Wikidata query failed: HTTP '+r.status);
 return ((await r.json()) as {results:{bindings:Record<string,{value:string;type:string}>[]}}).results.bindings;
}
const qid=(uri:string)=>uri.replace(/^.*\//,'');
const PID=/^P\d+$/,QID=/^Q\d+$/;
// Unit items → the unit strings the platform understands (units.ts normalises them further).
const UNITS:Record<string,string>={Q199:'',Q11573:'m',Q828224:'km',Q25343:'m2',Q712226:'km2',Q11570:'kg',Q191118:'t',Q11574:'s',Q11579:'K',Q25517:'m3',
 Q4917:'USD',Q794261:'m3/s',Q3332095:'m3/s',Q4916:'EUR',Q25224:'GBP',Q8146:'JPY',Q39099:'CNY',Q80524:'INR',Q11573000:'m',Q25269:'W',Q25236:'W',Q6574:'MW',Q25406:'J',Q11582:'L',Q182098:'kWh',Q3332822:'m/s',Q180154:'km/h',Q11229:'%',Q174728:'cm',Q11577:'mm'};

// The measure's name is Wikidata's own label of the property (never the model's), so a value can never be shown
// under a wrong name; the key follows from it (P2196 "students count" → students_count).
async function propertyLabels(props:string[],signal:AbortSignal):Promise<Map<string,string>>{
 const r=await fetch('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids='+props.join('|'),{headers:{'user-agent':UA},signal});
 const d=await r.json() as {entities?:Record<string,{labels?:{en?:{value:string}}}>};
 return new Map(Object.entries(d.entities||{}).map(([k,v])=>[k,v.labels?.en?.value||'']).filter(([,v])=>v) as [string,string][]);
}
async function plan(t:Topic,schemaMetrics:{key:string;label:string;unit?:string}[]):Promise<Plan>{
 const {respond}=await import('@/app/llm');
 const schema={type:'object',additionalProperties:false,required:['ok','reason','classes','filters','title','typeLabel','plural','metrics','anchors'],properties:{
  anchors:{type:'array',items:{type:'object',additionalProperties:false,required:['name','value'],properties:{name:{type:'string'},value:{type:'number'}}}},
  ok:{type:'boolean'},reason:{type:'string'},classes:{type:'array',items:{type:'string'}},
  filters:{type:'array',items:{type:'object',additionalProperties:false,required:['prop','value'],properties:{prop:{type:'string'},value:{type:'string'}}}},
  title:{type:'string'},typeLabel:{type:'string'},plural:{type:'string'},
  metrics:{type:'array',items:{type:'object',additionalProperties:false,required:['prop','key','label','order'],properties:{prop:{type:'string'},key:{type:'string'},label:{type:'string'},order:{type:'string',enum:['asc','desc']}}}}}};
 const r=await respond({class:'instant',store:false,max_output_tokens:2000,text:{format:{type:'json_schema',name:'wikidata_plan',schema,strict:true}},
  instructions:`You map a ranking topic of RankWiki to Wikidata so a program can rank its entities. Give:
- classes: 1–3 Wikidata class QIDs whose direct instances (P31) are exactly this topic's entities (e.g. mountain Q8502, sovereign state Q3624078, city Q515, airport Q1248784, film Q11424, human Q5 only with a filter). Use only QIDs and PIDs you are sure of; the program reads each property's own Wikidata label as the measure's name.
- filters: extra required statements narrowing the set, e.g. {"prop":"P17","value":"Q30"} for one country, {"prop":"P106","value":"Q937857"} for footballers among humans. Empty when none.
- metrics: 1–8 Wikidata properties holding numbers that rank these entities, the most telling first (it decides who is listed): quantities such as elevation P2044, length P2043, area P2046, population P1082, height P2048, mass P2067, revenue P2139, employees P1128, students P2196, box office P2142, capacity P1083, speed P2052. key and label: any (the program replaces them with the property's Wikidata label); order: desc when more is better or more notable, asc when less ranks first.
- title: the ranking's title (e.g. "Highest mountains", "Largest airports by passengers"); typeLabel and plural: the entity kind ("mountain", "mountains").
- anchors: 3–5 of the best-known leaders of this ranking by the first metric, with their approximate true value in the property's SI unit (metres, square metres, kilograms, people, USD…) — e.g. for metro areas Tokyo 37000000, Delhi 33000000, Shanghai 29000000. The program checks that each is in the results with about this value; a missing leader or a value off by more than half means the class is incomplete or the data is in a wrong unit, and the topic is left to its team.
- ok=false with a reason when Wikidata cannot rank this topic (no class with numeric data, abstract or local services, products without data).`,
  input:JSON.stringify({topic:t.name,description:t.description,path:t.trail,type:t.scope.type??null,measures:schemaMetrics.slice(0,40)})} as never);
 const text=(r.output||[]).flatMap((o:any)=>'content' in o&&Array.isArray(o.content)?o.content:[]).map((c:{type?:string;text?:string})=>c.type==='output_text'?c.text||'':'').join('');
 const p=JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,'')||'{}') as Plan;
 p.classes=(p.classes||[]).filter(c=>QID.test(c)).slice(0,3);
 p.filters=(p.filters||[]).filter(f=>PID.test(f.prop)&&QID.test(f.value)).slice(0,3);
 p.metrics=(p.metrics||[]).filter(m=>PID.test(m.prop)&&/^[a-z][a-z0-9_]{1,60}$/.test(m.key)).slice(0,8);
 p.anchors=(p.anchors||[]).filter(a=>a.name&&Number.isFinite(a.value)&&a.value>0).slice(0,5);
 return p;
}
type Val={v:number;unit:string;year:string};
// One measure's values for some items (or, with no items, the top of the classes): SI-normalised where Wikidata can,
// deprecated statements dropped, one value per item (the latest dated, else the largest), only the dominant unit.
async function values(p:Plan,m:Metric,items:string[]|null,signal:AbortSignal):Promise<Map<string,Val>>{
 const scope=items?`VALUES ?item { ${items.map(i=>'wd:'+i).join(' ')} }`
  :`VALUES ?class { ${p.classes.map(c=>'wd:'+c).join(' ')} } ?item wdt:P31 ?class . ${p.filters.map(f=>`?item wdt:${f.prop} wd:${f.value} .`).join(' ')}`;
 const q=`SELECT ?item ?a ?u ?n ?nu ?t ?pref WHERE { ${scope}
  ?item p:${m.prop} ?st . ?st psv:${m.prop} ?v . ?v wikibase:quantityAmount ?a . OPTIONAL { ?v wikibase:quantityUnit ?u }
  OPTIONAL { ?st psn:${m.prop} ?nv . ?nv wikibase:quantityAmount ?n ; wikibase:quantityUnit ?nu }
  OPTIONAL { ?st pq:P585 ?t } ?st wikibase:rank ?rk . FILTER(?rk != wikibase:DeprecatedRank) BIND(?rk = wikibase:PreferredRank AS ?pref) }
  ${items?'':`ORDER BY ${m.order==='asc'?'ASC':'DESC'}(COALESCE(?n, ?a)) LIMIT ${TOP*3}`}`;
 const rows=await sparql(q,signal);
 // Several statements for one entity: the one Wikidata marks preferred, else the latest dated one; undated values
 // that disagree by more than 3× (a wrong unit or a typo in one of them) leave the entity without this value.
 const all=new Map<string,(Val&{pref:boolean})[]>();
 for(const b of rows){
  const id=qid(b.item.value),n=b.n?Number(b.n.value):NaN,a=Number(b.a.value);
  const v=Number.isFinite(n)?n:a;if(!Number.isFinite(v))continue;
  const u=qid((Number.isFinite(n)?b.nu?.value:b.u?.value)||'Q199');const year=/^\d{4}/.test(b.t?.value||'')?b.t!.value.slice(0,4):'';
  const list=all.get(id)??[];list.push({v,unit:u,year,pref:b.pref?.value==='true'});all.set(id,list);
 }
 const out=new Map<string,Val>();const unitCount=new Map<string,number>();
 for(const [id,list] of all){
  const pref=list.filter(x=>x.pref),pool=pref.length?pref:list;
  const dated=pool.filter(x=>x.year).sort((a,b)=>b.year.localeCompare(a.year));
  if(dated.length){out.set(id,dated[0]);continue;}
  const vs=pool.map(x=>Math.abs(x.v)).filter(x=>x>0);
  if(vs.length>1&&Math.max(...vs)/Math.min(...vs)>3)continue;
  out.set(id,pool.reduce((m,x)=>x.v>m.v?x:m));
 }
 for(const x of out.values())unitCount.set(x.unit,(unitCount.get(x.unit)||0)+1);
 const top=[...unitCount].sort((a,b)=>b[1]-a[1])[0]?.[0];
 for(const [k,x] of out)if(x.unit!==top)out.delete(k);
 return out;
}
async function details(items:string[],signal:AbortSignal){
 const q=`SELECT ?item ?label ?alt ?article ?image ?site WHERE { VALUES ?item { ${items.map(i=>'wd:'+i).join(' ')} }
  ?item rdfs:label ?label . FILTER(lang(?label)='en') OPTIONAL { ?item skos:altLabel ?alt . FILTER(lang(?alt)='en') }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
  OPTIONAL { ?item wdt:P18 ?image } OPTIONAL { ?item wdt:P856 ?site } }`;
 const out=new Map<string,{name:string;aliases:string[];wikipedia?:string;image?:string;website?:string}>();
 for(const b of await sparql(q,signal)){const id=qid(b.item.value);const cur=out.get(id)??{name:b.label.value,aliases:[]};
  if(b.alt&&!cur.aliases.includes(b.alt.value)&&cur.aliases.length<20)cur.aliases.push(b.alt.value);
  if(b.article&&!cur.wikipedia)cur.wikipedia=b.article.value;
  if(b.image&&!cur.image)cur.image='https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(decodeURIComponent(qid(b.image.value)))+'?width=400';
  if(b.site&&!cur.website)cur.website=b.site.value;out.set(id,cur);}
 return out;
}

export async function fastLaneTopic(db:EntityDb,t:Topic):Promise<{ok:boolean;reason:string;entities?:number;ranking?:string}>{
 const signal=AbortSignal.timeout(240_000);
 const type0=typeof t.scope.type==='string'?String(t.scope.type):'';
 const schemaMetrics=type0?(await db.query<{schema:Record<string,unknown>}>('select schema from entity_types where type=$1::text',[type0])).rows[0]?.schema?.metrics as {key:string;label:string;unit?:string}[]|undefined:undefined;
 const p=await plan(t,Array.isArray(schemaMetrics)?schemaMetrics.map(m=>({key:m.key,label:m.label,unit:m.unit})):[]);
 if(!p.ok||!p.classes.length||!p.metrics.length)return {ok:false,reason:p.reason||'no Wikidata class or measure'};
 const labels=await propertyLabels([...new Set(p.metrics.map(m=>m.prop))],signal);
 const seen=new Set<string>();
 p.metrics=p.metrics.filter(m=>labels.has(m.prop)).map(m=>{const l=labels.get(m.prop)!;return {...m,label:l.charAt(0).toUpperCase()+l.slice(1),key:l.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,60)};})
  .filter(m=>m.key&&!seen.has(m.key)&&(seen.add(m.key),true));
 if(!p.metrics.length)return {ok:false,reason:'the planned properties do not exist on Wikidata'};
 const main=p.metrics[0];
 const mainVals=await values(p,main,null,signal);
 const ranked=[...mainVals].sort((a,b)=>main.order==='asc'?a[1].v-b[1].v:b[1].v-a[1].v).slice(0,TOP);
 if(ranked.length<MIN_ENTITIES)return {ok:false,reason:`only ${ranked.length} entities with ${main.label} on Wikidata`};
 const items=ranked.map(([id])=>id);
 // Anchors: the well-known leaders must be among the results with about their true value — else the class is
 // incomplete (a "world" list without its leaders) or the values are in a wrong unit; the team builds it instead.
 if(p.anchors.length<3)return {ok:false,reason:'no anchors to validate the result against'};
 {const top=await details(items.slice(0,Math.min(items.length,300)),signal);
  const norm=(x:string)=>x.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const lev=(a:string,b:string)=>{if(Math.abs(a.length-b.length)>2)return 9;const d=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=d[0];d[0]=i;for(let j=1;j<=b.length;j++){const t=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=t;}}return d[b.length];};
  const names:[string,number][]=[];for(const [id,d] of top){const v=mainVals.get(id)?.v;if(v==null)continue;for(const n of [d.name,...d.aliases])names.push([norm(n),v]);}
  const find=(a:string)=>{const k=norm(a);return names.find(([n])=>n===k)??names.find(([n])=>n.startsWith(k+' ')||k.startsWith(n+' '))??(k.length>=6?names.find(([n])=>lev(n,k)<=2):undefined);};
  // A value matches when it is within a factor of 2 of the anchor, allowing the model's unit to differ by a power of
  // 1000 (m vs km, m² vs km²) — but not by 100 (hectares read as km²) or 10.
  const fits=(v:number,a:number)=>[1,1e3,1e6,1e-3,1e-6].some(f=>{const x=v/(a*f);return x>0.5&&x<2;});
  let found=0;const anchorValues:number[]=[];
  for(const a of p.anchors){const hit=find(a.name);if(!hit)continue;found++;anchorValues.push(hit[1]);
   if(!fits(hit[1],a.value))return {ok:false,reason:`anchor "${a.name}" has ${hit[1]} on Wikidata, expected about ${a.value}: wrong unit or wrong data`};}
  if(found<Math.max(2,Math.ceil(p.anchors.length/2)))return {ok:false,reason:`only ${found} of ${p.anchors.length} well-known leaders (${p.anchors.map(a=>a.name).join(', ')}) are among the results: the Wikidata class looks incomplete`};
  // The anchors are the true leaders: an entity far beyond them (a proposed tower of 4,000 m, a height in feet read as
  // metres) is not a real leader but bad data, and is left out.
  const best=main.order==='asc'?Math.min(...anchorValues):Math.max(...anchorValues);
  const dropped=items.filter(id=>{const v=mainVals.get(id)!.v;return main.order==='asc'?v<best/1.5:v>best*1.5;});
  if(dropped.length>items.length*0.2)return {ok:false,reason:`${dropped.length} entities lie far beyond the known leaders: the data looks unreliable`};
  for(const id of dropped){items.splice(items.indexOf(id),1);mainVals.delete(id);}
 }
 const per=new Map<string,Map<string,Val>>([[main.key,mainVals]]);
 for(const m of p.metrics.slice(1)){
  const vals=new Map<string,Val>();
  for(let i=0;i<items.length;i+=250){const part=await values(p,m,items.slice(i,i+250),signal).catch(()=>new Map<string,Val>());for(const [k,v] of part)vals.set(k,v);}
  // A measure that few of these entities have does not rank them.
  if(vals.size>=Math.max(MIN_ENTITIES,items.length*0.3))per.set(m.key,vals);
 }
 const info=new Map<string,{name:string;aliases:string[];wikipedia?:string;image?:string;website?:string}>();
 for(let i=0;i<items.length;i+=250){for(const [k,v] of await details(items.slice(i,i+250),signal))info.set(k,v);}
 const metrics=p.metrics.filter(m=>per.has(m.key));
 // One unit per measure across every kind of entity (a measure's key is shared): length and width (P2043, P2049)
 // always in kilometres, heights and elevations in metres, areas in square kilometres.
 const KM_PROPS=new Set(['P2043','P2049']);
 const longLength=new Set(metrics.filter(m=>KM_PROPS.has(m.prop)&&UNITS[(per.get(m.key)?.values().next().value as Val|undefined)?.unit||'']==='m').map(m=>m.key));
 const unitOf=(k:string)=>{const v=per.get(k)!.values().next().value as Val|undefined;const u=v?(UNITS[v.unit]??''):'';return u==='m2'?'km2':longLength.has(k)?'km':u;};
 // Areas read in square metres are shown in square kilometres.
 for(const [k,vals] of per){const v=vals.values().next().value as Val|undefined;if(v&&UNITS[v.unit]==='m2')for(const x of vals.values())x.v=x.v/1e6;else if(longLength.has(k))for(const x of vals.values())x.v=x.v/1000;}
 const year=String(new Date().getUTCFullYear());
 const rows=items.filter(id=>info.has(id)&&!/^Q\d+$/.test(info.get(id)!.name)).map(id=>{const d=info.get(id)!;const row:Record<string,unknown>={name:d.name,wikidata:id,...(d.wikipedia?{wikipedia:d.wikipedia}:{}),...(d.website?{website:d.website}:{}),...(d.image?{image:d.image}:{})};
  for(const m of metrics){const v=per.get(m.key)!.get(id);if(v){row['m_'+m.key]=v.v;row['p_'+m.key]=v.year||year;}}return row;});
 if(rows.length<MIN_ENTITIES)return {ok:false,reason:'too few entities with English names'};
 // The kind of entity: the topic's own (schema seed) or the plan's.
 const {normalizeType}=await import('@/app/entity-db/repo');
 const type=normalizeType(type0||p.typeLabel||t.slug);
 await db.query(`insert into entity_types(type,topic_id,label,plural,schema,template,status,updated_by) values ($1::text,$2::uuid,$3::text,$4::text,'{}'::jsonb,'{}'::jsonb,'published','fastlane')
  on conflict (type) do update set topic_id=coalesce(entity_types.topic_id,excluded.topic_id), status='published', label=case when entity_types.label='' then excluded.label else entity_types.label end, plural=case when entity_types.plural='' then excluded.plural else entity_types.plural end`,[type,t.id,p.typeLabel||type,p.plural||'']);
 // An entity page needs a template; until the editor designs one, the default (built from the measures) is used.
 await db.query(`update entity_types set template='{"page":{"minMetrics":1},"auto":"fastlane"}'::jsonb where type=$1::text and template='{}'::jsonb`,[type]);
 if(!type0)await db.query(`update topics set scope=coalesce(scope,'{}'::jsonb)||jsonb_build_object('type',$2::text) where id=$1::uuid`,[t.id,type]);
 for(const m of metrics)await db.query(`insert into metrics(key,version,label,unit,description,methodology,sort_order,format,kind,created_by,status,used)
   select $1::text,1,$2::text,$3::text,$4::text,$5::text,$6::text,'','observed','fastlane','published',true where not exists (select 1 from metrics where key=$1::text)`,
  [m.key,m.label,unitOf(m.key),`${m.label} (Wikidata property ${m.prop}).`,`Read from Wikidata (query.wikidata.org), property ${m.prop}: the latest dated statement of each entity, deprecated ones excluded; quantities normalised to SI units by Wikidata; only values in the measure's most common unit are kept.`,m.order]);
 for(const m of metrics)await db.query(`update metrics set label=$2::text, unit=$3::text, sort_order=$4::text where key=$1::text and created_by='fastlane'`,[m.key,m.label,unitOf(m.key),m.order]);
 const {upsertEntities}=await import('@/app/entity-db/repo');
 const res=await upsertEntities(db,rows,{type,nameColumn:'name',idColumns:{wikidata:'wikidata'},imageColumn:'image',attributeColumns:['wikipedia','website'],topicId:t.id,
  metricColumns:Object.fromEntries(metrics.map(m=>['m_'+m.key,{metric:m.key,unit:unitOf(m.key),period:'p_'+m.key}]))},{source:'Wikidata (query.wikidata.org)'});
 const slug=(t.slug+'-ranking').slice(0,120);
 await db.query(`insert into rankings(topic_id,title,scope,criteria,slug,config,status) select $1::uuid,$2::text,jsonb_build_object('type',$3::text,'filters','{}'::jsonb),$4::text[],$5::text,'{"fastlane":true}'::jsonb,'draft'
  where not exists (select 1 from rankings where slug=$5::text)`,[t.id,p.title||t.name,type,metrics.map(m=>m.key),slug]);
 const {refreshPages}=await import('@/app/entity-db/repo');await refreshPages(db,{type});
 return {ok:true,reason:'',entities:res.inserted+res.merged,ranking:slug};
}

// The next topics without a ranking: leaves before branches, the team queue's order, each tried once.
async function nextTopics(db:EntityDb,n:number):Promise<Topic[]>{
 const r=await db.query<{id:string;slug:string;name:string;description:string;scope:Record<string,unknown>;trail:string}>(`select t.id, t.slug, t.name, t.description, coalesce(t.scope,'{}'::jsonb) scope,
   coalesce((select string_agg(a.name,' > ') from topics a where a.id in (t.parent_id, (select parent_id from topics where id=t.parent_id))),'') trail
  from topics t left join team_queue q on q.slug = t.slug
  where t.status <> 'archived' and t.slug <> 'general' and not (coalesce(t.scope,'{}'::jsonb) ? 'fastlane') and not (coalesce(t.scope,'{}'::jsonb) ? 'filter')
   and not exists (select 1 from rankings r where r.topic_id = t.id)
  order by exists (select 1 from topics c where c.parent_id = t.id), coalesce(q.priority,0) desc, t.created_at limit $1::int`,[n]);
 return r.rows;
}
let pool=0,done=0,failed=0;
export function startFastLane(db:EntityDb,workers=3){
 if(pool||!(workers>0))return pool;pool=workers;
 const claimed=new Set<string>();
 const worker=async(i:number)=>{
  await new Promise(r=>setTimeout(r,i*3000));
  for(;;){
   try{
    const t=(await nextTopics(db,workers*3)).find(x=>!claimed.has(x.id));
    if(!t){await new Promise(r=>setTimeout(r,60_000));continue;}
    claimed.add(t.id);
    const r=await fastLaneTopic(db,t).catch(e=>({ok:false,reason:(e as Error).message.slice(0,300)}));
    await db.query(`update topics set scope=coalesce(scope,'{}'::jsonb)||jsonb_build_object('fastlane',$2::jsonb) where id=$1::uuid`,[t.id,JSON.stringify({at:new Date().toISOString(),...r})]);
    if(r.ok){done++;console.log('[fastlane]',t.slug,'→',(r as {ranking?:string}).ranking,(r as {entities?:number}).entities,'entities');}else failed++;
   }catch(e){console.warn('[fastlane]',(e as Error).message.slice(0,200));await new Promise(r=>setTimeout(r,30_000));}
  }
 };
 for(let i=0;i<workers;i++)void worker(i);
 setInterval(()=>{if(done||failed){console.log('[fastlane]',done,'rankings published,',failed,'topics left to their teams, last 10 min');done=0;failed=0;}},10*60_000).unref?.();
 return pool;
}
