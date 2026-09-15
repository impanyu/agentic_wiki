import {providers,type StorageProvider} from './contracts';
const names:Record<StorageProvider,RegExp>={google:/google\s*drive|谷歌云盘/i,dropbox:/\bdropbox\b/i,onedrive:/\bonedrive\b/i};
export function pageStorageProviders(question:string,parameters:Record<string,unknown>={}){
 const named=providers.filter(p=>names[p].test(question));
 if(named.length)return named;
 if(providers.includes(parameters.provider as StorageProvider))return [parameters.provider as StorageProvider];
 return [...providers];
}
