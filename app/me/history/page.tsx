import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {getChatGPTUser,chatGPTSignInPath} from '@/app/chatgpt-auth';
import {serverUi} from '@/app/i18n/request';
import {DbShell} from '@/app/rankings/view';
import {entityDb} from '@/app/entity-db/client';
// /me/history: every page the signed-in reader opened, newest first, 50 per page.
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'History · RankWiki',robots:{index:false,follow:false}};
const PER=50;
type Props={searchParams:Promise<Record<string,string|string[]|undefined>>};
export default async function HistoryPage({searchParams}:Props){
 const user=await getChatGPTUser();
 if(!user)redirect(chatGPTSignInPath('/me/history'));
 const ui=await serverUi();const t=ui.t;
 const db=await entityDb();
 const total=Number((await db.query<{n:number}>('select count(*)::int n from reader_history where user_id=$1::text',[user.userId])).rows[0]?.n||0);
 const pages=Math.max(1,Math.ceil(total/PER));
 const page=Math.min(pages,Math.max(1,Number((await searchParams).page)||1));
 const rows=(await db.query<{href:string;title:string;kind:string;at:string}>(`select href, title, kind, at::text at from reader_history where user_id=$1::text order by at desc limit $2::int offset $3::int`,[user.userId,PER,(page-1)*PER])).rows;
 const when=(s:string)=>new Date(s).toLocaleString(ui.locale,{dateStyle:'medium',timeStyle:'short'});
 const link=(p:number)=>'/me/history'+(p>1?'?page='+p:'');
 const nums=[...new Set([1,page-2,page-1,page,page+1,page+2,pages])].filter(p=>p>=1&&p<=pages).sort((a,b)=>a-b);
 return <DbShell locale={ui.locale} dictionary={ui.dict} askTargets={{}} className="answer template-profile-v1" account={{name:user.displayName}}>
  <header className="wiki-heading db-hero"><div><span className="db-kicker"><a href="/me">{t('Profile')}</a></span><h1>{t('History')}</h1><p className="lead">{t('{count} pages viewed',{count:total.toLocaleString(ui.locale)})}</p></div></header>
  {rows.length?<ol className="history-list" start={(page-1)*PER+1}>{rows.map(r=><li key={r.href}><a href={r.href}>{r.title}</a><span className={'history-kind '+r.kind}>{r.kind==='ranking'?t('Ranking'):r.kind==='entity'?t('Entity'):t('Topic')}</span><time dateTime={r.at}>{when(r.at)}</time></li>)}</ol>
   :<p className="adm-empty">{t('No pages viewed yet.')}</p>}
  {pages>1&&<nav className="wf-rank-pager" aria-label={t('Pages')}>
   {page>1?<a href={link(page-1)} aria-label={t('Previous page')}>‹</a>:<span className="off">‹</span>}
   {nums.map((p,i)=><span key={p} className="history-pagewrap">{i>0&&p-nums[i-1]>1&&<span className="wf-rank-gap">…</span>}{p===page?<a className="on" aria-current="page" href={link(p)}>{p}</a>:<a href={link(p)}>{p}</a>}</span>)}
   {page<pages?<a href={link(page+1)} aria-label={t('Next page')}>›</a>:<span className="off">›</span>}
  </nav>}
 </DbShell>;
}
