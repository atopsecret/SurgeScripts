// Build: 无；Run: node --test jd/tests/egern.test.cjs；Deps: Node.js 20+
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, makeContext, moduleText, urlPatterns } = require('./egern-fixture.cjs');
const script = loadScript(__dirname, '../jd-ad-block.egern.js');
const yaml = moduleText(__dirname, '../jd-adblock.egern.yaml');

async function run(body, api = 'start', options = {}) {
    const fixture = makeContext({ body: typeof body === 'string' ? body : JSON.stringify(body), url: 'https://api.m.jd.com/client.action?client=ios&functionId=' + api + '&v=1', ...options });
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
    assert.equal((await run(body)).result.body, body);
});

test('start 陌生字段类型保留', async () => {
    const body = '{"images":{"goods":true},"showTimesDaily":"3"}';
    assert.equal((await run(body)).result.body, body);
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
    assert.equal((await run(' {"data":{},"other":1} ', 'basicConfig')).result.body, ' {"data":{},"other":1} ');
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
    assert.equal((await run(body, 'lite_advertising')).result.body, body);
});

test('亮色和深色导航只移除已知视频标签', async () => {
    const list = [{ cutLabelName: '首页' }, { cutLabelName: '逛' }, { cutLabelName: '购物车' }, { cutLabelName: '秒送' }];
    const f = await run({ nodeMap: { normal: { navigationAll: list }, dark: { navigationAll: list } } }, 'readCustomSurfaceList');
    const output = JSON.parse(f.result.body);
    for (const mode of ['normal', 'dark']) assert.deepEqual(output.nodeMap[mode].navigationAll.map(item => item.cutLabelName), ['首页', '购物车', '秒送']);
});

test('旧 ID 导航在核心入口完整时使用原白名单', async () => {
    const list = ['index', 'messagenew', 'video', 'cart', 'home'].map(functionId => ({ functionId }));
    const f = await run({ result: { modeMap: { normal: { navigationAll: list } } } }, 'readCustomSurfaceList');
    assert.deepEqual(JSON.parse(f.result.body).result.modeMap.normal.navigationAll.map(item => item.functionId), ['index', 'messagenew', 'cart', 'home']);
});

for (const [label, list] of [
    ['缺少核心入口', [{ functionId: 'video' }]],
    ['混合陌生字段', [{ cutLabelName: '逛' }, { title: 'home' }]],
    ['只有视频标签', [{ cutLabelName: '逛' }, { cutLabelName: '视频' }]],
    ['非对象项', [null, 'video']]
]) {
    test('未知导航保留：' + label, async () => {
        const body = JSON.stringify({ result: { modeMap: { normal: { navigationAll: list } } } });
        assert.equal((await run(body, 'readCustomSurfaceList')).result.body, body);
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

for (const status of [302, 403, 500]) {
    test('HTTP ' + status + ' 不读取响应', async () => {
        const f = await run({ images: [1] }, 'start', { status });
        assert.equal(f.result, undefined);
        assert.equal(f.calls.responseReads, 0);
    });
}

for (const data of [{ code: '605', images: [1] }, { success: false, images: [1] }, { ret: ['FAIL::LOGIN'], images: [1] }]) {
    test('业务错误正文保留：' + JSON.stringify(data), async () => {
        const body = ' ' + JSON.stringify(data) + '\n';
        assert.equal((await run(body)).result.body, body);
    });
}

for (const body of ['<html>error</html>', 'callback({"images":[1]})', '[{"images":[1]}]', 'null', '{broken']) {
    test('解析或结构失败返回已读取原文：' + body, async () => {
        const f = await run(body);
        assert.equal(f.result.body, body);
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
    assert.equal(second.result.body, first.result.body);
    assert.equal([...second.stored.values()][0].hits, 2);
});

test('generic 诊断不发网络、无通知、不写存储', async () => {
    const f = makeContext({ generic: true });
    const widget = await (await script)(f.ctx);
    assert.equal(widget.type, 'widget');
    assert.equal(widget.padding, 12);
    assert.equal(widget.children.length, 1);
    assert.equal(widget.children[0].type, 'text');
    assert.match(widget.children[0].text, /京东原生版本：eg-native-20261105-r1/);
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
    assert.match(yaml, /jd-ad-block\.egern\.js\?v=eg-native-20261105-r1/g);
    assert.doesNotMatch(yaml, /skernelx\/SurgeScripts/);
    assert.doesNotMatch(yaml, /\.sgmodule/);
});
