import {providers,type StorageProvider} from './contracts';
import {connectorCatalog} from '@/app/connectors/catalog';
export function namedConnectors(question:string){
 return connectorCatalog.filter(c=>c.id==='google'?/google\s*drive|谷歌云盘/i.test(question):new RegExp('\\b'+c.name.replace(/ /g,'\\s*')+'\\b','i').test(question)).map(c=>c.id);
}
export function storagePageMismatch(question:string,page:{question?:string;title:string;dynamic?:{template?:string}}){
 const requested=namedConnectors(question),saved=namedConnectors(page.question||page.title);
 if(requested.length&&saved.length&&requested.some(id=>!saved.includes(id)))return true;
 return page.dynamic?.template==='file-browser-v1'&&requested.some(id=>!providers.includes(id as StorageProvider));
}
const names:Record<StorageProvider,RegExp>={google:/google\s*drive|谷歌云盘/i,dropbox:/\bdropbox\b/i,onedrive:/\bonedrive\b/i};
export function pageStorageProviders(question:string,parameters:Record<string,unknown>={}){
 const connectors=namedConnectors(question);
 if(connectors.length&&!connectors.some(id=>providers.includes(id as StorageProvider)))return [];
 const named=providers.filter(p=>names[p].test(question));
 if(named.length)return named;
 if(providers.includes(parameters.provider as StorageProvider))return [parameters.provider as StorageProvider];
 return [...providers];
}
