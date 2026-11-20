import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
// rankingPageErrors is self-contained at the end of generation-draft.ts.
const src=readFileSync('app/page-programs/generation-draft.ts','utf8');const fn=src.slice(src.indexOf('export function rankingPageErrors'));
const {rankingPageErrors:check}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(fn,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const block='```component\n{"ui":[{"type":"ranking","props":{"rows":[],"criteria":[]}}]}\n```';
test('ranking pages are titled by scope, carry a ranking component and little prose',()=>{
 assert.equal(check('Country Rankings','All 217 countries.\n\n'+block+'\n\n## About this ranking\n- World Bank, 2024.'),null);
 assert.equal(check('University Rankings in Asia',block),null);
 assert.equal(check('国家排行榜',block),null);
 assert.match(check('Countries ranked by population',block),/Rankings/);
 assert.match(check('Country Rankings by population',block),/scope only/);
 assert.match(check('Top Perfume Rankings',block),/scope only/);
 assert.match(check('Country Rankings','## Countries\nText only.'),/ranking component/);
 assert.match(check('Country Rankings',block+'\n'+'Long prose. '.repeat(400)),/keep the prose/);
});
