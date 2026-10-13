import type {Workflow} from './schema';
// A component gallery with sample state, rendered at /workflow-preview?demo=1 in
// development only, to check the component library visually.
const days=Array.from({length:14},(_,i)=>({date:'2026-09-'+String(i+10).padStart(2,'0'),temp:14+Math.round(8*Math.sin(i/2)),wind:3+(i*7)%9,rain:(i*13)%5}));
export const demoWorkflow:Workflow={kind:'workflow-app',version:1,title:'Component gallery',actions:{pickOmaha:{client:true,steps:[],set:{station:'Omaha'}},load:{client:true,steps:[],set:{loadedAt:'loaded'}}},layout:{maxWidth:1200,accent:'#0f766e'},
 state:{station:null,loadedAt:'not loaded',days,files:[{name:'yield_2026.csv',size:182344,modified:'2026-10-01',space:'Page files'},{name:'fields.geojson',size:4829350,modified:'2026-09-23',space:'ADMA'},{name:'soil.tif',size:112429,modified:'2026-09-26',space:'Google Drive'}],
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
  {type:'list',props:{layout:'cards',selectable:true,items:[{title:'Yield summary',subtitle:'ADMA tool',badge:'ready',badgeTone:'success',description:'Summarize yield by field'},{title:'Seeding tool',subtitle:'ADMA tool',badge:'beta',badgeTone:'warning'}]}},
  {type:'details',props:{summary:'Raw JSON'},children:[{type:'json',props:{data:{$:'state.files[0]'}}}]},
  {type:'empty',props:{title:'No alerts',text:'Everything is running normally.',icon:'inbox'}}]};
