// Engine | Node.js 20+ | JavaScript
// Build: python3 amap/build.py
// Run: node --experimental-vm-modules --test amap/tests/*.test.cjs
// Deps: Node.js 内置模块、Python 3；纯合成数据，无网络和真实账号
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const base = path.join(__dirname, '..');
const surge = require('../amap-cleaner.js');
const plain = value => JSON.parse(JSON.stringify(value));
async function load(name) {
    const module = new vm.SourceTextModule(fs.readFileSync(path.join(base, name), 'utf8'), { context: vm.createContext({}) });
    await module.link(() => { throw Error('不能动态加载依赖'); });
    await module.evaluate({ timeout: 1000 });
    return module.namespace;
}
const engines = Promise.all([Promise.resolve(surge), load('amap-cleaner.egern.js'), load('amap-policy.js')]);
async function clean(id, root) {
    const source = typeof root === 'string' ? root : JSON.stringify(root);
    const results = (await engines).map(engine => plain(engine.transform(id, source)));
    assert.deepEqual(results[1], results[0], 'Egern 与 Surge 必须相同');
    assert.deepEqual(results[2], results[0], '发布脚本与策略源必须相同');
    if (results[0].status === 'changed') {
        for (const engine of await engines) assert.equal(engine.transform(id, results[0].body).status, 'unchanged', '必须幂等');
    }
    return results[0];
}
async function changed(id, data, extra = {}) {
    const result = await clean(id, { result: 'true', code: '1', data, ...extra });
    assert.equal(result.status, 'changed');
    return JSON.parse(result.body);
}
const payload = value => ({ status: 1, version: 'keep-version', value: typeof value === 'string' ? value : JSON.stringify(value), keep: true });

test('共用策略构建可重复，两个客户端及模块匹配式无漂移', () => {
    assert.match(execFileSync('python3', [path.join(base, 'build.py'), '--check'], { encoding: 'utf8', timeout: 10000 }), /检查通过/);
    for (const file of ['amap-cleaner.js', 'amap-cleaner.egern.js']) assert.doesNotMatch(fs.readFileSync(path.join(base, file), 'utf8'), /\{\{POLICY\}\}|\bimport\s/);
});
test('v3、首页 assets/aiqs 与新附近只接受明确别名，未知版本和后缀拒绝', async () => {
    for (const engine of await engines) {
        for (const [tail, id] of [
            ['shield/dsp/profile/index/nodefaasv3', 'profile'],
            ['faas/amap-navigation/main-page-assets', 'home'],
            ['faas/amap-navigation/main-page-aiqs', 'home'], ['smartui/near_recommend', 'nearby']
        ]) for (const ending of ['', '?x=1', '/1?x=1']) assert.equal(engine.route('https://m5.amap.com:443/ws/' + tail + ending), id);
        for (const tail of ['shield/dsp/profile/index/nodefaasv4', 'shield/dsp/profile/index/nodefaasv3_report',
            'faas/amap-navigation/main-page-aiqs_extra', 'faas/amap-navigation/main-page-assets_extra',
            'smartui/near_recommendation']) assert.equal(engine.route('https://m5.amap.com/ws/' + tail), null);
    }
});
test('全部十五路及未知后缀，Surge 模块与三份纯路由完全一致', async () => {
    const module = fs.readFileSync(path.join(base, 'amap-adblock.sgmodule'), 'utf8');
    const regex = new RegExp(module.match(/pattern=(.*?),requires-body=/)[1]);
    const tails = ['message/notice/list', 'faas/amap-navigation/main-page', 'msgbox/pull', 'shield/dsp/profile/index/nodefaasv3',
        'shield/search/new_hotword', 'shield/frogserver/aocs/updatable/1', 'smartui/near_recommend', 'promotion-web/resource/home',
        'shield/search/poi/detail', 'shield/search_business/process/middleLayer/sug', 'c3frontend/af-search/search',
        'boss/car/order/content_info', 'amap/hitch/passenger/content_info', 'opc/tools/list', 'shield/scene/recommend'];
    for (const tail of tails) for (const host of ['m5.amap.com', 'info.amap.com:443', 'm5.amap.com.evil.test', 'evilamap.com']) {
        const url = 'https://' + host + '/ws/' + tail + '?fixture=1';
        for (const engine of await engines) assert.equal(regex.test(url), engine.route(url) !== null);
    }
    assert.equal(surge.PATHS.length, 15);
});
test('个人页 v3 不采用保留名单，保留订单、钱包和新业务卡', async () => {
    const root = await changed('profile', { tipData: {}, wallet: { balance: 1 }, cardList: [
        { dataKey: 'MyOrderCard' }, { dataKey: 'FutureCard' }, { dataKey: 'MineNewBEntranceCardV4' }, { isAd: true }
    ] });
    assert.equal(root.data.cardList.length, 3); assert.deepEqual(root.data.wallet, { balance: 1 });
});
test('地点详情只清明确推广，正常地图、评价、资质、预订和未知模块保留', async () => {
    const keep = ['baseInfo', 'reviews', 'businessQualifications', 'poiMapModule', 'scenic_ticket', 'hotelRooms', 'FutureModule'];
    const data = { modules: Object.fromEntries(keep.map(key => [key, { keep: true }])) };
    Object.assign(data.modules, { CouponBanner: {}, yellowPageAdRecommendModule: {}, FlaggedAd: { isAd: true } });
    const root = await changed('poi', data);
    assert.deepEqual(Object.keys(root.data.modules), keep);
});
test('地点详情区域、半隐藏、锚点与提示同步清引用，未到货的未知目标保留', async () => {
    const root = await changed('poi', {
        regions: { main: ['CouponBanner', 'FutureModule', { future: true }], bad: 'KEEP' },
        meta: { half_hidden_modules: ['CouponBanner', 'reviews'] },
        modules: { CouponBanner: {}, reviews: {}, anchor: { data: { items: [
            { anchor: ['CouponBanner'] }, { anchor: ['CouponBanner', 'FutureModule'] },
            { anchor: [] }, { anchor: 'UNKNOWN' }, null
        ] } }, poiDetailCommonConfig: { data: { swipeUpPanelConfig: { swipeUpPanelTextList: [
            { modulesMap: ['CouponBanner'] }, { modulesMap: ['reviews'] }, { label: 'KEEP' }
        ] } } } }
    });
    assert.deepEqual(root.data.regions, { main: ['FutureModule', { future: true }], bad: 'KEEP' });
    assert.deepEqual(root.data.meta.half_hidden_modules, ['reviews']);
    assert.deepEqual(root.data.modules.anchor.data.items, [{ anchor: ['FutureModule'] }, { anchor: [] }, { anchor: 'UNKNOWN' }, null]);
    assert.equal(root.data.modules.poiDetailCommonConfig.data.swipeUpPanelConfig.swipeUpPanelTextList.length, 2);
});
test('地点详情只清奖励文案，不删除写评价功能或普通标题', async () => {
    for (const [title, expected] of [['写评论赢奖励', undefined], ['写评价', '写评价']]) {
        const root = await changed('poi', { modules: { combineReviews: { data: { write_comment: { title, btnRightTag: '奖励', action: 'KEEP' } } } } });
        const comment = root.data.modules.combineReviews.data.write_comment;
        assert.equal(comment.title, expected); assert.equal(comment.action, 'KEEP'); assert.equal(comment.btnRightTag, undefined);
    }
});
test('搜索联想只筛明确广告，不按任务标签保留名单删除正常联想', async () => {
    const result = await clean('suggest', { tip_list: [
        { tip: { result_type: 'ad' } }, { tip: { result_type: 'poi_ad' } }, { tip: { task_tag: 'ad' } },
        { tip: { datatype_spec: '12' } }, { tip: { task_tag: 'sp', name: 'KEEP' } },
        { tip: { task_tag: 'FutureTag' } }, null
    ], data: 'UNKNOWN' });
    assert.equal(result.status, 'changed'); assert.equal(JSON.parse(result.body).tip_list.length, 3);
});
test('搜索快捷入口只改 badge.text，名称、链接及未知结构保留', async () => {
    const root = await changed('quicklink', { modules: { quickLink: { data: { list: [
        { name: '地图', url: 'KEEP', badge: { text: '推荐', color: 'KEEP' } }, { badge: 'UNKNOWN' }, null
    ] } }, unknown: 'KEEP' } });
    const list = root.data.modules.quickLink.data.list;
    assert.deepEqual(list[0], { name: '地图', url: 'KEEP', badge: { text: '', color: 'KEEP' } });
    assert.equal(list[1].badge, 'UNKNOWN');
});
test('新附近清运营项，附近 POI 与未知模块对象保留', async () => {
    const root = await changed('nearby', { operation_activity: {}, modules: { coupon: {}, poi: {}, unknown: {} }, pois: [1] });
    assert.deepEqual(root.data.modules, { poi: {}, unknown: {} }); assert.deepEqual(root.data.pois, [1]);
});
test('打车补充四个容器仍按原类型清空，不清真实订单和未知标量', async () => {
    const root = await changed('taxi', { alpha: [1], bravo: {}, charlie: [1], push: { ad: 1 }, tips: 'UNKNOWN', order: 'KEEP' });
    assert.deepEqual(root.data, { alpha: [], bravo: {}, charlie: [], push: {}, tips: 'UNKNOWN', order: 'KEEP' });
});
test('订单工具箱只去明确推广 ID，顺风车、代驾及未知工具保留', async () => {
    const ids = ['dache_toolbox_promo', 'dache_toolbox_marketing', 'dache_toolbox_hitch', 'dache_toolbox_chauffeur', 'future-tool'];
    const root = await changed('taxiOrder', { order: { id: 'KEEP' }, lubanData: {
        skin: {}, popup: {}, kingToolBoxBubble: {},
        kingToolBox: { dataList: ids.map(id => ({ biz: { id } })) },
        kingToolSort: { dataList: [{ biz: { kingToolIdList: ids } }, null] }
    } });
    assert.deepEqual(root.data.lubanData.kingToolBox.dataList.map(item => item.biz.id), ids.slice(2));
    assert.deepEqual(root.data.lubanData.kingToolSort.dataList[0].biz.kingToolIdList, ids.slice(2));
    assert.deepEqual(root.data.order, { id: 'KEEP' });
});
test('顺风车只删 banner，不删行程、乘客、订单或其他字段', async () => {
    const root = await changed('hitch', { lubanData: { banner: {}, trip: {}, passenger: {}, future: 1 }, order: 'KEEP' });
    assert.deepEqual(root.data, { lubanData: { trip: {}, passenger: {}, future: 1 }, order: 'KEEP' });
});
test('工具箱清提示及 547，其他 ID 和非对象元素保留', async () => {
    const root = await changed('tools', { category: [{ tools: [{ id: 547 }, { id: '547' }, { id: 1, tips: '广告', name: 'KEEP' }, { id: 'future' }, null, 7] }, { tools: 'UNKNOWN' }] });
    assert.deepEqual(root.data.category[0].tools, [{ id: 1, name: 'KEEP' }, { id: 'future' }, null, 7]);
    assert.equal(root.data.category[1].tools, 'UNKNOWN');
});
test('scene 不再整包清空，历史、快捷入口、新模块及真实工具保留', async () => {
    const root = await changed('scene', { history: [1], shadingWords: { data: {
        modules: { ad: {}, history: {}, quickLink: {}, Future: {}, Flagged: { is_ad: true } },
        regions: { content: ['ad', 'Flagged', 'history', 'quickLink', 'Future'] }
    } }, toolsRecommend: { data: { default: [{ id: 547 }, { id: 102 }, { id: 'future' }] } } });
    assert.deepEqual(root.data.history, [1]);
    assert.deepEqual(root.data.shadingWords.data.regions.content, ['history', 'quickLink', 'Future']);
    assert.deepEqual(root.data.toolsRecommend.data.default, [{ id: 102 }, { id: 'future' }]);
});
test('搜索历史配置只去推荐开关，保留 history、未知字段和版本', async () => {
    const root = await changed('config', { his_input_tip: payload({ channel_zhitiao: {}, his_recommend_bangdan: 1, nearby_hotword: { search_detail: 1, keep: true }, history: [1], Future: {} }) });
    assert.deepEqual(JSON.parse(root.data.his_input_tip.value), { his_recommend_bangdan: 0, nearby_hotword: { search_detail: 0, keep: true }, history: [1], Future: {} });
    assert.equal(root.data.his_input_tip.version, 'keep-version'); assert.equal(root.data.his_input_tip.keep, true);
});
test('内嵌配置定点去广告，不清空渲染、导航音乐、AI 或未知字段', async () => {
    const root = await changed('config', {
        engine_render: payload({ can_show_advert: 1, advert_note_num: 3, engine: 'KEEP' }),
        navi_cloud: payload({ QQMusicVipText: 'AD', ETCGuide: 'AD', music_config: 'KEEP', end_auto_foot_explore: 1, route: 'KEEP' }),
        amap_basemap_config: payload({ splash: {}, coins_lottery: {}, ai_navigation: 'KEEP' }),
        taxi: payload({ banner_picture_url: 'AD', dache_toolbox_marketing: {}, recommend_point_optimization: true, order: 'KEEP' }),
        ai_navigation: payload({ keep: true }), wallet: payload({ keep: true })
    });
    assert.deepEqual(JSON.parse(root.data.engine_render.value), { engine: 'KEEP' });
    assert.deepEqual(JSON.parse(root.data.navi_cloud.value), { music_config: 'KEEP', end_auto_foot_explore: 0, route: 'KEEP' });
    assert.deepEqual(JSON.parse(root.data.amap_basemap_config.value), { ai_navigation: 'KEEP' });
    assert.deepEqual(JSON.parse(root.data.taxi.value), { recommend_point_optimization: 0, order: 'KEEP' });
    assert.deepEqual(root.data.ai_navigation, payload({ keep: true })); assert.deepEqual(root.data.wallet, payload({ keep: true }));
});
test('运动与导航结束配置只清 banner 和运营按钮', async () => {
    const root = await changed('config', { sportsGroupConfig: payload({ group_banner: {}, group: 'KEEP' }), sportsRouteConfig: payload({ group_banner: {}, route: 'KEEP' }), navi_end: payload({ operator_btns: [], destination: 'KEEP' }) });
    assert.deepEqual(JSON.parse(root.data.sportsGroupConfig.value), { group: 'KEEP' });
    assert.deepEqual(JSON.parse(root.data.sportsRouteConfig.value), { route: 'KEEP' });
    assert.deepEqual(JSON.parse(root.data.navi_end.value), { destination: 'KEEP' });
});
test('配置无效 JSON、数组、原始类型与未知结构保留字面原值', async () => {
    for (const value of ['not JSON', '[]', 'null', '42', 'true', ' { "engine": "KEEP" } ']) {
        const result = await clean('config', { data: { engine_render: payload(value) } });
        assert.equal(result.status, 'unchanged');
    }
});
test('定点开关缺失或未知结构不补造路径和数值', async () => {
    const result = await clean('config', { data: { navi_cloud: payload({ route: 1 }), his_input_tip: payload({ nearby_hotword: 'UNKNOWN' }), taxi: payload({ recommend_point_optimization: {} }) } });
    assert.equal(result.status, 'unchanged');
});
test('新增广告专用配置保留元数据，钱包与未知键不删除', async () => {
    const root = await changed('config', { adImEntryConfig: payload('AD'), homepage_resource_config: payload('AD'), wallet: { value: 'KEEP' }, future_ad_name: payload('KEEP') });
    assert.equal(root.data.adImEntryConfig.value, ''); assert.equal(root.data.adImEntryConfig.keep, true);
    assert.deepEqual(root.data.wallet, { value: 'KEEP' }); assert.equal(root.data.future_ad_name.value, 'KEEP');
});
test('新增十五路对业务错误、未知正文与畸形 data 均安全放行', async () => {
    for (const [id] of surge.PATHS) {
        for (const data of [undefined, null, [], 1, 'UNKNOWN', {}]) {
            assert.notEqual((await clean(id, { data })).status, 'changed');
            assert.equal((await clean(id, { code: '500', data })).status, 'server-error');
        }
        for (const body of ['null', '[1]', '{', '<html>']) assert.equal((await clean(id, body)).status, 'format');
    }
});
test('Surge 也清理全部摘要头，保留多值 Cookie 与未知业务头', () => {
    const headers = surge.responseHeaders({ Digest: 'old', 'Content-Digest': 'old', 'Repr-Digest': 'old', 'Set-Cookie': ['a=1', 'b=2'], 'X-Business': 'KEEP' });
    for (const key of ['Digest', 'Content-Digest', 'Repr-Digest']) assert.equal(headers[key], undefined);
    assert.deepEqual(headers['Set-Cookie'], ['a=1', 'b=2']); assert.equal(headers['X-Business'], 'KEEP');
});
test('新增本地推荐路径严格匹配，不拦 scene、未知 AI、其他主机和后缀', () => {
    const text = fs.readFileSync(path.join(base, 'amap-adblock.sgmodule'), 'utf8');
    const regexes = text.split('\n').filter(line => line.startsWith('^') && line.includes(' data-type=')).map(line => new RegExp(line.split(' data-type=')[0]));
    const matches = url => regexes.some(regex => regex.test(url));
    for (const tail of ['/ws/info_bff/rankingCard', '/ws/shield/search_business/process/marketingOperationStructured']) {
        assert.equal(matches('https://m5.amap.com:443' + tail + '?x=1'), true);
        for (const url of ['https://m5.amap.com' + tail + '_extra', 'https://info.amap.com' + tail, 'https://m5.amap.com.evil.test' + tail]) assert.equal(matches(url), false);
    }
    for (const url of ['https://m5.amap.com/ws/shield/scene/recommend', 'https://ai.amap.com/v2/ai_rec/home_qs',
        'https://ai.amap.com/v1/ai_rec/home_explore', 'https://m5.amap.com/v1/ai_rec/home_qs']) assert.equal(matches(url), false);
});
