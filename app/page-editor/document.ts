import {z} from 'zod';
import {publicMediaUrl,videoEmbedUrl} from '@/app/url-content/media';
export type RichNode={type:string;text?:string;attrs?:Record<string,unknown>;marks?:{type:string;attrs?:Record<string,unknown>}[];content?:RichNode[]};
export function safeRichUrl(value:unknown,media=false){
 if(typeof value!=='string'||value.length>4000)return null;
 if(/^\/\?page=[0-9a-f-]{36}$/.test(value))return media?null:value;
 if(/^\/api\/pages\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}\?inline=1$/.test(value))return value;
 if(!media&&/^https?:\/\//.test(value)){try{const u=new URL(value);return u.username||u.password?null:u.href;}catch{return null;}}
 return publicMediaUrl(value);
}
const attrs=z.record(z.unknown());
const schema:z.ZodType<RichNode>=z.lazy(()=>z.object({type:z.enum(['doc','paragraph','heading','text','bulletList','orderedList','listItem','blockquote','codeBlock','hardBreak','horizontalRule','image','video','table','tableRow','tableCell','tableHeader']),text:z.string().max(100000).optional(),attrs:attrs.optional(),marks:z.array(z.object({type:z.enum(['bold','italic','strike','underline','code','link']),attrs:attrs.optional()})).max(6).optional(),content:z.array(schema).max(2000).optional()}));
export function validateDocument(value:unknown){
 const raw=JSON.stringify(value);if(raw.length>500000)throw Error('The page content is too large.');
 let count=0;function depth(v:any,n=0){if(n>30||++count>10000)throw Error('The page is too complex.');for(const c of v?.content||[])depth(c,n+1);}depth(value);
 const doc=schema.parse(value);if(doc.type!=='doc')throw Error('Invalid page document.');
 function clean(n:RichNode):RichNode{
  const a=n.attrs||{},out:RichNode={type:n.type};if(n.text!==undefined)out.text=n.text;
  if(n.type==='heading')out.attrs={level:[1,2,3].includes(Number(a.level))?Number(a.level):2};
  if(n.type==='orderedList')out.attrs={start:Math.max(1,Math.min(10000,Number(a.start)||1))};
  if(n.type==='image'||n.type==='video'){const src=safeRichUrl(a.src,true);if(!src)throw Error('Enter a valid media URL.');if(n.type==='video'&&a.embed&&!videoEmbedUrl(src))throw Error('This video provider is not supported.');out.attrs={src,alt:String(a.alt||'').slice(0,500),title:String(a.title||'').slice(0,500),...(n.type==='video'?{embed:!!a.embed}:{})};}
  if(n.type==='tableCell'||n.type==='tableHeader')out.attrs={colspan:Math.max(1,Math.min(20,Number(a.colspan)||1)),rowspan:Math.max(1,Math.min(50,Number(a.rowspan)||1))};
  if(n.marks)out.marks=n.marks.map(mark=>{if(mark.type!=='link')return {type:mark.type};const href=safeRichUrl(mark.attrs?.href);if(!href)throw Error('Enter a valid link URL.');return {type:'link',attrs:{href}};});
  if(n.content)out.content=n.content.map(clean);return out;
 }return clean(doc);
}
export function documentMarkdown(doc:RichNode):string{
 const escape=(s:string)=>s.replace(/[\\`*_[\]]/g,'\\$&');
 function text(n:RichNode):string{
  if(n.type==='text'){let value=escape(n.text||'');for(const m of n.marks||[]){if(m.type==='bold')value='**'+value+'**';if(m.type==='italic')value='*'+value+'*';if(m.type==='strike')value='~~'+value+'~~';if(m.type==='code')value='`'+(n.text||'').replace(/`/g,'\\`')+'`';if(m.type==='link')value='['+value+']('+String(m.attrs?.href).replace(/\(/g,'%28').replace(/\)/g,'%29')+')';}return value;}
  const inner=(n.content||[]).map(text).join('');
  if(n.type==='heading')return '#'.repeat(Number(n.attrs?.level)||2)+' '+inner+'\n\n';
  if(n.type==='paragraph')return inner+'\n\n';
  if(n.type==='hardBreak')return '\n';if(n.type==='horizontalRule')return '\n---\n\n';
  if(n.type==='image')return '!['+escape(String(n.attrs?.alt||''))+']('+n.attrs?.src+')\n\n';
  if(n.type==='video')return '['+escape(String(n.attrs?.title||'Video'))+']('+n.attrs?.src+')\n\n';
  if(n.type==='blockquote')return inner.trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
  if(n.type==='bulletList'||n.type==='orderedList')return (n.content||[]).map((c,i)=>(n.type==='bulletList'?'- ':String(i+Number(n.attrs?.start||1))+'. ')+text(c).trim().replace(/\n/g,'\n  ')).join('\n')+'\n\n';
  if(n.type==='codeBlock')return '```\n'+(n.content||[]).map(c=>c.text||'').join('')+'\n```\n\n';
  if(n.type==='table'){const rows=(n.content||[]).map(r=>'| '+(r.content||[]).map(c=>text(c).trim().replace(/\n/g,' ').replace(/\|/g,'\\|')).join(' | ')+' |');if(rows.length)rows.splice(1,0,'| '+(n.content?.[0].content||[]).map(()=> '---').join(' | ')+' |');return rows.join('\n')+'\n\n';}
  return inner;
 }return text(doc).trim();
}
