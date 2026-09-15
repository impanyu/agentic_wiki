import {z} from 'zod';
export const providers=['google','dropbox','onedrive'] as const;
export const providerSchema=z.enum(providers);export type StorageProvider=z.infer<typeof providerSchema>;
export const operationSchema=z.enum(['list','read','mkdir','upload','rename','move','copy','trash']);
export const storageRequest=z.object({provider:providerSchema,operation:operationSchema,args:z.object({id:z.string().max(2000).optional(),parent:z.string().max(2000).optional(),name:z.string().min(1).max(200).refine(n=>!/[\/\\\x00-\x1f]/.test(n)&&!['.','..'].includes(n)).optional(),cursor:z.string().max(8000).optional(),content:z.string().max(64000).optional()}).strict()}).strict();
export type StorageRequest=z.infer<typeof storageRequest>;
export const isMutation=(operation:string)=>!['list','read'].includes(operation);
export const storageProviders={
 google:{name:'Google Drive',prefix:'GOOGLE',authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scope:'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file'},
 dropbox:{name:'Dropbox',prefix:'DROPBOX',authorize:'https://www.dropbox.com/oauth2/authorize',token:'https://api.dropboxapi.com/oauth2/token',scope:'files.metadata.read files.metadata.write files.content.read files.content.write'},
 onedrive:{name:'OneDrive',prefix:'ONEDRIVE',authorize:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',token:'https://login.microsoftonline.com/common/oauth2/v2.0/token',scope:'offline_access https://graph.microsoft.com/Files.ReadWrite'},
} as const;
