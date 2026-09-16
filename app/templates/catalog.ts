export const templates=[
 {id:'disambiguation-v1',name:'Disambiguation index',description:'Ambiguous words and underspecified umbrella concepts: grouped meanings and precise clickable destinations.',kind:'article',keywords:'disambiguation meanings ambiguous index umbrella senses 消歧 义项 歧义 索引'},
 {id:'wiki-v1',name:'Wiki article',description:'General knowledge and reference pages: overview, contents, organized sections, illustrations and source citations.',kind:'article',keywords:'wiki encyclopedia explain history geography knowledge 概述 百科 知识'},
 {id:'chat-v1',name:'Conversation workspace',description:'General app with a dedicated session agent: guidance, analysis, planning and multi-step tasks using authorized backend tools.',kind:'application',keywords:'chat assistant plan conversation agent help 对话 助手 计划'},
 {id:'files-v1',name:'File browser',description:'Browse actual files and folders in a hierarchy: breadcrumbs, search, sorting, list/grid views. Includes a pre-coded Google Drive app with Drive-style sidebar, cloud search, folders, list/grid, upload/download, rename, move, copy and trash actions. Includes a pre-coded ADMA app with ADMA-style folders, search, grid/list, metadata, text upload, create folder, rename, visibility and permanent deletion. Also browses page attachments.',kind:'application',keywords:'adma agricultural files folders directory drive hierarchy documents 文件 文件夹 目录 层级 上传'},
 {id:'dashboard-v1',name:'Data dashboard',description:'Verified numerical observations: latest-value cards, interactive line/bar charts, series controls, data table, CSV export and citations.',kind:'chart',keywords:'dashboard chart graph plot metrics statistics compare data 仪表盘 图表 数据 统计 对比'},
 {id:'form-v1',name:'Form and results',description:'Calculators, converters and structured tools. Pre-coded input fields, validation, submit action and backend-computed results.',kind:'application',keywords:'calculator converter calculate form inputs transform 计算 换算 转换 表单'},
 {id:'table-v1',name:'Data table',description:'Numerical datasets in a table-first dashboard, with source links and CSV export; charts remain available.',kind:'chart',keywords:'table dataset rows spreadsheet csv 表格 数据集 明细'},
] as const;
export type TemplateId=typeof templates[number]['id'];
export function searchTemplates(query:string){
 const words=query.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
 return templates.map(t=>({...t,score:words.reduce((n,w)=>n+(`${t.name} ${t.description} ${t.keywords}`.toLowerCase().includes(w)?1:0),0)})).sort((a,b)=>b.score-a.score);
}
export function templateId(value:unknown):TemplateId{return templates.some(t=>t.id===value)?value as TemplateId:'wiki-v1';}
