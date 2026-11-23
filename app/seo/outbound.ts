// Outbound links of an entity page: where a reader goes next for the real thing — the official website, the
// product or purchase page, then reference works. Drawn from the entity's own data (attributes holding web
// addresses, standard ids); shown prominently under the title. The collector gathers them (see the team rules).
export type OutboundLink={label:string;href:string;host:string;primary:boolean};
const KINDS:{re:RegExp;label:string;primary:boolean;order:number}[]=[
 {re:/^(official_?)?(website|homepage|home_?page|site|url|official_url)$/,label:'Official website',primary:true,order:0},
 {re:/(buy|shop|store|purchase|order)(_?url|_?page|_?link)?$/,label:'Buy',primary:true,order:1},
 {re:/^product(_?url|_?page)?$/,label:'Product page',primary:true,order:2},
 {re:/wikipedia|enwiki/,label:'Wikipedia',primary:false,order:5},
];
const pretty=(k:string)=>k.replace(/_?url$|_?link$/,'').replace(/[_-]+/g,' ').replace(/^./,c=>c.toUpperCase());
export function outboundLinks(entity:{attributes:Record<string,unknown>;ids:Record<string,string>}):OutboundLink[]{
 const out:(OutboundLink&{order:number})[]=[];
 const add=(label:string,href:string,primary:boolean,order:number)=>{
  let u:URL;try{u=new URL(href);}catch{return;}
  if(u.protocol!=='https:'&&u.protocol!=='http:')return;
  if(out.some(x=>x.href===u.href))return;
  out.push({label,href:u.href,host:u.hostname.replace(/^www\./,''),primary,order});
 };
 for(const [k,v] of Object.entries(entity.attributes||{})){
  // Pictures (a flag, a logo, an image file) are shown, not linked to.
  if(/flag|logo|image|photo|picture|icon|thumbnail/i.test(k))continue;
  const vals=(Array.isArray(v)?v:[v]).filter((x):x is string=>typeof x==='string'&&/^https?:\/\//i.test(x.trim())&&!/\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(x.trim()));
  if(!vals.length)continue;const key=k.toLowerCase();
  const kind=KINDS.find(x=>x.re.test(key));
  for(const x of vals.slice(0,2))add(kind?.label??pretty(k),x.trim(),kind?.primary??false,kind?.order??4);
 }
 const wd=entity.ids?.wikidata;if(wd&&/^Q\d+$/.test(String(wd).replace(/^.*\//,'')))add('Wikidata','https://www.wikidata.org/wiki/'+String(wd).replace(/^.*\//,''),false,6);
 return out.sort((a,b)=>a.order-b.order).slice(0,6).map(({order:_,...x})=>x);
}
