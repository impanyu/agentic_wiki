import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import ts from 'typescript';
// Entity types inherit like classes along the topic tree: the effective schema and template are the ancestors' merged
// with the type's own (most general first); a subtype only adds.
const out=new URL('../node_modules/.cache/inherit-test/',import.meta.url);mkdirSync(out,{recursive:true});
for(const [f,src] of Object.entries({client:'../app/entity-db/client.ts',schema:'../app/entity-db/schema.ts',reserved:'../app/entity-db/reserved.ts',inherit:'../app/entity-db/inherit.ts'})){
 let js=ts.transpileModule(readFileSync(new URL(src,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 js=js.replace(/(from\s*|import\()\s*(['"])([^'"]+)\2/g,(m,pre,q,spec)=>spec.startsWith('./')?`${pre}'${spec}.mjs'`:m);writeFileSync(new URL(f+'.mjs',out),js);
}
const client=await import(new URL('client.mjs',out));const inh=await import(new URL('inherit.mjs',out));
const db=await client.createEntityDb({memory:true,embedDim:8});test.after(()=>db.close());
test('a subtype has everything its ancestors have, plus its own; it cannot drop an inherited item',async()=>{
 const t=async(type,schema,template)=>db.query("insert into entity_types(type,schema,template) values ($1,$2::jsonb,$3::jsonb)",[type,JSON.stringify(schema),JSON.stringify(template)]);
 await t('home_appliance',{metrics:[{key:'price'},{key:'power_w'}],attributes:['brand']},{lead:['{name} is a home appliance.'],card:['metric.price'],sections:[{kind:'rankings'},{kind:'trend',metrics:['price']}]});
 await t('blender',{extends:'home_appliance',metrics:[{key:'speeds'}],attributes:['jar']},{card:['metric.speeds'],sections:[{kind:'peer_compare',metrics:['speeds']}]});
 await t('pro_blender',{extends:'blender',metrics:[{key:'max_rpm'},{key:'price',label:'Street price'}]},{lead:['{name} is a high-performance blender.']});
 const e=await inh.effectiveType(db,'pro_blender');
 assert.deepEqual(e.extends,['blender','home_appliance']);
 assert.deepEqual(e.schema.metrics.map(m=>m.key),['price','power_w','speeds','max_rpm']);
 assert.equal(e.schema.metrics[0].label,'Street price','a subtype may refine an inherited item, not drop it');
 assert.deepEqual(e.schema.attributes,['brand','jar']);
 assert.deepEqual(e.template.lead,['{name} is a high-performance blender.']);
 assert.deepEqual(e.template.card,['metric.price','metric.speeds']);
 assert.deepEqual(e.template.sections.map(s=>s.kind),['rankings','trend','peer_compare']);
 const b=await inh.effectiveType(db,'blender');assert.deepEqual(b.template.lead,['{name} is a home appliance.'],'no lead of its own: the ancestor\'s');
});
test('a type includes every type that extends it, at any depth (is-a)',async()=>{
 inh.clearTypeCache();
 assert.deepEqual(await inh.withSubtypes(db,'home_appliance'),['home_appliance','blender','pro_blender']);
 assert.deepEqual(await inh.withSubtypes(db,'pro_blender'),['pro_blender']);
});
test('interfaces (mixins): a type also has what its declared interfaces define, inherited down its line',async()=>{
 const t=async(type,schema,template={})=>db.query("insert into entity_types(type,schema,template) values ($1,$2::jsonb,$3::jsonb)",[type,JSON.stringify(schema),JSON.stringify(template)]);
 await t('iface_aircraft',{kind:'interface',metrics:[{key:'range_km'},{key:'max_altitude_m'}]},{sections:[{kind:'trend',metrics:['range_km']}]});
 await t('military_equipment',{metrics:[{key:'units_in_service'}]});
 await t('military_drone',{extends:'military_equipment',interfaces:['iface_aircraft'],metrics:[{key:'payload_kg'}]});
 await t('mq9',{extends:'military_drone',metrics:[{key:'endurance_h'}]});
 const e=await inh.effectiveType(db,'mq9');
 assert.deepEqual(e.extends,['military_drone','military_equipment']);assert.deepEqual(e.interfaces,['iface_aircraft']);
 assert.deepEqual(e.schema.metrics.map(m=>m.key),['units_in_service','range_km','max_altitude_m','payload_kg','endurance_h']);
 assert.equal(e.template.sections.length,1,'interface sections come in too');
 inh.clearTypeCache();assert.deepEqual(await inh.withSubtypes(db,'iface_aircraft'),['iface_aircraft'],'an interface does not pull its users into its rankings');
});
