import type {CSSProperties} from 'react';
export const visualThemes=['auto','analytics','research','creative','productivity','nature','minimal','adma','github','linear','notion','slack','airtable','todoist','brave','deepwiki','huggingface','google','dropbox','onedrive'] as const;
export type VisualTheme=typeof visualThemes[number];
type Palette={accent:string;tint:string;canvas:string;border:string;radius:string;font:string;density:'compact'|'comfortable';header:'line'|'panel'};
const sans='Arial, Helvetica, sans-serif',serif='Georgia, "Times New Roman", serif';
const palette=(accent:string,tint:string,canvas:string,radius='14px',font=sans,density:Palette['density']='comfortable',header:Palette['header']='panel'):Palette=>({accent,tint,canvas,border:'#d7dee5',radius,font,density,header});
export const themePalettes:Record<Exclude<VisualTheme,'auto'>,Palette>={
 analytics:palette('#0f6863','#e5f4f0','#f6faf9','12px'),research:palette('#315a80','#eaf1f8','#fbfcfe','6px',serif,'comfortable','line'),creative:palette('#7440aa','#f2eafb','#fcf9ff','22px'),productivity:palette('#2456a6','#eaf0fc','#f8faff','12px'),nature:palette('#326937','#edf5e8','#fafcf7','18px'),minimal:palette('#414141','#f0efed','#fdfcfb','4px',sans,'comfortable','line'),
 adma:palette('#b00000','#fceceb','#fffafa','12px'),github:palette('#24292f','#eef1f4','#f6f8fa','6px',sans,'compact','line'),linear:palette('#5153ac','#eeeefa','#fafaff','8px',sans,'compact','line'),notion:palette('#37352f','#f1efeb','#fffefa','3px',serif,'comfortable','line'),slack:palette('#611f69','#f4eaf5','#fdfafe','12px'),airtable:palette('#126a58','#e5f4ee','#f6fbf9','12px'),todoist:palette('#b83225','#fceeea','#fffaf8','10px',sans,'compact','line'),brave:palette('#aa390c','#fff0e8','#fffaf7','18px'),deepwiki:palette('#245caa','#eaf2fd','#f7faff','10px'),huggingface:palette('#795b08','#fff4c9','#fffdf4','20px'),google:palette('#185abc','#e8f0fe','#f8fafd','22px'),dropbox:palette('#0052cc','#e6efff','#f7faff','4px'),onedrive:palette('#00649c','#e5f4fd','#f7fcff','8px'),
};
const connectorNames:Record<string,RegExp>={adma:/\badma\b|adma\.aisoup\.net/i,github:/\bgithub\b/i,linear:/\blinear\b/i,notion:/\bnotion\b/i,slack:/\bslack\b/i,airtable:/\bairtable\b/i,todoist:/\btodoist\b/i,brave:/\bbrave\b/i,deepwiki:/\bdeepwiki\b/i,huggingface:/hugging\s*face/i,google:/google\s*drive|谷歌云盘/i,dropbox:/\bdropbox\b/i,onedrive:/\bonedrive\b/i};
export function resolveVisualTheme(theme:unknown,question:string,template=''):Exclude<VisualTheme,'auto'>{
 if(typeof theme==='string'&&theme!=='auto'&&visualThemes.includes(theme as VisualTheme))return theme as Exclude<VisualTheme,'auto'>;
 const matches=Object.entries(connectorNames).filter(([,pattern])=>pattern.test(question));
 if(matches.length===1)return matches[0][0] as Exclude<VisualTheme,'auto'>;
 if(/chart|dashboard|table/.test(template)||/数据分析|统计|图表|analytics|dashboard/i.test(question))return 'analytics';
 if(/设计|创意|绘画|design|creative|artwork/i.test(question))return 'creative';
 if(/农业|园艺|生态|agricultur|garden|ecolog/i.test(question))return 'nature';
 if(/论文|研究|research|paper/i.test(question))return 'research';
 if(/任务|计划|日程|task|plan|schedule/i.test(question))return 'productivity';
 return 'minimal';
}
export function pageVisualProps(page:{kind?:string;question?:string;title:string;labels:{templateId?:string};dynamic?:{visualTheme?:VisualTheme}}){
 if(page.kind!=='dynamic')return {};
 const theme=resolveVisualTheme(page.dynamic?.visualTheme,page.question||page.title,page.labels.templateId),p=themePalettes[theme];
 return {'data-app-theme':theme,'data-app-density':p.density,'data-app-header':p.header,style:{'--app-accent':p.accent,'--app-tint':p.tint,'--app-canvas':p.canvas,'--app-border':p.border,'--app-radius':p.radius,'--app-heading-font':p.font} as CSSProperties};
}
export const visualStyleInstructions=' Choose visualTheme for the app appearance. If the task primarily uses one connector, prefer its named theme (adma/github/linear/notion/slack/airtable/todoist/brave/deepwiki/huggingface/google/dropbox/onedrive). A mere mention or comparison is not a primary connector. Otherwise choose analytics for data dashboards, research for scholarly work, creative for creative tools, productivity for planning, nature for agricultural/environmental tools, or minimal. Honor an explicit requested style over connector branding. auto delegates to a conservative fallback. These are visual inspirations, not official provider affiliation; never add provider login forms or claim the page is that service.';
