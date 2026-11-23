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
 return <DbShell locale={ui.locale} dictionary={ui.dict} askTargets={{}} className="answer template-profile-v1" account={{name:user.displayName}}>
  <header className="wiki-heading db-hero profile-hero">
   <span className="profile-avatar" aria-hidden="true">{(user.displayName||user.email).slice(0,1).toUpperCase()}</span>
   <div><span className="db-kicker">{admin?t('Administrator'):t('Reader')}</span><h1>{user.displayName||user.email}</h1><p className="lead">{user.email}</p></div>
  </header>
  {admin&&<section className="rw-explore"><h2>{t('Administration')}</h2>
   <div className="rw-types">
    <a className="rw-type" href="/admin"><strong>{t('System overview')}</strong><span>{t('Issues, traffic, model costs, teams')}</span></a>
    <a className="rw-type" href="/admin?tab=issues"><strong>{t('Issues')}</strong><span>{t('Problems the agents could not solve')}</span></a>
    <a className="rw-type" href="/admin?tab=costs"><strong>{t('Model costs')}</strong><span>{t('Spending by day and model')}</span></a>
   </div></section>}
  <section className="rw-explore"><h2>{t('Preferences')}</h2>
   <ul className="profile-prefs"><li><span>{t('Language')}</span><b>{lang}</b></li><li><span>{t('Theme')}</span><b>{t('Set with the switch at the top right; remembered on this device.')}</b></li></ul>
  </section>
  <p className="profile-signout"><a href="/auth/signout">{t('Sign out')}</a></p>
 </DbShell>;
}
