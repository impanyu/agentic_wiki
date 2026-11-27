import type {Queryable} from '@/app/entity-db/client';
// Our own search inside a website. A third-party search engine finds which sites hold the data (site level); once a
// site is known, we list its pages ourselves — its robots.txt sitemaps, else Common Crawl's free URL index — fetch
// them politely in the background (robots.txt rules, one request per site at a time) and search them in our own
// full-text index (site_pages). Page-level searches then cost no third-party queries.
type Row=Record<string,unknown>;
const UA='RankWikiBot/1.0 (+https://rankwiki.aisoup.net; public data collection)';
const MAX_URLS=Number(process.env.SITE_INDEX_MAX_URLS||20000);
// Pages that likely hold data are fetched first.
const DATA_HINT=/\.(csv|tsv|xlsx?|json|xml|zip|ods)(\?|$)|\/(data|dataset|datasets|download|downloads|statistic|statistics|stats|table|tables|api|report|reports|database|registry|register|directory|list|ranking|rankings)\b/i;

export function domainOf(input:string):string{
 const s=String(input||'').trim();if(!s)throw Error('site: a domain (e.g. "nces.ed.gov") or an address on it.');
 let host:string;try{host=new URL(/^https?:\/\//i.test(s)?s:'https://'+s).hostname;}catch{throw Error('site: not a valid domain or address.');}
 host=host.toLowerCase().replace(/^www\./,'');if(!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host))throw Error('site: not a valid domain.');
 return host;
}
async function get(url:string,ms:number,maxBytes=8*1024*1024,anyType=true){
 const {fetchText}=await import('@/app/data-tools/net');
 const ac=new AbortController();const t=setTimeout(()=>ac.abort(),ms);
 try{return await fetchText(url,ac.signal,{anyType,maxBytes,headers:{'user-agent':UA},accept:'text/html,application/xml,text/xml,text/plain,*/*;q=0.5'});}finally{clearTimeout(t);}
}
// robots.txt: the sitemaps it names and the paths closed to every robot (User-agent: *).
function parseRobots(text:string){
 const sitemaps:string[]=[],disallow:string[]=[];let star=false;
 for(const raw of text.split(/\r?\n/)){const line=raw.replace(/#.*/,'').trim();const m=/^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);if(!m)continue;
  const k=m[1].toLowerCase(),v=m[2].trim();
  if(k==='sitemap'&&v)sitemaps.push(v);else if(k==='user-agent')star=v==='*';else if(k==='disallow'&&star&&v)disallow.push(v);}
 return {sitemaps,disallow};
}
const allowed=(url:string,disallow:string[])=>{try{const p=new URL(url).pathname;return !disallow.some(d=>p.startsWith(d.replace(/\*.*$/,'')));}catch{return false;}};
const sameSite=(url:string,domain:string)=>{try{const h=new URL(url).hostname.toLowerCase().replace(/^www\./,'');return h===domain||h.endsWith('.'+domain);}catch{return false;}};

async function fromSitemaps(start:string[],domain:string,deadline:number):Promise<string[]>{
 const queue=[...start],seen=new Set<string>(),urls=new Set<string>();
 while(queue.length&&urls.size<MAX_URLS&&seen.size<40&&Date.now()<deadline){
  const sm=queue.shift()!;if(seen.has(sm)||/\.gz$/i.test(sm))continue;seen.add(sm);
  const r=await get(sm,20_000).catch(()=>null);if(!r)continue;
  const locs=[...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m=>m[1].replace(/&amp;/g,'&'));
  if(/<sitemapindex/i.test(r.text))queue.push(...locs.filter(u=>sameSite(u,domain)));
  else for(const u of locs)if(sameSite(u,domain))urls.add(u);
 }
 return [...urls];
}
let ccIndex:{at:number;api:string}|null=null;
async function fromCommonCrawl(domain:string):Promise<string[]>{
 if(!ccIndex||Date.now()-ccIndex.at>7*86400_000){
  const r=await get('https://index.commoncrawl.org/collinfo.json',30_000,2*1024*1024);
  const list=JSON.parse(r.text) as {'cdx-api':string}[];ccIndex={at:Date.now(),api:list[0]['cdx-api']};
 }
 const r=await get(`${ccIndex.api}?url=${encodeURIComponent('*.'+domain)}&output=json&fl=url,mime&filter=statuscode:200&limit=${MAX_URLS}`,90_000,30*1024*1024).catch(()=>null);
 if(!r)return [];
 const urls=new Set<string>();
 for(const line of r.text.split('\n')){if(!line.trim())continue;try{const x=JSON.parse(line) as {url:string;mime?:string};if(!/image|video|audio|font|javascript|css/.test(x.mime||''))urls.add(x.url.replace(/^http:/,'https:'));}catch{}}
 return [...urls];
}

// Lists a site's pages (once; again after 30 days) into site_pages, pending fetch.
export async function discoverSite(db:Queryable,domain:string,{force=false}:{force?:boolean}={}):Promise<Row>{
 const known=(await db.query<{status:string;refreshed_at:string|null;urls:number}>('select status, refreshed_at, urls from site_domains where domain=$1',[domain])).rows[0];
 if(known&&!force&&known.status==='ready'&&known.refreshed_at&&Date.parse(known.refreshed_at)>Date.now()-30*86400_000)return {domain,status:'ready',urls:known.urls};
 await db.query(`insert into site_domains(domain,status) values ($1,'discovering') on conflict (domain) do update set status='discovering'`,[domain]);
 const deadline=Date.now()+60_000;
 const robots=await get(`https://${domain}/robots.txt`,15_000,1024*1024,true).then(r=>parseRobots(r.text)).catch(()=>({sitemaps:[] as string[],disallow:[] as string[]}));
 let urls=await fromSitemaps(robots.sitemaps.length?robots.sitemaps:[`https://${domain}/sitemap.xml`,`https://www.${domain}/sitemap.xml`],domain,deadline);
 let source='sitemap';
 // Sitemaps are often partial (a site's newest section only): Common Crawl's index adds what it has seen.
 {const cc=await fromCommonCrawl(domain).catch(()=>[]);if(cc.length){const before=urls.length;urls=[...new Set([...urls,...cc])];source=before?'sitemap+commoncrawl':'commoncrawl';}}
 urls=urls.filter(u=>allowed(u,robots.disallow)).slice(0,MAX_URLS);
 for(let i=0;i<urls.length;i+=1000){const part=urls.slice(i,i+1000);
  await db.query(`insert into site_pages(url,domain,priority) select u, $2, case when u ~* $3 then 1 else 0 end from unnest($1::text[]) u on conflict (url) do nothing`,[part,domain,DATA_HINT.source]);}
 await db.query(`update site_domains set status=$2, urls=(select count(*) from site_pages where domain=$1), source=$3, robots=$4::jsonb, refreshed_at=now(), error=null where domain=$1`,
  [domain,urls.length?'ready':'empty',source,JSON.stringify(robots.disallow.slice(0,200))]);
 return {domain,status:urls.length?'ready':'empty',urls:urls.length,source};
}

const strip=(html:string)=>html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&[a-z]+;|&#\d+;/gi,' ').replace(/\s+/g,' ').trim();
async function fetchPage(db:Queryable,url:string){
 const r=await get(url,25_000,3*1024*1024).catch(e=>({error:String((e as Error).message)}));
 if('error' in r){await db.query(`update site_pages set status='failed', fetched_at=now(), body=left($2,300) where url=$1`,[url,r.error]);return false;}
 const html=/html|xml/.test(r.type);
 const title=html?(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(r.text)?.[1]||'').replace(/\s+/g,' ').trim().slice(0,300):'';
 const body=html?strip(r.text):r.text.slice(0,4000);
 // Links to files and data on the page are indexed too (a page listing downloads is found by what it links to).
 const links=html?[...new Set([...r.text.matchAll(/href=["']([^"'#]+\.(?:csv|xlsx?|json|zip|ods|tsv)(?:\?[^"']*)?)["']/gi)].map(m=>{try{return new URL(m[1],url).href;}catch{return '';}}).filter(Boolean))].slice(0,50):[];
 // Pages of the same site it links to join the index (a crawl, bounded per site).
 if(html){const domain=(await db.query<{domain:string}>('select domain from site_pages where url=$1',[url])).rows[0]?.domain||domainOf(url);const out=[...new Set([...r.text.matchAll(/href=["']([^"'#\s]+)["']/gi)].map(m=>{try{const u=new URL(m[1],url);u.hash='';return u.href;}catch{return '';}})
   .filter(u=>/^https?:/.test(u)&&sameSite(u,domain)&&!/\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|mp4|mp3)(\?|$)/i.test(u)))].slice(0,300);
  if(out.length)await db.query(`insert into site_pages(url,domain,priority) select u, $2, case when u ~* $3 then 1 else 0 end from unnest($1::text[]) u
    where (select count(*) from site_pages where domain=$2) < $4::int on conflict (url) do nothing`,[out,domain,DATA_HINT.source,MAX_URLS]).catch(()=>{});}
 await db.query(`update site_pages set status='ok', fetched_at=now(), title=$2, body=left($3,20000), content_type=$4, data_links=$5::text[], extra=$6 where url=$1`,[url,title,body,r.type,links,links.join(' ').replace(/[^A-Za-z0-9]+/g,' ')]);
 return true;
}
// Background: fetch pending pages, data-like ones first, one request per site at a time, within a time budget.
export async function fetchPending(db:Queryable,{budgetMs=60_000,perSiteGapMs=1500}:{budgetMs?:number;perSiteGapMs?:number}={}):Promise<number>{
 const end=Date.now()+budgetMs;let n=0;const last=new Map<string,number>();
 while(Date.now()<end){
  const rows=(await db.query<{url:string;domain:string}>(`select distinct on (domain) url, domain from site_pages where status='pending' order by domain, priority desc, url limit 20`)).rows;
  if(!rows.length)break;
  await Promise.all(rows.map(async r=>{const wait=(last.get(r.domain)||0)+perSiteGapMs-Date.now();if(wait>0)await new Promise(x=>setTimeout(x,wait));
   last.set(r.domain,Date.now());if(await fetchPage(db,r.url))n++;}));
 }
 return n;
}
// Search one site: its pages by words in the address, title, text and linked files. A site not listed yet is listed
// now; the best unfetched matches are fetched at once so their text counts.
export async function siteSearch(db:Queryable,site:string,query:string,count=10):Promise<Row>{
 const domain=domainOf(site);const q=String(query||'').trim();if(!q)throw Error('query: what to look for on the site.');
 const d=await discoverSite(db,domain);
 const find=()=>db.query<{url:string;title:string;snippet:string;status:string;data_links:string[]|null;rank:number}>(`select url, coalesce(title,'') title, status, data_links,
   left(coalesce(ts_headline('simple', body, websearch_to_tsquery('simple',$2), 'MaxFragments=2,MaxWords=25,MinWords=8'),''),400) snippet, ts_rank(tsv, websearch_to_tsquery('simple',$2)) rank
  from site_pages where domain=$1 and tsv @@ websearch_to_tsquery('simple',$2) order by rank desc, priority desc limit $3::int`,[domain,q,Math.min(50,Math.max(1,count))]).then(r=>r.rows);
 let rows=await find();
 // An OR of the words when all of them together find nothing.
 if(!rows.length){const any=q.split(/\s+/).filter(w=>w.length>2).join(' or ');if(any&&any!==q)rows=await db.query<{url:string;title:string;snippet:string;status:string;data_links:string[]|null;rank:number}>(`select url, coalesce(title,'') title, status, data_links, '' snippet, ts_rank(tsv, websearch_to_tsquery('simple',$2)) rank from site_pages where domain=$1 and tsv @@ websearch_to_tsquery('simple',$2) order by rank desc, priority desc limit $3::int`,[domain,any,count]).then(r=>r.rows);}
 const unfetched=rows.filter(r=>r.status==='pending').slice(0,6);
 if(unfetched.length){await Promise.all(unfetched.map(r=>fetchPage(db,r.url).catch(()=>false)));rows=(await find())||rows;}
 const stats=(await db.query<{urls:number;fetched:number}>(`select count(*)::int urls, count(*) filter (where status='ok')::int fetched from site_pages where domain=$1`,[domain])).rows[0];
 return {site:domain,indexed:stats,source:d.source,results:rows.map(r=>({url:r.url,title:r.title,snippet:r.snippet,dataLinks:(r.data_links||[]).slice(0,10)})),
  note:stats.fetched<stats.urls?'The site is still being read in the background; addresses match now, page text as pages are fetched.':undefined};
}
