import {z} from 'zod';
import type {RemoteTool} from './contracts';
import {remoteRequest} from './http';
const str={type:'string'},tool=(name:string,description:string,properties:Record<string,unknown>,required:string[]=[],read=true):RemoteTool=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:read}});
export const apiTools:Record<string,RemoteTool[]>={
 adma:[tool('list_files','List files owned by your ADMA account, optionally filtered by folder, visibility or file type.',{folder_id:str,is_public:{type:'boolean'},file_type:str}),tool('list_folders','List your ADMA folders, optionally filtered by parent folder and visibility.',{parent_id:str,is_public:{type:'boolean'}}),tool('folder_info','Read metadata and contents for an accessible ADMA folder.',{folder_id:str},['folder_id']),tool('read_text_file','Download an accessible text, CSV, JSON or XML file from ADMA, up to 1 MiB. Binary formats are not supported by this tool.',{file_id:str},['file_id']),tool('upload_text_file','Upload one UTF-8 text, CSV, JSON or GeoJSON file to ADMA. Creates a new file; does not edit an existing file. Private by default; public visibility requires explicit user instruction. Requires operation approval unless explicitly configured otherwise.',{filename:str,content:str,folder_id:str,is_public:{type:'boolean'}},['filename','content'],false)],
 notion:[tool('search','Search page titles shared with the integration.',{query:str,cursor:str}),tool('read_page','Read a page metadata by ID.',{pageId:str},['pageId']),tool('read_blocks','Read page or block children; follow next_cursor for pagination.',{blockId:str,cursor:str},['blockId']),tool('append_note','Append a paragraph to a shared page or block.',{blockId:str,text:str},['blockId','text'],false)],
 slack:[tool('list_channels','List accessible Slack conversations. types may include public_channel,private_channel,im,mpim; token scopes must allow the requested types.',{cursor:str,types:str}),tool('read_messages','Read messages in a conversation.',{channel:str,cursor:str},['channel']),tool('send_message','Send a message to a conversation.',{channel:str,text:str,thread_ts:str},['channel','text'],false)],
 airtable:[tool('list_bases','List accessible Airtable bases.',{cursor:str}),tool('list_tables','Read the schema of a base.',{baseId:str},['baseId']),tool('list_records','Read records from a table.',{baseId:str,tableId:str,cursor:str},['baseId','tableId']),tool('create_record','Create one record using JSON field values.',{baseId:str,tableId:str,fields:{type:'object',additionalProperties:true}},['baseId','tableId','fields'],false)],
 todoist:[tool('list_projects','List your projects.',{cursor:str}),tool('list_tasks','List active tasks, optionally in a project.',{project_id:str,cursor:str}),tool('create_task','Create a task.',{content:str,project_id:str,due_string:str},['content'],false),tool('complete_task','Mark a task complete.',{taskId:str},['taskId'],false)],
 brave:[tool('web_search','Search the web and return source URLs and snippets.',{query:str},['query'])],
};
const id=z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/),uuid=z.string().regex(/^[a-fA-F0-9-]{32,36}$/),cursor=z.string().max(3000).optional(),text=z.string().min(1).max(16000);
export function apiOperation(provider:string,name:string,raw:unknown){
 let path='',method='GET',body:unknown;let extraHeaders:Record<string,string>={},textResponse=false;let query:Record<string,string|undefined>={};const args=raw;
 const parse=<T extends z.ZodRawShape>(shape:T)=>z.object(shape).strict().parse(args);
 if(provider==='adma'){
  const visibility=z.boolean().optional();
  if(name==='list_files'){const a=parse({folder_id:id.optional(),is_public:visibility,file_type:z.string().min(1).max(100).optional()});path='/api/v1/files/';query={folder_id:a.folder_id,is_public:a.is_public===undefined?undefined:String(a.is_public),file_type:a.file_type};}
  else if(name==='list_folders'){const a=parse({parent_id:id.optional(),is_public:visibility});path='/api/v1/folders/';query={parent_id:a.parent_id,is_public:a.is_public===undefined?undefined:String(a.is_public)};}
  else if(name==='folder_info'){const a=parse({folder_id:id});path='/api/v1/folders/'+a.folder_id+'/info/';}
  else if(name==='read_text_file'){const a=parse({file_id:id});path='/api/v1/files/'+a.file_id+'/download/';textResponse=true;}
  else if(name==='upload_text_file'){
   const a=parse({filename:z.string().min(1).max(180).regex(/^[\p{L}\p{N}_ -]+\.(txt|csv|json|geojson|tsv|md|xml)$/iu),content:z.string().max(48000),folder_id:id.optional(),is_public:visibility});
   path='/api/v1/files/upload/';method='POST';const boundary='adma-'+crypto.randomUUID(),extension=a.filename.split('.').at(-1)!.toLowerCase();
   const mime:Record<string,string>={txt:'text/plain',csv:'text/csv',json:'application/json',geojson:'application/geo+json',tsv:'text/tab-separated-values',md:'text/markdown',xml:'application/xml'};
   const fields={is_public:String(a.is_public??false),...(a.folder_id?{folder_id:a.folder_id}:{})};
   const segments=Object.entries(fields).map(([key,value])=>'--'+boundary+'\r\nContent-Disposition: form-data; name="'+key+'"\r\n\r\n'+value+'\r\n');
   segments.push('--'+boundary+'\r\nContent-Disposition: form-data; name="files"; filename="'+a.filename+'"\r\nContent-Type: '+mime[extension]+'; charset=utf-8\r\n\r\n'+a.content+'\r\n--'+boundary+'--\r\n');
   body=Buffer.from(segments.join(''),'utf8');extraHeaders={'Content-Type':'multipart/form-data; boundary='+boundary};
  }
 }else if(provider==='notion'){
  if(name==='search'){const a=parse({query:z.string().max(500).optional(),cursor});path='/v1/search';method='POST';body={query:a.query,start_cursor:a.cursor,page_size:50};}
  else if(name==='read_page'){const a=parse({pageId:uuid});path='/v1/pages/'+a.pageId;}
  else if(name==='read_blocks'){const a=parse({blockId:uuid,cursor});path='/v1/blocks/'+a.blockId+'/children';query={start_cursor:a.cursor,page_size:'50'};}
  else if(name==='append_note'){const a=parse({blockId:uuid,text:z.string().min(1).max(2000)});path='/v1/blocks/'+a.blockId+'/children';method='PATCH';body={children:[{object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:a.text}}]}}]};}
 }else if(provider==='slack'){
  if(name==='list_channels'){const a=parse({cursor,types:z.string().regex(/^(public_channel|private_channel|im|mpim)(,(public_channel|private_channel|im|mpim))*$/).optional()});path='/api/conversations.list';query={cursor:a.cursor,limit:'50',types:a.types||'public_channel'};}
  else if(name==='read_messages'){const a=parse({channel:id,cursor});path='/api/conversations.history';query={channel:a.channel,cursor:a.cursor,limit:'15'};}
  else if(name==='send_message'){const a=parse({channel:id,text,thread_ts:z.string().regex(/^\d+\.\d+$/).optional()});path='/api/chat.postMessage';method='POST';body=a;}
 }else if(provider==='airtable'){
  if(name==='list_bases'){const a=parse({cursor});path='/v0/meta/bases';query={offset:a.cursor};}
  else if(name==='list_tables'){const a=parse({baseId:id});path='/v0/meta/bases/'+a.baseId+'/tables';}
  else if(name==='list_records'){const a=parse({baseId:id,tableId:id,cursor});path='/v0/'+a.baseId+'/'+a.tableId;query={offset:a.cursor,pageSize:'50'};}
  else if(name==='create_record'){const a=parse({baseId:id,tableId:id,fields:z.record(z.unknown())});path='/v0/'+a.baseId+'/'+a.tableId;method='POST';body={records:[{fields:a.fields}]};}
 }else if(provider==='todoist'){
  if(name==='list_projects'){const a=parse({cursor});path='/api/v1/projects';query={cursor:a.cursor,limit:'50'};}
  else if(name==='list_tasks'){const a=parse({project_id:id.optional(),cursor});path='/api/v1/tasks';query={project_id:a.project_id,cursor:a.cursor,limit:'50'};}
  else if(name==='create_task'){const a=parse({content:text,project_id:id.optional(),due_string:z.string().max(300).optional()});path='/api/v1/tasks';method='POST';body=a;}
  else if(name==='complete_task'){const a=parse({taskId:id});path='/api/v1/tasks/'+a.taskId+'/close';method='POST';}
 }else if(provider==='brave'&&name==='web_search'){const a=parse({query:z.string().min(1).max(400)});path='/res/v1/web/search';query={q:a.query,count:'10'};}
 if(!path)throw Error('Unknown connector operation.');
 const origin:Record<string,string>={adma:'https://adma.aisoup.net',notion:'https://api.notion.com',slack:'https://slack.com',airtable:'https://api.airtable.com',todoist:'https://api.todoist.com',brave:'https://api.search.brave.com'};
 const url=new URL(path,origin[provider]);for(const [key,value] of Object.entries(query))if(value!==undefined)url.searchParams.set(key,value);return {url:url.href,method,body,headers:extraHeaders,textResponse};
}
export async function executeApiConnector(provider:string,token:string,name:string,args:unknown,signal?:AbortSignal){
 const op=apiOperation(provider,name,args),headers:Record<string,string>={Accept:'application/json',...(provider==='brave'?{'X-Subscription-Token':token}:{Authorization:(provider==='adma'?'Token ':'Bearer ')+token}),...(provider==='notion'?{'Notion-Version':'2025-09-03'}:{}),...op.headers};
 const {data}=await remoteRequest(op.url,headers,op.body,signal,op.method,true,{textResponse:op.textResponse});
 if(provider==='slack'&&data?.ok===false)throw Error('Slack rejected this request. Check token scopes and channel membership.');
 return data??{ok:true};
}
export async function verifyApiConnector(provider:string,token:string){
 if(!token)throw Error('An API token is required.');
 if(provider==='slack'){const {data}=await remoteRequest('https://slack.com/api/auth.test',{Authorization:'Bearer '+token},undefined,undefined,'POST');if(!data?.ok)throw Error('Slack token could not be verified.');return;}
 if(provider==='brave')return; // Avoid a billable search just to save a key.
 await executeApiConnector(provider,token,provider==='adma'?'list_folders':provider==='notion'?'search':provider==='airtable'?'list_bases':'list_projects',{});
}
