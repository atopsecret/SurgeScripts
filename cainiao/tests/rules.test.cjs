// Engine | Node.js 20+ | JavaScript
// Build: 无需构建
// Run: node --test cainiao/tests/rules.test.cjs
// Deps: Node.js 内置模块、Python 3 与 PyYAML；不联网
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readModule, rejects } = require('./rules-fixture.cjs');

const config = readModule();
const image = 'https://p3-sign.douyinpic.com/tos-cn-p-0051-ce/ok2sNqJ87HJEDO6BEAI5EftfgaHwlFEDB0oBkD~tplv-noop.image';
const cainiaoUA = 'Cainiao4iPhone/8.11.1105 (iPhone; iOS 27.2; Scale/3.00)';

test('广告 SDK 主机独立拦截：配置、竞价、素材、曝光与监测不依赖其它模块', () => {
    for (const url of [
        'https://ssp.iytcdn.com/union/sdk/config',
        'https://ssp.iytcdn.com/union/sdk/data',
        'https://ssp.iytcdn.com/union/spb',
        'https://api-access.pangolin-sdk-toutiao.com/api/ad/union/sdk/get_ads/',
        'https://api-access.pangolin-sdk-toutiao1.com/api/ad/union/sdk/stats/batch/',
        'https://api-access.pangolin-sdk-toutiao-b.com/api/ad/union/sdk/get_ads/',
        'https://log-api.pangolin-sdk-toutiao-b.com/service/2/app_log/',
        'https://sf3-fe-tos.pglstatp-toutiao.com/obj/ad-pattern/renderer/package.json',
        'https://v26-be-pack.pglstatp-toutiao.com/fixture/toutiao.mp4',
        'https://mi.gdt.qq.com/server_bidding2',
        'https://mi.gdt.qq.com/gdt_mview.fcg',
        'https://sdk.e.qq.com/activate',
        'https://ef-dongfeng.tanx.com/tanx',
        'https://df.tanx.com/spf3',
        'https://bdlog.tanx.com/imp',
        'https://ipm.atm.youku.com/ipm',
        'https://entry-su1.ubixioe.com/mob/sdk/v2/endpoint',
        'https://adx-cfg-u1.ubixioe.com/mob/sdk/v3/init',
        'http://sdk.1rtb.net/sdk/req_ad',
        'https://sdk.1rtb.net/sdk/config/v2a',
        'https://admonitor-feedback.cn-hangzhou.log.aliyuncs.com/logstores/monitor-online/shards/lb',
    ]) assert.equal(rejects(config, url), true, url);
});

test('域名边界不扩大到共享主域、相似主机或伪造后缀', () => {
    for (const host of [
        'iytcdn.com', 'cdn.iytcdn.com', 'ssp.iytcdn.com.evil.test', 'other.ssp.iytcdn.com',
        'notpangolin-sdk-toutiao.com', 'pangolin-sdk-toutiao.com.evil.test',
        'pglstatp-toutiao.com.evil.test', 'gdt.qq.com', 'qq.com', 'tanx.com',
        'youku.com', 'atm.youku.com', 'ubixioe.com', 'log.aliyuncs.com',
        'admonitor-feedback.cn-hangzhou.log.aliyuncs.com.evil.test',
    ]) assert.equal(rejects(config, 'https://' + host + '/'), false, host);
});

test('UC 共用主机仅匹配完整曝光接口，保留其它 UC 页面与相似路径', () => {
    for (const url of [
        'https://unet.ucweb.com/v3/ad/show/toutiao',
        'https://unet.ucweb.com:443/v3/ad/show/toutiao/?creativeId=fixture',
        'http://unet.ucweb.com/v3/ad/show/toutiao?campaignId=fixture',
    ]) assert.equal(rejects(config, url), true, url);
    for (const url of [
        'https://unet.ucweb.com/',
        'https://unet.ucweb.com/v3/ad/show/toutiao2',
        'https://unet.ucweb.com/v3/ad/show/toutiao/details',
        'https://unet.ucweb.com/v3/news/list',
        'https://unet.ucweb.com.evil.test/v3/ad/show/toutiao',
        'https://unet.ucweb.com@evil.test/v3/ad/show/toutiao',
        'https://www.ucweb.com/v3/ad/show/toutiao',
    ]) assert.equal(rejects(config, url), false, url);
});

test('UC 素材必须同时命中确认对象和菜鸟 UA，三个已捕获 UA 形式均覆盖', () => {
    for (const ua of [
        'TBIOS/Native com.cainiao.cnwireless 8.11.1105 iOS27.2',
        cainiaoUA,
        'Cainiao4iPhone/59673635 CFNetwork/3896.200.61 Darwin/27.2.0',
    ]) assert.equal(rejects(config, image + '?x-signature=fixture', ua), true, ua);
    for (const ua of ['', 'Mozilla/5.0', 'Douyin/fixture', 'NotCainiao4iPhone/fixture']) {
        assert.equal(rejects(config, image, ua), false, ua);
    }
    for (const url of [
        image.replace('ok2sNqJ87HJEDO6BEAI5EftfgaHwlFEDB0oBkD', 'ordinary-image'),
        image.replace('/tos-cn-p-0051-ce/', '/ordinary/'),
        image + '.other',
        image + '/details',
        image.replace('p3-sign.douyinpic.com', 'p3-sign.douyinpic.com.evil.test'),
        image.replace('p3-sign.douyinpic.com', 'other.douyinpic.com'),
    ]) assert.equal(rejects(config, url, cainiaoUA), false, url);
});

test('HTTPS URL 和 UA 条件具备精确 MITM 主机，原四类 Map Local 保留', () => {
    assert.deepEqual(new Set(config.mitm.hostnames.includes), new Set([
        'netflow-mtop.cainiao.com', 'nbcps-mtop.cainiao.com', 'cn-acs.m.cainiao.com',
        'e2e-mtop.cainiao.com', 'longquan-mtop.cainiao.com', 'unet.ucweb.com', 'p3-sign.douyinpic.com',
    ]));
    assert.equal(config.map_locals.length, 4);
    assert.ok(config.map_locals.every(row => row.status_code === 404 && row.body === ''));
    assert.ok(config.rules.every(row => row[Object.keys(row)[0]].policy === 'REJECT'));
});

test('HTTPDNS、登录、设备安全、业务日志与普通共享 CDN 请求保留', () => {
    for (const url of [
        'http://59.82.113.252/amdc/mobileDispatch',
        'http://amdc.m.taobao.com/amdc/mobileDispatch',
        'https://acs.m.taobao.com/gw/mtop.common.getTimestamp/*',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.app.mine.main/1.0/',
        'https://h5api.m.taobao.com/h5/mtop.user.getusersimple/1.0/',
        'https://ynuf.aliapp.org/service/um.json',
        'https://atoken.m.taobao.com/v2/getcvalue',
        'https://mssdk.volces.com/ri/report_otob',
        'https://tnc3-alisc1.zijieapi.com/get_domains/v4/',
        'https://mpaasapi.mpaas.cn-hangzhou.aliyuncs.com/mgw.htm',
        'https://dypnsapi.aliyuncs.com/',
        'https://cainiao-app-logs.cn-zhangjiakou.log.aliyuncs.com/servertime',
        'https://nbnetflow-reply-log.cn-wulanchabu.log.aliyuncs.com/servertime',
        'https://cn.alicdn.com/upload/gede/lt/fixture/data.json',
        'https://p3-sign.douyinpic.com/ordinary/photo.image',
    ]) assert.equal(rejects(config, url, cainiaoUA), false, url);
});
