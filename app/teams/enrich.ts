import type {Queryable} from '@/app/entity-db/client';
// Every entity with a page gets a short introduction (1–3 sentences) and a picture: where the collectors left them
// out, the heartbeat takes the lead of the entity's English Wikipedia article (Wikimedia REST summary API; attributed
// on the page as "From Wikipedia", CC BY-SA) and its lead image. Only entities with a Wikidata id or a Wikipedia URL,
// a few per minute; an entity tried without success is not tried again for a week.
const UA='RankWiki/1.0 (https://rankwiki.aisoup.net; entity introductions)';
const sentences=(s:string,max=3)=>{const parts=s.replace(/\s+/g,' ').trim().match(/[^.!?。！？]+[.!?。！？]+(\s|$)/g)||[s];let out='';for(const p of parts.slice(0,max)){if((out+p).length>480)break;out+=p;}return (out||s.slice(0,480)).trim();};
async function json(url:string,signal:AbortSignal){const r=await fetch(url,{headers:{'user-agent':UA,accept:'application/json'},signal});if(!r.ok)throw Error(String(r.status));return r.json() as Promise<any>;}
// The entity's Wikidata item: its own id, or the item holding one of its other ids (ORCID P496, OpenAlex P10283,
// IMDb P345).
const BY_ID:[string,string,(v:string)=>string][]=[['orcid','P496',v=>(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i.exec(v)||[])[1]||''],
 ['openalex','P10283',v=>v.replace(/^.*\//,'')],['imdb','P345',v=>v]];
async function wikidataId(e:{ids:Record<string,string>},signal:AbortSignal):Promise<string|null>{
 const own=String(e.ids?.wikidata||'').replace(/^.*\//,'');if(/^Q\d+$/.test(own))return own;
 for(const [key,prop,norm] of BY_ID){const v=norm(String(e.ids?.[key]||'').trim());if(!v)continue;
  const d=await json('https://www.wikidata.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch='+encodeURIComponent('haswbstatement:'+prop+'='+v),signal);
  const q=d?.query?.search?.[0]?.title;if(typeof q==='string'&&/^Q\d+$/.test(q))return q;}
 return null;
}
// Fills, for every entity with a page: its links (homepage = Wikidata P856, English Wikipedia article = the enwiki
// sitelink, and the Wikidata id itself), its introduction (the lead of the Wikipedia article, credited) and its
// picture — whatever the collectors left out. Checked again after a week when nothing was found.
// Entities still missing an introduction, picture or links; the same predicate as the partial index entities_intro_due
// (schema v17), so the minute's batch is read from the index instead of the whole table.
export const INTRO_DUE=`has_page and (description = '' or image is null or not (attributes ? 'wikipedia') or not (attributes ? 'website'))
   and (ids ?| array['wikidata','orcid','openalex','imdb'] or attributes ? 'wikipedia')`;
export async function fillIntroductions(db:Queryable,limit=40):Promise<number>{
 const rows=(await db.query<{id:string;ids:Record<string,string>;attributes:Record<string,unknown>;image:string|null;description:string}>(`select id, ids, attributes, image, description from entities
  where ${INTRO_DUE}
   and (attributes->>'intro_checked_at' is null or attributes->>'intro_checked_at' < $2::text)
  order by attributes->>'intro_checked_at' nulls first limit $1::int`,[limit,new Date(Date.now()-7*864e5).toISOString()])).rows;
 let n=0;
 const one=async(e:typeof rows[number])=>{
  const signal=AbortSignal.timeout(25000);
  try{
   const patch:Record<string,unknown>={intro_checked_at:new Date().toISOString()};const idPatch:Record<string,string>={};
   let title:string|null=null;
   const w=e.attributes?.wikipedia;if(typeof w==='string'){const m=/en\.wikipedia\.org\/wiki\/([^?#]+)/.exec(w);if(m)title=decodeURIComponent(m[1]);}
   if(!title||!e.attributes?.website){
    const q=await wikidataId(e,signal);
    if(q){
     if(!e.ids?.wikidata)idPatch.wikidata=q;
     const d=await json(`https://www.wikidata.org/wiki/Special:EntityData/${q}.json`,signal);const item=d?.entities?.[q];
     title??=item?.sitelinks?.enwiki?.title??null;
     const site=item?.claims?.P856?.find((c:any)=>c?.rank!=='deprecated')?.mainsnak?.datavalue?.value;
     if(!e.attributes?.website&&typeof site==='string'&&/^https?:\/\//.test(site))patch.website=site;
    }
   }
   if(title&&!e.attributes?.wikipedia)patch.wikipedia='https://en.wikipedia.org/wiki/'+encodeURIComponent(title.replace(/ /g,'_'));
   let desc:string|null=null,img:string|null=null;
   if(title&&(!e.description||!e.image)){
    const s=await json('https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(title.replace(/ /g,'_')),signal);
    if(s?.type==='disambiguation')delete patch.wikipedia;
    else{
     if(!e.description&&typeof s?.extract==='string'&&s.extract.length>40){desc=sentences(s.extract);patch.description_source='https://en.wikipedia.org/wiki/'+encodeURIComponent(title.replace(/ /g,'_'));}
     if(!e.image&&typeof s?.originalimage?.source==='string')img=s.thumbnail?.source||s.originalimage.source;
    }
   }
   await db.query(`update entities set description = case when $2::text is not null then $2::text else description end, image = coalesce(image, $3::text),
     attributes = attributes || $4::jsonb, ids = ids || $5::jsonb, updated_at = now() where id = $1::uuid`,[e.id,desc,img,JSON.stringify(patch),JSON.stringify(idPatch)]);
   if(desc||img||patch.website||patch.wikipedia)n++;
  }catch{await db.query(`update entities set attributes = attributes || jsonb_build_object('intro_checked_at', $2::text) where id = $1::uuid`,[e.id,new Date().toISOString()]).catch(()=>{});}
 };
 // A few at a time (Wikidata and Wikipedia ask for moderate request rates).
 for(let i=0;i<rows.length;i+=8)await Promise.all(rows.slice(i,i+8).map(one));
 return n;
}
