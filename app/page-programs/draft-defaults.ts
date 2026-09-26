import type {AnswerPage} from '@/app/page-types';

// An in-page agent that replaces the whole page (kind:"replacement") must submit a full generator
// draft. The generator's own bookkeeping (intent flags, localized labels) describes the EXISTING
// page, so missing pieces are filled from it instead of rejecting the draft over formalities.
// Anything the agent did supply is kept as is.
export function withPageDefaults(raw:unknown,page:AnswerPage):unknown{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return raw;
 const draft={...raw as Record<string,any>};
 const zh=page.language.startsWith('zh'),app=(draft.kind||'')!=='article'&&draft.kind!=='disambiguation';
 const given=Object.fromEntries(Object.entries(draft.intent&&typeof draft.intent==='object'?draft.intent as Record<string,any>:{}).filter(([,v])=>v!==undefined&&v!==null&&v!==''));
 const nonEmpty=(v:unknown)=>Array.isArray(v)&&v.length>0;
 draft.intent={
  subject:page.title,subjectType:app?'application':'topic',goal:page.summary||page.title,
  explicitConstraints:[],assumptions:[],uncertainties:[],sourceRequirements:[],
  outputKind:draft.kind==='article'||draft.kind==='disambiguation'?'article':draft.kind==='chart'?'chart':'application',
  service:'none',fresh:false,needsDisambiguation:false,singleMeaningCertain:true,
  visualTheme:page.dynamic?.visualTheme||'auto',
  ...given,
  mustCover:nonEmpty(given.mustCover)?given.mustCover:[String(draft.summary||page.summary||page.title).slice(0,300)],
  interpretations:nonEmpty(given.interpretations)?given.interpretations:[page.title],
 };
 const labels=draft.labels&&typeof draft.labels==='object'?{...draft.labels as Record<string,string>}:{};
 const current=(page.dynamic?.labels||{}) as Record<string,string>;
 draft.labels={
  ...labels,
  overview:labels.overview||current.overview||(zh?'概述':'Overview'),
  invalid:labels.invalid||current.invalid||(zh?'输入无效，请检查后重试。':'Check the input and try again.'),
  contents:labels.contents||current.contents||(zh?'目录':'Contents'),
  sources:labels.sources||current.sources||(zh?'来源':'Sources'),
 };
 return draft;
}
