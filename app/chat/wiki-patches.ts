import {z} from 'zod';
const indexEntry=z.object({question:z.string().trim().min(1).max(500),description:z.string().trim().min(1).max(1200),group:z.string().trim().max(120)}).strict();
export const wikiEditSchema=z.object({apply:z.boolean(),discard:z.boolean(),reply:z.string().min(1).max(12000),title:z.string().min(1).max(200).nullable(),summary:z.string().max(2000).nullable(),indexEntries:z.array(indexEntry).min(2).max(30).nullable().optional(),sources:z.array(z.object({title:z.string().trim().min(1).max(300),url:z.string().url().max(2000)}).strict()).max(60).nullable().optional(),category:z.string().trim().max(100).nullable().optional(),edits:z.array(z.object({operation:z.enum(['replace','append','prepend']),oldText:z.string(),newText:z.string()}).strict()).max(60)}).strict();
export const wikiEditFormat={type:'object',additionalProperties:false,properties:{apply:{type:'boolean'},discard:{type:'boolean'},reply:{type:'string',minLength:1,maxLength:12000},title:{type:['string','null'],minLength:1,maxLength:200},summary:{type:['string','null'],maxLength:2000},indexEntries:{type:['array','null'],minItems:2,maxItems:30,items:{type:'object',additionalProperties:false,properties:{question:{type:'string',minLength:1,maxLength:500},description:{type:'string',minLength:1,maxLength:1200},group:{type:'string',maxLength:120}},required:['question','description','group']}},sources:{type:['array','null'],maxItems:60,items:{type:'object',additionalProperties:false,properties:{title:{type:'string',minLength:1,maxLength:300},url:{type:'string',maxLength:2000}},required:['title','url']}},category:{type:['string','null'],maxLength:100},edits:{type:'array',maxItems:60,items:{type:'object',additionalProperties:false,properties:{operation:{type:'string',enum:['replace','append','prepend']},oldText:{type:'string'},newText:{type:'string'}},required:['operation','oldText','newText']}}},required:['apply','discard','reply','title','summary','indexEntries','sources','category','edits']};
export function applyWikiPatches(base:{title:string;summary:string;body:string;indexEntries?:z.infer<typeof indexEntry>[];sources?:{title:string;url:string}[];category?:string},decision:z.infer<typeof wikiEditSchema>){
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
 // Models sometimes pad the URL inside an image link; normalize so the line renders as a figure.
 body=body.split('\n').map(line=>line.replace(/^(!\[[^\]]*\]\()\s*([^\s)]+)\s*\)\s*$/,'$1$2)')).join('\n');
 if(summary.length>2000)throw Error('EDIT_PATCH_INVALID: overview exceeds 2000 characters.');
 if(body.length>120000)throw Error('EDIT_PATCH_INVALID: article exceeds 120000 characters.');
 const indexEntries=decision.indexEntries??base.indexEntries;
 if(indexEntries&&new Set(indexEntries.map(entry=>entry.question.toLocaleLowerCase())).size!==indexEntries.length)throw Error('EDIT_PATCH_INVALID: index questions must be distinct.');
 return {title:decision.title??base.title,summary,body,indexEntries,sources:decision.sources??base.sources,category:decision.category??base.category};
}
