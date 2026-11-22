import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import ts from 'typescript';
const en=JSON.parse(readFileSync('app/i18n/public/en.json','utf8'));
const LANGS=['zh','es','fr','de','ja','ko','ru','pt','ar','hi','it','id','tr','vi','pl'];
const tokens=s=>(s.match(/\{\w+\}/g)||[]).sort().join('|');

test('every site language translates every public interface string, keeping its placeholders',()=>{
 for(const l of LANGS){
  const d=JSON.parse(readFileSync(`app/i18n/public/${l}.json`,'utf8'));
  const missing=Object.keys(en).filter(k=>typeof d[k]!=='string'||!d[k].trim());
  assert.deepEqual(missing,[],`${l}: untranslated`);
  for(const k of Object.keys(en))assert.equal(tokens(d[k]),tokens(k),`${l}: placeholders of "${k}"`);
  assert.deepEqual(Object.keys(d).filter(k=>!(k in en)),[],`${l}: keys no longer used`);
 }
});

test('language addresses: /<code>/ prefixes, links inside page data move with the language, files stay put',async()=>{
 const out=new URL('../node_modules/.cache/i18n-test/',import.meta.url);mkdirSync(out,{recursive:true});
 writeFileSync(new URL('locales.mjs',out),ts.transpileModule(readFileSync('app/i18n/locales.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 const {splitLocale,localePath,localizeLinks,dirOf}=await import(new URL('locales.mjs',out));
 assert.deepEqual(splitLocale('/fr/rankings/x'),{locale:'fr',path:'/rankings/x'});
 assert.deepEqual(splitLocale('/zh'),{locale:'zh',path:'/'});
 assert.deepEqual(splitLocale('/rankings/x'),{locale:'en',path:'/rankings/x'});
 assert.deepEqual(splitLocale('/xx/rankings'),{locale:'en',path:'/xx/rankings'});
 assert.equal(localePath('/','de'),'/de');assert.equal(localePath('/?ask=a','de'),'/de?ask=a');
 assert.equal(localePath('/rankings/x?rank=gdp','ja'),'/ja/rankings/x?rank=gdp');
 assert.equal(localePath('/rankings/x','en'),'/rankings/x');assert.equal(localePath('/fr/x','de'),'/fr/x','already in a language');
 const data={href:'/e/country/france',links:[{href:'/rankings/a?rank=b'},{href:'/rankings/a/data.csv'},{href:'https://x.org/'}],text:'Population',map:{france:'/e/country/france'}};
 const fr=localizeLinks(data,'fr');
 assert.equal(fr.href,'/fr/e/country/france');assert.equal(fr.links[0].href,'/fr/rankings/a?rank=b');
 assert.equal(fr.links[1].href,'/rankings/a/data.csv','downloads keep one address');assert.equal(fr.links[2].href,'https://x.org/');
 assert.equal(fr.map.france,'/fr/e/country/france');assert.equal(fr.text,'Population');
 assert.equal(localizeLinks('/geography/countries/germany','fr'),'/fr/geography/countries/germany');
 assert.equal(localizeLinks('/api/ask','fr'),'/api/ask');assert.equal(localizeLinks('/geo/world.json','fr'),'/geo/world.json');
 assert.equal(localizeLinks(data,'en'),data);
 assert.equal(dirOf('ar'),'rtl');assert.equal(dirOf('fr'),'ltr');
});
