'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {EditorContent,useEditor} from '@tiptap/react';
import {marked} from 'marked';
import {editorExtensions} from './extensions';
import {safeRichUrl} from './document';
import {videoEmbedUrl} from '@/app/url-content/media';
import {useUi} from '@/app/i18n/client';
import type {AnswerPage} from '@/app/page-types';
import type {ContextFile} from '@/app/context-files/server';
export function PageEditor({page,onSave,onClose,onFiles}:{page:AnswerPage;onSave:(page:AnswerPage)=>void;onClose:()=>void;onFiles:()=>void}){
 const {t}=useUi(),[title,setTitle]=useState(page.title),[summary,setSummary]=useState(page.summary),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[panel,setPanel]=useState<'link'|'image'|'video'|null>(null),[url,setUrl]=useState(''),[label,setLabel]=useState(''),[files,setFiles]=useState<ContextFile[]>([]),[targets,setTargets]=useState<{id:string;title:string}[]>([]),[search,setSearch]=useState('');
 const upload=useRef<HTMLInputElement>(null),[,redraw]=useState(0);
 const initial=useMemo(()=>{
  if(page.labels.richContent&&page.labels.richBody===page.body)return page.labels.richContent;
  let body=page.body;
  if(page.labels.templateId==='disambiguation-v1')body+='\n\n'+(page.labels.indexEntries||[]).map(e=>'## '+e.question+'\n\n'+e.description).join('\n\n');
  const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const media=(page.labels.sourceMedia||[]).map(m=>{const src=safeRichUrl(m.url,true);if(!src)return '';const caption=escape(m.caption||m.description);return m.kind==='image'?'<img src="'+escape(src)+'" alt="'+caption+'" title="'+caption+'">':m.kind==='embed'?'<iframe src="'+escape(src)+'" title="'+caption+'"></iframe>':'<video src="'+escape(src)+'" title="'+caption+'"></video>';}).join('');
  return media+marked.parse(body,{async:false});
 },[page]);
 const editor=useEditor({extensions:editorExtensions,content:initial,immediatelyRender:false,onCreate:({editor})=>{
  if(page.labels.richContent&&page.labels.richBody===page.body)return;
  // Preserve existing wiki links when importing a generated article into rich text.
  const tr=editor.state.tr;
  editor.state.doc.descendants((node,pos)=>{if(!node.isText||!node.text||node.marks.some(m=>m.type.name==='link'))return;
   for(const link of page.links||[]){const start=node.text.indexOf(link.quote);if(start>=0)tr.addMark(pos+start,pos+start+link.quote.length,editor.schema.marks.link.create({href:'/?page='+link.targetId}));}
  });
  if(tr.docChanged)editor.view.dispatch(tr);
 },onUpdate:()=>setDirty(true),onTransaction:()=>redraw(n=>n+1),editorProps:{attributes:{'aria-label':t('Page content'),class:'rich-document'}}});
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 useEffect(()=>{if(!panel)return;const c=new AbortController();fetch('/api/pages/'+page.id+'/files',{signal:c.signal}).then(r=>r.json() as Promise<any>).then(d=>setFiles(d.files||[])).catch(()=>{});return()=>c.abort();},[panel,page.id]);
 useEffect(()=>{if(panel!=='link')return;const c=new AbortController();fetch('/api/page-link-targets?q='+encodeURIComponent(search),{signal:c.signal}).then(r=>r.json() as Promise<any>).then(d=>setTargets(d.pages||[])).catch(()=>{});return()=>c.abort();},[search,panel]);
 function close(){if(!dirty||confirm(t('Discard unsaved changes?')))onClose();}
 async function save(){if(!editor||busy)return;setBusy(true);setError('');try{const r=await fetch('/api/pages/'+page.id+'/content',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,summary,document:editor.getJSON(),base:page.updatedAt||page.createdAt})}),d=await r.json() as any;if(!r.ok)throw Error(d.error);setDirty(false);onSave(d.page);}catch(e){setError(e instanceof Error?e.message:'Could not save changes.');}finally{setBusy(false);}}
 function insert(value=url){if(!editor||!panel)return;const href=safeRichUrl(value,panel!=='link');if(!href){setError('Enter a valid link URL.');return;}
  if(panel==='link'){if(editor.state.selection.empty&&label)editor.chain().focus().insertContent({type:'text',text:label,marks:[{type:'link',attrs:{href}}]}).run();else editor.chain().focus().extendMarkRange('link').setLink({href}).run();}
  else if(panel==='image')editor.chain().focus().setImage({src:href,alt:label,title:label}).run();
  else editor.chain().focus().insertContent({type:'video',attrs:{src:videoEmbedUrl(href)||href,embed:!!videoEmbedUrl(href),title:label}}).run();
  setPanel(null);setUrl('');setLabel('');setError('');
 }
 async function uploadMedia(file:File){setBusy(true);setError('');try{const r=await fetch('/api/components/upload',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-Page-Id':page.id,'X-File-Name':encodeURIComponent(file.name)},body:file}),d=await r.json() as any;if(!r.ok||!d.file)throw Error(d.error||'Could not upload the file.');onFiles();insert(d.file.url+'?inline=1');}catch(e){setError(e instanceof Error?e.message:'Could not upload the file.');}finally{setBusy(false);if(upload.current)upload.current.value='';}}
 if(!editor)return <p>{t('Loading…')}</p>;
 const button=(name:string,action:()=>void,active=false)=><button type="button" disabled={busy} aria-pressed={active} onClick={action}>{t(name)}</button>;
 return <section className="page-editor" aria-label={t('Edit page')}>
  <div className="editor-top"><strong>{t('Editing · Not saved')}</strong><div><button disabled={busy} onClick={()=>void save()}>{t('Save changes')}</button><button disabled={busy} onClick={close}>{t('Cancel')}</button></div></div>
  <label className="editor-title-label">{t('Page title')}<input className="editor-title" value={title} maxLength={200} onChange={e=>{setTitle(e.target.value);setDirty(true);}}/></label>
  <label>{t('Summary')}<textarea className="editor-summary" value={summary} maxLength={4000} onChange={e=>{setSummary(e.target.value);setDirty(true);}}/></label>
  <div className="editor-toolbar" role="toolbar" aria-label={t('Formatting')}>
   {button('Undo',()=>editor.chain().focus().undo().run())}{button('Redo',()=>editor.chain().focus().redo().run())}
   <select aria-label={t('Text style')} value={editor.isActive('heading',{level:2})?'h2':editor.isActive('heading',{level:3})?'h3':'p'} onChange={e=>e.target.value==='p'?editor.chain().focus().setParagraph().run():editor.chain().focus().toggleHeading({level:e.target.value==='h2'?2:3}).run()}><option value="p">{t('Paragraph')}</option><option value="h2">{t('Heading')}</option><option value="h3">{t('Subheading')}</option></select>
   {button('Bold',()=>editor.chain().focus().toggleBold().run(),editor.isActive('bold'))}{button('Italic',()=>editor.chain().focus().toggleItalic().run(),editor.isActive('italic'))}{button('Underline',()=>editor.chain().focus().toggleUnderline().run(),editor.isActive('underline'))}{button('Bullet list',()=>editor.chain().focus().toggleBulletList().run())}{button('Numbered list',()=>editor.chain().focus().toggleOrderedList().run())}{button('Quote',()=>editor.chain().focus().toggleBlockquote().run())}{button('Table',()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run())}
   {(['link','image','video'] as const).map(kind=>button(kind==='link'?'Add link':kind==='image'?'Add image':'Add video',()=>{setPanel(kind);setUrl(kind==='link'?editor.getAttributes('link').href||'':'');setLabel('');}))}{button('Remove link',()=>editor.chain().focus().unsetLink().run())}
  </div>
  {panel&&<div className="editor-insert"><label>{t('URL')}<input value={url} onChange={e=>setUrl(e.target.value)} placeholder={panel==='link'?'https://… /?page=…':'https://…'}/></label><label>{t('Link text or caption')}<input value={label} onChange={e=>setLabel(e.target.value)}/></label><button disabled={busy||!url} onClick={()=>insert()}>{t('Insert')}</button><button onClick={()=>setPanel(null)}>{t('Cancel')}</button>
   {panel==='link'?<><label>{t('Link to a page')}<input value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="editor-file-picker">{targets.map(p=><button key={p.id} onClick={()=>{if(editor.state.selection.empty)editor.chain().focus().insertContent({type:'text',text:label||p.title,marks:[{type:'link',attrs:{href:'/?page='+p.id}}]}).run();else editor.chain().focus().setLink({href:'/?page='+p.id}).run();setPanel(null);}}>{p.title}</button>)}</div></>:<><button disabled={busy} onClick={()=>upload.current?.click()}>{t('Upload file')}</button><input ref={upload} hidden type="file" accept={panel==='image'?'image/png,image/jpeg,image/webp,image/gif':'video/mp4,video/webm,video/ogg'} onChange={e=>{if(e.target.files?.[0])void uploadMedia(e.target.files[0]);}}/><div className="editor-file-picker">{files.filter(f=>panel==='image'?/\.(png|jpe?g|webp|gif)$/i.test(f.name):/\.(mp4|webm|ogg)$/i.test(f.name)).map(f=><button key={f.id} onClick={()=>insert(f.url+'?inline=1')}>{f.folderPath?f.folderPath+'/':''}{f.name}</button>)}</div></>}
  </div>}
  <EditorContent editor={editor}/>{error&&<p role="alert">{t(error)}</p>}
 </section>;
}
