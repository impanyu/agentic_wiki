export type Highlight={quote:string;segments:{node:string;start:number;end:number}[]};
export type InternalLink=Highlight&{parameters?:import('./components-registry/contracts').Parameters;id:string;targetId:string;targetTitle:string};
export const inlinePattern=/(\[[^\]]+\]\(https?:\/\/(?:[^\s()]|\([^()]*\))+\)|\*\*[^*]+\*\*|\*[^*\n]+\*)/g;
export const linkPattern=/^\[([^\]]+)\]\((https?:\/\/(?:[^\s()]|\([^()]*\))+)\)$/;
export const isSourceLabel=(label:string)=>/^(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(label)||/^\d+$/.test(label);
// Replace citation wrapper parentheses with spaces to preserve saved text offsets.
export function inlineParts(value:string){
 const parts=value.split(inlinePattern);
 for(let i=1;i<parts.length-1;i++){
  if(!linkPattern.test(parts[i]))continue;
  const opening=parts[i-1].match(/([（(])\s*$/),closing=parts[i+1].match(/^\s*([）)])/);
  if(opening&&closing&&((opening[1]==='('&&closing[1]===')')||(opening[1]==='（'&&closing[1]==='）'))){
   parts[i-1]=parts[i-1].slice(0,opening.index)+parts[i-1].slice(opening.index).replace(/[（(]/,' ');
   parts[i+1]=parts[i+1].replace(/[）)]/,' ');
  }
 }
 return parts;
}
export function articleNodes(page:{title:string;summary:string;body:string}){
 const nodes=new Map<string,string>([['title',page.title]]);
 function inline(value:string,id:string){inlineParts(value).forEach((part,i)=>{const link=part.match(linkPattern);if(link&&isSourceLabel(link[1]))return;nodes.set(id+'.'+i,link?link[1]:/^\*{1,2}[^*]+\*{1,2}$/.test(part)?part.replace(/^\*{1,2}|\*{1,2}$/g,''):part);});}
 inline(page.summary,'summary');
 const lines=page.body.split('\n');
 lines.forEach((line,i)=>{
  const image=line.match(/^!\[([^\]]*)\]\((https:\/\/(?:upload|thumb)\.wikimedia\.org\/[^\s)]+)\)$/);
  if(image){inline(image[1],'figure'+i);return;}
  const credit=i>0&&/^!\[.*\]\(https:\/\/(?:upload|thumb)\.wikimedia\.org\//.test(lines[i-1])&&/^\[[^\]]+\]\(https:\/\/commons\.wikimedia\.org\/[^\s]+\)$/.test(line);
  inline(line.replace(/^(?:#{1,3} |[-*] |\d+\. )/,''),credit?'credit'+(i-1):'line'+i);
 });return nodes;
}
export function linkLevels(links:InternalLink[]){
 const levels=new Map<string,number>();
 const sorted=[...links].sort((a,b)=>a.segments.reduce((n,s)=>n+s.end-s.start,0)-b.segments.reduce((n,s)=>n+s.end-s.start,0)||a.id.localeCompare(b.id));
 sorted.forEach((link,i)=>{let level=0;for(const earlier of sorted.slice(0,i)){if(link.segments.some(a=>earlier.segments.some(b=>a.node===b.node&&a.start<b.end&&b.start<a.end)))level=Math.max(level,levels.get(earlier.id)!+1);}levels.set(link.id,level);});return levels;
}
