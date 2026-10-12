import {z} from 'zod';
// A workflow app is data, not code: a tree of infrastructure UI components and
// named actions whose steps call infrastructure tools. Any value may be a
// binding {"$": "<JSONata expression>"} evaluated by the platform.
export const LIMITS={nodes:400,depth:12,actions:40,stepsPerAction:30,eachItems:100,callsPerRun:300,runMs:150_000,stateBytes:2_000_000,expressionChars:4000,workflowBytes:400_000};
const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/,'ids are letters, digits and _ (start with a letter)');
export type Binding={$:string};
export const isBinding=(v:unknown):v is Binding=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===1&&typeof (v as Binding).$==='string';
export type WorkflowNode={id?:string;type:string;props?:Record<string,unknown>;children?:WorkflowNode[];on?:Record<string,string>;visible?:unknown};
export const nodeSchema:z.ZodType<WorkflowNode>=z.lazy(()=>z.object({id:id.optional(),type:z.string().regex(/^[a-z][a-z_]{0,39}$/),props:z.record(z.unknown()).optional(),children:z.array(nodeSchema).max(100).optional(),on:z.record(id).optional(),visible:z.unknown().optional()}).strict());
export const stepSchema=z.object({id,tool:z.string().regex(/^[a-z][a-z_.]{0,59}$/),args:z.record(z.unknown()).optional(),when:z.unknown().optional(),each:z.unknown().optional(),optional:z.boolean().optional()}).strict();
export const actionSchema=z.object({description:z.string().max(500).optional(),client:z.boolean().optional(),steps:z.array(stepSchema).max(LIMITS.stepsPerAction).default([]),set:z.record(z.unknown()).optional(),then:id.optional()}).strict();
export const workflowSchema=z.object({kind:z.literal('workflow-app'),version:z.literal(1).default(1),title:z.string().max(200).optional(),description:z.string().max(2000).optional(),state:z.record(z.unknown()).default({}),ui:z.array(nodeSchema).min(1).max(100),actions:z.record(actionSchema).default({}),layout:z.object({maxWidth:z.number().int().min(480).max(2400).optional(),density:z.enum(['compact','normal','spacious']).optional(),accent:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),plain:z.boolean().optional()}).strict().optional()}).strict();
export type Workflow=z.infer<typeof workflowSchema>;
export type WorkflowStep=z.infer<typeof stepSchema>;
export type WorkflowAction=z.infer<typeof actionSchema>;
// What a run sends back to the page.
export type RunTrace={step:string;tool:string;status:'ok'|'error'|'skipped'|'proposal';ms:number;error?:string;items?:number;preview?:string};
export type RunResult={state:Record<string,unknown>;steps:Record<string,unknown>;proposals:{actionId:string;request:unknown}[];trace:RunTrace[];error?:string;then?:string};
