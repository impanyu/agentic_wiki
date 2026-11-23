// Outbound links of an entity page: the 1–3 places a reader most likely wants next for the real thing, chosen by
// what kind of entity it is — a country's official site and Wikipedia, a product's official page and its store
// listings, a person's site, Wikipedia and main public profile. Drawn from the entity's own data (attributes holding
// web addresses, standard ids); shown prominently under the title. The collector gathers them (see the team rules).
export type OutboundLink={label:string;href:string;host:string;primary:boolean};
type Kind='official'|'product'|'store'|'wikipedia'|'social'|'profile'|'media'|'code'|'paper'|'app'|'quote'|'map'|'other';
// Known hosts: a readable label and what the link is.
const HOSTS:[RegExp,string,Kind][]=[
 [/(^|\.)wikipedia\.org$/,'Wikipedia','wikipedia'],
 [/(^|\.)amazon\.[a-z.]+$/,'Amazon','store'],[/(^|\.)jd\.com$/,'JD.com','store'],[/(^|\.)tmall\.com$/,'Tmall','store'],[/(^|\.)taobao\.com$/,'Taobao','store'],
 [/(^|\.)flipkart\.com$/,'Flipkart','store'],[/(^|\.)rakuten\.[a-z.]+$/,'Rakuten','store'],[/(^|\.)coupang\.com$/,'Coupang','store'],[/(^|\.)mercadoli[bv]re\.[a-z.]+$/,'Mercado Libre','store'],
 [/(^|\.)shopee\.[a-z.]+$/,'Shopee','store'],[/(^|\.)lazada\.[a-z.]+$/,'Lazada','store'],[/(^|\.)jumia\.[a-z.]+$/,'Jumia','store'],[/(^|\.)noon\.com$/,'Noon','store'],
 [/(^|\.)walmart\.com$/,'Walmart','store'],[/(^|\.)bestbuy\.com$/,'Best Buy','store'],[/(^|\.)ebay\.[a-z.]+$/,'eBay','store'],[/(^|\.)aliexpress\.com$/,'AliExpress','store'],[/(^|\.)target\.com$/,'Target','store'],
 [/(^|\.)linkedin\.com$/,'LinkedIn','social'],[/(^|\.)(x|twitter)\.com$/,'X','social'],[/(^|\.)instagram\.com$/,'Instagram','social'],[/(^|\.)tiktok\.com$/,'TikTok','social'],
 [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/,'YouTube','social'],[/(^|\.)facebook\.com$/,'Facebook','social'],[/(^|\.)weibo\.com$/,'Weibo','social'],[/(^|\.)bilibili\.com$/,'Bilibili','social'],
 [/(^|\.)douyin\.com$/,'Douyin','social'],[/(^|\.)twitch\.tv$/,'Twitch','social'],
 [/(^|\.)imdb\.com$/,'IMDb','profile'],[/(^|\.)spotify\.com$/,'Spotify','media'],[/(^|\.)music\.apple\.com$/,'Apple Music','media'],[/(^|\.)netflix\.com$/,'Netflix','media'],
 [/(^|\.)github\.com$/,'GitHub','code'],[/(^|\.)(npmjs\.com|pypi\.org|crates\.io)$/,'Package','code'],
 [/(^|\.)doi\.org$|(^|\.)arxiv\.org$/,'Paper','paper'],[/(^|\.)apps\.apple\.com$/,'App Store','app'],[/(^|\.)play\.google\.com$/,'Google Play','app'],[/(^|\.)store\.steampowered\.com$/,'Steam','app'],
 [/(^|\.)(nasdaq\.com|nyse\.com|finance\.yahoo\.com|google\.com\/finance)$/,'Stock quote','quote'],
 [/(^|\.)(openstreetmap\.org|google\.[a-z.]+\/maps)$/,'Map','map'],
 [/(^|\.)orcid\.org$|(^|\.)scholar\.google\.com$/,'Scholar profile','profile'],
];
// Attribute names that say what a link is.
const KEYS:[RegExp,Kind][]=[
 [/^(official_?)?(website|homepage|home_?page|site|official_url)$/,'official'],
 [/^product(_?url|_?page)?$/,'product'],
 [/(buy|shop|store|purchase|order)(_?url|_?page|_?link)?$/,'store'],
 [/wikipedia|enwiki/,'wikipedia'],
 [/linkedin|twitter|^x_?url$|instagram|tiktok|youtube|facebook|weibo|bilibili|douyin|twitch|social/,'social'],
 [/imdb|orcid|scholar/,'profile'],[/spotify|apple_?music|stream/,'media'],[/github|repo|package/,'code'],[/doi|arxiv|paper/,'paper'],
 [/app_?store|play_?store|steam/,'app'],[/quote|investor|stock/,'quote'],
];
// What a reader of each kind of entity needs first.
// Always its own homepage first (for a product, its product page), then Wikipedia, then what suits the kind.
const ORDER:Record<string,Kind[]>={
 person:['official','wikipedia','profile','social','media'],
 product:['product','official','wikipedia','store'],
 organization:['official','wikipedia','quote','social'],
 place:['official','wikipedia','map'],
 work:['official','wikipedia','media','app','code','paper','profile','store'],
 other:['official','product','wikipedia','store','profile','social','media','app','code','paper','quote','map'],
};
const KINDS:Kind[]=['official','product','store','wikipedia','social','profile','media','code','paper','app','quote','map','other'];
const PERSON=/(person|people|player|actor|actress|singer|musician|artist|athlete|creator|influencer|youtuber|streamer|scientist|researcher|author|writer|politician|leader|official|coach|driver|director|chef|model|ceo|founder|footballer|cricketer|golfer|boxer|fighter|vtuber|presenter|comedian|economist|judge|astronaut)/;
const PLACE=/(country|city|town|region|state|province|district|county|municipality|place|park|mountain|lake|river|island|beach|attraction|site|landmark|airport|port|station|trail|campground|resort|destination|neighbou?rhood|village)/;
const WORK=/(film|movie|series|show|book|novel|song|album|game|app|software|package|repo|paper|podcast|video|channel|anime|manga|drama|framework|library|language)/;
const ORG=/(company|brand|university|college|school|bank|hospital|organization|organisation|agency|club|team|firm|startup|publisher|manufacturer|maker|retailer|airline|operator|insurer|broker|fund|museum|party|ngo|association|league|government|ministry|exchange)/;
export function entityKind(type:string,attributes:Record<string,unknown>):keyof typeof ORDER{
 const t=type.toLowerCase();
 if(PERSON.test(t))return 'person';if(PLACE.test(t))return 'place';if(WORK.test(t))return 'work';if(ORG.test(t))return 'organization';
 // A thing with a store or product page is sold: a product.
 if(Object.keys(attributes||{}).some(k=>/buy|shop|store|product_?(url|page)|price/i.test(k)))return 'product';
 return 'other';
}
const labelOf=(kind:Kind,host:string,key:string)=>kind==='official'?'Official website':kind==='product'?'Product page':kind==='wikipedia'?'Wikipedia':kind==='map'?'Map'
 :key.replace(/_?url$|_?link$/,'').replace(/[_-]+/g,' ').replace(/^./,c=>c.toUpperCase())||host;
// Standard identifiers → the public page they name (a researcher's OpenAlex and ORCID profiles, a film's IMDb page,
// a paper's DOI, a company's LEI record), so every entity with an id has somewhere to go.
const ID_LINKS:[RegExp,(v:string)=>string|null,string,Kind][]=[
 [/^openalex$/,v=>/^[AWISCFPT]\d+$/i.test(v.replace(/^.*\//,''))?'https://openalex.org/'+v.replace(/^.*\//,''):null,'OpenAlex profile','profile'],
 [/^orcid$/,v=>{const m=/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i.exec(v);return m?'https://orcid.org/'+m[1]:null;},'ORCID','profile'],
 [/^imdb$/,v=>/^nm\d+$/.test(v)?'https://www.imdb.com/name/'+v+'/':/^tt\d+$/.test(v)?'https://www.imdb.com/title/'+v+'/':null,'IMDb','profile'],
 [/^doi$/,v=>/^10\.\d{4,}\//.test(v.replace(/^https?:\/\/(dx\.)?doi\.org\//,''))?'https://doi.org/'+v.replace(/^https?:\/\/(dx\.)?doi\.org\//,''):null,'Paper','paper'],
 [/^github$/,v=>/^[\w.-]+(\/[\w.-]+)?$/.test(v)?'https://github.com/'+v:null,'GitHub','code'],
 [/^lei$/,v=>/^[A-Z0-9]{20}$/.test(v)?'https://search.gleif.org/#/record/'+v:null,'LEI record','other'],
 [/^isbn(13)?$/,v=>/^[\dX-]{10,17}$/.test(v)?'https://openlibrary.org/isbn/'+v.replace(/-/g,''):null,'Open Library','other'],
 [/^icao$/,v=>/^[A-Z0-9]{4}$/.test(v)?'https://ourairports.com/airports/'+v+'/':null,'OurAirports','other'],
 [/^(osm|openstreetmap)$/,v=>/^(node|way|relation)\/\d+$/.test(v)?'https://www.openstreetmap.org/'+v:null,'Map','map'],
 [/^geonames$/,v=>/^\d+$/.test(v)?'https://www.geonames.org/'+v:null,'GeoNames','other'],
 [/^(steam|steam_appid)$/,v=>/^\d+$/.test(v)?'https://store.steampowered.com/app/'+v+'/':null,'Steam','app'],
 [/^spotify$/,v=>/^[A-Za-z0-9]{22}$/.test(v)?'https://open.spotify.com/artist/'+v:null,'Spotify','media'],
 [/^(ticker|stock)$/,v=>/^[A-Z.\-]{1,10}$/.test(v)?'https://finance.yahoo.com/quote/'+v:null,'Stock quote','quote'],
];
// prefer: the editor's order for this type (template.links, e.g. ["official","profile","wikipedia"]), else by kind.
export function outboundLinks(entity:{type?:string;name?:string;attributes:Record<string,unknown>;ids:Record<string,string>},max=3,prefer?:unknown):OutboundLink[]{
 const attrs=entity.attributes||{};
 const kind=entityKind(String(entity.type||''),attrs);
 const custom=Array.isArray(prefer)?prefer.filter((k):k is Kind=>KINDS.includes(k as Kind)):[];
 const order=custom.length?[...custom,...ORDER[kind].filter(k=>!custom.includes(k))]:ORDER[kind];
 const found:{kind:Kind;label:string;href:string;host:string}[]=[];
 const add=(href:string,key:string)=>{
  let u:URL;try{u=new URL(href);}catch{return;}
  if(u.protocol!=='https:'&&u.protocol!=='http:')return;
  if(found.some(x=>x.href===u.href))return;
  const host=u.hostname.replace(/^www\./,''),hostPath=host+u.pathname;
  const byHost=HOSTS.find(([re])=>re.test(host)||re.test(hostPath));
  const byKey=KEYS.find(([re])=>re.test(key))?.[1];
  // The attribute name says what the link is for (an official site hosted anywhere); a known host names it.
  const k:Kind=byKey==='official'||byKey==='product'?byKey:byHost?.[2]??byKey??'other';
  found.push({kind:k,label:byHost&&k!=='official'&&k!=='product'?byHost[1]:labelOf(k,host,key),href:u.href,host});
 };
 for(const [k,v] of Object.entries(attrs)){
  // Pictures (a flag, a logo, an image file) are shown, not linked to.
  if(/flag|logo|image|photo|picture|icon|thumbnail/i.test(k))continue;
  for(const x of (Array.isArray(v)?v:[v]).slice(0,4))if(typeof x==='string'&&/^https?:\/\//i.test(x.trim())&&!/\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(x.trim()))add(x.trim(),k.toLowerCase());
 }
 for(const [k,v] of Object.entries(entity.ids||{})){const hit=ID_LINKS.find(([re])=>re.test(k.toLowerCase()));if(!hit)continue;
  const href=hit[1](String(v).trim());if(href&&!found.some(x=>x.href===href))found.push({kind:hit[3],label:hit[2],href,host:new URL(href).hostname.replace(/^www\./,'')});}
 // A place with coordinates gets a map link.
 const lat=Number(attrs.lat??attrs.latitude),lon=Number(attrs.lon??attrs.lng??attrs.longitude);
 if(kind==='place'&&Number.isFinite(lat)&&Number.isFinite(lon)&&(lat||lon))found.push({kind:'map',label:'Map',href:`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=10/${lat}/${lon}`,host:'openstreetmap.org'});
 const pick:typeof found=[];
 for(const k of order){
  // Stores: up to two different platforms; every other kind: its first link.
  const of=found.filter(x=>x.kind===k&&!pick.includes(x));
  for(const x of of.slice(0,k==='store'||k==='profile'?2:1))if(pick.length<max&&!pick.some(p=>p.host===x.host))pick.push(x);
 }
 // Links of kinds this entity's order does not name, before falling back.
 for(const x of found)if(pick.length<max&&!pick.includes(x)&&!pick.some(p=>p.host===x.host)&&!order.includes(x.kind))pick.push(x);
 // A Wikidata id and no Wikipedia link yet: Wikidata sends the reader on to the entity's Wikipedia article.
 const wd=String(entity.ids?.wikidata||'').replace(/^.*\//,'');
 if(pick.length<max&&/^Q\d+$/.test(wd)&&!pick.some(p=>p.host.endsWith('wikipedia.org')))pick.push({kind:'wikipedia',label:'Wikipedia',href:'https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/'+wd,host:'wikipedia.org'});
 // Every entity has at least one way out: Wikipedia's search, which opens the article when one has this name.
 if(!pick.length&&entity.name)pick.push({kind:'wikipedia',label:'Wikipedia',href:'https://en.wikipedia.org/w/index.php?search='+encodeURIComponent(entity.name)+'&go=Go',host:'wikipedia.org'});
 return pick.slice(0,max).map((x,i)=>({label:x.label,href:x.href,host:x.host,primary:i===0}));
}
