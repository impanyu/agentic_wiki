'use client';
import {useState} from 'react';
import {publicMediaUrl,videoEmbedUrl,type SourceMedia} from './media';
export function SourceMediaView({media}:{media:SourceMedia[]}){
 return <div className="source-media">{media.slice(0,4).map(item=><SourceMediaItem key={item.id} item={item}/>)}</div>;
}
function SourceMediaItem({item}:{item:SourceMedia}){
 const [failed,setFailed]=useState(false),[playing,setPlaying]=useState(false);
 const url=publicMediaUrl(item.url),source=publicMediaUrl(item.source);if(!url||!source)return null;
 const embed=item.kind==='embed'?videoEmbedUrl(url):null;
 const caption=item.caption||item.description;
 return <figure className="wiki-figure source-media-item">
  {!failed&&item.kind==='image'&&<img src={url} alt={caption} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>}
  {!failed&&item.kind==='video'&&<video controls preload="none" poster={item.poster?publicMediaUrl(item.poster)||undefined:undefined} onError={()=>setFailed(true)}><source src={url}/></video>}
  {embed&&(playing?<iframe title={caption||'Source video'} src={embed} sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer"/>:<button type="button" onClick={()=>setPlaying(true)} aria-label={caption||'Play source video'}>▶ {caption||'Video'}</button>)}
  <figcaption>{caption&&<p>{caption}</p>}<a href={source} target="_blank" rel="noopener noreferrer">{new URL(source).hostname} ↗</a>{item.kind!=='image'&&<>{' · '}<a href={url} target="_blank" rel="noopener noreferrer">▶ ↗</a></>}</figcaption>
 </figure>;
}
