// Pure normalizers that turn provider responses into compact rows with plain values.
// No network and no imports, so they can be tested directly.
export type PlainRow=Record<string,unknown>;
const NUMERIC_XSD=/#(integer|decimal|double|float|int|long|short|byte|nonNegativeInteger|positiveInteger|negativeInteger|nonPositiveInteger|unsignedInt|unsignedLong)$/;
export const commonsFileUrl=(name:string)=>'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(name.replace(/ /g,'_'));
// One SPARQL JSON binding to a plain value: Wikidata entity URIs become their QID, numbers
// become numbers, midnight dateTimes become dates, Commons file URLs become https.
export function sparqlValue(b:{type?:string;value?:string;datatype?:string}|undefined|null):unknown{
 if(!b||b.value==null)return null;
 const v=String(b.value);
 if(b.type==='uri'){
  const id=v.match(/^https?:\/\/www\.wikidata\.org\/entity\/([QPL]\d+(?:-[A-Z]\d+)?)$/);if(id)return id[1];
  if(/^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//.test(v))return v.replace(/^http:/,'https:');
  return v;
 }
 if(b.type==='bnode')return null;
 const dt=b.datatype||'';
 if(NUMERIC_XSD.test(dt)){const n=Number(v);return Number.isFinite(n)?n:v;}
 if(dt.endsWith('#boolean'))return v==='true';
 if(dt.endsWith('#dateTime')||dt.endsWith('#date'))return v.replace(/T00:00:00(?:\.000)?Z$/,'');
 return v;
}
export function flattenSparql(json:any):{columns:string[];rows:PlainRow[]}{
 if(typeof json?.boolean==='boolean')return {columns:['result'],rows:[{result:json.boolean}]};
 const columns:string[]=Array.isArray(json?.head?.vars)?json.head.vars:[];
 const rows=(Array.isArray(json?.results?.bindings)?json.results.bindings:[]).map((b:any)=>Object.fromEntries(columns.map(c=>[c,sparqlValue(b?.[c])])));
 return {columns,rows};
}
// Wikidata statements: preferred rank wins, deprecated is dropped.
export function bestStatements(statements:any[]):any[]{
 const live=(statements||[]).filter(s=>s?.rank!=='deprecated'&&s?.mainsnak?.snaktype==='value');
 const preferred=live.filter(s=>s.rank==='preferred');return preferred.length?preferred:live;
}
export function wikidataTime(t:{time?:string;precision?:number}|undefined){
 if(!t?.time)return null;
 const m=t.time.match(/^([+-])(\d+)-(\d\d)-(\d\d)/);if(!m)return t.time;
 const year=(m[1]==='-'?'-':'')+String(Number(m[2]));const p=t.precision??11;
 return p<=9?year:p===10?year+'-'+m[3]:year+'-'+m[3]+'-'+m[4];
}
// A datavalue to a plain value; entity ids are kept as {id} for later label resolution.
export function wikidataValue(dv:any):unknown{
 const v=dv?.value;
 switch(dv?.type){
  case 'wikibase-entityid':return {id:v?.id||(v?.['numeric-id']!=null?'Q'+v['numeric-id']:null)};
  case 'quantity':{const amount=Number(v?.amount);const unit=String(v?.unit||'1');const unitId=unit.match(/(Q\d+)$/)?.[1];return unitId?{amount,unit:{id:unitId}}:amount;}
  case 'time':return wikidataTime(v);
  case 'monolingualtext':return v?.text??null;
  case 'globecoordinate':return {lat:v?.latitude,lon:v?.longitude};
  case 'string':return v;
  default:return v??null;
 }
}
export function wikidataIds(value:unknown,into:Set<string>){
 if(value&&typeof value==='object'){const o=value as Record<string,unknown>;if(typeof o.id==='string'&&/^[QP]\d+$/.test(o.id))into.add(o.id);for(const x of Object.values(o))if(x&&typeof x==='object')wikidataIds(x,into);}
}
export function labelIds(value:unknown,labels:Map<string,string>):unknown{
 if(Array.isArray(value))return value.map(v=>labelIds(v,labels));
 if(value&&typeof value==='object'){
  const o=value as Record<string,unknown>;
  if(typeof o.id==='string'&&Object.keys(o).length===1)return labels.has(o.id)?{id:o.id,label:labels.get(o.id)}:{id:o.id};
  if('amount'in o&&o.unit&&typeof o.unit==='object'){const u=(o.unit as {id:string}).id;return {...o,unit:labels.get(u)||u};}
  return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,labelIds(v,labels)]));
 }
 return value;
}
// Claims of one entity reduced to the properties asked for (or every property, capped),
// at most `perProperty` values each, with the point-in-time qualifier when there is one.
export function compactClaims(claims:Record<string,any[]>,properties:string[]|null,perProperty=5,maxProperties=80){
 const out:Record<string,unknown[]>={};
 const keys=(properties&&properties.length?properties:Object.keys(claims||{})).filter(p=>claims?.[p]).slice(0,maxProperties);
 for(const p of keys){
  const values=bestStatements(claims[p]).slice(0,perProperty).map(s=>{
   const value=s.mainsnak?.datatype==='commonsMedia'&&typeof s.mainsnak?.datavalue?.value==='string'?commonsFileUrl(s.mainsnak.datavalue.value):wikidataValue(s.mainsnak?.datavalue);
   const when=s.qualifiers?.P585?.[0]?.datavalue;return when?{value,pointInTime:wikidataTime(when.value)}:value;
  });
  if(values.length)out[p]=values;
 }
 return out;
}
// World Bank country metadata: aggregates (regions, income groups…) have region.id "NA".
export type WbCountry={iso3:string;iso2:string;name:string;region:string;incomeLevel:string;capital:string;lat:number|null;lon:number|null;aggregate:boolean};
export function wbCountries(page:any):WbCountry[]{
 const list=Array.isArray(page)&&Array.isArray(page[1])?page[1]:[];
 return list.map((c:any)=>({iso3:c.id,iso2:c.iso2Code,name:c.name,region:String(c.region?.value||'').trim(),incomeLevel:String(c.incomeLevel?.value||'').trim(),capital:c.capitalCity||'',lat:c.latitude?Number(c.latitude):null,lon:c.longitude?Number(c.longitude):null,aggregate:String(c.region?.id||'')==='NA'||!c.region?.id}));
}
export function wbIndicatorRows(page:any,countries:WbCountry[]|null,options:{includeAggregates?:boolean;keepMissing?:boolean}={}){
 if(Array.isArray(page)&&page[0]?.message)throw Error('World Bank: '+(page[0].message[0]?.value||'request failed'));
 const list:any[]=Array.isArray(page)&&Array.isArray(page[1])?page[1]:[];
 const meta=countries?new Map(countries.map(c=>[c.iso3,c])):null;
 const rows=list.filter(r=>{
  const iso3=String(r.countryiso3code||'');
  if(options.includeAggregates)return true;
  if(meta){const c=meta.get(iso3);return !!c&&!c.aggregate;}
  return /^[A-Z]{3}$/.test(iso3);
 }).map(r=>({name:r.country?.value,iso3:r.countryiso3code||null,value:r.value==null?null:Number(r.value),year:r.date?Number(r.date)||r.date:null}));
 const kept=options.keepMissing?rows:rows.filter(r=>r.value!=null&&Number.isFinite(r.value));
 return {indicator:list[0]?.indicator?{id:list[0].indicator.id,name:list[0].indicator.value}:null,rows:kept.slice().sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity)||String(a.name).localeCompare(String(b.name))),missing:rows.length-kept.length};
}
// Apple marketing RSS charts: results are already in chart order.
export const appleArtwork=(url:unknown,size=512)=>typeof url==='string'?url.replace(/\/\d+x\d+(bb)?\.(png|jpg|jpeg|webp)$/,'/'+size+'x'+size+'bb.$2'):null;
export function appleChartRows(json:any):PlainRow[]{
 return (Array.isArray(json?.feed?.results)?json.feed.results:[]).map((r:any,i:number)=>({rank:i+1,id:r.id,name:r.name,artist:r.artistName||null,genre:(r.genres||[]).map((g:any)=>g?.name).find((n:string)=>n&&!['Apps','Music','Books','Podcasts'].includes(n))||null,releaseDate:r.releaseDate||null,url:r.url||null,artwork:appleArtwork(r.artworkUrl100),kind:r.kind||null}));
}
export function appleSearchRow(r:any):PlainRow{
 return {id:r.trackId??r.collectionId??r.artistId,name:r.trackName??r.collectionName??r.artistName,developer:r.sellerName??r.artistName??null,genre:r.primaryGenreName??null,rating:r.averageUserRating??null,ratingCount:r.userRatingCount??null,price:r.price??null,formattedPrice:r.formattedPrice??null,releaseDate:r.releaseDate?String(r.releaseDate).slice(0,10):null,updated:r.currentVersionReleaseDate?String(r.currentVersionReleaseDate).slice(0,10):null,version:r.version??null,contentRating:r.contentAdvisoryRating??null,sizeMB:r.fileSizeBytes?Math.round(Number(r.fileSizeBytes)/1048576):null,url:r.trackViewUrl??r.collectionViewUrl??null,artwork:r.artworkUrl512??appleArtwork(r.artworkUrl100)};
}
// Overpass elements to rows: id, coordinates (or way/relation center), name and tags.
export function osmRows(json:any,maxTags=30):PlainRow[]{
 return (Array.isArray(json?.elements)?json.elements:[]).filter((e:any)=>e&&e.type!=='area').map((e:any)=>{
  const tags:Record<string,string>=e.tags||{};const kept=Object.entries(tags).filter(([k])=>!/^(name:(?!en$)|source|note|fixme|created_by|check_date)/.test(k)).slice(0,maxTags);
  return {osmType:e.type,osmId:e.id,name:tags.name??null,lat:e.lat??e.center?.lat??null,lon:e.lon??e.center?.lon??null,...Object.fromEntries(kept.filter(([k])=>k!=='name')),url:'https://www.openstreetmap.org/'+e.type+'/'+e.id};
 });
}
export function coinRow(c:any):PlainRow{
 return {rank:c.market_cap_rank??null,id:c.id,symbol:String(c.symbol||'').toUpperCase(),name:c.name,price:c.current_price??null,marketCap:c.market_cap??null,volume24h:c.total_volume??null,change24hPct:c.price_change_percentage_24h??null,change7dPct:c.price_change_percentage_7d_in_currency??null,circulatingSupply:c.circulating_supply??null,maxSupply:c.max_supply??null,allTimeHigh:c.ath??null,image:c.image??null};
}
const first=<T>(a:T[]|undefined)=>Array.isArray(a)&&a.length?a[0]:undefined;
const shortId=(id:unknown)=>typeof id==='string'?id.replace(/^https:\/\/openalex\.org\//,''):id;
export const OPENALEX_SELECT:Record<string,string>={
 works:'id,doi,title,publication_year,type,cited_by_count,primary_location,authorships,open_access',
 authors:'id,display_name,orcid,works_count,cited_by_count,summary_stats,last_known_institutions',
 institutions:'id,ror,display_name,country_code,type,homepage_url,image_thumbnail_url,works_count,cited_by_count,summary_stats',
 sources:'id,display_name,issn_l,type,host_organization_name,works_count,cited_by_count,summary_stats,homepage_url',
 topics:'id,display_name,description,field,subfield,domain,works_count,cited_by_count',
 publishers:'id,display_name,country_codes,hierarchy_level,works_count,cited_by_count,summary_stats',
 funders:'id,display_name,country_code,description,awards_count,works_count,cited_by_count,summary_stats',
};
export function openAlexRow(entity:string,r:any):PlainRow{
 const stats={hIndex:r.summary_stats?.h_index??null,i10Index:r.summary_stats?.i10_index??null,meanCitedness2yr:r.summary_stats?.['2yr_mean_citedness']??null};
 switch(entity){
  case 'works':return {id:shortId(r.id),title:r.title,year:r.publication_year,type:r.type,citedBy:r.cited_by_count,venue:r.primary_location?.source?.display_name??null,authors:(r.authorships||[]).slice(0,6).map((a:any)=>a.author?.display_name).filter(Boolean).join(', '),institutions:[...new Set((r.authorships||[]).flatMap((a:any)=>(a.institutions||[]).map((i:any)=>i.display_name)))].slice(0,4).join('; '),openAccess:r.open_access?.is_oa??null,doi:r.doi??null};
  case 'authors':{const inst=first(r.last_known_institutions) as any;return {id:shortId(r.id),name:r.display_name,institution:inst?.display_name??null,country:inst?.country_code??null,works:r.works_count,citedBy:r.cited_by_count,...stats,orcid:r.orcid??null};}
  case 'institutions':return {id:shortId(r.id),name:r.display_name,country:r.country_code??null,type:r.type??null,works:r.works_count,citedBy:r.cited_by_count,...stats,homepage:r.homepage_url??null,image:r.image_thumbnail_url??null,ror:r.ror??null};
  case 'sources':return {id:shortId(r.id),name:r.display_name,type:r.type??null,publisher:r.host_organization_name??null,issn:r.issn_l??null,works:r.works_count,citedBy:r.cited_by_count,...stats,homepage:r.homepage_url??null};
  case 'topics':return {id:shortId(r.id),name:r.display_name,field:r.field?.display_name??null,subfield:r.subfield?.display_name??null,domain:r.domain?.display_name??null,works:r.works_count,citedBy:r.cited_by_count,description:r.description??null};
  case 'publishers':return {id:shortId(r.id),name:r.display_name,countries:(r.country_codes||[]).join(','),works:r.works_count,citedBy:r.cited_by_count,...stats};
  default:return {id:shortId(r.id),name:r.display_name,country:r.country_code??null,awards:r.awards_count??null,works:r.works_count,citedBy:r.cited_by_count,...stats,description:r.description??null};
 }
}
export const stripHtml=(s:unknown)=>typeof s==='string'?s.replace(/<[^>]+>/g,'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim():s;
