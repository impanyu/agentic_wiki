import {database,getPage} from '@/db/store';
import {canWritePage} from '@/app/page-permissions';
import {chartBlockErrors} from '@/app/components-registry/chart-contracts';
import {relocateQuote} from '@/app/api/ask/refresh-matched-page';
import {keepOriginal,recordVersion} from '@/app/versions/service';
// The infrastructure layer's document store for wiki articles. The Markdown
// lives in the page record (with title, summary and sources) and every change
// is snapshotted in page_versions; callers use these functions, not the table.
export type Heading={level:number;text:string;line:number};
export function outline(body:string):Heading[]{
 const out:Heading[]=[];let fenced=false;
 body.split('\n').forEach((line,i)=>{if(/^\s*```/.test(line))fenced=!fenced;const m=!fenced&&/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);if(m)out.push({level:m[1].length,text:m[2],line:i});});
 return out;
}
const norm=(s:string)=>s.replace(/[*_`#\[\]]/g,'').trim().toLowerCase();
// The lines of a section: its heading through the line before the next heading of the same or higher level.
export function sectionRange(body:string,heading:string){
 const lines=body.split('\n'),hs=outline(body),i=hs.findIndex(h=>norm(h.text)===norm(heading));
 if(i<0)throw Error('No section "'+heading+'". Sections: '+hs.map(h=>h.text).join(' | ').slice(0,600));
 const h=hs[i],next=hs.slice(i+1).find(n=>n.level<=h.level);
 return {start:h.line,end:next?next.line:lines.length,lines};
}
export async function readMarkdown(pageId:string,userId:string,options:{section?:string}={}){
 const page=await getPage(pageId,userId);if(!page)throw Error('Page context is inaccessible.');
 const body=page.body||'',base={title:page.title,summary:page.summary,category:page.category,sources:page.sources,labels:{templateId:page.labels.templateId,indexEntries:page.labels.indexEntries},outline:outline(body).map(({level,text})=>({level,text}))};
 if(options.section){const r=sectionRange(body,options.section);return {...base,section:options.section,body:r.lines.slice(r.start,r.end).join('\n')};}
 return {...base,body};
}
export type MarkdownEdit={mode:'append'|'replace_section'|'insert_after_section'|'replace_body';text:string;heading?:string};
export function applyMarkdownEdit(body:string,edit:MarkdownEdit){
 const text=edit.text.replace(/\s+$/,'');
 if(edit.mode==='replace_body')return text+'\n';
 if(edit.mode==='append')return body.replace(/\s+$/,'')+'\n\n'+text+'\n';
 if(!edit.heading)throw Error('This edit needs the heading of a section.');
 const r=sectionRange(body,edit.heading),lines=r.lines;
 if(edit.mode==='replace_section')return [...lines.slice(0,r.start),text,'',...lines.slice(r.end)].join('\n').replace(/\n{3,}/g,'\n\n');
 return [...lines.slice(0,r.end),'',text,'',...lines.slice(r.end)].join('\n').replace(/\n{3,}/g,'\n\n');
}
// Writes the article as the user: only on pages they can edit; the previous text stays a restorable version.
export async function writeMarkdown(pageId:string,userId:string,edit:MarkdownEdit,summary='App edit'){
 const page=await getPage(pageId,userId);if(!page)throw Error('Page context is inaccessible.');if(!canWritePage(page))throw Error('PAGE_READ_ONLY');
 if(edit.text.length>40000)throw Error('Write at most 40,000 characters at a time.');
 const body=applyMarkdownEdit(page.body||'',edit);if(body.length>200000)throw Error('The article would exceed 200,000 characters.');
 const charts=chartBlockErrors(body);if(charts.length)throw Error(charts.join(' '));
 await keepOriginal(pageId,userId);
 const now=new Date().toISOString(),links=await database().prepare('SELECT id,quote,segments FROM internal_links WHERE source_id=?').bind(pageId).all<{id:string;quote:string;segments:string}>();
 const next={title:page.title,summary:page.summary,body};
 await database().batch([database().prepare("UPDATE pages SET body=?,updated_at=?,checked_at=NULL WHERE id=? AND (owner_id=? OR (visibility='public' AND public_write=1))").bind(body,now,pageId,userId),...links.results.map(l=>database().prepare('UPDATE internal_links SET segments=? WHERE id=?').bind(JSON.stringify(relocateQuote(l.quote,JSON.parse(l.segments),next)),l.id))]);
 await recordVersion(pageId,userId,'editor',summary);
 return {saved:true,outline:outline(body).map(({level,text})=>({level,text})),chars:body.length};
}
