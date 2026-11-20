import {publicFetcher} from '@/app/public-data/service';
import {waybackPage,type ArchivedPage} from '@/app/public-data/archive';
// When a page answers with a login wall, CAPTCHA or interactive challenge (or an HTTP error),
// the data tools read its latest Wayback Machine capture instead and mark the result as
// archived, so the page cites the snapshot with its date. Paced by the shared limiter.
export type ArchiveCopy=ArchivedPage&{fromArchive:true};
export async function archivedCopy(url:string,signal:AbortSignal):Promise<ArchiveCopy|null>{
 try{
  const p=await waybackPage(publicFetcher.bind(signal),url);
  return p&&/html|xml|^$/i.test(p.contentType)?{...p,fromArchive:true}:null;
 }catch{signal.throwIfAborted();return null;}
}
export const archiveMark=(c:ArchiveCopy)=>({fromArchive:true as const,snapshotUrl:c.snapshotUrl,timestamp:c.timestamp,archivedAt:c.date});
