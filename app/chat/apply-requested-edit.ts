import {saveEditDraft,type EditDraft} from './edit-draft';
import type {AnswerPage} from '@/app/page-types';
import type {Agent} from '@/app/components-registry/agents';

export async function applyRequestedEdit(result:{reply:string;page:AnswerPage;editDraft:EditDraft|null;saveRequested?:boolean},agent:Agent,signal?:AbortSignal){
 if(!result.saveRequested||!result.editDraft||!result.page.owned)return result;
 signal?.throwIfAborted();
 const saved=await saveEditDraft(agent,result.page.id,result.editDraft.id);
 return {...result,page:saved.page,editDraft:null,reply:result.page.language.startsWith('zh')?'已按你的要求修改并保存页面，正文已更新。':'The requested changes have been saved. The article is now updated.'};
}
