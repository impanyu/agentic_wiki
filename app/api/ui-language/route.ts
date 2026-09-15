import {sameOrigin,reply} from '@/db/store';
import {uiTranslations} from '@/app/i18n/server';
export async function POST(request:Request){
 if(!sameOrigin(request))return reply({error:'Invalid origin'},403);
 try{const {language}=await request.json() as {language?:unknown};if(typeof language!=='string'||new Intl.DisplayNames(['en'],{type:'language'}).of(language)===language||!/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(language))return reply({error:'Invalid language'},400);return reply(await uiTranslations(language));}
 catch{return reply({error:'UI translation unavailable'},503);}
}
