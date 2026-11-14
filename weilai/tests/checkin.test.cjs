// Engine | Node.js 20+ | CommonJS
// Build: node --check weilai/tests/checkin.test.cjs
// Run: node --test weilai/tests/checkin.test.cjs
// Deps: Node.js 内置模块与 runtime-mock.cjs；旧版 48 个真实回归按 3.2 状态机语义保留。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start, KEYS, canonicalSource } = require('./runtime-mock.cjs');
const source = fs.readFileSync(process.env.NIO_SURGE_SOURCE_OVERRIDE || canonicalSource, 'utf8');
const KEY = KEYS.state;
const TOKEN = 'Bearer OFFLINE_FIXTURE_NOT_A_REAL_TOKEN';
const NEW_TOKEN = 'Bearer ANOTHER_OFFLINE_FIXTURE_TOKEN';
const GENERATION = 'offline_generation_a', NEXT = 'offline_generation_b';
const NOW = 1793699332000;
const state = (extra = {}) => ({ token: TOKEN, observedAt: NOW, invalid: false, generation: GENERATION, ...extra });
const signed = { result_code: 'success', data: { checked_in: true, stats: {
    continuous_checkin_days: 561, accumulate_days: 567
} } };
async function harness(options = {}) {
    const store = new Map(options.store || [[KEY, JSON.stringify(state())]]);
    const replies = (options.replies || []).map(reply => ({
        ...reply,
        data: reply.text === undefined ? JSON.stringify(reply.body || signed) : reply.text,
        ...(reply.before ? { before: env => reply.before(env.store) } : {})
    }));
    // 旧回归的 partial 成功现在进入一次有限复查；缺少专用复查样例时明确给 503，绝不伪造累计。
    if (replies.length) replies.push({ status: 503 });
    const run = await start({
        type: options.request ? 'http-request' : 'cron', store, clock: { now: NOW },
        request: options.request, responses: replies, allowPending: true,
        withoutClearTimeout: options.clearTimer === false,
        notificationThrows: options.notificationThrows,
        onRead() { if (options.readThrows) throw new Error('SECRET_STORAGE_READ_EXCEPTION'); },
        onWrite(value, key) {
            // 旧版写入故障案例针对凭据；新版任务锁的严格写入故障另有专用状态机回归。
            if (key !== KEY) return;
            if (options.writeThrows) throw new Error('SECRET_STORAGE_EXCEPTION');
            if (options.writeFalse) return false;
        },
        onPost() { if (options.postThrows) throw new Error('SECRET_HTTP_EXCEPTION'); }
    });
    return {
        store, posts: run.calls, logs: run.logs, reads: run.reads, writes: run.writes,
        callbacks: run.callbacks.map(callback => async (...args) => { callback(...args); await run.flush(); }),
        advance: run.advance, flush: run.flush,
        get notices() { return run.notices.map(notice => [notice.title, notice.subtitle, notice.body]); },
        get done() { return run.doneCount; }
    };
}
function request(url = 'https://gateway-front-external.nio.com/moat/10086/c/award_cn/checkin') {
    return { url, method: 'POST', headers: { AUTHORIZATION: TOKEN, 'User-Agent': 'NIOAppCN/6.10.0 offline' } };
}
function title(h) { return h.notices.at(-1)?.[1] || ''; }
function scripts(text) {
    const entries = [], lines = text.slice(text.indexOf('[Script]') + 8).split(/\r?\n/);
    for (const line of lines) {
        if (/^\[/.test(line)) break;
        const match = /^([^#=]+?)\s*=\s*(type=.*)$/.exec(line);
        if (!match) continue;
        const markers = [...match[2].matchAll(/(?:^|,)(type|pattern|requires-body|binary-body-mode|max-size|engine|timeout|script-path|script-update-interval|cronexp|wake-system)=/g)];
        const entry = { name: match[1].trim() };
        for (let i = 0; i < markers.length; i++) {
            const marker = markers[i];
            entry[marker[1]] = match[2].slice(marker.index + marker[0].length, markers[i + 1]?.index ?? match[2].length);
        }
        entries.push(entry);
    }
    return entries;
}

test('抓包成功结构：秒级时间戳、正确表单、统计及单次结束', async () => {
    const h = await harness({ replies: [{}] });
    assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
    const req = h.posts[0];
    assert.equal(new URL(req.url).searchParams.get('timestamp'), String(NOW / 1000));
    assert.equal(req.body, 'event=checkin'); assert.equal(req.timeout, 5);
    assert.equal(req['auto-redirect'], false); assert.equal(req['auto-cookie'], false);
    assert.equal(title(h), '签到成功 ✅');
    assert.match(h.notices[0][2], /561 天\n📊 累计签到：567 天/);
    assert.ok(h.logs.includes('[蔚来签到] 连续签到：561 天'));
    assert.ok(h.logs.includes('[蔚来签到] 累计签到：567 天'));
    await h.advance(30000); assert.equal(h.done, 1);
});
test('签到成功通知带表情，日志仍保留确认结果和规范统计', async () => {
    const h = await harness({ replies: [{ body: { result_code: 'success', data: {
        checked_in: true, stats: { continuous_checkin_days: 564, accumulate_days: 570 }
    } } }] });
    assert.deepEqual(h.notices, [['蔚来签到', '签到成功 ✅', '🔥 连续签到：564 天\n📊 累计签到：570 天']]);
    assert.ok(h.logs.includes('[蔚来签到] 今日签到已确认'));
    assert.ok(h.logs.includes('[蔚来签到] 连续签到：564 天'));
    assert.ok(h.logs.includes('[蔚来签到] 累计签到：570 天'));
    assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
});
test('Surge JSC 没有 clearTimeout 时也只结束一次', async () => {
    const h = await harness({ replies: [{}], clearTimer: false });
    await h.advance(30000); assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
});
test('统计缺失显示未知，仅有限复查；零值不当作缺失', async () => {
    for (const stats of [undefined, { continuous_days: 0, accumulate_days: 0 }]) {
        const h = await harness({ replies: [{ body: { result_code: 'success', data: { checked_in: true, stats } } }] });
        assert.equal(h.posts.length, stats ? 1 : 2); assert.equal(h.done, 1);
        assert.match(h.notices[0][2], stats ? /0 天/ : /未知/);
        assert.ok(h.logs.includes('[蔚来签到] 连续签到：' + (stats ? '0 天' : '未知')));
        assert.ok(h.logs.includes('[蔚来签到] 累计签到：' + (stats ? '0 天' : '未知')));
        assert.equal(h.logs.some(line => line.includes('统计字段类型：')), !stats);
    }
});
test('只含 continuous_days 的已知变体可解析', async () => {
    const h = await harness({ replies: [{ body: { result_code: 'success', data: {
        checked_in: true, stats: { continuous_days: 561, accumulate_days: 567 }
    } } }] });
    assert.match(h.notices[0][2], /561 天/);
});
test('正常 HTTP 与业务状态缺一不可', async () => {
    for (const reply of [{ status: 503 }, { body: { result_code: 'failure', data: { checked_in: true } } },
        { text: '<html>SECRET_RESPONSE</html>' }, { text: 'null' }, { body: { result_code: 'success', data: {} } },
        { body: { result_code: 'success', data: { checked_in: false } } }]) {
        const h = await harness({ replies: [reply] }); await h.advance(30000);
        assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
        assert.notEqual(title(h), '签到成功 ✅');
    }
});
test('认证失败标记当前凭据且不重试', async () => {
    for (const reply of [{ status: 401 }, { status: 403, body: { result_code: 'token_expired' } }, { body: { result_code: 'invalid_token' } }]) {
        const h = await harness({ replies: [reply] }); await h.advance(30000);
        assert.equal(JSON.parse(h.store.get(KEY)).invalid, true);
        assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
    }
});
test('旧任务认证失败不污染刚抓取的新凭据', async () => {
    const h = await harness({ replies: [{ status: 401, before: store => store.set(KEY,
        JSON.stringify(state({ token: NEW_TOKEN, generation: NEXT }))) }] });
    assert.equal(JSON.parse(h.store.get(KEY)).token, NEW_TOKEN);
    assert.equal(JSON.parse(h.store.get(KEY)).invalid, false);
});
test('失效状态无法保存时明确提示', async () => {
    const h = await harness({ replies: [{ status: 401 }], writeFalse: true });
    assert.match(h.notices[0][2], /未确认保存/); assert.equal(h.done, 1);
});
test('明确 429 按 Retry-After 重试，结束之前不调用 done', async () => {
    const h = await harness({ replies: [{ status: 429, headers: { 'Retry-After': '2' } }, {}] });
    assert.equal(h.done, 0); await h.advance(1999); assert.equal(h.posts.length, 1);
    await h.advance(1); assert.equal(h.posts.length, 2); assert.equal(h.done, 1);
});
test('429 支持 HTTP 日期，最多三次；预算不足或格式异常不重试', async () => {
    const h = await harness({ replies: [{ status: 429, headers: { 'Retry-After': new Date(NOW + 2000).toUTCString() } },
        { status: 429 }, { status: 429 }] });
    await h.advance(30000); assert.equal(h.posts.length, 3); assert.equal(h.done, 1);
    for (const value of ['120', 'NaN']) {
        const run = await harness({ replies: [{ status: 429, headers: { 'Retry-After': value } }] });
        await run.advance(30000); assert.equal(run.posts.length, 1); assert.equal(run.done, 1);
    }
});
test('慢回调受单次五秒与同一总预算约束，JSC 迟到定时器不改变结果', async () => {
    const h = await harness({ clearTimer: false });
    await h.advance(20000);
    await h.callbacks[0](null, { status: 429, headers: { 'Retry-After': '2' } }, '{}');
    assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
    await h.advance(30000); assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
});
test('网络异常和请求抛错不盲目重发、不泄露错误原文', async () => {
    for (const options of [{ replies: [{ error: 'SECRET_NETWORK_TOKEN' }] }, { postThrows: true }]) {
        const h = await harness(options); await h.advance(30000);
        assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
        assert.doesNotMatch(JSON.stringify([h.logs, h.notices]), /SECRET_/);
    }
});
test('没有回调时五秒兜底；迟到或重复回调无副作用', async () => {
    const h = await harness(); await h.advance(4999); assert.equal(h.done, 0);
    await h.advance(1); assert.equal(h.done, 1);
    await h.callbacks[0](null, { status: 200 }, JSON.stringify(signed));
    await h.callbacks[0](null, { status: 401 }, '{}');
    assert.equal(h.done, 1); assert.equal(JSON.parse(h.store.get(KEY)).invalid, false);
    assert.equal(JSON.parse(h.store.get(KEYS.journal)).confirmed, null);
});
test('重复 callback 不能重复安排限流重试', async () => {
    const h = await harness(); const cb = h.callbacks[0];
    await cb(null, { status: 429, headers: {} }, '{}'); await cb(null, { status: 429, headers: {} }, '{}');
    await h.advance(2000); assert.equal(h.posts.length, 2);
});
test('大小写不敏感抓取只写新 Key，旧键保留但不迁移', async () => {
    const store = [['weilai_auth_token', TOKEN], ['weilai_token_last_update', String(NOW - 40 * 86400000)]];
    const h = await harness({ store, request: request() });
    assert.equal(h.posts.length, 0); assert.equal(h.done, 1);
    assert.equal(JSON.parse(h.store.get(KEY)).token, TOKEN);
    assert.equal(h.store.get('weilai_auth_token'), TOKEN);
    assert.equal(h.reads.every(key => key.startsWith('ios_nio_v3_')), true);
});
test('保存超过 30 天的新 Key 仍可尝试；损坏新存储停止，旧 Key 不读取', async () => {
    const old = await harness({ store: [[KEY, JSON.stringify(state({ observedAt: NOW - 40 * 86400000 }))]], replies: [{}] });
    assert.equal(old.posts.length, 1);
    const broken = await harness({ store: [[KEY, 'not-json']] });
    assert.equal(broken.posts.length, 0); assert.match(title(broken), /损坏/);
    for (const savedTime of [String(NOW - 40 * 86400000), 'NaN']) {
        const legacy = [['weilai_auth_token', TOKEN], ['weilai_token_last_update', savedTime]];
        const h = await harness({ store: legacy });
        assert.equal(h.posts.length, 0); assert.equal(h.done, 1); assert.equal(title(h), '需要更新凭据');
        assert.deepEqual([...h.store], legacy); assert.equal(h.reads.every(key => key.startsWith('ios_nio_v3_')), true);
    }
});
test('保存失败和异常不报凭据更新成功', async () => {
    for (const options of [{ writeFalse: true }, { writeThrows: true }]) {
        const h = await harness({ ...options, store: [], request: request() });
        assert.equal(title(h), '凭据保存失败'); assert.equal(h.store.has(KEY), false);
        assert.equal(h.done, 1); assert.doesNotMatch(JSON.stringify(h.logs), /SECRET_/);
    }
});
test('同一失效 Token 不解除标记；新 Token 才恢复', async () => {
    const store = [[KEY, JSON.stringify(state({ invalid: true }))]];
    const same = await harness({ store, request: request() }); assert.equal(JSON.parse(same.store.get(KEY)).invalid, true);
    const req = request(); req.headers.AUTHORIZATION = NEW_TOKEN;
    const changed = await harness({ store, request: req }); assert.equal(JSON.parse(changed.store.get(KEY)).invalid, false);
    assert.notEqual(JSON.parse(changed.store.get(KEY)).generation, GENERATION);
});
test('凭据缺失、失效、空白和换行凭据不会发签到或保存', async () => {
    for (const store of [[], [[KEY, JSON.stringify(state({ invalid: true }))]]]) {
        const h = await harness({ store }); assert.equal(h.posts.length, 0); assert.equal(h.done, 1);
    }
    for (const token of ['', TOKEN + '\r\nX-Test: x']) {
        const req = request(); req.headers.AUTHORIZATION = token;
        const h = await harness({ request: req, store: [] }); assert.equal(h.store.size, 0); assert.equal(h.done, 1);
    }
});
test('URL 和响应内的秘密不进入日志及通知', async () => {
    const h = await harness({ request: request('https://app.nio.com/app/api/example?accessToken=SECRET_QUERY') });
    assert.doesNotMatch(JSON.stringify([h.logs, h.notices]), /SECRET_QUERY|Bearer|OFFLINE_FIXTURE/);
    const run = await harness({ replies: [{ body: { result_code: 'failure', message: 'SECRET_SERVER', data: {} } }] });
    assert.doesNotMatch(JSON.stringify([run.logs, run.notices]), /SECRET_SERVER/);
});
test('无关主机、伪造主机和已移除网页入口无网络动作', async () => {
    for (const url of ['https://weilai.checkin.local/', 'https://app.nio.com.evil.test/app/api/x',
        'https://icar.nio.com/api/vehicle', 'https://app.nio.com/unrelated']) {
        const h = await harness({ request: request(url), store: [] });
        assert.equal(h.posts.length, 0); assert.equal(h.store.size, 0); assert.equal(h.done, 1);
    }
});
test('通知 API 异常也能结束', async () => {
    const h = await harness({ replies: [{}], notificationThrows: true }); assert.equal(h.done, 1);
});
test('模块和手动配置一致，matcher 直接对应 Egern 原 YAML，无伪造入口', () => {
    const root = path.join(__dirname, '..');
    const config = fs.readFileSync(path.join(root, 'weilai-surge-config.conf'), 'utf8');
    const module = fs.readFileSync(path.join(root, 'weilai-auto-checkin.sgmodule'), 'utf8');
    const yaml = fs.readFileSync(path.join(root, 'weilai-auto-checkin.egern.yaml'), 'utf8');
    assert.equal(config.slice(config.indexOf('[Script]')), module.slice(module.indexOf('[Script]')));
    assert.doesNotMatch(config + module, /manual-checkin|token-capture\.js|美国节点|weilai\\\.checkin/);
    assert.match(config, /hostname = %APPEND%/);
    const entries = scripts(module), patterns = [...yaml.matchAll(/^\s+match:\s*'(.+)'$/gm)].map(match => match[1]);
    assert.equal(patterns.length, 2);
    assert.equal(entries.find(entry => entry.type === 'http-request').pattern, patterns[0]);
    assert.equal(entries.find(entry => entry.type === 'http-response').pattern, patterns[1]);
    assert.equal(new RegExp(patterns[0]).test(request().url), true);
    assert.equal(new RegExp(patterns[0]).test('https://app.nio.com.evil.test/app/api/x'), false);
});
test('普通 403 不会把有效凭据永久锁死，日志也显示原因', async () => {
    const h = await harness({ replies: [{ status: 403, text: 'SECRET_WAF_RESPONSE' }] });
    assert.equal(JSON.parse(h.store.get(KEY)).invalid, false);
    assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
    assert.equal(title(h), '访问被拒绝');
    assert.match(h.logs.join('\n'), /HTTP 403/);
    assert.doesNotMatch(h.logs.join('\n'), /SECRET_WAF_RESPONSE/);
    const next = await harness({ store: [...h.store], replies: [{}] });
    assert.equal(title(next), '签到成功 ✅');
});
test('临时 5xx 即使附有认证字样也不永久作废凭据', async () => {
    const h = await harness({ replies: [{ status: 503, body: { result_code: 'invalid_token' } }] });
    assert.equal(JSON.parse(h.store.get(KEY)).invalid, false);
    assert.notEqual(title(h), '签到成功 ✅');
});
test('限流等待期间 Token 更新或失效后不重发旧凭据', async () => {
    for (const current of [null, state({ token: NEW_TOKEN, generation: NEXT }), state({ invalid: true })]) {
        const h = await harness({ replies: [{ status: 429 }] });
        if (current) h.store.set(KEY, JSON.stringify(current)); else h.store.clear();
        await h.advance(30000);
        assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
        assert.equal(title(h), '凭据状态已变化');
    }
});
test('切换账号后忽略旧请求的成功或认证失败结果', async () => {
    for (const status of [200, 401]) {
        const h = await harness();
        h.store.set(KEY, JSON.stringify(state({ token: NEW_TOKEN, generation: NEXT })));
        await h.callbacks[0](null, { status }, JSON.stringify(signed));
        assert.equal(h.done, 1); assert.equal(title(h), '凭据状态已变化');
        assert.equal(JSON.parse(h.store.get(KEY)).invalid, false);
        assert.doesNotMatch(h.logs.join('\n'), /561 天|567 天/);
    }
});
test('失败原因在日志和通知同步显示，通知异常也不丢失日志', async () => {
    for (const options of [{ replies: [{ error: 'SECRET_ERR' }] },
        { replies: [{ text: 'SECRET_RESPONSE' }] }, { store: [] },
        { replies: [{}], notificationThrows: true }]) {
        const h = await harness(options);
        if (h.notices.length) for (const line of h.notices[0][2].split('\n')) {
            assert.ok(h.logs.includes('[蔚来签到] ' + line));
        }
        else assert.ok(h.logs.includes('[蔚来签到] 累计签到：567 天'));
        assert.equal(h.done, 1);
        assert.doesNotMatch(h.logs.join('\n'), /SECRET_|Bearer|OFFLINE_FIXTURE/);
    }
});
test('日志标明实际执行版本，能够核对远程缓存', async () => {
    const h = await harness({ replies: [{}] });
    const version = source.match(/\/\/ Version: ([\d.]+)/)[1];
    assert.ok(h.logs.includes('[蔚来签到] Surge 原生脚本版本 ' + version));
});
test('负数、小数或非 HTTP 日期限流值不会被宽松日期解析后立即重试', async () => {
    for (const value of ['-1', '1.5', '2026-11-04', 'Infinity', '1e9', '9999999999999999999999999']) {
        const h = await harness({ replies: [{ status: 429, headers: { 'Retry-After': value } }] });
        await h.advance(30000); assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
    }
});
test('零秒或过去的标准 HTTP 日期限流值至少等待一秒', async () => {
    for (const value of ['0', new Date(NOW - 1000).toUTCString()]) {
        const h = await harness({ replies: [{ status: 429, headers: { 'Retry-After': value } }, {}] });
        await h.advance(999); assert.equal(h.posts.length, 1);
        await h.advance(1); assert.equal(h.posts.length, 2); assert.equal(h.done, 1);
    }
});
test('存储读取异常不输出异常内容，且不会发签到', async () => {
    const h = await harness({ readThrows: true });
    assert.equal(h.posts.length, 0); assert.equal(h.done, 1);
    assert.doesNotMatch(h.logs.join('\n'), /SECRET_/);
});
test('限流后存储损坏或不可读时停止，避免误用旧快照', async () => {
    const h = await harness({ replies: [{ status: 429 }] });
    h.store.set(KEY, 'BROKEN_SECRET_VALUE'); await h.advance(30000);
    assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
    assert.equal(title(h), '凭据状态无法读取');
    assert.doesNotMatch(h.logs.join('\n'), /BROKEN_SECRET_VALUE/);
});
test('畸形或未来保存时间停止运行，不回退使用旧凭据', async () => {
    for (const value of ['null', '[]', JSON.stringify(state({ observedAt: NOW + 3600000 })),
        JSON.stringify(state({ observedAt: 'invalid' }))]) {
        const h = await harness({ store: [[KEY, value], ['weilai_auth_token', TOKEN], ['weilai_token_last_update', String(NOW)]] });
        assert.equal(h.done, 1); assert.equal(h.posts.length, 0);
        assert.equal(title(h), '凭据或任务状态损坏');
        assert.equal(h.reads.every(key => key.startsWith('ios_nio_v3_')), true);
    }
});
test('请求回调缺失 response、跳转或畸形 JSON 都不会确认签到', async () => {
    for (const reply of [{ noResponse: true }, { status: 302 }, { text: '[]' },
        { text: '"SECRET"' }, { text: '{' }, { body: { result_code: 'success', data: [] } },
        { body: { result_code: 'success', data: { checked_in: 'true' } } }]) {
        const h = await harness({ replies: [reply] }); await h.advance(30000);
        assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
        assert.notEqual(title(h), '签到成功 ✅');
    }
});
test('首抓凭据后定时运行的完整流程，两次任务互不依赖请求上下文', async () => {
    const captured = await harness({ request: request(), store: [] });
    assert.equal(title(captured), '凭据已更新'); assert.equal(captured.posts.length, 0);
    assert.deepEqual(captured.notices, [['蔚来签到', '凭据已更新', '']]);
    const cron = await harness({ store: [...captured.store], replies: [{}] });
    assert.equal(cron.posts[0].headers.authorization, TOKEN);
    assert.equal(cron.posts[0].headers['user-agent'], 'NIOAppCN/6.10.0 offline');
    assert.equal(title(cron), '签到成功 ✅');
});
test('连续观察同 Token 同 UA 静默，无变化时不重写保存时间', async () => {
    const h = await harness({ request: request(), store: [[KEY, JSON.stringify(state({
        observedAt: NOW - 1000, userAgent: 'NIOAppCN/6.10.0 offline'
    }))]] });
    assert.equal(h.notices.length, 0); assert.equal(h.posts.length, 0); assert.equal(h.done, 1);
    assert.equal(JSON.parse(h.store.get(KEY)).observedAt, NOW - 1000);
    assert.equal(h.writes.some(write => write.key === KEY), false);
});
test('恶意 User-Agent 不进入签到请求，合法 UA 在后续抓取时保留', async () => {
    const previous = state({ userAgent: 'NIOAppCN/SECRET\r\nX-Test: SECRET' });
    const h = await harness({ store: [[KEY, JSON.stringify(previous)]], replies: [{}] });
    assert.doesNotMatch(h.posts[0].headers['user-agent'], /SECRET|[\r\n]/);
    const req = request(); delete req.headers['User-Agent'];
    const kept = await harness({ request: req, store: [[KEY, JSON.stringify({ ...previous, userAgent: 'NIOAppCN/6.10.0 offline' })]] });
    assert.equal(JSON.parse(kept.store.get(KEY)).userAgent, 'NIOAppCN/6.10.0 offline');
});
test('统计只接受非负安全整数，不输出统计中的任意文本', async () => {
    for (const value of ['SECRET_STATS', '', ' ', '-1', '1.5', '1e3', 'Infinity', '9007199254740992',
        '00000000000000000', true, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, null]) {
        const h = await harness({ replies: [{ body: { result_code: 'success', data: {
            checked_in: true, stats: { continuous_checkin_days: value, accumulate_days: value }
        } } }] });
        assert.match(h.notices[0][2], /🔥 连续签到：未知\n📊 累计签到：未知/);
        assert.doesNotMatch(h.logs.join('\n'), /SECRET_STATS/);
        assert.equal(h.posts.length, 2); assert.equal(h.done, 1);
    }
});
test('统计数字字符串正常显示，零值有效且不会额外签到', async () => {
    for (const [data, consecutive, total] of [
        [{ stats: { continuous_checkin_days: '561', accumulate_days: '567' } }, 561, 567],
        [{ continuous_checkin_days: '561', accumulate_days: '567' }, 561, 567],
        [{ stats: { continuous_days: '0', accumulate_days: '0' } }, 0, 0],
        [{ stats: { continuous_checkin_days: '9007199254740991', accumulate_days: '9007199254740991' } },
            Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
    ]) {
        const h = await harness({ replies: [{ body: { result_code: 'success', data: { checked_in: true, ...data } } }] });
        assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
        assert.equal(h.notices[0][2], `🔥 连续签到：${consecutive} 天\n📊 累计签到：${total} 天`);
        assert.equal(h.logs.some(line => line.includes('统计字段类型：')), false);
    }
});
test('顶层连续签到字段 continuous_checkin_days 不丢失', async () => {
    const h = await harness({ replies: [{ body: { result_code: 'success', data: {
        checked_in: true, continuous_checkin_days: 7, accumulate_days: 11
    } } }] });
    assert.equal(h.notices[0][2], '🔥 连续签到：7 天\n📊 累计签到：11 天');
});
test('统计字段优先使用合法嵌套值，非法值回退到顶层', async () => {
    for (const [stats, consecutive, total] of [
        [{ continuous_checkin_days: '2', accumulate_days: '4' }, 2, 4],
        [{ continuous_checkin_days: -1, accumulate_days: 'SECRET_STATS' }, 8, 12],
        [{ continuous_days: 0, accumulate_days: 0 }, 0, 0]
    ]) {
        const h = await harness({ replies: [{ body: { result_code: 'success', data: {
            checked_in: true, stats, continuous_checkin_days: '8', continuous_days: 9, accumulate_days: '12'
        } } }] });
        assert.equal(h.notices[0][2], `🔥 连续签到：${consecutive} 天\n📊 累计签到：${total} 天`);
        assert.doesNotMatch(h.logs.join('\n'), /SECRET_STATS/);
    }
});
test('旧版累计字段的驼峰、total_days 与 award_info 兼容数字和数字串', async () => {
    for (const value of [570, '570', 0, '0']) {
        for (const partial of [{ stats: { accumulateDays: value } }, { accumulateDays: value },
            { stats: { total_days: value } }, { total_days: value },
            { award_info: { accumulate_days: value } }, { award_info: { total_days: value } }]) {
            const data = { checked_in: true, ...partial,
                stats: { continuous_checkin_days: 564, continuous_days: 564, ...partial.stats } };
            const h = await harness({ replies: [{ body: { result_code: 'success', data } }] });
            assert.equal(h.notices[0][2], `🔥 连续签到：564 天\n📊 累计签到：${Number(value)} 天`);
            assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
            assert.doesNotMatch(h.logs.join('\n'), /SECRET_|Bearer|OFFLINE_FIXTURE|https?:\/\//);
        }
    }
});
test('累计别名不覆盖已有合法字段，零值有效，非法主字段才能回退', async () => {
    for (const [partial, total] of [
        [{ stats: { accumulate_days: 0, accumulateDays: 888, total_days: 999 }, accumulate_days: 777 }, 0],
        [{ stats: { accumulate_days: null, accumulateDays: 999 }, accumulate_days: '0' }, 0],
        [{ stats: { accumulate_days: 'SECRET_STATS', accumulateDays: '570' }, accumulate_days: null }, 570]
    ]) {
        const data = { checked_in: true, ...partial, stats: { continuous_checkin_days: 564, ...partial.stats } };
        const h = await harness({ replies: [{ body: { result_code: 'success', data } }] });
        assert.equal(h.notices[0][2], `🔥 连续签到：564 天\n📊 累计签到：${total} 天`);
        assert.equal(h.posts.length, 1); assert.doesNotMatch(h.logs.join('\n'), /SECRET_STATS/);
    }
});
test('累计别名仍拒绝任意文本、不安全数字与无效容器，不泄露响应值', async () => {
    for (const value of [true, {}, [], null, 'SECRET_STATS', '570天', ' 570', '570 ', '5.7e2',
        -1, 570.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
        const h = await harness({ replies: [{ body: { result_code: 'success', data: {
            checked_in: true, stats: { continuous_checkin_days: 564, accumulateDays: value, total_days: value },
            accumulateDays: value, total_days: value, award_info: { accumulate_days: value, total_days: value }
        } } }] });
        assert.equal(h.notices[0][2], '🔥 连续签到：564 天\n📊 累计签到：未知');
        assert.equal(h.posts.length, 2); assert.doesNotMatch(h.logs.join('\n'), /SECRET_STATS/);
    }
    for (const award_info of [[{ total_days: 570 }], 'SECRET_STATS', null, true]) {
        const h = await harness({ replies: [{ body: { result_code: 'success', data: {
            checked_in: true, stats: { continuous_checkin_days: 564 }, award_info
        } } }] });
        assert.equal(h.notices[0][2], '🔥 连续签到：564 天\n📊 累计签到：未知');
        assert.equal(h.posts.length, 2); assert.doesNotMatch(h.logs.join('\n'), /SECRET_STATS/);
    }
});
test('截图中的连续有值累计缺失只有限复查，不编造累计数', async () => {
    const h = await harness({ replies: [{ body: { result_code: 'success', data: { checked_in: true,
        stats: { continuous_checkin_days: 564, continuous_days: 564 }
    } } }] });
    assert.equal(h.notices[0][2], '🔥 连续签到：564 天\n📊 累计签到：未知');
    assert.match(h.logs.join('\n'), /stats\.accumulate_days=missing, accumulate_days=missing/);
    assert.equal(h.posts.length, 2); assert.equal(h.done, 1);
});
test('四入口、canonical URL、缓存版本、09:00 与解密主机一致', () => {
    const module = fs.readFileSync(path.join(__dirname, '../weilai-auto-checkin.sgmodule'), 'utf8');
    const version = source.match(/\/\/ Version: ([\d.]+)/)[1];
    const entries = scripts(module), cron = entries.find(entry => entry.type === 'cron');
    assert.deepEqual(entries.map(entry => entry.type), ['http-request', 'http-response', 'cron', 'generic']);
    assert.equal(cron.cronexp, '"0 9 * * *"'); assert.equal(cron.timeout, '30');
    assert.equal(cron['wake-system'], '1'); assert.equal(cron.engine, 'webview');
    assert.equal(entries.filter(entry => entry.type === 'cron').length, 1);
    assert.equal(entries.length, 4);
    for (const entry of entries) {
        const url = new URL(entry['script-path']);
        assert.equal(url.origin, 'https://raw.githubusercontent.com');
        assert.equal(url.pathname, '/atopsecret/SurgeScripts/main/weilai/weilai-auto-checkin.js');
        assert.equal(url.searchParams.get('v'), version); assert.equal(entry['script-update-interval'], '3600');
    }
    const capture = entries[0], observe = entries[1], diagnostic = entries[3];
    assert.equal(capture['requires-body'], 'false'); assert.equal(capture.engine, 'jsc'); assert.equal(capture.timeout, '10');
    assert.equal(observe['requires-body'], 'true'); assert.equal(observe['binary-body-mode'], 'true');
    assert.equal(observe['max-size'], '262144'); assert.equal(observe.engine, 'jsc'); assert.equal(observe.timeout, '5');
    assert.equal(diagnostic.engine, 'jsc'); assert.equal(diagnostic.timeout, '10');
    assert.ok(module.includes('#!desc=' + version)); assert.ok(source.includes('version: "' + version + '"'));
    assert.match(module, /^#!name=蔚来自动签到$/m);
    assert.match(module, /hostname = %APPEND% gateway-front-external\.nio\.com, app\.nio\.com, api\.nio\.com/);
});
