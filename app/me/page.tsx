import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {getChatGPTUser,chatGPTSignInPath} from '@/app/chatgpt-auth';
import {serverUi} from '@/app/i18n/request';
import {LOCALES} from '@/app/i18n/locales';
import {DbShell} from '@/app/rankings/view';
import {isAdmin} from '@/app/ops/admin';
// /me: the signed-in reader's profile — account, role, preferences, history; administrators also reach the
// system pages from here.
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Profile · RankWiki',robots:{index:false,follow:false}};
export default async function ProfilePage(){
 const user=await getChatGPTUser();
 if(!user)redirect(chatGPTSignInPath('/me'));
 const ui=await serverUi();const admin=isAdmin(user);const t=ui.t;
 const lang=LOCALES.find(l=>l.code===ui.locale)?.name??'English';
 const {entityDb}=await import('@/app/entity-db/client');
 const recent=(await (await entityDb()).query<{href:string;title:string;at:string}>('select href, title, at::text at from reader_history where user_id=$1::text order by at desc limit 10',[user.userId]).catch(()=>({rows:[]}))).rows;
 return <DbShell locale={ui.locale} dictionary={ui.dict} askTargets={{}} className="answer template-profile-v1" account={{name:user.displayName}}>
  <header className="wiki-heading db-hero profile-hero">
   <span className="profile-avatar" aria-hidden="true">{(user.displayName||user.email).slice(0,1).toUpperCase()}</span>
   <div><span className="db-kicker">{admin?t('Administrator'):t('Reader')}</span><h1>{user.displayName||user.email}</h1><p className="lead">{user.email}</p></div>
  </header>
  {admin&&<section className="rw-explore"><h2>{t('Administration')}</h2>
   <nav className="adm-links" aria-label={t('Administration')}>
    {([['/admin',t('Overview'),t('Pages, teams, open issues and spending at a glance')],
      ['/admin?tab=issues',t('Issues'),t('Problems the agents could not solve')],
      ['/admin?tab=teams',t('Teams and data'),t('Team queue, agent runs and collection rules')],
      ['/admin?tab=services',t('Services'),t('Models, search and data APIs: keys, quotas and use')],
      ['/admin?tab=costs',t('Model costs'),t('Spending by day and model')],
      ['/admin?tab=traffic',t('Traffic'),t('Page views and searches')],
      ['/admin?tab=config',t('Configuration'),t('Settings in effect (secrets never shown)')]] as const).map(([href,title,note])=>
     <a key={href} href={href}><strong>{title}</strong><span>{note}</span></a>)}
   </nav></section>}
  {recent.length>0&&<section className="rw-explore"><h2>{t('History')}</h2>
   <ol className="history-list">{recent.map(r=><li key={r.href}><a href={r.href}>{r.title}</a><time dateTime={r.at}>{new Date(r.at).toLocaleDateString(ui.locale,{dateStyle:'medium'})}</time></li>)}</ol>
   <p><a href="/me/history">{t('All history')} →</a></p></section>}
  <section className="rw-explore"><h2>{t('Preferences')}</h2>
   <ul className="profile-prefs"><li><span>{t('Language')}</span><b>{lang}</b></li><li><span>{t('Theme')}</span><b>{t('Set with the switch at the top right; remembered on this device.')}</b></li></ul>
  </section>
  <p className="profile-signout"><a href="/auth/signout">{t('Sign out')}</a></p>
 </DbShell>;
}
