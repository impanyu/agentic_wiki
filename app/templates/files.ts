import {database} from '@/db/store';
export async function listDataFiles(userId:string,after=''){
 const rows=await database().prepare("SELECT id,title,payload,created_at FROM components WHERE owner_id=? AND type='data' AND id>? ORDER BY id LIMIT 101").bind(userId,after.slice(0,200)).all<{id:string;title:string;payload:string;created_at:string}>();
 return {items:rows.results.slice(0,100).map(r=>{let p:Record<string,unknown>={};try{p=JSON.parse(r.payload);}catch{}return {id:r.id,name:String(p.fileName||r.title),kind:'file' as const,modifiedTime:r.created_at,...(String(p.location).startsWith('r2://FILES/')?{url:'/api/components/'+encodeURIComponent(r.id)+'/file'}:{})};}),next:rows.results.length>100?rows.results[99].id:null};
}
