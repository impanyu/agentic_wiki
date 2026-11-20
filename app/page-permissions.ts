import {PUBLIC_EDITION} from './edition';
import type {AnswerPage} from './page-types';
export type PageAccess='private'|'public-read'|'public-write';
export function pageAccess(page:Pick<AnswerPage,'visibility'|'publicWrite'>):PageAccess{
 return page.visibility==='private'?'private':page.publicWrite?'public-write':'public-read';
}
// Native app pages render only platform code and never save results into the
// shared page, so a visitor may use their own connectors there without forking.
// Pages carrying saved custom code keep the ordinary write requirement.
export function canUseConnectorsOn(page:(Pick<AnswerPage,'owned'|'visibility'|'publicWrite'>&{dynamic?:{template?:string;pageCode?:unknown}})|null|undefined):boolean{
 if(PUBLIC_EDITION)return false;
 return canWritePage(page)||(!!page&&page.dynamic?.template==='native-app-v1'&&!page.dynamic.pageCode);
}
export function canWritePage(page:Pick<AnswerPage,'owned'|'visibility'|'publicWrite'>|null|undefined):boolean{
 if(PUBLIC_EDITION)return false; // pages are read-only for everyone in the public edition
 return !!page&&(page.owned||(page.visibility==='public'&&page.publicWrite===true));
}
