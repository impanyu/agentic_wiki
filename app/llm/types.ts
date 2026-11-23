// Internal request/response shape: the subset of the OpenAI Responses API this app uses.
export type TaskClass='premium'|'agent'|'fast'|'vision'|'translate'|'review'|'embed'|'site-embed';
export type ReasoningEffort='none'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';
export type ContentPart={type:string;text?:string;image_url?:string;detail?:string;annotations?:Annotation[];[key:string]:unknown};
export type InputItem=
 |{type?:'message';role:'user'|'assistant'|'system'|'developer';content:string|ContentPart[];id?:string;status?:string}
 |{type:'function_call';call_id:string;name:string;arguments:string;id?:string;status?:string}
 |{type:'function_call_output';call_id:string;output:string}
 |{type:'reasoning';id?:string;[key:string]:unknown}
 |{type:'web_search_call';id?:string;status?:string;action?:WebSearchAction;llm?:{call_id:string;results:string}};
export type FunctionTool={type:'function';name:string;description?:string;parameters?:Record<string,unknown>;strict?:boolean};
export type Tool=FunctionTool|{type:'web_search'|string;[key:string]:unknown};
export type ToolChoice='auto'|'none'|'required'|{type:'function';name:string};
export type TextFormat={type:'text'}|{type:'json_object'}|{type:'json_schema';name:string;schema:Record<string,unknown>;strict?:boolean};
export type ResponsesBody={
 model?:string;instructions?:string;input?:string|InputItem[];tools?:Tool[];tool_choice?:ToolChoice;
 text?:{format?:TextFormat;[key:string]:unknown};reasoning?:{effort?:ReasoningEffort;[key:string]:unknown};
 max_output_tokens?:number;store?:boolean;include?:string[];[key:string]:unknown;
};
export type LLMRequest=ResponsesBody&{class:TaskClass;avoidModel?:string};
export type Annotation={type:string;url:string;title?:string};
export type WebSearchAction={type:string;query?:string;queries?:string[];url?:string;pattern?:string;sources?:{type?:string;url:string;title?:string}[]};
export type OutputItem={
 type:string;id?:string;status?:string;role?:string;
 content?:{type:string;text?:string;annotations?:Annotation[]}[];
 action?:WebSearchAction;call_id?:string;name?:string;arguments?:string;llm?:{call_id:string;results:string};
};
export type Usage={input_tokens:number;output_tokens:number;total_tokens:number;input_tokens_details?:{cached_tokens?:number}};
export type CallInfo={provider:string;model:string;catalogId:string;class:TaskClass;latencyMs:number;costUsd:number;fallbacks:{model:string;reason:string}[];webSearches:number};
export type LLMResponse={id?:string;status?:string;output?:OutputItem[];usage?:Usage;data?:{embedding:number[];index:number}[];llm?:CallInfo;[key:string]:unknown};
export type StreamHandlers={onTextDelta?:(text:string)=>void;onToolArguments?:(name:string,text:string)=>void};
