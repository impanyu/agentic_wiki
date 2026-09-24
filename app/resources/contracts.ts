import {z} from 'zod';
export const resourceSchema=z.object({space:z.enum(['page','google','dropbox','onedrive','adma','hcc']),id:z.string().max(2000),kind:z.enum(['file','folder']),name:z.string().min(1).max(250),connectorId:z.string().uuid().optional()}).strict().refine(r=>['adma','hcc'].includes(r.space)?!!r.connectorId:!r.connectorId,'ADMA and HCC require their connection ID; other sources use the provider account.');
export type Resource=z.infer<typeof resourceSchema>;
export const mentionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('resource'),resource:resourceSchema}).strict(),
 z.object({type:z.literal('tool'),connectorId:z.string().max(200),name:z.string().max(200)}).strict(),
 z.object({type:z.literal('element'),id:z.string().max(300),name:z.string().max(200),text:z.string().max(2000)}).strict(),
]);
export type Mention=z.infer<typeof mentionSchema>;
export const copySchema=z.object({operationId:z.string().uuid(),sources:z.array(resourceSchema).min(1).max(100),destination:resourceSchema.refine(r=>r.kind==='folder','Choose a destination folder.')}).strict();
export const MAX_FILE_BYTES=10*1024*1024,MAX_COPY_BYTES=100*1024*1024,MAX_COPY_ITEMS=200;
export function resourceKey(r:Resource){return JSON.stringify([r.space,r.connectorId||'',r.kind,r.id]);}
export function assertCopyTarget(sources:Resource[],destination:Resource){for(const source of sources){if(source.space===destination.space&&source.connectorId===destination.connectorId&&source.kind==='folder'&&(!source.id||source.id===destination.id||(['page','dropbox','hcc'].includes(source.space)&&destination.id.startsWith(source.id.replace(/\/$/,'')+'/'))))throw Error('Choose a destination outside the source folder.');}}
