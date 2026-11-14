// Node.js | 24+ | CommonJS
// Run: node --test surge-ios/tests/common.test.cjs
// Deps: built-in node:test/vm; all HTTP clients mocked to fail if called.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { publishRoot: root, fixtureRoot, loadModuleFixture } = require('./layout.cjs');
const commonFixtures = path.join(fixtureRoot, 'common');
const aliases = {6:'cainiao-adblock',10:'amap-cleaner',11:'jd-adblock',12:'xianyu-adblock',13:'pdd-adblock',15:'jyjt-member'};
const originals = {6:'cainiao',10:'amap',11:'jd',12:'xianyu',13:'pdd',15:'jyjt'};
class MockHeaders {
  constructor(value={}) { this.entries=Array.isArray(value)?value.map(x=>[x.field,x.value]):Object.entries(value); }
  get(name) { const item=this.entries.find(x=>x[0].toLowerCase()===name.toLowerCase());return item?item[1]:null; }
  getAll(name) {return this.entries.filter(x=>x[0].toLowerCase()===name.toLowerCase()).map(x=>x[1]);}
  set(name,value) {this.delete(name);this.entries.push([name,value]);}
  delete(name) {this.entries=this.entries.filter(x=>x[0].toLowerCase()!==name.toLowerCase());}
  append(name,value) {this.entries.push([name,value]);}
}
function bytes(value) { return typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value); }
function text(value) { return typeof value==='string'?value:new TextDecoder('utf-8',{fatal:true}).decode(value); }
function commonContext() {
 const store=new Map(),logs=[];
 const context={URL,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,console:{log:x=>logs.push(String(x))},module:{exports:{}},$persistentStore:{read:k=>store.get(k)||null,write:(v,k)=>{store.set(k,v);return true;}},$httpClient:new Proxy({}, {get(){return ()=>{throw Error('Forbidden real HTTP API in mock test');};}}),fetch:()=>{throw Error('Forbidden real fetch in mock test');},store,logs};
 return context;
}
function runSurge(id,url,body,options={}) {
 const context=commonContext();let result,doneCount=0;
 if(options.initialStore)for(const [key,value]of options.initialStore)context.store.set(key,value);
 context.$done=value=>{doneCount++;result=value||{};};
 if(url!==null){context.$request={url,method:options.method||'GET',headers:options.requestHeaders||{},id:options.id||'test-request',body:options.requestBody};context.$response={status:options.status??200,headers:options.headers||{'Content-Type':id===15?'text/xml; charset=utf-8':'application/json'},body:options.binary?bytes(body):body};}
 vm.createContext(context);new vm.Script(fs.readFileSync(path.join(root,'scripts','common-'+aliases[id]+'.js'),'utf8')).runInContext(context,{timeout:2000});
 assert.equal(doneCount,1,'Surge completion must run once');
 return {result,body:result.body===undefined?body:result.body,logs:context.logs,store:context.store};
}
async function runEgern(id,url,body,options={}) {
 const context=commonContext();const input=bytes(body);
 const headers=new MockHeaders(options.headers||{'Content-Type':id===15?'text/xml; charset=utf-8':'application/json'});
 const ctx={request:{url,method:options.method||'GET',headers:new MockHeaders(options.requestHeaders||{}),text:async()=>options.requestBody||''},response:{status:options.status??200,headers,arrayBuffer:async()=>input.slice().buffer,text:async()=>text(input)},storage:{getJSON:k=>context.store.has(k)?JSON.parse(context.store.get(k)):null,setJSON:(k,v)=>context.store.set(k,JSON.stringify(v))}};
 let source=fs.readFileSync(path.join(commonFixtures,'cache',originals[id]+'-egern.js'),'utf8');
 source=source.replace(/^export\s+\{[^\n]+\};?\s*$/gm,'').replace(/export default async function\(ctx\)/,'async function __egernHandler(ctx)').replace(/\bexport (const|function) /g,'$1 ');
 context.ctx=ctx;
 vm.createContext(context);new vm.Script(source).runInContext(context,{timeout:2000});
 const result=await new vm.Script('__egernHandler(ctx)').runInContext(context,{timeout:2000});
 return {result:result||{},body:result&&result.body!==undefined?result.body:body};
}
function jsonResponse(value) {return JSON.stringify(value);}
async function parity(id,url,input,options={}) {
 const original=typeof input==='string'?input:JSON.stringify(input);
 const surge=runSurge(id,url,original,options);const egern=await runEgern(id,url,original,options);
 assert.equal(text(surge.body),text(egern.body),'Migrated body differs from current Egern behavior');
 return surge;
}
const cn='https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn/1.0';
const cnData={ret:['SUCCESS::ok'],data:{data:{data:{mainSearch:{bizData:{searchContents:['ad'],keep:true}},operationList:['ad'],parcel:{code:'123'}},banner:{ad:1},activity:[],vip:{ad:1}}}};
test('Cainiao shared native page policy matches current Egern',async()=>{const result=await parity(6,cn,cnData,{binary:true});const data=JSON.parse(text(result.body));assert.equal(data.data.data.data.parcel.code,'123');assert.equal('operationList' in data.data.data.data,false);assert.equal('banner' in data.data.data,false);});
test('Cainiao exact non-CN alias preserves CN-only containers',async()=>{const value=structuredClone(cnData);const result=await parity(6,cn.replace('.fetch.cn','.fetch'),value);assert.deepEqual(JSON.parse(text(result.body)).data.data.banner,{ad:1});});
test('Cainiao longquan only deletes known place content',async()=>{const url='https://longquan-mtop.cainiao.com/gw/mtop.com.cainiao.longquan.place.getpageresourcecontent.cn/1.0';const result=await parity(6,url,{data:{result:{placeContentMap:{780001:{contentList:[1],keep:true},780002:{contentList:['business']}}}}});assert.deepEqual(JSON.parse(text(result.body)).data.result.placeContentMap['780002'].contentList,['business']);});
test('Cainiao HTTP and ret failures pass through',async()=>{for(const options of [{status:500},{status:200}]){const input={...cnData,ret:['FAIL::network']};const result=await parity(6,cn,input,options);assert.equal(result.result.body,undefined);}});
test('Cainiao precise host/path guard excludes other APIs',()=>{for(const url of ['https://evil.example/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn/1.0',cn+'/unexpected'])assert.equal(runSurge(6,url,JSON.stringify(cnData)).result.body,undefined);});
test('Cainiao invalid UTF-8 preserves bytes',()=>{const input=new Uint8Array([0xff,0xc0,0xaf]);const result=runSurge(6,cn,input,{binary:true});assert.deepEqual(result.body,input);});
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
const soapURL='http://smoke.nxnresearch.com/webservice510.asmx';
const soap='<soap:Envelope><soap:Body><response>{"member_flg" : 0, "user_type":0,"member_end_date":null,"unknown":"keep"}</response></soap:Body></soap:Envelope>';
test('SOAP modifies only complete zero/null values and retains XML',async()=>{const result=await parity(15,soapURL,soap,{method:'POST',binary:true});const output=text(result.body);assert.match(output,/"member_flg" : 1/);assert.match(output,/"member_end_date":"2099-12-31"/);assert.match(output,/<soap:Envelope>/);assert.match(output,/"unknown":"keep"/);});
test('SOAP fractional numeric values and existing dates are not broadened',async()=>{const input=soap.replace('"member_flg" : 0','"member_flg" : 0.5').replace('"user_type":0','"user_type":0e2').replace('null','"2027-01-01"');const result=await parity(15,soapURL,input,{method:'POST'});assert.equal(result.result.body,undefined);});
test('SOAP Fault and HTTP errors bypass',async()=>{for(const [input,options] of [[soap.replace('<soap:Body>','<soap:Body><soap:Fault>error</soap:Fault>'),{}],[soap,{status:500}]]){const result=await parity(15,soapURL,input,{method:'POST',...options});assert.equal(result.result.body,undefined);}});
test('SOAP non-target/HTTPS and unsupported XML encoding bypass',()=>{for(const url of [soapURL+'Extra','https://smoke.nxnresearch.com/webservice510.asmx','http://other.example/webservice510.asmx'])assert.equal(runSurge(15,url,soap,{method:'POST'}).result.body,undefined);assert.equal(runSurge(15,soapURL,'<?xml version="1.0" encoding="GBK"?>'+soap,{method:'POST'}).result.body,undefined);});
test('Changed responses remove stale entity headers and preserve duplicate cookies',()=>{const headers=[{field:'Content-Type',value:'application/json'},{field:'Content-Length',value:'999'},{field:'ETag',value:'old'},{field:'Content-Encoding',value:'gzip'},{field:'Set-Cookie',value:'a=1'},{field:'Set-Cookie',value:'b=2'}];const result=runSurge(6,cn,JSON.stringify(cnData),{headers,binary:true});assert.deepEqual(result.result.headers.filter(h=>h.field==='Set-Cookie').map(h=>h.value),['a=1','b=2']);assert.equal(result.result.headers.some(h=>['etag','content-length','content-encoding'].includes(h.field.toLowerCase())),false);});
test('Manual diagnostics are local only and never create widgets',()=>{for(const id of [6,10,11,12,13]){const result=runSurge(id,null,'');assert.equal(Object.keys(result.result).length,0);assert.ok(result.logs.length);assert.equal(result.logs.some(line=>line.includes('type":"widget')),false);}});
function sections(file){const result={};let active;for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const match=line.match(/^\[([^\]]+)\]$/);if(match){active=match[1];result[active]=result[active]||[];}else if(active&&line.trim()&&!line.trim().startsWith('#'))result[active].push(line.trim());}return result;}
const manifest={modules:loadModuleFixture('common')};
const sources=JSON.parse(fs.readFileSync(path.join(commonFixtures,'parsed-sources.json'),'utf8'));
test('Static rule/Map Local counts equal all seven active Egern sources',()=>{for(const entry of manifest.modules){const source=sources.find(x=>x.id===entry.id).source;const parsed=sections(entry.sgmodule);assert.equal((parsed.Rule||[]).length,(source.rules||[]).length);assert.equal((parsed['Map Local']||[]).length,(source.map_locals||[]).length);}});
test('Every Map Local preserves source status, headers and exact bytes',()=>{for(const entry of manifest.modules){const source=sources.find(x=>x.id===entry.id).source;const maps=sections(entry.sgmodule)['Map Local']||[];for(const [index,item]of(source.map_locals||[]).entries()){const line=maps[index];assert.equal(line.slice(0,line.indexOf(' data-type=')),item.match);const data=/data="([^"]*)"/.exec(line)[1];assert.equal(Buffer.from(data,'base64').toString('utf8'),item.body||'');assert.ok(line.includes('status-code='+item.status_code));for(const [key,value]of Object.entries(item.headers||{}))assert.ok(line.includes(`${key}:${value}`));}}});
test('PDD popup scope matches only m.pinduoduo.net and MITM contains it',()=>{const entry=manifest.modules.find(x=>x.id===13);const parsed=sections(entry.sgmodule);const line=parsed['Map Local'].find(x=>x.includes('vlayer_tab_popup'));const pattern=new RegExp(line.slice(0,line.indexOf(' data-type=')));assert.ok(pattern.test('https://m.pinduoduo.net/vlayer_tab_popup.html?a=1'));assert.equal(pattern.test('https://other.example/vlayer_tab_popup.html?a=1'),false);assert.ok(parsed.MITM[0].includes('m.pinduoduo.net'));});
test('Hongguo retains exactly 78 rules and excludes public DNS/video hosts',()=>{const entry=manifest.modules.find(x=>x.id===14);const parsed=sections(entry.sgmodule);assert.equal(parsed.Rule.length,78);for(const host of ['dns.alidns.com','doh.pub','v5-reading-video.qznovelvod.com'])assert.equal(parsed.Rule.some(line=>line.split(',')[1]===host),false);assert.ok(parsed.Rule.some(line=>line.includes('v5-reading-ad.qznovelvod.com')));});
test('JD optional POST association remains commented out',()=>{const entry=manifest.modules.find(x=>x.id===11);const parsed=sections(entry.sgmodule);assert.equal(parsed.Script.some(line=>line.includes('type=http-request')),false);const text=fs.readFileSync(entry.sgmodule,'utf8');assert.match(text,/^# ios-jd-adblock-post-association =/m);});
test('Remote module paths and no runtime Egern/native widget remnants',()=>{const names=[];for(const entryof of manifest.modules){const parsed=sections(entryof.sgmodule);assert.equal(Object.hasOwn(parsed,'Module'),false);for(const line of parsed.Script||[]){names.push(line.split('=')[0].trim());assert.match(line,/script-path=https:\/\/raw\.githubusercontent\.com\/atopsecret\/SurgeScripts\/main\/surge-ios\/scripts\/common-[a-z0-9-]+\.js(?:,|\s|$)/);assert.equal(/\/(?:Users|home)\//.test(line),false);assert.equal(line.includes('127.0.0.1'),false);}for(const script of entryof.scripts){const code=fs.readFileSync(script.sourcePath,'utf8');assert.equal(/export default|ctx\.(request|response|storage)|type:\s*["']widget/.test(code),false);}}assert.equal(new Set(names).size,names.length);assert.ok(names.every(name=>name.startsWith('ios-')));});


test('Optional JD capture is functional only after explicit invocation and same request ID',()=>{
 const context=commonContext();let result,done=0;context.$done=value=>{result=value;done++;};
 context.$request={url:'https://api.m.jd.com/client.action',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},id:'association-test',body:'functionId=start&client=iphone'};
 vm.createContext(context);new vm.Script(fs.readFileSync(path.join(root,'scripts/common-jd-post-capture.js'),'utf8')).runInContext(context,{timeout:2000});
 assert.equal(done,1);assert.equal(Object.keys(result).length,0);assert.ok(context.store.has('ios_common_jd_pending_v2'));
 const body=JSON.stringify({images:[{ad:1}],showTimesDaily:1,keep:true});
 const response=runSurge(11,'https://api.m.jd.com/client.action',body,{method:'POST',id:'association-test',initialStore:context.store});
 assert.deepEqual(JSON.parse(text(response.body)).images,[]);
 assert.equal(runSurge(11,'https://api.m.jd.com/client.action',body,{method:'POST',id:'association-test',initialStore:response.store}).result.body,undefined);
});
function splitTop(value){const parts=[];let begin=0,level=0,quoted=false,escaped=false;for(let i=0;i<value.length;i++){const c=value[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"')quoted=true;else if(c==='(')level++;else if(c===')')level--;else if(c===','&&level===0){parts.push(value.slice(begin,i));begin=i+1;}}parts.push(value.slice(begin));return parts;}
function evaluateRule(expression,input){const tokens=splitTop(expression),kind=tokens[0],value=String(tokens[1]||'').replace(/^"|"$/g,'');if(kind==='AND'||kind==='OR'||kind==='NOT'){const children=splitTop(value.slice(1,-1)).map(child=>child.slice(1,-1));if(kind==='AND')return children.every(child=>evaluateRule(child,input));if(kind==='OR')return children.some(child=>evaluateRule(child,input));return !children.every(child=>evaluateRule(child,input));}if(kind==='DOMAIN')return new URL(input.url).hostname===value;if(kind==='DOMAIN-SUFFIX'){const host=new URL(input.url).hostname;return host===value||host.endsWith('.'+value);}if(kind==='DOMAIN-KEYWORD')return new URL(input.url).hostname.includes(value);if(kind==='PROTOCOL')return input.protocol===value;if(kind==='DEST-PORT')return Number(input.port)===Number(value);if(kind==='URL-REGEX')return new RegExp(value).test(input.url);if(kind==='USER-AGENT'){const pattern=value.split('*').map(part=>part.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')).join('.*');return new RegExp('^'+pattern+'$').test(input.ua||'');}throw new Error('Unexpected mock predicate '+kind);}
test('Cainiao UDP/QUIC rejection retains all nine exact hosts and TCP exception',()=>{const entry=manifest.modules.find(x=>x.id===6);const rules=sections(entry.sgmodule).Rule;const rule=rules.find(line=>line.includes('PROTOCOL,QUIC'));const hosts=sources.find(x=>x.id===6).source.mitm.hostnames.includes;for(const host of hosts){for(const protocol of ['UDP','QUIC'])assert.equal(evaluateRule(rule,{url:'https://'+host+'/business',protocol,port:443}),true);assert.equal(evaluateRule(rule,{url:'https://'+host+'/business',protocol:'TCP',port:443}),false);assert.equal(evaluateRule(rule,{url:'https://'+host+'/business',protocol:'UDP',port:8443}),false);}assert.equal(evaluateRule(rule,{url:'https://other.example/business',protocol:'UDP',port:443}),false);});
test('Cainiao shared CDN rejection still requires the Cainiao User-Agent',()=>{const rule=sections(manifest.modules.find(x=>x.id===6).sgmodule).Rule.find(line=>line.includes('tplv-noop'));const url='https://p3-sign.douyinpic.com/tos-cn-p-0051/rotation123~tplv-noop.image?a=1';assert.equal(evaluateRule(rule,{url,ua:'Cainiao4iPhone/10.0'}),true);assert.equal(evaluateRule(rule,{url,ua:'OtherApp/1.0'}),false);});
test('PDD raw-IP advertising material requires exact d path and PDD User-Agent',()=>{const rule=sections(manifest.modules.find(x=>x.id===13).sgmodule).Rule[0];assert.equal(evaluateRule(rule,{url:'http://192.0.2.10/d1?a=1',ua:'com.xunmeng.pinduoduo/1'}),true);assert.equal(evaluateRule(rule,{url:'http://192.0.2.10/d1?a=1',ua:'OtherApp'}),false);assert.equal(evaluateRule(rule,{url:'http://192.0.2.10/download?a=1',ua:'com.xunmeng.pinduoduo/1'}),false);});
