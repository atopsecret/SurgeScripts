// Node.js | 24+ | CommonJS
// Build: none; canonical standalone scripts only.
// Run: node --test jd/tests/canonical.test.cjs
// Deps: built-in node:test/vm; all network APIs mocked.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root, runSurge, parity, text, commonContext, commonModules, nativeParts, sections, evaluateRule } = require('../../egern/tests/canonical-fixture.cjs');
const jdBase='https://api.m.jd.com/client.action?client=iphone&functionId=';
const jdCases=[
 ['start',{images:[{ad:1}],showTimesDaily:3,config:'keep'}],
 ['welcomeHome',{floorList:[{type:'float'},{type:'product'}],webViewFloorList:[1],goods:'keep'}],
 ['deliverLayer',{bannerInfo:{ad:1},floors:[{mId:'banner'},{mId:'order'}]}],
 ['basicConfig',{JDHttpToolKit:{httpdns:{httpdns:1}},JDMessage:{socketmonitor:{isSocketReport:1}}}],
 ['cart',{cartLocationMap:{loc_emptyCartFloor2:1,items:[1]},emptyCartRecommendFloor:1}],
 ['secondFloor',{data:{recommendFloor:1,product:2}}],
 ['lite_advertising',{nested:{jdLiteAdvertisingVO:{ad:1}}}],
 ['readCustomSurfaceList',{nodeMap:{normal:{navigationAll:[{cutLabelName:'首页'},{cutLabelName:'视频'},{cutLabelName:'购物车'},{cutLabelName:'我的'},{cutLabelName:'未知新功能'}]}}}],
 ['getTabHomeInfo',{result:{iconInfo:1,roofTop:2,products:[1]}}],
 ['myOrderInfo',{floors:[{mId:'bannerFloor'},{mId:'orders'},{mId:'virtualServiceCenter',data:{virtualServiceCenters:[{serviceList:[{serviceTitle:'精选特惠'},{serviceTitle:'订单服务'}]}]}}]}],
 ['orderTrackBusiness',{bannerInfo:1,floors:[{mId:'jdDeliveryBanner'},{mId:'logistics'}]}],
 ['personinfoBusiness',{floors:[{mId:'newsFloor'},{mId:'basefloorinfo',data:{commonPopup:1,account:'keep'}},{mId:'userinfo',data:{newPlusBlackCard:1,name:'keep'}}]}]
];
for(const [id,input] of jdCases)test('JD '+id+' parity with query functionId',async()=>{await parity(11,jdBase+id,input,{binary:true});});
test('JD duplicate or escaped functionId keys bypass',()=>{for(const query of ['functionId=start&functionId=cart','function%49d=start','functionId=startExtra','functionId=start&function%49d=cart'])assert.equal(runSurge(11,'https://api.m.jd.com/client.action?'+query,JSON.stringify(jdCases[0][1])).result.body,undefined);});
test('JD body-only POST remains untouched without enabled association',()=>{assert.equal(runSurge(11,'https://api.m.jd.com/client.action',JSON.stringify(jdCases[0][1]),{method:'POST',requestBody:'functionId=start'}).result.body,undefined);});
test('JD POST carrying query identity preserves method and works',async()=>{await parity(11,jdBase+'start',jdCases[0][1],{method:'POST',requestBody:'irrelevant=1'});});
test('JD unknown navigation survives',async()=>{const data={nodeMap:{normal:{navigationAll:[{cutLabelName:'unknown-video'}]}}};const result=await parity(11,jdBase+'readCustomSurfaceList',data);assert.equal(result.result.body,undefined);});
const manifest = { modules: commonModules() };
const sources = manifest.modules.map(entry => ({ id: entry.id, source: nativeParts(entry.id) }));
test('JD optional POST association remains commented out',()=>{const entry=manifest.modules.find(x=>x.id===11);const parsed=sections(entry.sgmodule);assert.equal(parsed.Script.some(line=>line.includes('type=http-request')),false);const text=fs.readFileSync(entry.sgmodule,'utf8');assert.match(text,/^# 京东去广告 POST 关联 =/m);});
test('Optional JD capture is functional only after explicit invocation and same request ID',()=>{
 const context=commonContext();let result,done=0;context.$done=value=>{result=value;done++;};
 context.$request={url:'https://api.m.jd.com/client.action',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},id:'association-test',body:'functionId=start&client=iphone'};
 vm.createContext(context);new vm.Script(fs.readFileSync(path.join(root,'jd/jd-post-capture.js'),'utf8')).runInContext(context,{timeout:2000});
 assert.equal(done,1);assert.equal(Object.keys(result).length,0);assert.ok(context.store.has('skernelx_jd_pending_v2'));
 const body=JSON.stringify({images:[{ad:1}],showTimesDaily:1,keep:true});
 const response=runSurge(11,'https://api.m.jd.com/client.action',body,{method:'POST',id:'association-test',initialStore:context.store});
 assert.deepEqual(JSON.parse(text(response.body)).images,[]);
 assert.equal(runSurge(11,'https://api.m.jd.com/client.action',body,{method:'POST',id:'association-test',initialStore:response.store}).result.body,undefined);
});
