import type {AnswerPage} from '@/app/page-types';
// Upgrade only basic saved storage browsers; preserve custom analytical programs.
export function registeredAdmaPage(page:AnswerPage):AnswerPage{
 const question=(page.question||'').trim();
 const basic=/^(?:list|show|browse|open|manage)(?:\s+me)?(?:\s+my)?\s+adma(?:['’]s)?\s+(?:files|folders)(?:\s+and\s+(?:files|folders))?[.!?]?$/i.test(question);
 const drive=/^(?:(?:list|show|browse|open|manage)(?:\s+me)?(?:\s+my)?\s+)?(?:my\s+)?google\s+drive(?:['’]s)?(?:\s+(?:files|folders|dashboard|file browser))?(?:\s+and\s+folders)?[.!?]?$/i.test(question);
 if(page.dynamic?.template!=='page-program-v1'||!(basic||drive))return page;
 return {...page,view:undefined,runtimePending:false,runtimeError:undefined,labels:{...page.labels,templateId:'files-v1'},dynamic:{...page.dynamic,template:'file-browser-v1',executor:'registered-file-browser-v1'}};
}
export function deferPageExecution(page:AnswerPage,parameters=page.parameters||{}):AnswerPage{
 page=registeredAdmaPage(page);
 return page.dynamic?.template==='page-program-v1'?{...page,parameters,runtimePending:true}:{...page,parameters};
}
