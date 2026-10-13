// Builds an .xlsx workbook from rows of objects for files.write.
type Column={key:string;label:string};
const columnsOf=(rows:Record<string,unknown>[],raw:unknown):Column[]=>Array.isArray(raw)&&raw.length?raw.map(c=>typeof c==='string'?{key:c,label:c}:{key:String((c as any)?.key),label:String((c as any)?.label??(c as any)?.key)}):[...new Set(rows.slice(0,1000).flatMap(r=>Object.keys(r)))].map(k=>({key:k,label:k}));
const cell=(v:unknown)=>v==null?null:typeof v==='number'||typeof v==='boolean'?v:typeof v==='object'?JSON.stringify(v):String(v);
export async function workbookBytes(a:Record<string,any>):Promise<Uint8Array>{
 const sheets:{name?:unknown;rows?:unknown;columns?:unknown}[]=Array.isArray(a.sheets)&&a.sheets.length?a.sheets:[{name:'Sheet1',rows:a.rows,columns:a.columns}];
 if(sheets.length>20)throw Error('A workbook holds at most 20 sheets.');
 const ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook();let total=0;const used=new Set<string>();
 sheets.forEach((s,i)=>{
  if(!Array.isArray(s.rows))throw Error('Each .xlsx sheet needs rows: a list of objects.');
  const rows=(s.rows as unknown[]).filter(r=>r&&typeof r==='object'&&!Array.isArray(r)) as Record<string,unknown>[];
  total+=rows.length;if(total>200_000)throw Error('A workbook holds at most 200,000 rows.');
  let name=String(s.name||'Sheet'+(i+1)).replace(/[\\/?*[\]:]/g,' ').slice(0,31).trim()||'Sheet'+(i+1);while(used.has(name))name=(name.slice(0,28)+' '+(i+1));used.add(name);
  const cols=columnsOf(rows,s.columns),ws=book.addWorksheet(name);
  ws.columns=cols.map(c=>({header:c.label,key:c.key,width:Math.min(60,Math.max(10,c.label.length+2))}));
  ws.getRow(1).font={bold:true};ws.views=[{state:'frozen',ySplit:1}];
  for(const r of rows)ws.addRow(Object.fromEntries(cols.map(c=>[c.key,cell(r[c.key])])));
 });
 return new Uint8Array(await book.xlsx.writeBuffer() as ArrayBuffer);
}
