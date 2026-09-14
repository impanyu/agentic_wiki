import {test} from 'node:test';
import assert from 'node:assert/strict';
import {articleNodes,linkLevels} from '../app/internal-links.ts';
const link=(id,start,end,node='line0.0')=>({id,quote:id,targetId:id,targetTitle:id,segments:[{node,start,end}]});
test('nested and crossing links remain separate with longer ranges below shorter ranges',()=>{
 const links=[link('long',0,20),link('short',5,8),link('cross',7,15),link('separate',30,40)];
 const levels=linkLevels(links);assert.equal(levels.get('short'),0);assert.equal(levels.get('cross'),1);assert.equal(levels.get('long'),2);assert.equal(levels.get('separate'),0);
});
test('text coordinates preserve headings, emphasis, descriptive links and image credits without citation numbers',()=>{
 const nodes=articleNodes({title:'标题',summary:'摘要',body:'## 中国\n**北京** and [city](https://example.org/a) [example.org](https://example.org/a)\n![地图](https://upload.wikimedia.org/map.jpg)\n[署名](https://commons.wikimedia.org/wiki/File:Map.jpg)'});
 assert.equal(nodes.get('line0.0'),'中国');assert.equal(nodes.get('line1.1'),'北京');assert.equal(nodes.get('line1.3'),'city');assert.ok(!nodes.has('line1.5'));assert.equal(nodes.get('figure2.0'),'地图');assert.equal(nodes.get('credit2.1'),'署名');
});
