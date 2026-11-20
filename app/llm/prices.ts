// OpenAI list prices, USD per 1M tokens (Standard tier), from
// https://developers.openai.com/api/docs/pricing — checked 2026-11-20.
// KEEP UP TO DATE: the monthly budget is only as accurate as this table.
// Free providers cost 0. Unknown OpenAI models are billed at the most expensive known rate.
export type Price={input:number;cachedInput:number;output:number;
 // Optional long-context tier (applies when input tokens exceed `above`).
 long?:{above:number;input:number;cachedInput:number;output:number}};
export const PRICES_CHECKED='2026-11-20';
export const OPENAI_PRICES:Record<string,Price>={
 'gpt-5.6-sol':{input:4,cachedInput:0.4,output:20},
 'gpt-5.6-terra':{input:2,cachedInput:0.2,output:12,long:{above:272000,input:4,cachedInput:0.4,output:18}},
 'gpt-5.6-luna':{input:0.2,cachedInput:0.02,output:1.2},
 'gpt-5.4':{input:2.5,cachedInput:0.25,output:15},
 'gpt-5.4-mini':{input:0.75,cachedInput:0.075,output:4.5},
 'gpt-5.4-nano':{input:0.2,cachedInput:0.02,output:1.25},
 'text-embedding-3-small':{input:0.02,cachedInput:0.02,output:0},
 'text-embedding-3-large':{input:0.13,cachedInput:0.13,output:0},
};
// Built-in web search tool calls: $10 per 1,000 calls (content tokens billed as tokens).
export const OPENAI_WEB_SEARCH_PER_CALL=0.01;
const FALLBACK:Price={input:4,cachedInput:0.4,output:20};
export function openaiPrice(model:string):Price{
 if(OPENAI_PRICES[model])return OPENAI_PRICES[model];
 // Dated snapshots (e.g. gpt-5.4-mini-2026-03-01) bill like their base model.
 const base=Object.keys(OPENAI_PRICES).sort((a,b)=>b.length-a.length).find(k=>model.startsWith(k+'-'));
 return base?OPENAI_PRICES[base]:FALLBACK;
}
export function costUsd(model:string,usage:{input_tokens?:number;output_tokens?:number;input_tokens_details?:{cached_tokens?:number}}|undefined,webSearches=0){
 const p=openaiPrice(model),input=usage?.input_tokens||0,cached=Math.min(input,usage?.input_tokens_details?.cached_tokens||0),output=usage?.output_tokens||0;
 const rate=p.long&&input>p.long.above?p.long:p;
 return ((input-cached)*rate.input+cached*rate.cachedInput+output*rate.output)/1e6+webSearches*OPENAI_WEB_SEARCH_PER_CALL;
}
