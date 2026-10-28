// Source files loaded with their imports stripped see the edition rules as globals.
import {readFileSync} from 'node:fs';import ts from 'typescript';
const code=ts.transpile(readFileSync('app/edition.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022});
const edition=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
Object.assign(globalThis,{WIKI_EDITION:edition.WIKI_EDITION,editionPageSql:edition.editionPageSql,editionShowsPage:edition.editionShowsPage});
// Component blocks have their own tests (workflows.test.mjs); elsewhere they count as valid.
globalThis.componentBlockErrors=()=>[];
