// Node.js | 24+ | CommonJS
// Build: none; canonical standalone scripts only.
// Run: node --test cainiao/tests/canonical.test.cjs
// Deps: built-in node:test/vm; all network APIs mocked.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root, runSurge, parity, text, commonContext, commonModules, nativeParts, sections, evaluateRule } = require('../../egern/tests/canonical-fixture.cjs');
const cn='https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn/1.0';
const cnData={ret:['SUCCESS::ok'],data:{data:{data:{mainSearch:{bizData:{searchContents:['ad'],keep:true}},operationList:['ad'],parcel:{code:'123'}},banner:{ad:1},activity:[],vip:{ad:1}}}};
test('Cainiao shared native page policy matches current Egern',async()=>{const result=await parity(6,cn,cnData,{binary:true});const data=JSON.parse(text(result.body));assert.equal(data.data.data.data.parcel.code,'123');assert.equal('operationList' in data.data.data.data,false);assert.equal('banner' in data.data.data,false);});
test('Cainiao exact non-CN alias preserves CN-only containers',async()=>{const value=structuredClone(cnData);const result=await parity(6,cn.replace('.fetch.cn','.fetch'),value);assert.deepEqual(JSON.parse(text(result.body)).data.data.banner,{ad:1});});
test('Cainiao longquan only deletes known place content',async()=>{const url='https://longquan-mtop.cainiao.com/gw/mtop.com.cainiao.longquan.place.getpageresourcecontent.cn/1.0';const result=await parity(6,url,{data:{result:{placeContentMap:{780001:{contentList:[1],keep:true},780002:{contentList:['business']}}}}});assert.deepEqual(JSON.parse(text(result.body)).data.result.placeContentMap['780002'].contentList,['business']);});
test('Cainiao HTTP and ret failures pass through',async()=>{for(const options of [{status:500},{status:200}]){const input={...cnData,ret:['FAIL::network']};const result=await parity(6,cn,input,options);assert.equal(result.result.body,undefined);}});
test('Cainiao precise host/path guard excludes other APIs',()=>{for(const url of ['https://evil.example/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn/1.0',cn+'/unexpected'])assert.equal(runSurge(6,url,JSON.stringify(cnData)).result.body,undefined);});
test('Cainiao invalid UTF-8 preserves bytes',()=>{const input=new Uint8Array([0xff,0xc0,0xaf]);const result=runSurge(6,cn,input,{binary:true});assert.deepEqual(result.body,input);});
test('Changed responses remove stale entity headers and preserve duplicate cookies',()=>{const headers=[{field:'Content-Type',value:'application/json'},{field:'Content-Length',value:'999'},{field:'ETag',value:'old'},{field:'Content-Encoding',value:'gzip'},{field:'Set-Cookie',value:'a=1'},{field:'Set-Cookie',value:'b=2'}];const result=runSurge(6,cn,JSON.stringify(cnData),{headers,binary:true});assert.deepEqual(result.result.headers.filter(h=>h.field==='Set-Cookie').map(h=>h.value),['a=1','b=2']);assert.equal(result.result.headers.some(h=>['etag','content-length','content-encoding'].includes(h.field.toLowerCase())),false);});
const manifest = { modules: commonModules() };
const sources = manifest.modules.map(entry => ({ id: entry.id, source: nativeParts(entry.id) }));
test('Cainiao UDP/QUIC rejection retains all nine exact hosts and TCP exception',()=>{const entry=manifest.modules.find(x=>x.id===6);const rules=sections(entry.sgmodule).Rule;const rule=rules.find(line=>line.includes('PROTOCOL,QUIC'));const hosts=sources.find(x=>x.id===6).source.mitm.hostnames.includes;for(const host of hosts){for(const protocol of ['UDP','QUIC'])assert.equal(evaluateRule(rule,{url:'https://'+host+'/business',protocol,port:443}),true);assert.equal(evaluateRule(rule,{url:'https://'+host+'/business',protocol:'TCP',port:443}),false);assert.equal(evaluateRule(rule,{url:'https://'+host+'/business',protocol:'UDP',port:8443}),false);}assert.equal(evaluateRule(rule,{url:'https://other.example/business',protocol:'UDP',port:443}),false);});
test('Cainiao shared CDN rejection still requires the Cainiao User-Agent',()=>{const rule=sections(manifest.modules.find(x=>x.id===6).sgmodule).Rule.find(line=>line.includes('tplv-noop'));const url='https://p3-sign.douyinpic.com/tos-cn-p-0051/rotation123~tplv-noop.image?a=1';assert.equal(evaluateRule(rule,{url,ua:'Cainiao4iPhone/10.0'}),true);assert.equal(evaluateRule(rule,{url,ua:'OtherApp/1.0'}),false);});
