import type {Highlight,InternalLink} from '@/app/internal-links';
export function conceptRanges(nodes:Map<string,string>,candidates:{node:string;text:string}[]):Highlight[]{
 const result:Highlight[]=[];
 for(const c of [...candidates].sort((a,b)=>b.text.length-a.text.length)){const value=nodes.get(c.node),quote=c.text.trim();if(!value||!/[\p{L}\p{N}]/u.test(quote)||quote.length>120||!(/^(line\d+|summary)\./.test(c.node)))continue;
  let start=value.indexOf(quote);while(start>=0&&result.length<2400){const end=start+quote.length;const latin=/[\p{Script=Latin}\p{N}_]/u;const whole=!(latin.test(quote[0])&&latin.test(value[start-1]||''))&&!(latin.test(quote.at(-1)!)&&latin.test(value[end]||''));if(whole&&!result.some(h=>h.segments.some(s=>s.node===c.node&&s.start<end&&start<s.end)))result.push({quote,segments:[{node:c.node,start,end}]});start=value.indexOf(quote,end);}
 }
 return result;
}
// Saved and manually highlighted links take precedence over suggested concepts.
export function availableConcepts(concepts:Highlight[],links:InternalLink[],highlights:Highlight[]){return concepts.filter(c=>!c.segments.some(a=>[...links,...highlights].some(l=>l.segments.some(b=>a.node===b.node&&a.start<b.end&&b.start<a.end))));}
