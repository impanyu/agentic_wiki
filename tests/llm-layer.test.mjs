import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
const source=['catalog','prices','limits','schema','translate','search','core'].map(f=>strip('app/llm/'+f+'.ts')).join('\n');
const L=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));

const reply=(status,body,headers={})=>({ok:status>=200&&status<300,status,headers:{get:k=>headers[k.toLowerCase()]??null},json:async()=>body,text:async()=>typeof body==='string'?body:JSON.stringify(body),body:{cancel:async()=>{}}});
const chatReply=(message,usage={prompt_tokens:10,completion_tokens:5,total_tokens:15},finish='stop')=>({id:'c1',choices:[{message,finish_reason:finish}],usage});
const textReply=text=>chatReply({role:'assistant',content:text});
const openaiReply=(text,usage={input_tokens:1000,output_tokens:100,total_tokens:1100,input_tokens_details:{cached_tokens:0}})=>({id:'resp_1',status:'completed',model:'gpt-5.4-mini',output:[{type:'message',id:'msg_1',content:[{type:'output_text',text}]}],usage});
function harness(keys,handler,{spent=0,clock}={}){
 const calls=[],rows=[];let t=clock??Date.UTC(2026,10,20,12);
 const spend={value:spent,months:[]};
 const llm=L.createLLM({
  env:name=>keys[name],now:()=>t,sleep:async ms=>{t+=ms;},log:()=>{},
  fetch:async(url,init)=>{const body=init?.body?JSON.parse(init.body):null;calls.push({url:String(url),body,headers:init?.headers||{}});return handler(String(url),body,calls.length);},
  usage:{record:async row=>{rows.push(row);},monthSpend:async month=>{spend.months.push(month);return typeof spend.value==='function'?spend.value(month):spend.value;}},
 });
 return {llm,calls,rows,spend,advance:ms=>{t+=ms;},setClock:v=>{t=v;}};
}
const entry=id=>L.BASE_CATALOG.models[id];

test('request translation: instructions, images, paired tool calls/outputs, deferred user parts, substituted search',()=>{
 const body={instructions:'Be exact.',input:[
  {role:'user',content:[{type:'input_text',text:'What is in the image?'},{type:'input_image',image_url:'data:image/png;base64,AAA',detail:'high'}]},
  {type:'reasoning',id:'rs_1',encrypted_content:'x'},
  {type:'message',role:'assistant',content:[{type:'output_text',text:'Let me check.'}]},
  {type:'function_call',call_id:'a',name:'lookup',arguments:'{"q":1}'},
  {type:'function_call',call_id:'b',name:'chart',arguments:'{}'},
  {type:'function_call_output',call_id:'a',output:'{"found":true}'},
  {role:'user',content:[{type:'input_image',image_url:'https://x/chart.png'}]},
  {type:'function_call_output',call_id:'b',output:'{"ok":1}'},
  {type:'web_search_call',id:'llm_ws_1',status:'completed',action:{type:'search',query:'rain'},llm:{call_id:'s1',results:'{"results":[]}'}},
  {type:'web_search_call',id:'ws_real',status:'completed',action:{type:'search',query:'openai'}},
 ],tools:[{type:'function',name:'lookup',description:'d',parameters:{type:'object',properties:{q:{type:'number'}}},strict:true},{type:'web_search'}],tool_choice:{type:'function',name:'lookup'},max_output_tokens:999999,reasoning:{effort:'none'}};
 const r=L.toChat(body,entry('groq:gpt-oss-120b'),{webSearch:true});
 assert.equal(r.model,'openai/gpt-oss-120b');
 assert.deepEqual(r.messages.map(m=>m.role),['system','user','assistant','tool','tool','user','assistant','tool']);
 assert.equal(r.messages[1].content,'What is in the image?\n[image omitted]');// groq model has no vision
 assert.equal(r.messages[2].content,'Let me check.');assert.deepEqual(r.messages[2].tool_calls.map(c=>c.id),['a','b']);
 assert.equal(r.messages[6].tool_calls[0].function.name,'web_search');assert.equal(r.messages[7].tool_call_id,'s1');
 assert.deepEqual(r.tools.map(t=>t.function.name),['lookup','web_search']);assert.equal(r.tools[0].function.strict,undefined);
 assert.deepEqual(r.tool_choice,{type:'function',function:{name:'lookup'}});
 assert.equal(r.max_tokens,32766);assert.equal(r.reasoning_effort,'low');
 const v=L.toChat(body,entry('nrp:qwen3'),{webSearch:false});
 assert.deepEqual(v.messages[1].content[1],{type:'image_url',image_url:{url:'data:image/png;base64,AAA',detail:'high'}});
 assert.equal(v.messages[5].content[0].image_url.url,'https://x/chart.png');
 assert.deepEqual(v.tools.map(t=>t.function.name),['lookup']);
 assert.deepEqual(v.chat_template_kwargs,{enable_thinking:false});
});

test('response translation: tool calls, text, usage, think tags and JSON fences; OpenAI-bound input is sanitized',()=>{
 const out=L.fromChat(chatReply({role:'assistant',content:'<think>hmm</think>```json\n{"a":1}\n```',tool_calls:[{id:'call_9',type:'function',function:{name:'lookup',arguments:'{"q":2}'}},{type:'function',function:{name:'x',arguments:{y:1}}}]},{prompt_tokens:7,completion_tokens:3,total_tokens:10,prompt_tokens_details:{cached_tokens:2}}),{json:true});
 assert.equal(out.status,'completed');
 assert.equal(out.output[0].type,'message');assert.equal(out.output[0].content[0].text,'{"a":1}');
 assert.deepEqual(out.output.slice(1).map(o=>[o.type,o.name,o.arguments]),[['function_call','lookup','{"q":2}'],['function_call','x','{"y":1}']]);
 assert.equal(out.output[1].call_id,'call_9');assert.ok(out.output[2].call_id);
 assert.deepEqual(out.usage,{input_tokens:7,output_tokens:3,total_tokens:10,input_tokens_details:{cached_tokens:2}});
 assert.equal(L.fromChat(chatReply({content:'cut'},{},'length'),{json:false}).status,'incomplete');
 // Round trip: chat output items fed back as input become valid chat messages again.
 const back=L.toChat({input:[{role:'user',content:'go'},...out.output,{type:'function_call_output',call_id:'call_9',output:'1'},{type:'function_call_output',call_id:out.output[2].call_id,output:'2'}]},entry('nrp:qwen3'),{webSearch:false});
 assert.deepEqual(back.messages.map(m=>m.role),['user','assistant','tool','tool']);assert.equal(back.messages[1].tool_calls.length,2);
 // Fallback to OpenAI mid-run: synthetic ids and substituted searches become accepted shapes.
 const openai=L.forOpenAI({class:'agent',avoidModel:'x',model:'gpt',input:[...out.output,{type:'web_search_call',id:'llm_ws',status:'completed',action:{query:'q'},llm:{call_id:'s',results:'R'}},{type:'reasoning',id:'rs_1'}]});
 assert.equal(openai.class,undefined);assert.equal(openai.avoidModel,undefined);
 assert.deepEqual(openai.input[0],{role:'assistant',content:'{"a":1}'});
 assert.equal(openai.input[1].id,undefined);assert.equal(openai.input[1].call_id,'call_9');
 assert.match(openai.input[3].content,/web_search\("q"\)[\s\S]*R/);assert.deepEqual(openai.input[4],{type:'reasoning',id:'rs_1'});
});

test('with only OPENAI_API_KEY every class resolves to OpenAI, the body passes through and cost is metered',async()=>{
 const h=harness({OPENAI_API_KEY:'k'},()=>reply(200,openaiReply('hi')));
 for(const c of ['premium','agent','fast','vision','review'])assert.deepEqual(h.llm.chain({class:c}).map(e=>e.id),['openai']);
 const body={class:'fast',model:'gpt-5.4-mini',store:false,instructions:'x',input:'y',text:{format:{type:'json_object'}},reasoning:{effort:'none'}};
 const r=await h.llm.respond(body);
 assert.equal(h.calls[0].url,'https://api.openai.com/v1/responses');
 const {class:_,...sent}=body;assert.deepEqual(h.calls[0].body,sent);
 assert.equal(r.llm.provider,'openai');assert.equal(r.llm.class,'fast');
 assert.equal(h.rows[0].costUsd,(1000*0.75+100*4.5)/1e6);assert.equal(h.rows[0].month,'2026-11');
 assert.equal(L.costUsd('gpt-5.6-terra',{input_tokens:300000,output_tokens:1000,input_tokens_details:{cached_tokens:100000}}),(200000*4+100000*0.4+1000*18)/1e6);
 assert.equal(L.costUsd('gpt-5.4-mini',{input_tokens:0,output_tokens:0},2),0.02);
});

const OLD_CHAINS=JSON.stringify({chains:{agent:['pool:local','deepseek:v4-flash','nrp:deepseek-v4-flash','nrp:glm-5','nrp:minimax','nrp:qwen3','nrp:kimi','gemini:gemini-4-hydrogen','openrouter:nemotron-3-ultra','groq:gpt-oss-120b','openai'],review:['pool:local','deepseek:v4-flash','nrp:deepseek-v4-flash','nrp:glm-5','nrp:minimax','nrp:qwen3','nrp:kimi','gemini:gemini-4-hydrogen','openrouter:nemotron-3-ultra','groq:gpt-oss-120b','openai'],fast:['gemini:gemini-3.8-flash-lite','nrp:gpt-oss','openai']}});
// The mechanics below are tested over a fixed chain (the production chains change with measurements).
test('chain falls back on 429 (honoring Retry-After), retries a 5xx once, and skips a model over its daily quota',async()=>{
 const keys={NRP_LLM_TOKEN:'n',GEMINI_API_KEY:'g',GROQ_API_KEY:'q',OPENAI_API_KEY:'o'};
 let mode='429';
 const h=harness({...keys,LLM_CATALOG_OVERRIDES:OLD_CHAINS},(url,body)=>{
  if(body.model==='deepseek-v4-flash'){if(mode==='429')return reply(429,'slow down',{'retry-after':'30'});return reply(503,'busy');}
  if(body.model==='glm-5')return reply(200,textReply('from glm'));
  return reply(200,textReply('other'));
 });
 const r=await h.llm.respond({class:'agent',input:'hello'});
 assert.equal(r.output[0].content[0].text,'from glm');assert.equal(r.llm.model,'glm-5');
 assert.deepEqual(r.llm.fallbacks,[{model:'nrp:deepseek-v4-flash',reason:'rate:429'}]);
 // deepseek is cooling down for 30s: not even tried.
 h.calls.length=0;await h.llm.respond({class:'agent',input:'again'});assert.deepEqual(h.calls.map(c=>c.body.model),['glm-5']);
 h.advance(31000);mode='5xx';h.calls.length=0;
 await h.llm.respond({class:'agent',input:'x'});assert.deepEqual(h.calls.map(c=>c.body.model),['deepseek-v4-flash','deepseek-v4-flash','glm-5']);
 assert.ok(h.rows.some(r=>r.status==='error:server:503'));
 // Daily quota: Gemini flash-lite allows 1000/day; exhaust it and fast skips to the next model.
 const g=harness({LLM_CATALOG_OVERRIDES:OLD_CHAINS,GEMINI_API_KEY:'g',NRP_LLM_TOKEN:'n'},(url,body)=>reply(200,textReply(body.model)));
 const lite=g.llm.catalog().models['gemini:gemini-3.8-flash-lite'];
 for(let i=0;i<lite.limits.rpd;i++){g.llm.tracker.acquire(lite,1)();if(i%10===0)g.advance(61000);}
 const res=await g.llm.respond({class:'fast',input:'x'});
 assert.equal(res.llm.model,'gpt-oss');assert.equal(res.llm.fallbacks[0].reason,'rpd');
 // A daily-quota 429 body also parks the model until the reset.
 const d=harness({LLM_CATALOG_OVERRIDES:OLD_CHAINS,GEMINI_API_KEY:'g',NRP_LLM_TOKEN:'n'},(url,body)=>body.model.startsWith('gemini')?reply(429,{error:{message:'Quota exceeded for GenerateRequestsPerDayPerProjectPerModel'}}):reply(200,textReply('nrp')));
 await d.llm.respond({class:'fast',input:'x'});
 assert.match(JSON.stringify(d.llm.tracker.snapshot()['gemini:gemini-3.8-flash-lite']),/daily quota/);
 // Everything failing: AI_UNAVAILABLE; only rate limits: AI_LIMIT.
 const f=harness({LLM_CATALOG_OVERRIDES:OLD_CHAINS,NRP_LLM_TOKEN:'n'},()=>reply(500,'down'));
 await assert.rejects(f.llm.respond({class:'fast',input:'x'}),/AI_UNAVAILABLE/);
 assert.throws(()=>harness({},()=>reply(200,{})).llm.chain({class:'nope'}),/LLM_CLASS_INVALID/);
 await assert.rejects(harness({},()=>reply(200,{})).llm.respond({class:'fast',input:'x'}),/AI_SETUP/);
});

test('budget exhaustion sends premium to the free chain until the 1st of next month (UTC)',async()=>{
 const keys={OPENAI_API_KEY:'o',NRP_LLM_TOKEN:'n',LLM_MONTHLY_BUDGET_USD:'50'};
 const h=harness(keys,url=>url.includes('openai.com')?reply(200,openaiReply('premium')):reply(200,textReply('free')),{clock:Date.UTC(2026,10,30,23,59)});
 h.spend.value=month=>month==='2026-11'?50:0;
 const s=await h.llm.spend();assert.deepEqual([s.overBudget,s.budgetUsd,s.remainingUsd,s.resetsAt],[true,50,0,'2026-12-01T00:00:00.000Z']);
 const r=await h.llm.respond({class:'premium',model:'gpt-5.6-terra',input:'x'});
 assert.equal(r.llm.provider,'nrp');assert.deepEqual(r.llm.fallbacks[0],{model:'openai',reason:'over_budget'});
 h.setClock(Date.UTC(2026,11,1,0,1));
 const next=await h.llm.respond({class:'premium',model:'gpt-5.6-terra',input:'x'});
 assert.equal(next.llm.provider,'openai');assert.ok(h.spend.months.includes('2026-12'));
 // Spend accumulates locally between store reads.
 const before=(await h.llm.spend()).spentUsd;await h.llm.respond({class:'premium',model:'gpt-5.6-terra',input:'x'});
 assert.ok((await h.llm.spend()).spentUsd>before);
 // No free model configured: over budget is a hard limit.
 const only=harness({OPENAI_API_KEY:'o',LLM_MONTHLY_BUDGET_USD:'1'},()=>reply(200,openaiReply('x')),{spent:1});
 await assert.rejects(only.llm.respond({class:'premium',input:'x'}),/AI_LIMIT/);assert.equal(only.calls.length,0);
 assert.equal((await harness({OPENAI_API_KEY:'o'},()=>reply(200,{})).llm.spend()).budgetUsd,300);
});

test('daily quotas reset at midnight Pacific (DST-aware) or UTC',()=>{
 // Winter (PST, UTC-8): 2026-01-15 07:59Z is still Jan 14 in Los Angeles.
 assert.equal(L.dayKey(Date.UTC(2026,0,15,7,59),'pacific'),'2026-01-14');
 assert.equal(L.dayKey(Date.UTC(2026,0,15,8,0),'pacific'),'2026-01-15');
 assert.equal(new Date(L.nextDayReset(Date.UTC(2026,0,15,3),'pacific')).toISOString(),'2026-01-15T08:00:00.000Z');
 // Summer (PDT, UTC-7).
 assert.equal(new Date(L.nextDayReset(Date.UTC(2026,6,4,12),'pacific')).toISOString(),'2026-07-05T07:00:00.000Z');
 assert.equal(new Date(L.nextDayReset(Date.UTC(2026,6,4,12),'utc')).toISOString(),'2026-07-05T00:00:00.000Z');
 const tracker=new L.RateTracker(()=>t);let t=Date.UTC(2026,0,15,7,0);
 const e={id:'g',limits:{rpd:2,dayReset:'pacific'}};tracker.acquire(e,1)();tracker.acquire(e,1)();
 const block=tracker.blocked(e);assert.equal(block.reason,'rpd');assert.equal(new Date(block.retryAt).toISOString(),'2026-01-15T08:00:00.000Z');
 t=Date.UTC(2026,0,15,8,0,1);assert.equal(tracker.blocked(e),null);
 const rpm={id:'r',limits:{rpm:1,tpm:100,concurrency:1}};const release=tracker.acquire(rpm,10);
 assert.equal(tracker.blocked(rpm).reason,'rpm');t+=60001;assert.equal(tracker.blocked(rpm).reason,'concurrency');release();
 const tp={id:'tp',limits:{tpm:100}};tracker.acquire(tp,10)(20);assert.equal(tracker.blocked(tp,70),null);assert.equal(tracker.blocked(tp,90).reason,'tpm');
 assert.equal(L.retryAfterMs('2',0),2000);assert.equal(L.retryAfterMs(new Date(5000).toUTCString(),0),5000);
});

test('review prefers a different model family than the editor used',async()=>{
 const h=harness({LLM_CATALOG_OVERRIDES:OLD_CHAINS,NRP_LLM_TOKEN:'n',GEMINI_API_KEY:'g',GROQ_API_KEY:'q'},(url,body)=>reply(200,textReply(body.model)));
 const chain=h.llm.chain({class:'review',avoidModel:'qwen3'}).map(e=>e.id);
 assert.equal(chain[0],'nrp:deepseek-v4-flash');assert.equal(chain.at(-1),'nrp:qwen3');
 const r=await h.llm.respond({class:'review',avoidModel:'deepseek-v4-flash',input:'judge'});assert.equal(r.llm.model,'glm-5');
 assert.equal(h.llm.chain({class:'review',avoidModel:'gpt-5.6-terra'}).find(e=>e.family==='gpt-oss')?.id,'groq:gpt-oss-120b');
 assert.ok(!h.llm.chain({class:'review',avoidModel:'gemini-3.8-flash'}).slice(0,4).some(e=>e.family==='gemini'));
});

test('structured output: native json_schema where supported, otherwise instruct, validate and repair once',async()=>{
 const schema={type:'object',additionalProperties:false,properties:{verdict:{type:'string',enum:['yes','no']},score:{type:'integer'}},required:['verdict','score']};
 const format={type:'json_schema',name:'judge',strict:true,schema};
 const native=L.toChat({instructions:'Judge.',input:'x',text:{format}},entry('nrp:qwen3'),{webSearch:false});
 assert.deepEqual(native.response_format,{type:'json_schema',json_schema:{name:'judge',schema,strict:true}});
 let n=0;
 const h=harness({OPENROUTER_API_KEY:'r',LLM_CATALOG_OVERRIDES:JSON.stringify({chains:{agent:['openrouter:nemotron-3-ultra']}})},(url,body)=>{
  n++;if(n===1){assert.match(body.messages[0].content,/JSON Schema named judge/);assert.deepEqual(body.response_format,{type:'json_object'});return reply(200,textReply('Sure! {"verdict":"maybe","score":1}'));}
  assert.match(body.messages.at(-1).content,/\$\.verdict must be one of/);return reply(200,textReply('```json\n{"verdict":"yes","score":2}\n```'));
 });
 const r=await h.llm.respond({class:'agent',instructions:'Judge.',input:'x',text:{format}});
 assert.deepEqual(JSON.parse(r.output[0].content[0].text),{verdict:'yes',score:2});assert.equal(r.usage.input_tokens,20);
 n=0;const bad=harness({OPENROUTER_API_KEY:'r',LLM_CATALOG_OVERRIDES:JSON.stringify({chains:{agent:['openrouter:nemotron-3-ultra']}})},()=>{n++;return reply(200,textReply('not json'));});
 await assert.rejects(bad.llm.respond({class:'agent',input:'x',text:{format}}),/AI_UNAVAILABLE/);assert.equal(n,2);
 assert.deepEqual(L.schemaErrors(schema,{verdict:'no',score:1.5,extra:1}),['$.score must be integer','$.extra is not allowed']);
 assert.throws(()=>L.loadCatalog('{bad'),/not valid JSON/);
});

test('built-in web_search becomes a function tool backed by the search chain; no search provider keeps it on OpenAI',async()=>{
 let round=0;
 const h=harness({LLM_CATALOG_OVERRIDES:OLD_CHAINS,NRP_LLM_TOKEN:'n',TAVILY_API_KEY:'t',JINA_API_KEY:'j',OPENAI_API_KEY:'o'},(url,body)=>{
  if(url.startsWith('https://s.jina.ai/'))return reply(503,'jina down');
  if(url==='https://api.tavily.com/search'){assert.equal(body.query,'tallest building 2026');return reply(200,{results:[{title:'Tower',url:'https://ex.org/t',content:'It is 1 km tall.'}]});}
  round++;
  if(round===1){assert.equal(body.tool_choice,'required');assert.ok(body.tools.some(t=>t.function.name==='web_search'));return reply(200,chatReply({role:'assistant',content:null,tool_calls:[{id:'s1',type:'function',function:{name:'web_search',arguments:'{"query":"tallest building 2026","count":3}'}}]}));}
  assert.equal(body.tool_choice,'auto');const tool=body.messages.find(m=>m.role==='tool');assert.match(tool.content,/ex\.org\/t/);
  return reply(200,textReply('The tallest is [Tower](https://ex.org/t).'));
 });
 const r=await h.llm.respond({class:'agent',tools:[{type:'web_search'}],tool_choice:'required',include:['web_search_call.action.sources'],input:'tallest building?'});
 assert.equal(r.llm.provider,'nrp');assert.equal(r.llm.webSearches,1);
 assert.equal(r.output[0].type,'web_search_call');assert.equal(r.output[0].status,'completed');
 assert.deepEqual(r.output[0].action.sources,[{type:'url',url:'https://ex.org/t',title:'Tower'}]);
 assert.equal(L.searched(r),true);assert.equal(L.searched({output:[{type:'function_call',name:'web_search'}]}),false);
 assert.equal(r.output.at(-1).content[0].text,'The tallest is [Tower](https://ex.org/t).');
 // Mixed with an app tool: the app call returns to the caller with the search results attached.
 let step=0;const m=harness({LLM_CATALOG_OVERRIDES:OLD_CHAINS,GROQ_API_KEY:'q',EXA_API_KEY:'e'},(url,body)=>{
  if(url==='https://api.exa.ai/search')return reply(200,{results:[{title:'A',url:'https://a.org',text:'x'}]});
  step++;return reply(200,chatReply({content:null,tool_calls:[{id:'w',type:'function',function:{name:'web_search',arguments:'{"query":"q"}'}},{id:'f',type:'function',function:{name:'save',arguments:'{}'}}]}));
 });
 const mixed=await m.llm.respond({class:'agent',tools:[{type:'web_search'},{type:'function',name:'save',parameters:{type:'object',properties:{}}}],input:'go'});
 assert.deepEqual(mixed.output.map(o=>o.type+':'+(o.name||'')),['web_search_call:','function_call:save']);assert.equal(mixed.output[0].llm.call_id,'w');
 // No search API configured: only OpenAI can serve a web_search request.
 const o=harness({LLM_CATALOG_OVERRIDES:OLD_CHAINS,NRP_LLM_TOKEN:'n',OPENAI_API_KEY:'o'},()=>reply(200,openaiReply('x')));
 assert.deepEqual(o.llm.chain({class:'agent',tools:[{type:'web_search'}]}).map(e=>e.id),['openai']);
 assert.deepEqual(o.llm.chain({class:'agent',input:[{role:'user',content:[{type:'input_file',file_data:'x'}]}]}).map(e=>e.id),['openai']);
 assert.deepEqual(o.llm.chain({class:'fast',input:[{role:'user',content:[{type:'input_image',image_url:'u'}]}]}).map(e=>e.id),['openai','nrp:gemma']);
});

test('the embedder is pinned to one model and dimension and never switches when it is down',async()=>{
 let down=false;
 const h=harness({NRP_LLM_TOKEN:'n',GEMINI_API_KEY:'g',OPENAI_API_KEY:'o'},(url,body)=>{
  if(down)return reply(500,'down');
  return reply(200,{data:body.input.map((t,index)=>({index,embedding:Array.from({length:body.dimensions||4096},(_,i)=>i===0?1:0)})),usage:{total_tokens:5}});
 });
 const embed=h.llm.embedder();assert.equal(embed.model,'openai:text-embedding-3-small');assert.equal(embed.dims,768);
 const vectors=await embed(['a','b']);assert.equal(vectors.length,2);assert.equal(vectors[0].length,768);
 assert.equal(h.calls[0].url,'https://api.openai.com/v1/embeddings');assert.equal(h.calls[0].body.dimensions,768);
 down=true;h.calls.length=0;
 await assert.rejects(embed(['c']),/EMBED_MODEL_UNAVAILABLE: openai:text-embedding-3-small/);
 assert.ok(h.calls.every(c=>c.url.startsWith('https://api.openai.com/')));assert.equal(h.calls.length,2);
 // Explicit choice and dimension come from env; a missing key is an error, not a switch.
 const g=harness({GEMINI_API_KEY:'g',ENTITY_EMBED_MODEL:'nrp:qwen3-embedding',ENTITY_EMBED_DIM:'256'},()=>reply(200,{}));
 await assert.rejects(g.llm.embedder()(['x']),/not configured/);
 assert.equal(harness({GEMINI_API_KEY:'g'},()=>reply(200,{})).llm.embedder().model,'gemini:gemini-embedding-2');
 assert.throws(()=>harness({OPENAI_API_KEY:'o',ENTITY_EMBED_DIM:'4000'},()=>reply(200,{})).llm.embedder(),/not available/);
 // Site vectors stay on text-embedding-3-small at 512 dimensions and are metered.
 const s=harness({OPENAI_API_KEY:'o',NRP_LLM_TOKEN:'n'},(url,body)=>reply(200,{data:[{index:0,embedding:Array(512).fill(0.1)}],usage:{total_tokens:1000}}));
 const [v]=await s.llm.siteEmbed(['q']);assert.equal(v.length,512);
 assert.deepEqual([s.calls[0].url,s.calls[0].body.model,s.calls[0].body.dimensions],['https://api.openai.com/v1/embeddings','text-embedding-3-small',512]);
 assert.equal(s.rows[0].class,'site-embed');assert.equal(s.rows[0].costUsd,1000*0.02/1e6);
});

test('streaming: OpenAI streams natively; a Chat provider delivers the whole turn through the same callbacks',async()=>{
 const h=harness({NRP_LLM_TOKEN:'n'},()=>reply(200,textReply('Full article')));
 const deltas=[];const r=await h.llm.respondStream({class:'agent',input:'x'},{onTextDelta:d=>deltas.push(d)});
 assert.deepEqual(deltas,['Full article']);assert.equal(r.llm.provider,'nrp');
 const o=L.createLLM({env:n=>n==='OPENAI_API_KEY'?'o':undefined,log:()=>{},usage:{record:async()=>{},monthSpend:async()=>0},fetch:async()=>reply(200,{}),readEvents:async function*(){yield {type:'response.output_text.delta',delta:'Hel'};yield {type:'response.output_text.delta',delta:'lo'};yield {type:'error',message:'boom'};}});
 const seen=[];await assert.rejects(o.respondStream({class:'premium',input:'x'},{onTextDelta:d=>seen.push(d)}),/AI_UNAVAILABLE/);assert.deepEqual(seen,['Hel','lo']);
});
