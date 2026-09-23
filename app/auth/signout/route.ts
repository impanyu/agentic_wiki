import { env } from '@/server/runtime';
import { cookie, hash, origin, sessionCookie, requestCookie } from '@/server/auth';
const copy={
 en:{title:'Sign out of AgenticWiKi?',body:'You will leave this device signed out. Your pages, history and connectors stay saved in your account.',confirm:'Sign out',cancel:'Cancel'},
 zh:{title:'退出 AgenticWiKi？',body:'退出后此设备将不再保持登录。你的页面、浏览记录和连接器仍会保存在账户中。',confirm:'退出登录',cancel:'取消'},
};
const style=`:root{color-scheme:light dark;--bg:#f1f3f6;--card:#fff;--text:#1f2a3d;--muted:#5f6b80;--line:#dce1e8;--brand:#47536a;--primary:#2f5bd3;--primary-hover:#244bb4}
@media(prefers-color-scheme:dark){:root{--bg:#12161d;--card:#1b212b;--text:#e7ebf2;--muted:#9aa5b8;--line:#2c3441;--brand:#c3cad6;--primary:#4f7cf0;--primary-hover:#6a91f5}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif}
main{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px 28px 28px;box-shadow:0 12px 36px rgba(20,30,50,.08);text-align:center}
.brand{display:inline-flex;align-items:center;gap:9px;color:var(--brand);font-weight:650;font-size:17px;letter-spacing:-.4px;margin-bottom:22px}
h1{font-size:21px;line-height:1.3;margin:0 0 10px;letter-spacing:-.3px}p{margin:0 0 26px;color:var(--muted)}
.actions{display:grid;gap:10px}button,a.cancel{display:block;width:100%;border-radius:10px;padding:11px 16px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
button{border:0;background:var(--primary);color:#fff}button:hover{background:var(--primary-hover)}a.cancel{border:1px solid var(--line);color:var(--text);background:transparent}a.cancel:hover{background:rgba(127,140,160,.1)}
button:focus-visible,a.cancel:focus-visible{outline:2px solid var(--primary);outline-offset:2px}`;
const mark='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>';
export async function GET(request: Request) {
  const lang=/^zh\b/i.test(request.headers.get('accept-language')||'')?'zh':'en',t=copy[lang];
  const html=`<!doctype html><html lang="${lang==='zh'?'zh-CN':'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.confirm} · AgenticWiKi</title><style>${style}</style></head><body><main><div class="brand">${mark}<span>AgenticWiKi</span></div><h1>${t.title}</h1><p>${t.body}</p><form method="post" class="actions"><button type="submit" autofocus>${t.confirm}</button><a class="cancel" href="/">${t.cancel}</a></form></main></body></html>`;
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}});
}
export async function POST(request: Request) {
  if (request.headers.get('origin') !== origin()) return new Response('Forbidden',{status:403});
  await env.DB.prepare('DELETE FROM auth_sessions WHERE hash=?').bind(hash(requestCookie(request,sessionCookie))).run();
  return new Response(null,{status:303,headers:{Location:origin()+'/', 'Set-Cookie':cookie(sessionCookie,'',0),'Cache-Control':'no-store'}});
}
