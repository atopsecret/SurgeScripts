// Build: 无；Run: node --test pinduoduo/tests/egern.test.cjs；Deps: Node.js 20+
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, makeContext, moduleText, urlPatterns } = require('../../jd/tests/egern-fixture.cjs');
const script = loadScript(__dirname, '../pdd-ad-block.egern.js');
const yaml = moduleText(__dirname, '../pdd-adblock.egern.yaml');
const HOMEPAGE = '/api/alexa/homepage/hub';
const coreTabs = ['index.html', 'chat_list.html', 'personal.html'].map(link => ({ link }));

async function run(body, path = HOMEPAGE, options = {}) {
    const fixture = makeContext({ body: typeof body === 'string' ? body : JSON.stringify(body), url: 'https://api.pinduoduo.com' + path + '?v=1', ...options });
    fixture.result = await (await script)(fixture.ctx);
    assert.equal(fixture.calls.network, 0);
    assert.equal(fixture.calls.notifications.length, 0);
    return fixture;
}

test('首页和备用底栏沿用三核心入口白名单', async () => {
    const tabs = [...coreTabs, { link: 'video.html' }];
    const f = await run({ result: { bottom_tabs: tabs, buffer_bottom_tabs: tabs, goods: [1] } });
    assert.deepEqual(JSON.parse(f.result.body).result, { bottom_tabs: coreTabs, buffer_bottom_tabs: coreTabs, goods: [1] });
    assert.equal(f.calls.responseReads, 1);
    assert.equal(f.response.bodyUsed, true);
    assert.equal([...f.stored.values()][0].tabsRemoved, 2);
});

test('首页清已知横幅、图标、热词，保留商品字段', async () => {
    const f = await run({ result: { all_top_opts: [{ selected_image: 'ad', image: 'ad', height: 1, width: 2, text: 'keep' }, null], dy_module: { irregular_banner_dy: {}, normal: true }, icon_set: {}, search_bar_hot_query: [], goods: [1] } });
    assert.deepEqual(JSON.parse(f.result.body), { result: { all_top_opts: [{ text: 'keep' }, null], dy_module: { normal: true }, goods: [1] } });
});

for (const [label, tabs] of [
    ['缺少核心', [{ link: 'video.html' }]],
    ['混合对象', [...coreTabs, null]],
    ['陌生协议', [{ route: 'home' }, { route: 'video' }]],
    ['非数组', { video: 1 }]
]) {
    test('未知导航整份保留：' + label, async () => {
        const body = JSON.stringify({ result: { bottom_tabs: tabs } });
        assert.equal((await run(body)).result.body, body);
    });
}

test('已知核心导航没有其它入口时保持原文', async () => {
    const body = '{ "result": ' + JSON.stringify({ bottom_tabs: coreTabs }) + ' }';
    assert.equal((await run(body)).result.body, body);
});

test('个人中心只删除既有推广与图标字段', async () => {
    const f = await run({ monthly_card_entrance: {}, personal_center_style_v2_vo: {}, icon_set: { icons: [], top_personal_icons: [], keep: 1 }, orders: [2] }, '/api/philo/personal/hub');
    assert.deepEqual(JSON.parse(f.result.body), { icon_set: { keep: 1 }, orders: [2] });
});

test('会场与直播浮层只清已知位置', async () => {
    const f = await run({ bottom_section_list: [], ui: { bottom_section: {}, live_section: { float_info: {}, video: true } }, keep: 1 }, '/api/oak/integration/render');
    assert.deepEqual(JSON.parse(f.result.body), { ui: { live_section: { video: true } }, keep: 1 });
});

test('订单详情清营销，不改变物流内容', async () => {
    const f = await run({ marketing_banner_vo: {}, shipping: { banner_above_recommend: {}, tracking: [1] }, order_id: 'test-only' }, '/order/detail');
    assert.deepEqual(JSON.parse(f.result.body), { shipping: { tracking: [1] }, order_id: 'test-only' });
});

test('订单列表只清按钮推广提示，容忍非对象项', async () => {
    const f = await run({ orders: [{ order_buttons: [{ order_growth_tip: {}, title: 'pay' }, null, 1] }, null], total: 1 }, '/api/aristotle/order_list_v4');
    assert.deepEqual(JSON.parse(f.result.body), { orders: [{ order_buttons: [{ title: 'pay' }, null, 1] }, null], total: 1 });
});

test('搜索只清 expansion', async () => {
    const f = await run({ expansion: {}, goods: [1], page: 2 }, '/search');
    assert.deepEqual(JSON.parse(f.result.body), { goods: [1], page: 2 });
});

test('备用域名 api.yangkeduo.com 归属有效', async () => {
    const f = await run({ expansion: {}, goods: [1] }, '/search', { url: 'https://api.yangkeduo.com/search?q=goods' });
    assert.deepEqual(JSON.parse(f.result.body), { goods: [1] });
});

for (const host of ['203.0.113.10', '[2001:db8::1]']) {
    test('裸 IP 加精确 Host 归属：' + host, async () => {
        const f = await run({ expansion: {}, goods: [1] }, '/search', { url: 'https://' + host + '/search?q=goods', headers: { HOST: 'api.pinduoduo.com:443' } });
        assert.deepEqual(JSON.parse(f.result.body), { goods: [1] });
    });
}

test('HTTP 裸 IP 订单同样按 Host 精确归属', async () => {
    const f = await run({ marketing_banner_vo: {}, keep: true }, '/order/detail', { url: 'http://203.0.113.10/order/detail', headers: { Host: 'API.YANGKEDUO.COM' } });
    assert.deepEqual(JSON.parse(f.result.body), { keep: true });
});

for (const headers of [{}, { Host: 'api.pinduoduo.com.evil.test' }, { Host: 'pinduoduo.com' }, { 'User-Agent': 'com.xunmeng.pinduoduo' }, { Host: 'api.pinduoduo.com:0' }, { Host: 'api.pinduoduo.com:65536' }]) {
    test('裸 IP 无正确 Host 不改写：' + JSON.stringify(headers), async () => {
        const f = await run({ expansion: {} }, '/search', { url: 'https://203.0.113.10/search?q=1', headers });
        assert.equal(f.result, undefined);
        assert.equal(f.calls.responseReads, 0);
        assert.equal(f.calls.sets, 0);
    });
}

for (const url of [
    'https://evilpinduoduo.com/search?q=1',
    'https://api.pinduoduo.com.evil.test/search?q=1',
    'https://api.pinduoduo.com@evil.test/search?q=1',
    'https://example.test/api/alexa/homepage/hub?v=1',
    'invalid-url'
]) {
    test('相似域名或伪造 Host 不足以归属：' + url, async () => {
        const f = await run({ expansion: {} }, '/search', { url, headers: { Host: 'api.pinduoduo.com' } });
        assert.equal(f.result, undefined);
        assert.equal(f.calls.responseReads, 0);
    });
}

for (const path of ['/search-other', '/api/alexa/homepage/hub-extra', '/api/message/list', '/order']) {
    test('未知路径不读取正文：' + path, async () => {
        const f = await run({ expansion: {} }, path);
        assert.equal(f.result, undefined);
        assert.equal(f.calls.responseReads, 0);
    });
}

for (const status of [302, 403, 500]) {
    test('HTTP ' + status + ' 未消费正文', async () => {
        const f = await run({ result: { icon_set: {} } }, HOMEPAGE, { status });
        assert.equal(f.result, undefined);
        assert.equal(f.calls.responseReads, 0);
    });
}

for (const body of ['<html>error</html>', 'callback({"expansion":{}})', '{broken', 'null', '[{"expansion":{}}]']) {
    test('解析失败返回单次读取的原文：' + body, async () => {
        const f = await run(body, '/search');
        assert.equal(f.result.body, body);
        assert.equal(f.calls.responseReads, 1);
    });
}

for (const data of [{ success: false, expansion: {} }, { is_success: false, expansion: {} }, { error_code: 401, expansion: {} }]) {
    test('业务错误原样保留：' + JSON.stringify(data), async () => {
        const body = ' ' + JSON.stringify(data) + '\n';
        assert.equal((await run(body, '/search')).result.body, body);
    });
}

test('字符串零 error_code 不被当成错误', async () => {
    const f = await run({ error_code: '0', expansion: {}, goods: [1] }, '/search');
    assert.deepEqual(JSON.parse(f.result.body), { error_code: '0', goods: [1] });
});

test('未知路径字段类型不创建节点', async () => {
    const body = '{ "ui": null, "unknown": true }';
    assert.equal((await run(body, '/api/oak/integration/render')).result.body, body);
});

test('读取异常不发网络请求', async () => {
    assert.equal((await run('{}', HOMEPAGE, { readError: true })).result, undefined);
});

test('存储异常不影响改写，且不保存商品/订单数据', async () => {
    const f = await run({ expansion: {}, goods: ['DO_NOT_STORE'] }, '/search', { storageReadError: true, storageWriteError: true });
    assert.deepEqual(JSON.parse(f.result.body), { goods: ['DO_NOT_STORE'] });
    const normal = await run({ expansion: {}, goods: ['DO_NOT_STORE'] }, '/search');
    assert.doesNotMatch(JSON.stringify([...normal.stored.values()]), /DO_NOT_STORE|goods/);
});

test('处理幂等，第二次原文保留', async () => {
    const first = await run({ expansion: {}, goods: [1] }, '/search');
    const second = await run(first.result.body, '/search', { stored: first.stored });
    assert.equal(second.result.body, first.result.body);
    assert.equal([...second.stored.values()][0].hits, 2);
});

test('generic 诊断只有本地日志，无写入和网络', async () => {
    const f = makeContext({ generic: true });
    const widget = await (await script)(f.ctx);
    assert.equal(widget.type, 'widget');
    assert.equal(widget.padding, 12);
    assert.equal(widget.children.length, 1);
    assert.equal(widget.children[0].type, 'text');
    assert.match(widget.children[0].text, /拼多多原生版本：eg-native-20261105-r1/);
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

test('素材与 HTTPDNS 原生 AND 保留 UA 条件且正则有路径边界', () => {
    const rules = yaml.split('rules:')[1].split('scriptings:')[0];
    assert.equal((rules.match(/^- and:/gm) || []).length, 4);
    assert.match(rules, /match: '\*com\.xunmeng\.pinduoduo\*'/);
    assert.match(rules, /match: '\*pinduoduo\*'/);
    assert.match(rules, /- domain:\n        match: api\.pinduoduo\.com\n    - protocol:\n        match: quic/);
    const [ipv4, ipv6, httpDNS] = urlPatterns(rules);
    assert.ok(ipv4.test('http://203.0.113.10/d1?x=1'));
    assert.equal(ipv4.test('http://203.0.113.10/download?x=1'), false);
    assert.ok(ipv6.test('http://[2001:db8::1]/d?x=1'));
    assert.ok(httpDNS.test('http://203.0.113.10/v3/d?x=1&type=addrs&v=2'));
    assert.equal(httpDNS.test('http://203.0.113.10/v3/d?type=addrsevil'), false);
});

test('十九个推荐接口全部有原生空 JSON，且后缀边界明确', () => {
    const section = yaml.split('map_locals:')[1].split('mitm:')[0];
    const patterns = urlPatterns(section);
    assert.equal((section.match(/body: '\{\}'/g) || []).length, 19);
    const paths = [
        '/api/aristotle/unrated_order_for_unreceived_tab', '/api/aristotle/query_order_list_tabs_element',
        '/api/aquarius/hungary/global/homepage', '/api/caterham/v3/query/order_express_group',
        '/search_hotquery', '/api/zaire_biz/chat/resource/get_list_data', '/api/caterham/v3/query/new_chat_group',
        '/api/alexa/goods/back_up', '/api/caterham/v3/query/personal', '/api/brand-olay/goods_detail/bybt_guide',
        '/api/engels/reviews/require/append', '/api/caterham/v3/query/my_order_group', '/api/caterham/v3/query/likes',
        '/api/phantom/gbdbpdv/extra', '/api/manufacturer/cross/shortcut/list',
        '/api/dunkirk/liveactivity/push/create/url/report', '/api/growth/nagato/app/index/gather',
        '/api/engels/wait/receive/review', '/api/buffon/nasus/recommend'
    ];
    for (const path of paths) {
        assert.equal(patterns.some(pattern => pattern.test('https://api.pinduoduo.com' + path + '?v=1')), true, path);
        assert.equal(patterns.some(pattern => pattern.test('https://api.pinduoduo.com' + path + '-extra?v=1')), false, path);
    }
});

test('普通图片 CDN 与其它网站视频浮层不匹配', () => {
    const patterns = urlPatterns(yaml);
    for (const url of ['https://cdl-1.pddpic.com/review.jpg', 'https://pddpic.com/goods.jpg', 'https://example.test/vlayer_tab_popup.html']) {
        assert.equal(patterns.some(pattern => pattern.test(url)), false, url);
    }
    assert.ok(patterns.some(pattern => pattern.test('https://m.pinduoduo.net/vlayer_tab_popup.html')));
    assert.doesNotMatch(yaml, /domain_suffix:\s*\n\s*match: pddpic\.com/);
    assert.doesNotMatch(yaml, /^block_quic:|^ipv6:|^dns:/m);
});

test('原生版本与链接完整，不引用 Surge 脚本', () => {
    assert.match(yaml, /pdd-ad-block\.egern\.js\?v=eg-native-20261105-r1/);
    assert.doesNotMatch(yaml, /skernelx\/SurgeScripts|\.sgmodule/);
});
