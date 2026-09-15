'use client';
import type {ReactNode} from 'react';
import type {RichNode} from './document';
import {safeRichUrl} from './document';
import {SourceMediaView} from '@/app/url-content/media-view';
export function richHeadings(document:RichNode){
 const result:{id:string;title:string;level:number}[]=[];
 const text=(n:RichNode):string=>n.text||(n.content||[]).map(text).join('');
 function visit(n:RichNode,key:string){if(n.type==='heading')result.push({id:'rich-'+key,title:text(n),level:Number(n.attrs?.level)||2});n.content?.forEach((c,i)=>visit(c,key+'.'+i));}
 visit(document,'doc');return result;
}
export function RichContent({document}:{document:RichNode}){
 function node(n:RichNode,key:string):ReactNode{
  const children=n.content?.map((c,i)=>node(c,key+'.'+i)),a=n.attrs||{};
  if(n.type==='text'){let value:ReactNode=n.text;for(const [i,m] of (n.marks||[]).entries()){const k=key+'.m'+i;if(m.type==='bold')value=<strong key={k}>{value}</strong>;if(m.type==='italic')value=<em key={k}>{value}</em>;if(m.type==='strike')value=<s key={k}>{value}</s>;if(m.type==='underline')value=<u key={k}>{value}</u>;if(m.type==='code')value=<code key={k}>{value}</code>;if(m.type==='link'){const href=safeRichUrl(m.attrs?.href);if(href)value=<a key={k} href={href} target={href.startsWith('/')?undefined:'_blank'} rel="noopener noreferrer">{value}</a>;}}return <span key={key}>{value}</span>;}
  switch(n.type){case 'doc':return children;case 'paragraph':return <p key={key}>{children?.length?children:<br/>}</p>;case 'heading':return Number(a.level)===1?<h1 id={"rich-"+key} key={key}>{children}</h1>:Number(a.level)===3?<h3 id={"rich-"+key} key={key}>{children}</h3>:<h2 id={"rich-"+key} key={key}>{children}</h2>;case 'bulletList':return <ul key={key}>{children}</ul>;case 'orderedList':return <ol key={key} start={Number(a.start)||1}>{children}</ol>;case 'listItem':return <li key={key}>{children}</li>;case 'blockquote':return <blockquote key={key}>{children}</blockquote>;case 'codeBlock':return <pre key={key}><code>{children}</code></pre>;case 'hardBreak':return <br key={key}/>;case 'horizontalRule':return <hr key={key}/>;case 'table':return <div key={key} className="rich-table"><table><tbody>{children}</tbody></table></div>;case 'tableRow':return <tr key={key}>{children}</tr>;case 'tableHeader':return <th key={key} colSpan={Number(a.colspan)||1} rowSpan={Number(a.rowspan)||1}>{children}</th>;case 'tableCell':return <td key={key} colSpan={Number(a.colspan)||1} rowSpan={Number(a.rowspan)||1}>{children}</td>;case 'image':{const src=safeRichUrl(a.src,true);return src?<figure key={key}><img src={src} alt={String(a.alt||'')} loading="lazy" referrerPolicy="no-referrer"/>{!!a.title&&<figcaption>{String(a.title)}</figcaption>}</figure>:null;}case 'video':{const src=safeRichUrl(a.src,true);if(!src)return null;return a.embed?<SourceMediaView key={key} media={[{id:key,kind:'embed',url:src,source:src,description:String(a.title||'')}]} />:<figure key={key}><video src={src} controls preload="none"/><figcaption>{String(a.title||'')}</figcaption></figure>;}default:return null;}
 }
 return <div className="rich-document">{node(document,'doc')}</div>;
}
