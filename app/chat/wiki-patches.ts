import {z} from 'zod';
export const wikiEditSchema=z.object({apply:z.boolean(),discard:z.boolean(),reply:z.string().min(1).max(12000),title:z.string().min(1).max(200).nullable(),summary:z.string().max(2000).nullable(),edits:z.array(z.object({operation:z.enum(['replace','append','prepend']),oldText:z.string(),newText:z.string()}).strict()).max(60)}).strict();
export const wikiEditFormat={type:'object',additionalProperties:false,properties:{apply:{type:'boolean'},discard:{type:'boolean'},reply:{type:'string',minLength:1,maxLength:12000},title:{type:['string','null'],minLength:1,maxLength:200},summary:{type:['string','null'],maxLength:2000},edits:{type:'array',maxItems:60,items:{type:'object',additionalProperties:false,properties:{operation:{type:'string',enum:['replace','append','prepend']},oldText:{type:'string'},newText:{type:'string'}},required:['operation','oldText','newText']}}},required:['apply','discard','reply','title','summary','edits']};
export function applyWikiPatches(base:{title:string;summary:string;body:string},decision:z.infer<typeof wikiEditSchema>){
 let body=base.body,summary=decision.summary??base.summary;
 for(const edit of decision.edits){
  if(edit.operation==='replace'){
   // Models sometimes express overview edits as text replacements. Apply them
   // to the overview only when the quoted passage identifies it unambiguously.
   if(edit.oldText&&!body.includes(edit.oldText)&&base.summary.includes(edit.oldText)&&base.summary.indexOf(edit.oldText)===base.summary.lastIndexOf(edit.oldText)){
    const revised=base.summary.replace(edit.oldText,()=>edit.newText);
    if(summary===base.summary)summary=revised;
    else if(summary!==revised)throw Error('EDIT_PATCH_INVALID: conflicting overview changes; return final summary and no overview body edits.');
    continue;
   }
   if(!edit.oldText||!body.includes(edit.oldText)||body.indexOf(edit.oldText)!==body.lastIndexOf(edit.oldText))throw Error('EDIT_PATCH_INVALID: replacement must match exactly one passage; include more surrounding text.');
   body=body.replace(edit.oldText,()=>edit.newText);
  }else{
   if(edit.oldText)throw Error('EDIT_PATCH_INVALID: append/prepend oldText must be empty.');
   body=edit.operation==='append'?body+edit.newText:edit.newText+body;
  }
 }
 if(summary.length>2000)throw Error('EDIT_PATCH_INVALID: overview exceeds 2000 characters.');
 if(body.length>120000)throw Error('EDIT_PATCH_INVALID: article exceeds 120000 characters.');
 return {title:decision.title??base.title,summary,body};
}
