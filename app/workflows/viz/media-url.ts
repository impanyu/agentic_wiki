// URL rules for the media player. Pure so it can be unit-tested without a DOM.
export type MediaKind='hls'|'dash'|'video'|'audio'|'youtube'|'vimeo';
export type MediaSource={url:string;kind:MediaKind};

const AUDIO=new Set(['mp3','wav','ogg','oga','m4a','aac','flac','opus']);
const VIDEO=new Set(['mp4','webm','mov','m4v','ogv']);
const YT_ID=/^[A-Za-z0-9_-]{11}$/;

/** https URLs and same-site paths only; everything else (http:, data:, javascript:, //host) is refused. */
export function safeMediaUrl(src:unknown):string|null{
  if(typeof src!=='string')return null;
  const s=src.trim();
  if(!s||/[\u0000-\u001f\s]/.test(s))return null;
  if(s.startsWith('/'))return s.startsWith('//')||s.startsWith('/\\')?null:s;
  try{const u=new URL(s);return u.protocol==='https:'&&u.hostname?u.href:null;}catch{return null;}
}

// YouTube's `t`/`start` accepts 90, 90s or 1h2m3s.
function seconds(v:string|null):number{
  if(!v)return 0;
  if(/^\d+s?$/.test(v))return parseInt(v,10);
  const m=/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  return m?(+(m[1]||0))*3600+(+(m[2]||0))*60+(+(m[3]||0)):0;
}

function youtube(u:URL):string|null{
  const host=u.hostname.replace(/^(www|m|music)\./,'');
  let id:string|undefined;
  if(host==='youtu.be')id=u.pathname.split('/')[1];
  else if(host==='youtube.com'||host==='youtube-nocookie.com'){
    const parts=u.pathname.split('/').filter(Boolean);
    if(parts[0]==='watch')id=u.searchParams.get('v')||undefined;
    else if(['shorts','embed','live','v'].includes(parts[0]))id=parts[1];
  }else return null;
  if(!id||!YT_ID.test(id))return null;
  const start=seconds(u.searchParams.get('t')||u.searchParams.get('start'));
  return 'https://www.youtube-nocookie.com/embed/'+id+(start?'?start='+start:'');
}

function vimeo(u:URL):string|null{
  const host=u.hostname.replace(/^www\./,'');
  const m=host==='vimeo.com'?/^\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)(?:\/([0-9a-f]+))?\/?$/.exec(u.pathname)
    :host==='player.vimeo.com'?/^\/video\/(\d+)\/?()$/.exec(u.pathname):null;
  if(!m)return null;
  // Unlisted videos carry a privacy hash that the player needs as ?h=.
  const hash=m[2]||u.searchParams.get('h');
  return 'https://player.vimeo.com/video/'+m[1]+(hash&&/^[0-9a-f]+$/.test(hash)?'?h='+hash:'');
}

export function mediaSource(src:unknown):MediaSource|null{
  const url=safeMediaUrl(src);
  if(!url)return null;
  const u=new URL(url,'https://same-site.invalid');
  if(!url.startsWith('/')){
    const yt=youtube(u);if(yt)return {url:yt,kind:'youtube'};
    const vm=vimeo(u);if(vm)return {url:vm,kind:'vimeo'};
  }
  const ext=(/\.([a-z0-9]+)$/i.exec(u.pathname)?.[1]||'').toLowerCase();
  if(ext==='m3u8')return {url,kind:'hls'};
  if(ext==='mpd')return {url,kind:'dash'};
  if(AUDIO.has(ext))return {url,kind:'audio'};
  if(VIDEO.has(ext))return {url,kind:'video'};
  return {url,kind:'video'};
}

/** 75 → "1:15", 3725 → "1:02:05". Non-finite or negative values read as 0:00. */
export function fmtTime(sec:number):string{
  const t=Number.isFinite(sec)&&sec>0?Math.floor(sec):0;
  const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=t%60;
  const ss=String(s).padStart(2,'0');
  return h?h+':'+String(m).padStart(2,'0')+':'+ss:m+':'+ss;
}
