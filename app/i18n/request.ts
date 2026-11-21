import {headers} from 'next/headers';
import {isLocale,DEFAULT_LOCALE,type Locale} from './locales';
import {dictionary,translate} from './dictionaries';
// The locale of the page being rendered (set by proxy.ts from the /<code>/ prefix).
export async function requestLocale():Promise<Locale>{
 const l=(await headers()).get('x-rw-locale');
 return isLocale(l)?l:DEFAULT_LOCALE;
}
// A server-side translator for the request's locale.
export async function serverUi(){
 const locale=await requestLocale();const dict=dictionary(locale);
 return {locale,dict,t:(text:string,values?:Record<string,string|number>)=>translate(dict,text,values)};
}
