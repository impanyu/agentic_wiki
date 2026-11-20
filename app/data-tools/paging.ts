// Pure pagination loop (no imports): fetch a page, take its rows, ask for the next URL; stop at the
// page limit, when the next URL is empty or already seen, or when a page adds no rows.
export type PageResult={rows:Record<string,unknown>[];raw:unknown;url:string};
export async function paginate(first:string,maxPages:number,fetchPage:(url:string,index:number)=>Promise<PageResult>,nextUrl:(page:PageResult,index:number)=>Promise<string|null>,maxRows=100_000){
 const rows:Record<string,unknown>[]=[],seen=new Set<string>(),pages:{url:string;rows:number}[]=[];
 let url:string|null=first,stop='last page reached';
 for(let i=0;url;i++){
  if(i>=Math.max(1,maxPages)){stop='page limit ('+maxPages+') reached; more pages may exist';break;}
  if(seen.has(url)){stop='next page repeated an earlier URL';break;}
  seen.add(url);
  const page=await fetchPage(url,i);pages.push({url:page.url,rows:page.rows.length});
  if(i>0&&!page.rows.length){stop='a page returned no rows';break;}
  rows.push(...page.rows);
  if(rows.length>=maxRows){rows.length=maxRows;stop='row limit ('+maxRows+') reached';break;}
  const next=await nextUrl(page,i);url=typeof next==='string'&&next.trim()?next.trim():null;
 }
 return {rows,pages,stop};
}
export function setParam(url:string,name:string,value:unknown){const u=new URL(url);u.searchParams.set(String(name),String(value));return u.href;}
