// Engine | Node.js 20+ | JavaScript
// Build: 无需构建
// Run: node --test weilai/tests/checkin.test.cjs
// Deps: Node.js 内置模块；所有 HTTP 均为模拟，无真实凭据
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../weilai-auto-checkin.js'), 'utf8');
const KEY = 'weilai_auth_state_v1';
const TOKEN = 'Bearer OFFLINE_FIXTURE_NOT_A_REAL_TOKEN';
const NEW_TOKEN = 'Bearer ANOTHER_OFFLINE_FIXTURE_TOKEN';
const NOW = 1793699332000;
const signed = { result_code: 'success', data: { checked_in: true, stats: {
    continuous_checkin_days: 561, accumulate_days: 567,
} } };

function harness(options = {}) {
    let now = NOW, serial = 0;
    const state = { token: TOKEN, observedAt: NOW, invalid: false };
    const store = new Map(options.store || [[KEY, JSON.stringify(state)]]);
    const timers = new Map(), posts = [], notices = [], logs = [], callbacks = [];
    let done = 0;
    class Clock extends Date { static now() { return now; } }
    const context = {
        Date: Clock, console: { log: (...args) => logs.push(args.join(' ')) },
        setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
        $persistentStore: {
            read: key => {
                if (options.readThrows) throw new Error('SECRET_STORAGE_READ_EXCEPTION');
                return store.get(key) || null;
            },
            write: (value, key) => {
                if (options.writeThrows) throw new Error('SECRET_STORAGE_EXCEPTION');
                if (options.writeFalse) return false;
                store.set(key, value); return true;
            },
        },
        $notification: { post: (...args) => {
            if (options.notificationThrows) throw new Error('notification');
            notices.push(args);
        } },
        $done: () => { done++; },
        $httpClient: { post: (request, cb) => {
            posts.push(request); callbacks.push(cb);
            if (options.postThrows) throw new Error('SECRET_HTTP_EXCEPTION');
            const reply = (options.replies || []).shift();
            if (!reply) return;
            if (reply.before) reply.before(store);
            cb(reply.error || null, reply.noResponse ? undefined : {
                status: reply.status === undefined ? 200 : reply.status, headers: reply.headers || {},
            }, reply.text === undefined ? JSON.stringify(reply.body || signed) : reply.text);
        } },
    };
    if (options.clearTimer !== false) context.clearTimeout = id => timers.delete(id);
    if (options.request) context.$request = options.request;
    vm.runInNewContext(source, context, { timeout: 1000 });
    function advance(ms) {
        const target = now + ms;
        for (let turns = 0; turns < 100; turns++) {
            const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (!next || next[1].at > target) { now = target; return; }
            timers.delete(next[0]); now = next[1].at; next[1].fn();
        }
        throw new Error('timer loop');
    }
    return { store, posts, notices, logs, callbacks, advance, get done() { return done; } };
}
function request(url = 'https://gateway-front-external.nio.com/moat/10086/c/award_cn/checkin') {
    return { url, headers: { AUTHORIZATION: TOKEN, 'User-Agent': 'NIOAppCN/6.10.0 offline' } };
}
function title(h) { return h.notices.at(-1)?.[1] || ''; }

test('抓包成功结构：秒级时间戳、正确表单、统计及单次结束', () => {
    const h = harness({ replies: [{}] });
    assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
    const req = h.posts[0];
    assert.equal(new URL(req.url).searchParams.get('timestamp'), String(NOW / 1000));
    assert.equal(req.body, 'event=checkin'); assert.equal(req.timeout, 5);
    assert.equal(req['auto-redirect'], false); assert.equal(req['auto-cookie'], false);
    assert.equal(title(h), '今日签到已确认');
    assert.match(h.notices[0][2], /561 天\n累计签到：567 天/);
    assert.ok(h.logs.includes('[蔚来签到] 连续签到：561 天'));
    assert.ok(h.logs.includes('[蔚来签到] 累计签到：567 天'));
    h.advance(30000); assert.equal(h.done, 1);
});
test('Surge JSC 没有 clearTimeout 时也只结束一次', () => {
    const h = harness({ replies: [{}], clearTimer: false });
    h.advance(30000); assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
});
test('统计缺失显示未知，不重复 POST；零值不当作缺失', () => {
    for (const stats of [undefined, { continuous_days: 0, accumulate_days: 0 }]) {
        const h = harness({ replies: [{ body: { result_code: 'success', data: { checked_in: true, stats } } }] });
        assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
        assert.match(h.notices[0][2], stats ? /0 天/ : /未知/);
        assert.ok(h.logs.includes('[蔚来签到] 连续签到：' + (stats ? '0 天' : '未知')));
        assert.ok(h.logs.includes('[蔚来签到] 累计签到：' + (stats ? '0 天' : '未知')));
    }
});
test('只含 continuous_days 的已知变体可解析', () => {
    const h = harness({ replies: [{ body: { result_code: 'success', data: {
        checked_in: true, stats: { continuous_days: 561, accumulate_days: 567 },
    } } }] });
    assert.match(h.notices[0][2], /561 天/);
});
test('正常 HTTP 与业务状态缺一不可', () => {
    for (const reply of [{ status: 503 }, { body: { result_code: 'failure', data: { checked_in: true } } },
        { text: '<html>SECRET_RESPONSE</html>' }, { text: 'null' }, { body: { result_code: 'success', data: {} } },
        { body: { result_code: 'success', data: { checked_in: false } } }]) {
        const h = harness({ replies: [reply] }); h.advance(30000);
        assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
        assert.notEqual(title(h), '今日签到已确认');
    }
});
test('认证失败标记当前凭据且不重试', () => {
    for (const reply of [{ status: 401 }, { status: 403, body: { result_code: 'token_expired' } }, { body: { result_code: 'invalid_token' } }]) {
        const h = harness({ replies: [reply] }); h.advance(30000);
        assert.equal(JSON.parse(h.store.get(KEY)).invalid, true);
        assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
    }
});
test('旧任务认证失败不污染刚抓取的新凭据', () => {
    const h = harness({ replies: [{ status: 401, before: store => store.set(KEY,
        JSON.stringify({ token: NEW_TOKEN, observedAt: NOW, invalid: false })) }] });
    assert.equal(JSON.parse(h.store.get(KEY)).token, NEW_TOKEN);
    assert.equal(JSON.parse(h.store.get(KEY)).invalid, false);
});
test('失效状态无法保存时明确提示', () => {
    const h = harness({ replies: [{ status: 401 }], writeFalse: true });
    assert.match(h.notices[0][2], /未保存/); assert.equal(h.done, 1);
});
test('明确 429 按 Retry-After 重试，结束之前不调用 done', () => {
    const h = harness({ replies: [{ status: 429, headers: { 'Retry-After': '2' } }, {}] });
    assert.equal(h.done, 0); h.advance(1999); assert.equal(h.posts.length, 1);
    h.advance(1); assert.equal(h.posts.length, 2); assert.equal(h.done, 1);
});
test('429 支持 HTTP 日期，最多三次；预算不足或格式异常不重试', () => {
    const h = harness({ replies: [{ status: 429, headers: { 'Retry-After': new Date(NOW + 2000).toUTCString() } },
        { status: 429 }, { status: 429 }] });
    h.advance(30000); assert.equal(h.posts.length, 3); assert.equal(h.done, 1);
    for (const value of ['120', 'NaN']) {
        const run = harness({ replies: [{ status: 429, headers: { 'Retry-After': value } }] });
        run.advance(30000); assert.equal(run.posts.length, 1); assert.equal(run.done, 1);
    }
});
test('慢回调仍受同一总预算约束，JSC 迟到定时器不改变结果', () => {
    const h = harness({ clearTimer: false });
    h.advance(20000);
    h.callbacks[0](null, { status: 429, headers: { 'Retry-After': '2' } }, '{}');
    assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
    h.advance(30000); assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
});
test('网络异常和请求抛错不盲目重发、不泄露错误原文', () => {
    for (const options of [{ replies: [{ error: 'SECRET_NETWORK_TOKEN' }] }, { postThrows: true }]) {
        const h = harness(options); h.advance(30000);
        assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
        assert.doesNotMatch(JSON.stringify([h.logs, h.notices]), /SECRET_/);
    }
});
test('没有回调时总预算兜底；迟到或重复回调无副作用', () => {
    const h = harness(); h.advance(24000); assert.equal(h.done, 1);
    h.callbacks[0](null, { status: 200 }, JSON.stringify(signed));
    h.callbacks[0](null, { status: 401 }, '{}');
    assert.equal(h.done, 1); assert.equal(JSON.parse(h.store.get(KEY)).invalid, false);
});
test('重复 callback 不能重复安排限流重试', () => {
    const h = harness(); const cb = h.callbacks[0];
    cb(null, { status: 429, headers: {} }, '{}'); cb(null, { status: 429, headers: {} }, '{}');
    h.advance(2000); assert.equal(h.posts.length, 2);
});
test('大小写不敏感抓取、单键迁移，保留旧键', () => {
    const store = [['weilai_auth_token', TOKEN], ['weilai_token_last_update', String(NOW - 40 * 86400000)]];
    const h = harness({ store, request: request() });
    assert.equal(h.posts.length, 0); assert.equal(h.done, 1);
    assert.equal(JSON.parse(h.store.get(KEY)).token, TOKEN);
    assert.equal(h.store.get('weilai_auth_token'), TOKEN);
});
test('老于 30 天仍可尝试；损坏存储拒绝使用', () => {
    const old = harness({ store: [['weilai_auth_token', TOKEN], ['weilai_token_last_update', String(NOW - 40 * 86400000)]], replies: [{}] });
    assert.equal(old.posts.length, 1);
    for (const store of [[[KEY, 'not-json']], [['weilai_auth_token', TOKEN], ['weilai_token_last_update', 'NaN']]]) {
        const h = harness({ store }); assert.equal(h.posts.length, 0); assert.match(title(h), /损坏/);
    }
});
test('保存失败和异常不报凭据更新成功', () => {
    for (const options of [{ writeFalse: true }, { writeThrows: true }]) {
        const h = harness({ ...options, store: [], request: request() });
        assert.equal(title(h), '凭据保存失败'); assert.equal(h.store.has(KEY), false);
        assert.equal(h.done, 1); assert.doesNotMatch(JSON.stringify(h.logs), /SECRET_/);
    }
});
test('同一失效 Token 不解除标记；新 Token 才恢复', () => {
    const store = [[KEY, JSON.stringify({ token: TOKEN, observedAt: NOW, invalid: true })]];
    const same = harness({ store, request: request() }); assert.equal(JSON.parse(same.store.get(KEY)).invalid, true);
    const req = request(); req.headers.AUTHORIZATION = NEW_TOKEN;
    const changed = harness({ store, request: req }); assert.equal(JSON.parse(changed.store.get(KEY)).invalid, false);
});
test('凭据缺失、失效、空白和换行凭据不会发签到或保存', () => {
    for (const store of [[], [[KEY, JSON.stringify({ token: TOKEN, observedAt: NOW, invalid: true })]]]) {
        const h = harness({ store }); assert.equal(h.posts.length, 0); assert.equal(h.done, 1);
    }
    for (const token of ['', TOKEN + '\r\nX-Test: x']) {
        const req = request(); req.headers.AUTHORIZATION = token;
        const h = harness({ request: req, store: [] }); assert.equal(h.store.size, 0); assert.equal(h.done, 1);
    }
});
test('URL 和响应内的秘密不进入日志及通知', () => {
    const h = harness({ request: request('https://app.nio.com/app/api/example?accessToken=SECRET_QUERY') });
    assert.doesNotMatch(JSON.stringify([h.logs, h.notices]), /SECRET_QUERY|Bearer|OFFLINE_FIXTURE/);
    const run = harness({ replies: [{ body: { result_code: 'failure', message: 'SECRET_SERVER', data: {} } }] });
    assert.doesNotMatch(JSON.stringify([run.logs, run.notices]), /SECRET_SERVER/);
});
test('无关主机、伪造主机和已移除网页入口无网络动作', () => {
    for (const url of ['https://weilai.checkin.local/', 'https://app.nio.com.evil.test/app/api/x',
        'https://icar.nio.com/api/vehicle', 'https://app.nio.com/unrelated']) {
        const h = harness({ request: request(url), store: [] });
        assert.equal(h.posts.length, 0); assert.equal(h.store.size, 0); assert.equal(h.done, 1);
    }
});
test('通知 API 异常也能结束', () => {
    const h = harness({ replies: [{}], notificationThrows: true }); assert.equal(h.done, 1);
});
test('模块和手动配置一致且不引用缺失脚本/伪造触发域名', () => {
    const root = path.join(__dirname, '..');
    const config = fs.readFileSync(path.join(root, 'weilai-surge-config.conf'), 'utf8');
    const module = fs.readFileSync(path.join(root, 'weilai-auto-checkin.sgmodule'), 'utf8');
    assert.equal(config.slice(config.indexOf('[Script]')), module.slice(module.indexOf('[Script]')));
    assert.doesNotMatch(config + module, /manual-checkin|token-capture\.js|美国节点|weilai\\\.checkin/);
    assert.match(config, /hostname = %APPEND%/);
    const pattern = module.match(/type=http-request,pattern=(.*?),script-path=/)[1];
    assert.equal(new RegExp(pattern).test(request().url), true);
    assert.equal(new RegExp(pattern).test('https://app.nio.com.evil.test/app/api/x'), false);
});

test('普通 403 不会把有效凭据永久锁死，日志也显示拒绝原因', () => {
    const h = harness({ replies: [{ status: 403, text: 'SECRET_WAF_RESPONSE' }] });
    assert.equal(JSON.parse(h.store.get(KEY)).invalid, false);
    assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
    assert.equal(title(h), '访问被拒绝');
    assert.match(h.logs.join('\n'), /HTTP 403/);
    assert.doesNotMatch(h.logs.join('\n'), /SECRET_WAF_RESPONSE/);
    const next = harness({ store: [...h.store], replies: [{}] });
    assert.equal(title(next), '今日签到已确认');
});
test('临时 5xx 即使附有认证字样也不永久作废凭据', () => {
    const h = harness({ replies: [{ status: 503, body: { result_code: 'invalid_token' } }] });
    assert.equal(JSON.parse(h.store.get(KEY)).invalid, false);
    assert.notEqual(title(h), '今日签到已确认');
});
test('限流等待期间 Token 更新或失效后不重发旧凭据', () => {
    for (const state of [null, { token: NEW_TOKEN, observedAt: NOW, invalid: false },
        { token: TOKEN, observedAt: NOW, invalid: true }]) {
        const h = harness({ replies: [{ status: 429 }] });
        if (state) h.store.set(KEY, JSON.stringify(state)); else h.store.clear();
        h.advance(30000);
        assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
        assert.equal(title(h), '凭据状态已变化');
    }
});
test('切换账号后忽略旧请求的成功或认证失败结果', () => {
    for (const status of [200, 401]) {
        const h = harness();
        h.store.set(KEY, JSON.stringify({ token: NEW_TOKEN, observedAt: NOW, invalid: false }));
        h.callbacks[0](null, { status }, JSON.stringify(signed));
        assert.equal(h.done, 1); assert.equal(title(h), '凭据状态已变化');
        assert.equal(JSON.parse(h.store.get(KEY)).invalid, false);
        assert.doesNotMatch(h.logs.join('\n'), /561 天|567 天/);
    }
});
test('失败原因在日志和通知同步显示，通知异常也不丢失日志', () => {
    for (const options of [{ replies: [{ error: 'SECRET_ERR' }] },
        { replies: [{ text: 'SECRET_RESPONSE' }] }, { store: [] },
        { replies: [{}], notificationThrows: true }]) {
        const h = harness(options);
        if (h.notices.length) for (const line of h.notices[0][2].split('\n')) {
            assert.ok(h.logs.includes('[蔚来签到] ' + line));
        }
        else assert.ok(h.logs.includes('[蔚来签到] 累计签到：567 天'));
        assert.equal(h.done, 1);
        assert.doesNotMatch(h.logs.join('\n'), /SECRET_|Bearer|OFFLINE_FIXTURE/);
    }
});
test('日志标明实际执行版本，能够核对远程缓存', () => {
    const h = harness({ replies: [{}] });
    assert.ok(h.logs.includes('[蔚来签到] 脚本版本 2.1.2'));
});
test('负数、小数或非 HTTP 日期限流值不会被宽松日期解析后立即重试', () => {
    for (const value of ['-1', '1.5', '2026-11-04', 'Infinity', '1e9', '9999999999999999999999999']) {
        const h = harness({ replies: [{ status: 429, headers: { 'Retry-After': value } }] });
        h.advance(30000); assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
    }
});
test('零秒或过去的标准 HTTP 日期限流值至少等待一秒', () => {
    for (const value of ['0', new Date(NOW - 1000).toUTCString()]) {
        const h = harness({ replies: [{ status: 429, headers: { 'Retry-After': value } }, {}] });
        h.advance(999); assert.equal(h.posts.length, 1);
        h.advance(1); assert.equal(h.posts.length, 2); assert.equal(h.done, 1);
    }
});
test('存储读取异常不输出异常内容，且不会发签到', () => {
    const h = harness({ readThrows: true });
    assert.equal(h.posts.length, 0); assert.equal(h.done, 1);
    assert.doesNotMatch(h.logs.join('\n'), /SECRET_/);
});
test('限流后存储损坏或不可读时停止，避免误用旧快照', () => {
    const h = harness({ replies: [{ status: 429 }] });
    h.store.set(KEY, 'BROKEN_SECRET_VALUE'); h.advance(30000);
    assert.equal(h.posts.length, 1); assert.equal(h.done, 1);
    assert.equal(title(h), '凭据状态无法读取');
    assert.doesNotMatch(h.logs.join('\n'), /BROKEN_SECRET_VALUE/);
});
test('畸形或未来保存时间拒绝运行，不回退使用旧凭据', () => {
    for (const value of ['null', '[]', JSON.stringify({ token: TOKEN, observedAt: NOW + 3600000, invalid: false }),
        JSON.stringify({ token: TOKEN, observedAt: 'invalid', invalid: false })]) {
        const h = harness({ store: [[KEY, value], ['weilai_auth_token', TOKEN], ['weilai_token_last_update', String(NOW)]] });
        assert.equal(h.done, 1); assert.equal(h.posts.length, 0);
        assert.equal(title(h), '凭据状态损坏');
    }
});
test('请求回调缺失 response、跳转或畸形 JSON 都不会确认签到', () => {
    for (const reply of [{ noResponse: true }, { status: 302 }, { text: '[]' },
        { text: '"SECRET"' }, { text: '{' }, { body: { result_code: 'success', data: [] } },
        { body: { result_code: 'success', data: { checked_in: 'true' } } }]) {
        const h = harness({ replies: [reply] }); h.advance(30000);
        assert.equal(h.done, 1); assert.equal(h.posts.length, 1);
        assert.notEqual(title(h), '今日签到已确认');
    }
});
test('首抓凭据后定时运行的完整流程，两次任务互不依赖请求上下文', () => {
    const captured = harness({ request: request(), store: [] });
    assert.equal(title(captured), '凭据已更新'); assert.equal(captured.posts.length, 0);
    const cron = harness({ store: [...captured.store], replies: [{}] });
    assert.equal(cron.posts[0].headers.authorization, TOKEN);
    assert.equal(cron.posts[0].headers['user-agent'], 'NIOAppCN/6.10.0 offline');
    assert.equal(title(cron), '今日签到已确认');
});
test('连续观察同 Token 静默，且保存时间正常更新', () => {
    const h = harness({ request: request(), store: [[KEY, JSON.stringify({ token: TOKEN, observedAt: NOW - 1000, invalid: false })]] });
    assert.equal(h.notices.length, 0); assert.equal(h.posts.length, 0); assert.equal(h.done, 1);
    assert.equal(JSON.parse(h.store.get(KEY)).observedAt, NOW);
});
test('恶意 User-Agent 不进入签到请求，合法 UA 在后续抓取时保留', () => {
    const state = { token: TOKEN, observedAt: NOW, invalid: false, userAgent: 'NIOAppCN/SECRET\r\nX-Test: SECRET' };
    const h = harness({ store: [[KEY, JSON.stringify(state)]], replies: [{}] });
    assert.doesNotMatch(h.posts[0].headers['user-agent'], /SECRET|[\r\n]/);
    const previous = { ...state, userAgent: 'NIOAppCN/6.10.0 offline' };
    const req = request(); delete req.headers['User-Agent'];
    const kept = harness({ request: req, store: [[KEY, JSON.stringify(previous)]] });
    assert.equal(JSON.parse(kept.store.get(KEY)).userAgent, previous.userAgent);
});
test('统计只接受非负安全整数，不输出统计中的任意文本', () => {
    for (const value of ['SECRET_STATS', -1, 0.5, Number.MAX_SAFE_INTEGER + 1, null]) {
        const h = harness({ replies: [{ body: { result_code: 'success', data: {
            checked_in: true, stats: { continuous_checkin_days: value, accumulate_days: value },
        } } }] });
        assert.match(h.notices[0][2], /连续签到：未知\n累计签到：未知/);
        assert.doesNotMatch(h.logs.join('\n'), /SECRET_STATS/);
    }
});
test('定时、缓存版本、解密主机与模块描述一致', () => {
    const root = path.join(__dirname, '..');
    const module = fs.readFileSync(path.join(root, 'weilai-auto-checkin.sgmodule'), 'utf8');
    const version = source.match(/\/\/ Version: ([\d.]+)/)[1];
    const cron = module.split('\n').find(line => line.includes('type=cron'));
    assert.match(cron, /cronexp="0 9 \* \* \*"/);
    assert.match(cron, /timeout=30,wake-system=1/);
    assert.equal((module.match(/type=cron/g) || []).length, 1);
    const paths = [...module.matchAll(/script-path=([^,\n]+)/g)].map(m => m[1]);
    assert.equal(paths.length, 2);
    for (const value of paths) assert.equal(new URL(value).searchParams.get('v'), version);
    assert.ok(module.includes('#!desc=' + version));
    assert.ok(source.includes('version: "' + version + '"'));
    assert.match(module, /hostname = %APPEND% gateway-front-external\.nio\.com, app\.nio\.com, api\.nio\.com/);
});
