import {database} from '@/db/store';
// What agents have learned about a data source (paths, file formats, fields,
// units, quirks), kept per user so the next agent does not rediscover it.
// Real data always wins: agents update a note when the data disagrees.
type Row={id:string;source:string;notes:string;updated_at:string};
const words=(s:string)=>s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>1);
export async function readSourceNotes(userId:string,query:string){
 const rows=(await database().prepare('SELECT id,source,notes,updated_at FROM source_notes WHERE owner_id=? ORDER BY updated_at DESC LIMIT 300').bind(userId).all<Row>()).results;
 const q=new Set(words(query));
 const scored=rows.map(r=>({r,s:words(r.source).filter(w=>q.has(w)).length*3+words(r.notes).filter(w=>q.has(w)).length})).filter(x=>!q.size||x.s>0).sort((a,b)=>b.s-a.s).slice(0,5);
 return scored.map(({r})=>({source:r.source,notes:r.notes,updatedAt:r.updated_at}));
}
export async function saveSourceNote(userId:string,source:string,notes:string){
 const name=source.trim().replace(/\s+/g,' ').slice(0,200),text=notes.trim().slice(0,8000);
 if(!name||!text)throw Error('Give the source a name and write the notes.');
 const now=new Date().toISOString();
 await database().prepare('INSERT INTO source_notes(id,owner_id,source,notes,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,source) DO UPDATE SET notes=excluded.notes,updated_at=excluded.updated_at').bind(crypto.randomUUID(),userId,name,text,now).run();
 return {saved:true,source:name};
}
