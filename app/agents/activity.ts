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
  case 'wf_spec':return 'Writing down what the app needs to do';
  case 'wf_catalog':return 'Looking for '+clip(a.query,40)+' in the component and tool library';
  case 'wf_get':return 'Reading the app being built';
  case 'wf_set':case 'wf_edit':return 'Building the app';
  case 'wf_validate':return 'Checking the app structure';
  case 'wf_try_tool':return 'Looking at real data from '+clip(a.tool,40);
  case 'wf_notes':return 'Recalling what is known about '+clip(a.query,40);
  case 'wf_note_save':return 'Saving notes about '+clip(a.source,40);
  case 'wf_eval':return 'Testing a data expression';
  case 'wf_run':return 'Running the app’s '+clip(a.action,30)+' action';
  case 'wf_preview':return 'Looking at the app in a browser';
  case 'wf_verify':return 'Testing the app and reviewing screenshots';
  case 'wf_propose':return 'Proposing the app for your review';
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
