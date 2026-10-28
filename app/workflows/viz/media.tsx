'use client';
import {useCallback,useEffect,useMemo,useRef,useState,type CSSProperties,type KeyboardEvent,type PointerEvent,type ReactNode,type Ref} from 'react';
import {Play,Pause,Volume1,Volume2,VolumeX,Maximize,Minimize,Captions,Settings,PictureInPicture2,Download,ChevronLeft,ChevronRight,Check,RotateCcw,RotateCw,TriangleAlert,ExternalLink} from 'lucide-react';
import type HlsType from 'hls.js';
import type {VizProps} from './types';
import {mediaSource,safeMediaUrl,fmtTime,type MediaSource} from './media-url';
import './media.css';

type T=VizProps['ctx']['t'];
type Track={src:string;label:string;lang?:string;isDefault:boolean};
type Chapter={time:number;title:string};
type Level={index:number;height:number;bitrate:number};
type MenuView='main'|'speed'|'quality'|'captions';

const RATES=[0.5,0.75,1,1.25,1.5,2];
const IDLE_MS=2500;
const str=(v:unknown)=>typeof v==='string'?v.trim():'';
const finite=(v:number)=>Number.isFinite(v)?v:0;
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));

export default function MediaPlayer({props,setValue,fire,ctx}:VizProps){
  const t=ctx.t,raw=str(props.src),source=mediaSource(raw);
  if(!source)return <ErrorBox t={t} url={raw} message={raw?t('This media address is not allowed. Use an https:// link or a file on this site.'):t('No media source was given.')}/>;
  if(source.kind==='youtube'||source.kind==='vimeo')return <Embed source={source} props={props} fire={fire} t={t}/>;
  if(source.kind==='dash')return <div className="wf-viz-error wf-media-error wf-media-note" role="note"><TriangleAlert size={16} aria-hidden/><div><strong>{t('MPEG-DASH streams cannot be played here yet.')}</strong><a href={source.url} target="_blank" rel="noopener noreferrer">{t('Open the stream')} <ExternalLink size={12} aria-hidden/></a></div></div>;
  const kind=str(props.kind)||'auto';
  const stream=kind==='hls'||source.kind==='hls';
  const audio=kind==='audio'||(kind==='auto'&&source.kind==='audio');
  return <Player key={source.url+'|'+audio+'|'+stream} url={source.url} audio={audio} stream={stream} props={props} setValue={setValue} fire={fire} t={t}/>;
}

function ErrorBox({t,url,message}:{t:T;url:string;message:string}){
  const safe=safeMediaUrl(url);
  return <div className="wf-viz-error wf-media-error" role="alert"><TriangleAlert size={16} aria-hidden/><div><strong>{message}</strong>{url&&(safe?<a href={safe} target="_blank" rel="noopener noreferrer">{url}</a>:<code>{url}</code>)}{!url&&<span>{t('Set the src property to a video, audio or stream URL.')}</span>}</div></div>;
}

/* YouTube/Vimeo: nothing is loaded from the provider until the reader clicks play.
   The default poster is a local gradient (a provider thumbnail would already contact it). */
function Embed({source,props,fire,t}:{source:MediaSource;props:Record<string,any>;fire:VizProps['fire'];t:T}){
  const [on,setOn]=useState(false);
  const poster=safeMediaUrl(props.poster),title=str(props.title),caption=str(props.caption);
  const src=source.url+(source.url.includes('?')?'&':'?')+'autoplay=1'+(source.kind==='youtube'?'&rel=0&modestbranding=1':'&dnt=1');
  const height=Number(props.height)>0?Number(props.height):undefined;
  return <figure className="wf-media wf-media-video">
    <div className="wf-media-shell" style={height?{height,aspectRatio:'auto'}:undefined}>
      {on?<iframe src={src} title={title||(source.kind==='youtube'?'YouTube':'Vimeo')} sandbox="allow-scripts allow-same-origin allow-presentation" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="wf-media-iframe"/>
      :<button type="button" className="wf-media-facade" style={poster?{backgroundImage:`url("${poster.replace(/"/g,'%22')}")`}:undefined} onClick={()=>{setOn(true);fire('play');}} aria-label={title?t('Play {title}',{title}):t('Play')}>
        {title&&<span className="wf-media-title">{title}</span>}
        <span className="wf-media-bigplay" aria-hidden><Play size={30} fill="currentColor"/></span>
        <span className="wf-media-facade-note">{t('Plays from {site}',{site:source.kind==='youtube'?'YouTube':'Vimeo'})}</span>
      </button>}
    </div>
    {caption&&<figcaption>{caption}</figcaption>}
  </figure>;
}

function Player({url,audio,stream,props,setValue,fire,t}:{url:string;audio:boolean;stream:boolean;props:Record<string,any>;setValue:VizProps['setValue'];fire:VizProps['fire'];t:T}){
  const title=str(props.title),caption=str(props.caption),poster=safeMediaUrl(props.poster)||undefined;
  const autoplay=props.autoplay===true,download=props.download===true&&!stream;
  const height=Number(props.height)>0?Number(props.height):undefined;
  const rates=useMemo(()=>{const r=Array.isArray(props.playbackRates)?props.playbackRates.map(Number).filter(n=>Number.isFinite(n)&&n>0&&n<=16):[];return r.length?[...new Set(r)].sort((a,b)=>a-b):RATES;},[props.playbackRates]);
  const tracks=useMemo<Track[]>(()=>(Array.isArray(props.captions)?props.captions:[]).flatMap((c:any,i:number)=>{const src=safeMediaUrl(c?.src);return src?[{src,label:str(c?.label)||str(c?.lang)||t('Captions {n}',{n:i+1}),lang:str(c?.lang)||undefined,isDefault:c?.default===true}]:[];}),[props.captions,t]);
  const chapters=useMemo<Chapter[]>(()=>(Array.isArray(props.chapters)?props.chapters:[]).map((c:any)=>({time:Number(c?.time),title:str(c?.title)})).filter((c:Chapter)=>Number.isFinite(c.time)&&c.time>=0&&c.title).sort((a:Chapter,b:Chapter)=>a.time-b.time),[props.chapters]);

  const mediaRef=useRef<HTMLMediaElement|null>(null),shellRef=useRef<HTMLDivElement>(null),seekRef=useRef<HTMLDivElement>(null);
  const waveRef=useRef<HTMLDivElement>(null),menuRef=useRef<HTMLDivElement>(null),menuBtnRef=useRef<HTMLButtonElement>(null);
  const trackEls=useRef<(HTMLTrackElement|null)[]>([]),hlsRef=useRef<HlsType|null>(null);
  const cb=useRef({setValue,fire});cb.current={setValue,fire};

  const [playing,setPlaying]=useState(false),[started,setStarted]=useState(false),[waiting,setWaiting]=useState(false);
  const [time,setTime]=useState(0),[duration,setDuration]=useState(0),[buffered,setBuffered]=useState(0);
  const [volume,setVolume]=useState(1),[muted,setMuted]=useState(autoplay),[autoMuted,setAutoMuted]=useState(autoplay),[rate,setRate]=useState(1);
  const [error,setError]=useState(''),[fs,setFs]=useState(false),[pip,setPip]=useState(false),[canPip,setCanPip]=useState(false);
  const [active,setActive]=useState(true),[menu,setMenu]=useState<MenuView|null>(null),[hover,setHover]=useState<number|null>(null),[dragging,setDragging]=useState(false);
  const [caption_,setCaption]=useState(()=>tracks.findIndex(x=>x.isDefault)),[cue,setCue]=useState('');
  const [levels,setLevels]=useState<Level[]>([]),[level,setLevel]=useState(-1),[actualLevel,setActualLevel]=useState(-1);
  const [wave,setWave]=useState<'off'|'loading'|'ready'|'failed'>(audio&&!stream?'loading':'off');
  const lastCaption=useRef(Math.max(0,caption_)),idle=useRef<number|undefined>(undefined);
  const live=props.live===true||duration===Infinity;

  // setValue at most once a second; a trailing call delivers the final state.
  const lastPush=useRef(0),pushTimer=useRef<number|undefined>(undefined);
  const report=useCallback(()=>{
    const send=()=>{pushTimer.current=undefined;lastPush.current=Date.now();const el=mediaRef.current;if(!el)return;cb.current.setValue({time:Math.round(el.currentTime*10)/10,duration:Number.isFinite(el.duration)?Math.round(el.duration*10)/10:null,playing:!el.paused&&!el.ended});};
    const wait=1000-(Date.now()-lastPush.current);
    if(wait<=0){window.clearTimeout(pushTimer.current);send();}else if(pushTimer.current==null)pushTimer.current=window.setTimeout(send,wait);
  },[]);
  useEffect(()=>()=>{window.clearTimeout(pushTimer.current);window.clearTimeout(idle.current);},[]);

  const tryPlay=useCallback(()=>{const el=mediaRef.current;if(!el)return;el.play().catch(()=>{if(autoplay&&!el.muted){el.muted=true;el.play().catch(()=>{});}});},[autoplay]);

  // Source wiring: plain files use the src attribute; HLS uses Safari's native player or hls.js.
  // Recent Chrome also answers canPlayType for HLS, but its native player has no quality levels,
  // so native playback is used only on Apple browsers or where hls.js (MSE) is unavailable.
  useEffect(()=>{
    const el=mediaRef.current;if(!el)return;
    if(autoplay)el.muted=true;
    if(!stream){if(autoplay)tryPlay();return;}
    const native=!!el.canPlayType('application/vnd.apple.mpegurl');
    const playNative=()=>{el.src=url;if(autoplay)tryPlay();};
    if(native&&/Apple/.test(navigator.vendor)){playNative();return;}
    let hls:HlsType|null=null,dead=false;
    import('hls.js').then(({default:Hls})=>{
      if(dead)return;
      if(!Hls.isSupported()){if(native)playNative();else setError(t('This browser cannot play streaming video.'));return;}
      const h=new Hls({lowLatencyMode:props.live===true,capLevelToPlayerSize:true});hls=h;hlsRef.current=h;
      let recovered=false;
      h.on(Hls.Events.MANIFEST_PARSED,(_e,d)=>{setLevels(d.levels.map((l,index)=>({index,height:l.height||0,bitrate:l.bitrate||0})));if(autoplay)tryPlay();});
      h.on(Hls.Events.LEVEL_SWITCHED,(_e,d)=>setActualLevel(d.level));
      h.on(Hls.Events.ERROR,(_e,d)=>{
        if(!d.fatal)return;
        if(!recovered){recovered=true;if(d.type===Hls.ErrorTypes.MEDIA_ERROR)h.recoverMediaError();else h.startLoad();return;}
        setError(d.type===Hls.ErrorTypes.NETWORK_ERROR?t('The stream could not be reached.'):t('The stream could not be played.'));
        h.destroy();if(hlsRef.current===h)hlsRef.current=null;
      });
      h.loadSource(url);h.attachMedia(el);
    }).catch(()=>{if(dead)return;if(native)playNative();else setError(t('The streaming player could not be loaded.'));});
    return ()=>{dead=true;hls?.destroy();hlsRef.current=null;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[url,stream]);

  // Waveform drawn by wavesurfer on the same <audio>; any failure (often CORS) falls back to the seek bar.
  useEffect(()=>{
    if(!audio||stream)return;
    const el=mediaRef.current,box=waveRef.current;if(!el||!box)return;
    let ws:{destroy():void}|null=null,dead=false;
    import('wavesurfer.js').then(({default:WaveSurfer})=>{
      if(dead)return;
      const w=WaveSurfer.create({container:box,media:el,height:56,waveColor:'#c7d2fe',progressColor:'#4f46e5',cursorWidth:1,cursorColor:'#4f46e5',barWidth:2,barGap:2,barRadius:2,dragToSeek:true});ws=w;
      w.on('ready',()=>{if(!dead)setWave('ready');});
      w.on('error',()=>{if(dead)return;setWave('failed');dead=true;w.destroy();});
    }).catch(()=>{if(!dead)setWave('failed');});
    return ()=>{dead=true;ws?.destroy();};
  },[url,audio,stream]);

  // Captions are rendered by us (mode "hidden") so they sit above the controls and also work for audio.
  useEffect(()=>{
    trackEls.current.forEach((el,i)=>{if(el?.track)el.track.mode=i===caption_?'hidden':'disabled';});
    const tt=caption_>=0?trackEls.current[caption_]?.track:null;
    if(!tt){setCue('');return;}
    const on=()=>{const list=tt.activeCues,out:string[]=[];if(list)for(let i=0;i<list.length;i++){const c=list[i] as VTTCue;out.push((typeof c.getCueAsHTML==='function'?c.getCueAsHTML().textContent:c.text?.replace(/<[^>]*>/g,''))||'');}setCue(out.filter(Boolean).join('\n'));};
    tt.addEventListener('cuechange',on);on();
    return ()=>tt.removeEventListener('cuechange',on);
  },[caption_,tracks.length]);

  useEffect(()=>{
    const el=mediaRef.current as HTMLVideoElement|null;
    setCanPip(!audio&&typeof document!=='undefined'&&!!document.pictureInPictureEnabled&&!!el?.requestPictureInPicture);
    const onFs=()=>setFs(!!shellRef.current&&document.fullscreenElement===shellRef.current);
    const enter=()=>setPip(true),leave=()=>setPip(false);
    document.addEventListener('fullscreenchange',onFs);el?.addEventListener('enterpictureinpicture',enter);el?.addEventListener('leavepictureinpicture',leave);
    return ()=>{document.removeEventListener('fullscreenchange',onFs);el?.removeEventListener('enterpictureinpicture',enter);el?.removeEventListener('leavepictureinpicture',leave);};
  },[audio]);

  useEffect(()=>{
    if(!menu)return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const away=(e:Event)=>{const n=e.target as Node;if(menuRef.current?.contains(n)||menuBtnRef.current?.contains(n))return;setMenu(null);};
    document.addEventListener('pointerdown',away);return ()=>document.removeEventListener('pointerdown',away);
  },[menu]);

  const poke=useCallback(()=>{setActive(true);window.clearTimeout(idle.current);idle.current=window.setTimeout(()=>setActive(false),IDLE_MS);},[]);
  const media=()=>mediaRef.current;
  const toggle=()=>{const el=media();if(!el)return;if(el.paused||el.ended)tryPlay();else el.pause();};
  const seekTo=(s:number)=>{const el=media();if(!el||live)return;const end=finite(el.duration)||duration;el.currentTime=clamp(s,0,end||0);setTime(el.currentTime);};
  const seekBy=(d:number)=>{const el=media();if(el)seekTo(el.currentTime+d);};
  const setVol=(v:number)=>{const el=media();if(!el)return;el.volume=clamp(v,0,1);el.muted=el.volume===0;setAutoMuted(false);};
  const toggleMute=()=>{const el=media();if(!el)return;if(el.muted&&el.volume===0)el.volume=0.5;el.muted=!el.muted;setAutoMuted(false);};
  const setSpeed=(r:number)=>{const el=media();if(el)el.playbackRate=r;};
  const pickCaption=(i:number)=>{if(i>=0)lastCaption.current=i;setCaption(i);};
  const toggleCaptions=()=>{if(!tracks.length)return;pickCaption(caption_>=0?-1:Math.min(lastCaption.current,tracks.length-1));};
  const pickLevel=(i:number)=>{const h=hlsRef.current;if(h)h.currentLevel=i;setLevel(i);};
  const toggleFs=()=>{
    const shell=shellRef.current,el=media() as (HTMLVideoElement&{webkitEnterFullscreen?:()=>void})|null;if(!shell||audio)return;
    if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});
    else if(shell.requestFullscreen)void shell.requestFullscreen().catch(()=>{});
    else el?.webkitEnterFullscreen?.(); // iPhone Safari only supports fullscreen on the <video> itself
  };
  const togglePip=()=>{const el=media() as HTMLVideoElement|null;if(!el)return;if(document.pictureInPictureElement)void document.exitPictureInPicture().catch(()=>{});else void el.requestPictureInPicture().catch(()=>{});};
  const goLive=()=>{const el=media();if(!el)return;const s=el.seekable;if(s.length)el.currentTime=Math.max(0,s.end(s.length-1)-1);tryPlay();};

  const onKey=(e:KeyboardEvent<HTMLElement>)=>{
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const tg=e.target as HTMLElement,tag=tg.tagName,isBtn=tag==='BUTTON'||tag==='A',isRange=tag==='INPUT';
    switch(e.key){
      case ' ':case 'k':case 'K':if(isBtn&&e.key===' ')return;toggle();break;
      case 'j':case 'J':seekBy(-10);break;
      case 'l':case 'L':seekBy(10);break;
      case 'ArrowLeft':if(isRange)return;seekBy(-5);break;
      case 'ArrowRight':if(isRange)return;seekBy(5);break;
      case 'ArrowUp':if(isRange)return;setVol((media()?.volume??1)+0.05);break;
      case 'ArrowDown':if(isRange)return;setVol((media()?.volume??1)-0.05);break;
      case 'm':case 'M':toggleMute();break;
      case 'f':case 'F':if(audio)return;toggleFs();break;
      case 'c':case 'C':if(!tracks.length)return;toggleCaptions();break;
      case 'Escape':if(!menu)return;setMenu(null);menuBtnRef.current?.focus();break;
      default:if(/^[0-9]$/.test(e.key)&&!isRange&&!live&&duration){seekTo(duration*Number(e.key)/10);break;}return;
    }
    e.preventDefault();if(!audio)poke();
  };

  // Seek bar: pointer scrubbing with capture, hover preview, and its own slider keys.
  const ratioAt=(x:number)=>{const r=seekRef.current?.getBoundingClientRect();return r?clamp((x-r.left)/(r.width||1),0,1):0;};
  const seekDown=(e:PointerEvent<HTMLDivElement>)=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);setDragging(true);seekTo(ratioAt(e.clientX)*duration);};
  const seekMove=(e:PointerEvent<HTMLDivElement>)=>{const r=ratioAt(e.clientX);setHover(r);if(dragging)seekTo(r*duration);};
  const seekUp=(e:PointerEvent<HTMLDivElement>)=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);setDragging(false);};
  const sliderKey=(e:KeyboardEvent<HTMLElement>)=>{
    const map:Record<string,number>={ArrowLeft:-5,ArrowRight:5,PageDown:-10,PageUp:10,ArrowDown:-5,ArrowUp:5};
    if(e.key in map)seekBy(map[e.key]);else if(e.key==='Home')seekTo(0);else if(e.key==='End')seekTo(duration);else return;
    e.preventDefault();e.stopPropagation();if(!audio)poke();
  };
  const chapterAt=(s:number)=>{let c:Chapter|undefined;for(const ch of chapters){if(ch.time<=s)c=ch;else break;}return c;};
  const current=chapterAt(time);
  const pct=(v:number)=>duration>0?clamp(v/duration*100,0,100):0;
  const timeText=t('{time} of {duration}',{time:fmtTime(time),duration:fmtTime(duration)});
  const sliderAria={role:'slider',tabIndex:0,'aria-label':t('Seek'),'aria-valuemin':0,'aria-valuemax':Math.round(finite(duration)),'aria-valuenow':Math.round(time),'aria-valuetext':timeText+(current?' · '+current.title:'')};
  const ticks=duration>0&&chapters.filter(c=>c.time>0&&c.time<duration).map((c,i)=><span key={i} className="wf-media-tick" style={{left:pct(c.time)+'%'}} aria-hidden/>);
  const seekBar=<div ref={seekRef} className={'wf-media-seek'+(dragging?' dragging':'')} {...sliderAria} onPointerDown={seekDown} onPointerMove={seekMove} onPointerUp={seekUp} onPointerCancel={seekUp} onPointerLeave={()=>setHover(null)} onKeyDown={sliderKey}>
    <div className="wf-media-rail"><div className="wf-media-buffered" style={{width:pct(buffered)+'%'}}/><div className="wf-media-played" style={{width:pct(time)+'%'}}/>{ticks}</div>
    <div className="wf-media-thumb" style={{left:pct(time)+'%'}}/>
    {hover!=null&&duration>0&&<div className="wf-media-preview" style={{left:`clamp(28px, ${hover*100}%, calc(100% - 28px))`}} aria-hidden>{chapterAt(hover*duration)&&<em>{chapterAt(hover*duration)!.title}</em>}<span>{fmtTime(hover*duration)}</span></div>}
  </div>;

  const fmtRate=(r:number)=>r===1?t('Normal'):r+'×';
  const levelName=(l?:Level)=>!l?'':l.height?l.height+'p':Math.round(l.bitrate/1000)+' kbps';
  const sortedLevels=[...levels].sort((a,b)=>b.height-a.height||b.bitrate-a.bitrate);
  const levelText=level<0?t('Auto')+(actualLevel>=0&&levels[actualLevel]?' ('+levelName(levels[actualLevel])+')':''):levelName(levels[level]);
  const menuKey=(e:KeyboardEvent<HTMLDivElement>)=>{
    if(e.key!=='ArrowDown'&&e.key!=='ArrowUp'&&e.key!=='Escape'&&e.key!=='ArrowLeft')return;
    e.preventDefault();e.stopPropagation();
    if(e.key==='Escape'){setMenu(null);menuBtnRef.current?.focus();return;}
    if(e.key==='ArrowLeft'){if(menu!=='main')setMenu('main');return;}
    const items=[...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button')||[])],i=items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
  };
  const radio=(checked:boolean,label:ReactNode,onPick:()=>void,key:string|number)=><button key={key} type="button" role="menuitemradio" aria-checked={checked} className="wf-media-menu-item" onClick={()=>{onPick();setMenu('main');}}><span className="wf-media-check">{checked&&<Check size={14}/>}</span>{label}</button>;
  const sub=(label:string,view:MenuView,value:string)=><button type="button" role="menuitem" aria-haspopup="menu" className="wf-media-menu-item" onClick={()=>setMenu(view)}><span>{label}</span><span className="wf-media-menu-value">{value}<ChevronRight size={14}/></span></button>;
  const back=(label:string)=><button type="button" className="wf-media-menu-back" onClick={()=>setMenu('main')}><ChevronLeft size={14}/>{label}</button>;
  const menuPanel=menu&&<div ref={menuRef} className="wf-media-menu" role="menu" aria-label={t('Settings')} onKeyDown={menuKey}>
    {menu==='main'&&<>{sub(t('Speed'),'speed',fmtRate(rate))}{levels.length>1&&sub(t('Quality'),'quality',levelText)}{tracks.length>0&&sub(t('Captions'),'captions',caption_>=0?tracks[caption_].label:t('Off'))}</>}
    {menu==='speed'&&<>{back(t('Speed'))}{rates.map(r=>radio(r===rate,fmtRate(r),()=>setSpeed(r),r))}</>}
    {menu==='quality'&&<>{back(t('Quality'))}{radio(level<0,t('Auto'),()=>pickLevel(-1),'auto')}{sortedLevels.map(l=>radio(l.index===level,levelName(l),()=>pickLevel(l.index),l.index))}</>}
    {menu==='captions'&&<>{back(t('Captions'))}{radio(caption_<0,t('Off'),()=>pickCaption(-1),'off')}{tracks.map((tr,i)=>radio(i===caption_,tr.label,()=>pickCaption(i),i))}</>}
  </div>;

  const VolIcon=muted||volume===0?VolumeX:volume<0.5?Volume1:Volume2;
  const btn=(label:string,icon:ReactNode,onClick:()=>void,extra?:{pressed?:boolean;cls?:string;ref?:Ref<HTMLButtonElement>;expanded?:boolean})=><button type="button" ref={extra?.ref} className={'wf-media-btn'+(extra?.cls?' '+extra.cls:'')} aria-label={label} data-tip={label} aria-pressed={extra?.pressed} aria-expanded={extra?.expanded} aria-haspopup={extra?.expanded!=null?'menu':undefined} onClick={onClick}>{icon}</button>;
  const playBtn=btn(playing?t('Pause'):t('Play'),playing?<Pause size={20} fill="currentColor"/>:<Play size={20} fill="currentColor"/>,toggle);
  const volume_=<div className="wf-media-volume">{btn(muted?t('Unmute'):t('Mute'),<VolIcon size={20}/>,toggleMute)}<input type="range" min={0} max={1} step={0.05} value={muted?0:volume} onChange={e=>{const el=media();if(el&&el.muted&&+e.target.value>0)el.muted=false;setVol(+e.target.value);}} aria-label={t('Volume')} aria-valuetext={Math.round((muted?0:volume)*100)+'%'} style={{'--fill':(muted?0:volume)*100+'%'} as CSSProperties}/></div>;
  const liveEdge=(()=>{const el=mediaRef.current;if(!el||!el.seekable.length)return true;return el.seekable.end(el.seekable.length-1)-el.currentTime<10;})();
  const liveBadge=<button type="button" className={'wf-media-live'+(liveEdge?' edge':'')} onClick={goLive} aria-label={liveEdge?t('Live'):t('Jump to live')}><i aria-hidden/>{t('LIVE')}</button>;
  const captionsBtn=tracks.length>0&&btn(caption_>=0?t('Turn off captions'):t('Turn on captions'),<Captions size={20}/>,toggleCaptions,{pressed:caption_>=0,cls:caption_>=0?'on':''});
  const settingsBtn=btn(t('Settings'),<Settings size={20}/>,()=>setMenu(m=>m?null:'main'),{ref:menuBtnRef,expanded:!!menu,cls:'wf-media-gear'+(menu?' open':'')});
  const downloadLink=download&&<a className="wf-media-btn" href={url} download aria-label={t('Download')} data-tip={t('Download')}><Download size={20}/></a>;
  const chapterList=chapters.length>0&&<ol className="wf-media-chapters" aria-label={t('Chapters')}>{chapters.map((c,i)=><li key={i}><button type="button" className={current===c?'active':''} aria-current={current===c?'true':undefined} onClick={()=>{seekTo(c.time);tryPlay();}}><span>{fmtTime(c.time)}</span>{c.title}</button></li>)}</ol>;

  const updateBuffered=()=>{const el=media();if(!el)return;const b=el.buffered,ct=el.currentTime;let end=0;for(let i=0;i<b.length;i++){if(b.start(i)<=ct+0.5&&b.end(i)>=ct){end=b.end(i);break;}end=Math.max(end,b.start(i)<=ct?b.end(i):0);}setBuffered(end);};
  const mediaEvents={
    onPlay:()=>{setPlaying(true);setStarted(true);cb.current.fire('play');report();if(!audio)poke();},
    onPause:()=>{setPlaying(false);setWaiting(false);setActive(true);report();},
    onEnded:()=>{setPlaying(false);setActive(true);report();cb.current.fire('ended');},
    onTimeUpdate:()=>{const el=media();if(!el)return;if(!dragging)setTime(el.currentTime);updateBuffered();report();},
    onDurationChange:()=>{const el=media();if(el)setDuration(el.duration===Infinity?Infinity:finite(el.duration));},
    onLoadedMetadata:()=>{const el=media();if(el){setDuration(el.duration===Infinity?Infinity:finite(el.duration));el.playbackRate=rate;}},
    onProgress:updateBuffered,
    onVolumeChange:()=>{const el=media();if(el){setVolume(el.volume);setMuted(el.muted);}},
    onRateChange:()=>{const el=media();if(el)setRate(el.playbackRate);},
    onWaiting:()=>setWaiting(true),onSeeking:()=>setWaiting(true),
    onPlaying:()=>setWaiting(false),onCanPlay:()=>setWaiting(false),onSeeked:()=>setWaiting(false),
    onError:()=>{if(hlsRef.current)return;const code=media()?.error?.code;setError(code===2?t('The media could not be downloaded.'):code===3?t('The media file is damaged or uses an unsupported encoding.'):t('This media could not be played. The format may be unsupported or the file may be unavailable.'));},
  };
  const trackEls_=tracks.map((tr,i)=><track key={tr.src+i} ref={el=>{trackEls.current[i]=el;}} kind="subtitles" src={tr.src} label={tr.label} srcLang={tr.lang}/>);
  const crossOrigin=tracks.some(tr=>/^https:/i.test(tr.src))?'anonymous' as const:undefined;

  if(error)return <ErrorBox t={t} url={url} message={error}/>;

  if(audio)return <figure className={'wf-media wf-media-audio'+(playing?' playing':'')} onKeyDown={onKey}>
    <div className="wf-media-audio-top">
      <button type="button" className="wf-media-audio-play" onClick={toggle} aria-label={playing?t('Pause'):t('Play')}>{waiting&&playing?<span className="wf-media-spinner small" aria-hidden/>:playing?<Pause size={22} fill="currentColor"/>:<Play size={22} fill="currentColor"/>}</button>
      <div className="wf-media-audio-meta">{title?<strong>{title}</strong>:<strong className="wf-media-dim">{t('Audio')}</strong>}{current?<span>{current.title}</span>:caption&&<span>{caption}</span>}</div>
      {live?liveBadge:<span className="wf-media-time" aria-hidden>{fmtTime(time)} <i>/</i> {fmtTime(duration)}</span>}
    </div>
    {!live&&<div className="wf-media-audio-scrub">
      {!stream&&<div className={'wf-media-wave '+wave} {...(wave==='ready'?sliderAria:{})} onKeyDown={wave==='ready'?sliderKey:undefined}><div ref={waveRef}/>{wave==='ready'&&ticks}</div>}
      {wave!=='ready'&&seekBar}
    </div>}
    {cue&&<p className="wf-media-audio-cue" aria-live="polite">{cue}</p>}
    <div className="wf-media-audio-bar">
      {!live&&btn(t('Back 10 seconds'),<RotateCcw size={18}/>,()=>seekBy(-10))}
      {!live&&btn(t('Forward 10 seconds'),<RotateCw size={18}/>,()=>seekBy(10))}
      {volume_}
      <span className="wf-media-spacer"/>
      {captionsBtn}
      <div className="wf-media-menu-anchor">{settingsBtn}{menuPanel}</div>
      {downloadLink}
    </div>
    {caption&&current&&<figcaption>{caption}</figcaption>}
    {chapterList}
    <audio ref={el=>{mediaRef.current=el;}} src={stream?undefined:url} preload="metadata" loop={props.loop===true} crossOrigin={crossOrigin} {...mediaEvents}>{trackEls_}</audio>
  </figure>;

  const show=!playing||active||!!menu||dragging;
  return <figure className="wf-media wf-media-video">
    <div ref={shellRef} className={'wf-media-shell'+(show?'':' idle')+(fs?' fs':'')+(started?' started':'')} style={height&&!fs?{height,aspectRatio:'auto'}:undefined}
      tabIndex={0} role="region" aria-label={title||t('Video player')} onKeyDown={onKey} onPointerMove={poke} onPointerLeave={()=>{if(playing&&!menu){window.clearTimeout(idle.current);setActive(false);}}} onFocus={poke}>
      <video ref={el=>{mediaRef.current=el;}} className="wf-media-el" src={stream?undefined:url} poster={poster} preload="metadata" playsInline loop={props.loop===true} crossOrigin={crossOrigin} tabIndex={-1} {...mediaEvents}>{trackEls_}</video>
      <div className="wf-media-surface" aria-hidden onClick={e=>{if((e.nativeEvent as globalThis.PointerEvent).pointerType==='touch'&&!show){poke();return;}toggle();}} onDoubleClick={toggleFs}/>
      {title&&<div className="wf-media-title">{title}</div>}
      {autoMuted&&playing&&<button type="button" className="wf-media-unmute" onClick={()=>{const el=media();if(el){el.muted=false;if(!el.volume)el.volume=1;}setAutoMuted(false);}}><VolumeX size={16}/>{t('Tap to unmute')}</button>}
      {cue&&<div className="wf-media-cue" aria-live="polite"><span>{cue}</span></div>}
      {waiting&&playing&&<span className="wf-media-spinner" aria-hidden/>}
      {!playing&&!waiting&&<button type="button" className="wf-media-bigplay" onClick={toggle} aria-label={t('Play')} tabIndex={-1}><Play size={30} fill="currentColor"/></button>}
      <div className="wf-media-controls">
        {!live&&seekBar}
        <div className="wf-media-row">
          {playBtn}
          {volume_}
          {live?liveBadge:<span className="wf-media-time">{fmtTime(time)} <i>/</i> {fmtTime(duration)}</span>}
          {current&&!live&&<span className="wf-media-chapter-now">{current.title}</span>}
          <span className="wf-media-spacer"/>
          {captionsBtn}
          {settingsBtn}
          {downloadLink}
          {canPip&&btn(pip?t('Exit picture-in-picture'):t('Picture-in-picture'),<PictureInPicture2 size={20}/>,togglePip,{pressed:pip,cls:'wf-media-pip'})}
          {btn(fs?t('Exit fullscreen'):t('Fullscreen'),fs?<Minimize size={20}/>:<Maximize size={20}/>,toggleFs)}
        </div>
      </div>
      {menuPanel}
    </div>
    {caption&&<figcaption>{caption}</figcaption>}
    {chapterList}
  </figure>;
}
