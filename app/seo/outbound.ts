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
const ORDER:Record<string,Kind[]>={
 person:['official','wikipedia','social','profile','media'],
 product:['product','store','official','wikipedia'],
 organization:['official','wikipedia','social','quote'],
 place:['official','wikipedia','map'],
 work:['official','media','app','code','paper','wikipedia','profile','store'],
 other:['official','product','store','wikipedia','social','media','app','code','paper','profile','quote','map'],
};
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
export function outboundLinks(entity:{type?:string;attributes:Record<string,unknown>;ids:Record<string,string>},max=3):OutboundLink[]{
 const attrs=entity.attributes||{};
 const kind=entityKind(String(entity.type||''),attrs),order=ORDER[kind];
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
 // A place with coordinates gets a map link.
 const lat=Number(attrs.lat??attrs.latitude),lon=Number(attrs.lon??attrs.lng??attrs.longitude);
 if(kind==='place'&&Number.isFinite(lat)&&Number.isFinite(lon)&&(lat||lon))found.push({kind:'map',label:'Map',href:`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=10/${lat}/${lon}`,host:'openstreetmap.org'});
 const pick:typeof found=[];
 for(const k of order){
  // Stores: up to two different platforms; every other kind: its first link.
  const of=found.filter(x=>x.kind===k&&!pick.includes(x));
  for(const x of of.slice(0,k==='store'?2:1))if(pick.length<max&&!pick.some(p=>p.host===x.host))pick.push(x);
 }
 // Wikidata only when nothing better exists.
 const wd=String(entity.ids?.wikidata||'').replace(/^.*\//,'');
 if(pick.length<2&&/^Q\d+$/.test(wd))pick.push({kind:'other',label:'Wikidata',href:'https://www.wikidata.org/wiki/'+wd,host:'wikidata.org'});
 return pick.slice(0,max).map((x,i)=>({label:x.label,href:x.href,host:x.host,primary:i===0}));
}
