export type SourceMedia={id:string;kind:'image'|'video'|'embed';url:string;source:string;description:string;caption?:string;poster?:string};
export function publicMediaUrl(value:string,base?:string){
 try{const u=new URL(value,base),h=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||!h.includes('.')||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.localhost')||h.includes(':')||/^\d+(?:\.\d+)*$/.test(h))return null;
  return u.href;
 }catch{return null;}
}
export function videoEmbedUrl(value:string){
 const safe=publicMediaUrl(value);if(!safe)return null;const u=new URL(safe);
 if(['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname)){const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/shorts\/([\w-]{11})$/)?.[1];if(id&&/^[\w-]{11}$/.test(id))return 'https://www.youtube-nocookie.com/embed/'+id;}
 if(['vimeo.com','www.vimeo.com'].includes(u.hostname)&&/^\/\d+$/.test(u.pathname))return 'https://player.vimeo.com/video'+u.pathname;
 if(['www.youtube.com','youtube.com','www.youtube-nocookie.com'].includes(u.hostname)&&/^\/embed\/[\w-]{11}$/.test(u.pathname))return 'https://www.youtube-nocookie.com'+u.pathname;
 if(u.hostname==='player.vimeo.com'&&/^\/video\/\d+$/.test(u.pathname))return u.origin+u.pathname;
 return null;
}
// Extract only media actually present in the downloaded markup, never inferred URLs.
export function extractSourceMedia(html:string,base:string):SourceMedia[]{
 const decode=(s:string)=>s.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,h,d)=>{const n=parseInt(h||d,h?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});
 const attrs=(s:string)=>Object.fromEntries([...s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m=>[m[1].toLowerCase(),decode(m[2]??m[3]??m[4])]));
 const clean=(s:string)=>decode(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim().slice(0,700);
 const content=html.replace(/<!--[^]*?-->|<(script|style|nav|header|footer)\b[^>]*>[^]*?<\/\1\s*>/gi,'');
 const items:SourceMedia[]=[];const seen=new Set<string>();
 const add=(kind:SourceMedia['kind'],raw:string|undefined,description:string,poster?:string)=>{
  const url=raw&&publicMediaUrl(raw,base);if(!url||seen.has(url)||items.length>=30)return;
  const actual=kind==='embed'?videoEmbedUrl(url):url;if(!actual)return;
  seen.add(url);items.push({id:'source-media-'+items.length,kind,url:actual,source:base,description,poster:poster?publicMediaUrl(poster,base)||undefined:undefined});
 };
 for(const m of content.matchAll(/<img\b([^>]+)>|<video\b([^>]*)>([^]*?)<\/video\s*>|<iframe\b([^>]*)>(?:[^]*?<\/iframe\s*>)?/gi)){
  const a=attrs(m[1]??m[2]??m[4]??'');
  const figureStart=content.lastIndexOf('<figure',m.index),figureEnd=content.indexOf('</figure>',m.index);
  const figure=figureStart>=0&&figureEnd>=0&&content.slice(figureStart,m.index).indexOf('</figure>')<0?content.slice(m.index,figureEnd):'';
  const caption=figure.match(/<figcaption\b[^>]*>([^]*?)<\/figcaption>/i)?.[1]||'';
  const description=clean([a.alt,a.title,caption].filter(Boolean).join(' — '));
  if(m[1]!==undefined){if((a.width&&Number(a.width)<100)||(a.height&&Number(a.height)<80))continue;add('image',a['data-src']||a.src||a.srcset?.split(',')[0]?.trim().split(/\s+/)[0],description);}
  else if(m[2]!==undefined){const source=m[3].match(/<source\b([^>]+)>/i);add('video',a.src||(source?attrs(source[1]).src:undefined),description,a.poster);}
  else add('embed',a.src,description);
 }
 return items;
}
