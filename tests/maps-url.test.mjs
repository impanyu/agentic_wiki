import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('app/maps/url.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('Google Maps links become embeddable map targets',()=>{
 assert.deepEqual(m.parseGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=Nebraska+Sandhills'),{mode:'search',q:'Nebraska Sandhills',lat:undefined,lng:undefined,zoom:undefined});
 const place=m.parseGoogleMapsUrl('https://www.google.com/maps/place/Lincoln,+NE/@40.8136,-96.7026,12z');
 assert.equal(place.mode,'place');assert.equal(place.q,'Lincoln, NE');assert.equal(place.lat,40.8136);assert.equal(place.zoom,12);
 assert.deepEqual(m.parseGoogleMapsUrl('https://www.google.com/maps/@41.5,-100.2,8z'),{mode:'view',lat:41.5,lng:-100.2,zoom:8});
 const dir=m.parseGoogleMapsUrl('https://www.google.com/maps/dir/?api=1&origin=Omaha&destination=Lincoln&travelmode=driving');
 assert.equal(dir.mode,'directions');assert.equal(dir.origin,'Omaha');assert.equal(dir.destination,'Lincoln');
 assert.equal(m.parseGoogleMapsUrl('https://example.com/maps/place/x'),null);assert.equal(m.parseGoogleMapsUrl('https://www.google.com/search?q=x'),null);
});
test('embed URLs: keyed Maps Embed API or keyless classic embed, and a round trip through the route query',()=>{
 const t={mode:'place',q:'Lincoln, NE',zoom:12};
 assert.match(m.googleEmbedUrl(t,'KEY'),/^https:\/\/www\.google\.com\/maps\/embed\/v1\/place\?key=KEY&q=Lincoln%2C\+NE&zoom=12$/);
 assert.match(m.googleEmbedUrl(t),/^https:\/\/maps\.google\.com\/maps\?output=embed&q=Lincoln%2C\+NE&z=12$/);
 const path=m.embedPath({mode:'directions',origin:'Omaha',destination:'Lincoln'},'p1');
 assert.deepEqual(m.targetFromQuery(new URL('https://x'+path).searchParams),{mode:'directions',q:undefined,lat:undefined,lng:undefined,zoom:undefined,origin:'Omaha',destination:'Lincoln',travel:undefined});
 assert.equal(m.targetFromQuery(new URLSearchParams('mode=view&lat=1')),null);assert.equal(m.targetFromQuery(new URLSearchParams('mode=evil&q=x')),null);
});
