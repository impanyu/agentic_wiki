import {z} from 'zod';
import {database,getPage} from '@/db/store';

// A reader's own highlights and notes on a paper PDF, private to them (signed-in or guest) and
// kept per page and per document (the original paper or a PDF in Page files).
export const NOTE_COLORS=['yellow','green','blue','pink','orange'] as const;
const rect=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().min(0).max(1),h:z.number().min(0).max(1)}).strict();
export const documentKey=z.string().regex(/^(source|file:[A-Za-z0-9-]{1,80})$/);
export const newNote=z.object({document:documentKey,page:z.number().int().min(1).max(5000),color:z.enum(NOTE_COLORS),quote:z.string().max(4000),note:z.string().max(8000).default(''),rects:z.array(rect).min(1).max(200)}).strict();
export const noteChange=z.object({id:z.string().uuid(),color:z.enum(NOTE_COLORS).optional(),note:z.string().max(8000).optional()}).strict();
export type PaperNote={id:string;page:number;color:string;quote:string;note:string;rects:z.infer<typeof rect>[];createdAt:number;updatedAt:number};
type Row={id:string;page_number:number;color:string;quote:string;note:string;rects:string;created_at:number;updated_at:number};
const shape=(r:Row):PaperNote=>({id:r.id,page:r.page_number,color:r.color,quote:r.quote,note:r.note,rects:JSON.parse(r.rects),createdAt:r.created_at,updatedAt:r.updated_at});
async function readable(pageId:string,userId:string){if(!await getPage(pageId,userId))throw Error('NOT_FOUND');}
export async function listNotes(pageId:string,userId:string,document:string){
 await readable(pageId,userId);documentKey.parse(document);
 const rows=(await database().prepare('SELECT * FROM paper_notes WHERE owner_id=? AND page_id=? AND document=? ORDER BY page_number,created_at').bind(userId,pageId,document).all<Row>()).results;
 return rows.map(shape);
}
export async function addNote(pageId:string,userId:string,raw:unknown){
 await readable(pageId,userId);const n=newNote.parse(raw);
 const count=await database().prepare('SELECT count(*) n FROM paper_notes WHERE owner_id=? AND page_id=?').bind(userId,pageId).first<{n:number}>();if((count?.n||0)>=2000)throw Error('LIMIT');
 const id=crypto.randomUUID(),now=Date.now();
 await database().prepare('INSERT INTO paper_notes(id,page_id,owner_id,document,page_number,color,quote,note,rects,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,pageId,userId,n.document,n.page,n.color,n.quote,n.note,JSON.stringify(n.rects),now,now).run();
 return {id,page:n.page,color:n.color,quote:n.quote,note:n.note,rects:n.rects,createdAt:now,updatedAt:now} satisfies PaperNote;
}
export async function changeNote(pageId:string,userId:string,raw:unknown){
 const c=noteChange.parse(raw),row=await database().prepare('SELECT * FROM paper_notes WHERE id=? AND owner_id=? AND page_id=?').bind(c.id,userId,pageId).first<Row>();if(!row)throw Error('NOT_FOUND');
 const now=Date.now();await database().prepare('UPDATE paper_notes SET color=?,note=?,updated_at=? WHERE id=?').bind(c.color??row.color,c.note??row.note,now,c.id).run();
 return shape({...row,color:c.color??row.color,note:c.note??row.note,updated_at:now});
}
export async function removeNote(pageId:string,userId:string,id:string){z.string().uuid().parse(id);await database().prepare('DELETE FROM paper_notes WHERE id=? AND owner_id=? AND page_id=?').bind(id,userId,pageId).run();return {deleted:true};}
