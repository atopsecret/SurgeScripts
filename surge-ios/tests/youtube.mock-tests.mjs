// Node.js | 24+ | ES modules
// Run: node surge-ios/tests/youtube.mock-tests.mjs
// All HTTP, account, playback, caption and download fixtures are synthetic.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { publishRoot: root, fixtureRoot, scriptEntries } = require('./layout.cjs');
const readFixture = name => fs.readFileSync(path.join(fixtureRoot, 'youtube', name), 'utf8');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(readFixture('reference.json'));
const requestCode = read('scripts/youtube-id8-request-dispatch.js');
const responseCode = read('scripts/youtube-id8-response-dispatch.js');
const compatCode = readFixture('runtime-compat.js');
const results = [];
let mockedNetworkCalls = 0;
const common = {
  Uint8Array, Uint16Array, Uint32Array, Int32Array, ArrayBuffer, DataView,
  TextEncoder, TextDecoder, CompressionStream, DecompressionStream,
};
const fixture = vm.createContext({ ...common, console: { log() {} }, $request: { url: '' }, $persistentStore: { read() { return null; }, write() { return true; } } });
let original = readFixture('youtube-response.js');
assert.match(original, /\bmain\(\);\s*$/);
original = original.replace(/\bmain\(\);\s*$/, 'globalThis.fixture = {codec,wireFields,varint,encodeBase64,UmpWriter,UmpReader};');
vm.runInContext(original, fixture, { timeout: 1500 });
const api = fixture.fixture;
const encode = (type, model) => api.codec(type).toBinary(model);
const decode = (type, bytes) => api.codec(type).fromBinary(bytes);
const bytesEqual = (left, right) => assert.equal(Buffer.from(left).toString('hex'), Buffer.from(right).toString('hex'));
const concat = (...parts) => new Uint8Array(Buffer.concat(parts.map(value => Buffer.from(value))));
function numberField(number, value) { return concat(api.varint(number * 8), api.varint(value)); }
function binaryField(number, value) { return concat(api.varint(number * 8 + 2), api.varint(value.length), value); }
function playerFixture() {
  return {
    adPlacements: [new Uint8Array([1, 2, 3])], adSlots: [new Uint8Array([4, 5])], paidPromotion: new Uint8Array([9]),
    playabilityStatus: { backgroundPlayerRender: { backgroundAbility: { active: false } }, pictureInPictureRender: { pictureInPictureAbility: { active: false, f4: 1, f6: 1, f8: 0 } } },
    playerConfig: { granularVariableSpeedConfig: { minimumPlaybackRate: 25, maximumPlaybackRate: 200 } },
    playbackTracking: { pageadViewthroughconversion: new Uint8Array([7]) },
  };
}
async function run(direction, url, options = {}) {
  const calls = [];
  const logs = [];
  const store = options.store || new Map();
  let completion;
  const done = new Promise(resolve => { completion = resolve; });
  let count = 0;
  const input = {
    ...common,
    console: { log: (...args) => logs.push(args.map(String).join(' ')) },
    $argument: typeof options.argument === 'string' ? options.argument : JSON.stringify(options.argument || {}),
    $request: { url, method: options.method || 'POST', headers: options.requestHeaders || {}, body: options.requestBody },
    $response: { status: options.status ?? 200, headers: options.headers || { 'Content-Type': 'application/x-protobuf' }, body: options.body },
    $script: { type: direction === 'request' ? 'http-request' : 'http-response', binaryBodyMode: true },
    $persistentStore: { read: key => store.get(key) ?? null, write(value, key) { if (value === null) store.delete(key); else store.set(key, value); return true; } },
    $httpClient: { get(request, callback) {
      calls.push(request); mockedNetworkCalls++;
      try {
        if (!options.http) throw new Error('Unexpected mock HTTP request');
        Promise.resolve(options.http(request)).then(result => callback(result.error || null, { status: result.status ?? 200, headers: {} }, result.body || ''), error => callback(String(error), { status: 0 }, ''));
      } catch (error) { callback(String(error), { status: 0 }, ''); }
    } },
    fetch: () => { throw new Error('Live fetch disabled in mock harness'); },
    $done: result => { count++; completion(result || {}); },
  };
  if (options.noWebAPI) { delete input.TextEncoder; delete input.TextDecoder; }
  const context = vm.createContext(input);
  vm.runInContext(direction === 'request' ? requestCode : responseCode, context, { timeout: 2500 });
  let timer;
  const result = await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Mock script did not finish')), 5000); })]);
  clearTimeout(timer);
  await Promise.resolve();
  assert.equal(count, 1, 'Surge done must be called exactly once');
  if (Object.hasOwn(result, 'body')) assert.ok(result.body instanceof Uint8Array, 'Modified body must remain bytes');
  if (result.response && Object.hasOwn(result.response, 'body')) assert.ok(result.response.body instanceof Uint8Array);
  return { result, calls, logs, store };
}
async function test(name, callback) {
  const start = performance.now();
  try { await callback(); results.push({ name, status: 'passed', durationMs: Math.round(performance.now() - start) }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: 'failed', error: error.message, stack: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}
const prefix = 'https://youtubei.googleapis.com/youtubei/v1/';
await test('all nine endpoint entries have no first-match collisions', async () => {
  assert.equal(manifest.scriptEntries.length, 9);
  assert.deepEqual(scriptEntries(read('modules/ios-youtube-id8.sgmodule')).map(({name,type,pattern}) => ({name,type,pattern})), manifest.scriptEntries.map(({name,type,pattern}) => ({name,type,pattern})));
  const urls = [
    ['http-request', prefix+'player/ad_break', 'ios-youtube-ad-break'],
    ['http-request', prefix+'player?videoId=MOCK1234567', 'ios-youtube-download-player'],
    ['http-response', prefix+'player', 'ios-youtube-response'],
    ['http-response', prefix+'offline/get_download_action?x=1', 'ios-youtube-download-action'],
    ['http-response', 'https://mock.googlevideo.com/initplayback?x=1', 'ios-youtube-ump'],
    ['http-request', 'https://mock.googlevideo.com/initplayback?x=1', 'ios-youtube-init'],
    ['http-request', 'https://mock.googlevideo.com/videoplayback?id=fixture', 'ios-youtube-auto-hd'],
    ['http-request', prefix+'log_event?x=1', 'ios-youtube-log-event'],
    ['http-response', 'https://m.youtube.com/api/timedtext?lang=en&fmt=json3', 'ios-youtube-dual-subs'],
    ['http-response', prefix+'config', 'ios-youtube-response'],
    ['http-response', prefix+'log_event', 'ios-youtube-response'],
  ];
  for (const [type,url,name] of urls) {
    const matched = manifest.scriptEntries.filter(item => item.type === type && new RegExp(item.pattern).test(url));
    assert.equal(matched.length, 1, url); assert.equal(matched[0].name, name);
  }
});
await test('core protobuf removes ads enables background PiP and 4x speed', async () => {
  const unknown = binaryField(999, new Uint8Array([0,255,128,254]));
  const input = concat(encode('Player', playerFixture()), unknown);
  const output = (await run('response',prefix+'player',{body:input})).result.body;
  const model = decode('Player',output);
  assert.equal(model.adPlacements.length,0); assert.equal(model.adSlots.length,0); assert.equal(model.paidPromotion,undefined);
  assert.equal(model.playabilityStatus.backgroundPlayerRender.backgroundAbility.active,true);
  assert.equal(model.playabilityStatus.pictureInPictureRender.pictureInPictureAbility.active,true);
  assert.equal(model.playerConfig.granularVariableSpeedConfig.maximumPlaybackRate,400);
  assert.equal(model.playbackTracking.pageadViewthroughconversion,undefined);
  bytesEqual(api.wireFields(output).find(field=>field.no===999).raw,unknown);
});
await test('core protobuf idempotent second pass preserves bytes', async () => {
  const first=(await run('response',prefix+'player',{body:encode('Player',playerFixture())})).result.body;
  const second=(await run('response',prefix+'player',{body:first})).result;
  bytesEqual(second.body || first,first);
});
await test('configured Shorts and upload flags default true and support false', async () => {
  const item=id=>({iconRender:{browseId:id}});
  const body=encode('Guide',{labelItems:[],iconItems:[{guideSectionRenderer:{rendererItems:[item('FEuploads'),item('FEshorts'),item('FEhome')]}}]});
  const filtered=decode('Guide',(await run('response',prefix+'guide',{body})).result.body);
  assert.equal(filtered.iconItems[0].guideSectionRenderer.rendererItems.length,1);
  assert.equal(filtered.iconItems[0].guideSectionRenderer.rendererItems[0].iconRender.browseId,'FEhome');
  const kept=await run('response',prefix+'guide',{body,argument:{blockUpload:false,blockShorts:false}});
  bytesEqual(kept.result.body || body,body);
});
await test('legacy snake-case booleans are calibrated instead of truthy strings', async () => {
  const item=id=>({iconRender:{browseId:id}});
  const body=encode('Guide',{labelItems:[],iconItems:[{guideSectionRenderer:{rendererItems:[item('FEuploads'),item('FEshorts'),item('FEhome')]}}]});
  const result=await run('response',prefix+'guide',{body,argument:'block_upload=false&block_shorts=false'});
  bytesEqual(result.result.body || body,body);
});
await test('Shorts advertising entries are removed without losing ordinary clips', async () => {
  const body=encode('Shorts',{entries:[{command:{reelWatchEndpoint:{adClientParams:{isAd:true}}}},{command:{reelWatchEndpoint:{adClientParams:{isAd:false}}}}]});
  const model=decode('Shorts',(await run('response',prefix+'reel/reel_watch_sequence',{body})).result.body);
  assert.equal(model.entries.length,1); assert.equal(model.entries[0].command.reelWatchEndpoint.adClientParams.isAd,false);
});
await test('ad-break mock response is protobuf bytes and makes no network request', async () => {
  const output=await run('request',prefix+'player/ad_break');
  assert.equal(output.result.response.status,200); assert.equal(output.result.response.body.length,0); assert.equal(output.calls.length,0);
});
await test('highest-quality request changes only recognized protobuf fields', async () => {
  const state=concat(numberField(16,360),numberField(26,2),numberField(99,7));
  const unknown=binaryField(44,new Uint8Array([0,255,128]));
  const body=concat(binaryField(1,state),unknown);
  const output=(await run('request','https://mock.googlevideo.com/videoplayback?id=fixture',{requestBody:body})).result.body;
  const client=api.wireFields(api.wireFields(output).find(field=>field.no===1).data);
  const value=no=>client.find(field=>field.no===no).data;
  bytesEqual(value(16),api.varint(4320)); bytesEqual(value(26),api.varint(1)); bytesEqual(value(99),api.varint(7));
  bytesEqual(api.wireFields(output).find(field=>field.no===44).raw,unknown);
  const disabled=await run('request','https://mock.googlevideo.com/videoplayback?id=fixture',{requestBody:body,argument:{autoHd:false}});
  assert.equal(Object.hasOwn(disabled.result,'body'),false);
});
await test('initplayback quality is modified only with matching captured key', async () => {
  const key = new Uint8Array(16).fill(6);
  const encrypted = binaryField(5, key);
  const state = concat(numberField(16, 360), numberField(26, 2));
  const body = concat(binaryField(2, state), binaryField(3, encrypted));
  const store = new Map([['YouTubeConfig', JSON.stringify({youtube:{clientKey:Buffer.alloc(32, 7).toString('base64'),encryptKey:Buffer.from(key).toString('base64')}})]]);
  const output = (await run('request','https://mock.googlevideo.com/initplayback',{requestBody:body,store})).result.body;
  assert.ok(output);
  const values = api.wireFields(api.wireFields(output).find(field=>field.no===2).data);
  bytesEqual(values.find(field=>field.no===16).data,api.varint(4320));
  bytesEqual(api.wireFields(output).find(field=>field.no===3).data,encrypted);
  const missing = await run('request','https://mock.googlevideo.com/initplayback',{requestBody:body});
  assert.equal(missing.result.body,undefined);
});
await test('Games and vertical-live recommendation flags remove only matching cards', async () => {
  const card = (field,marker) => ({videoContext:{videoContent:decode('VideoContent',binaryField(field,new TextEncoder().encode(marker)))}});
  const model = {content:{elementRenderer:{videoRendererContent:{richItemContents:[card(312131490,'mini_game_card.eml'),card(519005951,'youtube_outline_experimental/live_24pt'),card(700001,'ordinary-content')]}}}};
  const body = encode('Browse',model);
  const output = (await run('response',prefix+'browse',{body})).result.body;
  assert.ok(output);
  assert.equal(decode('Browse',output).content.elementRenderer.videoRendererContent.richItemContents.length,1);
  const disabled = (await run('response',prefix+'browse',{body,argument:{blockGames:false,blockVerticalLive:false,blockStore:false}})).result;
  bytesEqual(disabled.body || body,body);
});
await test('native download player request respects on and off switches', async () => {
  const other=binaryField(44,new Uint8Array([0,255,128]));
  const body=concat(numberField(8,1),binaryField(12,new Uint8Array()),other);
  const enabled=(await run('request',prefix+'player',{requestBody:body})).result.body;
  assert.equal(api.wireFields(enabled).some(field=>field.no===12),false);
  bytesEqual(api.wireFields(enabled).find(field=>field.no===44).raw,other);
  const disabled=await run('request',prefix+'player',{requestBody:body,argument:{nativeDownload:false}});
  assert.equal(Object.hasOwn(disabled.result,'body'),false);
  const nonDownload=await run('request',prefix+'player',{requestBody:concat(numberField(8,0),binaryField(12,new Uint8Array()))});
  assert.equal(Object.hasOwn(nonDownload.result,'body'),false);
});
await test('native download action synthesizes offline command and preserves tracking', async () => {
  const tracking=encode('DownloadTracking',{index:9,visualElement:10});
  const body=encode('DownloadAction',{command:{tracking,gatedDownload:{videoId:'MOCK1234567',formatType:2,params:Buffer.from(numberField(4,1)).toString('base64url')}}});
  const enabled=(await run('response',prefix+'offline/get_download_action',{body})).result.body;
  const model=decode('DownloadAction',enabled);
  assert.equal(model.command.gatedDownload,undefined);
  const offline=model.command.executor.commands[0].offlineVideo;
  assert.equal(offline.videoId,'MOCK1234567'); assert.equal(offline.action,1);
  assert.equal(offline.offlineability.renderer.offlineable,true); assert.equal(offline.actionParams.formatType,2);
  const updatedTracking=decode('DownloadTracking',offline.offlineability.renderer.tracking);
  assert.equal(updatedTracking.index,1); assert.equal(updatedTracking.visualElement,7111);
  const disabled=await run('response',prefix+'offline/get_download_action',{body,argument:{nativeDownload:false}});
  assert.equal(Object.hasOwn(disabled.result,'body'),false);
});
await test('download settings include the three booleans missing from candidate', async () => {
  const body=encode('Setting',{collectionItems:[{settingCategoryCollectionRenderer:{categoryId:10135,subSettings:[]}}],settingItems:[]});
  const output=(await run('response',prefix+'account/get_setting',{body})).result.body;
  const setting=decode('Setting',output).settingItems.find(item=>item.backgroundPlayBackSettingRenderer).backgroundPlayBackSettingRenderer;
  assert.equal(setting.backgroundPlayback,true); assert.equal(setting.download,true);
  assert.equal(setting.downloadQualitySelection,true); assert.equal(setting.smartDownload,true);
});
await test('configuration keys captured through config and log_event routes', async () => {
  const key=new Uint8Array(32).fill(3), encryption=new Uint8Array(16).fill(5);
  const body=encode('Config',{responseContext:{globalConfigGroup:{hotConfigGroup:{mediaHotConfig:{onesieHotConfig:{clientKey:key,encryptKey:encryption}}}}}});
  for (const endpoint of ['config','log_event']) {
    const output=await run('response',prefix+endpoint,{body});
    assert.equal(output.result.body,undefined);
    const stored=JSON.parse(output.store.get('YouTubeConfig'));
    bytesEqual(Buffer.from(stored.youtube.clientKey,'base64'),key);
    bytesEqual(Buffer.from(stored.youtube.encryptKey,'base64'),encryption);
  }
});
await test('log request hot-hash removal is conditional on stored client key', async () => {
  const headers={'X-YouTube-Hot-Hash-Data':'fixture','Other':'keep'};
  const missing=await run('request',prefix+'log_event',{requestHeaders:headers});
  assert.equal(missing.result.headers.Other,'keep'); assert.equal(missing.result.headers['X-YouTube-Hot-Hash-Data'],undefined);
  const store=new Map([['YouTubeConfig',JSON.stringify({youtube:{clientKey:'AA=='}})]]);
  const available=await run('request',prefix+'log_event',{requestHeaders:headers,store});
  assert.equal(Object.hasOwn(available.result,'headers'),false);
});
function umpFixture(gzip=false,badHmac=false) {
  const key=Buffer.alloc(32,7),iv=Buffer.alloc(16,3);
  const inner=encode('OnesieInnertubeResponse',{contents:[{player:playerFixture()}]});
  const plaintext=gzip?zlib.gzipSync(inner):inner;
  const cipher=crypto.createCipheriv('aes-128-ctr',key.subarray(0,16),iv);
  const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const mac=crypto.createHmac('sha256',key.subarray(16)).update(encrypted).update(iv).digest();
  if(badHmac)mac[0]^=1;
  const envelope=encode('EncryptedResponsePart',{encryptedContent:new Uint8Array(encrypted),hmac:new Uint8Array(mac),iv:new Uint8Array(iv),compressionAlgorithm:gzip?1:0});
  const writer=new api.UmpWriter();
  writer.writePart({type:10,data:numberField(1,25)});writer.writePart({type:11,data:envelope});writer.writePart({type:99,data:new Uint8Array([0,255,9])});
  return {body:writer.finish(),key,store:new Map([['YouTubeConfig',JSON.stringify({youtube:{clientKey:key.toString('base64'),encryptKey:Buffer.alloc(16,2).toString('base64')}})]])};
}
for(const gzip of [false,true]) await test(`encrypted UMP ${gzip?'gzip':'plain'} retains framing HMAC and bytes`,async()=>{
  const input=umpFixture(gzip);
  const output=await run('response','https://mock.googlevideo.com/initplayback',{body:input.body,headers:{'Content-Type':'application/vnd.yt-ump'},store:input.store});
  assert.ok(output.result.body);
  const reader=new api.UmpReader(output.result.body);const parts=[];while(reader.hasNext)parts.push(reader.readPart());
  assert.deepEqual(parts.map(part=>part.type),[10,11,99]);bytesEqual(parts[2].data,new Uint8Array([0,255,9]));
  const envelope=decode('EncryptedResponsePart',parts[1].data);
  const expected=crypto.createHmac('sha256',input.key.subarray(16)).update(envelope.encryptedContent).update(envelope.iv).digest();
  bytesEqual(envelope.hmac,expected);
  const decipher=crypto.createDecipheriv('aes-128-ctr',input.key.subarray(0,16),envelope.iv);
  let plain=Buffer.concat([decipher.update(envelope.encryptedContent),decipher.final()]);
  if(gzip)plain=zlib.gunzipSync(plain);
  const player=decode('OnesieInnertubeResponse',new Uint8Array(plain)).contents[0].player;
  assert.equal(player.adPlacements.length,0);assert.equal(player.playabilityStatus.backgroundPlayerRender.backgroundAbility.active,true);
});
await test('UMP HMAC failure leaves original body untouched and clears stale key',async()=>{
  const input=umpFixture(false,true);
  const output=await run('response','https://mock.googlevideo.com/initplayback',{body:input.body,headers:{'Content-Type':'application/vnd.yt-ump'},store:input.store});
  assert.equal(output.result.body,undefined);
  assert.equal(JSON.parse(output.store.get('YouTubeConfig')).youtube,undefined);
});
function translated(request) {
  assert.ok(request.url.startsWith('https://translate.googleapis.com/translate_a/single?'));
  assert.equal(request.timeout,8);
  const url=new URL(request.url);const original=url.searchParams.get('q');
  const translated=original.split('\r').map((value,index)=>index===0?'你好':'世界').join('\r');
  return {status:200,body:JSON.stringify([[[translated,original]]])};
}
await test('bilingual JSON3 preserves timing and returns UTF-8 bytes',async()=>{
  const body=JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'Hello'}],wWinId:9},{tStartMs:1000,dDurationMs:900,segs:[{utf8:'World'}]}]});
  const output=await run('response','https://m.youtube.com/api/timedtext?lang=en&fmt=json3',{body:new TextEncoder().encode(body),headers:{'Content-Type':'application/json'},http:translated});
  const json=JSON.parse(new TextDecoder().decode(output.result.body));
  assert.equal(json.events[0].segs[0].utf8,'Hello\n你好');assert.equal(json.events[1].segs[0].utf8,'World\n世界');
  assert.equal(json.events[0].tStartMs,0);assert.equal(json.events[0].dDurationMs,1000);assert.equal(json.events[0].wWinId,undefined);
});
await test('bilingual VTT preserves WEBVTT header and time ranges',async()=>{
  const body='WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n\n00:00:01.000 --> 00:00:02.000\nWorld';
  const output=await run('response','https://www.youtube.com/api/timedtext?lang=en&fmt=vtt',{body,headers:{'Content-Type':'text/vtt'},http:translated});
  const text=new TextDecoder().decode(output.result.body);
  assert.ok(text.startsWith('WEBVTT'));assert.ok(text.includes('00:00:00.000 --> 00:00:01.000\nHello\n你好'));
});
await test('bilingual XML retains attributes and encodes newline safely',async()=>{
  const body='<transcript><text start="0" dur="1">Hello &amp; world</text></transcript>';
  const output=await run('response','https://www.youtube.com/api/timedtext?lang=en&fmt=srv3',{body,headers:{'Content-Type':'application/xml'},http:translated});
  const text=new TextDecoder().decode(output.result.body);
  assert.ok(text.includes('start="0" dur="1"'));assert.ok(text.includes('Hello &amp; world&#10;你好'));
});
await test('subtitle cache skips repeat mock translation requests',async()=>{
  const store=new Map(),body='WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello';
  const options={body,headers:{'Content-Type':'text/vtt'},http:translated,store};
  const first=await run('response','https://www.youtube.com/api/timedtext?lang=en&fmt=vtt&v=fixture',options);
  const second=await run('response','https://www.youtube.com/api/timedtext?lang=en&fmt=vtt&v=fixture',options);
  assert.equal(first.calls.length,1);assert.equal(second.calls.length,0);bytesEqual(first.result.body,second.result.body);
});
await test('subtitle translation error falls back byte-for-byte',async()=>{
  const body=new TextEncoder().encode('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello');
  for(const http of [()=>({error:'mock timeout'}),()=>({status:500,body:'fixture'}),()=>({status:200,body:'bad json'})]){
    const output=await run('response','https://www.youtube.com/api/timedtext?lang=en&fmt=vtt',{body,headers:{'Content-Type':'text/vtt'},http});
    assert.equal(output.result.body,undefined);bytesEqual(body,new TextEncoder().encode('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello'));
  }
});
await test('dual subtitle switch false makes zero translation requests',async()=>{
  const output=await run('response','https://www.youtube.com/api/timedtext?lang=en&fmt=vtt',{body:'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello',argument:{dualSubtitles:false},http:()=>{throw new Error('Should never call')}});
  assert.equal(output.calls.length,0);assert.equal(output.result.body,undefined);
});
await test('invalid protobuf and non-success response safely pass through',async()=>{
  const malformed=new Uint8Array([0xff,0xff,0xff,0xff,0xff,0xff]);
  const output=await run('response',prefix+'player',{body:malformed});assert.equal(output.result.body,undefined);
  const forbidden=await run('response',prefix+'player',{body:encode('Player',playerFixture()),status:403});assert.equal(forbidden.result.body,undefined);
});
await test('fallback UTF-8 encoder handles Chinese and emoji without corrupting bytes',async()=>{
  const sandbox=vm.createContext({Uint8Array,ArrayBuffer,console});
  vm.runInContext(compatCode,sandbox);
  const text='字幕🏝️\u0000';
  const encoded=vm.runInContext(`new TextEncoder().encode(${JSON.stringify(text)})`,sandbox);
  bytesEqual(encoded,new TextEncoder().encode(text));
  sandbox.fixtureBytes=encoded;
  assert.equal(vm.runInContext('new TextDecoder().decode(fixtureBytes)',sandbox),text);
});
await test('static rewrite behavior has five redirects and four empty-200 maps',async()=>{
  const module=read('modules/ios-youtube-id8.sgmodule');
  const sections=module.split(/^\[/m);
  const rewrites=sections.find(s=>s.startsWith('URL Rewrite]')).split('\n').filter(line=>line.startsWith('^')||line.startsWith('('));
  const maps=sections.find(s=>s.startsWith('Map Local]')).split('\n').filter(line=>line.startsWith('^'));
  assert.equal(rewrites.length,5);assert.equal(maps.length,4);
  for(const line of maps)assert.match(line,/data-type=text data="" status-code=200$/);
  const domain=rewrites[1].split(' ');
  const match=new RegExp(domain[0]);
  const original='https://www.youtube.com/api/timedtext?lang=en&tlang=zh-CN&fmt=json3';
  const rewritten=original.replace(match,domain[1]);
  assert.equal(rewritten,'https://www.youtube.com/api/timedtext?lang=en&fmt=json3&subtype=Translate');
  assert.equal(match.test(rewritten),false,'Redirect does not loop');
});
await test('portable module keeps narrow QUIC scope and exact MITM exclusions',async()=>{
  const module=read('modules/ios-youtube-id8.sgmodule');
  assert.equal((module.match(/^AND,/gm)||[]).length,2);assert.equal(/block-quic\s*=/.test(module),false);
  assert.ok(module.includes('hostname = %APPEND% -redirector*.googlevideo.com, *.googlevideo.com'));
  assert.ok(module.includes('m.youtube.com'));assert.equal(/\[Module\]|ca-p12|ca-passphrase|127\.0\.0\.1|\/Users\//.test(module),false);
  for(const entry of manifest.scriptEntries)assert.ok(entry.name.startsWith('ios-youtube-'));
  for(const source of [requestCode,responseCode])assert.equal(/^\s*(import|export)\s|export default\s*\(ctx\)/m.test(source),false);
});
const passed=results.filter(test=>test.status==='passed').length;
const report={mode:'mock-only',liveNetworkCalls:0,mockedNetworkCalls,total:results.length,passed,failed:results.length-passed,tests:results};
console.log('MOCK_SUMMARY ' + JSON.stringify(report));
console.log(`Mock result: ${passed}/${results.length}; actual HTTP: 0`);
if(report.failed)process.exitCode=1;
