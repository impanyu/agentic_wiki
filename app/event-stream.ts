// Decode SSE across arbitrary network chunks, including split UTF-8 characters.
export async function* readEvents(stream:ReadableStream<Uint8Array>){
 const reader=stream.getReader(),decoder=new TextDecoder();let buffer='';
 try{
  while(true){
   const {done,value}=await reader.read();
   buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
   let match:RegExpExecArray|null;
   while((match=/\r?\n\r?\n/.exec(buffer))){
    const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);
    const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
    if(data&&data!=='[DONE]')yield JSON.parse(data) as Record<string,unknown>;
   }
   if(buffer.length>2_000_000)throw new Error('Stream frame too large');
   if(done)break;
  }
  if(buffer.trim())throw new Error('The answer stream ended unexpectedly. Please try again.');
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
