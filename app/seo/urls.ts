// Canonical, crawlable addresses of public pages: /p/<page id>/<slug>. The id decides the page;
// the slug (from the title) is for readers and search engines, and a wrong one redirects.
// Works on server and client.
export function slugify(title:string){
 const s=String(title||'').normalize('NFKC').toLowerCase()
  .replace(/['’"“”`]/g,'').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'');
 return s.slice(0,90).replace(/-+$/,'')||'page';
}
export const pagePath=(id:string,title:string)=>'/p/'+encodeURIComponent(id)+'/'+encodeURIComponent(slugify(title));
export const askPath=(question:string)=>'/?ask='+encodeURIComponent(question);
// "/?ask=Country%20Rankings" → "Country Rankings"; null for any other address.
export function askOf(href:string):string|null{
 const m=/^\/\?ask=([^&#]*)/.exec(href);if(!m)return null;
 try{return decodeURIComponent(m[1].replace(/\+/g,' ')).trim()||null;}catch{return null;}
}
// Key used to match a question to an existing page title or question.
export const questionKey=(q:string)=>String(q||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
