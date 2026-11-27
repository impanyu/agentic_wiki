// Unit normalization for stored facts: every metric is stored in one base unit, so values from
// different sources compare and rank correctly ("million USD" 2,500,000 and "USD" 2.5e12 are the same
// thing). Scale words (thousand, million, billion, trillion, 万, 亿, k, M, bn…) are multiplied out;
// imperial area, length and mass are converted to SI. Currencies stay in their own code (converting
// between currencies needs a dated rate — a separate, explicit metric). Unknown units pass unchanged.
const SCALES:[RegExp,number][]=[
 [/\b(trillions?|tn|tril)\b/i,1e12],[/\b(billions?|bn|bil|bln)\b/i,1e9],[/\b(millions?|mn|mil|mln|mio)\b/i,1e6],[/\b(thousands?|thou)\b/i,1e3],
 [/亿/,1e8],[/千万/,1e7],[/百万/,1e6],[/万/,1e4],[/千/,1e3],
];
// Single-letter scales only next to a currency or number word ("USD bn", "$M", "US$ 5k").
const LETTER=/(?:^|[\s$€£¥(])([kKmMbBtT])(?=$|[\s)])/;
const LETTER_SCALE:Record<string,number>={k:1e3,m:1e6,b:1e9,t:1e12};
const CONVERT:[RegExp,string,number][]=[
 // A share given as 0–1 (many statistical files) is stored as a percentage.
 [/^(fraction|proportion|share 0-1|ratio 0-1)$/i,'%',100],
 [/^(sq\.?\s*mi|square\s+miles?|mi2|mi²)$/i,'km2',2.589988110336],
 [/^(sq\.?\s*km|square\s+kilomet(er|re)s?|km2|km²|平方公里|平方千米)$/i,'km2',1],
 [/^(hectares?|ha)$/i,'km2',0.01],
 [/^(acres?)$/i,'km2',0.0040468564224],
 [/^(sq\.?\s*m|square\s+met(er|re)s?|m2|m²|平方米)$/i,'m2',1],
 [/^(sq\.?\s*ft|square\s+f(ee|oo)t|ft2|ft²)$/i,'m2',0.09290304],
 [/^(miles?|mi)$/i,'km',1.609344],[/^(kilomet(er|re)s?|km|公里|千米)$/i,'km',1],
 [/^(feet|foot|ft)$/i,'m',0.3048],[/^(met(er|re)s?|m|米)$/i,'m',1],
 [/^(pounds?|lbs?)$/i,'kg',0.45359237],[/^(kilograms?|kg|公斤|千克)$/i,'kg',1],
 [/^(people|persons?|inhabitants|population|人|人口)$/i,'people',1],
];
const CURRENCY=/US\$|\b(USD|EUR|GBP|JPY|CNY|RMB|INR|CHF|CAD|AUD)\b|[$€£¥]|美元|人民币|欧元/;
const CURRENCY_CODE:Record<string,string>={'US$':'USD','$':'USD','€':'EUR','£':'GBP','¥':'JPY',RMB:'CNY','美元':'USD','人民币':'CNY','欧元':'EUR'};
export type NormalizedUnit={unit:string;factor:number;changed:boolean};
export function normalizeUnit(raw:string):NormalizedUnit{
 const original=String(raw||'').trim();if(!original)return {unit:'',factor:1,changed:false};
 let rest=original,factor=1;
 for(const [re,f] of SCALES)if(re.test(rest)){factor*=f;rest=rest.replace(re,' ');break;}
 const cur=CURRENCY.exec(rest);
 if(factor===1&&cur){const m=LETTER.exec(rest.replace(cur[0],' '+cur[0]+' '));if(m){factor*=LETTER_SCALE[m[1].toLowerCase()];rest=rest.replace(new RegExp('(^|[\\s$€£¥(])'+m[1]+'(?=$|[\\s)])'),'$1');}}
 rest=rest.replace(/\b(of|in)\b/gi,' ').replace(/[()]/g,' ').replace(/\s+/g,' ').trim();
 if(cur){const code=CURRENCY_CODE[cur[0]]??cur[0].toUpperCase();const extra=rest.replace(cur[0],'').replace(/元/g,'').replace(/^current\s*|\s*current$/i,'').trim();
  const unit=extra&&!/^(nominal|current|constant)$/i.test(extra)?code+' '+extra:code;return {unit,factor,changed:factor!==1||unit!==original};}
 for(const [re,unit,f] of CONVERT)if(re.test(rest))return {unit,factor:factor*f,changed:factor*f!==1||unit!==original};
 return {unit:factor!==1?rest:rest||original,factor,changed:factor!==1};
}
