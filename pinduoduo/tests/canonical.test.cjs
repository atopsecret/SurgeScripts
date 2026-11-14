// Node.js | 24+ | CommonJS
// Build: none; canonical standalone scripts only.
// Run: node --test pinduoduo/tests/canonical.test.cjs
// Deps: built-in node:test/vm; all network APIs mocked.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root, runSurge, parity, text, commonContext, commonModules, nativeParts, sections, evaluateRule } = require('../../egern/tests/canonical-fixture.cjs');
const pddBase='https://api.pinduoduo.com';
const tabs=['index.html','chat_list.html','video.html','personal.html'];
const pddCases=[
 ['/api/alexa/homepage/hub',{result:{bottom_tabs:tabs.map(link=>({link})),buffer_bottom_tabs:tabs.map(link=>({link})),all_top_opts:[{image:'ad',selected_image:'ad',height:1,width:2,name:'business'}],dy_module:{irregular_banner_dy:1,products:[1]},search_bar_hot_query:[1]}}],
 ['/api/philo/personal/hub',{monthly_card_entrance:1,personal_center_style_v2_vo:1,icon_set:{icons:[1],top_personal_icons:[1],profile:'keep'}}],
 ['/api/oak/integration/render',{bottom_section_list:[1],ui:{bottom_section:[1],live_section:{float_info:1,product:'keep'}}}],
 ['/order/123',{marketing_banner_vo:[1],shipping:{banner_above_recommend:1,logistics:'keep'}}],
 ['/api/aristotle/order_list_v4',{orders:[{order_buttons:[{order_growth_tip:1,name:'pay'}]}]}],
 ['/search',{expansion:{ad:1},goods:[1]}]
];
for(const [route,input] of pddCases)test('PDD '+route+' matches current Egern',async()=>{await parity(13,pddBase+route+'?a=1',input);});
test('PDD only trims tab list when all three core tabs exist',async()=>{const input={result:{bottom_tabs:[{link:'video.html'},{link:'unknown.html'}]}};const result=await parity(13,pddBase+'/api/alexa/homepage/hub',input);assert.equal(result.result.body,undefined);});
test('PDD raw IP needs exact API Host, including full-header mode',async()=>{const input=pddCases[0][1];for(const host of ['api.pinduoduo.com','api.yangkeduo.com:443'])await parity(13,'https://192.0.2.1/api/alexa/homepage/hub?x=1',input,{requestHeaders:[{field:'Host',value:host}]});});
test('PDD raw IP without exact host or substring spoof bypasses',()=>{const body=JSON.stringify(pddCases[0][1]);for(const host of ['evil.pinduoduo.com','api.pinduoduo.com.evil.example',''])assert.equal(runSurge(13,'https://192.0.2.1/api/alexa/homepage/hub?x=1',body,{requestHeaders:{Host:host,'User-Agent':'pinduoduo'}}).result.body,undefined);});
test('PDD error responses retain original JSON',async()=>{for(const extra of [{success:false},{error_code:403}]){const data={...pddCases[0][1],...extra};const result=await parity(13,pddBase+'/api/alexa/homepage/hub',data);assert.equal(result.result.body,undefined);}});
const manifest = { modules: commonModules() };
const sources = manifest.modules.map(entry => ({ id: entry.id, source: nativeParts(entry.id) }));
test('PDD popup scope matches only m.pinduoduo.net and MITM contains it',()=>{const entry=manifest.modules.find(x=>x.id===13);const parsed=sections(entry.sgmodule);const line=parsed['Map Local'].find(x=>x.includes('vlayer_tab_popup'));const pattern=new RegExp(line.slice(0,line.indexOf(' data-type=')));assert.ok(pattern.test('https://m.pinduoduo.net/vlayer_tab_popup.html?a=1'));assert.equal(pattern.test('https://other.example/vlayer_tab_popup.html?a=1'),false);assert.ok(parsed.MITM[0].includes('m.pinduoduo.net'));});
test('PDD raw-IP advertising material requires exact d path and PDD User-Agent',()=>{const rule=sections(manifest.modules.find(x=>x.id===13).sgmodule).Rule[0];assert.equal(evaluateRule(rule,{url:'http://192.0.2.10/d1?a=1',ua:'com.xunmeng.pinduoduo/1'}),true);assert.equal(evaluateRule(rule,{url:'http://192.0.2.10/d1?a=1',ua:'OtherApp'}),false);assert.equal(evaluateRule(rule,{url:'http://192.0.2.10/download?a=1',ua:'com.xunmeng.pinduoduo/1'}),false);});
