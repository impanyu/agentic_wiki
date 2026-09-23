import {arcgisTools} from '@/app/arcgis-connector/tools';
import {arcgisStatus,disconnectArcgis} from '@/app/arcgis-connector/oauth';
import {presetById} from './catalog';
import {apiTools,verifyApiConnector,executeApiConnector} from './adapters';
import {z} from 'zod';
import {database,getPage,lock,unlock} from '@/db/store';
import {canUseConnectorsOn} from '@/app/page-permissions';
import {vaultPath,vaultRead,vaultWrite,vaultDelete,vaultReady,signedIn} from '@/app/storage/vault';
import {storageStatus,storageToken,disconnectStorage} from '@/app/storage/oauth';
import {providerOperation} from '@/app/storage/adapters';
import {storageRequest,type StorageProvider} from '@/app/storage/contracts';
import {connectorUrl} from './http';
import {discoverMcp,callMcp} from './mcp';
import {builtins,connectionInput,type Connection,type RemoteTool} from './contracts';
type Row={id:string;name:string;kind:'mcp'|'api'|'storage';url:string;enabled:number;tools:string;allowed:string;automatic:string;revision:number};
const storageTools:RemoteTool[]=['list','read','mkdir','upload','rename','move','copy','trash'].map(name=>({name,description:name+' files and folders in this connected account.',inputSchema:{type:'object',properties:{rootOnly:{type:'boolean'},id:{type:'string'},parent:{type:'string'},name:{type:'string'},cursor:{type:'string'},content:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:['list','read'].includes(name)}}));
const isStorage=(id:string)=>builtins.includes(id as StorageProvider);
async function row(userId:string,id:string){return database().prepare('SELECT * FROM user_connectors WHERE owner_id=? AND id=?').bind(userId,id).first<Row>();}
export async function connections(userId:string):Promise<Connection[]>{
 const rows=(await database().prepare('SELECT * FROM user_connectors WHERE owner_id=?').bind(userId).all<Row>()).results;
 const arcgis=await arcgisStatus(userId);if(!rows.some(r=>r.id==='arcgis'))rows.push({id:'arcgis',name:'ArcGIS Online',kind:'api',url:'api:arcgis',enabled:0,tools:JSON.stringify(arcgisTools),allowed:JSON.stringify(arcgisTools.map(t=>t.name)),automatic:'[]',revision:0});const storage=await storageStatus(userId);return [...storage.map(s=>{const saved=rows.find(r=>r.id===s.provider);return {id:s.provider,name:s.name,kind:'storage' as const,configured:s.configured,connected:s.connected,enabled:saved?!!saved.enabled:s.connected,tools:s.provider==='google'?storageTools.map(tool=>({...tool,description:tool.description+' List, search and read files across the connected Google Drive. Changes are limited to files selected with Google Picker or created by this app. For write permission to an existing file, ask the user to select it at /drive-picker. Do not request Picker selection merely to list or read files.'})):storageTools,allowed:saved?JSON.parse(saved.allowed):storageTools.map(t=>t.name),automatic:saved?JSON.parse(saved.allowed):storageTools.map(t=>t.name),revision:saved?.revision||0};}),...rows.filter(r=>r.kind!=='storage').map(r=>({id:r.id,name:r.name,kind:r.kind,url:r.url,provider:r.kind==='api'?r.url.slice(4):undefined,configured:r.id==='arcgis'?arcgis.configured:vaultReady(),connected:r.id==='arcgis'?arcgis.connected:true,enabled:!!r.enabled,tools:r.kind==='api'?(r.id==='arcgis'?arcgisTools:apiTools[r.url.slice(4)]||JSON.parse(r.tools)):JSON.parse(r.tools),allowed:JSON.parse(r.allowed),automatic:JSON.parse(r.allowed),revision:r.revision}))];
}
export async function createConnection(userId:string,raw:unknown){signedIn(userId);if(!vaultReady())throw Error('Connector encryption is not configured on the server.');const d=connectionInput.parse(raw),preset=d.preset?presetById(d.preset):undefined;
 if(d.preset&&(!preset||preset.kind==='storage'||preset.auth==='oauth'))throw Error('Unknown connector preset.');
 const kind=preset?.kind==='api'?'api':'mcp',name=preset?.name||d.name;
 if(!name||!preset&&!d.url)throw Error('Enter a connector name and endpoint.');
 if(preset?.auth==='token'&&!d.token?.trim())throw Error('An API token is required.');
 if(preset?.auth==='ssh'&&!d.username)throw Error('An HCC username is required.');
 const credential=preset?.auth==='ssh'?JSON.stringify({username:d.username,sessionId:crypto.randomUUID()}):d.token||'';
 const url=kind==='api'?'api:'+preset!.id:connectorUrl(preset?.url||d.url!).href;
 if((await connections(userId)).length>=43)throw Error('You can connect up to 40 services.');
 let tools:RemoteTool[];
 if(kind==='api'){if(preset!.id!=='unl-hcc')await verifyApiConnector(preset!.id,credential);tools=apiTools[preset!.id];}else tools=await discoverMcp(url,d.token);
 const id=crypto.randomUUID();await vaultWrite(await vaultPath(userId,'connector-'+id),{token:credential});
 try{await database().prepare('INSERT INTO user_connectors(id,owner_id,name,kind,url,enabled,tools,allowed,automatic) VALUES(?,?,?,?,?,0,?,?,\'[]\')').bind(id,userId,name,kind,url,JSON.stringify(tools),JSON.stringify(tools.map(t=>t.name))).run();}catch(e){await vaultDelete(await vaultPath(userId,'connector-'+id));throw e;}return {id};
}

export async function hccSession(userId:string,id:string,password?:string,duoResponse?:string){signedIn(userId);const c=(await connections(userId)).find(c=>c.id===id&&c.provider==='unl-hcc');if(!c)throw Error('UNL HCC connector not found.');const path=await vaultPath(userId,'connector-'+id),saved=await vaultRead(path);if(!saved?.token)throw Error('Reconnect this connector.');const hcc=await import('./hcc');if(password===undefined)return hcc.hccSessionReport(saved.token);return hcc.startHccSession(saved.token,password,duoResponse||'phone');}

export async function updateConnection(userId:string,id:string,raw:unknown){signedIn(userId);const d=z.object({enabled:z.boolean().optional(),allowed:z.array(z.string()).max(200).optional(),refresh:z.boolean().optional()}).strict().parse(raw);
 const c=(await connections(userId)).find(c=>c.id===id);if(!c)throw Error('Connector not found.');let tools=c.tools;
 if(d.refresh&&c.kind==='mcp'){const secret=await vaultRead(await vaultPath(userId,'connector-'+id));tools=await discoverMcp(c.url!,secret?.token);}
 const names=new Set(tools.map(t=>t.name)),allowed=(d.allowed??(d.enabled===true?[...names]:c.allowed)).filter(n=>names.has(n)),automatic=[...allowed];
 if(d.enabled&&!c.connected)throw Error('Connect this account first.');
 await database().prepare('INSERT INTO user_connectors(id,owner_id,name,kind,url,enabled,tools,allowed,automatic,revision) VALUES(?,?,?,?,?,?,?,?,?,1) ON CONFLICT(owner_id,id) DO UPDATE SET enabled=excluded.enabled,tools=excluded.tools,allowed=excluded.allowed,automatic=excluded.automatic,revision=user_connectors.revision+1').bind(id,userId,c.name,c.kind,c.url||null,Number(d.enabled??c.enabled),JSON.stringify(tools),JSON.stringify(allowed),JSON.stringify(automatic)).run();return {saved:true};
}
export async function removeConnection(userId:string,id:string){signedIn(userId);if(id==='arcgis'){await updateConnection(userId,id,{enabled:false});await disconnectArcgis(userId);}else if(isStorage(id)){await updateConnection(userId,id,{enabled:false});await disconnectStorage(id as StorageProvider,userId);}else{await database().prepare('DELETE FROM user_connectors WHERE owner_id=? AND id=?').bind(userId,id).run();await vaultDelete(await vaultPath(userId,'connector-'+id));}return {disconnected:true};}
export async function enabledConnectors(userId:string){return (await connections(userId)).filter(c=>c.enabled&&c.connected).map(c=>({id:c.id,name:c.name,tools:c.tools.filter(t=>c.allowed.includes(t.name)).map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema,confirmationRequired:!c.automatic.includes(t.name)}))}));}
async function authorized(userId:string,id:string,tool:string,pageId?:string){signedIn(userId);const c=(await connections(userId)).find(c=>c.id===id);if(!c?.enabled||!c.connected||!c.allowed.includes(tool)||!c.tools.some(t=>t.name===tool))throw Error('Connector or tool is disabled.');if(pageId){const page=await getPage(pageId,userId);if(!page)throw Error('Page is inaccessible.');if(!canUseConnectorsOn(page)&&!(c.kind==='storage'&&['list','read'].includes(tool))&&!c.tools.find(t=>t.name===tool)?.annotations?.readOnlyHint)throw Error('This page is read only.');}return c;}
async function execute(c:Connection,userId:string,tool:string,args:unknown,signal?:AbortSignal,pageId?:string){
 if(c.provider==='arcgis')return (await import('@/app/arcgis-connector/execute')).executeArcgis(userId,tool,args,pageId);
 if(c.provider==='adma'&&tool==='upload_file'){const data=z.object({pageId:z.string().uuid(),fileId:z.string().uuid(),folderId:z.string().max(200).optional(),operationId:z.string().uuid()}).strict().parse(args);const {copyResources}=await import('@/app/resources/service');return copyResources(data.pageId,userId,{operationId:data.operationId,sources:[{space:'page',kind:'file',id:data.fileId,name:'Selected file'}],destination:{space:'adma',connectorId:c.id,kind:'folder',id:data.folderId||'',name:'ADMA'}});}
 if(c.kind==='storage')return providerOperation(storageRequest.parse({provider:c.id,operation:tool,args}),await storageToken(c.id as StorageProvider,userId));
 const secret=await vaultRead(await vaultPath(userId,'connector-'+c.id));if(!secret)throw Error('Reconnect this connector.');const result=c.provider==='unl-hcc'?await (await import('./hcc')).executeHccConnector(secret.token,tool,args,signal):c.provider==='adma'&&(tool==='list_processing_tools'||tool==='processing_status'||tool.startsWith('run_'))?await (await import('@/app/adma/processing-server')).executeProcessing(userId,c.id,secret.token,tool,args,signal):c.kind==='api'?await executeApiConnector(c.provider!,secret.token,tool,args,signal):await callMcp(c.url!,secret.token,tool,args,signal);const json=JSON.stringify(result);return JSON.parse(secret.token?json.split(secret.token).join('[redacted]'):json);
}
export async function callConnector(userId:string,id:string,tool:string,args:unknown,pageId?:string,signal?:AbortSignal){
 if(!args||typeof args!=='object'||Array.isArray(args)||JSON.stringify(args).length>64000)throw Error('Invalid connector arguments.');
 const c=await authorized(userId,id,tool,pageId);
 const automatic=c.automatic.includes(tool);
 const actionId=crypto.randomUUID();await vaultWrite(await vaultPath(userId,'connector-action-'+actionId),{args});await database().prepare('INSERT INTO connector_actions(id,owner_id,connector_id,revision,page_id,tool,state,created_at) VALUES(?,?,?,?,?,?,\'pending\',?)').bind(actionId,userId,id,c.revision,pageId||null,tool,Date.now()).run();
 if(automatic)return resolveConnectorAction(userId,actionId,true);
 return {confirmationRequired:true,actionId,connector:c.name,tool,message:'Open Connectors to review and approve this exact call. It has not executed.'};
}
export async function connectorActionsFor(userId:string){if(userId.startsWith('guest:'))return [];const rows=(await database().prepare('SELECT id,connector_id connectorId,page_id pageId,tool,state,created_at createdAt FROM connector_actions WHERE owner_id=? AND created_at>? ORDER BY created_at DESC LIMIT 30').bind(userId,Date.now()-86400000).all<any>()).results;return Promise.all(rows.map(async r=>({...r,...await vaultRead(await vaultPath(userId,'connector-action-'+r.id))})));}
export async function resolveConnectorAction(userId:string,id:string,approve:boolean){signedIn(userId);if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid action.');const lease=await lock('connector-action:'+id,65000);if(!lease)throw Error('Action is running.');try{
 const a=await database().prepare('SELECT * FROM connector_actions WHERE owner_id=? AND id=?').bind(userId,id).first<any>();if(!a)throw Error('Action not found.');const path=await vaultPath(userId,'connector-action-'+id),saved=await vaultRead(path);
 if(a.state==='complete')return saved?.result;
 if(a.state!=='pending')throw Error('This action cannot be retried. Review its status first.');
 if(!approve){await database().prepare("UPDATE connector_actions SET state='cancelled' WHERE id=?").bind(id).run();return {cancelled:true};}
 if(Date.now()-a.created_at>600000)throw Error('This action expired. Ask the agent to propose it again.');
 const c=await authorized(userId,a.connector_id,a.tool,a.page_id);if(c.revision!==a.revision)throw Error('Connector settings changed. Ask the agent to propose the action again.');
 await database().prepare("UPDATE connector_actions SET state='executing' WHERE id=?").bind(id).run();
 try{const result=await execute(c,userId,a.tool,saved.args,undefined,a.page_id||undefined);await vaultWrite(path,{args:saved.args,result});await database().prepare("UPDATE connector_actions SET state='complete' WHERE id=?").bind(id).run();return result;}catch(e){await database().prepare("UPDATE connector_actions SET state='uncertain' WHERE id=?").bind(id).run();throw e;}
 }finally{await unlock(lease);}}
export async function connectorAgentCall(userId:string,name:string,args:any,pageId?:string,signal?:AbortSignal){if(name==='list_connectors')return {connectors:await enabledConnectors(userId),recentActions:(await connectorActionsFor(userId)).filter(a=>a.pageId===(pageId||null)).map(a=>({id:a.id,tool:a.tool,state:a.state,...a.state==='complete'?{result:a.result}:{}}))};if(name==='call_connector')return callConnector(userId,String(args.connectorId),String(args.tool),JSON.parse(args.argumentsJson),pageId,signal);throw Error('Unknown connector tool.');}
