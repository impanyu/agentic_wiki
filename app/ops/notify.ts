import type {Issue} from './issues';
import {siteUrl} from '@/app/site';
// Tells the operators about a new blocker or major problem, through whichever channels are configured:
// ISSUE_WEBHOOK_URL (Slack, Discord, Feishu/Lark or any JSON webhook) and/or GitHub issues
// (GITHUB_ISSUES_TOKEN with issues access to GITHUB_ISSUES_REPO, "owner/name"). Returns whether any was sent.
export async function notifyIssue(issue:Issue):Promise<boolean>{
 const link=(siteUrl()||'')+'/admin?tab=issues#issue-'+issue.id;
 const text=`[RankWiki · ${issue.severity}] ${issue.title}${issue.topic?' — '+issue.topic:''} (${issue.source})\n${issue.detail.slice(0,1200)}\n${link}`;
 let sent=false;
 const hook=process.env.ISSUE_WEBHOOK_URL;
 if(hook){
  const body=/discord(app)?\.com/.test(hook)?{content:text.slice(0,1900)}:/feishu|larksuite/.test(hook)?{msg_type:'text',content:{text}}:{text};
  const r=await fetch(hook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10_000)});
  sent=sent||r.ok;
 }
 const token=process.env.GITHUB_ISSUES_TOKEN,repo=process.env.GITHUB_ISSUES_REPO;
 if(token&&repo&&/^[\w.-]+\/[\w.-]+$/.test(repo)){
  const r=await fetch(`https://api.github.com/repos/${repo}/issues`,{method:'POST',signal:AbortSignal.timeout(15_000),
   headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'rankwiki-ops'},
   body:JSON.stringify({title:`[${issue.severity}] ${issue.title}`.slice(0,250),body:`**Source:** ${issue.source}${issue.topic?`  \n**Topic:** ${issue.topic}`:''}  \n**Admin:** ${link}\n\n${issue.detail}`.slice(0,60000),labels:['rankwiki-ops',issue.severity]})});
  sent=sent||r.ok;
 }
 return sent;
}
