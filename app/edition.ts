// This edition is a wiki: every page is a wiki page. Web apps saved by the full edition
// stay in the database (switching editions restores them) but are not shown, listed or
// matched here. Built-in tools stay available, and a wiki page that gained an app keeps
// its article. The SQL and the TypeScript form below must agree.
const HIDDEN_NATIVE=['adma-tools','unl-hcc'];
export const WIKI_EDITION=true;
// The public edition (rankwiki): public data only. Every generated page is public and
// read-only; there are no user connectors, uploads, Page-file management, editing,
// page chat, forks or private pages. Signing in only keeps the visitor's history.
export const PUBLIC_EDITION=true;
// The site's name: the public edition is RankWiki, an entity search and ranking site.
export const SITE_NAME=PUBLIC_EDITION?'RankWiki':'AgenticWiKi';
type PageLike={kind?:string;question?:string;dynamic?:{template?:string;nativeApp?:string;workflow?:{ui?:unknown}}|null};
export function editionShowsPage(page:PageLike){
 if(page.kind!=='dynamic')return true;
 if(PUBLIC_EDITION)return false; // no app pages at all: they rely on connectors, drives and uploads
 const d=page.dynamic||{},template=d.template||'';
 if(template==='native-app-v1')return !HIDDEN_NATIVE.includes(d.nativeApp||'');
 if(template==='file-browser-v1')return !/adma/i.test(page.question||'');
 if(template==='workflow-app-v1')return JSON.stringify(d.workflow?.ui||[]).includes('"type":"article"');
 return false;
}
// The same rule over a pages row aliased as `p`.
export const editionPageSql=(p='p')=>PUBLIC_EDITION?`(${p}.kind<>'dynamic')`:`(${p}.kind<>'dynamic' OR (json_extract(${p}.dynamic_config,'$.template')='native-app-v1' AND COALESCE(json_extract(${p}.dynamic_config,'$.nativeApp'),'') NOT IN (${HIDDEN_NATIVE.map(n=>`'${n}'`).join(',')})) OR (json_extract(${p}.dynamic_config,'$.template')='file-browser-v1' AND lower(${p}.question) NOT LIKE '%adma%') OR (json_extract(${p}.dynamic_config,'$.template')='workflow-app-v1' AND instr(${p}.dynamic_config,'"type":"article"')>0))`;
