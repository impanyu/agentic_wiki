import type {AnswerPage} from '@/app/page-types';
export function deferPageExecution(page:AnswerPage,parameters=page.parameters||{}):AnswerPage{
 return page.dynamic?.template==='page-program-v1'?{...page,parameters,runtimePending:true}:page;
}
