import {processingTools} from '@/app/adma/processing';
import {z} from 'zod';
import type {RemoteTool} from './contracts';
import {remoteRequest} from './http';
import {publicThirdPartyCatalog} from '@/app/adma/catalog';
const str={type:'string'},tool=(name:string,description:string,properties:Record<string,unknown>,required:string[]=[],read=true):RemoteTool=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:read}});
export const apiTools:Record<string,RemoteTool[]>={
 'unl-vpn':[
  tool('vpn_status','Check whether your UNL VPN session is connected. Campus-only services (such as the ADAPT share) need it.',{}),
 ],
 'unl-adapt':[
  tool('list_files','List files and folders on the ADAPT project share (CALMIT server). path is a share path such as / or /Data Management/Workspace.',{path:str}),
  tool('read_text_file','Read a text file (CSV, TXT, JSON, logs) from the ADAPT share; up to 5 MB, returned in character ranges.',{path:str,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200000}},['path']),
  tool('write_text_file','Create or replace a UTF-8 text file on the ADAPT share.',{path:str,content:str},['path','content'],false),
  tool('create_folder','Create a folder on the ADAPT share.',{path:str},['path'],false),
 ],
 'unl-hcc':[
  tool('account_status','Check the connected Swan account, cluster login and storage quota.',{}),
  tool('list_files','List files and folders in an HCC path. Paths may start with ~ or $HOME (personal 20 GiB, backed up), $WORK (group scratch, purged after 6 months unused) or $NRDSTOR (Nebraska research data storage), e.g. $WORK/project.',{path:str,limit:{type:'integer',minimum:1,maximum:500}}),
  tool('read_text_file','Read a bounded section of a text job script, configuration or log file on HCC.',{path:str,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50000}},['path']),
  tool('write_text_file','Create or replace a UTF-8 text file on HCC.',{path:str,content:str},['path','content'],false),
  tool('create_folder','Create a folder on HCC, including missing parents.',{path:str},['path'],false),
  tool('list_jobs','List the current user’s Slurm jobs, optionally filtered by state.',{states:str,limit:{type:'integer',minimum:1,maximum:500}}),
  tool('job_details','Read detailed Slurm status for a current or historical job.',{job_id:str},['job_id']),
  tool('read_job_log','Read the tail of a Slurm output or error log.',{path:str,lines:{type:'integer',minimum:1,maximum:2000}},['path']),
  tool('list_partitions','List Swan Slurm partitions and availability.',{}),
  tool('search_modules','Search software modules installed on Swan.',{query:str},['query']),
  tool('submit_job','Write a Slurm script into a working directory and submit it with sbatch.',{script:str,working_directory:str,script_name:str},['script'],false),
  tool('cancel_job','Cancel one Slurm job owned by the connected user.',{job_id:str},['job_id'],false),
 ],
 adma:[...processingTools,tool('download_file','Allow copying a binary or text ADMA file to Page files or another connected drive using copy_resources. Calling this tool returns metadata; pass its ID to copy_resources.',{file_id:str},['file_id']),tool('upload_file','Copy an accessible Page file to ADMA as a private file, preserving its bytes. Use copy_resources for folder or cross-drive copies.',{pageId:str,fileId:str,folderId:str,operationId:str},['pageId','fileId','operationId'],false),tool('file_metadata','Read ADMA file metadata.',{file_id:str},['file_id']),tool('create_folder','Create a private ADMA folder.',{name:str,parent_id:str},['name'],false),...['file','folder'].flatMap(kind=>[tool('update_'+kind,'Rename or change visibility of an owned ADMA '+kind+'.',{id:str,name:str,is_public:{type:'boolean'}},['id'],false),tool('delete_'+kind,'Permanently delete an owned ADMA '+kind+'. Deleting a folder also deletes its contents. Requires explicit user intent.',{id:str},['id'],false)]),tool('list_files','List accessible ADMA files, optionally filtered by folder, visibility or file type. search filters filenames before returning results; use a date such as 2026-09-01 for daily station files instead of retrieving every observation file.',{folder_id:str,is_public:{type:'boolean'},file_type:str,search:str}),tool('list_folders','List your ADMA folders, optionally filtered by parent folder and visibility. Root listings also return thirdPartyRoots (including Realm5 and John Deere). Use their IDs as parent_id to browse stations and folder_id to list data files.',{parent_id:str,is_public:{type:'boolean'}}),tool('folder_info','Read size and download metadata for an accessible ADMA folder.',{folder_id:str},['folder_id']),tool('read_text_file','Read an accessible text, CSV, JSON or XML file from ADMA, up to 1 MiB. Returns a bounded character range; follow nextOffset until null for complete contents. offset is zero-based, limit is at most 16000. Binary formats are not supported.',{file_id:str,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:16000}},['file_id']),tool('upload_text_file','Upload one UTF-8 text, CSV, JSON or GeoJSON file to ADMA. Creates a new file; does not edit an existing file. Private by default; public visibility requires explicit user instruction. Requires operation approval unless explicitly configured otherwise.',{filename:str,content:str,folder_id:str,is_public:{type:'boolean'}},['filename','content'],false)],
 notion:[tool('search','Search page titles shared with the integration.',{query:str,cursor:str}),tool('read_page','Read a page metadata by ID.',{pageId:str},['pageId']),tool('read_blocks','Read page or block children; follow next_cursor for pagination.',{blockId:str,cursor:str},['blockId']),tool('append_note','Append a paragraph to a shared page or block.',{blockId:str,text:str},['blockId','text'],false)],
 slack:[tool('list_channels','List accessible Slack conversations. types may include public_channel,private_channel,im,mpim; token scopes must allow the requested types.',{cursor:str,types:str}),tool('read_messages','Read messages in a conversation.',{channel:str,cursor:str},['channel']),tool('send_message','Send a message to a conversation.',{channel:str,text:str,thread_ts:str},['channel','text'],false)],
 airtable:[tool('list_bases','List accessible Airtable bases.',{cursor:str}),tool('list_tables','Read the schema of a base.',{baseId:str},['baseId']),tool('list_records','Read records from a table.',{baseId:str,tableId:str,cursor:str},['baseId','tableId']),tool('create_record','Create one record using JSON field values.',{baseId:str,tableId:str,fields:{type:'object',additionalProperties:true}},['baseId','tableId','fields'],false)],
 todoist:[tool('list_projects','List your projects.',{cursor:str}),tool('list_tasks','List active tasks, optionally in a project.',{project_id:str,cursor:str}),tool('create_task','Create a task.',{content:str,project_id:str,due_string:str},['content'],false),tool('complete_task','Mark a task complete.',{taskId:str},['taskId'],false)],
 brave:[
  tool('web_search','Search the whole web and return source URLs, snippets and available structured result data.',{query:str,count:{type:'integer',minimum:1,maximum:20},country:str,search_lang:str},['query']),
  tool('image_search','Search images across the whole web. Returns proxied thumbnails, original image URLs, dimensions and source pages. Search results do not grant reuse rights; verify identity and usage rights before embedding.',{query:str,count:{type:'integer',minimum:1,maximum:50},country:str,search_lang:str},['query']),
  tool('video_search','Search videos across the whole web. Returns titles, source pages, thumbnails, descriptions and available duration/publisher metadata. Link to the source page unless embedding rights are clear.',{query:str,count:{type:'integer',minimum:1,maximum:20},country:str,search_lang:str},['query']),
  tool('news_search','Search current news across the whole web. Returns article URLs, descriptions, publishers and available publication times.',{query:str,count:{type:'integer',minimum:1,maximum:20},country:str,search_lang:str},['query']),
 ],
 youtube:[tool('search','Search public YouTube videos, channels or playlists. Returns canonical IDs, titles, descriptions, channel names, publication times and thumbnails. type is video|channel|playlist.',{query:str,type:str,count:{type:'integer',minimum:1,maximum:25}},['query'])],
};
const id=z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/),uuid=z.string().regex(/^[a-fA-F0-9-]{32,36}$/),cursor=z.string().max(3000).optional(),text=z.string().min(1).max(16000);
export function apiOperation(provider:string,name:string,raw:unknown){
 let path='',method='GET',body:unknown;let extraHeaders:Record<string,string>={},textResponse=false;let query:Record<string,string|undefined>={};const args=raw;
 const parse=<T extends z.ZodRawShape>(shape:T)=>z.object(shape).strict().parse(args);
 if(provider==='adma'){
  const visibility=z.boolean().optional();
  if(name==='file_metadata'||name==='download_file'){const a=parse({file_id:id});path='/api/v1/files/'+a.file_id+'/metadata/';}
  else if(name==='create_folder'){const a=parse({name:z.string().trim().min(1).max(180),parent_id:id.optional()});path='/api/v1/folders/create/';method='POST';body={...a,is_public:false};}
  else if(['update_file','update_folder'].includes(name)){const a=parse({id,name:z.string().trim().min(1).max(180).optional(),is_public:visibility});if(a.name===undefined&&a.is_public===undefined)throw Error('Choose a change.');path='/api/v1/'+(name==='update_file'?'files':'folders')+'/'+a.id+'/update/';method='PATCH';body={name:a.name,is_public:a.is_public};}
  else if(['delete_file','delete_folder'].includes(name)){const a=parse({id});path='/api/v1/'+(name==='delete_file'?'files':'folders')+'/'+a.id+'/delete/';method='DELETE';}
  else if(name==='list_files'){const a=parse({folder_id:id.optional(),is_public:visibility,file_type:z.string().min(1).max(100).optional(),search:z.string().max(200).optional()});path='/api/v1/files/';query={folder_id:a.folder_id,is_public:a.is_public===undefined?undefined:String(a.is_public),file_type:a.file_type};}
  else if(name==='list_folders'){const a=parse({parent_id:id.optional(),is_public:visibility});path='/api/v1/folders/';query={parent_id:a.parent_id,is_public:a.is_public===undefined?undefined:String(a.is_public)};}
  else if(name==='folder_info'){const a=parse({folder_id:id});path='/api/v1/folders/'+a.folder_id+'/info/';}
  else if(name==='read_text_file'){const a=parse({file_id:id,offset:z.number().int().min(0).max(1048576).optional(),limit:z.number().int().min(1).max(16000).optional()});path='/api/v1/files/'+a.file_id+'/download/';textResponse=true;}
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
 }else if(provider==='brave'&&['web_search','image_search','video_search','news_search'].includes(name)){
  const a=parse({query:z.string().min(1).max(400),count:z.number().int().min(1).max(name==='image_search'?50:20).optional(),country:z.string().regex(/^(?:[A-Z]{2}|ALL)$/).optional(),search_lang:z.string().regex(/^[a-z]{2,3}(?:-[a-z]{2})?$/i).optional()});
  const endpoint={web_search:'web',image_search:'images',video_search:'videos',news_search:'news'}[name]!;
  path='/res/v1/'+endpoint+'/search';query={q:a.query,count:String(a.count||10),country:a.country,search_lang:a.search_lang,safesearch:name==='image_search'||name==='video_search'?'strict':undefined};
 }else if(provider==='youtube'&&name==='search'){
  const a=parse({query:z.string().min(1).max(400),type:z.enum(['video','channel','playlist']).optional(),count:z.number().int().min(1).max(25).optional()});path='/youtube/v3/search';query={part:'snippet',q:a.query,type:a.type||'video',maxResults:String(a.count||10),safeSearch:'moderate'};
 }
 if(!path)throw Error('Unknown connector operation.');
 const origin:Record<string,string>={adma:'https://adma.aisoup.net',notion:'https://api.notion.com',slack:'https://slack.com',airtable:'https://api.airtable.com',todoist:'https://api.todoist.com',brave:'https://api.search.brave.com',youtube:'https://www.googleapis.com'};
 const url=new URL(path,origin[provider]);for(const [key,value] of Object.entries(query))if(value!==undefined)url.searchParams.set(key,value);return {url:url.href,method,body,headers:extraHeaders,textResponse};
}
export async function executeApiConnector(provider:string,token:string,name:string,args:unknown,signal?:AbortSignal){
 const op=apiOperation(provider,name,args);if(provider==='youtube'){const url=new URL(op.url);url.searchParams.set('key',token);op.url=url.href;}
 const headers:Record<string,string>={Accept:'application/json',...(provider==='brave'?{'X-Subscription-Token':token}:provider==='youtube'?{}:{Authorization:(provider==='adma'?'Token ':'Bearer ')+token}),...(provider==='notion'?{'Notion-Version':'2025-09-03'}:{}),...op.headers};
 const {data}=await remoteRequest(op.url,headers,op.body,signal,op.method,true,{textResponse:op.textResponse});
 if(provider==='adma'&&name==='list_files'&&(args as {search?:string}).search){const query=(args as {search:string}).search.toLowerCase(),files=Array.isArray(data?.files)?data.files.filter((f:any)=>String(f.name||'').toLowerCase().includes(query)):[];return {...data,files,count:files.length,search:query};}
 if(provider==='adma'&&name==='list_folders'&&!(args as {parent_id?:string}).parent_id){try{return {...data,thirdPartyRoots:await publicThirdPartyCatalog(signal)};}catch{return {...data,thirdPartyRoots:[],thirdPartyError:'Public catalog unavailable; do not interpret this as no third-party data.'};}}
 if(provider==='adma'&&name==='read_text_file'&&typeof data?.content==='string'){const a=args as {offset?:number;limit?:number},start=a.offset||0,end=Math.min(start+(a.limit||16000),data.content.length);return {...data,content:data.content.slice(start,end),offset:start,totalCharacters:data.content.length,nextOffset:end<data.content.length?end:null};}
 if(provider==='slack'&&data?.ok===false)throw Error('Slack rejected this request. Check token scopes and channel membership.');
 return data??{ok:true};
}
export async function verifyApiConnector(provider:string,token:string){
 if(!token)throw Error('An API token is required.');
 if(provider==='slack'){const {data}=await remoteRequest('https://slack.com/api/auth.test',{Authorization:'Bearer '+token},undefined,undefined,'POST');if(!data?.ok)throw Error('Slack token could not be verified.');return;}
 if(provider==='brave'||provider==='youtube')return; // Avoid consuming search quota just to save a key.
 await executeApiConnector(provider,token,provider==='adma'?'list_folders':provider==='notion'?'search':provider==='airtable'?'list_bases':'list_projects',{});
}
