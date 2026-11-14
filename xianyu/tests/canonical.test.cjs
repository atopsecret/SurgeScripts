// Node.js | 24+ | CommonJS
// Build: none; canonical standalone scripts only.
// Run: node --test xianyu/tests/canonical.test.cjs
// Deps: built-in node:test/vm; all network APIs mocked.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root, runSurge, parity, text, commonContext, commonModules, nativeParts, sections, evaluateRule } = require('../../egern/tests/canonical-fixture.cjs');
const xyBase='https://g-acs.m.goofish.com:443/gw/';
const xyCases=[
 ['mtop.taobao.idlecommerce.splash.ads',{data:{cacheAd:'cached',cacheAdInfo:{key:1},nested:{dspList:[1],ads:[1]},business:'ok'}}],
 ['mtop.taobao.idlecommerce.splash.async.ads',{data:JSON.stringify({adMap:{ad:1},business:'ok'})}],
 ['mtop.idle.idleadv.app.launch.report',{api:'original',ret:['SUCCESS::ok'],v:'2.0',data:{adList:[1],business:2}}],
 ['mtop.idle.idleadv.scene.restore',{data:{cacheAd:'ad',keep:2}}],
 ['mtop.idle.ad.expose',{data:{ads:[1],keep:3}}],
 ['mtop.taobao.idle.user.strategy.list',{data:{strategies:[{type:'BANNER'},{type:'BIZ_PUBLISH_BALL'},{type:'UNKNOWN'}]}}],
 ['mtop.taobao.idlehome.home.circle.list',{data:{circleList:[{trackParams:{args:{idleAdsToken:1,business:2}}}]}}]
];
for(const [api,input] of xyCases)test('Xianyu '+api+' preserves current Egern semantics',async()=>{await parity(12,xyBase+api+'/2.0',input);});
test('Xianyu six gateway hosts accepted',async()=>{for(const prefix of ['acs','g-acs','gw'])for(const host of ['goofish','taobao'])await parity(12,`https://${prefix}.m.${host}.com/gw/mtop.taobao.idlecommerce.splash.ads/2.0`,{data:{ads:[1]}});});
test('Xianyu failing/empty/unknown ret is never forged success',async()=>{for(const ret of [[],['FAIL::expired'],'SUCCESS']){const input={api:'original',v:'2.0',ret,data:{ads:[1]}};const result=await parity(12,xyBase+'mtop.idle.ad.expose/1.0',input);assert.equal(result.result.body,undefined);}});
test('Xianyu exact URL boundary excludes suffix lookalikes',()=>{const body=JSON.stringify({data:{ads:[1]}});for(const url of [xyBase+'mtop.idle.ad.exposeExtra/1.0','https://g-acs.m.goofish.com.evil.example/gw/mtop.idle.ad.expose/1.0'])assert.equal(runSurge(12,url,body).result.body,undefined);});
