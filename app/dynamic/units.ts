export const units=[
 {id:'mm',group:'length',symbol:'mm',factor:.001},{id:'cm',group:'length',symbol:'cm',factor:.01},{id:'m',group:'length',symbol:'m',factor:1},{id:'km',group:'length',symbol:'km',factor:1000},
 {id:'in',group:'length',symbol:'in',factor:.0254},{id:'ft',group:'length',symbol:'ft',factor:.3048},{id:'yd',group:'length',symbol:'yd',factor:.9144},{id:'mi',group:'length',symbol:'mi',factor:1609.344},
 {id:'mg',group:'mass',symbol:'mg',factor:.000001},{id:'g',group:'mass',symbol:'g',factor:.001},{id:'kg',group:'mass',symbol:'kg',factor:1},{id:'oz',group:'mass',symbol:'oz',factor:.028349523125},{id:'lb',group:'mass',symbol:'lb',factor:.45359237},
 {id:'ml',group:'volume',symbol:'mL',factor:.001},{id:'l',group:'volume',symbol:'L',factor:1},{id:'us_gal',group:'volume',symbol:'US gal',factor:3.785411784},
 {id:'s',group:'time',symbol:'s',factor:1},{id:'min',group:'time',symbol:'min',factor:60},{id:'h',group:'time',symbol:'h',factor:3600},
 {id:'c',group:'temperature',symbol:'°C',factor:1},{id:'f',group:'temperature',symbol:'°F',factor:5/9},{id:'k',group:'temperature',symbol:'K',factor:1},
] as const;
export type UnitId=typeof units[number]['id'];
export type ConversionInput={value:number;from:UnitId;to:UnitId};
export type ConversionResult={input:ConversionInput;value:number;fromSymbol:string;toSymbol:string;calculatedAt:string};
export type ConverterLabels={overview:string;value:string;from:string;to:string;convert:string;swap:string;result:string;working:string;choose:string;invalid:string;unavailable:string;length:string;mass:string;volume:string;time:string;temperature:string};
export type DynamicConfig={visualDesign?:import('../page-programs/custom-style').CustomStyle|null;visualTheme?:import('../page-programs/visual-style').VisualTheme;contextDomain?:'wiki'|'session'|'app';indexKind?:'pages'|'jobs';sessionInstructions?:string;inputFields?:import('../page-programs/inputs').InputFields;template:'context-index-v1'|'page-program-v1'|'agent-chat-v1'|'file-browser-v1'|'unit-converter-v1'|'component-form-v1'|'component-chart-v1'|'component-sandbox-v1'|'google-drive-folders-v1';executor:string;driveLabels?:Record<string,string>;capability?:string;sandbox?:import('../components-registry/sandbox-contracts').SandboxDefinition;chart?:import('../components-registry/chart-contracts').ChartDefinition;dataset?:import('../components-registry/chart-contracts').ChartDataset;components?:{data?:import('../components-registry/contracts').ComponentRef;frontend:import('../components-registry/contracts').ComponentRef;backend?:import('../components-registry/contracts').ComponentRef;workflow?:import('../components-registry/contracts').ComponentRef};form?:import('../components-registry/contracts').FormDefinition;version:1;labels:ConverterLabels};
export const defaultInput:ConversionInput={value:1,from:'km',to:'mi'};
export function inputQuery(input?:ConversionInput|import('../components-registry/contracts').Parameters){
 if(!input||!Object.keys(input).length)return '';
 const params=new URLSearchParams({inputs:JSON.stringify(input)});
 // Retain readable converter parameters and compatibility with existing saved URLs.
 if(typeof input.value==='number'&&input.from&&input.to){params.set('value',String(input.value));params.set('from',String(input.from));params.set('to',String(input.to));}
 return '&'+params.toString();
}
export function pageAddress(id:string,input?:ConversionInput|import('../components-registry/contracts').Parameters){return '/?page='+encodeURIComponent(id)+inputQuery(input);}
