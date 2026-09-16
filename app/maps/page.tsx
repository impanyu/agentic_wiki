import {redirect} from 'next/navigation';
import {ensureNativePage,nativePageAddress,type NativeQuery} from '@/app/tools/pages';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<NativeQuery>}){
 const query=await searchParams,id=await ensureNativePage('map',typeof query.language==='string'?query.language:undefined);
 redirect(nativePageAddress(id,query));
}
