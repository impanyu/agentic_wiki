import {z} from 'zod';
import {getActor} from '@/app/actor';
import {database,getPage,reply,sameOrigin} from '@/db/store';
import {createComponent,getComponent,linkComponents} from '@/app/components-registry/registry';
import {externalApiSchema} from '@/app/components-registry/api-discovery';
import {httpDefinitionSchema} from '@/app/components-registry/http-contracts';
const input=z.object({http:httpDefinitionSchema,credentialId:z.string().min(1).max(200).optional()}).strict();
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request),respond=(data:unknown,status=200)=>actor.finish(reply(data,status));
 if(!sameOrigin(request))return respond({error:'This request must come from the site.'},403);
 try{
  const data=input.parse(await request.json()),source=await getComponent({id:(await params).id,version:1},{userId:actor.userId},'api_adapter');
  if(source.owner_id!==actor.userId)return respond({error:'Only the component owner can configure it.'},403);
  const definition=externalApiSchema.parse({...JSON.parse(source.payload),credentialRef:undefined,execution:'http',http:data.http});
  const context={userId:actor.userId,ownerId:actor.userId,language:source.language,visibility:'private' as const};
  const previous=await database().prepare("SELECT component_id id,version FROM component_dependencies WHERE parent_id=? AND role='credential'").bind(source.id).first<{id:string;version:number}>();
  const credentialRef=data.credentialId?{id:data.credentialId,version:1}:previous;
  const credential=credentialRef?await getComponent(credentialRef,context,'credential'):null;
  if(credential&&(credential.owner_id!==actor.userId||credential.visibility!=='private'))return respond({error:'Use your own private credential reference.'},403);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([definition,credential?.id])))),b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
  const c=await createComponent(source.title+' — HTTP '+hash,'api_adapter',definition,context);
  await linkComponents(c,'derived_from',source,context);await linkComponents(source,'executable',c,context);
  if(credential)await linkComponents(c,'credential',credential,context);
  await database().prepare('UPDATE components SET title=? WHERE id=? AND owner_id=?').bind(source.title+' (HTTP)',c.id,actor.userId).run();
  return respond({page:await getPage(c.id,actor.userId)});
 }catch{return respond({error:'Invalid API configuration. Check the operations and credential reference.'},400);}
}
