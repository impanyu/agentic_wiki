import type {AnswerPage} from './page-types';
export type PageAccess='private'|'public-read'|'public-write';
export function pageAccess(page:Pick<AnswerPage,'visibility'|'publicWrite'>):PageAccess{
 return page.visibility==='private'?'private':page.publicWrite?'public-write':'public-read';
}
export function canWritePage(page:Pick<AnswerPage,'owned'|'visibility'|'publicWrite'>|null|undefined):boolean{
 return !!page&&(page.owned||(page.visibility==='public'&&page.publicWrite===true));
}
