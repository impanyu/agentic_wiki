import type {Queryable} from '@/app/entity-db/client';
// Every entity with a page gets a short introduction (1–3 sentences) and a picture: where the collectors left them
// out, the heartbeat takes the lead of the entity's English Wikipedia article (Wikimedia REST summary API; attributed
// on the page as "From Wikipedia", CC BY-SA) and its lead image. Only entities with a Wikidata id or a Wikipedia URL,
// a few per minute; an entity tried without success is not tried again for a week.
const UA='RankWiki/1.0 (https://rankwiki.aisoup.net; entity introductions)';
const sentences=(s:string,max=3)=>{const parts=s.replace(/\s+/g,' ').trim().match(/[^.!?。！？]+[.!?。！？]+(\s|$)/g)||[s];let out='';for(const p of parts.slice(0,max)){if((out+p).length>480)break;out+=p;}return (out||s.slice(0,480)).trim();};
async function json(url:string,signal:AbortSignal){const r=await fetch(url,{headers:{'user-agent':UA,accept:'application/json'},signal});if(!r.ok)throw Error(String(r.status));return r.json() as Promise<any>;}
async function wikipediaTitle(e:{ids:Record<string,string>;attributes:Record<string,unknown>},signal:AbortSignal):Promise<string|null>{
 const w=e.attributes?.wikipedia;
 if(typeof w==='string'){const m=/en\.wikipedia\.org\/wiki\/([^?#]+)/.exec(w);if(m)return decodeURIComponent(m[1]);}
 const q=String(e.ids?.wikidata||'').replace(/^.*\//,'');if(!/^Q\d+$/.test(q))return null;
 const d=await json(`https://www.wikidata.org/wiki/Special:EntityData/${q}.json`,signal);
 return d?.entities?.[q]?.sitelinks?.enwiki?.title??null;
}
export async function fillIntroductions(db:Queryable,limit=8):Promise<number>{
 const rows=(await db.query<{id:string;ids:Record<string,string>;attributes:Record<string,unknown>;image:string|null;description:string}>(`select id, ids, attributes, image, description from entities
  where has_page and (description = '' or image is null) and (ids ? 'wikidata' or attributes ? 'wikipedia')
   and coalesce((attributes->>'intro_checked_at')::timestamptz, 'epoch') < now() - interval '7 days'
  order by updated_at desc limit $1::int`,[limit])).rows;
 let n=0;
 for(const e of rows){
  const signal=AbortSignal.timeout(20000);
  try{
   const title=await wikipediaTitle(e,signal);const patch:Record<string,unknown>={intro_checked_at:new Date().toISOString()};let desc:string|null=null,img:string|null=null;
   if(title){
    const s=await json('https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(title.replace(/ /g,'_')),signal);
    if(s?.type!=='disambiguation'){
     if(!e.description&&typeof s?.extract==='string'&&s.extract.length>40){desc=sentences(s.extract);patch.description_source='https://en.wikipedia.org/wiki/'+encodeURIComponent(title.replace(/ /g,'_'));patch.wikipedia??=patch.description_source;}
     if(!e.image&&typeof s?.originalimage?.source==='string')img=s.thumbnail?.source||s.originalimage.source;
    }
   }
   await db.query(`update entities set description = case when $2::text is not null then $2::text else description end, image = coalesce(image, $3::text),
     attributes = attributes || $4::jsonb, updated_at = now() where id = $1::uuid`,[e.id,desc,img,JSON.stringify(e.attributes?.wikipedia?{intro_checked_at:patch.intro_checked_at,...(desc?{description_source:patch.description_source}:{})}:patch)]);
   if(desc||img)n++;
  }catch{await db.query(`update entities set attributes = attributes || jsonb_build_object('intro_checked_at', now()::text) where id = $1::uuid`,[e.id]).catch(()=>{});}
 }
 return n;
}
