import {entityDb} from '@/app/entity-db/client';
import {nearestTopics,createTopic,getTopic,addInbox} from '@/app/entity-db/repo';
import {getEmbedder,setEmbedder} from '@/app/entity-db/embeddings';
import {embedder as llmEmbedder} from '@/app/llm';
import {topicEditorId} from './tools';
// A search that found nothing: the reader is told so honestly, and the query goes to the closest topic's editor
// (the general topic when none fits). The manager also reads every such search once a day (app/teams/manager.ts).
// Nothing is generated on the fly.
export async function recordUnserved(query:string,language:string):Promise<string>{
 const q=String(query||'').trim().slice(0,500);const db=await entityDb();
 if(!getEmbedder())setEmbedder(texts=>llmEmbedder()(texts));
 const topic=(await nearestTopics(db,q,1).catch(()=>[]))[0]??await getTopic(db,'general')??await createTopic(db,{slug:'general',name:'General',description:'Queries no topic covers yet; the manager reassigns them as topics are created.'});
 const editorId=await topicEditorId(db,topic.id);
 if(editorId)await addInbox(db,{editorId,query:q,language});
 return topic.name;
}
