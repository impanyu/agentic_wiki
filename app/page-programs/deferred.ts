import type {AnswerPage} from '@/app/page-types';
// Upgrade only basic saved storage browsers; preserve custom analytical programs.
export function registeredStoragePage(page:AnswerPage):AnswerPage{
 if(page.dynamic?.customized)return page;
 const question=(page.question||'').trim();
 const drive=/^(?:(?:list|show|browse|open|manage)(?:\s+me)?(?:\s+my)?\s+)?(?:my\s+)?google\s+drive(?:['’]s)?(?:\s+(?:files|folders|dashboard|file browser))?(?:\s+and\s+folders)?[.!?]?$/i.test(question);
 if(page.dynamic?.template!=='page-program-v1'||!drive)return page;
 return {...page,view:undefined,runtimePending:false,runtimeError:undefined,labels:{...page.labels,templateId:'files-v1'},dynamic:{...page.dynamic,template:'file-browser-v1',executor:'registered-file-browser-v1',nativeApp:undefined}} as AnswerPage;
}
export function deferPageExecution(page:AnswerPage,parameters=page.parameters||{}):AnswerPage{
 page=registeredStoragePage(page);
 return page.dynamic?.template==='page-program-v1'?{...page,parameters,runtimePending:true}:{...page,parameters};
}
