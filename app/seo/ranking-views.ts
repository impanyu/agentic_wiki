import {blockWorkflow} from '@/app/workflows/component-block';
import {normalizeCriteria,toEntries,rankEntries,makeFormatter,type Criterion} from '@/app/workflows/viz/ranking-data';
import {columnOption,chartKey} from '@/app/workflows/viz/ranking-chart';
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
// {chartKey → SVG} for the bar chart each ranking shows first (Top N of the criterion in view).
export async function rankingChartSvgs(blocks:RankingBlock[],preloaded:Record<string,Record<string,unknown>>,rank:string|undefined,locale:string):Promise<Record<string,string>>{
 const out:Record<string,string>={};
 for(const b of blocks){
  if(b.props.chart==='none'||b.props.chart==='map')continue;
  const state=preloaded[b.code];if(!state)continue;
  try{
   const {criterion:c,ranked}=rankedView(b,state,rank);
   const top=typeof b.props.top==='number'&&b.props.top>=1?Math.floor(b.props.top):20;
   const height=typeof b.props.height==='number'&&b.props.height>=200?Math.min(b.props.height,1200):420;
   const shown=ranked.slice(0,top);if(!shown.length)continue;
   const values=ranked.map(e=>e.value!);
   const fmt=makeFormatter(c,values,locale),axisFmt=makeFormatter(c,values,locale,{unit:false,compact:true});
   const option={...columnOption({shown,c,fmt,axisFmt,noData:'—'}),animation:false};
   const echarts=await loadECharts();
   const h=Math.min(height,380);
   const chart=echarts.init(null as unknown as HTMLElement,undefined,{renderer:'svg',ssr:true,width:WIDTH,height:h});
   try{chart.setOption(option as never);
    // Scales with its box: a viewBox instead of fixed pixels.
    const svg=chart.renderToSVGString().replace(/^<svg([^>]*?) width="(\d+)" height="(\d+)"/,(_m,a,w,hh)=>`<svg${a}${/viewBox=/.test(a)?'':` viewBox="0 0 ${w} ${hh}"`} preserveAspectRatio="xMidYMid meet"`);
    out[chartKey(b.criteria.map(x=>x.key),c.key)]=/viewBox=[^>]*viewBox=/.test(svg.slice(0,600))?svg.replace(/ viewBox="[^"]*"/,''):svg;
   }finally{chart.dispose();}
  }catch(e){console.warn('seo: chart svg failed',(e as Error).message);}
 }
 return out;
}
