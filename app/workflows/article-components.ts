import {COMPONENTS} from './catalog';
import {BLOCK_EXCLUDED} from './component-block';
import {CLIENT_TOOLS} from './validate';
import {TOOLS} from './tools';
// What agents read to embed platform components in a wiki article (read_generation_contract kind "components").
const mortgage={title:'Mortgage calculator',state:{},ui:[
 {type:'row',children:[
  {id:'amount',type:'number_input',props:{label:'Loan amount',default:1000000,step:10000,unit:'¥'}},
  {id:'rate',type:'slider',props:{label:'Annual rate',default:3.6,min:1,max:8,step:0.05,unit:'%'}},
  {id:'years',type:'segmented',props:{options:[10,20,30],default:30}}]},
 {type:'stats',props:{items:{$:"( $r:=values.rate/100/12; $n:=values.years*12; $m:=values.amount*$r/(1-$power(1+$r,-$n)); [{'label':'Monthly payment','value':$round($m,2),'format':'number'},{'label':'Total interest','value':$round($m*$n-values.amount,2),'format':'number'}] )"}}},
 {type:'echart',props:{height:320,option:{$:"( $r:=values.rate/100/12; $n:=values.years*12; $m:=values.amount*$r/(1-$power(1+$r,-$n)); $bal:=function($k){values.amount*$power(1+$r,$k*12)-$m*($power(1+$r,$k*12)-1)/$r}; {'tooltip':{'trigger':'axis'},'legend':{},'xAxis':{'type':'category','data':[1..values.years]},'yAxis':{'type':'value'},'series':[{'name':'Remaining balance','type':'line','smooth':true,'areaStyle':{},'data':[1..values.years].$round($bal($),0)}]} )"}}}]};
const echartExample={ui:[{type:'echart',props:{title:'Energy mix 2024',height:360,option:{tooltip:{trigger:'item'},legend:{bottom:0},series:[{type:'pie',radius:['45%','72%'],itemStyle:{borderRadius:8,borderColor:'#fff',borderWidth:2},label:{formatter:'{b}\n{d}%'},data:[{name:'Solar',value:31},{name:'Wind',value:24},{name:'Hydro',value:18},{name:'Gas',value:27}]}]}}}]};
const fileData={state:{rows:[]},actions:{load:{steps:[{id:'read',tool:'page_file.read',args:{name:'stations.csv'}}],set:{rows:{$:'steps.read'}}}},ui:[{type:'echart',props:{height:340,option:{$:"{'dataset':{'source':state.rows},'tooltip':{'trigger':'axis'},'xAxis':{'type':'time'},'yAxis':{'type':'value','name':'°C'},'dataZoom':[{'type':'inside'},{}],'series':[{'type':'line','encode':{'x':'date','y':'temperature'},'showSymbol':false}]}"}}},{type:'table',props:{rows:{$:'state.rows'},searchable:true,pageSize:10}}]};
export function articleComponentsContract(){
 const components=Object.entries(COMPONENTS).filter(([name])=>!BLOCK_EXCLUDED.has(name)).map(([name,c])=>({name,description:c.description,props:c.props,...(c.value?{value:c.value}:{}),...(c.events?{events:c.events}:{}),...(c.children?{children:c.childType||true}:{})}));
 return {
  format:'Embed components in the article body as a fenced block on its own lines: ```component, then one JSON object {title?, state?, ui:[nodes], actions?}, then ```. A node is {id?, type, props?, children?, on?, visible?}. Place each block where it explains the text around it; the prose, citations and images stay Markdown.',
  bindings:'Any prop can be {"$":"<JSONata expression>"} over {state, values, page}: values.<id> is the current value of an input with that id, so charts and numbers recompute instantly as readers move sliders or pick options (give inputs an id and a default). Use $power, $round, $sum, $map, ranges [1..n] and function definitions for real calculations.',
  actions:'Optional actions run only in the reader’s browser: an action named "load" runs when the article opens (e.g. read a Page file); others run from component events (on:{change:"name"}). Steps may use only these tools: '+[...CLIENT_TOOLS].map(t=>t+' — '+TOOLS[t]?.description).join(' | ')+'. There is no server, network or connector access at reading time: put connector or web data into the block (state) or into a Page file when you write the article.',
  choose:'Pick the component that shows the subject best and make it beautiful: echart for nearly every chart (pie/donut/rose, stacked or horizontal bars, area, bubble, radar, heatmap and calendar, treemap and sunburst, sankey, funnel, gauge, boxplot, candlestick, graph networks, parallel; 3D bars, scatter and surfaces) — use dataset/encode for tabular data, dataZoom for long series, visualMap for heat colors; scene3d for point clouds, terrain and 3D functions; diagram (Mermaid) for processes, timelines and relationships; math for formulas; media for audio, video and live HLS streams; carousel/compare/gallery for images; table/stats/key_value/timeline/steps for facts; inputs + bindings for calculators and what-if explorers; tabs to show several views. Use real, sourced numbers and cite them in the text.',
  limits:'At most 60 nodes per block; no functions or HTML in props (ECharts formatters are string templates like "{b}: {c}"); images and media must be https or Page file URLs.',
  components,
  examples:[{purpose:'interactive calculator',block:mortgage},{purpose:'polished chart',block:echartExample},{purpose:'chart from a Page file',block:fileData}],
 };
}
