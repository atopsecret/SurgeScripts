// Engine | Node.js 20+ | JavaScript
// Build: 无需构建
// Run: node --test amap/tests/cleaner.test.cjs
// Deps: Node.js 内置模块；无网络、无真实抓包数据或凭据
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { VERSION, route, transform, responseHeaders } = require('../amap-cleaner.js');
const source = fs.readFileSync(path.join(__dirname, '../amap-cleaner.js'), 'utf8');
const moduleText = fs.readFileSync(path.join(__dirname, '../amap-adblock.sgmodule'), 'utf8');
const sections = {};
let section;
for (const raw of moduleText.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) { section = line; sections[section] = []; }
    else if (section) sections[section].push(line);
}
const maps = sections['[Map Local]'].map(line => {
    const split = line.indexOf(' data-type=');
    return { regex: new RegExp(line.slice(0, split)), line,
        type: line.match(/data-type=(\w+)/)[1], data: line.match(/ data="([^"]*)"/)[1],
        header: line.match(/ header="([^"]*)"/)[1] };
});
function mock(url) {
    const row = maps.find(entry => entry.regex.test(url));
    return row && { ...row, body: row.type === 'base64' ? Buffer.from(row.data, 'base64').toString() : row.data };
}
function changed(id, data, extra = {}) {
    const result = transform(id, JSON.stringify({ result: 'true', code: '1', ...extra, data }));
    assert.equal(result.status, 'changed'); return JSON.parse(result.body);
}
function run(options = {}) {
    const logs = [], output = [], store = options.store || new Map();
    const context = {
        console: { log: text => logs.push(text) }, $done: value => output.push(value),
        $persistentStore: {
            read: key => { if (options.storageThrows) throw Error('SECRET_STORAGE'); return store.get(key) || null; },
            write: (value, key) => { if (options.storageThrows) throw Error('SECRET_STORAGE'); if (options.storageFalse) return false; store.set(key, value); return true; },
        },
    };
    if (options.url) context.$request = { url: options.url };
    if (options.response) context.$response = options.response;
    vm.runInNewContext(source, context, { timeout: 1000 });
    assert.equal(output.length, 1);
    return { output: JSON.parse(JSON.stringify(output[0])), logs, store };
}
const urls = {
    notice: '/ws/message/notice/list', home: '/ws/faas/amap-navigation/main-page',
    message: '/ws/msgbox/pull', profile: '/ws/shield/dsp/profile/index/nodefaas',
    hotword: '/ws/shield/search/new_hotword', config: '/ws/shield/frogserver/aocs/updatable',
    nearby: '/ws/shield/search/nearbyrec_smart', taxi: '/ws/promotion-web/resource',
};

test('RT 开屏路径返回 multipart/jsonData 而不是旧规则漏匹配', () => {
    const url = 'https://amap-aos-info-nogw.amap.com/ws/aos/alimama/splash_screen_rt?ent=FIXTURE';
    const value = mock(url); assert.ok(value);
    assert.match(value.header, /multipart\/form-data; boundary=amap-cleaner-2-0-0/);
    const boundary = 'amap-cleaner-2-0-0';
    const parts = value.body.split('--' + boundary).filter(part => part.includes('Content-Disposition'));
    assert.equal(parts.length, 1); assert.match(parts[0], /name="jsonData"/);
    const payload = JSON.parse(parts[0].split('\r\n\r\n')[1].trim());
    assert.equal(payload.result, 'true'); assert.equal(payload.code, '1');
    assert.equal(payload.data.status, 'ok'); assert.equal(payload.data.errcode, '1');
    assert.deepEqual(payload.data.custom_list, []); assert.deepEqual(payload.data.ad, []);
    assert.equal(payload.version, '1.0_amap-aos-info-nogw');
    assert.doesNotMatch(value.body, /image_url|image_multipart_name|filename=|imgData|imgMsg/);
    assert.match(value.body, /\r\n--amap-cleaner-2-0-0--\r\n$/);
    assert.match(value.header, /Cache-Control:no-store/);
});
test('新旧开屏通道、版本子路径、查询及显式端口均覆盖', () => {
    for (const scheme of ['http', 'https']) for (const channel of ['aos', 'valueadded']) for (const suffix of ['', '_rt']) {
        for (const end of ['', '?ent=FIXTURE', '/1.0?x=1']) {
            const value = mock(`${scheme}://m5.amap.com:443/ws/${channel}/alimama/splash_screen${suffix}${end}`);
            if (channel === 'valueadded' && suffix === '_rt') {
                assert.equal(value, undefined); continue; // 未抓到该通道格式，不套用 aos 的 multipart。
            }
            assert.ok(value); assert.match(value.header, /X-AMap-Cleaner-Version:2.0.0/);
            if (!suffix) assert.deepEqual(JSON.parse(value.body).data.ad, []);
        }
    }
});
test('开屏规则不误匹配未知后缀或伪造主机', () => {
    for (const host of ['evilamap.com', 'amap.com.evil.test', 'm5.amap.com.evil.test']) {
        assert.equal(mock(`https://${host}/ws/aos/alimama/splash_screen_rt`), undefined);
    }
    for (const suffix of ['_rtx', '_report', '_rt_extra', '2']) {
        assert.equal(mock('https://m5.amap.com/ws/aos/alimama/splash_screen' + suffix), undefined);
    }
});
test('普通开屏返回空 JSON 广告容器且不引用任何素材', () => {
    const value = mock('https://m5.amap.com/ws/valueadded/alimama/splash_screen');
    const data = JSON.parse(value.body);
    assert.equal(data.result, 'true'); assert.deepEqual(data.data.custom_list, []);
    assert.doesNotMatch(value.body, /https?:|session_id|image_url/);
});
test('AI 推荐、路线卡片、订单 Tip、scene、推广天气均有明确本地响应', () => {
    for (const tail of ['/v1/ai_rec/home_qs', '/v12/ai_rec/home_explore',
        '/ws/faas/amap-navigation/card-service-route-plan?x=1', '/ws/boss/order_web/1234abcd_information',
        '/ws/shield/scene/recommend', '/ws/valueadded/weather']) {
        assert.equal(mock('https://ai.amap.com' + tail).body, '{}');
    }
});
test('导航、地图瓦片、定位、家庭组及用户搜索不匹配本地替换', () => {
    for (const tail of ['/ws/render/bmd/tile', '/v3/direction/driving', '/v3/geocode/regeo',
        '/ws/tservice/team/family/member/status', '/v3/place/text', '/ws/valueadded/weather_detail']) {
        assert.equal(mock('https://m5.amap.com' + tail), undefined);
        assert.equal(route('https://m5.amap.com' + tail), null);
    }
});
test('页面模块正则与脚本分流对八个端点一致', () => {
    const line = sections['[Script]'].find(line => line.includes('type=http-response'));
    const pattern = new RegExp(line.match(/pattern=(.*?),requires-body=/)[1]);
    for (const [id, tail] of Object.entries(urls)) for (const end of ['', '/1?x=1', '?x=1']) {
        const url = 'https://m5.amap.com' + tail + end;
        assert.equal(pattern.test(url), true); assert.equal(route(url), id);
    }
    for (const tail of Object.values(urls)) {
        const url = 'https://m5.amap.com' + tail + '_unknown';
        assert.equal(pattern.test(url), false); assert.equal(route(url), null);
    }
});
test('页面脚本拒绝无关协议、主机和未知路径', () => {
    for (const url of ['https://evil.test/ws/msgbox/pull', 'https://amap.com.evil.test/ws/msgbox/pull',
        'file://m5.amap.com/ws/msgbox/pull', 'https://m5.amap.com/unknown']) assert.equal(route(url), null);
});
test('底栏通知只清 noticeList，其他字段与业务状态保留', () => {
    const root = changed('notice', { noticeList: [1], actualMessage: 'KEEP' });
    assert.deepEqual(root.data.noticeList, []); assert.equal(root.data.actualMessage, 'KEEP'); assert.equal(root.code, '1');
});
test('消息推广覆盖顶层与 data 里的已知列表', () => {
    const root = changed('message', { msgs: [1], pull3: { msgs: [2], keep: 1 } }, { msgs: [3], pull3: { msgs: [4] } });
    assert.deepEqual(root.msgs, []); assert.deepEqual(root.pull3.msgs, []);
    assert.deepEqual(root.data.msgs, []); assert.equal(root.data.pull3.keep, 1);
});
test('首页删除明确广告卡，未知业务卡与字典类型不变', () => {
    const root = changed('home', { cardList: { ad: { dataType: 'AdCard' }, commute: { dataType: 'CommuteCard' } },
        mapBizList: [{ isAd: true }, { dataType: 'UnknownUsefulCard' }], business_position: [1], pull3: { msgs: [2] } });
    assert.deepEqual(Object.keys(root.data.cardList), ['commute']);
    assert.equal(Array.isArray(root.data.cardList), false); assert.equal(root.data.mapBizList.length, 1);
    assert.deepEqual(root.data.business_position, []); assert.deepEqual(root.data.pull3.msgs, []);
});
test('个人页面保留订单与未知卡片，不按允许名单大面积删除', () => {
    const root = changed('profile', { tipData: {}, cardList: [{ dataType: 'MyOrderCard' }, { dataType: 'UnknownCard' }, { is_ad: true }] });
    assert.equal(root.data.tipData, undefined); assert.equal(root.data.cardList.length, 2);
});
test('搜索热词不影响真实搜索结果和历史', () => {
    const root = changed('hotword', { header_hotword: [1], results: [2], history: [3] });
    assert.deepEqual(root.data.header_hotword, []); assert.deepEqual(root.data.results, [2]); assert.deepEqual(root.data.history, [3]);
});
test('推广配置使用精确键，地图引擎和 AI 不被宽泛字符串误伤', () => {
    const payload = { status: 0, version: 'v', value: 'SECRET_PROMOTION', extra: 'KEEP' };
    const root = changed('config', { operation_layer: payload, SplashScreenControl: payload,
        engine_render: payload, ai_navigation: payload, ai_plan_new: payload, unrelated: 42 });
    assert.equal(root.data.operation_layer.value, ''); assert.equal(root.data.operation_layer.extra, 'KEEP');
    assert.equal(root.data.engine_render.value, 'SECRET_PROMOTION'); assert.equal(root.data.ai_navigation.value, 'SECRET_PROMOTION');
    assert.equal(root.data.ai_plan_new.value, 'SECRET_PROMOTION');
});
test('附近优惠与运营入口清理，未知模块对象原样保留', () => {
    const root = changed('nearby', { coupon: {}, scene: [], activity: {}, commodity_rec: [], operation_activity: {},
        modules: ['coupon', 'poi', { type: 'unknown' }], pois: [1] });
    assert.deepEqual(root.data.modules, ['poi', { type: 'unknown' }]); assert.deepEqual(root.data.pois, [1]);
    assert.equal(root.data.coupon, undefined);
});
test('打车推广按原类型清空，真实订单和未知字段保留', () => {
    const root = changed('taxi', { icon: [1], banner: { ad: 1 }, tips: 'UNKNOWN', order: { id: 'FAKE' } });
    assert.deepEqual(root.data.icon, []); assert.deepEqual(root.data.banner, {});
    assert.equal(root.data.tips, 'UNKNOWN'); assert.deepEqual(root.data.order, { id: 'FAKE' });
});
test('格式不符、JSONP、空体、已为空数据都保留原响应', () => {
    for (const body of ['', 'callback({})', 'null', '[]', '<html>error</html>', '{']) assert.notEqual(transform('home', body).status, 'changed');
    for (const data of [null, [], 'unknown', { cardList: [] }, { header_hotword: 'unknown' }]) {
        assert.notEqual(transform('hotword', JSON.stringify({ data })).status, 'changed');
    }
    assert.equal(transform('unknown', '{}').status, 'unsupported');
});
test('明确服务端失败不抹掉错误或修改广告字段', () => {
    for (const root of [{ result: false }, { result: 'false' }, { result: 'failure' }, { success: false }, { success: 'false' }, { code: '500' }]) {
        assert.equal(transform('notice', JSON.stringify({ ...root, data: { noticeList: [1] } })).status, 'server-error');
    }
});
test('改写是幂等的，二次执行不会重复修改', () => {
    const first = changed('notice', { noticeList: [1] });
    assert.equal(transform('notice', JSON.stringify(first)).status, 'unchanged');
});
test('改写后清理过时编码、长度和校验头，保留其他头', () => {
    const headers = responseHeaders({ 'Content-Length': '999', 'Content-Encoding': 'gzip', ETag: 'old',
        'Transfer-Encoding': 'chunked', 'Content-MD5': 'old', 'Content-Type': 'old', 'Cache-Control': 'max-age=60', 'X-Keep': 'KEEP' });
    for (const key of ['Content-Length', 'Content-Encoding', 'ETag', 'Transfer-Encoding', 'Content-MD5']) assert.equal(headers[key], undefined);
    assert.equal(headers['Content-Type'], 'application/json; charset=utf-8'); assert.equal(headers['X-Keep'], 'KEEP');
    assert.equal(headers['Cache-Control'], 'no-store'); assert.equal(headers['X-AMap-Cleaner-Version'], VERSION);
});
test('真实脚本钩子只结束一次，输出改写体及本地结果', () => {
    const h = run({ url: 'https://m5.amap.com/ws/message/notice/list?secret=SECRET_QUERY',
        response: { status: 200, body: JSON.stringify({ data: { noticeList: [1] } }), headers: {} } });
    assert.deepEqual(JSON.parse(h.output.body).data.noticeList, []);
    assert.doesNotMatch(h.logs.join('\n'), /SECRET_QUERY|https?:/);
    const stored = JSON.parse([...h.store.values()][0]); assert.equal(stored.routes.notice.changed, 1);
});
test('非 200 HTTP 与无变化响应不返回新 body/headers', () => {
    for (const response of [{ status: 503, body: 'SECRET_ERROR' }, { status: 200, body: '{"data":{"noticeList":[]}}' }]) {
        const h = run({ url: 'https://m5.amap.com/ws/message/notice/list', response });
        assert.deepEqual(h.output, {}); assert.doesNotMatch(h.logs.join('\n'), /SECRET_ERROR/);
    }
});
test('存储失败、损坏或 API 不可用不影响页面', () => {
    for (const options of [{ storageThrows: true }, { storageFalse: true }, { store: new Map([['skernelx_amap_cleaner_v2', 'SECRET_BROKEN']]) }]) {
        const h = run({ ...options, url: 'https://m5.amap.com/ws/message/notice/list', response: { status: 200, body: '{"data":{"noticeList":[1]}}' } });
        assert.ok(h.output.body); assert.doesNotMatch(h.logs.join('\n'), /SECRET_/);
    }
});
test('诊断仅打印固定路由统计，明确说明开屏不是脚本计数', () => {
    const h = run(); assert.deepEqual(h.output, {});
    assert.match(h.logs.join('\n'), /脚本版本 2.0.0/); assert.match(h.logs.join('\n'), /开屏由 Map Local 处理/);
    assert.equal(h.logs.filter(line => line.includes('已改写=')).length, 8);
});
test('存储异常的零计数不被误报为未命中', () => {
    const h = run({ storageThrows: true });
    assert.match(h.logs.join('\n'), /零值不代表没有命中/);
    assert.doesNotMatch(h.logs.join('\n'), /SECRET_STORAGE/);
});
test('诊断计数可以从实际页面钩子延续到手动查询', () => {
    const first = run({ url: 'https://m5.amap.com/ws/message/notice/list', response: { status: 200, body: '{"data":{"noticeList":[1]}}' } });
    const second = run({ store: first.store });
    assert.match(second.logs.join('\n'), /notice: 已改写=1/);
    assert.doesNotMatch(second.logs.join('\n'), /尚无页面处理记录/);
});
test('计数损坏或过大时不污染日志或无限增长', () => {
    const store = new Map([['skernelx_amap_cleaner_v2', JSON.stringify({ version: VERSION, routes: {
        notice: { changed: 9999999, format: -1, empty: 'SECRET' }, 'SECRET_URL': { changed: 1 },
    } })]]);
    const h = run({ store, url: 'https://m5.amap.com/ws/message/notice/list', response: { status: 200, body: '{"data":{"noticeList":[1]}}' } });
    assert.equal(JSON.parse([...h.store.values()][0]).routes.notice.changed, 999999);
    const diag = run({ store }); assert.doesNotMatch(diag.logs.join('\n'), /SECRET/);
});
test('没有响应、未知主机或非目标请求只放行', () => {
    for (const options of [{ url: 'https://m5.amap.com/unknown' }, { url: 'https://m5.amap.com/ws/msgbox/pull' },
        { url: 'https://evil.test/ws/msgbox/pull', response: { status: 200, body: '{}' } }]) assert.deepEqual(run(options).output, {});
});
test('所有正则可编译，版本与脚本路径一致且无第三方运行依赖', () => {
    for (const row of sections['[URL Rewrite]']) new RegExp(row.split(' - ')[0]);
    assert.equal(sections['[Script]'].length, 2);
    for (const line of sections['[Script]']) {
        const url = new URL(line.match(/script-path=([^,]+)/)[1]);
        assert.equal(url.hostname, 'raw.githubusercontent.com');
        assert.equal(url.pathname, '/atopsecret/SurgeScripts/main/amap/amap-cleaner.js');
        assert.equal(url.searchParams.get('v'), VERSION);
    }
    assert.doesNotMatch(moduleText, /script-path=.*(?:ddgksf|jsdelivr)|amap-splash\.js|amdc\.m\.taobao/);
    assert.ok(moduleText.includes('#!desc=' + VERSION));
    assert.deepEqual(sections['[MITM]'], ['hostname = %APPEND% *.amap.com']);
    assert.deepEqual(sections['[Rule]'], ['DOMAIN,optimus-ads.amap.com,REJECT']);
});
