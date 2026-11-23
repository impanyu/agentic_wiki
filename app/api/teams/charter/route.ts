import {charter} from '@/app/teams/charter';
// The team charter as data: every workflow's steps (who does what) and how they connect, with a Mermaid diagram each.
export const dynamic='force-dynamic';
export async function GET(){return Response.json({workflows:charter()});}
