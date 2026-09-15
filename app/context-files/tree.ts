export function folderPath(value:unknown){
 if(typeof value!=='string'||value.length>500||value.includes('\\')||/[\u0000-\u001f]/.test(value))throw Error('Invalid folder path.');
 const parts=value.split('/').filter(Boolean);if(parts.length>12||parts.some(p=>p==='.'||p==='..'||p.length>100))throw Error('Invalid folder path.');return parts.join('/');
}
export function fileName(value:unknown){if(typeof value!=='string'||!value.trim()||value.length>250||/[\/\\\u0000-\u001f]/.test(value)||['.','..'].includes(value))throw Error('Invalid file name.');return value.trim();}
export type FileTree<T>={name:string;path:string;folders:FileTree<T>[];files:T[]};
export function buildFileTree<T extends {folderPath?:string;name:string}>(files:T[],paths:string[]):FileTree<T>{
 const root:FileTree<T>={name:'',path:'',folders:[],files:[]};
 function at(path:string){let node=root,soFar='';for(const name of path.split('/').filter(Boolean)){soFar=soFar?soFar+'/'+name:name;let child=node.folders.find(f=>f.name===name);if(!child){child={name,path:soFar,folders:[],files:[]};node.folders.push(child);}node=child;}return node;}
 for(const path of paths)at(path);for(const file of files)at(file.folderPath||'').files.push(file);
 function sort(node:FileTree<T>){node.folders.sort((a,b)=>a.name.localeCompare(b.name));node.files.sort((a,b)=>a.name.localeCompare(b.name));node.folders.forEach(sort);}sort(root);return root;
}
