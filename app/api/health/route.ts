import { env } from '@/server/runtime';
export const dynamic = 'force-dynamic';
export async function GET() { try { await env.DB.prepare('SELECT 1 FROM pages LIMIT 1').all(); return Response.json({status:'ok'},{headers:{'Cache-Control':'no-store'}}); } catch { return Response.json({status:'unavailable'},{status:503}); } }
