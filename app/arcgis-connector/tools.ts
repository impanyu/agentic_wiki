import type {RemoteTool} from '@/app/connectors/contracts';
const str={type:'string'},int={type:'integer'},item={itemId:str},resource={type:'object',properties:{space:{type:'string',enum:['page','adma','google','dropbox','onedrive']},id:str,name:str,kind:{type:'string',enum:['file']},connectorId:str},required:['space','id','name','kind'],additionalProperties:false};
function tool(name:string,description:string,properties:Record<string,unknown>,required:string[]=[],read=true):RemoteTool{return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:read}};}
export const arcgisTools:RemoteTool[]=[
 tool('get_account','Read the CURRENT user’s connected ArcGIS identity and privileges.',{}),
 tool('search_items','Search maps and feature layers accessible to the CURRENT ArcGIS user. ArcGIS query syntax is supported; never imply inaccessible content is available.',{query:str,start:int,num:int},['query']),
 tool('get_item','Read map/layer metadata and, when requested, Web Map JSON including layer references.',{...item,includeData:{type:'boolean'}},['itemId']),
 tool('get_layer','Read a feature layer schema, fields, geometry type and query capabilities.',{...item,layerId:int},['itemId','layerId']),
 tool('query_layer','Read features from an accessible ArcGIS Feature Service item, with pagination. Use get_item to identify the layer and fields first.',{...item,layerId:int,where:str,outFields:str,offset:int,count:int},['itemId','layerId']),
 tool('publish_file','Upload a selected GIS file from current-user page files or connected storage and START private hosted-layer publication. Returns source/layer/job IDs; use publication_status later. Requires an editable page. Does not share publicly. Do not retry an uncertain upload.',{pageId:str,resource},['pageId','resource'],false),
 tool('publication_status','Check a hosted-layer publication started by this user; returns status and item links.',{...item,jobId:str},['itemId']),
 tool('create_web_map','Create a PRIVATE Web Map from accessible Feature Service items and return its ArcGIS Online link. Preserve existing maps; never claim this publishes publicly.',{title:str,layerItemIds:{type:'array',items:str,minItems:1,maxItems:10}},['title','layerItemIds'],false),
];
export function arcgisServiceUrl(value:string){const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password||!/(^|\.)arcgis\.com$/.test(u.hostname)||!/^\/.*\/FeatureServer\/?$/.test(u.pathname)||u.search||u.hash)throw Error('Unsupported ArcGIS feature service URL.');return u.href.replace(/\/$/,'');}
