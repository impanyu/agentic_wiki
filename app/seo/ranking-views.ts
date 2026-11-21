import {blockWorkflow} from '@/app/workflows/component-block';
import {normalizeCriteria,toEntries,rankEntries,makeFormatter,summarize,groupsOf,type Criterion} from '@/app/workflows/viz/ranking-data';
import {viewOption,autoViews,pickViews,chartKey,VIEW_HEIGHT,type RankingViewKind} from '@/app/workflows/viz/ranking-chart';
import {geoKind,geoKeyOf,registerGeo,pointOf,geoAspect,setGeoFetcher} from '@/app/workflows/viz/ranking-geo';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
// On the server, map geometry (public/geo/…) is read from disk.
setGeoFetcher(async path=>JSON.parse(await readFile(join(process.cwd(),'public',path.replace(/^\/+/,'')),'utf8')));
// The rankings on a page as the server sees them: their criteria (for ?rank= views, titles and the
// sitemap) and their rows (from the preloaded block state), and the bar chart of a view rendered to
// SVG with ECharts' server-side renderer — the same option the browser draws on its canvas.
type Node={type?:string;props?:Record<string,unknown>;children?:unknown};
function findRanking(n:unknown):Node|null{
 if(Array.isArray(n)){for(const c of n){const f=findRanking(c);if(f)return f;}return null;}
 if(!n||typeof n!=='object')return null;const node=n as Node;if(node.type==='ranking')return node;
 for(const v of Object.values(node))if(v&&typeof v==='object'&&v!==node){const f=findRanking(v);if(f)return f;}
 return null;
}
export type RankingBlock={code:string;props:Record<string,unknown>;criteria:Criterion[];defaultKey:string;rowsKey:string};
export function rankingBlocks(body:string):RankingBlock[]{
 const out:RankingBlock[]=[];
 for(const m of String(body||'').matchAll(/```component\n([\s\S]*?)\n```/g)){
  try{
   const node=findRanking(blockWorkflow(JSON.parse(m[1])).ui);if(!node?.props)continue;
   const p=node.props,criteria=normalizeCriteria(p.criteria);if(!criteria.length)continue;
   const src=p.rows,rowsKey=src&&typeof src==='object'&&'$' in src?String((src as {$:string}).$).replace(/^state\./,''):'rows';
   out.push({code:m[1],props:p,criteria,defaultKey:(typeof p.default==='string'&&criteria.some(c=>c.key===p.default)?p.default:criteria[0].key),rowsKey});
  }catch{}
 }
 return out;
}
// The criterion a ?rank= value names on this page, or null.
export function rankCriterion(blocks:RankingBlock[],rank:string|undefined):Criterion|null{
 if(!rank)return null;for(const b of blocks){const c=b.criteria.find(x=>x.key===rank);if(c)return c;}return null;
}
export function blockRows(b:RankingBlock,state:Record<string,unknown>|undefined){
 const rows=state?.[b.rowsKey];return Array.isArray(rows)?rows:[];
}
export function rankedView(b:RankingBlock,state:Record<string,unknown>|undefined,rank?:string){
 const c=b.criteria.find(x=>x.key===rank)??b.criteria.find(x=>x.key===b.defaultKey)!;
 const nameKey=typeof b.props.nameKey==='string'&&b.props.nameKey?b.props.nameKey:'name';
 const groupKey=typeof b.props.groupKey==='string'&&b.props.groupKey?b.props.groupKey:undefined;
 return {criterion:c,...rankEntries(toEntries(blockRows(b,state),nameKey,groupKey),c.key,c.order)};
}

type ECharts=typeof import('echarts');
let echartsP:Promise<ECharts>|null=null;
const loadECharts=()=>echartsP??=import('echarts').then(m=>((m as unknown as {default?:ECharts}).default??m) as ECharts);
const WIDTH=960;
const nameKeyOf=(b:RankingBlock)=>typeof b.props.nameKey==='string'&&b.props.nameKey?b.props.nameKey:'name';
const groupKeyOf=(b:RankingBlock)=>typeof b.props.groupKey==='string'&&b.props.groupKey?b.props.groupKey:undefined;
// The views the ranking component shows, in the same order (same rules), so the server draws the first one.
export function blockViews(b:RankingBlock,state:Record<string,unknown>|undefined,rank?:string):RankingViewKind[]{
 if(b.props.chart==='none')return [];
 const {criterion:c,ranked,missing}=rankedView(b,state,rank);
 const summary=summarize(ranked,missing,c);
 const entries=toEntries(blockRows(b,state),nameKeyOf(b),groupKeyOf(b));
 const v=pickViews(b.props.views,autoViews({additive:summary.aggregate==='sum'&&summary.min>=0&&ranked.length>1,geo:geoKind(entries,b.props.geo),criteria:b.criteria.length,groups:groupsOf(entries).length,count:ranked.length}));
 return b.props.chart==='map'&&v.includes('map')?['map',...v.filter(x=>x!=='map')]:v;
}
// {chartKey|view → SVG} for the view each ranking shows first (the criterion in view; 3D maps only in the browser).
export async function rankingChartSvgs(blocks:RankingBlock[],preloaded:Record<string,Record<string,unknown>>,rank:string|undefined,locale:string):Promise<Record<string,string>>{
 const out:Record<string,string>={};
 for(const b of blocks){
  const state=preloaded[b.code];if(!state)continue;
  const first=blockViews(b,state,rank)[0];if(!first||first==='map3d')continue;
  try{
   const {criterion:c,ranked,missing}=rankedView(b,state,rank);if(!ranked.length)continue;
   const entries=toEntries(blockRows(b,state),nameKeyOf(b),groupKeyOf(b));
   const top=typeof b.props.top==='number'&&b.props.top>=1?Math.floor(b.props.top):20;
   const height=typeof b.props.height==='number'&&b.props.height>=200?Math.min(b.props.height,1200):420;
   const values=ranked.map(e=>e.value!);
   const fmt=makeFormatter(c,values,locale),axisFmt=makeFormatter(c,values,locale,{unit:false,compact:true});
   const echarts=await loadECharts();
   const kind=first==='map'?geoKind(entries,b.props.geo):null;
   const g=kind?await registerGeo(echarts as never,kind):null;
   const option=viewOption({view:first,c,criteria:b.criteria,entries,ranked,missing,fmt,axisFmt,locale,top,other:b.criteria.find(x=>x.key!==c.key),
    geo:kind&&g?{kind,map:g.name,names:g.names,keyOf:geoKeyOf(kind,g),pointOf:e=>pointOf(e.row),aspectScale:g.aspectScale}:null,
    labels:{others:'Others',noData:'—',topHold:(k,pct)=>`Top ${k} hold ${pct}`,entities:'Entities by rank',count:'count',median:'Median'}});
   if(!option)continue;
   const h=first==='bar'?Math.min(height,380):first==='map'&&kind?Math.round(WIDTH/geoAspect(kind,g))+MAP_EXTRA:VIEW_HEIGHT[first]??420;
   const chart=echarts.init(null as unknown as HTMLElement,undefined,{renderer:'svg',ssr:true,width:WIDTH,height:h});
   try{chart.setOption({...option,animation:false} as never);
    // Scales with its box: a viewBox instead of fixed pixels.
    out[chartKey(b.criteria.map(x=>x.key),c.key)+'|'+first]=chart.renderToSVGString().replace(/^<svg([^>]*?) width="(\d+)" height="(\d+)"/,(_m,a,ww,hh)=>`<svg${a}${/viewBox=/.test(a)?'':` viewBox="0 0 ${ww} ${hh}"`} preserveAspectRatio="xMidYMid meet"`);
   }finally{chart.dispose();}
  }catch(e){console.warn('seo: chart svg failed',(e as Error).message);}
 }
 return out;
}
const MAP_EXTRA=50;
