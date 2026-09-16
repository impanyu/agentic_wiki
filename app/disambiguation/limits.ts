export const MAX_INDEX_PATH=3;
export type IndexNode={id:string;aliases:string[];entries:string[]};
const key=(s:string)=>s.trim().normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ');
export function checkIndexPath(nodes:IndexNode[],targetId:string){
 const aliases=new Map<string,Set<string>>(),edges=new Map<string,Set<string>>(),reverse=new Map<string,Set<string>>();
 for(const n of nodes){edges.set(n.id,new Set());reverse.set(n.id,new Set());for(const a of n.aliases){const k=key(a);if(!aliases.has(k))aliases.set(k,new Set());aliases.get(k)!.add(n.id);}}
 for(const n of nodes)for(const entry of n.entries)for(const to of aliases.get(key(entry))||[]){edges.get(n.id)!.add(to);reverse.get(to)!.add(n.id);}
 const length=(graph:Map<string,Set<string>>,id:string,path:Set<string>,memo:Map<string,number>):number=>{
  if(path.has(id))throw Error('INDEX_CYCLE: index pages must not link back to themselves or an ancestor.');
  if(path.size>=MAX_INDEX_PATH)throw Error('INDEX_DEPTH_LIMIT: at most '+MAX_INDEX_PATH+' consecutive index pages are allowed.');
  if(memo.has(id))return memo.get(id)!;
  const next=new Set(path).add(id);let longest=1;
  for(const to of graph.get(id)||[])longest=Math.max(longest,1+length(graph,to,next,memo));
  memo.set(id,longest);return longest;
 };
 const depth=length(edges,targetId,new Set(),new Map())+length(reverse,targetId,new Set(),new Map())-1;
 if(depth>MAX_INDEX_PATH)throw Error('INDEX_DEPTH_LIMIT: at most '+MAX_INDEX_PATH+' consecutive index pages are allowed. Produce a substantive page with clearly distinguished meanings or narrow the destinations; do not silently select one meaning.');
 return depth;
}
