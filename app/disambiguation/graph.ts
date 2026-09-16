import {database} from '@/db/store';
import {checkIndexPath,type IndexNode} from './limits';
export async function indexNodes(userId:string):Promise<IndexNode[]>{
 const rows=await database().prepare("SELECT p.id,p.question,p.labels,q.question alias FROM pages p LEFT JOIN questions q ON q.page_id=p.id WHERE json_extract(p.labels,'$.templateId')='disambiguation-v1' AND (p.owner_id=? OR p.visibility='public')").bind(userId).all<{id:string;question:string;labels:string;alias:string|null}>();
 const nodes=new Map<string,IndexNode>();
 for(const row of rows.results){if(!nodes.has(row.id)){const labels=JSON.parse(row.labels);nodes.set(row.id,{id:row.id,aliases:[row.question],entries:(labels.indexEntries||[]).map((e:{question:string})=>e.question)});}if(row.alias)nodes.get(row.id)!.aliases.push(row.alias);}
 return [...nodes.values()];
}
export async function requireValidIndex(userId:string,id:string,alias?:string){const nodes=await indexNodes(userId);if(alias)nodes.find(n=>n.id===id)?.aliases.push(alias);checkIndexPath(nodes,id);}
export async function indexGenerationPolicy(question:string,userId:string){
 const nodes=await indexNodes(userId),candidate={id:'new-index',aliases:[question],entries:[]};
 let leafRequired=false;try{checkIndexPath([...nodes,candidate],candidate.id);}catch{leafRequired=true;}
 return {leafRequired,validate:(entries:{question:string}[])=>checkIndexPath([...nodes,{...candidate,entries:entries.map(e=>e.question)}],candidate.id)};
}
