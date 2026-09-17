import type {ContextFile} from './server';
// Both entry points attach to the same permission-checked page context.
export async function uploadPageFiles(pageId:string,files:File[],onFile?:(file:ContextFile)=>void){
 for(const file of files)if(file.size>10*1024*1024)throw Error('Choose a file up to 10 MB.');
 let changed=false;
 try{for(const file of files){
  const path=file.webkitRelativePath?.split('/').slice(0,-1).join('/')||'';
  const response=await fetch('/api/components/upload',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-Page-Id':pageId,'X-File-Name':encodeURIComponent(file.name),'X-Folder-Path':encodeURIComponent(path)},body:file});
  const result=await response.json() as {file?:ContextFile;error?:string};
  if(!response.ok||!result.file)throw Error(result.error||'The upload could not be saved. Please try again.');
  changed=true;onFile?.(result.file);
 }}finally{if(changed)window.dispatchEvent(new CustomEvent('page-files-changed',{detail:{pageId}}));}
}
