// Infrastructure-layer UI components for workflow apps. Agents compose these by
// name; the site renders them with its own React code (app/workflows/components.tsx).
// Each entry documents its props, the value it exposes as values.<id>, its events
// and whether it takes child nodes. This list is the contract shown to agents.
export type ComponentSpec={category:string;description:string;props:Record<string,string>;value?:string;events?:string[];children?:boolean;childType?:string};
const tone='info | success | warning | danger | neutral';
const format='text | number | integer | percent | currency | date | datetime | bytes | duration | link | badge | image | boolean';
export const COMPONENTS:Record<string,ComponentSpec>={
 // Layout
 section:{category:'layout',description:'A titled block of the page; may collapse.',props:{title:'heading text',description:'subtitle',collapsible:'boolean',collapsed:'boolean (initially closed)'},children:true},
 card:{category:'layout',description:'A bordered card with optional header, image and footer.',props:{title:'string',subtitle:'string',image:'same-site image URL',footer:'string',tone,padding:'compact | normal | spacious'},children:true},
 row:{category:'layout',description:'Children side by side; wraps on narrow screens.',props:{gap:'small | medium | large',align:'start | center | end | stretch',justify:'start | center | end | between'},children:true},
 grid:{category:'layout',description:'A responsive grid of children.',props:{columns:'1–6 on wide screens',minWidth:'minimum column width in px',gap:'small | medium | large'},children:true},
 tabs:{category:'layout',description:'Tabbed panels; each child is a tab node.',props:{default:'index of the initially open tab'},value:'index of the open tab',events:['change'],children:true,childType:'tab'},
 tab:{category:'layout',description:'One panel of tabs.',props:{label:'tab label',badge:'small count or label'},children:true},
 split:{category:'layout',description:'Two-pane layout: first child is a sidebar, the rest the main area.',props:{sidebarWidth:'px, default 280'},children:true},
 details:{category:'layout',description:'Disclosure (accordion item) with a summary line.',props:{summary:'string',open:'boolean'},children:true},
 divider:{category:'layout',description:'A horizontal rule with optional label.',props:{label:'string'}},
 spacer:{category:'layout',description:'Vertical space.',props:{size:'small | medium | large'}},
 // Content
 heading:{category:'content',description:'A heading.',props:{text:'string',level:'1–4',subtitle:'string'}},
 text:{category:'content',description:'Markdown text (tables, lists, links). Images must be same-site URLs.',props:{markdown:'string',size:'small | normal | large',muted:'boolean'}},
 callout:{category:'content',description:'Highlighted notice.',props:{tone,title:'string',text:'markdown'}},
 badge:{category:'content',description:'Small status label.',props:{text:'string',tone}},
 stat:{category:'content',description:'One key metric.',props:{label:'string',value:'number or string',unit:'string',format,delta:'change vs previous (number)',deltaFormat:'number | percent',trend:'up | down | flat',hint:'small caption',spark:'array of numbers for a sparkline',tone}},
 stats:{category:'content',description:'A row of metric cards.',props:{items:'[{label,value,unit,format,delta,trend,hint,spark,tone}]'}},
 key_value:{category:'content',description:'Label/value pairs.',props:{items:'[{label,value,format}]',columns:'1–3'}},
 progress_bar:{category:'content',description:'Determinate progress.',props:{value:'0–100',label:'string',tone}},
 gauge:{category:'content',description:'Semicircle gauge.',props:{value:'number',min:'number',max:'number',label:'string',unit:'string',thresholds:'[{value,tone}] ascending'}},
 timeline:{category:'content',description:'Vertical timeline of events.',props:{items:'[{time,title,text,tone}]'}},
 steps:{category:'content',description:'Process steps with status.',props:{items:'[{title,text,status: done|active|pending|error}]'}},
 image:{category:'content',description:'An image from Page files or this site.',props:{src:'same-site URL (e.g. a Page file url)',alt:'string',caption:'string',fit:'contain | cover',height:'px'}},
 gallery:{category:'content',description:'Grid of images; click to enlarge.',props:{items:'[{src,caption}] same-site URLs',columns:'2–6'},value:'clicked item',events:['select']},
 video:{category:'content',description:'Video or audio from Page files.',props:{src:'same-site URL',caption:'string',kind:'video | audio'}},
 pdf:{category:'content',description:'Inline PDF viewer for a Page file.',props:{src:'same-site PDF URL',height:'px'}},
 code:{category:'content',description:'Monospaced code or log text.',props:{text:'string',language:'string',wrap:'boolean',maxHeight:'px'}},
 json:{category:'content',description:'Collapsible JSON tree.',props:{data:'any',expanded:'depth to expand (default 1)'}},
 empty:{category:'content',description:'Friendly empty state.',props:{title:'string',text:'string',icon:'search | file | folder | chart | map | inbox'}},
 link:{category:'content',description:'A link. Computed links must point to this site; external links must be literal text.',props:{text:'string',href:'URL',button:'boolean (render as a button)'}},
 // Data
 table:{category:'data',description:'Data table with sorting, search, pagination, CSV download and row selection.',props:{rows:'array of objects',columns:`[{key,label,format: ${format},align,width}] (default: keys of the first row)`,searchable:'boolean',pageSize:'rows per page (default 25)',selectable:'none | single | multi',download:'CSV file name to offer a download',dense:'boolean',empty:'text when no rows'},value:'selected row (single) or rows (multi)',events:['select']},
 list:{category:'data',description:'List of rich items (title, subtitle, badge, image, meta).',props:{items:'[{id,title,subtitle,description,badge,badgeTone,image,meta}]',selectable:'boolean',layout:'list | cards'},value:'selected item',events:['select']},
 tree:{category:'data',description:'Expandable hierarchy (folders, categories).',props:{nodes:'[{id,label,children:[...],badge}]',expanded:'depth to expand'},value:'selected node',events:['select']},
 chart:{category:'data',description:'Line, bar, area, scatter, pie or combined chart.',props:{kind:'line | bar | area | scatter | pie | donut | composed',data:'array of objects',x:'key for the x axis (or the label key for pie)',series:'[{key,label,type: line|bar|area (composed), axis: left|right, color}]',stacked:'boolean',horizontal:'boolean (bar)',xLabel:'string',yLabel:'string',rightLabel:'string',unit:'string',rightUnit:'string',height:'px (default 320)',legend:'boolean'},value:'clicked data point',events:['select']},
 heatmap:{category:'data',description:'Matrix of colored cells.',props:{data:'array of objects',x:'column key',y:'row key',value:'value key',format,scheme:'blue | green | red | diverging'},value:'clicked cell',events:['select']},
 kanban:{category:'data',description:'Board of columns with cards (read-only).',props:{columns:'[{title,tone,items:[{title,text,badge}]}]'}},
 calendar:{category:'data',description:'Month view with events on days.',props:{events:'[{date: YYYY-MM-DD,title,tone}]',month:'YYYY-MM (default: month of the first event)'},value:'clicked date',events:['select']},
 map:{category:'data',description:'Interactive map of points and GeoJSON layers.',props:{points:'[{lat,lng,label,popup,color}]',geojson:'GeoJSON FeatureCollection',title:'layer title',basemap:'streets-vector | satellite | hybrid | topo-vector | osm',height:'px (default 420)'}},
 // Inputs (each exposes values.<id>; give inputs an id)
 text_input:{category:'input',description:'Single or multi-line text.',props:{label:'string',placeholder:'string',default:'string',multiline:'boolean',required:'boolean'},value:'string',events:['change','submit']},
 number_input:{category:'input',description:'Number field.',props:{label:'string',default:'number',min:'number',max:'number',step:'number',unit:'string'},value:'number',events:['change']},
 slider:{category:'input',description:'Range slider.',props:{label:'string',default:'number',min:'number',max:'number',step:'number',unit:'string'},value:'number',events:['change']},
 select:{category:'input',description:'Dropdown; multiple for several choices.',props:{label:'string',options:'[{value,label}] or [strings]',default:'value or [values]',multiple:'boolean',placeholder:'string'},value:'chosen value(s)',events:['change']},
 radio:{category:'input',description:'One choice among few options.',props:{label:'string',options:'[{value,label}] or [strings]',default:'value',inline:'boolean'},value:'chosen value',events:['change']},
 segmented:{category:'input',description:'Compact toggle between options.',props:{options:'[{value,label}] or [strings]',default:'value'},value:'chosen value',events:['change']},
 checkbox:{category:'input',description:'Checkbox or switch.',props:{label:'string',default:'boolean',switch:'boolean'},value:'boolean',events:['change']},
 date:{category:'input',description:'Date picker.',props:{label:'string',default:'YYYY-MM-DD',min:'YYYY-MM-DD',max:'YYYY-MM-DD'},value:'YYYY-MM-DD',events:['change']},
 date_range:{category:'input',description:'Start and end dates.',props:{label:'string',default:'{start,end}',min:'YYYY-MM-DD',max:'YYYY-MM-DD'},value:'{start,end}',events:['change']},
 search:{category:'input',description:'Search box; submit on Enter.',props:{placeholder:'string',default:'string'},value:'string',events:['change','submit']},
 form:{category:'input',description:'Groups input children with a submit button.',props:{submitLabel:'string',resetLabel:'string (optional)'},value:'object of child input values by id',events:['submit'],children:true},
 button:{category:'input',description:'Runs an action on click.',props:{label:'string',tone:'primary | secondary | danger | ghost',icon:'refresh | play | download | upload | send | plus | trash | search | map | check',disabled:'boolean',confirm:'question asked before running'},events:['click']},
 file_upload:{category:'input',description:'User picks local files or a folder; they are saved to Page files.',props:{label:'string',multiple:'boolean',folders:'boolean (allow choosing a folder)',accept:'e.g. .csv,.zip',folderPath:'Page files folder'},value:'[{space:"page",id,kind:"file",name,url,size}] uploaded files as resources',events:['change']},
 resource_picker:{category:'input',description:'User chooses files or folders from Page files or connected drives (Google Drive, Dropbox, OneDrive, ADMA, HCC, ADAPT).',props:{label:'string',multiple:'boolean',kind:'file | folder | any'},value:'[resource objects for resources.* and files.zip]',events:['change']},
 download:{category:'input',description:'Download button for a Page file or generated text.',props:{label:'string',href:'same-site file URL',text:'text content to download instead of href',filename:'string'}},
 copy:{category:'input',description:'Copies text to the clipboard.',props:{label:'string',text:'string'}},
 // Feedback
 status:{category:'feedback',description:'Shows whether an action is running, finished or failed.',props:{action:'action name',idle:'text before the first run',running:'text while running'}},
 log:{category:'feedback',description:'Step-by-step trace of the last run of an action.',props:{action:'action name'}},
};
export const INPUT_TYPES=new Set(Object.entries(COMPONENTS).filter(([,c])=>c.category==='input'&&c.value).map(([k])=>k).concat(['tabs','table','list','tree','chart','heatmap','calendar','gallery']));
export function componentGuide(){return Object.entries(COMPONENTS).map(([name,c])=>({name,...c}));}
