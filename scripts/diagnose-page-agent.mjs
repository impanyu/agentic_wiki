// Prints a page's recent in-page agent chat turns and run events, for diagnosing agent runs on
// the server. Usage: node scripts/diagnose-page-agent.mjs "<page title or id>" [events=60]
import {DatabaseSync} from 'node:sqlite';import {resolve} from 'node:path';
const db=new DatabaseSync(resolve(process.env.DATA_DIR||resolve(process.env.HOME,'agenticwiki/data'),'agenticwiki.sqlite'),{readOnly:true});
const [query='',limit='60']=process.argv.slice(2);
const pages=db.prepare("SELECT id,title,owner_id,updated_at FROM pages WHERE id=? OR title LIKE ? ORDER BY updated_at DESC LIMIT 5").all(query,'%'+query+'%');
for(const p of pages)console.log('PAGE',p.id,'|',p.title,'| owner',p.owner_id,'| updated',p.updated_at);
const page=pages[0];if(!page)process.exit(0);
const agents=db.prepare("SELECT id,owner_id,created_at FROM agent_instances WHERE role=?").all('page:'+page.id);
for(const a of agents){
 console.log('\nAGENT',a.id,'owner',a.owner_id);
 const turns=db.prepare('SELECT sequence,message,reply,created_at FROM page_chat_turns WHERE session_id=? ORDER BY sequence DESC LIMIT 6').all(a.id);
 for(const t of turns.reverse())console.log('TURN',t.sequence,new Date(t.created_at).toISOString?.()||t.created_at,'\n  USER:',String(t.message).slice(0,500).replace(/\s+/g,' '),'\n  AGENT:',String(t.reply).slice(0,900).replace(/\s+/g,' '));
 const events=db.prepare('SELECT sequence,run_id,kind,substr(data,1,700) data,created_at FROM agent_run_events WHERE agent_id=? ORDER BY sequence DESC LIMIT ?').all(a.id,Number(limit));
 for(const e of events.reverse())console.log('EV',e.sequence,e.run_id.slice(0,8),e.kind,String(e.data).replace(/\s+/g,' '));
}
