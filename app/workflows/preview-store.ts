import type {Workflow} from './schema';
// Short-lived snapshots that the verification browser renders through
// /workflow-preview?token=…; the token is the only key and expires quickly.
type Snapshot={workflow:Workflow;state:Record<string,unknown>;values:Record<string,unknown>;title:string;pageId:string;language?:string;expires:number};
const g=globalThis as unknown as {workflowPreviews?:Map<string,Snapshot>};
const store=g.workflowPreviews??=new Map();
export function putPreview(s:Omit<Snapshot,'expires'>){const now=Date.now();for(const [k,v] of store)if(v.expires<now)store.delete(k);const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');store.set(token,{...s,expires:now+5*60_000});return token;}
export function takePreview(token:string){const s=store.get(token);if(!s||s.expires<Date.now())return null;return s;}
export function dropPreview(token:string){store.delete(token);}
