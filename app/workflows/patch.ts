// RFC 6902-style add/replace/remove on a copy of the workflow (paths like /ui/0/props/title).
export function applyPatch(target:unknown,ops:{op:'add'|'replace'|'remove';path:string;value?:unknown}[]){
 const doc=JSON.parse(JSON.stringify(target??{}));
 for(const {op,path,value} of ops){
  if(!path.startsWith('/'))throw Error('Patch paths start with / (got '+path+').');
  const keys=path.slice(1).split('/').map(k=>k.replace(/~1/g,'/').replace(/~0/g,'~'));const last=keys.pop()!;let parent:any=doc;
  for(const k of keys){if(parent==null||typeof parent!=='object'||!(k in parent))throw Error('Patch path '+path+' does not exist.');parent=parent[k];}
  if(parent==null||typeof parent!=='object')throw Error('Patch path '+path+' does not exist.');
  if(Array.isArray(parent)){const i=last==='-'?parent.length:Number(last);if(!Number.isInteger(i)||i<0||i>parent.length||(op!=='add'&&i>=parent.length))throw Error('Patch index '+path+' is out of range.');if(op==='add')parent.splice(i,0,value);else if(op==='replace')parent[i]=value;else parent.splice(i,1);}
  else{if(op!=='add'&&!(last in parent))throw Error('Patch path '+path+' does not exist.');if(op==='remove')delete parent[last];else parent[last]=value;}
 }
 return doc;
}
