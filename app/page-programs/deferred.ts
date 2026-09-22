import type {AnswerPage} from '@/app/page-types';
// Match only ordinary combined browsers, not analytical or custom dashboard tasks.
export function basicCombinedRepositories(question:string){
 if(!/\badma\b/i.test(question)||!/google\s*drive/i.test(question))return false;
 const rest=question.toLowerCase().replace(/google\s*drive|\badma\b/g,' ').replace(/['’]s\b/g,' ').replace(/[+,&.!?]/g,' ').trim();
 return rest.split(/\s+/).every(word=>['create','build','make','a','an','the','combined','unified','and','with','my','me','for','please','dashboard','dashboards','file','files','folder','folders','browser','browsers','list','show','browse','open','manage','management','repository','repositories','data','storage','side','by'].includes(word));
}
export function basicAdmaDashboard(question:string){return /^(?:my\s+)?adma\s+dashboard[.!?]?$/i.test(question.trim());}
// Upgrade only basic saved storage browsers; preserve custom analytical programs.
export function registeredAdmaPage(page:AnswerPage):AnswerPage{
 if(page.dynamic?.customized)return page;
 const question=(page.question||'').trim();
 const basic=/^(?:list|show|browse|open|manage)(?:\s+me)?(?:\s+my)?\s+adma(?:['’]s)?\s+(?:files|folders)(?:\s+and\s+(?:files|folders))?[.!?]?$/i.test(question);
 const drive=/^(?:(?:list|show|browse|open|manage)(?:\s+me)?(?:\s+my)?\s+)?(?:my\s+)?google\s+drive(?:['’]s)?(?:\s+(?:files|folders|dashboard|file browser))?(?:\s+and\s+folders)?[.!?]?$/i.test(question);
 const dashboard=basicAdmaDashboard(question);
 if(!dashboard&&(page.dynamic?.template!=='page-program-v1'||!(basic||drive||basicCombinedRepositories(question))))return page;
 return {...page,...(dashboard?{title:'ADMA Dashboard',summary:'Browse and manage your connected ADMA files, folders and geospatial data.',body:''}:{}),view:undefined,runtimePending:false,runtimeError:undefined,labels:{...page.labels,templateId:'files-v1'},dynamic:{...page.dynamic,template:'file-browser-v1',executor:'registered-file-browser-v1',nativeApp:undefined}} as AnswerPage;
}
export function deferPageExecution(page:AnswerPage,parameters=page.parameters||{}):AnswerPage{
 page=registeredAdmaPage(page);
 return page.dynamic?.template==='page-program-v1'?{...page,parameters,runtimePending:true}:{...page,parameters};
}
