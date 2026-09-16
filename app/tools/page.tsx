import {redirect} from 'next/navigation';
import {ensureNativePage,nativePageAddress,type NativeQuery} from './pages';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<NativeQuery>}){
 const query=await searchParams,id=await ensureNativePage(typeof query.app==='string'?query.app:'hub',typeof query.language==='string'?query.language:undefined);
 redirect(nativePageAddress(id,query));
}
