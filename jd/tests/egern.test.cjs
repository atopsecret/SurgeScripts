// Build: 无；Run: node --test jd/tests/egern.test.cjs；Deps: Node.js 20+
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadScript, makeContext, moduleText, urlPatterns } = require('./egern-fixture.cjs');
const script = loadScript(__dirname, '../jd-ad-block.egern.js');
const yaml = moduleText(__dirname, '../jd-adblock.egern.yaml');
const bodyText = body => typeof body === 'string' ? body : Buffer.from(body).toString('utf8');

async function run(body, api = 'start', options = {}) {
    const fixture = makeContext({ body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), url: 'https://api.m.jd.com/client.action?client=ios&functionId=' + api + '&v=1', ...options });
    fixture.result = await (await script)(fixture.ctx);
    assert.equal(fixture.calls.network, 0);
    assert.equal(fixture.calls.notifications.length, 0);
    return fixture;
}

test('start 只删除广告字段，保留业务与成功码', async () => {
    const f = await run({ code: '0', images: ['splash'], showTimesDaily: 3, config: { keep: true } });
    assert.deepEqual(JSON.parse(f.result.body), { code: '0', images: [], showTimesDaily: 0, config: { keep: true } });
    assert.equal(f.calls.responseReads, 1);
    assert.equal(f.response.bodyUsed, true);
});

test('start 缺少广告字段不增补字段，原文含空白保持', async () => {
    const body = '{ "config": true }\n';
    assert.equal(bodyText((await run(body)).result.body), body);
});

test('start 陌生字段类型保留', async () => {
    const body = '{"images":{"goods":true},"showTimesDaily":"3"}';
    assert.equal(bodyText((await run(body)).result.body), body);
});

test('welcomeHome 清广告楼层，保留普通楼层与空元素', async () => {
    const f = await run({ floorList: [{ type: 'float' }, { type: 'goods' }, null, 1], webViewFloorList: ['ad'] }, 'welcomeHome');
    assert.deepEqual(JSON.parse(f.result.body), { floorList: [{ type: 'goods' }, null, 1], webViewFloorList: [] });
});

test('deliverLayer 不触碰正常物流楼层', async () => {
    const f = await run({ bannerInfo: {}, floors: [{ mId: 'banner' }, { mId: 'jdDeliveryBanner' }, { mId: 'tracking' }, null] }, 'deliverLayer');
    assert.deepEqual(JSON.parse(f.result.body), { floors: [{ mId: 'tracking' }, null] });
});

test('basicConfig 支持根及 data 包装，缺少路径不创建', async () => {
    const source = { JDMessage: { socketmonitor: { isSocketEstablishedAhead: 1, isSocketReport: 1, keep: 1 } }, data: { JDHttpToolKit: { httpdns: { httpdns: 1 } } }, other: true };
    const output = JSON.parse((await run(source, 'basicConfig')).result.body);
    assert.equal(output.JDMessage.socketmonitor.isSocketEstablishedAhead, 0);
    assert.equal(output.JDMessage.socketmonitor.isSocketReport, 0);
    assert.equal(output.JDMessage.socketmonitor.keep, 1);
    assert.equal(output.data.JDHttpToolKit.httpdns.httpdns, 0);
    assert.equal(output.other, true);
    assert.equal(bodyText((await run(' {"data":{},"other":1} ', 'basicConfig')).result.body), ' {"data":{},"other":1} ');
});

test('cart 只清两个推荐位置', async () => {
    const f = await run({ cartLocationMap: { loc_emptyCartFloor2: {}, goods: [1] }, emptyCartRecommendFloor: {}, total: 10 }, 'cart');
    assert.deepEqual(JSON.parse(f.result.body), { cartLocationMap: { goods: [1] }, total: 10 });
});

test('secondFloor 只清推荐，保留天气与问候', async () => {
    const f = await run({ data: { recommendFloor: {}, weather: 'sunny', greeting: 'hi' } }, 'secondFloor');
    assert.deepEqual(JSON.parse(f.result.body), { data: { weather: 'sunny', greeting: 'hi' } });
});

test('lite 广告只改字段名，不改字符串值', async () => {
    const f = await run({ jdLiteAdvertisingVO: { ads: [1] }, title: 'jdLiteAdvertisingVO' }, 'lite_advertising');
    assert.deepEqual(JSON.parse(f.result.body), { sooyaaabo: { ads: [1] }, title: 'jdLiteAdvertisingVO' });
});

test('lite 字段冲突不覆盖既有字段', async () => {
    const body = '{"jdLiteAdvertisingVO":1,"sooyaaabo":2}';
    assert.equal(bodyText((await run(body, 'lite_advertising')).result.body), body);
});

test('亮色和深色导航只移除已知视频标签', async () => {
    const list = [{ cutLabelName: '首页' }, { cutLabelName: '逛' }, { cutLabelName: '购物车' }, { cutLabelName: '秒送' }];
    const f = await run({ nodeMap: { normal: { navigationAll: list }, dark: { navigationAll: list } } }, 'readCustomSurfaceList');
    const output = JSON.parse(f.result.body);
    for (const mode of ['normal', 'dark']) assert.deepEqual(output.nodeMap[mode].navigationAll.map(item => item.cutLabelName), ['首页', '购物车', '秒送']);
});

test('旧 ID 导航只排除视频，保留未知入口及顺序', async () => {
    const list = ['index', 'futureTool', 'messagenew', 'video', 'cart', 'home'].map(functionId => ({ functionId }));
    const f = await run({ result: { modeMap: { normal: { navigationAll: list } } } }, 'readCustomSurfaceList');
    assert.deepEqual(JSON.parse(f.result.body).result.modeMap.normal.navigationAll.map(item => item.functionId), ['index', 'futureTool', 'messagenew', 'cart', 'home']);
});

for (const [label, list] of [
    ['缺少核心入口', [{ functionId: 'video' }]],
    ['混合陌生字段', [{ cutLabelName: '逛' }, { title: 'home' }]],
    ['只有视频标签', [{ cutLabelName: '逛' }, { cutLabelName: '视频' }]],
    ['非对象项', [null, 'video']]
]) {
    test('未知导航保留：' + label, async () => {
        const body = JSON.stringify({ result: { modeMap: { normal: { navigationAll: list } } } });
        assert.equal(bodyText((await run(body, 'readCustomSurfaceList')).result.body), body);
    });
}

test('未知 API 不读取响应或写入诊断', async () => {
    const f = await run({ images: [1] }, 'search');
    assert.equal(f.result, undefined);
    assert.equal(f.calls.responseReads, 0);
    assert.equal(f.calls.sets, 0);
});

for (const url of [
    'https://api.m.jd.com.evil.test/client.action?functionId=start',
    'https://example.test/client.action?functionId=start',
    'https://api.m.jd.com/client.action-extra?functionId=start',
    'https://api.m.jd.com@evil.test/client.action?functionId=start',
    'not-a-url'
]) {
    test('非目标归属原样放行：' + url, async () => {
        const f = await run({ images: [1] }, 'start', { url });
        assert.equal(f.result, undefined);
        assert.equal(f.calls.responseReads, 0);
    });
}

test('重复 functionId 不猜测，且不读取 POST 正文', async () => {
    const f = await run({ images: [1] }, 'start', { url: 'https://api.m.jd.com/client.action?functionId=start&functionId=cart', method: 'POST', requestBody: 'functionId=start' });
    assert.equal(f.result, undefined);
    assert.equal(f.calls.responseReads, 0);
    assert.equal(f.calls.requestReads, 0);
});

test('POST 表单 functionId 支持非首参数', async () => {
    const f = await run({ images: [1] }, 'start', { url: 'https://api.m.jd.com/client.action', method: 'POST', requestBody: 'client=ios&functionId=start&body=%7B%7D' });
    assert.deepEqual(JSON.parse(f.result.body).images, []);
    assert.equal(f.calls.requestReads, 1);
});

test('POST JSON functionId 支持已知接口', async () => {
    const f = await run({ images: [1] }, 'start', { url: 'https://api.m.jd.com/client.action', method: 'POST', requestBody: '{"functionId":"start","body":{}}' });
    assert.deepEqual(JSON.parse(f.result.body).images, []);
});

test('POST 请求正文读取失败不读取响应', async () => {
    const f = await run({ images: [1] }, 'start', { url: 'https://api.m.jd.com/client.action', method: 'POST', requestReadError: true });
    assert.equal(f.result, undefined);
    assert.equal(f.calls.responseReads, 0);
});

for (const status of [206, 302, 403, 500]) {
    test('HTTP ' + status + ' 不读取响应', async () => {
        const f = await run({ images: [1] }, 'start', { status });
        assert.equal(f.result, undefined);
        assert.equal(f.calls.responseReads, 0);
    });
}

for (const data of [{ code: '605', images: [1] }, { success: false, images: [1] }, { ret: ['FAIL::LOGIN'], images: [1] }]) {
    test('业务错误正文保留：' + JSON.stringify(data), async () => {
        const body = ' ' + JSON.stringify(data) + '\n';
        assert.equal(bodyText((await run(body)).result.body), body);
    });
}

for (const body of ['<html>error</html>', 'callback({"images":[1]})', '[{"images":[1]}]', 'null', '{broken']) {
    test('解析或结构失败返回已读取原文：' + body, async () => {
        const f = await run(body);
        assert.equal(bodyText(f.result.body), body);
        assert.ok(f.result.body instanceof Uint8Array);
        assert.equal(f.calls.responseReads, 1);
    });
}

test('读取异常不抛出、不发网络请求', async () => {
    assert.equal((await run('{}', 'start', { readError: true })).result, undefined);
});

test('诊断存储读写失败不阻止改写', async () => {
    const f = await run({ images: [1] }, 'start', { storageReadError: true, storageWriteError: true });
    assert.deepEqual(JSON.parse(f.result.body).images, []);
});

test('第二次处理幂等且保留序列化后的正文', async () => {
    const first = await run({ images: [1], showTimesDaily: 1 });
    const second = await run(first.result.body, 'start', { stored: first.stored });
    assert.equal(bodyText(second.result.body), bodyText(first.result.body));
    assert.equal([...second.stored.values()][0].hits, 2);
});

test('generic 诊断不发网络、无通知、不写存储', async () => {
    const f = makeContext({ generic: true });
    const widget = await (await script)(f.ctx);
    assert.equal(widget.type, 'widget');
    assert.equal(widget.padding, 12);
    assert.equal(widget.children.length, 1);
    assert.equal(widget.children[0].type, 'text');
    assert.match(widget.children[0].text, /京东原生版本：2\.0\.0/);
    assert.equal(f.calls.network, 0);
    assert.equal(f.calls.notifications.length, 0);
    assert.equal(f.calls.sets, 0);
});

test('generic 存储不可用仍返回合法 Widget', async () => {
    const f = makeContext({ generic: true, storageReadError: true });
    const widget = await (await script)(f.ctx);
    assert.equal(widget.type, 'widget');
    assert.equal(widget.children[0].type, 'text');
    assert.equal(typeof widget.children[0].text, 'string');
    assert.equal(f.calls.network, 0);
    assert.equal(f.calls.notifications.length, 0);
    assert.equal(f.calls.sets, 0);
});

test('模块 URL 正则有效，素材不误匹配商品图', () => {
    const patterns = urlPatterns(yaml);
    assert.ok(patterns.length >= 10);
    for (const url of ['https://m.360buyimg.com/mobilecms/s750x750_jfs/goods.jpg', 'https://m.360buyimg.com/n1/jfs/goods.jpg', 'https://apk.360buyimg.com/other_public/component.xji']) {
        assert.equal(patterns.some(pattern => pattern.test(url)), false, url);
    }
    assert.ok(patterns.some(pattern => pattern.test('https://m.360buyimg.com/mobilecms/s1125x2436_jfs/splash.jpg')));
    assert.ok(patterns.some(pattern => pattern.test('https://api.m.jd.com/client.action?client=ios&functionId=queryMaterialAdverts&v=1')));
});

test('模块和脚本版本对应，不携带旧账号脚本入口', () => {
    assert.match(yaml, /jd-ad-block\.egern\.js\?v=2\.0\.0/g);
    assert.match(yaml, /binary_body: true/);
    assert.doesNotMatch(yaml, /skernelx\/SurgeScripts/);
    assert.doesNotMatch(yaml, /\.sgmodule/);
});

test('新增物流别名保留轨迹、订单与未知楼层', async () => {
    const input = { bannerInfo: {}, floors: [{ mId: 'banner' }, { mId: 'tracking', orderId: 'fixture-order' }, null, { mId: 'futureBusiness' }] };
    const value = JSON.parse((await run(input, 'orderTrackBusiness')).result.body);
    assert.deepEqual(value, { floors: [input.floors[1], null, input.floors[3]] });
});

test('新品页只清已知两处推广，未知结果与商品保留', async () => {
    const input = { result: { iconInfo: {}, roofTop: {}, products: [1], future: { keep: true } }, code: '0' };
    const value = JSON.parse((await run(input, 'getTabHomeInfo')).result.body);
    assert.deepEqual(value, { result: { products: [1], future: { keep: true } }, code: '0' });
    const raw = ' {"result":"unknown","keep":1}\n';
    assert.equal(bodyText((await run(raw, 'getTabHomeInfo')).result.body), raw);
});

test('订单页清推广楼层和精选特惠，保留客服提示与真实服务', async () => {
    const customer = { mId: 'customerServiceFloor', data: { moreText: '更多服务', moreIcon: 'keep' } };
    const input = { floors: [{ mId: 'bannerFloor' }, { mId: 'bpDynamicFloor' }, { mId: 'plusFloor' },
        { mId: 'orders', orderId: 'fixture-order' }, customer, { mId: 'virtualServiceCenter', data: { virtualServiceCenters: [null, { serviceList: [null, { serviceTitle: '精选特惠' }, { serviceTitle: '退换售后' }] }] } }, { mId: 'futureBusiness' }] };
    const value = JSON.parse((await run(input, 'myOrderInfo')).result.body);
    assert.deepEqual(value.floors.map(row => row.mId), ['orders', 'customerServiceFloor', 'virtualServiceCenter', 'futureBusiness']);
    assert.deepEqual(value.floors[1], customer);
    assert.deepEqual(value.floors[2].data.virtualServiceCenters, [null, { serviceList: [null, { serviceTitle: '退换售后' }] }]);
});

test('个人页保留钱包、评价、未知工具和原序，只清已知推广', async () => {
    const tools = { mId: 'iconToolFloor', data: { nodes: [[{ functionId: 'futureTool' }, { functionId: 'kehufuwu' }]] } };
    const order = { mId: 'orderIdFloor', data: { commentRemindInfo: { infos: [1] } } };
    const wallet = { mId: 'newWalletIdFloor', data: { balance: 'fixture' } };
    const input = { floors: [{ mId: 'bigSaleFloor' }, { mId: 'newsFloor' }, tools, wallet, order,
        { mId: 'basefloorinfo', data: { commonPopup: {}, commonPopup_dynamic: {}, floatLayer: {}, commonTips: [1], commonWindows: [2], keep: 1 } },
        { mId: 'userinfo', data: { newPlusBlackCard: {}, name: 'fixture' } }, null, { mId: 'futureFloor' }] };
    const value = JSON.parse((await run(input, 'personinfoBusiness')).result.body);
    assert.deepEqual(value.floors.slice(0, 3), [tools, wallet, order]);
    assert.deepEqual(value.floors[3].data, { commonTips: [], commonWindows: [], keep: 1 });
    assert.deepEqual(value.floors[4].data, { name: 'fixture' });
    assert.deepEqual(value.floors.slice(5), [null, { mId: 'futureFloor' }]);
});

test('四个新增接口幂等，不给未知结构增加字段', async () => {
    for (const api of ['orderTrackBusiness', 'getTabHomeInfo', 'myOrderInfo', 'personinfoBusiness']) {
        const raw = ' {"future":{"keep":1}}\n';
        const f = await run(raw, api);
        assert.equal(bodyText(f.result.body), raw, api);
        assert.ok(f.result.body instanceof Uint8Array, api);
        assert.equal(f.result.headers, undefined, api);
    }
});

test('无效 UTF-8 的原字节回退不替换为 U+FFFD', async () => {
    for (const bytes of [Buffer.from([0xff, 0x41]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from([0xf4, 0x90, 0x80, 0x80]), Buffer.from([0xe4, 0xb8])]) {
        const f = await run(bytes);
        assert.deepEqual(Buffer.from(f.result.body), bytes);
        assert.equal(f.response.bodyUsed, true);
        assert.equal(f.calls.responseReads, 1);
        assert.equal(f.result.headers, undefined);
    }
});

test('字节回退保留 BOM 和原有空白', async () => {
    for (const raw of ['\ufeff{"images":[1]}', ' {"keep":"中文"}\r\n']) {
        const bytes = Buffer.from(raw);
        const f = await run(bytes);
        assert.deepEqual(Buffer.from(f.result.body), bytes);
        assert.equal(f.result.headers, undefined);
    }
});

test('策略或序列化异常回退已经消费的原字节', async () => {
    const context = vm.createContext({ URL, console: { log() {} }, JSON: { parse: JSON.parse, stringify() { throw Error('fixture-serialization-failure'); } } });
    const module = new vm.SourceTextModule(moduleText(__dirname, '../jd-ad-block.egern.js'), { context });
    await module.link(() => { throw Error('外部模块不应被加载'); });
    await module.evaluate({ timeout: 1000 });
    const raw = ' {"images":[1]}\n';
    const f = makeContext({ body: raw });
    const output = await module.namespace.default(f.ctx);
    assert.deepEqual(Buffer.from(output.body), Buffer.from(raw));
    assert.equal(output.headers, undefined);
    assert.equal(f.response.bodyUsed, true);
    assert.equal(f.calls.responseReads, 1);
});

test('媒体类型与非 UTF-8 声明在读体前放行', async () => {
    for (const type of ['application/octet-stream', 'application/jsonp', 'text/html', 'application/json; charset=gb18030']) {
        const f = await run({ images: [1] }, 'start', { responseHeaders: { 'Content-Type': type } });
        assert.equal(f.result, undefined, type);
        assert.equal(f.calls.responseReads, 0, type);
    }
    const json = await run({ images: [1] }, 'start', { responseHeaders: { 'Content-Type': 'application/problem+json; charset="UTF-8"' } });
    assert.deepEqual(JSON.parse(json.result.body).images, []);
});

test('改写移除过期正文头，保留同一 Headers 的多值 Cookie', async () => {
    const f = makeContext({ body: '{"images":[1]}', responseHeaders: { 'Content-Type': 'application/json', 'Content-Length': '999', 'Content-Encoding': 'gzip', ETag: 'old', 'Content-MD5': 'old', 'Content-Digest': 'old', 'Repr-Digest': 'old', 'X-Business': 'keep' } });
    const cookies = ['one=1; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/', 'two=2; Path=/'];
    for (const cookie of cookies) f.ctx.response.headers.append('Set-Cookie', cookie);
    const output = await (await script)(f.ctx);
    assert.equal(output.headers, f.ctx.response.headers);
    assert.deepEqual(output.headers.getSetCookie(), cookies);
    for (const name of ['content-length', 'content-encoding', 'etag', 'content-md5', 'content-digest', 'repr-digest']) assert.equal(output.headers.get(name), null, name);
    assert.equal(output.headers.get('X-Business'), 'keep');
    assert.equal(output.headers.get('X-JD-Cleaner-Version'), '2.0.0');
    assert.equal(f.calls.responseReads, 1);
});

test('Headers 写入异常回退原字节，并恢复已触及响应头', async () => {
    const raw = ' {"images":[1]}\n';
    const f = makeContext({ body: raw, responseHeaders: { 'Content-Type': 'application/json', 'Content-Length': '999', ETag: 'old' } });
    const before = [...f.ctx.response.headers.entries()];
    const originalSet = f.ctx.response.headers.set.bind(f.ctx.response.headers);
    let failOnce = true;
    f.ctx.response.headers.set = (name, value) => {
        if (failOnce && name.toLowerCase() === 'cache-control') { failOnce = false; throw Error('fixture-header-write'); }
        originalSet(name, value);
    };
    const output = await (await script)(f.ctx);
    assert.deepEqual(Buffer.from(output.body), Buffer.from(raw));
    assert.equal(output.headers, undefined);
    assert.deepEqual([...f.ctx.response.headers.entries()], before);
});

test('拒绝编码查询键和裸重复参数，不回退 POST 猜测身份', async () => {
    for (const tail of ['%66unctionId=start', 'functionId=start&%66unctionId=cart', 'functionId=start&functionId', 'functionId&functionId=start']) {
        const f = await run({ images: [1] }, 'start', { url: 'https://api.m.jd.com/client.action?' + tail, method: 'POST', requestBody: 'functionId=start' });
        assert.equal(f.result, undefined, tail);
        assert.equal(f.calls.responseReads, 0, tail);
        assert.equal(f.calls.requestReads, 0, tail);
    }
});

test('POST JSON 拒绝转义后重复或只在嵌套中存在的身份键', async () => {
    for (const requestBody of ['{"functionId":"start","functionId":"cart"}', '{"functionId":"start","function\\u0049d":"cart"}', '{"function\\u0049d":"cart","functionId":"start"}', '{"nested":{"functionId":"start"}}']) {
        const f = await run({ images: [1] }, 'start', { url: 'https://api.m.jd.com/client.action', method: 'POST', requestBody, headers: { 'Content-Type': 'application/json' } });
        assert.equal(f.result, undefined, requestBody);
        assert.equal(f.calls.responseReads, 0, requestBody);
    }
});

test('POST 表单值含 URL 或井号时不误当查询字符串', async () => {
    for (const requestBody of ['returnUrl=https://example.test/path&functionId=start', 'body=fixture#text&functionId=start']) {
        const f = await run({ images: [1] }, 'start', { url: 'https://api.m.jd.com/client.action', method: 'POST', requestBody });
        assert.deepEqual(JSON.parse(f.result.body).images, []);
        assert.equal(f.calls.requestReads, 1);
    }
});

test('陌生状态与畸形 ret 不触碰已消费的错误正文', async () => {
    for (const data of [{ code: '605', images: [1] }, { ret: 'FAIL::LOGIN', images: [1] }, { ret: null, images: [1] }]) {
        const raw = ' ' + JSON.stringify(data) + '\n';
        const f = await run(raw);
        assert.deepEqual(Buffer.from(f.result.body), Buffer.from(raw));
        assert.equal(f.result.headers, undefined);
    }
});
