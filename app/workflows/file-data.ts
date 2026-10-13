import {Buffer} from 'node:buffer';
// File contents for apps. Agents read files in small pages to fit their context
// (context-files/read.ts); an app computes over the data, so text and tables come
// back whole, up to the limits below. Other formats (PDF, images, archives) use
// the agent decoder.
export const APP_READ_LIMITS={rows:100_000,lines:100_000};
const TEXT=/^(txt|md|json|jsonl|geojson|csv|tsv|html?|xml|yaml|yml|log|sql|toml|ini|tex)$/;
type Options={mode?:string;sheet?:string;start?:number;count?:number};
const records=(rows:unknown[][])=>{const header=(rows[0]||[]).map((h,i)=>String(h??'').trim()||'column'+(i+1));return {columns:header,records:rows.slice(1).map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]??null])))};};
export async function decodeForApp(bytes:Buffer,name:string,mimeType:string,raw:unknown={}):Promise<Record<string,unknown>>{
 const o=(raw&&typeof raw==='object'?raw:{}) as Options,ext=name.split('.').pop()?.toLowerCase()||'';
 const table=/^(csv|tsv|xlsx)$/.test(ext),mode=!o.mode||o.mode==='auto'?(table?'table':TEXT.test(ext)?'text':'other'):o.mode;
 const base={name,mimeType,size:bytes.length,mode};
 const start=Math.max(1,Number(o.start)||1),window=<T,>(list:T[],limit:number)=>{const count=Math.min(limit,Number(o.count)||limit);return {slice:list.slice(start-1,start-1+count),truncated:start-1+count<list.length};};
 if(mode==='table'&&(ext==='csv'||ext==='tsv')){
  const {parse}=await import('csv-parse/sync');
  const all=parse(bytes.toString('utf8'),{delimiter:ext==='tsv'?'\t':',',bom:true,relax_column_count:true,skip_empty_lines:true}) as string[][];
  const {slice,truncated}=window(all,APP_READ_LIMITS.rows+1);
  return {...base,totalRows:all.length,rows:slice,...records(start===1?slice:[all[0]||[],...slice]),truncated};
 }
 if(mode==='table'&&ext==='xlsx'){
  const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as any);
  const ws=o.sheet?workbook.getWorksheet(o.sheet):workbook.worksheets[0];if(!ws)throw Error('Sheet not found. Sheets: '+workbook.worksheets.map(s=>s.name).join(', '));
  const all:unknown[][]=[];ws.eachRow({includeEmpty:false},row=>{const cells:unknown[]=[];for(let c=1;c<=ws.columnCount;c++){const cell=row.getCell(c),v=cell.value;cells.push(v instanceof Date?v.toISOString():v&&typeof v==='object'?('result' in v?(v as any).result:cell.text):v??null);}all.push(cells);});
  const {slice,truncated}=window(all,APP_READ_LIMITS.rows+1);
  return {...base,sheet:ws.name,sheets:workbook.worksheets.map(s=>s.name),totalRows:all.length,rows:slice,...records(start===1?slice:[all[0]||[],...slice]),truncated};
 }
 if(mode==='text'&&TEXT.test(ext)){
  const text=bytes.toString('utf8');if(text.includes('\u0000'))throw Error('Binary or non-UTF-8 text.');
  const all=text.split(/\r?\n/),{slice,truncated}=window(all,APP_READ_LIMITS.lines);
  const whole=start===1&&!truncated;
  return {...base,text:whole?text:slice.join('\n'),totalLines:all.length,lines:slice.map((t,i)=>({line:start+i,text:t})),truncated};
 }
 const {decodeFile}=await import('@/app/context-files/read');
 return (await decodeFile(bytes,name,mimeType,raw)).data;
}
