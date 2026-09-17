export const pageSizes=[25,50,100] as const;
export function paginateItems<T>(items:T[],requestedPage:number,requestedSize:number){
 const pageSize=pageSizes.includes(requestedSize as typeof pageSizes[number])?requestedSize:50;
 const total=items.length,pageCount=Math.max(1,Math.ceil(total/pageSize));
 const pageIndex=Math.max(0,Math.min(pageCount-1,Number.isFinite(requestedPage)?Math.floor(requestedPage):0));
 const offset=pageIndex*pageSize;
 return {items:items.slice(offset,offset+pageSize),pageIndex,pageCount,pageSize,total,start:total?offset+1:0,end:Math.min(offset+pageSize,total)};
}
