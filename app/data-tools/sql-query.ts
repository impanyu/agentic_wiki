// SQL over saved datasets: each input alias becomes a table in a private, in-memory Postgres (PGlite) that lives for
// this one query only (no access to any other database). Models write SQL far more reliably than JSONata, so
// query_data takes either; a recipe replays the same statement.
export type Row=Record<string,unknown>;

export function looksLikeSql(text:string){return /^\s*(\(\s*)*(select|with)\b/i.test(text)&&!/^\s*\(\s*\$/.test(text);}

type ColType='double precision'|'boolean'|'jsonb'|'text';
const NUM=/^\s*-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\s*$/;
const asNum=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&NUM.test(v)?Number(v):null;
// A column is numeric when its values are numbers or numeric text (CSV), with at most 2% stray text (n/a, –) read
// as empty; boolean or object columns likewise; anything else is text.
function colType(rows:Row[],c:string):ColType{
 let seen=0,num=0,bool=0,obj=0;
 for(const r of rows){const v=r[c];if(v===null||v===undefined||v==='')continue;seen++;
  if(asNum(v)!==null)num++;else if(typeof v==='boolean')bool++;else if(typeof v==='object')obj++;}
 return !seen?'text':num>=seen*0.98?'double precision':bool===seen?'boolean':obj===seen?'jsonb':'text';
}
const q=(name:string)=>'"'+name.replace(/"/g,'""')+'"';

export async function sqlQuery(sql:string,tables:Record<string,{rows:Row[];columns:string[]}>,timeoutMs=15_000):Promise<Row[]>{
 const text=sql.trim().replace(/;\s*$/,'');
 if(text.includes(';'))throw Error('One SQL statement only (a SELECT or WITH … SELECT).');
 if(!looksLikeSql(text))throw Error('SQL must be a single SELECT (or WITH … SELECT) over the input aliases.');
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite();
 try{
  await db.exec(`set statement_timeout = ${Math.round(timeoutMs)}`);
  for(const [alias,t] of Object.entries(tables)){
   const cols=t.columns.length?t.columns:[...new Set(t.rows.flatMap(r=>Object.keys(r)))];
   const types=cols.map(c=>colType(t.rows,c));
   await db.exec(`create temp table ${q(alias)} (${cols.map((c,i)=>q(c)+' '+types[i]).join(', ')||'"_" text'})`);
   // Values cleaned to the column's type (a stray string in a number column becomes null rather than failing).
   for(let i=0;i<t.rows.length;i+=5000){
    const chunk=t.rows.slice(i,i+5000).map(r=>Object.fromEntries(cols.map((c,j)=>{const v=r[c];const ty=types[j];
     return [c,v===undefined||v===''&&ty!=='text'?null:ty==='double precision'?asNum(v):ty==='boolean'?(typeof v==='boolean'?v:null):ty==='jsonb'?v:(v===null?null:typeof v==='object'?JSON.stringify(v):String(v))];})));
    await db.query(`insert into ${q(alias)} select * from jsonb_populate_recordset(null::${q(alias)}, $1::jsonb)`,[JSON.stringify(chunk)]);
   }
  }
  // Read only from here on.
  await db.exec('set default_transaction_read_only = on');
  const r=await db.query<Row>(text);
  return r.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v instanceof Date?v.toISOString():v])));
 }catch(e){
  const m=(e as Error).message||String(e);
  const hint=/does not exist/.test(m)?' Tables: '+Object.entries(tables).map(([a,t])=>a+'('+t.columns.slice(0,40).map(c=>/^[a-z_][a-z0-9_]*$/.test(c)?c:q(c)).join(', ')+')').join('; ')+'. Quote column names with capitals, spaces or symbols in double quotes.':'';
  throw Error('SQL error: '+m+'.'+hint);
 }finally{await db.close().catch(()=>{});}
}
