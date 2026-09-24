'use client';
import {useEffect,useRef,useState} from 'react';
import {Mic,Square,LoaderCircle} from 'lucide-react';
import {useUi} from '@/app/i18n/client';

// Microphone button: click to start recording, click again to stop. The clip is
// transcribed on the server (Chinese, English or both) and the text is handed to
// onText, which inserts it into the input it belongs to.
const TYPES=[['audio/webm;codecs=opus','webm'],['audio/webm','webm'],['audio/mp4','mp4'],['audio/ogg;codecs=opus','ogg']] as const;
const LIMIT_MS=120000;
export function VoiceInput({onText,className,disabled}:{onText:(text:string)=>void;className?:string;disabled?:boolean}){
 const {t}=useUi();
 const [state,setState]=useState<'idle'|'recording'|'transcribing'>('idle');
 const [error,setError]=useState('');
 const recorder=useRef<MediaRecorder|null>(null),timer=useRef<number|undefined>(undefined),onTextRef=useRef(onText);
 onTextRef.current=onText;
 useEffect(()=>{if(!error)return;const id=window.setTimeout(()=>setError(''),6000);return ()=>window.clearTimeout(id);},[error]);
 useEffect(()=>()=>{window.clearTimeout(timer.current);const r=recorder.current;if(r&&r.state!=='inactive'){r.onstop=null;r.stop();r.stream.getTracks().forEach(track=>track.stop());}},[]);
 const transcribe=async(blob:Blob,extension:string)=>{
  setState('transcribing');
  try{
   const form=new FormData();form.append('audio',blob,'speech.'+extension);
   const response=await fetch('/api/transcribe',{method:'POST',body:form});
   const data=await response.json().catch(()=>({})) as {text?:string;error?:string};
   if(!response.ok)throw Error(data.error||'Could not transcribe the recording.');
   if(data.text)onTextRef.current(data.text);else setError(t('No speech was recognized.'));
  }catch(e){setError(t(e instanceof Error?e.message:'Could not transcribe the recording.'));}
  finally{setState('idle');}
 };
 const start=async()=>{
  setError('');
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError(t('This browser does not support voice input.'));return;}
  let stream:MediaStream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}catch{setError(t('Microphone access was blocked.'));return;}
  const [mimeType,extension]=TYPES.find(([type])=>MediaRecorder.isTypeSupported(type))||['','webm'];
  const r=new MediaRecorder(stream,mimeType?{mimeType}:undefined),chunks:Blob[]=[];
  r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  r.onstop=()=>{window.clearTimeout(timer.current);stream.getTracks().forEach(track=>track.stop());recorder.current=null;const blob=new Blob(chunks,{type:r.mimeType||mimeType||'audio/webm'});if(blob.size<1000){setState('idle');setError(t('No speech was recognized.'));return;}void transcribe(blob,/mp4/.test(blob.type)?'mp4':/ogg/.test(blob.type)?'ogg':extension);};
  recorder.current=r;r.start();setState('recording');
  timer.current=window.setTimeout(()=>{if(r.state!=='inactive')r.stop();},LIMIT_MS);
 };
 const stop=()=>{const r=recorder.current;if(r&&r.state!=='inactive')r.stop();};
 const label=state==='recording'?t('Stop recording'):state==='transcribing'?t('Transcribing…'):t('Voice input');
 return <span className={'voice-input'+(className?' '+className:'')}>
  <button type="button" className={'voice-button'+(state==='recording'?' recording':'')} aria-label={label} title={error||label} aria-pressed={state==='recording'} disabled={(disabled&&state==='idle')||state==='transcribing'} onClick={()=>{if(state==='recording')stop();else void start();}}>
   {state==='transcribing'?<LoaderCircle className="spinner" size={17}/>:state==='recording'?<Square size={14} fill="currentColor"/>:<Mic size={17}/>}
  </button>
  {error&&<span className="voice-error" role="status">{error}</span>}
 </span>;
}
