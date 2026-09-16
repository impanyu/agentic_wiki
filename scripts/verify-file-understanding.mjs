import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { migrate } from './migrate.mjs';
import { SqliteDatabase } from '../server/sqlite.mjs';
import {FileBucket} from '../server/files.mjs';
import ExcelJS from 'exceljs';
import {PDFDocument} from 'pdf-lib';
import {deflateSync} from 'node:zlib';
const dir=await mkdtemp(join(tmpdir(),'agenticwiki-live-'));
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const origin='http://localhost:'+port,path=join(dir,'agenticwiki.sqlite');migrate(path);
const db=new SqliteDatabase(path),session=randomBytes(32).toString('base64url');
await db.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').bind(createHash('sha256').update(session).digest('hex'),JSON.stringify({userId:'google:smoke',email:'smoke@example.com',displayName:'Smoke',fullName:'Smoke'}),Date.now()+600000).run();
const child=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_URL:origin,DATA_DIR:dir,GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
try{
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Server stopped: '+logs);try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'Server readiness timed out');

 const headers={origin,'Content-Type':'application/json',cookie:'agenticwiki_session='+session};

 const now=new Date().toISOString();
 await db.prepare("INSERT INTO pages(id,owner_id,question,title,summary,body,category,sources,labels,visibility,created_at,language,kind,dynamic_config) VALUES('file-check','google:smoke','Read uploaded files','File check','','','Test','[]','{}','private',?,'en','dynamic',?)").bind(now,JSON.stringify({template:'agent-chat-v1',executor:'page-agent-v1',version:1,capability:'application',labels:{}})).run();
 const bucket=new FileBucket(join(dir,'objects'));
 async function attach(id,name,type,bytes){const key='uploads/'+id;await bucket.put(key,bytes);await db.prepare("INSERT INTO components VALUES(?,'data',1,'google:smoke','private','en',?,'',?,?)").bind(id,name,JSON.stringify({fileName:name,mimeType:type,size:bytes.length,location:'r2://FILES/'+key}),now).run();await db.prepare("INSERT INTO page_files(id,page_id,component_id,owner_id,scope,created_at) VALUES(?,'file-check',?,'google:smoke','',?)").bind(id,id,now).run();}
 const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('Sales');sheet.addRow(['record','value']);for(let i=2;i<=1205;i++)sheet.addRow(['row'+i,i===1205?7391:0]);await attach('sheet','sales.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',Buffer.from(await wb.xlsx.writeBuffer()));
 const pdf=await PDFDocument.create();pdf.addPage().drawText('Verification code ORCHID-47');await attach('pdf','note.pdf','application/pdf',Buffer.from(await pdf.save()));
 await attach('csv','values.csv','text/csv',Buffer.from('item,value\nalpha,17\nbeta,25'));
 function chunk(type,data){const contents=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const b of contents){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([len,contents,sum]);}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(128,0);ihdr.writeUInt32BE(128,4);ihdr[8]=8;ihdr[9]=2;const scan=Buffer.alloc(128*(1+128*3));for(let y=0;y<128;y++)for(let x=0;x<128;x++)scan[y*385+1+x*3]=255;const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);await attach('image','color.png','image/png',png);
 const response=await fetch(origin+'/api/pages/file-check/chat',{method:'POST',headers,body:JSON.stringify({message:'Use list_page_files and read_uploaded_file to inspect the uploaded files. Read sales.xlsx sheet Sales row 1205 column 2 exactly, read the PDF verification code, inspect color.png visually and identify its main color, and read both values in values.csv. Report all five values concisely. Use the file tools, do not guess from file names.'}),signal:AbortSignal.timeout(180000)});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.match(result.reply,/7391/);assert.match(result.reply,/ORCHID.?47/);assert.match(result.reply,/red/i);assert.match(result.reply,/17/);assert.match(result.reply,/25/);
 const events=(await db.prepare("SELECT data FROM agent_run_events WHERE kind='tool_finished'").all()).results.map(r=>JSON.parse(r.data));assert.ok(events.some(e=>e.tool==='read_uploaded_file'&&e.result?.fileId==='sheet'));
 console.log(JSON.stringify({passed:true,checks:['XLSX row beyond 1000','PDF text','image vision','CSV values','shared agent file tools']}));
}catch(error){console.error(logs);throw error;}
finally{child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null)r();else child.once('exit',r);});db.close();await rm(dir,{recursive:true,force:true});}
