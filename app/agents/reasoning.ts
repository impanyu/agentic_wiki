export type ReasoningEffort='none'|'low'|'medium'|'high'|'xhigh'|'max';
const valid=new Set(['none','low','medium','high','xhigh','max']);
export function reasoningOptions(model:string,role='',override?:ReasoningEffort){
 // Only attach parameters to model families with a known contract.
 if(!/^gpt-(?:5\.4|5\.6)(?:-|$)/.test(model))return {};
 const coding=/coding|coder/.test(role),agent=/generation|content-update|composer|^(comments|page):/.test(role)||model.startsWith('gpt-5.6');
 const configured=process.env[coding?'OPENAI_CODING_REASONING_EFFORT':agent?'OPENAI_AGENT_REASONING_EFFORT':'OPENAI_ROUTING_REASONING_EFFORT'];
 const effort=/^(content|app)-generation$/.test(role)?'low':override||(configured&&valid.has(configured)?configured: coding?'medium':agent?'low':'none');
 if(effort==='max'&&model.startsWith('gpt-5.4'))throw Error('This model does not support max reasoning effort.');
 return {reasoning:{effort}};
}
