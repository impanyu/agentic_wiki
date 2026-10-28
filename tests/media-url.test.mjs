import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFileSync} from 'node:fs';
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('app/workflows/viz/media-url.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const {mediaSource,fmtTime,safeMediaUrl}=m;

test('only https URLs and same-site paths are accepted',()=>{
  for(const bad of ['http://x.test/a.mp4','javascript:alert(1)','data:video/mp4;base64,AAAA','data:audio/mp3;base64,AAAA','//evil.test/a.mp4','/\\evil.test/a.mp4','ftp://x.test/a.mp3','','   ',null,undefined,42,{},'https://x.test/a b.mp4','not a url'])
    assert.equal(mediaSource(bad),null,String(bad));
  assert.deepEqual(mediaSource('/media/clip.mp4'),{url:'/media/clip.mp4',kind:'video'});
  assert.deepEqual(mediaSource(' https://cdn.test/a.mp3 '),{url:'https://cdn.test/a.mp3',kind:'audio'});
  assert.equal(safeMediaUrl('https://cdn.test/subs.vtt'),'https://cdn.test/subs.vtt');
});

test('kind is detected by extension, ignoring query and case',()=>{
  const k=s=>mediaSource(s)?.kind;
  assert.equal(k('https://s.test/live/index.m3u8?token=1'),'hls');
  assert.equal(k('https://s.test/manifest.MPD'),'dash');
  for(const e of ['mp3','wav','ogg','oga','m4a','aac','flac','opus'])assert.equal(k('/a/b.'+e),'audio',e);
  for(const e of ['mp4','webm','mov','m4v','ogv'])assert.equal(k('/a/b.'+e),'video',e);
  assert.equal(k('https://s.test/stream'),'video');
  assert.equal(k('/files/x.m3u8.txt'),'video');
});

test('YouTube links become privacy-enhanced embeds',()=>{
  const id='dQw4w9WgXcQ',embed='https://www.youtube-nocookie.com/embed/'+id;
  for(const u of ['https://www.youtube.com/watch?v='+id,'https://youtube.com/watch?v='+id+'&list=x','https://m.youtube.com/watch?v='+id,'https://youtu.be/'+id,'https://www.youtube.com/shorts/'+id,'https://www.youtube.com/embed/'+id])
    assert.deepEqual(mediaSource(u),{url:embed,kind:'youtube'},u);
  assert.equal(mediaSource('https://youtu.be/'+id+'?t=90').url,embed+'?start=90');
  assert.equal(mediaSource('https://www.youtube.com/watch?v='+id+'&t=1m5s').url,embed+'?start=65');
  assert.equal(mediaSource('https://www.youtube.com/watch?v=bad"id').kind,'video');
  assert.equal(mediaSource('http://youtu.be/'+id),null);
});

test('Vimeo links become player embeds',()=>{
  assert.deepEqual(mediaSource('https://vimeo.com/76979871'),{url:'https://player.vimeo.com/video/76979871',kind:'vimeo'});
  assert.equal(mediaSource('https://vimeo.com/76979871/abc123').url,'https://player.vimeo.com/video/76979871?h=abc123');
  assert.equal(mediaSource('https://player.vimeo.com/video/76979871').kind,'vimeo');
  assert.equal(mediaSource('https://vimeo.com/channels/staffpicks/76979871').url,'https://player.vimeo.com/video/76979871');
  assert.equal(mediaSource('https://vimeo.com/about').kind,'video');
});

test('fmtTime formats m:ss and h:mm:ss',()=>{
  assert.equal(fmtTime(0),'0:00');assert.equal(fmtTime(5.9),'0:05');assert.equal(fmtTime(75),'1:15');
  assert.equal(fmtTime(3600),'1:00:00');assert.equal(fmtTime(3725),'1:02:05');
  assert.equal(fmtTime(NaN),'0:00');assert.equal(fmtTime(Infinity),'0:00');assert.equal(fmtTime(-3),'0:00');
});
