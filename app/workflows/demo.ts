import type {Workflow} from './schema';
// A component gallery with sample state, rendered at /workflow-preview?demo=1 in
// development only, to check the component library visually.
const days=Array.from({length:14},(_,i)=>({date:'2026-09-'+String(i+10).padStart(2,'0'),temp:14+Math.round(8*Math.sin(i/2)),wind:3+(i*7)%9,rain:(i*13)%5}));
export const demoWorkflow:Workflow={kind:'workflow-app',version:1,title:'Component gallery',actions:{pickOmaha:{client:true,steps:[],set:{station:'Omaha'}},load:{client:true,steps:[],set:{loadedAt:'loaded'}}},layout:{maxWidth:1200,accent:'#0f766e'},
 state:{station:null,loadedAt:'not loaded',days,files:[{name:'yield_2026.csv',size:182344,modified:'2026-10-01',space:'Page files'},{name:'fields.geojson',size:4829350,modified:'2026-09-23',space:'Dropbox'},{name:'soil.tif',size:112429,modified:'2026-09-26',space:'Google Drive'}],
  stations:[{lat:40.82,lng:-96.70,label:'Lincoln'},{lat:41.26,lng:-95.94,label:'Omaha'},{lat:40.92,lng:-98.34,label:'Grand Island'}]},
 ui:[{id:'loadFlag',type:'badge',props:{text:{$:'state.loadedAt'},tone:'info'}},
  {type:'heading',props:{text:'Field station overview',subtitle:'Sample data — every component in one page'}},
  {type:'stats',props:{items:{$:"[{'label':'Average temperature','value':$round($average(state.days.temp),1),'unit':'°C','delta':1.2,'spark':state.days.temp,'tone':'info'},{'label':'Max wind','value':$max(state.days.wind),'unit':'m/s','delta':-0.8,'spark':state.days.wind,'tone':'warning'},{'label':'Rain days','value':$count(state.days[rain>0]),'tone':'success'},{'label':'Files','value':$count(state.files),'format':'integer','tone':'neutral'}]"}}},
  {type:'grid',props:{columns:2},children:[
   {type:'card',props:{title:'Temperature and wind',subtitle:'Daily, two axes'},children:[{type:'chart',props:{kind:'composed',data:{$:'state.days'},x:'date',series:[{key:'temp',label:'Temperature',type:'area'},{key:'wind',label:'Wind',type:'line',axis:'right'}],unit:'°C',rightUnit:'m/s',height:260}}]},
   {type:'card',props:{title:'Storage by source'},children:[{type:'chart',props:{kind:'donut',data:{$:"state.files.{'source':space,'size':size}"},x:'source',series:[{key:'size'}],height:260}}]}]},
  {type:'tabs',children:[
   {type:'tab',props:{label:'Files',badge:{$:'$count(state.files)'}},children:[{id:'files',type:'table',props:{rows:{$:'state.files'},columns:[{key:'name',label:'Name'},{key:'space',label:'Source',format:'badge'},{key:'size',label:'Size',format:'bytes'},{key:'modified',label:'Modified',format:'date'}],searchable:true,selectable:'single',download:'files'}}]},
   {type:'tab',props:{label:'Map'},children:[{type:'map',props:{points:{$:'state.stations'},title:'Stations',height:320}}]},
   {type:'tab',props:{label:'Calendar'},children:[{type:'calendar',props:{events:{$:"state.days[rain>2].{'date':date,'title':rain & ' mm','tone':'info'}"}}}]},
   {type:'tab',props:{label:'Heatmap'},children:[{type:'heatmap',props:{data:{$:"state.days.{'day':$substring(date,8),'metric':'wind','v':wind}"},x:'day',y:'metric',value:'v',scheme:'green'}}]}]},
  {type:'split',children:[
   {type:'form',props:{submitLabel:'Run report'},children:[{id:'station',type:'select',props:{label:'Station',options:['Lincoln','Omaha','Grand Island'],default:'Lincoln',value:{$:'state.station'}}},{type:'button',props:{label:'Pick Omaha',tone:'secondary'},on:{click:'pickOmaha'}},{id:'range',type:'date_range',props:{label:'Dates',default:{start:'2026-09-10',end:'2026-09-23'}}},{id:'smooth',type:'slider',props:{label:'Smoothing',min:0,max:10,default:3}},{id:'alerts',type:'checkbox',props:{label:'Email alerts',switch:true}},{id:'mode',type:'segmented',props:{options:['Daily','Weekly'],default:'Daily'}}]},
   {type:'section',props:{title:'Status'},children:[
    {type:'steps',props:{items:[{title:'Fetch observations',status:'done'},{title:'Aggregate',status:'active',text:'Grouping by day'},{title:'Publish',status:'pending'}]}},
    {type:'progress_bar',props:{value:62,label:'Processing'}},
    {type:'row',children:[{type:'gauge',props:{value:72,label:'Soil moisture',unit:'%',thresholds:[{value:0,tone:'danger'},{value:40,tone:'warning'},{value:60,tone:'success'}]}},{type:'key_value',props:{items:[{label:'Last sync',value:'2026-10-07T14:47:00Z',format:'datetime'},{label:'Records',value:18234,format:'integer'},{label:'Coverage',value:0.934,format:'percent'}]}}]},
    {type:'callout',props:{tone:'warning',title:'Station offline',text:'Grand Island has not reported for **6 hours**.'}}]}]},
  {type:'row',children:[{type:'kanban',props:{columns:[{title:'To do',tone:'neutral',items:[{title:'Calibrate sensor',badge:'Lincoln'}]},{title:'Doing',tone:'info',items:[{title:'Clean dataset',text:'Remove duplicates'}]},{title:'Done',tone:'success',items:[{title:'Upload yield maps'}]}]}}]},
  {type:'timeline',props:{items:[{time:'Oct 7',title:'Harvest data uploaded',tone:'success'},{time:'Oct 5',title:'Station maintenance',text:'Omaha anemometer replaced',tone:'warning'}]}},
  {type:'list',props:{layout:'cards',selectable:true,items:[{title:'Yield summary',subtitle:'Analysis tool',badge:'ready',badgeTone:'success',description:'Summarize yield by field'},{title:'Seeding tool',subtitle:'Analysis tool',badge:'beta',badgeTone:'warning'}]}},
  {type:'details',props:{summary:'Raw JSON'},children:[{type:'json',props:{data:{$:'state.files[0]'}}}]},
  {type:'empty',props:{title:'No alerts',text:'Everything is running normally.',icon:'inbox'}}]};
// The rich visualization and media components with sample data (/workflow-preview?demo=viz).
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const wave=Array.from({length:24},(_,i)=>Array.from({length:24},(_,j)=>Math.round((Math.sin(i/4)*Math.cos(j/4)*3+Math.sin((i+j)/6))*100)/100));
const surfaceData=Array.from({length:41*41},(_,k)=>{const x=-4+(k%41)*.2,y=-4+Math.floor(k/41)*.2;return [Math.round(x*10)/10,Math.round(y*10)/10,Math.round(Math.sin(x)*Math.cos(y)*3*100)/100];});
export const vizDemoWorkflow:Workflow={kind:'workflow-app',version:1,title:'Visualization gallery',state:{},actions:{},layout:{maxWidth:1100},ui:[
 {type:'heading',props:{text:'Visualization gallery',subtitle:'ECharts, Three.js, Mermaid, KaTeX, media and images'}},
 {type:'grid',props:{columns:2,minWidth:420},children:[
  {type:'echart',props:{title:'Revenue by channel',height:340,option:{tooltip:{trigger:'axis'},legend:{},xAxis:{type:'category',data:months},yAxis:{type:'value'},series:[{name:'Online',type:'bar',stack:'t',data:[12,14,18,22,25,31,35,33,29,26,30,38]},{name:'Retail',type:'bar',stack:'t',data:[20,19,21,20,22,24,23,25,24,22,26,30]},{name:'Trend',type:'line',smooth:true,data:[32,33,39,42,47,55,58,58,53,48,56,68]}]}}},
  {type:'echart',props:{title:'Energy mix',height:340,option:{tooltip:{trigger:'item'},legend:{bottom:0},series:[{type:'pie',radius:['42%','70%'],itemStyle:{borderRadius:8,borderColor:'#fff',borderWidth:2},label:{formatter:'{b}\n{d}%'},data:[{name:'Solar',value:31},{name:'Wind',value:24},{name:'Hydro',value:18},{name:'Gas',value:27}]}]}}},
  {type:'echart',props:{title:'Skills radar',height:340,option:{tooltip:{},legend:{bottom:0},radar:{indicator:[{name:'Speed',max:10},{name:'Accuracy',max:10},{name:'Cost',max:10},{name:'Coverage',max:10},{name:'Latency',max:10}]},series:[{type:'radar',areaStyle:{opacity:.25},data:[{name:'Model A',value:[8,7,5,9,6]},{name:'Model B',value:[6,9,7,6,8]}]}]}}},
  {type:'echart',props:{title:'Energy flows (Sankey)',height:340,option:{tooltip:{trigger:'item'},series:[{type:'sankey',emphasis:{focus:'adjacency'},lineStyle:{color:'gradient',curveness:.5},data:[{name:'Coal'},{name:'Gas'},{name:'Solar'},{name:'Power'},{name:'Homes'},{name:'Industry'}],links:[{source:'Coal',target:'Power',value:30},{source:'Gas',target:'Power',value:25},{source:'Solar',target:'Power',value:15},{source:'Power',target:'Homes',value:32},{source:'Power',target:'Industry',value:38}]}]}}},
  {type:'echart',props:{title:'Market share (treemap)',height:340,option:{tooltip:{},series:[{type:'treemap',roam:false,breadcrumb:{show:false},data:[{name:'Cloud',value:40,children:[{name:'Compute',value:22},{name:'Storage',value:18}]},{name:'Devices',value:30},{name:'Software',value:20},{name:'Services',value:10}]}]}}},
  {type:'echart',props:{title:'3D surface (ECharts GL)',height:340,option:{tooltip:{},visualMap:{show:false,dimension:2,min:-4,max:4,inRange:{color:['#313695','#4575b4','#74add1','#abd9e9','#fee090','#fdae61','#f46d43','#d73027']}},xAxis3D:{type:'value'},yAxis3D:{type:'value'},zAxis3D:{type:'value'},grid3D:{viewControl:{autoRotate:true}},series:[{type:'surface',wireframe:{show:false},data:surfaceData}]}}},
 ]},
 {type:'scene3d',props:{title:'3D terrain (Three.js)',height:420,surface:{z:wave,colormap:'terrain'},axisLabels:{x:'x',y:'y',z:'height'}}},
 {type:'grid',props:{columns:2,minWidth:420},children:[
  {type:'diagram',props:{title:'Request flow',code:'flowchart LR\n  U[User] -->|asks| R{Router}\n  R -->|saved page| P[Wiki page]\n  R -->|new| G[Generator]\n  G --> V[Verify] --> P'}},
  {type:'math',props:{tex:'M = P\\,\\frac{r(1+r)^n}{(1+r)^n-1}',label:'(1)',caption:'Monthly payment of an amortized loan'}},
 ]},
 {type:'code',props:{title:'mortgage.py',language:'python',text:'def monthly(P, rate, years):\n    r, n = rate / 12, years * 12\n    return P * r * (1 + r) ** n / ((1 + r) ** n - 1)\n\nprint(round(monthly(1_000_000, 0.036, 30), 2))  # 4546.45',highlight:[3]}},
 {type:'media',props:{title:'Live stream (HLS)',src:'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',poster:'https://commons.wikimedia.org/wiki/Special:FilePath/Big_buck_bunny_poster_big.jpg?width=960',chapters:[{time:0,title:'Opening'},{time:120,title:'Forest'},{time:300,title:'Chase'}]}},
 {type:'carousel',props:{height:360,items:[{src:'https://commons.wikimedia.org/wiki/Special:FilePath/Tour_Eiffel_Wikimedia_Commons.jpg?width=960',caption:'Eiffel Tower'},{src:'https://commons.wikimedia.org/wiki/Special:FilePath/Empire_State_Building_%28aerial_view%29.jpg?width=960',caption:'Empire State Building'}]}},
]};
