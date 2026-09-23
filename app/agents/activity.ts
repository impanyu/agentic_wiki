// Plain-language descriptions of what an agent is doing, shown live in the chat.
const clip=(value:unknown,length=70)=>{const text=typeof value==='string'?value:value===undefined?'':JSON.stringify(value);return text.length>length?text.slice(0,length-1)+'…':text;};
const parse=(raw:unknown):Record<string,any>=>{if(raw&&typeof raw==='object')return raw as Record<string,any>;try{return JSON.parse(String(raw||'{}'));}catch{return {};}};
export function describeToolStart(tool:string,rawArgs:unknown){
 const a=parse(rawArgs);
 switch(tool){
  case 'web_search':return 'Searching the web';
  case 'find_images':return 'Searching images: '+clip(a.query);
  case 'search_public_media':return 'Searching public media: '+clip(a.query);
  case 'import_image':return 'Copying an image into Page files: '+clip(a.name);
  case 'generate_image':return 'Generating an illustration: '+clip(a.prompt,90);
  case 'plot_chart':{const spec=parse(a.specJson);return 'Drawing a '+(spec.kind||'')+' chart: '+clip(spec.title||a.name);}
  case 'render_plot':return 'Running plotting code for '+clip(a.name);
  case 'write_page_file':return 'Writing '+clip(a.name);
  case 'list_page_files':return 'Listing Page files';
  case 'read_uploaded_file':return 'Reading a page file';
  case 'browse_resources':return 'Browsing connected storage';
  case 'copy_resources':return 'Copying files between repositories';
  case 'call_connector':return 'Calling '+clip(a.connector||a.connectorId||'a connector',30)+(a.tool?': '+clip(a.tool,40):'');
  case 'storage_execute':return 'Working with connected storage';
  case 'read_generation_contract':return 'Reading the '+clip(a.kind,20)+' format';
  case 'validate_page_draft':return 'Checking the draft';
  case 'test_page_program':return 'Testing the backend program';
  case 'read_app_definition':return 'Reading the app’s current code';
  case 'run_current_app':return 'Running the app';
  case 'propose_app_revision':case 'propose_page_code':return 'Preparing the change preview';
  case 'execute_code':return 'Running code in the sandbox';
  case 'execute_api':return 'Calling an API';
  case 'use_computer':return 'Using the remote computer';
  case 'delegate_task':return 'Asking a '+clip(a.specialty,20)+' specialist: '+clip(a.task,60);
  case 'update_task_plan':return 'Planning the steps';
  case 'search_session_memory':return 'Checking earlier work';
  case 'set_reasoning_effort':return 'Thinking '+(a.effort==='high'?'harder':'more carefully');
  default:return 'Using '+tool.replace(/_/g,' ');
 }
}
// Adapts agent loop events into status lines for a chat stream.
export function activityReporter(emit:(message:string)=>void){
 return (event:{kind:string;data:unknown})=>{
  const d=event.data as {tool?:string;arguments?:unknown;result?:any;error?:string}|undefined;
  if(event.kind==='tool_started'&&d?.tool)emit(describeToolStart(d.tool,d.arguments));
  else if(event.kind==='tool_finished'&&d?.result&&typeof d.result==='object'&&(d.result.error||d.result.valid===false))emit('↳ '+clip(d.result.error||'Draft needs fixes',120)+' — adjusting');
  else if(event.kind==='validation_failed')emit('Revising the answer');
 };
}
