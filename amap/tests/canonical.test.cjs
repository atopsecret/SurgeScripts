// Node.js | 24+ | CommonJS
// Build: none; canonical standalone scripts only.
// Run: node --test amap/tests/canonical.test.cjs
// Deps: built-in node:test/vm; all network APIs mocked.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root, runSurge, parity, text, commonContext, commonModules, nativeParts, sections, evaluateRule } = require('../../egern/tests/canonical-fixture.cjs');
const amapBase='https://m5.amap.com/ws/';
const amapCases=[
 ['message/notice/list',{data:{noticeList:[1],messages:['keep']}}],
 ['faas/amap-navigation/main-page-aiqs',{data:{cardList:[{dataType:'AdCard'},{dataType:'BusinessCard'}],mapBizList:[{isAd:true},{normal:true}],business_position:['ad']}}],
 ['shield/dsp/profile/index/nodefaasv3',{data:{tipData:{ad:1},cardList:[{dataType:'AdCard'},{name:'account'}]}}],
 ['msgbox/pull',{msgs:['ad'],data:{pull3:{msgs:['ad'],keep:true}}}],
 ['shield/search/new_hotword',{data:{header_hotword:['ad'],weather:'business'}}],
 ['shield/frogserver/aocs/updatable',{data:{SplashScreenControl:{version:'1',value:'ad'},navi_cloud:{value:JSON.stringify({music_sdk_recommend_title:'ad',unknown:'business',end_auto_foot_explore:1})},taxi:{value:JSON.stringify({denghuo_ad:1,unknown:3})}}}],
 ['shield/search/nearbyrec_smart',{data:{coupon:1,modules:['coupon','business'],business:'ok'}}],
 ['promotion-web/resource',{data:{popup:[1],bubble:[1],taxi:'keep'}}],
 ['shield/search/poi/detail',{data:{modules:{CouponBanner:{dataType:'AdCard'},business:{dataType:'BusinessCard'},anchor:{data:{items:[{anchor:['CouponBanner']},{anchor:['business']}]}}},regions:{main:['CouponBanner','business']}}}],
 ['shield/search_business/process/middleLayer/sug',{tip_list:[{tip:{result_type:'ad'}},{tip:{result_type:'normal'}},{unknown:true}]}],
 ['c3frontend/af-search/search',{data:{modules:{quickLink:{data:{list:[{badge:{text:'推广'},id:'business'}]}}}}}],
 ['boss/car/order/content_info',{data:{lubanData:{skin:'ad',kingToolBox:{dataList:[{biz:{id:'dache_toolbox_promo'}},{biz:{id:'business'}}]}}}}],
 ['amap/hitch/passenger/content_info',{data:{lubanData:{banner:'ad',order:'keep'}}}],
 ['opc/tools/list',{data:{category:[{tools:[{id:547},{id:1,tips:'ad',name:'business'}]}]}}],
 ['shield/scene/recommend',{data:{shadingWords:{data:{modules:{ad:{},business:{}},regions:{main:['ad','business']}}},toolsRecommend:{data:{default:[{id:547},{id:1}]}}}}]
];
for(const [route,input] of amapCases)test('AMap '+route+' parity with current Egern',async()=>{await parity(10,amapBase+route,{code:'1',result:'true',...input},{binary:true});});
test('AMap unknown tools and failed response are retained',async()=>{for(const input of [{code:'9',data:{category:[{tools:[{id:547}]}]}},{code:'1',data:{category:[{tools:[{id:1234,name:'unknown'}]}]}}])await parity(10,amapBase+'opc/tools/list',input);});
test('AMap non UTF-8 and broken bytes bypass',()=>{assert.equal(runSurge(10,amapBase+'opc/tools/list','{}',{headers:{'Content-Type':'application/json;charset=GBK'}}).result.body,undefined);assert.equal(runSurge(10,amapBase+'opc/tools/list',new Uint8Array([255]),{binary:true}).result.body,undefined);});
