import {providers,type StorageProvider} from './contracts';
import {connectorCatalog} from '@/app/connectors/catalog';
export function namedConnectors(question:string){
 return connectorCatalog.filter(c=>c.id==='google'?/google\s*drive|谷歌云盘/i.test(question):new RegExp('\\b'+c.name.replace(/ /g,'\\s*')+'\\b','i').test(question)).map(c=>c.id);
}
// A storage provider names the source, not the requested output. These are
// explicit analytical outputs that the registered file browser cannot produce.
export function requestsDataResult(question:string){
 return /\b(plot|chart|graph|visuali[sz](?:e|ation)|analy[sz]e|analysis|correlat(?:e|ion)|forecast|histogram|regression|aggregate)\b|绘图|画图|图表|曲线|可视化|分析|相关性|预测|汇总/i.test(question);
}
export function storagePageMismatch(question:string,page:{question?:string;title:string;dynamic?:{template?:string}}){
 const requested=namedConnectors(question),saved=namedConnectors(page.question||page.title);
 const basicAdmaProgram=page.dynamic?.template==='page-program-v1'&&/^(?:list|show|browse|open|manage)(?:\s+me)?(?:\s+my)?\s+adma(?:['’]s)?\s+(?:files|folders)(?:\s+and\s+(?:files|folders))?[.!?]?$/i.test((page.question||'').trim());
 if(requestsDataResult(question)&&(basicAdmaProgram||['file-browser-v1','google-drive-folders-v1'].includes(page.dynamic?.template||'')))return true;
 if(requested.length&&saved.length&&requested.some(id=>!saved.includes(id)))return true;
 return page.dynamic?.template==='file-browser-v1'&&requested.some(id=>id!=='adma'&&!providers.includes(id as StorageProvider));
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
