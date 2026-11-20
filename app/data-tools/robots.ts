// Pure crawl rules (no imports): robots.txt, same-site checks and link patterns.
export type RobotsRules={allow:string[];disallow:string[];crawlDelay?:number};
// The group for our agent if one names it, else the "*" group. Unknown agents' groups are ignored.
export function parseRobots(text:string,agents:string[]=['rankwiki-bot','agenticwiki']):RobotsRules{
 const groups:{agents:string[];allow:string[];disallow:string[];crawlDelay?:number}[]=[];
 let current:typeof groups[number]|null=null,lastWasAgent=false;
 for(const raw of text.split(/\r?\n/)){
  const line=raw.replace(/#.*$/,'').trim();if(!line)continue;
  const i=line.indexOf(':');if(i<0)continue;
  const field=line.slice(0,i).trim().toLowerCase(),value=line.slice(i+1).trim();
  if(field==='user-agent'){if(!current||!lastWasAgent){current={agents:[],allow:[],disallow:[]};groups.push(current);}current.agents.push(value.toLowerCase());lastWasAgent=true;continue;}
  lastWasAgent=false;if(!current)continue;
  if(field==='allow'&&value)current.allow.push(value);
  else if(field==='disallow'&&value)current.disallow.push(value);
  else if(field==='crawl-delay'){const n=Number(value);if(Number.isFinite(n)&&n>=0)current.crawlDelay=n;}
 }
 const named=groups.filter(g=>g.agents.some(a=>a!=='*'&&agents.some(x=>x.toLowerCase().startsWith(a)||a.startsWith(x.toLowerCase()))));
 const chosen=named.length?named:groups.filter(g=>g.agents.includes('*'));
 return {allow:chosen.flatMap(g=>g.allow),disallow:chosen.flatMap(g=>g.disallow),crawlDelay:chosen.find(g=>g.crawlDelay!==undefined)?.crawlDelay};
}
function patternMatch(pattern:string,path:string){
 const anchored=pattern.endsWith('$'),body=anchored?pattern.slice(0,-1):pattern;
 const re=new RegExp('^'+body.split('*').map(s=>s.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*')+(anchored?'$':''));
 return re.test(path);
}
// Longest matching rule wins; Allow wins a tie (RFC 9309).
export function robotsAllows(rules:RobotsRules,pathAndQuery:string){
 let best=-1,allowed=true;
 for(const p of rules.disallow)if(patternMatch(p,pathAndQuery)&&p.length>best){best=p.length;allowed=false;}
 for(const p of rules.allow)if(patternMatch(p,pathAndQuery)&&p.length>=best){best=p.length;allowed=true;}
 return allowed;
}
// The registrable domain, approximately: the last two labels, or three under common second-level
// country domains (example.co.uk, example.com.au).
export function siteOf(hostname:string){
 const labels=hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'').split('.');
 if(labels.length<=2)return labels.join('.');
 const tld=labels[labels.length-1],sld=labels[labels.length-2];
 const take=tld.length===2&&/^(co|com|org|net|ac|gov|edu|ne|or|go|gob|nic|mil|ltd|plc|sch)$/.test(sld)?3:2;
 return labels.slice(-take).join('.');
}
export const sameSite=(a:string,b:string)=>siteOf(a)===siteOf(b);
// A link pattern is a substring unless it uses regular-expression syntax.
export function linkMatcher(pattern:string):(url:string)=>boolean{
 const p=pattern.trim();if(!p)return ()=>true;
 if(p.length>300)throw Error('linkPattern is longer than 300 characters.');
 const regex=/^\/.*\/[a-z]*$/.test(p)||/[\\^$*+?()[\]{}|]/.test(p);
 if(!regex)return url=>url.includes(p);
 let re:RegExp;try{const m=p.match(/^\/(.*)\/([a-z]*)$/);re=m?new RegExp(m[1],m[2].replace(/[gy]/g,'')):new RegExp(p);}catch(e){throw Error('linkPattern is not a valid regular expression: '+(e as Error).message);}
 return url=>re.test(url);
}
