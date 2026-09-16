import {fetchSource,sourceText} from '@/app/url-content/fetch';
export type AdmaCatalogItem={id:string;name:string;kind:'file'|'folder';is_public:true;thirdPartySource:string};
// ADMA's token serializers omit third-party flags. Its public catalog is the
// authoritative source for public integration roots; never infer them from names.
export function parseThirdPartyCatalog(html:string):AdmaCatalogItem[]{
 const section=html.match(/id=["']thirdPartyListView["'][\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i)?.[1];
 if(!section){if(/Third-Party Data/i.test(html))throw Error('ADMA catalog format changed.');return [];}
 const items:AdmaCatalogItem[]=[];
 for(const row of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
  const link=cells[0]?.match(/href=["']\/public\/(folder|file)\/([a-f0-9-]{36})\/["']/i);
  if(!link)continue;const name=sourceText(cells[0]).slice(0,300),thirdPartySource=sourceText(cells[2]||'External').slice(0,100);
  if(name&&!items.some(x=>x.id===link[2]))items.push({id:link[2],name,kind:link[1].toLowerCase() as 'file'|'folder',is_public:true,thirdPartySource});
 }
 return items;
}
export async function publicThirdPartyCatalog(signal?:AbortSignal){const result=await fetchSource(new URL('https://adma.aisoup.net/'),signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000));return parseThirdPartyCatalog(result.bytes.toString('utf8'));}
