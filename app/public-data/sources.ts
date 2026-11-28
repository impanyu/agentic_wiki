import {z} from 'zod';
import type {Http} from '@/app/public-data/fetcher';
import {PublicHttpError} from '@/app/public-data/fetcher';
import {flattenSparql,compactClaims,wikidataIds,labelIds,commonsFileUrl,wbCountries,wbIndicatorRows,appleChartRows,appleSearchRow,osmRows,coinRow,openAlexRow,OPENALEX_SELECT,stripHtml,type WbCountry,type PlainRow} from '@/app/public-data/normalize';
// Fixed-tool public data sources. Each tool declares its arguments once (zod for validation,
// JSON schema for list_public_sources) and returns compact, normalized output. Tabular
// results come back as {rows,...}; the service saves large row sets as datasets.
// save: stores extra tables (e.g. the tables of an archived page) as datasets of the caller.
export type SavedTable={datasetId:string;rowCount:number;preview:unknown[]};
export type ToolCtx={http:Http;env:(name:string)=>string|undefined;save?:(input:{title:string;source:string;rows:Record<string,unknown>[];notes?:string})=>Promise<SavedTable>};
export type Arg={zod:z.ZodTypeAny;json:Record<string,unknown>;optional?:boolean};
export type ToolDef={name:string;description:string;args:Record<string,Arg>;run:(a:any,c:ToolCtx)=>Promise<unknown>};
export type ProviderDef={id:string;name:string;description:string;tools:ToolDef[];available?:(env:(name:string)=>string|undefined)=>boolean};
const asNumber=(v:unknown)=>typeof v==='string'&&/^-?\d+(\.\d+)?$/.test(v.trim())?Number(v):v;
export const A={
 str:(description:string,max=400,pattern?:RegExp):Arg=>({zod:pattern?z.string().min(1).max(max).regex(pattern,'invalid format'):z.string().min(1).max(max),json:{type:'string',description}}),
 int:(description:string,min:number,max:number):Arg=>({zod:z.preprocess(asNumber,z.number().int().min(min).max(max)),json:{type:'integer',minimum:min,maximum:max,description}}),
 bool:(description:string):Arg=>({zod:z.preprocess(v=>v==='true'?true:v==='false'?false:v,z.boolean()),json:{type:'boolean',description}}),
 oneOf:(values:readonly string[],description:string):Arg=>({zod:z.enum(values as [string,...string[]]),json:{type:'string',enum:values,description}}),
 list:(description:string,maxItems:number,itemMax=200):Arg=>({zod:z.preprocess(v=>typeof v==='string'?v.split(',').map(s=>s.trim()).filter(Boolean):v,z.array(z.string().min(1).max(itemMax)).min(1).max(maxItems)),json:{type:'array',items:{type:'string'},maxItems,description}}),
 opt:(a:Arg):Arg=>({...a,zod:a.zod.optional(),optional:true}),
};
const {str,int,bool,oneOf,list,opt}=A;
const lang=opt(str('Wikipedia/Wikidata language code, default "en".',12,/^[a-z]{2,3}(-[a-z]+)?$/));
export function toolSchema(t:ToolDef){
 const keys=Object.keys(t.args);
 return {type:'object',properties:Object.fromEntries(keys.map(k=>[k,t.args[k].json])),required:keys.filter(k=>!t.args[k].optional),additionalProperties:false};
}
export const toolSignature=(t:ToolDef)=>t.name+'('+Object.entries(t.args).map(([k,a])=>k+(a.optional?'?':'')).join(', ')+')';
export function parseToolArgs(source:string,t:ToolDef,args:unknown){
 const shape=Object.fromEntries(Object.entries(t.args).map(([k,a])=>[k,a.zod]));
 // Near-misses read as meant: "" / null for an optional argument is "not given"; a single unknown argument where a
 // single required one is missing is that argument under another name (sparql {"sparql": …} → query); other unknown
 // names are dropped (the reply notes them).
 const given:Record<string,unknown>={...(args&&typeof args==='object'&&!Array.isArray(args)?args as Record<string,unknown>:{})};
 for(const [k,v] of Object.entries(given))if((v===''||v===null)&&t.args[k]?.optional)delete given[k];
 const unknown=Object.keys(given).filter(k=>!(k in t.args));
 const missing=Object.keys(t.args).filter(k=>!t.args[k].optional&&!(k in given));
 if(unknown.length===1&&missing.length===1){given[missing[0]]=given[unknown[0]];delete given[unknown[0]];}
 else for(const k of unknown)delete given[k];
 const r=z.object(shape).strict().safeParse(given);
 if(!r.success)throw Error('Invalid arguments for '+source+'.'+t.name+': '+r.error.issues.map(i=>(i.path.join('.')||'arguments')+' '+i.message).join('; ')+'. Expected '+toolSignature(t)+'.');
 return r.data as Record<string,any>;
}
const qs=(params:Record<string,unknown>)=>new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>[k,String(v)])).toString();
const tool=(name:string,description:string,args:Record<string,Arg>,run:ToolDef['run']):ToolDef=>({name,description,args,run});
async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>):Promise<R[]>{
 const out:R[]=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i]);}}));
 return out;
}
// ---------- Wikidata ----------
const WD_KEY_PROPS=['P31','P279','P361','P17','P131','P30','P36','P1376','P35','P6','P37','P38','P1082','P2046','P2131','P2132','P1081','P571','P576','P580','P582','P569','P570','P19','P20','P27','P21','P106','P39','P69','P108','P102','P166','P1411','P800','P50','P57','P161','P175','P136','P495','P577','P123','P264','P112','P169','P488','P159','P452','P1128','P2139','P2295','P2403','P2226','P1056','P127','P749','P414','P178','P277','P348','P275','P856','P625','P2044','P2048','P2067','P1083','P115','P118','P54','P413','P286','P1435','P84','P149','P225','P105','P171','P141','P18','P154','P41','P94','P297','P298','P1813','P1449','P2002'];
export const WIKIDATA_SPARQL_EXAMPLE='SELECT ?country ?countryLabel ?population ?area WHERE { ?country wdt:P31 wd:Q3624078; wdt:P1082 ?population; wdt:P2046 ?area. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY DESC(?population)';
export function sparqlWithLimit(query:string,limit:number){
 const q=query.trim().replace(/;\s*$/,'');
 if(/\blimit\s+\d+/i.test(q)||/^\s*(?:(?:PREFIX|BASE)[^\n]*\n\s*)*(ASK|DESCRIBE|CONSTRUCT)\b/i.test(q))return q;
 return q+'\nLIMIT '+limit;
}
async function wdLabels(http:Http,ids:string[],language:string){
 const labels=new Map<string,string>();
 for(let i=0;i<Math.min(ids.length,150);i+=50){
  const r=await http.json('https://www.wikidata.org/w/api.php?'+qs({action:'wbgetentities',ids:ids.slice(i,i+50).join('|'),props:'labels',languages:language==='en'?'en':language+'|en',languagefallback:1,format:'json'}),{cacheMs:3600_000});
  for(const [id,e] of Object.entries<any>(r?.entities||{})){const l=e?.labels?.[language]?.value||e?.labels?.en?.value||Object.values<any>(e?.labels||{})[0]?.value;if(l)labels.set(id,l);}
 }
 return labels;
}
const wikidata:ProviderDef={id:'wikidata',name:'Wikidata',description:'Structured facts on ~110M entities; SPARQL ranks every entity of a kind by any property (population, height, founding date…).',tools:[
 tool('sparql','Run a read-only SPARQL query on the Wikidata Query Service and get rows of plain values (entity URIs become QIDs like "Q142", numbers become numbers, midnight dates become YYYY-MM-DD, images become Commons URLs). Use SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } and select ?xLabel for names. Prefixes wd:, wdt:, p:, ps:, pq:, wikibase:, schema: are predefined. Keep queries simple (the service times out after 60 s): filter with wdt: paths, avoid huge joins, aggregate with GROUP BY + SAMPLE/MAX to get one row per entity. A LIMIT (default 1000, max 5000) is appended when missing. Example, every sovereign state with population and area: '+WIKIDATA_SPARQL_EXAMPLE,{query:str('SPARQL SELECT or ASK query.',8000),limit:opt(int('Row limit appended when the query has none (default 1000).',1,5000))},async(a,{http})=>{
  const query=sparqlWithLimit(a.query,a.limit||1000);
  if(/\b(INSERT|DELETE|LOAD|CLEAR|DROP|CREATE)\s+(DATA|WHERE|GRAPH|SILENT|\{)/i.test(query))throw Error('Only read-only queries are allowed.');
  const json=await http.json('https://query.wikidata.org/sparql?'+qs({query,format:'json'}),{headers:{Accept:'application/sparql-results+json'},timeoutMs:65_000,retries:1}).catch(e=>{
   if(e instanceof PublicHttpError&&e.status===400)throw Error('SPARQL syntax error: '+e.message.replace(/^HTTP 400 from [^:]+: /,''));
   if(e instanceof PublicHttpError&&e.status>=500)throw Error('The Wikidata query timed out or failed ('+e.status+'). Simplify it: fewer joins, a narrower class, LIMIT, no OPTIONAL on large sets.');
   throw e;});
  const {columns,rows}=flattenSparql(json);
  return {title:'Wikidata query',source:'https://query.wikidata.org/',columns,rows};
 }),
 tool('entity','Read one Wikidata entity by QID ("Q90") or by name (the best search match; other matches are listed). Returns label, description, aliases, Wikipedia URL, image (Commons URL) and key claims with labels resolved (quantities with units and point-in-time, dates, linked entities as {id,label}).',{id:opt(str('QID such as "Q90".',20,/^Q\d+$/)),search:opt(str('Name to search when the QID is unknown.',200)),language:lang,properties:opt(list('Only these property ids (e.g. ["P1082","P2046"]); default: key properties plus other non-identifier properties (max 60).',60,10))},async(a,{http})=>{
  const language=a.language||'en';
  if(!a.id&&!a.search)throw Error('Give id or search.');
  let id=a.id,alternatives:unknown[]|undefined;
  if(!id){
   const s=await http.json('https://www.wikidata.org/w/api.php?'+qs({action:'wbsearchentities',search:a.search,language,uselang:language,type:'item',limit:6,format:'json'}));
   const hits=s?.search||[];if(!hits.length)return {found:false,note:'No Wikidata entity matches "'+a.search+'".'};
   id=hits[0].id;alternatives=hits.slice(1).map((h:any)=>({id:h.id,label:h.label,description:h.description}));
  }
  const site=language.replace(/-.*/,'')+'wiki';
  const r=await http.json('https://www.wikidata.org/w/api.php?'+qs({action:'wbgetentities',ids:id,props:'labels|descriptions|aliases|claims|sitelinks/urls',languages:language==='en'?'en':language+'|en',languagefallback:1,sitefilter:site+'|enwiki',format:'json'}));
  const e=r?.entities?.[id];if(!e||e.missing!==undefined)return {found:false,note:'No Wikidata entity '+id+'.'};
  let props:string[]|null=a.properties||null;
  if(!props){
   const present=Object.keys(e.claims||{});const keyed=WD_KEY_PROPS.filter(p=>present.includes(p));
   const others=present.filter(p=>!keyed.includes(p)&&e.claims[p]?.[0]?.mainsnak?.datatype!=='external-id');
   props=[...keyed,...others].slice(0,60);
  }
  const claims=compactClaims(e.claims||{},props);
  const ids=new Set<string>(Object.keys(claims));wikidataIds(claims,ids);
  const labels=await wdLabels(http,[...ids],language);
  const named=Object.fromEntries(Object.entries(claims).map(([p,v])=>[(labels.get(p)||p)+' ('+p+')',labelIds(v,labels)]));
  const label=(o:any)=>o?.[language]?.value||o?.en?.value||null;
  const image=e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return {found:true,id,label:label(e.labels),description:label(e.descriptions),aliases:(e.aliases?.[language]||e.aliases?.en||[]).slice(0,6).map((x:any)=>x.value),
   wikipedia:e.sitelinks?.[site]?.url||e.sitelinks?.enwiki?.url||null,url:'https://www.wikidata.org/wiki/'+id,image:typeof image==='string'?commonsFileUrl(image):null,claims:named,...alternatives?.length?{alternatives}:{}};
 }),
]};
// ---------- Wikipedia ----------
const wp=(language:string|undefined)=>'https://'+(language||'en')+'.wikipedia.org';
const pageUrl=(language:string|undefined,title:string)=>wp(language)+'/wiki/'+encodeURIComponent(title.replace(/ /g,'_'));
const wikipedia:ProviderDef={id:'wikipedia',name:'Wikipedia',description:'Article search, summaries with images, category members and page views (popularity). For tables in an article use the extract_tables tool on its URL.',tools:[
 tool('search','Full-text search of Wikipedia articles. Returns title, short description, excerpt, URL and thumbnail.',{query:str('Search text.',300),language:lang,count:opt(int('Results, default 10.',1,50))},async(a,{http})=>{
  const r=await http.json(wp(a.language)+'/w/rest.php/v1/search/page?'+qs({q:a.query,limit:a.count||10}));
  return {rows:(r?.pages||[]).map((p:any)=>({title:p.title,description:p.description||null,excerpt:stripHtml(p.excerpt),url:pageUrl(a.language,p.key||p.title),thumbnail:p.thumbnail?.url?(String(p.thumbnail.url).startsWith('//')?'https:'+p.thumbnail.url:p.thumbnail.url):null}))};
 }),
 tool('summary','Summary of one article: title, description, lead extract, URL, thumbnail and original image, Wikidata QID and coordinates. For the article\'s tables call extract_tables with the returned URL.',{title:str('Article title (redirects are followed).',300),language:lang},async(a,{http})=>{
  const r=await http.json(wp(a.language)+'/api/rest_v1/page/summary/'+encodeURIComponent(a.title.replace(/ /g,'_'))+'?redirect=true').catch(e=>{if(e instanceof PublicHttpError&&e.status===404)return null;throw e;});
  if(!r)return {found:false,note:'No Wikipedia article "'+a.title+'". Use wikipedia.search.'};
  return {found:true,title:r.title,description:r.description||null,type:r.type,extract:r.extract,url:r.content_urls?.desktop?.page||pageUrl(a.language,r.title),thumbnail:r.thumbnail?.source||null,image:r.originalimage?.source||null,wikidata:r.wikibase_item||null,coordinates:r.coordinates||null};
 }),
 tool('category_members','List the articles (or subcategories) in a Wikipedia category, e.g. "Category:Universities in Germany". Useful to enumerate every entity in a scope.',{category:str('Category name, with or without the "Category:" prefix.',300),language:lang,type:opt(oneOf(['page','subcat'],'Articles (default) or subcategories.')),count:opt(int('Max members, default 200.',1,500))},async(a,{http})=>{
  const title=/^category:/i.test(a.category)?a.category:'Category:'+a.category;
  const rows:PlainRow[]=[];let cont:string|undefined;
  do{
   const r=await http.json(wp(a.language)+'/w/api.php?'+qs({action:'query',list:'categorymembers',cmtitle:title,cmtype:a.type||'page',cmlimit:Math.min(500,(a.count||200)-rows.length),cmcontinue:cont,format:'json'}));
   for(const m of r?.query?.categorymembers||[])rows.push({title:m.title,url:pageUrl(a.language,m.title)});
   cont=r?.continue?.cmcontinue;
  }while(cont&&rows.length<(a.count||200));
  return {title,source:pageUrl(a.language,title),rows};
 }),
 tool('pageviews','Monthly page views (human readers) of up to 25 articles over the last N full months, ranked by total views: a popularity criterion for rankings.',{titles:list('Article titles.',25,300),language:lang,months:opt(int('Months back, default 12.',1,60))},async(a,{http})=>{
  const now=new Date(),end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),0)),start=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-(a.months||12)+1,1));
  const d=(x:Date)=>x.toISOString().slice(0,10).replace(/-/g,'');
  const rows=await mapLimit(a.titles as string[],4,async(t:string)=>{
   try{const r=await http.json('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/'+(a.language||'en')+'.wikipedia/all-access/user/'+encodeURIComponent(t.replace(/ /g,'_'))+'/monthly/'+d(start)+'/'+d(end),{cacheMs:6*3600_000});
    const items=r?.items||[];const views=items.reduce((s:number,i:any)=>s+(i.views||0),0);return {title:t,views,monthlyAverage:items.length?Math.round(views/items.length):0,months:items.length};}
   catch(e){if(e instanceof PublicHttpError&&e.status===404)return {title:t,views:null,monthlyAverage:null,months:0,note:'no such article'};throw e;}
  });
  return {period:start.toISOString().slice(0,7)+' to '+end.toISOString().slice(0,7),rows:rows.slice().sort((x:any,y:any)=>(y.views??-1)-(x.views??-1))};
 }),
]};
// ---------- World Bank + countries ----------
const WB='https://api.worldbank.org/v2';
async function wbMeta(http:Http):Promise<WbCountry[]>{return wbCountries(await http.json(WB+'/country?format=json&per_page=400',{cacheMs:24*3600_000}));}
async function wdiIndicators(http:Http){
 const out:{id:string;name:string;unit:string;sourceNote:string}[]=[];
 for(let page=1;page<=10;page++){
  const r=await http.json(WB+'/source/2/indicator?format=json&per_page=500&page='+page,{cacheMs:24*3600_000});
  for(const i of (Array.isArray(r)&&r[1])||[])out.push({id:i.id,name:i.name,unit:i.unit||'',sourceNote:String(i.sourceNote||'')});
  if(!Array.isArray(r)||page>=Number(r[0]?.pages||1))break;
 }
 return out;
}
export function searchIndicatorList(list:{id:string;name:string;sourceNote?:string}[],query:string,count:number){
 const terms=query.toLowerCase().split(/[^a-z0-9.%]+/).filter(t=>t.length>1);
 return list.map(i=>{const name=i.name.toLowerCase(),id=i.id.toLowerCase(),note=(i.sourceNote||'').toLowerCase();
  let score=0;for(const t of terms){if(id===t)score+=10;else if(name.includes(t))score+=3;else if(id.includes(t))score+=2;else if(note.includes(t))score+=1;else return null;}
  return {i,score:score-name.length/200};}).filter(Boolean).sort((x:any,y:any)=>y.score-x.score).slice(0,count).map((x:any)=>({id:x.i.id,name:x.i.name,unit:x.i.unit||null}));
}
const codeList=(codes:string[])=>codes.map(c=>c.toUpperCase().replace(/[^A-Z0-9]/g,'')).filter(c=>/^[A-Z0-9]{2,3}$/.test(c));
const worldbank:ProviderDef={id:'worldbank',name:'World Bank Open Data',description:'Country indicators (GDP, population, CO2, life expectancy… ~1,500 WDI series) for every country, most recent value or any year.',tools:[
 tool('indicator','One indicator for every country (aggregates such as regions and income groups excluded by default) or for a list of countries. Default: each country\'s most recent non-empty value; or give a year, or a year range "2000:2023" for time series. Rows: name, iso3, value, year, sorted by value (largest first). Common codes: NY.GDP.MKTP.CD GDP (US$), NY.GDP.PCAP.CD GDP per capita, SP.POP.TOTL population, AG.SRF.TOTL.K2 area km², SP.DYN.LE00.IN life expectancy, EN.GHG.CO2.MT.CE.AR5 CO2 (Mt), IT.NET.USER.ZS internet users %. Find others with search_indicators.',{indicator:str('Indicator code, e.g. "NY.GDP.MKTP.CD".',80,/^[A-Za-z0-9._]+$/),countries:opt(list('ISO3 or ISO2 codes; default all countries.',60,3)),year:opt(int('A single year.',1960,2100)),years:opt(str('Year range "2000:2023" (time series).',9,/^\d{4}:\d{4}$/)),includeAggregates:opt(bool('Keep regional and income-group aggregates (default false).'))},async(a,{http})=>{
  const countries=a.countries?codeList(a.countries):[];
  if(a.years){const [f,t]=a.years.split(':').map(Number);if(t<f||t-f>70)throw Error('years must be "from:to" with at most 70 years.');}
  const date=a.years||(a.year?String(a.year):undefined);
  const url=WB+'/country/'+(countries.length?countries.join(';'):'all')+'/indicator/'+encodeURIComponent(a.indicator)+'?'+qs({format:'json',per_page:20000,date,mrnev:date?undefined:1});
  const [page,meta,info]=await Promise.all([http.json(url),wbMeta(http),http.json(WB+'/indicator/'+encodeURIComponent(a.indicator)+'?format=json',{cacheMs:24*3600_000}).catch(()=>null)]);
  const r=wbIndicatorRows(page,meta,{includeAggregates:!!a.includeAggregates});
  const ind=Array.isArray(info)&&info[1]?.[0];
  if(!r.rows.length&&!r.indicator&&!ind)throw Error('Unknown World Bank indicator '+a.indicator+'. Use worldbank.search_indicators.');
  return {title:(ind?.name||r.indicator?.name||a.indicator)+(date?' ('+date+')':' (most recent)'),source:'https://data.worldbank.org/indicator/'+a.indicator,indicator:{id:a.indicator,name:ind?.name||r.indicator?.name||null,unit:ind?.unit||null,sourceOrganization:ind?.sourceOrganization?String(ind.sourceOrganization).slice(0,200):null,definition:ind?.sourceNote?String(ind.sourceNote).slice(0,500):null},period:date||'most recent value per country',missing:r.missing,rows:r.rows};
 }),
 tool('search_indicators','Find World Development Indicators codes by keywords (all words must match the name, code or definition), e.g. "renewable electricity", "military expenditure gdp".',{query:str('Keywords.',200),count:opt(int('Results, default 15.',1,50))},async(a,{http})=>({rows:searchIndicatorList(await wdiIndicators(http),a.query,a.count||15)})),
]};
const flag=(iso2:string)=>iso2&&/^[A-Za-z]{2}$/.test(iso2)?{flag:'https://flagcdn.com/w320/'+iso2.toLowerCase()+'.png',flagSvg:'https://flagcdn.com/'+iso2.toLowerCase()+'.svg'}:{flag:null,flagSvg:null};
async function countryTable(http:Http){
 const [meta,pop,area]=await Promise.all([wbMeta(http),http.json(WB+'/country/all/indicator/SP.POP.TOTL?format=json&per_page=500&mrnev=1',{cacheMs:24*3600_000}),http.json(WB+'/country/all/indicator/AG.SRF.TOTL.K2?format=json&per_page=500&mrnev=1',{cacheMs:24*3600_000})]);
 const p=new Map(wbIndicatorRows(pop,meta).rows.map(r=>[r.iso3,r])),s=new Map(wbIndicatorRows(area,meta).rows.map(r=>[r.iso3,r]));
 return meta.filter(c=>!c.aggregate).map(c=>({name:c.name,iso2:c.iso2,iso3:c.iso3,region:c.region,incomeLevel:c.incomeLevel,capital:c.capital||null,lat:c.lat,lon:c.lon,population:p.get(c.iso3)?.value??null,populationYear:p.get(c.iso3)?.year??null,areaKm2:s.get(c.iso3)?.value??null,...flag(c.iso2)}));
}
const countries:ProviderDef={id:'countries',name:'Countries',description:'Every country and territory (217) with ISO2/ISO3 codes, World Bank region and income level, capital, coordinates, latest population and area, and flag image URLs (flagcdn.com).',tools:[
 tool('list','All countries (no regional aggregates) with name, iso2, iso3, region, incomeLevel, capital, lat, lon, population, areaKm2, flag (PNG 320px) and flagSvg URLs. Optionally filter by region or income level (substring match).',{region:opt(str('e.g. "Europe", "Sub-Saharan Africa", "Latin America".',80)),incomeLevel:opt(str('e.g. "High income".',40))},async(a,{http})=>{
  const rows=(await countryTable(http)).filter(c=>(!a.region||c.region.toLowerCase().includes(a.region.toLowerCase()))&&(!a.incomeLevel||c.incomeLevel.toLowerCase().includes(a.incomeLevel.toLowerCase())));
  return {title:'Countries'+(a.region?' — '+a.region:''),source:'https://api.worldbank.org/v2/country; flags https://flagcdn.com',rows};
 }),
 tool('country','One country by ISO2/ISO3 code or name.',{query:str('Code ("FR", "FRA") or name ("France").',80)},async(a,{http})=>{
  const q=a.query.trim().toLowerCase(),all=await countryTable(http);
  const hit=all.find(c=>c.iso2.toLowerCase()===q||c.iso3.toLowerCase()===q)||all.find(c=>c.name.toLowerCase()===q)||all.find(c=>c.name.toLowerCase().startsWith(q))||all.find(c=>c.name.toLowerCase().includes(q));
  return hit?{found:true,...hit}:{found:false,note:'No country matches "'+a.query+'".'};
 }),
]};
// ---------- OpenAlex ----------
const OA_ENTITIES=['works','authors','institutions','sources','topics','publishers','funders'] as const;
const oaKey=(c:ToolCtx)=>c.env('OPENALEX_API_KEY')||undefined;
const openalex:ProviderDef={id:'openalex',name:'OpenAlex',description:'Scholarly works, authors, institutions, journals, topics, publishers and funders with citation and output counts: research rankings.',tools:[
 tool('search','Search or list OpenAlex entities, sorted by citations, output or relevance, with optional filters. Examples: top institutions by works_count with filter "country_code:de,type:education"; most cited works with filter "topics.id:T10028,publication_year:2020-2024"; authors with filter "last_known_institutions.id:I136199984". Rows carry works, citedBy, hIndex where available.',{entity:oneOf(OA_ENTITIES,'Entity type.'),query:opt(str('Full-text search.',300)),filter:opt(str('OpenAlex filter, e.g. "country_code:us,type:education".',600)),sort:opt(oneOf(['cited_by_count','works_count','relevance','publication_year'],'Sort, descending; default cited_by_count (relevance needs query).')),count:opt(int('Results, default 25; up to 20,000 (fetched 200 a page, in order).',1,20000))},async(a,c)=>{
  const sort=a.sort==='relevance'?(a.query?'relevance_score:desc':undefined):(a.sort||'cited_by_count')+':desc';
  if(a.sort==='works_count'&&a.entity==='works')throw Error('works cannot be sorted by works_count; use cited_by_count or publication_year.');
  // Large lists page through the results with OpenAlex's cursor (a whole universe: every university, not the first 200).
  // Without an API key OpenAlex pages by number (page=1, 2, … up to the first 10,000 results); with one, by cursor.
  const want=a.count||25,rows:any[]=[],key=oaKey(c);let cursor='*',total:number|null=null;
  for(let page=1;rows.length<want&&(key?cursor:page<=50);page++){
   const per=Math.min(200,key?want-rows.length:200);
   const r=await c.http.json('https://api.openalex.org/'+a.entity+'?'+qs({search:a.query,filter:a.filter,sort,per_page:per,...(key?{cursor}:{page}),select:OPENALEX_SELECT[a.entity],api_key:key}));
   total=r?.meta?.count??total;const got=r?.results||[];rows.push(...got);
   if(key)cursor=got.length?r?.meta?.next_cursor||'':'';else if(got.length<per)break;
  }
  return {title:'OpenAlex '+a.entity+(a.query?' — '+a.query:'')+(a.filter?' ['+a.filter+']':''),source:'https://openalex.org/',total,rows:rows.slice(0,want).map((x:any)=>openAlexRow(a.entity,x))};
 }),
 tool('group_by','Count OpenAlex entities grouped by a field, largest groups first: e.g. works on a topic grouped by "authorships.institutions.lineage" (top institutions), by "authorships.countries" or by "publication_year".',{entity:oneOf(OA_ENTITIES,'Entity type, usually works.'),groupBy:str('Field, e.g. "authorships.institutions.lineage", "authorships.countries", "primary_location.source.id", "publication_year".',100,/^[a-z_.0-9]+$/),filter:opt(str('OpenAlex filter.',600)),query:opt(str('Full-text search.',300)),count:opt(int('Groups, default 50.',1,200))},async(a,c)=>{
  const r=await c.http.json('https://api.openalex.org/'+a.entity+'?'+qs({search:a.query,filter:a.filter,group_by:a.groupBy,per_page:Math.max(a.count||50,1),api_key:oaKey(c)}));
  return {title:'OpenAlex '+a.entity+' by '+a.groupBy,source:'https://openalex.org/',total:r?.meta?.count??null,rows:(r?.group_by||[]).slice(0,a.count||50).map((g:any)=>({key:String(g.key).replace(/^https:\/\/openalex\.org\//,''),name:g.key_display_name,count:g.count}))};
 }),
]};
// ---------- CoinGecko ----------
const cgHeaders=(c:ToolCtx):Record<string,string>=>c.env('COINGECKO_API_KEY')?{'x-cg-demo-api-key':c.env('COINGECKO_API_KEY')!}:{};
const coingecko:ProviderDef={id:'coingecko',name:'CoinGecko',description:'Cryptocurrency markets: prices, market caps, volumes and coin details (public endpoint, rate limited).',tools:[
 tool('markets','Top cryptocurrencies ranked by market cap (or volume): rank, symbol, name, price, marketCap, volume24h, change24hPct, change7dPct, supply, image.',{vsCurrency:opt(str('Quote currency, default "usd".',10,/^[a-z]{3,5}$/)),order:opt(oneOf(['market_cap_desc','volume_desc'],'Default market_cap_desc.')),count:opt(int('Coins, default 100.',1,250)),page:opt(int('Page, default 1.',1,20)),category:opt(str('CoinGecko category id, e.g. "layer-1", "decentralized-finance-defi".',80,/^[a-z0-9-]+$/))},async(a,c)=>{
  const r=await c.http.json('https://api.coingecko.com/api/v3/coins/markets?'+qs({vs_currency:a.vsCurrency||'usd',order:a.order||'market_cap_desc',per_page:a.count||100,page:a.page||1,category:a.category,price_change_percentage:'7d'}),{headers:cgHeaders(c),cacheMs:120_000});
  return {title:'Cryptocurrencies by '+(a.order==='volume_desc'?'volume':'market cap'),source:'https://www.coingecko.com/',currency:a.vsCurrency||'usd',rows:(Array.isArray(r)?r:[]).map(coinRow)};
 }),
 tool('coin','Details of one coin by CoinGecko id (e.g. "bitcoin"): description, homepage, genesis date, categories, rank, price, market cap, all-time high.',{id:str('CoinGecko id.',80,/^[a-z0-9-]+$/)},async(a,c)=>{
  const r=await c.http.json('https://api.coingecko.com/api/v3/coins/'+a.id+'?'+qs({localization:false,tickers:false,community_data:false,developer_data:false,sparkline:false}),{headers:cgHeaders(c)});
  const m=r?.market_data||{};
  return {id:r.id,symbol:String(r.symbol||'').toUpperCase(),name:r.name,rank:r.market_cap_rank??null,categories:r.categories||[],genesisDate:r.genesis_date||null,homepage:r.links?.homepage?.find(Boolean)||null,description:String(stripHtml(r.description?.en)||'').slice(0,800),image:r.image?.large||null,priceUsd:m.current_price?.usd??null,marketCapUsd:m.market_cap?.usd??null,athUsd:m.ath?.usd??null,athDate:m.ath_date?.usd?.slice(0,10)??null,circulatingSupply:m.circulating_supply??null,maxSupply:m.max_supply??null};
 }),
]};
// ---------- Apple App Store / iTunes ----------
const APPLE_CHARTS:Record<string,string>={'top-free-apps':'apps/top-free/{n}/apps','top-paid-apps':'apps/top-paid/{n}/apps','top-free-books':'books/top-free/{n}/books','top-paid-books':'books/top-paid/{n}/books','most-played-songs':'music/most-played/{n}/songs','most-played-albums':'music/most-played/{n}/albums','top-podcasts':'podcasts/top/{n}/podcasts','top-podcast-episodes':'podcasts/top/{n}/podcast-episodes','top-audiobooks':'audio-books/top/{n}/audio-books'};
export const appleChartUrl=(chart:string,country:string,count:number)=>{const n=[10,25,50,100].find(x=>x>=count)||100;return 'https://rss.marketingtools.apple.com/api/v2/'+country.toLowerCase()+'/'+APPLE_CHARTS[chart].replace('{n}',String(n))+'.json';};
const country2=opt(str('Two-letter store country, default "us".',2,/^[a-zA-Z]{2}$/));
const appstore:ProviderDef={id:'appstore',name:'Apple App Store & iTunes',description:'Apple top charts (free/paid apps, books, songs, albums, podcasts) per country, app search with ratings, and lookup by id.',tools:[
 tool('top_charts','Current Apple top chart for a country, in chart order: rank, id, name, artist/developer, releaseDate, url, artwork (512px). Combine with lookup for ratings and prices.',{chart:oneOf(Object.keys(APPLE_CHARTS),'Chart.'),country:country2,count:opt(int('Entries, default 25.',1,100))},async(a,{http})=>{
  const url=appleChartUrl(a.chart,a.country||'us',a.count||25);
  const r=await http.json(url,{cacheMs:1800_000});
  return {title:'Apple '+a.chart+' ('+(a.country||'us').toUpperCase()+')',source:url,updated:r?.feed?.updated||null,rows:appleChartRows(r).slice(0,a.count||25)};
 }),
 tool('search','Search the App Store (or iTunes media): id, name, developer, genre, rating, ratingCount, price, release and update dates, version, size, url, artwork.',{term:str('Search term.',200),country:country2,entity:opt(oneOf(['software','iPadSoftware','macSoftware','ebook','album','podcast','audiobook'],'Default software (iPhone apps).')),count:opt(int('Results, default 20.',1,200))},async(a,{http})=>{
  const r=await http.json('https://itunes.apple.com/search?'+qs({term:a.term,country:a.country||'us',entity:a.entity||'software',limit:a.count||20}));
  return {title:'App Store search — '+a.term,source:'https://apps.apple.com/',rows:(r?.results||[]).map(appleSearchRow)};
 }),
 tool('lookup','Details for up to 100 App Store / iTunes ids (from top_charts or search): rating, ratingCount, price, genre, developer, version, dates.',{ids:list('Numeric ids.',100,20),country:country2},async(a,{http})=>{
  const ids=(a.ids as string[]).filter(x=>/^\d+$/.test(x));if(!ids.length)throw Error('ids must be numeric App Store ids.');
  const r=await http.json('https://itunes.apple.com/lookup?'+qs({id:ids.join(','),country:a.country||'us'}));
  return {source:'https://apps.apple.com/',rows:(r?.results||[]).map(appleSearchRow)};
 }),
]};
// ---------- Steam ----------
async function steamNames(http:Http,appids:number[]){
 const names=new Map<number,{name:string;type?:number}>();
 for(let i=0;i<appids.length;i+=100){
  const input={ids:appids.slice(i,i+100).map(appid=>({appid})),context:{language:'english',country_code:'US'},data_request:{include_basic_info:false}};
  const r=await http.json('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?'+qs({input_json:JSON.stringify(input)}),{cacheMs:24*3600_000});
  for(const it of r?.response?.store_items||[])if(it?.name)names.set(Number(it.appid??it.id),{name:it.name,type:it.type});
 }
 return names;
}
const steamUrl=(appid:unknown)=>'https://store.steampowered.com/app/'+appid;
const steam:ProviderDef={id:'steam',name:'Steam',description:'PC games on Steam: most played (daily peak players), store charts (top sellers, new releases, specials), current players, app details and SteamSpy owner/review estimates.',tools:[
 tool('most_played','Steam\'s most played games chart: rank, appid, name, peakPlayers (yesterday\'s peak concurrent players), lastWeekRank, url.',{count:opt(int('Entries, default 50.',1,100))},async(a,{http})=>{
  const r=await http.json('https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/',{cacheMs:1800_000});
  const ranks=(r?.response?.ranks||[]).slice(0,a.count||50);const names=await steamNames(http,ranks.map((x:any)=>x.appid));
  return {title:'Steam most played games',source:'https://store.steampowered.com/charts/mostplayed',date:r?.response?.rollup_date?new Date(r.response.rollup_date*1000).toISOString().slice(0,10):null,rows:ranks.map((x:any)=>({rank:x.rank,appid:x.appid,name:names.get(x.appid)?.name??null,peakPlayers:x.peak_in_game??null,lastWeekRank:x.last_week_rank??null,url:steamUrl(x.appid)}))};
 }),
 tool('store_charts','Steam store lists: top_sellers, new_releases, specials (discounts) or coming_soon, with price (in the store currency), discount and header image.',{list:oneOf(['top_sellers','new_releases','specials','coming_soon'],'Which list.'),country:country2},async(a,{http})=>{
  const r=await http.json('https://store.steampowered.com/api/featuredcategories?'+qs({cc:a.country||'us',l:'english'}),{cacheMs:1800_000});
  const items=r?.[a.list]?.items||[];const seen=new Set<number>();
  return {title:'Steam '+a.list.replace('_',' '),source:'https://store.steampowered.com/',rows:items.filter((i:any)=>!seen.has(i.id)&&seen.add(i.id)).map((i:any,n:number)=>({rank:n+1,appid:i.id,name:i.name,price:i.final_price!=null?i.final_price/100:null,originalPrice:i.original_price!=null?i.original_price/100:null,discountPercent:i.discount_percent??0,currency:i.currency||null,image:i.header_image||i.large_capsule_image||null,url:steamUrl(i.id)}))};
 }),
 tool('app','One Steam app by appid: name, type, short description, developers, publishers, genres, release date, price, Metacritic score, recommendations, platforms, header image, website, current players and SteamSpy estimates (owners range, positive/negative reviews).',{appid:int('Steam appid.',1,99999999)},async(a,{http})=>{
  const r=await http.json('https://store.steampowered.com/api/appdetails?'+qs({appids:a.appid,cc:'us',l:'english'}));
  const d=r?.[a.appid]?.success?r[a.appid].data:null;if(!d)return {found:false,note:'No Steam app '+a.appid+'.'};
  const [players,spy]=await Promise.all([http.json('https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid='+a.appid,{cacheMs:300_000}).catch(()=>null),http.json('https://steamspy.com/api.php?request=appdetails&appid='+a.appid,{cacheMs:6*3600_000}).catch(()=>null)]);
  return {found:true,appid:a.appid,name:d.name,type:d.type,shortDescription:stripHtml(d.short_description),developers:d.developers||[],publishers:d.publishers||[],genres:(d.genres||[]).map((g:any)=>g.description),releaseDate:d.release_date?.date||null,comingSoon:!!d.release_date?.coming_soon,isFree:!!d.is_free,price:d.price_overview?d.price_overview.final/100:d.is_free?0:null,currency:d.price_overview?.currency||null,metacritic:d.metacritic?.score??null,recommendations:d.recommendations?.total??null,platforms:Object.entries(d.platforms||{}).filter(([,v])=>v).map(([k])=>k),headerImage:d.header_image||null,website:d.website||null,url:steamUrl(a.appid),currentPlayers:players?.response?.player_count??null,
   steamspy:spy?.name?{owners:spy.owners,positive:spy.positive,negative:spy.negative,averagePlaytimeMinutes:spy.average_forever,ccuYesterday:spy.ccu}:null};
 }),
 tool('steamspy_top','SteamSpy estimates for the top 100 games: top100in2weeks (most played in the last two weeks), top100forever or top100owned. Rows: appid, name, developer, publisher, owners (range), positive, negative, ccu, price (USD).',{list:oneOf(['top100in2weeks','top100forever','top100owned'],'Which list.')},async(a,{http})=>{
  const r=await http.json('https://steamspy.com/api.php?request='+a.list,{cacheMs:6*3600_000});
  const rows=Object.values<any>(r||{}).map(x=>({appid:x.appid,name:x.name,developer:x.developer||null,publisher:x.publisher||null,owners:x.owners||null,positive:x.positive??null,negative:x.negative??null,ccu:x.ccu??null,price:x.price!=null?Number(x.price)/100:null,url:steamUrl(x.appid)}));
  return {title:'SteamSpy '+a.list,source:'https://steamspy.com/',rows:a.list==='top100in2weeks'?rows:rows.slice().sort((x,y)=>(y.ccu??0)-(x.ccu??0))};
 }),
]};
// ---------- OpenStreetMap ----------
export function overpassQuery(query:string,timeout:number){
 const q=query.trim();
 if(/^\s*\[out:/i.test(q))return q.replace(/\[timeout:\d+\]/i,'').replace(/^\s*\[out:(\w+)\]/i,'[out:json][timeout:'+timeout+']');
 return '[out:json][timeout:'+timeout+'];\n'+q;
}
export const OVERPASS_HOSTS=['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const osm:ProviderDef={id:'openstreetmap',name:'OpenStreetMap',description:'Overpass queries over all OSM features (stadiums, airports, peaks, museums… with tags) and Nominatim geocoding.',tools:[
 tool('overpass','Run an Overpass QL query; [out:json] and a timeout are added. Rows: osmType, osmId, name, lat, lon (center for ways/relations), the element\'s tags and an osm.org url. Always end with "out center tags N;" to bound size. Example, stadiums with a capacity in Germany: area["ISO3166-1"="DE"][admin_level=2]->.a; nwr[leisure=stadium][capacity](area.a); out center tags 500;',{query:str('Overpass QL.',6000),timeoutSeconds:opt(int('Server timeout, default 60.',10,120))},async(a,{http})=>{
  const t=a.timeoutSeconds||60;
  // The main instance is often at capacity; public mirrors run the same software and data.
  let r:any,last:unknown;
  for(const host of OVERPASS_HOSTS){
   try{r=await http.json(host+'?'+qs({data:overpassQuery(a.query,t)}),{timeoutMs:(t+15)*1000,retries:host===OVERPASS_HOSTS[0]?1:0});break;}
   catch(e){if(e instanceof PublicHttpError&&e.status===400)throw Error('Overpass syntax error: '+e.message.replace(/^HTTP 400 from [^:]+: /,''));last=e;}
  }
  if(!r)throw Error('Overpass servers are busy or timed out ('+(last instanceof Error?last.message.slice(0,160):'unknown')+'). Narrow the query (smaller area, fewer tags, lower out limit) or try again in a few minutes.');
  if(r?.remark&&/error|timed out|runtime/i.test(r.remark)&&!(r.elements||[]).length)throw Error('Overpass: '+r.remark);
  return {title:'OpenStreetMap query',source:'https://www.openstreetmap.org/ (ODbL)',remark:r?.remark||undefined,rows:osmRows(r)};
 }),
 tool('geocode','Find places by name or address with Nominatim: display name, lat, lon, category/type, OSM id, importance, Wikidata QID and population when tagged.',{query:str('Place name or address.',300),count:opt(int('Results, default 5.',1,20)),countryCodes:opt(str('Comma-separated ISO2 codes to restrict to, e.g. "de,at".',60,/^[a-zA-Z]{2}(,[a-zA-Z]{2})*$/))},async(a,{http})=>{
  const r=await http.json('https://nominatim.openstreetmap.org/search?'+qs({q:a.query,format:'jsonv2',limit:a.count||5,extratags:1,countrycodes:a.countryCodes}),{cacheMs:24*3600_000});
  return {rows:(Array.isArray(r)?r:[]).map((p:any)=>({name:p.display_name,lat:Number(p.lat),lon:Number(p.lon),category:p.category,type:p.type,osmType:p.osm_type,osmId:p.osm_id,importance:p.importance??null,wikidata:p.extratags?.wikidata||null,population:p.extratags?.population?Number(p.extratags.population)||p.extratags.population:null}))};
 }),
]};
// ---------- Stack Exchange ----------
const site=opt(str('Stack Exchange site, default "stackoverflow" (e.g. "superuser", "math", "datascience").',40,/^[a-z.]+$/));
const stackexchange:ProviderDef={id:'stackexchange',name:'Stack Exchange',description:'Stack Overflow and other Stack Exchange sites: tags by number of questions (technology popularity) and question search.',tools:[
 tool('tags','Tags ranked by number of questions: rank, name, questions.',{site,count:opt(int('Tags, default 50.',1,100)),page:opt(int('Page, default 1.',1,25)),contains:opt(str('Only tags whose name contains this text.',35))},async(a,{http})=>{
  const r=await http.json('https://api.stackexchange.com/2.3/tags?'+qs({order:'desc',sort:'popular',site:a.site||'stackoverflow',pagesize:a.count||50,page:a.page||1,inname:a.contains}),{cacheMs:6*3600_000});
  const offset=((a.page||1)-1)*(a.count||50);
  return {title:'Stack Exchange tags by questions ('+(a.site||'stackoverflow')+')',source:'https://'+(a.site||'stackoverflow')+'.com/tags',rows:(r?.items||[]).map((t:any,i:number)=>({rank:offset+i+1,name:t.name,questions:t.count})),quotaRemaining:r?.quota_remaining};
 }),
 tool('search','Search questions: title, score, answers, views, tags, answered, created date and link.',{query:str('Search text.',200),site,tagged:opt(str('Semicolon-separated tags, e.g. "python;pandas".',100)),sort:opt(oneOf(['votes','relevance','activity','creation'],'Default votes.')),count:opt(int('Results, default 20.',1,100))},async(a,{http})=>{
  const r=await http.json('https://api.stackexchange.com/2.3/search/advanced?'+qs({q:a.query,tagged:a.tagged,site:a.site||'stackoverflow',sort:a.sort||'votes',order:'desc',pagesize:a.count||20}));
  return {rows:(r?.items||[]).map((q:any)=>({title:stripHtml(q.title),score:q.score,answers:q.answer_count,views:q.view_count,tags:(q.tags||[]).join(', '),answered:q.is_answered,created:q.creation_date?new Date(q.creation_date*1000).toISOString().slice(0,10):null,link:q.link})),quotaRemaining:r?.quota_remaining};
 }),
]};
// ---------- Hacker News ----------
const hackernews:ProviderDef={id:'hackernews',name:'Hacker News',description:'Hacker News stories and comments via Algolia search, with points and comment counts.',tools:[
 tool('search','Search Hacker News: title, url, points, comments, author, created date and the HN discussion link. Use minPoints and since to find the most upvoted stories about a topic.',{query:{zod:z.string().max(200),json:{type:'string',description:'Search text; "" for all.'}},type:opt(oneOf(['story','comment','show_hn','ask_hn','front_page'],'Default story.')),sortBy:opt(oneOf(['relevance','date'],'Default relevance (popular first).')),since:opt(str('Only items created after this date (YYYY-MM-DD).',10,/^\d{4}-\d\d-\d\d$/)),minPoints:opt(int('Minimum points.',0,100000)),count:opt(int('Results, default 20.',1,100))},async(a,{http})=>{
  const filters=[a.since?'created_at_i>'+Math.floor(Date.parse(a.since)/1000):'',a.minPoints!=null?'points>='+a.minPoints:''].filter(Boolean).join(',');
  const r=await http.json('https://hn.algolia.com/api/v1/'+(a.sortBy==='date'?'search_by_date':'search')+'?'+qs({query:a.query,tags:a.type||'story',numericFilters:filters||undefined,hitsPerPage:a.count||20}));
  return {total:r?.nbHits??null,rows:(r?.hits||[]).map((h:any)=>({title:h.title||h.story_title||null,url:h.url||null,points:h.points??null,comments:h.num_comments??null,author:h.author,created:h.created_at?String(h.created_at).slice(0,10):null,hnUrl:'https://news.ycombinator.com/item?id='+h.objectID,...h.comment_text?{text:String(stripHtml(h.comment_text)).slice(0,500)}:{}}))};
 }),
]};
// ---------- Package registries ----------
const NPM_NAME=/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const packages:ProviderDef={id:'packages',name:'Package registries',description:'Library popularity: npm search and download counts, PyPI downloads (pypistats), crates.io crates by downloads.',tools:[
 tool('npm_search','Search npm packages: name, version, description, monthly and weekly downloads, dependents, repository.',{query:str('Search text or keywords:… / author:… qualifiers.',200),count:opt(int('Results, default 20.',1,250))},async(a,{http})=>{
  const r=await http.json('https://registry.npmjs.org/-/v1/search?'+qs({text:a.query,size:a.count||20}));
  return {total:r?.total??null,rows:(r?.objects||[]).map((o:any)=>({name:o.package?.name,version:o.package?.version,description:o.package?.description||null,monthlyDownloads:o.downloads?.monthly??null,weeklyDownloads:o.downloads?.weekly??null,dependents:o.dependents!=null?Number(o.dependents):null,repository:o.package?.links?.repository||null,url:o.package?.links?.npm||'https://www.npmjs.com/package/'+o.package?.name}))};
 }),
 tool('npm_downloads','Download counts of up to 100 npm packages over last-week, last-month or last-year, ranked.',{packages:list('Package names.',100,214),period:opt(oneOf(['last-day','last-week','last-month','last-year'],'Default last-month.'))},async(a,{http})=>{
  const names=(a.packages as string[]).map(n=>n.toLowerCase());const bad=names.find(n=>!NPM_NAME.test(n));if(bad)throw Error('Invalid npm package name '+bad+'.');
  const period=a.period||'last-month',plain=names.filter(n=>!n.startsWith('@')),scoped=names.filter(n=>n.startsWith('@'));
  const counts=new Map<string,{downloads:number|null;start?:string;end?:string}>();
  for(let i=0;i<plain.length;i+=100){
   const chunk=plain.slice(i,i+100);const r=await http.json('https://api.npmjs.org/downloads/point/'+period+'/'+chunk.join(','),{cacheMs:3600_000}).catch(e=>{if(e instanceof PublicHttpError&&e.status===404)return {};throw e;});
   if(chunk.length===1&&r?.package)counts.set(r.package,r);else for(const [k,v] of Object.entries<any>(r||{}))counts.set(k,v||{downloads:null});
  }
  await mapLimit(scoped,4,async n=>{const r=await http.json('https://api.npmjs.org/downloads/point/'+period+'/'+n,{cacheMs:3600_000}).catch(()=>null);counts.set(n,r||{downloads:null});});
  const rows=names.map(n=>({package:n,downloads:counts.get(n)?.downloads??null,start:counts.get(n)?.start||null,end:counts.get(n)?.end||null}));
  return {period,source:'https://api.npmjs.org/downloads',rows:rows.sort((x,y)=>(y.downloads??-1)-(x.downloads??-1))};
 }),
 tool('pypi_downloads','Recent PyPI downloads (last day, week and month, from pypistats.org) of up to 30 Python packages, ranked by last month.',{packages:list('PyPI package names.',30,100)},async(a,{http})=>{
  const rows=await mapLimit(a.packages as string[],2,async(p:string)=>{
   const name=p.toLowerCase().replace(/[_.]+/g,'-');if(!/^[a-z0-9][a-z0-9-]*$/.test(name))return {package:p,lastDay:null,lastWeek:null,lastMonth:null,note:'invalid name'};
   try{const r=await http.json('https://pypistats.org/api/packages/'+name+'/recent',{cacheMs:6*3600_000});return {package:name,lastDay:r?.data?.last_day??null,lastWeek:r?.data?.last_week??null,lastMonth:r?.data?.last_month??null};}
   catch(e){if(e instanceof PublicHttpError&&e.status===404)return {package:name,lastDay:null,lastWeek:null,lastMonth:null,note:'not found'};throw e;}
  });
  return {source:'https://pypistats.org/',rows:rows.slice().sort((x:any,y:any)=>(y.lastMonth??-1)-(x.lastMonth??-1))};
 }),
 tool('crates','Rust crates from crates.io: search or list by total or recent (90-day) downloads.',{query:opt(str('Search text.',200)),sort:opt(oneOf(['downloads','recent-downloads','relevance','new'],'Default downloads (or relevance with a query).')),count:opt(int('Results, default 25.',1,100))},async(a,{http})=>{
  const r=await http.json('https://crates.io/api/v1/crates?'+qs({q:a.query,sort:a.sort||(a.query?'relevance':'downloads'),per_page:a.count||25}));
  return {total:r?.meta?.total??null,rows:(r?.crates||[]).map((c:any)=>({name:c.name,downloads:c.downloads,recentDownloads:c.recent_downloads??null,version:c.default_version||c.max_stable_version||c.newest_version||null,description:c.description?String(c.description).trim():null,repository:c.repository||null,updated:c.updated_at?String(c.updated_at).slice(0,10):null,url:'https://crates.io/crates/'+c.name}))};
 }),
]};
// ---------- GBIF ----------
const GBIF_BACKBONE='d7dddbf4-2cf0-4f39-9b2a-bb099caae36c';
const gbif:ProviderDef={id:'gbif',name:'GBIF',description:'Global Biodiversity Information Facility: species taxonomy and occurrence counts (by country or year).',tools:[
 tool('species_search','Search species and other taxa in the GBIF backbone taxonomy: key, scientific and common name, rank, status, kingdom … genus.',{query:str('Scientific or common name.',200),rank:opt(oneOf(['KINGDOM','PHYLUM','CLASS','ORDER','FAMILY','GENUS','SPECIES','SUBSPECIES'],'Restrict to a rank.')),count:opt(int('Results, default 20.',1,100))},async(a,{http})=>{
  const r=await http.json('https://api.gbif.org/v1/species/search?'+qs({q:a.query,rank:a.rank,datasetKey:GBIF_BACKBONE,limit:a.count||20}));
  return {total:r?.count??null,rows:(r?.results||[]).map((s:any)=>({key:s.nubKey??s.key,scientificName:s.scientificName,canonicalName:s.canonicalName||null,commonName:(s.vernacularNames||[]).find((v:any)=>v.language==='eng')?.vernacularName||null,rank:s.rank,status:s.taxonomicStatus,kingdom:s.kingdom||null,phylum:s.phylum||null,class:s.class||null,order:s.order||null,family:s.family||null,genus:s.genus||null,url:'https://www.gbif.org/species/'+(s.nubKey??s.key)}))};
 }),
 tool('occurrences','Count occurrence records of a taxon (GBIF species key), in total and grouped by country or year, largest first.',{taxonKey:int('GBIF taxon key from species_search.',1,1e9),by:opt(oneOf(['country','year','none'],'Grouping, default country.')),count:opt(int('Groups, default 50.',1,300))},async(a,{http})=>{
  const by=a.by||'country';
  const r=await http.json('https://api.gbif.org/v1/occurrence/search?'+qs({taxonKey:a.taxonKey,limit:0,facet:by==='none'?undefined:by,facetLimit:by==='none'?undefined:a.count||50}),{timeoutMs:45_000});
  const counts=(r?.facets?.[0]?.counts||[]).map((c:any)=>({[by]:c.name,occurrences:c.count}));
  return {taxonKey:a.taxonKey,total:r?.count??null,source:'https://www.gbif.org/occurrence/search?taxon_key='+a.taxonKey,rows:counts};
 }),
]};
// ---------- Open Library ----------
const openlibrary:ProviderDef={id:'openlibrary',name:'Open Library',description:'Books and authors from Open Library (Internet Archive): editions, ratings, reading-log counts, covers.',tools:[
 tool('search','Search books: title, authors, first publication year, editions, rating, ratings count, want-to-read and already-read counts, cover image and URL.',{query:opt(str('Search text.',200)),author:opt(str('Author name.',120)),subject:opt(str('Subject, e.g. "science fiction".',120)),sort:opt(oneOf(['relevance','rating','editions','new','old','readinglog','want_to_read'],'Default relevance.')),count:opt(int('Results, default 20.',1,100))},async(a,{http})=>{
  if(!a.query&&!a.author&&!a.subject)throw Error('Give query, author or subject.');
  const r=await http.json('https://openlibrary.org/search.json?'+qs({q:a.query,author:a.author,subject:a.subject,sort:a.sort&&a.sort!=='relevance'?a.sort:undefined,limit:a.count||20,fields:'key,title,author_name,first_publish_year,edition_count,ratings_average,ratings_count,want_to_read_count,already_read_count,cover_i,subject'}));
  return {total:r?.numFound??null,rows:(r?.docs||[]).map((d:any)=>({title:d.title,authors:(d.author_name||[]).slice(0,4).join(', '),firstPublished:d.first_publish_year??null,editions:d.edition_count??null,rating:d.ratings_average!=null?Math.round(d.ratings_average*100)/100:null,ratingsCount:d.ratings_count??null,wantToRead:d.want_to_read_count??null,alreadyRead:d.already_read_count??null,cover:d.cover_i?'https://covers.openlibrary.org/b/id/'+d.cover_i+'-M.jpg':null,url:'https://openlibrary.org'+d.key}))};
 }),
 tool('authors','Search authors: name, birth and death dates, top work, number of works.',{query:str('Author name.',200),count:opt(int('Results, default 10.',1,100))},async(a,{http})=>{
  const r=await http.json('https://openlibrary.org/search/authors.json?'+qs({q:a.query,limit:a.count||10}));
  return {rows:(r?.docs||[]).map((d:any)=>({name:d.name,birthDate:d.birth_date||null,deathDate:d.death_date||null,topWork:d.top_work||null,works:d.work_count??null,photo:'https://covers.openlibrary.org/a/olid/'+d.key+'-M.jpg',url:'https://openlibrary.org/authors/'+d.key}))};
 }),
]};
// ---------- MusicBrainz ----------
const musicbrainz:ProviderDef={id:'musicbrainz',name:'MusicBrainz',description:'Open music encyclopedia: artists, release groups (albums), recordings and labels (1 request/second).',tools:[
 tool('search','Search MusicBrainz (Lucene syntax allowed, e.g. "artist:radiohead AND type:album"). Rows: id, name/title, type, country, dates, artist credit, tags, match score.',{entity:oneOf(['artist','release-group','recording','label'],'Entity type.'),query:str('Search query.',300),count:opt(int('Results, default 10.',1,100))},async(a,{http})=>{
  const r=await http.json('https://musicbrainz.org/ws/2/'+a.entity+'?'+qs({query:a.query,limit:a.count||10,fmt:'json'}));
  const list=r?.[a.entity==='release-group'?'release-groups':a.entity+'s']||[];
  const credit=(x:any)=>(x['artist-credit']||[]).map((c:any)=>c.name+(c.joinphrase||'')).join('')||null;
  const tags=(x:any)=>(x.tags||[]).slice().sort((p:any,q:any)=>q.count-p.count).slice(0,5).map((t:any)=>t.name).join(', ')||null;
  return {rows:list.map((x:any)=>({id:x.id,name:x.name??x.title,type:x.type??x['primary-type']??null,country:x.country??null,area:x.area?.name??null,begin:x['life-span']?.begin??x['first-release-date']??null,end:x['life-span']?.end??null,artist:credit(x),disambiguation:x.disambiguation||null,tags:tags(x),score:x.score??null,url:'https://musicbrainz.org/'+a.entity+'/'+x.id}))};
 }),
]};
// ---------- GitHub, YouTube, ArcGIS (existing sources) ----------
const githubHeaders=(c:ToolCtx):Record<string,string>=>({Accept:'application/vnd.github+json',...c.env('GITHUB_TOKEN')?{Authorization:'Bearer '+c.env('GITHUB_TOKEN')}:{}});
const github=async(c:ToolCtx,path:string)=>c.http.json('https://api.github.com'+path,{headers:githubHeaders(c)}).catch(e=>{
 if(e instanceof PublicHttpError&&(e.status===403||e.status===429))throw Error('GitHub rate limit reached'+(c.env('GITHUB_TOKEN')?'':' (unauthenticated: 10 searches per minute, 60 requests per hour)')+'; try again later or use fewer GitHub calls.');
 if(e instanceof PublicHttpError&&e.status===404)throw Error('Not found on GitHub: '+path.split('?')[0]+'.');
 if(e instanceof PublicHttpError&&e.status===422)throw Error('GitHub could not parse the search query: '+e.message.replace(/^HTTP 422 from [^:]+: /,''));
 throw e;});
const repoShape=(r:any)=>({fullName:r.full_name,description:r.description,url:r.html_url,stars:r.stargazers_count,forks:r.forks_count,language:r.language,license:r.license?.spdx_id,topics:r.topics,createdAt:r.created_at,pushedAt:r.pushed_at,homepage:r.homepage||undefined,archived:r.archived||undefined});
const count25=opt(int('Results, default 10.',1,25));
const githubSource:ProviderDef={id:'github',name:'GitHub',description:'Search and read public GitHub repositories and issues (stars, forks, languages).',tools:[
 tool('search_repositories','Search public repositories (GitHub search syntax, e.g. "topic:llm stars:>1000"). Returns name, description, stars, language, license, topics and dates.',{query:str('GitHub search query.',400),sort:opt(oneOf(['stars','forks','updated','best-match'],'Sort.')),count:count25},async(a,c)=>{
  const r=await github(c,'/search/repositories?'+new URLSearchParams({q:a.query,per_page:String(a.count||10),...a.sort&&a.sort!=='best-match'?{sort:a.sort}:{}}));
  return {total:r.total_count,items:(r.items||[]).map(repoShape)};
 }),
 tool('get_repository','Read one public repository: metadata plus the README text (first 20 000 characters).',{owner:str('Owner.',100,/^[A-Za-z0-9_.-]{1,100}$/),repo:str('Repository.',100,/^[A-Za-z0-9_.-]{1,100}$/)},async(a,c)=>{
  const r=await github(c,'/repos/'+a.owner+'/'+a.repo);let readme='';
  try{const m=await github(c,'/repos/'+a.owner+'/'+a.repo+'/readme');readme=Buffer.from(String(m.content||''),'base64').toString('utf8').slice(0,20000);}catch{}
  return {...repoShape(r),readme};
 }),
 tool('search_issues','Search public issues and pull requests (GitHub search syntax, e.g. "repo:owner/name is:issue label:bug").',{query:str('GitHub search query.',400),count:count25},async(a,c)=>{
  const r=await github(c,'/search/issues?'+new URLSearchParams({q:a.query,per_page:String(a.count||10)}));
  return {total:r.total_count,items:(r.items||[]).map((i:any)=>({title:i.title,url:i.html_url,state:i.state,pullRequest:!!i.pull_request,comments:i.comments,createdAt:i.created_at,closedAt:i.closed_at,labels:(i.labels||[]).map((l:any)=>l.name),body:String(i.body||'').slice(0,1500)}))};
 }),
]};
const youtube:ProviderDef={id:'youtube',name:'YouTube',description:'Search public YouTube videos, channels and playlists, with view and subscriber counts.',available:env=>!!env('YOUTUBE_API_KEY'),tools:[
 tool('search','Search public YouTube videos, channels or playlists. Returns IDs, titles, descriptions, channel names, publication times and thumbnails; embed a video in the article with a media component (https://www.youtube.com/watch?v=<id>).',{query:str('Search text.',300),type:opt(oneOf(['video','channel','playlist'],'Default video.')),count:count25},async(a,c)=>{
  const r=await c.http.json('https://www.googleapis.com/youtube/v3/search?'+qs({part:'snippet',q:a.query,type:a.type||'video',maxResults:a.count||10,key:c.env('YOUTUBE_API_KEY')}));
  return (r?.items||[]).map((i:any)=>({id:i.id?.videoId||i.id?.channelId||i.id?.playlistId,kind:i.id?.kind,title:i.snippet?.title,description:i.snippet?.description,channel:i.snippet?.channelTitle,publishedAt:i.snippet?.publishedAt,thumbnail:i.snippet?.thumbnails?.high?.url||i.snippet?.thumbnails?.default?.url}));
 }),
 tool('statistics','View, like and comment counts of up to 50 videos, or subscriber/view/video counts of up to 50 channels: a popularity criterion.',{kind:oneOf(['videos','channels'],'Videos or channels.'),ids:list('Video or channel ids.',50,40)},async(a,c)=>{
  const r=await c.http.json('https://www.googleapis.com/youtube/v3/'+a.kind+'?'+qs({part:'snippet,statistics',id:(a.ids as string[]).join(','),maxResults:50,key:c.env('YOUTUBE_API_KEY')}));
  const n=(v:unknown)=>v==null?null:Number(v);
  return {rows:(r?.items||[]).map((i:any)=>a.kind==='videos'?{id:i.id,title:i.snippet?.title,channel:i.snippet?.channelTitle,publishedAt:i.snippet?.publishedAt,views:n(i.statistics?.viewCount),likes:n(i.statistics?.likeCount),comments:n(i.statistics?.commentCount),url:'https://www.youtube.com/watch?v='+i.id}:{id:i.id,title:i.snippet?.title,country:i.snippet?.country||null,subscribers:n(i.statistics?.subscriberCount),views:n(i.statistics?.viewCount),videos:n(i.statistics?.videoCount),thumbnail:i.snippet?.thumbnails?.high?.url||null,url:'https://www.youtube.com/channel/'+i.id})};
 }),
]};
const arcgis:ProviderDef={id:'arcgis',name:'ArcGIS Online (public)',description:'Public maps, feature layers and datasets shared on ArcGIS Online.',tools:[
 tool('search_items','Search public ArcGIS Online items (feature services, web maps, map services, datasets). Returns id, title, type, owner, snippet, url and extent.',{query:str('Search text.',400),type:opt(str('Optional item type, e.g. "Feature Service", "Web Map", "Map Service".',80)),count:count25},async(a,{http})=>{
  const q=a.type?a.query+' type:"'+a.type.replace(/"/g,'')+'"':a.query;
  const r=await http.json('https://www.arcgis.com/sharing/rest/search?'+new URLSearchParams({q:q+' access:public',num:String(a.count||10),f:'json'}));
  return {total:r.total,items:(r.results||[]).map((i:any)=>({id:i.id,title:i.title,type:i.type,owner:i.owner,snippet:i.snippet,url:i.url,page:'https://www.arcgis.com/home/item.html?id='+i.id,extent:i.extent,tags:i.tags?.slice(0,10)}))};
 }),
 tool('query_layer','Query a public ArcGIS feature layer (a layer URL ending in /FeatureServer/<n> or /MapServer/<n>). Returns attributes as rows and, when returnGeometry is true, GeoJSON features. Put the data into the article (a component block or a Page file) to chart or map it.',{url:str('Layer URL.',1000),where:opt(str('SQL where clause; default 1=1.',2000)),outFields:opt(str('Comma-separated fields; default *.',1000)),count:opt(int('Max features, default 200.',1,2000)),returnGeometry:opt(bool('Return GeoJSON geometry.'))},async(a,{http})=>{
  let base:URL;try{base=new URL(a.url);}catch{throw Error('Give a public https layer URL ending in /FeatureServer/<n> or /MapServer/<n>.');}
  if(base.protocol!=='https:'||!/\/(FeatureServer|MapServer)\/\d+\/?$/.test(base.pathname))throw Error('Give a public https layer URL ending in /FeatureServer/<n> or /MapServer/<n>.');
  const r=await http.json(base.origin+base.pathname.replace(/\/$/,'')+'/query?'+new URLSearchParams({where:a.where||'1=1',outFields:a.outFields||'*',resultRecordCount:String(a.count||200),returnGeometry:String(!!a.returnGeometry),f:a.returnGeometry?'geojson':'json'}));
  if(r?.error)throw Error('ArcGIS: '+(r.error.message||'query failed'));
  return a.returnGeometry?{type:r.type,features:r.features}:{title:'ArcGIS layer query',source:base.href,fields:(r.fields||[]).map((f:any)=>({name:f.name,type:f.type,alias:f.alias})),rows:(r.features||[]).map((f:any)=>f.attributes),exceededTransferLimit:r.exceededTransferLimit||undefined};
 }),
]};
// Sources defined in their own modules (archive.ts) add themselves here when imported.
export const REGISTERED_SOURCES:ProviderDef[]=[];
export const registerSource=(def:ProviderDef)=>{if(!REGISTERED_SOURCES.some(s=>s.id===def.id))REGISTERED_SOURCES.push(def);};
export const FIXED_SOURCES:ProviderDef[]=[wikidata,wikipedia,worldbank,countries,openalex,appstore,steam,coingecko,osm,stackexchange,hackernews,packages,gbif,openlibrary,musicbrainz,githubSource,youtube,arcgis];
