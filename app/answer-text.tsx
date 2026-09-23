'use client';
import {useUi} from '@/app/i18n/client';
import {RichContent,richHeadings} from './page-editor/view';
import {SourceMediaView} from './url-content/media-view';
import {videoEmbedUrl} from './url-content/media';
import {availableConcepts} from './concepts/ranges';
import {useState, type ReactNode} from 'react';
import {pageAddress} from './dynamic/units';
import {CornerUpLeft} from 'lucide-react';
import {Dashboard} from './templates/dashboard';
import {chartSchema,validateChartData} from './components-registry/chart-contracts';
import {inlineParts,linkPattern,isSourceLabel,linkLevels,articleImage,articleCredit,type Highlight,type InternalLink} from './internal-links';
export type {Highlight} from './internal-links';
export function AnswerText({body,title,summary,labels,sources,highlights,links=[],concepts=[],onJump,onOpen,children}:{children?:React.ReactNode;body:string;title:string;summary:string;labels:import('./page-types').AnswerPage['labels'];sources:{title:string;url:string}[];highlights:Highlight[];links?:InternalLink[];concepts?:Highlight[];onJump:(highlight:Highlight)=>void;onOpen:(link:InternalLink)=>void}){
 const {t,locale}=useUi();

 // One source number per URL; each occurrence gets its own return anchor.
 const references:{title:string;url:string;occurrences:string[]}[]=[];
 function sourceFor(url:string,title:string){let index=references.findIndex(s=>s.url===url);if(index<0){index=references.length;references.push({url,title,occurrences:[]});}return index;}
 for(const source of sources)if(/^https?:\/\//.test(source.url))sourceFor(source.url,source.title);
 function jumpTo(id:string){const target=document.getElementById(id);target?.scrollIntoView({block:'center'});target?.focus({preventScroll:true});}
 function citation(url:string,label:string,key:string){
  const index=sourceFor(url,label),id='citation-'+key;references[index].occurrences.push(id);
  return <sup className="citation" key={key}><a id={id} href={'#source-'+(index+1)} aria-label={t("Source ")+(index+1)} onClick={e=>{e.preventDefault();jumpTo('source-'+(index+1));}}>[{index+1}]</a></sup>;
 }
 const suggestions=availableConcepts(concepts,links,highlights);
 const levels=linkLevels(links),tabStops=new Set<string>();
 function text(value:string,id:string){
  const linked=links.flatMap(link=>link.segments.filter(s=>s.node===id&&s.end<=value.length).map(s=>({...s,link})));
  const marked=highlights.flatMap(h=>h.segments.filter(s=>s.node===id&&s.end<=value.length).map(s=>({...s,highlight:h})));
  const suggested=suggestions.flatMap(h=>h.segments.filter(s=>s.node===id&&s.end<=value.length).map(s=>({...s,highlight:h})));
  const boundaries=[...new Set([0,value.length,...linked.flatMap(s=>[s.start,s.end]),...marked.flatMap(s=>[s.start,s.end]),...suggested.flatMap(s=>[s.start,s.end])])].sort((a,b)=>a-b);
  const pieces:ReactNode[]=[];
  for(let i=0;i<boundaries.length-1;i++){
   const start=boundaries[i],end=boundaries[i+1],content=value.slice(start,end);
   const active=linked.filter(s=>s.start<=start&&s.end>=end).sort((a,b)=>levels.get(a.link.id)!-levels.get(b.link.id)!);
   const mark=marked.find(s=>s.start<=start&&s.end>=end);
   if(active.length){
    // Small inline boxes allow every line to wrap while retaining independently clickable underline tracks.
    const chunks=content.match(/[\p{Script=Latin}\p{Number}]+|[^]/gu)||[];
    pieces.push(...chunks.map((chunk,j)=><span className="internal-fragment" key={start+'.'+j} style={{paddingBottom:(Math.max(...active.map(s=>levels.get(s.link.id)!))+1)*5+'px'}}><span className={mark?'pending-highlight':undefined} onClick={()=>{if(!window.getSelection()?.toString()){if(mark)onJump(mark.highlight);else onOpen(active[0].link);}}}>{chunk}</span>{active.map(({link})=>{const first=!tabStops.has(link.id);tabStops.add(link.id);return <a className="internal-track" key={link.id} href={pageAddress(link.targetId,link.parameters)} style={{bottom:(Math.max(...active.map(s=>levels.get(s.link.id)!))-levels.get(link.id)!)*5+'px'}} tabIndex={first?0:-1} aria-label={t("Open ")+link.quote+': '+link.targetTitle} title={link.quote+' → '+link.targetTitle} onClick={e=>{e.preventDefault();e.stopPropagation();if(!window.getSelection()?.toString())onOpen(link);}}/>;})}</span>));
   }else if(mark)pieces.push(<mark key={start} role="link" tabIndex={0} title={t("Open: ")+mark.highlight.quote} onClick={()=>{if(!window.getSelection()?.toString())onJump(mark.highlight);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onJump(mark.highlight);}}}>{content}</mark>);
   else {const concept=suggested.find(s=>s.start<=start&&s.end>=end);if(concept)pieces.push(<span key={start} className="concept-link" role="link" tabIndex={0} title={t("Open: ")+concept.highlight.quote} onClick={()=>{if(!window.getSelection()?.toString())onJump(concept.highlight);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onJump(concept.highlight);}}}>{content}</span>);else pieces.push(content);}
  }
  return <span data-text-id={id} key={id}>{pieces}</span>;
 }
 function inline(value:string,id:string){return inlineParts(value).map((part,i)=>{const key=id+'.'+i;const link=part.match(linkPattern);if(link){const sourceLabel=isSourceLabel(link[1]);return <span key={key}>{!sourceLabel&&text(link[1],key)}{citation(link[2],link[1],key)}</span>;}if(part.startsWith('**')&&part.endsWith('**'))return <strong key={key}>{text(part.slice(2,-2),key)}</strong>;if(part.startsWith('*')&&part.endsWith('*'))return <em key={key}>{text(part.slice(1,-1),key)}</em>;return text(part,key);});}
 const richDocument=labels.richBody===body?labels.richContent:undefined;
 const lines=body.split(/\n/);
 const bodyHeadingLines=lines.flatMap((line,i)=>/^(#{1,3}) (.+)$/.test(line)?[i]:[]);
 const lastBodyHeading=bodyHeadingLines.at(-1);
 const redundantSourcesAt=references.length&&lastBodyHeading!==undefined&&/^(?:sources|references|source list|来源|参考来源|參考來源|参考资料|參考資料)$/i.test(lines[lastBodyHeading].replace(/^#{1,3}\s+/,'').replace(/\*\*/g,'').trim())?lastBodyHeading:-1;
 // Older articles already contain their own introduction. Keep its text and
 // original node IDs intact, and omit only the redundant metadata summary.
 const overviewName=(value:string)=>value.replace(/[#*：:]/g,'').trim().toLocaleLowerCase();
 const firstText=lines.find(line=>line.trim()&&!line.trim().startsWith('!['))||'';
 const hasBodyOverview=/^(?:#{1,3}\s|\*\*)/.test(firstText.trim())&&new Set([labels.overview||'Overview','Overview','概述','概览','概覽','概要','简介','簡介'].map(overviewName)).has(overviewName(firstText));
 const showSummary=Boolean(summary)&&!hasBodyOverview;
 const headings=richDocument?richHeadings(richDocument):lines.flatMap((line,i)=>{const match=line.match(/^(#{1,3}) (.+)$/);return match?[{id:'section-'+i,title:match[2].replace(/\*\*/g,''),level:match[1].length}]:[]});
 const media=new Map<number,{url:string;caption:string;credit:string}>();
 const skipped=new Set<number>();
 lines.forEach((line,i)=>{const match=articleImage(line);if(match){const credit=articleCredit(lines[i+1]||'',line)?lines[i+1]:'';media.set(i,{url:match[2],caption:match[1],credit});skipped.add(i);if(credit)skipped.add(i+1);}});
 // Lead images fill the illustration column; a figure placed inside a later section stays in place.
 const firstHeading=bodyHeadingLines[0]??Infinity,inFlow=new Set([...media.keys()].filter(i=>i>firstHeading));
 const figureFor=(i:number)=>{const item=media.get(i)!;return <ArticleFigure key={'figure'+i} url={item.url} alt={item.caption}><p>{inline(item.caption,'figure'+i)}</p>{item.credit&&<div className="image-credit">{inline(item.credit,'credit'+i)}</div>}</ArticleFigure>;};
 const blocks:ReactNode[]=[];
 for(let i=0;i<lines.length&&!richDocument;i++){
  if(i===redundantSourcesAt)break;
  if(inFlow.has(i)){blocks.push(<div className="wiki-inline-figure" key={'inline-figure'+i}>{figureFor(i)}</div>);continue;}
  if(skipped.has(i)||!lines[i].trim())continue;
  const line=lines[i],id='line'+i,heading=line.match(/^(#{1,3}) (.+)$/);
  if(/^```chart\s*$/.test(line.trim())){
   const end=lines.findIndex((value,at)=>at>i&&/^```\s*$/.test(value.trim()));
   if(end>i){try{const raw=JSON.parse(lines.slice(i+1,end).join('\n')) as {chart?:unknown;dataset?:unknown},chart=chartSchema.parse(raw.chart),dataset=validateChartData(chart,raw.dataset);blocks.push(<Dashboard key={id} chart={chart} dataset={dataset}/>);i=end;continue;}catch{/* Render malformed chart markup as ordinary text so content is never silently lost. */}}
  }
  if(heading){blocks.push(heading[1].length===3?<h3 id={'section-'+i} key={id}>{inline(heading[2],id)}</h3>:<h2 id={'section-'+i} key={id}>{inline(heading[2],id)}</h2>);continue;}
  const iframe=line.match(/<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/iframe>/i);
  if(iframe){
   const embed=videoEmbedUrl(iframe[1]);
   if(embed){
    const title=line.match(/<iframe\b[^>]*\btitle=["']([^"']*)["']/i)?.[1]||t("Source video");
    const before=line.slice(0,iframe.index).trim(),after=line.slice((iframe.index||0)+iframe[0].length).trim();
    blocks.push(<figure className="wiki-figure source-media-item" key={id}>{before&&<figcaption>{inline(before,id+'.before')}</figcaption>}<iframe title={title} src={embed} sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>{after&&<figcaption>{inline(after,id+'.after')}</figcaption>}</figure>);continue;
   }
  }
  const nextContent=(from:number)=>{let at=from;while(at<lines.length&&!lines[at].trim())at++;return at;};
  const separator=nextContent(i+1);
  if(line.includes('|')&&separator<lines.length&&/^\s*\\?\|?\s*:?-{3,}/.test(lines[separator])){
   const cells=(value:string)=>value.trim().replace(/^\\?\|\s*/,'').replace(/\s*\\?\|$/,'').split(/\s*\|\s*/);
   const header=cells(line),rows:{at:number;cells:string[]}[]=[];let cursor=separator+1;
   while(cursor<lines.length){const at=nextContent(cursor),value=lines[at];if(at>=lines.length||!value.includes('|')){cursor=at;break;}rows.push({at,cells:cells(value)});cursor=at+1;}
   blocks.push(<div className="wiki-table" key={id}><table><thead><tr>{header.map((cell,column)=><th key={column}>{inline(cell,'line'+i+'.cell'+column)}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.at}>{header.map((_,column)=><td key={column}>{inline(row.cells[column]||'','line'+row.at+'.cell'+column)}</td>)}</tr>)}</tbody></table></div>);i=Math.max(i,cursor-1);continue;
  }
  const list=line.match(/^(?:[-*] |\d+\. )(.+)$/);
  if(list){const ordered=/^\d+\. /.test(line),items:ReactNode[]=[];let j=i;for(;j<lines.length;j++){const match=lines[j].match(ordered?/^\d+\. (.+)$/:/^[-*] (.+)$/);if(!match||skipped.has(j))break;items.push(<li key={j}>{inline(match[1],'line'+j)}</li>);}blocks.push(ordered?<ol key={id}>{items}</ol>:<ul key={id}>{items}</ul>);i=j-1;continue;}
  blocks.push(<p key={id}>{inline(line,id)}</p>);
 }
 const summaryContent=showSummary?inline(summary,'summary'):null;
 const figures=(richDocument?[]:[...media.keys()].filter(i=>!inFlow.has(i))).map(i=>figureFor(i));
 return <><header className="wiki-heading"><h1>{text(title,'title')}</h1>{showSummary&&<><p className="wiki-label">{t("Overview")}</p><p className="lead">{summaryContent}</p></>}</header>{children}
  <div className="wiki-layout">
   {headings.length>1&&<nav className="wiki-contents" aria-label={t("Article contents")}><strong>{t("Contents")}</strong><ol>{headings.map(h=><li key={h.id} className={h.level===3?'subsection':''}><a href={'#'+h.id} onClick={e=>{e.preventDefault();document.getElementById(h.id)?.scrollIntoView({block:'start'});}}>{h.title}</a></li>)}</ol></nav>}
   <div className="wiki-body">{labels.sourceMedia?.length?<SourceMediaView media={labels.sourceMedia}/>:null}{!richDocument&&figures.length>0&&<aside className="wiki-illustrations" aria-label={t("Illustrations")}>{figures}</aside>}{richDocument?<RichContent document={richDocument}/>:blocks}</div>
  </div>
  {references.length>0&&<section className="sources" aria-label={t("Sources")}><h2>{t("Sources")}</h2><ol>{references.map((source,i)=><li id={'source-'+(i+1)} tabIndex={-1} key={source.url}><div className="source-entry"><span className="source-returns">{source.occurrences.length>1&&<CornerUpLeft size={14} className="source-return-icon" aria-hidden="true"/>}{source.occurrences.map((id,j)=><a key={id} href={'#'+id} className="source-return" title={t("Back to citation ")+(i+1)+(source.occurrences.length>1?t(", occurrence ")+(j+1):'')} aria-label={t("Back to citation ")+(i+1)+(source.occurrences.length>1?t(", occurrence ")+(j+1):'')} onClick={e=>{e.preventDefault();jumpTo(id);}}>{source.occurrences.length>1?j+1:<CornerUpLeft size={14} aria-hidden="true"/>}</a>)}</span><a className="source-title" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></div></li>)}</ol></section>}
  </>;
}
function ArticleFigure({url,alt,children}:{url:string;alt:string;children:ReactNode}){
 const {t,locale}=useUi();

 const [failed,setFailed]=useState(false);
 // A broken image stays visible as a labelled gap, so readers and the in-page agent can see it failed.
 if(failed)return <figure className="wiki-figure wiki-figure-missing"><div className="wiki-figure-missing-box" role="img" aria-label={t("Image unavailable")}>{t("Image unavailable")}</div><figcaption>{children}</figcaption></figure>;
 return <figure className="wiki-figure"><img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/><figcaption>{children}</figcaption></figure>;
}
