import {createHash} from 'node:crypto';
import {database} from '@/db/store';
import {pageAddress} from '@/app/dynamic/units';
import {nativeApps} from './sources';
import zh from '@/app/i18n/zh-pairs.json';
// Built-in apps are ordinary, shared read-only pages. Files, chat and forks use
// the same visitor-scoped permissions as every other public read-only page.
export function nativePageDefinition(app:string,language='en'){
 const tool=nativeApps.find(a=>a.id===app),nativeApp=tool?.id||'hub';
 const locale=/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(language)?language:'en';
 const name=tool?.name||'Native apps',description=tool?.description||'Choose a tool for your data';
 const localized=(text:string)=>locale.startsWith('zh')?(zh as Record<string,string>)[text]||text:text;
 const hash=createHash('sha256').update('agenticwiki:native-page:v1:'+nativeApp+':'+locale).digest('hex');
 const id=hash.slice(0,8)+'-'+hash.slice(8,12)+'-5'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
 return {id,title:localized(name),summary:localized(description),language:locale,labels:{templateId:nativeApp==='map'?'geo-v1':'data-tools-v1',overview:localized('Overview'),invalid:localized('Try again')},config:{template:'native-app-v1',executor:'native-app-v1',nativeApp,version:1,capability:'application',contextDomain:'app',labels:{overview:localized('Overview'),invalid:localized('Try again')}}};
}
export async function ensureNativePage(app:string,language?:string){
 const p=nativePageDefinition(app,language);
 await database().prepare("INSERT OR IGNORE INTO pages(id,owner_id,question,title,summary,body,category,sources,visibility,public_write,created_at,language,labels,kind,dynamic_config) VALUES(?,'system:native-apps',?,?,?,'','Native apps','[]','public',0,?,?,?,'dynamic',?)").bind(p.id,p.title,p.title,p.summary,new Date().toISOString(),p.language,JSON.stringify(p.labels),JSON.stringify(p.config)).run();
 if(app==='arcgis-publisher')await database().prepare("UPDATE pages SET title=?,summary=? WHERE id=? AND owner_id='system:native-apps'").bind(p.title,p.summary,p.id).run();
 return p.id;
}
export type NativeQuery=Record<string,string|string[]|undefined>;
export function nativePageAddress(id:string,query:NativeQuery){
 const parameters:Record<string,string>={};
 // Carry references only in this visit's URL/history, never in the shared page.
 for(const [key,target,max] of [['page','sourcePage',200],['file','file',200],['connector','connector',200],['name','name',300],['space','space',20]] as const){const value=query[key];if(typeof value==='string'&&value.length<=max)parameters[target]=value;}
 return pageAddress(id,parameters);
}
