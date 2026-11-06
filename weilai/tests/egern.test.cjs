// Engine | Node.js 20+ | JavaScript
// Build: 无需构建
// Run: node --experimental-vm-modules --test weilai/tests/egern.test.cjs
// Deps: Node.js 内置模块；Python 3 + PyYAML（只解析公开 YAML）；所有 HTTP/凭据均虚构
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
// A/B 只替换本地被测源码；不改变生产模块，也不触发网络请求。
const source = fs.readFileSync(process.env.NIO_EGERN_SOURCE_OVERRIDE || path.join(root, 'weilai-auto-checkin.egern.js'), 'utf8');
const yaml = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))',
    path.join(root, 'weilai-auto-checkin.egern.yaml')], { encoding: 'utf8', timeout: 5000 }));
const KEY = 'weilai_egern_auth_state_v1', JOURNAL = 'weilai_egern_checkin_v1', OBSERVATION = 'weilai_egern_statistics_v1';
const NOTICE = 'weilai_egern_capture_notice_v1';
const TOKEN = 'Bearer OFFLINE_FIXTURE_NOT_A_REAL_TOKEN', NEW_TOKEN = 'Bearer OTHER_OFFLINE_FIXTURE_NOT_REAL';
const GENERATION = 'offline_generation_a', NEXT = 'offline_generation_b';
const NOW = Date.parse('2026-11-05T01:00:00Z');
const SIGNED = { result_code: 'success', data: { checked_in: true, stats: { continuous_checkin_days: 2, accumulate_days: 4 } } };
const plain = value => JSON.parse(JSON.stringify(value));
// 模拟原生 JSON 编码器：对象键顺序可以改变，字符串存储仍保持原文。
const reordered = value => Array.isArray(value) ? value.map(reordered) :
    value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, reordered(value[key])])) : value;
const state = (extra = {}) => ({ token: TOKEN, observedAt: NOW, invalid: false, generation: GENERATION, userAgent: 'NIOAppCN/6.10.0 offline', ...extra });
const stateStore = (extra = {}) => new Map([[KEY, JSON.stringify(state(extra))]]);
function captureRequest(url = 'https://gateway-front-external.nio.com/moat/10086/c/award_cn/checkin', token = TOKEN, ua = 'NIOAppCN/6.10.0 offline', method = 'POST') {
    return { url, method, headers: new Headers({ AUTHORIZATION: token, 'User-Agent': ua }), text: () => { throw Error('不能读取捕获请求正文'); } };
}
class Headers {
    constructor(values = {}) { Object.assign(this, values); }
    get(name) {
        const key = Object.keys(this).find(key => key.toLowerCase() === name.toLowerCase());
        return !key ? null : Array.isArray(this[key]) ? this[key].join(', ') : this[key];
    }
}
// 观察原响应的流与定时 POST 的 text mock 分离；一次性读取必须回传精确原字节。
function observationResponse(options = {}) {
    const bytes = options.bytes === undefined ? Buffer.from(options.text === undefined ?
        JSON.stringify(options.body === undefined ? SIGNED : options.body) : options.text, 'utf8') : Buffer.from(options.bytes);
    let consumed = 0, resolveRead, rejectRead;
    return {
        status: options.status === undefined ? 200 : options.status,
        headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8', ...options.headers }),
        body: options.noBody ? null : { stream: 'offline-original-stream' },
        arrayBuffer: async () => {
            consumed++; assert.equal(consumed, 1, '观察响应流只能消费一次');
            if (options.beforeRead) options.beforeRead();
            if (options.bodyThrows) throw Error('SECRET_OBSERVATION_READ');
            if (options.defer) await new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
        text: () => { throw Error('观察流不允许改用 text 二次读取'); },
        json: () => { throw Error('观察流不允许改用 json 二次读取'); },
        finish: () => { assert.equal(typeof resolveRead, 'function'); resolveRead(); },
        fail: () => { assert.equal(typeof rejectRead, 'function'); rejectRead(Error('SECRET_OBSERVATION_READ')); },
        get consumed() { return consumed; },
        get bytes() { return bytes; },
    };
}
const FIELD_NAMES = ['stats.continuous_checkin_days', 'stats.continuous_days', 'continuous_checkin_days', 'continuous_days',
    'stats.accumulate_days', 'accumulate_days', 'stats.accumulateDays', 'accumulateDays', 'stats.total_days', 'total_days',
    'award_info.accumulate_days', 'award_info.total_days'];
const fieldTypes = (extra = {}) => ({ ...Object.fromEntries(FIELD_NAMES.map(name => [name, 'missing'])), ...extra });
const confirmation = (stats = { consecutive: 564 }, extra = {}) => ({ generation: GENERATION,
    day: '2026-11-05', confirmedAt: NOW, stats, ...extra });
function confirmedStore(stats, extra = {}, lock = null) {
    const store = stateStore(); store.set(JOURNAL, JSON.stringify({ version: 1, lock, confirmed: confirmation(stats, extra) })); return store;
}
function setObservation(store, extra = {}) {
    store.set(OBSERVATION, JSON.stringify({ version: 1, generation: GENERATION, day: '2026-11-05', observedAt: NOW,
        stats: { consecutive: 564, total: 570 }, fields: fieldTypes({ 'stats.continuous_checkin_days': 'number', 'stats.accumulate_days': 'number' }),
        ...extra }));
}
function assertOriginalBytes(h, response) {
    assert.equal(response.consumed, 1);
    assert.deepEqual(Object.keys(h.output), ['body'], '只回传正文，不覆盖原响应状态或响应头');
    assert.equal(Object.prototype.toString.call(h.output.body), '[object Uint8Array]');
    assert.deepEqual(Buffer.from(h.output.body), response.bytes);
    assert.equal(h.posts.length, 0); assert.equal(h.notices.length, 0); assertPrivate(h);
}
async function flush() { for (let i = 0; i < 50; i++) await Promise.resolve(); }
async function harness(options = {}) {
    const clock = options.clock || { now: NOW };
    const store = options.store || stateStore();
    const timers = new Map(), posts = [], notices = [], logs = [], reads = [], writes = [], pending = [], pendingBodies = [];
    const replies = options.replies ? [...options.replies] : [];
    let serial = 0, completed = false, result, taskError;
    class Clock extends Date { static now() { return clock.now; } }
    const context = vm.createContext({ Date: Clock,
        console: { log: (...args) => logs.push(args.join(' ')) },
        setTimeout: (fn, delay) => {
            if (options.timerHook) options.timerHook(store, options);
            const id = ++serial; timers.set(id, { fn, at: clock.now + delay }); return id;
        },
        ...(options.clearTimer === false ? {} : { clearTimeout: id => timers.delete(id) }),
    });
    const module = new vm.SourceTextModule(source, { context });
    await module.link(() => { throw Error('禁止加载外部运行时'); });
    await module.evaluate({ timeout: 1000 });
    function read(key) {
        reads.push(key);
        if (options.readThrows) throw Error('SECRET_STORAGE_READ');
        return store.has(key) ? store.get(key) : null;
    }
    function response(reply) {
        let consumed = 0;
        const output = { status: reply.status === undefined ? 200 : reply.status, headers: new Headers(reply.headers),
            text: async () => {
                consumed++; assert.equal(consumed, 1, '独立 HTTP 响应流只能消费一次');
                if (reply.beforeText) reply.beforeText(store, options);
                if (reply.bodyThrows) throw Error('SECRET_BODY_READ');
                if (reply.bodyHang) return new Promise(resolve => pendingBodies.push(resolve));
                return reply.text === undefined ? JSON.stringify(reply.body === undefined ? SIGNED : reply.body) : reply.text;
            },
            json: () => { throw Error('不能在 text 后二次消费 json'); },
            get consumed() { return consumed; },
        };
        return output;
    }
    const responses = [];
    function writeRaw(key, text) {
        assert.equal(typeof text, 'string');
        const copy = JSON.parse(text); writes.push([key, copy]);
        if (options.writeThrows) throw Error('SECRET_STORAGE_WRITE');
        if (options.writeHook && options.writeHook(key, copy, store) === false) return;
        if (!options.writeNoop) store.set(key, text);
        // 原生 API 返回 void。
    }
    const ctx = {
        storage: {
            get: read,
            set: writeRaw,
            getJSON: key => {
                const raw = read(key);
                if (raw === null) return null;
                const value = JSON.parse(raw);
                return options.jsonReorders ? reordered(value) : value;
            },
            setJSON: (key, value) => writeRaw(key, JSON.stringify(options.jsonReorders ? reordered(plain(value)) : plain(value))),
        },
        notify: value => { if (options.notificationThrows) throw Error('SECRET_NOTIFICATION'); notices.push(plain(value)); },
        http: { post: (url, request) => {
            posts.push({ url, ...plain(request) });
            if (options.postThrows) throw Error('SECRET_HTTP_THROW');
            const reply = replies.shift() || {};
            if (reply.before) reply.before(store, options);
            if (reply.error) return Promise.reject(Error('SECRET_NETWORK_ERROR'));
            const res = reply.noResponse ? undefined : response(reply); responses.push(res);
            if (options.hang || reply.defer) return new Promise(resolve => pending.push(value => resolve(value === undefined ? res : value)));
            return Promise.resolve(res);
        } },
    };
    function invoke(params = { cron: '0 9 * * *' }) { return module.namespace.default({ ...ctx, ...params }); }
    const params = options.request ? { request: options.request, ...(options.response ? { response: options.response } : {}) } :
        options.response ? { response: options.response } : options.generic ? {} : { cron: '0 9 * * *' };
    const promise = invoke(params);
    promise.then(value => { completed = true; result = value; }, error => { completed = true; taskError = error; });
    await flush();
    async function advance(ms) {
        await flush();
        const target = clock.now + ms;
        for (let turns = 0; turns < 200; turns++) {
            const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (!next || next[1].at > target) { clock.now = target; await flush(); return; }
            timers.delete(next[0]); clock.now = next[1].at; next[1].fn(); await flush();
        }
        throw Error('虚拟定时器异常循环');
    }
    return { store, clock, timers, posts, notices, logs, reads, writes, responses, pending, pendingBodies, promise,
        namespace: module.namespace, invoke, advance, options, get completed() { return completed; },
        get output() { return result; }, get error() { return taskError; } };
}
function subtitle(h) { return h.notices.at(-1)?.subtitle || ''; }
function journal(h) { return h.store.has(JOURNAL) ? JSON.parse(h.store.get(JOURNAL)) : null; }
function assertPrivate(h) { assert.doesNotMatch(JSON.stringify([h.logs, h.notices]), /SECRET_|Bearer|OFFLINE_FIXTURE|https?:\/\//); }

test('原生 POST 固定端点/表单/秒时间，超时毫秒，不跳转、不带 Cookie、不放宽 TLS', async () => {
    const h = await harness(); await h.promise;
    assert.equal(h.posts.length, 1); assert.equal(h.completed, true); assert.equal(h.error, undefined);
    const req = h.posts[0], url = new URL(req.url);
    assert.equal(url.origin + url.pathname, 'https://gateway-front-external.nio.com/moat/10086/c/award_cn/checkin');
    assert.equal(url.searchParams.get('app_id'), '10086'); assert.equal(url.searchParams.get('timestamp'), String(NOW / 1000));
    assert.equal(req.body, 'event=checkin'); assert.equal(req.timeout, 5000);
    assert.equal(req.redirect, 'manual'); assert.equal(req.credentials, 'omit'); assert.equal(req.insecureTls, false);
    assert.equal(subtitle(h), '签到成功 ✅'); assert.match(h.notices[0].body, /2 天\n📊 累计签到：4 天/);
    assert.equal(h.responses[0].consumed, 1); assert.equal(journal(h).lock, null); assertPrivate(h);
});
test('签到成功通知带表情，已签到提示简短，日志和去重行为保持原样', async () => {
    const h = await harness({ replies: [{ body: { result_code: 'success', data: {
        checked_in: true, stats: { continuous_checkin_days: 564, accumulate_days: 570 },
    } } }] }); await h.promise;
    const body = '🔥 连续签到：564 天\n📊 累计签到：570 天';
    assert.deepEqual(h.notices, [{ title: '蔚来签到', subtitle: '签到成功 ✅', body, sound: false }]);
    assert.deepEqual(journal(h).confirmed.stats, { consecutive: 564, total: 570 });
    assert.ok(h.logs.includes('[蔚来签到] 今日签到已确认'));
    assert.ok(h.logs.includes('[蔚来签到] 连续签到：564 天'));
    assert.ok(h.logs.includes('[蔚来签到] 累计签到：570 天'));
    const before = h.store.get(JOURNAL);
    await h.invoke();
    assert.deepEqual(h.notices.at(-1), { title: '蔚来签到', subtitle: '今日已签到 ✅', body, sound: false });
    assert.equal(h.posts.length, 1); assert.equal(h.store.get(JOURNAL), before);
    assert.doesNotMatch(h.notices.at(-1).body, /本次未发送签到请求/);
    const diagnostic = await h.invoke({});
    assert.match(diagnostic.children[0].text, /今日记录：已确认\n连续签到：564 天\n累计签到：570 天/);
    assert.equal(h.posts.length, 1); assertPrivate(h);
});
test('request 捕获仅读 Headers，不消费 body、不执行签到，存储 API 返回 void 仍有效', async () => {
    const h = await harness({ store: new Map(), request: captureRequest() }); await h.promise;
    assert.equal(h.posts.length, 0); assert.equal(subtitle(h), '凭据已更新');
    assert.deepEqual(h.notices, [{ title: '蔚来签到', subtitle: '凭据已更新', body: '', sound: false }]);
    const saved = JSON.parse(h.store.get(KEY));
    assert.equal(saved.token, TOKEN); assert.equal(saved.userAgent, 'NIOAppCN/6.10.0 offline');
    assert.match(saved.generation, /^[a-z0-9_-]+$/); assert.equal(saved.observedAt, NOW); assert.equal(saved.invalid, false);
    assert.equal(h.store.has(JOURNAL), false); assertPrivate(h);
});
test('原生 JSON 键重排不误报凭据或任务锁保存失败', async () => {
    const h = await harness({ store: new Map(), request: captureRequest(), jsonReorders: true }); await h.promise;
    assert.equal(subtitle(h), '凭据已更新'); assert.equal(h.posts.length, 0);
    assert.equal(JSON.parse(h.store.get(KEY)).token, TOKEN);
    await h.invoke();
    assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '签到成功 ✅');
    assert.equal(journal(h).confirmed.day, '2026-11-05'); assert.equal(journal(h).lock, null); assertPrivate(h);
});
test('三个精确主机与已知业务路径捕获，伪造主机/协议/无关路径不存储', async () => {
    for (const url of ['https://gateway-front-external.nio.com/moat/10086/n/c/award/x', 'https://app.nio.com/app/api/example',
        'https://api.nio.com/api/example', 'https://app.nio.com/n/c/account/user/x']) {
        const h = await harness({ store: new Map(), request: captureRequest(url) }); assert.equal(h.store.has(KEY), true); assert.equal(h.posts.length, 0);
    }
    for (const url of ['https://app.nio.com.evil.test/app/api/x', 'https://app.nio.com@evil.test/app/api/x',
        'https://icar.nio.com/api/vehicle', 'http://app.nio.com/app/api/x', 'https://app.nio.com/unrelated', 'https://weilai.checkin.local/']) {
        const h = await harness({ store: new Map(), request: captureRequest(url) }); assert.equal(h.store.size, 0); assert.equal(h.posts.length, 0);
    }
});
test('非法 Bearer 长度/空白/控制字符不保存，UA 注入不进入后续请求', async () => {
    for (const token of ['', 'Bearer short', TOKEN + '\r\nX-Test: x', TOKEN + ' extra', 'Basic ' + TOKEN]) {
        const h = await harness({ store: new Map(), request: captureRequest(undefined, token) }); assert.equal(h.store.size, 0); assert.equal(h.posts.length, 0);
    }
    const h = await harness({ store: new Map(), request: captureRequest(undefined, TOKEN, 'NIOAppCN/6.10.0\r\nSECRET_UA') });
    await h.invoke(); assert.doesNotMatch(h.posts[0].headers['user-agent'], /SECRET_UA|\r|\n/); assertPrivate(h);
});
test('同 Token 静默、保留 invalid 和 generation；新 Token 才重置标记', async () => {
    const store = stateStore({ invalid: true, observedAt: NOW - 1000 });
    const same = await harness({ store, request: captureRequest() });
    assert.equal(same.notices.length, 0); assert.equal(JSON.parse(store.get(KEY)).invalid, true);
    assert.equal(JSON.parse(store.get(KEY)).generation, GENERATION);
    const changed = await harness({ store, request: captureRequest(undefined, NEW_TOKEN) });
    assert.equal(JSON.parse(store.get(KEY)).invalid, false); assert.notEqual(JSON.parse(store.get(KEY)).generation, GENERATION);
    assert.equal(subtitle(changed), '凭据已更新');
});
test('合法 UA 可延续；同凭据只更新时间，不生成新的每日身份', async () => {
    const store = stateStore({ observedAt: NOW - 1000 });
    const h = await harness({ store, request: captureRequest(undefined, TOKEN, 'Unknown/1') });
    const saved = JSON.parse(store.get(KEY));
    assert.equal(saved.userAgent, 'NIOAppCN/6.10.0 offline'); assert.equal(saved.observedAt, NOW); assert.equal(saved.generation, GENERATION);
    assert.equal(h.notices.length, 0);
});
test('启动连发凭据在三十秒内合并提醒，仍保存最新 Token、UA 与 generation', async () => {
    const store = new Map(); let previous = null, notices = 0;
    for (const [offset, token, expectedNotice] of [
        [0, TOKEN, 1], [1, TOKEN, 0], [100, NEW_TOKEN, 0],
        [1000, TOKEN, 0], [29999, NEW_TOKEN, 0], [30000, TOKEN, 1],
    ]) {
        const ua = 'NIOAppCN/6.10.0 offline-' + offset;
        const h = await harness({ store, clock: { now: NOW + offset }, request: captureRequest(undefined, token, ua) }); await h.promise;
        assert.equal(h.notices.length, expectedNotice); notices += h.notices.length;
        if (expectedNotice) assert.deepEqual(h.notices[0], { title: '蔚来签到', subtitle: '凭据已更新', body: '', sound: false });
        const saved = JSON.parse(store.get(KEY));
        assert.equal(saved.token, token); assert.equal(saved.userAgent, ua); assert.equal(saved.observedAt, NOW + offset);
        assert.equal(saved.invalid, false);
        if (previous) token === previous.token ? assert.equal(saved.generation, previous.generation) : assert.notEqual(saved.generation, previous.generation);
        assert.equal(store.get(NOTICE), String(offset < 30000 ? NOW : NOW + 30000));
        assert.deepEqual([...store.keys()].sort(), [KEY, NOTICE].sort());
        assert.equal(h.posts.length, 0); assertPrivate(h); previous = saved;
    }
    assert.equal(notices, 2);
});
test('提醒时间损坏或读写失败不误报凭据保存失败，不阻止后续签到', async () => {
    for (const raw of ['SECRET_NOTICE', '{}', '[]', 'null', 'true', '-1', '1.5', String(NOW + 1000), String(NOW - 30000)]) {
        const store = new Map([[NOTICE, raw]]), h = await harness({ store, request: captureRequest() }); await h.promise;
        assert.equal(JSON.parse(store.get(KEY)).token, TOKEN); assert.equal(store.get(NOTICE), String(NOW));
        assert.deepEqual(h.notices, [{ title: '蔚来签到', subtitle: '凭据已更新', body: '', sound: false }]);
        assert.equal(h.posts.length, 0); assertPrivate(h);
    }
    for (const failure of ['read', 'throw', 'noop', 'replace']) {
        const store = new Map([[NOTICE, String(NOW - 60000)]]);
        if (failure === 'read') {
            const get = store.get.bind(store);
            store.get = key => { if (key === NOTICE) throw Error('SECRET_NOTICE_READ'); return get(key); };
        }
        const h = await harness({ store, request: captureRequest(), writeHook: (key, value, target) => {
            if (key !== NOTICE) return;
            if (failure === 'throw') throw Error('SECRET_NOTICE_WRITE');
            if (failure === 'noop') return false;
            if (failure === 'replace') { target.set(key, String(NOW - 1)); return false; }
        } }); await h.promise;
        assert.equal(JSON.parse(store.get(KEY)).token, TOKEN); assert.equal(h.notices.length, 0); assert.equal(h.posts.length, 0);
        assert.equal(store.has(JOURNAL), false); assert.match(h.logs.join('\n'), /凭据已更新/);
        assert.doesNotMatch(h.logs.join('\n'), /凭据保存失败/); assertPrivate(h);
        await h.invoke(); assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '签到成功 ✅'); assertPrivate(h);
    }
});
test('提醒 API 异常不回滚凭据，也不让启动后的下一次凭据变化重复提醒', async () => {
    const store = new Map(), first = await harness({ store, request: captureRequest(), notificationThrows: true }); await first.promise;
    assert.equal(first.notices.length, 0); assert.equal(JSON.parse(store.get(KEY)).token, TOKEN);
    assert.equal(store.get(NOTICE), String(NOW)); assert.match(first.logs.join('\n'), /凭据已更新/); assertPrivate(first);
    const next = await harness({ store, clock: { now: NOW + 1000 }, request: captureRequest(undefined, NEW_TOKEN) }); await next.promise;
    assert.equal(next.notices.length, 0); assert.equal(JSON.parse(store.get(KEY)).token, NEW_TOKEN); assertPrivate(next);
    const later = await harness({ store, clock: { now: NOW + 30000 }, request: captureRequest() }); await later.promise;
    assert.deepEqual(later.notices, [{ title: '蔚来签到', subtitle: '凭据已更新', body: '', sound: false }]);
    assert.equal(JSON.parse(store.get(KEY)).token, TOKEN); assert.equal(later.posts.length, 0); assertPrivate(later);
});
test('捕获写入失败或静默未写入，不报告更新成功；读取不可用不覆盖状态', async () => {
    for (const options of [{ writeThrows: true }, { writeNoop: true }]) {
        const h = await harness({ ...options, store: new Map(), request: captureRequest() });
        assert.equal(subtitle(h), '凭据保存失败'); assert.equal(h.store.size, 0);
        assert.equal(h.reads.includes(NOTICE), false); assert.equal(h.writes.some(([key]) => key === NOTICE), false); assertPrivate(h);
    }
    const h = await harness({ readThrows: true, request: captureRequest(undefined, NEW_TOKEN) });
    assert.equal(subtitle(h), '凭据状态无法读取'); assert.equal(JSON.parse(h.store.get(KEY)).token, TOKEN);
    assert.equal(h.writes.length, 0);
});
test('原始字符串回读被替换时仍拒绝凭据保存成功', async () => {
    const h = await harness({ store: new Map(), request: captureRequest(), writeHook: (key, value, store) => {
        store.set(key, JSON.stringify({ ...value, observedAt: NOW - 1 })); return false;
    } });
    assert.equal(subtitle(h), '凭据保存失败'); assert.equal(h.posts.length, 0);
    assert.equal(JSON.parse(h.store.get(KEY)).observedAt, NOW - 1); assertPrivate(h);
});
test('真实目标请求可修复损坏状态，但不会读取旧 Surge 凭据键', async () => {
    const store = new Map([[KEY, 'BROKEN_SECRET'], ['weilai_auth_state_v1', JSON.stringify(state())], ['weilai_auth_token', TOKEN]]);
    const h = await harness({ store, request: captureRequest(undefined, NEW_TOKEN) });
    assert.equal(JSON.parse(store.get(KEY)).token, NEW_TOKEN);
    assert.equal(h.reads.includes('weilai_auth_state_v1'), false); assert.equal(h.reads.includes('weilai_auth_token'), false); assertPrivate(h);
});
test('只有旧 Surge 键没有 Egern 状态，不签到、不搬运凭据', async () => {
    const store = new Map([['weilai_auth_state_v1', JSON.stringify(state())], ['weilai_auth_token', TOKEN], ['weilai_token_last_update', String(NOW)]]);
    const h = await harness({ store });
    assert.equal(h.posts.length, 0); assert.equal(subtitle(h), '需要更新凭据'); assert.equal(store.has(KEY), false);
});
test('generic 诊断是合法 widget，只读且静默，不是手动签到入口', async () => {
    const h = await harness({ generic: true }); await h.promise;
    assert.equal(h.output.type, 'widget'); assert.ok(JSON.stringify(h.output).includes(h.namespace.CONFIG.version));
    assert.equal(h.posts.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.notices.length, 0); assertPrivate(h);
    for (const params of [{}, { cron: '' }, { response: { status: 200 } }, { request: captureRequest(), response: { status: 200 } }]) {
        await h.invoke(params); assert.equal(h.posts.length, 0); assert.equal(h.writes.length, 0);
    }
});
test('generic 存储损坏/不可读不发真实请求、不输出异常', async () => {
    for (const options of [{ readThrows: true }, { store: new Map([[KEY, 'SECRET_BROKEN']]) }]) {
        const h = await harness({ ...options, generic: true });
        assert.equal(h.output.type, 'widget'); assert.match(JSON.stringify(h.output), /无法读取/); assertPrivate(h);
        assert.equal(h.posts.length, 0); assert.equal(h.notices.length, 0);
    }
});
test('缺失/失效/损坏/未来时间状态不执行；保存超过 30 天不自动推断失效', async () => {
    for (const store of [new Map(), stateStore({ invalid: true }), stateStore({ observedAt: NOW + 3600000 }),
        stateStore({ observedAt: 'x' }), stateStore({ generation: 'bad generation' }), new Map([[KEY, 'null']]), new Map([[KEY, '[]']]), new Map([[KEY, '{}']])]) {
        const h = await harness({ store }); assert.equal(h.posts.length, 0); assert.notEqual(subtitle(h), '签到成功 ✅'); assertPrivate(h);
    }
    const h = await harness({ store: stateStore({ observedAt: NOW - 40 * 86400000 }) }); assert.equal(h.posts.length, 1);
});
test('任务元数据/锁损坏或无法读取、加锁未确认时拒绝 POST', async () => {
    for (const value of ['null', '{}', '[]', '{', JSON.stringify({ version: 1, lock: {}, confirmed: null }),
        JSON.stringify({ version: 1, lock: null, confirmed: { generation: GENERATION, day: '2099-01-01', confirmedAt: NOW, stats: {} } })]) {
        const store = stateStore(); store.set(JOURNAL, value);
        const h = await harness({ store }); assert.equal(h.posts.length, 0);
    }
    for (const options of [{ readThrows: true }, { writeThrows: true }, { writeNoop: true }]) {
        const h = await harness(options); assert.equal(h.posts.length, 0); assertPrivate(h);
    }
});
test('未到期锁阻止重入，过期锁可回收；确认写入的是自己的锁才执行', async () => {
    const make = offset => {
        const store = stateStore(); store.set(JOURNAL, JSON.stringify({ version: 1,
            lock: { id: 'offline_other_run', generation: GENERATION, acquiredAt: NOW + offset, expiresAt: NOW + offset + 30000 }, confirmed: null })); return store;
    };
    const active = await harness({ store: make(-1000) }); assert.equal(active.posts.length, 0); assert.equal(subtitle(active), '已有签到任务');
    const expired = await harness({ store: make(-31000) }); assert.equal(expired.posts.length, 1); assert.equal(journal(expired).lock, null);
    const stolen = await harness({ writeHook: (key, value, store) => {
        if (key === JOURNAL && value.lock) { store.set(key, JSON.stringify({ ...value, lock: { ...value.lock, id: 'offline_other_run' } })); return false; }
    } });
    assert.equal(stolen.posts.length, 0); assert.equal(journal(stolen).lock.id, 'offline_other_run');
});
test('已确认成功按 UTC+8 日界和同凭据 generation 去重，不为统计再 POST', async () => {
    const h = await harness(); await h.promise; await h.invoke();
    assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '今日已签到 ✅');
    assert.equal(journal(h).confirmed.generation, GENERATION); assert.equal(journal(h).confirmed.day, '2026-11-05');
    assert.doesNotMatch(JSON.stringify(journal(h)), /Bearer|OFFLINE_FIXTURE/);
    await h.advance(86400000); await h.invoke(); assert.equal(h.posts.length, 2); assert.equal(journal(h).confirmed.day, '2026-11-06');
});
test('新捕获 generation 不沿用其他账号的今日标记，Token A→B→A 可被识别', async () => {
    const h = await harness(); await h.promise;
    await h.invoke({ request: captureRequest(undefined, NEW_TOKEN) });
    const newGeneration = JSON.parse(h.store.get(KEY)).generation;
    assert.notEqual(newGeneration, GENERATION); await h.invoke(); assert.equal(h.posts.length, 2);
    assert.equal(journal(h).confirmed.generation, newGeneration);
    await h.invoke({ request: captureRequest() }); assert.notEqual(JSON.parse(h.store.get(KEY)).generation, GENERATION);
});
test('未知结果不写每日成功，保留租约防立即重发；到期后才允许新的人工任务', async () => {
    const h = await harness({ replies: [{ text: '{' }] }); await h.promise;
    assert.equal(journal(h).confirmed, null); assert.ok(journal(h).lock); await h.invoke(); assert.equal(h.posts.length, 1);
    await h.advance(30000); await h.invoke(); assert.equal(h.posts.length, 2); assert.equal(journal(h).confirmed.day, '2026-11-05');
});
test('401 或明确 200/403 认证码作废当前凭据，普通 403/5xx 不误作废', async () => {
    for (const reply of [{ status: 401, bodyHang: true }, { status: 200, body: { result_code: 'invalid_token' } },
        { status: 403, body: { result_code: 'token_expired' } }, { status: 403, body: { result_code: 'unauthorized' } }]) {
        const h = await harness({ replies: [reply] }); await h.promise;
        assert.equal(JSON.parse(h.store.get(KEY)).invalid, true); assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '授权失败');
        if (reply.status === 401) assert.equal(h.responses[0].consumed, 0);
    }
    for (const reply of [{ status: 403, text: 'SECRET_WAF' }, { status: 503, body: { result_code: 'invalid_token' } }]) {
        const h = await harness({ replies: [reply] }); assert.equal(JSON.parse(h.store.get(KEY)).invalid, false); assert.equal(h.posts.length, 1); assertPrivate(h);
    }
});
test('普通 403 释放本次锁，下次任务仍可成功，不永久锁死凭据', async () => {
    const h = await harness({ replies: [{ status: 403, text: 'SECRET_WAF' }] });
    assert.equal(subtitle(h), '访问被拒绝'); assert.equal(journal(h).lock, null); await h.invoke();
    assert.equal(h.posts.length, 2); assert.equal(subtitle(h), '签到成功 ✅');
});
test('认证失效标记无法保存时明确说明，不偷偷重试 POST', async () => {
    const h = await harness({ replies: [{ status: 401 }], writeHook: (key, value) => key === KEY && value.invalid ? false : undefined });
    assert.equal(JSON.parse(h.store.get(KEY)).invalid, false); assert.match(h.notices[0].body, /未确认保存/); assert.equal(h.posts.length, 1); assertPrivate(h);
});
test('网络异常、缺失响应、跳转、5xx 不重发、不记录成功、不泄露错误原文', async () => {
    for (const options of [{ postThrows: true }, { replies: [{ error: true }] }, { replies: [{ noResponse: true }] },
        { replies: [{ status: 302 }] }, { replies: [{ status: 503, text: 'SECRET_SERVER' }] }]) {
        const h = await harness(options); await h.advance(30000);
        assert.equal(h.posts.length, 1); assert.equal(journal(h).confirmed, null); assertPrivate(h);
    }
});
test('请求 Promise 挂起五秒兜底，迟到成功/401 不写标记或作废凭据', async () => {
    for (const status of [200, 401]) {
        const h = await harness({ hang: true }); assert.equal(h.completed, false); await h.advance(5000);
        assert.equal(h.completed, true); assert.equal(h.posts.length, 1); assert.equal(journal(h).confirmed, null);
        h.pending[0]({ status, headers: new Headers(), text: async () => JSON.stringify(SIGNED) }); await flush();
        assert.equal(JSON.parse(h.store.get(KEY)).invalid, false); assert.equal(journal(h).confirmed, null);
    }
});
test('没有 clearTimeout 也只处理一次，迟到计时器不改变确认结果', async () => {
    const h = await harness({ clearTimer: false }); await h.promise; await h.advance(30000);
    assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '签到成功 ✅'); assert.equal(h.notices.length, 1);
});
test('响应正文挂起或拒绝不重试，正文和请求共用每次五秒预算', async () => {
    for (const reply of [{ bodyHang: true }, { bodyThrows: true }]) {
        const h = await harness({ replies: [reply] }); await h.advance(5000);
        assert.equal(h.completed, true); assert.equal(h.posts.length, 1); assert.equal(journal(h).confirmed, null);
    }
    const h = await harness({ replies: [{ defer: true, bodyHang: true }] }); await h.advance(4000); h.pending[0](); await flush();
    assert.equal(h.completed, false); await h.advance(1000); assert.equal(h.completed, true); assert.equal(h.posts.length, 1);
});
test('429 是唯一自动重试；尊重整数/HTTP 日期、至少等一秒、最多三次', async () => {
    for (const value of ['0', '2', new Date(NOW + 2000).toUTCString(), new Date(NOW - 1000).toUTCString()]) {
        const h = await harness({ replies: [{ status: 429, headers: { 'Retry-After': value } }, {}] });
        const delay = value === '0' || value === new Date(NOW - 1000).toUTCString() ? 1000 : 2000;
        await h.advance(delay - 1); assert.equal(h.posts.length, 1); await h.advance(1); assert.equal(h.posts.length, 2); assert.equal(h.completed, true);
    }
    const h = await harness({ replies: [{ status: 429 }, { status: 429 }, { status: 429 }] }); await h.advance(24000);
    assert.equal(h.posts.length, 3); assert.equal(subtitle(h), '请求被限流'); assert.equal(journal(h).confirmed, null);
});
test('非严格 Retry-After、重复值或预算不足，不安排自动重试', async () => {
    for (const value of ['-1', '1.5', '2026-11-05', 'Infinity', '1e9', '120', 'NaN', '1, 2',
        'Fri, 31 Feb 2026 00:00:00 GMT', '999999999999999999999999999999999']) {
        const h = await harness({ replies: [{ status: 429, headers: { 'Retry-After': value } }] }); await h.advance(30000);
        assert.equal(h.posts.length, 1); assert.equal(h.completed, true); assert.equal(h.responses[0].consumed, 0);
    }
});
test('统一 24 秒预算不会被 429 等待或每次超时重置', async () => {
    const h = await harness({ replies: [{ status: 429, headers: { 'Retry-After': '10' } }, { status: 429, headers: { 'Retry-After': '10' } }, {}] });
    await h.advance(24000); assert.equal(h.posts.length, 2); assert.equal(h.completed, true); assert.equal(subtitle(h), '请求被限流');
});
test('等待 429 期间新 Token、invalid、缺失/损坏状态都会终止旧任务', async () => {
    for (const raw of [JSON.stringify(state({ token: NEW_TOKEN, generation: NEXT })), JSON.stringify(state({ invalid: true })), null, 'SECRET_BROKEN']) {
        const h = await harness({ replies: [{ status: 429 }, {}] });
        if (raw === null) h.store.delete(KEY); else h.store.set(KEY, raw);
        await h.advance(30000); assert.equal(h.posts.length, 1); assert.equal(journal(h).confirmed, null); assertPrivate(h);
    }
});
test('在途成功/认证失败遇到 Token 或 generation 变化，不污染当前凭据/今日记录', async () => {
    for (const status of [200, 401]) for (const token of [TOKEN, NEW_TOKEN]) {
        const h = await harness({ replies: [{ defer: true, status }] });
        h.store.set(KEY, JSON.stringify(state({ token, generation: NEXT }))); h.pending[0](); await flush();
        assert.equal(h.completed, true); assert.equal(subtitle(h), '凭据状态已变化');
        assert.equal(JSON.parse(h.store.get(KEY)).invalid, false); assert.equal(journal(h).confirmed, null);
        assert.doesNotMatch(h.logs.join('\n'), /累计签到：4 天/);
    }
});
test('读取响应 body 期间凭据轮换或存储不可用，再次校验并停止旧结果', async () => {
    for (const change of [(store) => store.set(KEY, JSON.stringify(state({ token: NEW_TOKEN, generation: NEXT }))),
        (_store, options) => { options.readThrows = true; }]) {
        const h = await harness({ replies: [{ beforeText: change }] });
        assert.equal(h.posts.length, 1); assert.equal(h.completed, true); assert.notEqual(subtitle(h), '签到成功 ✅');
        assert.equal(journal(h).confirmed, null); assertPrivate(h);
    }
});
test('在途响应遇到另一个任务锁，不覆盖或释放他人的锁', async () => {
    const h = await harness({ replies: [{ defer: true }] });
    const saved = journal(h); saved.lock.id = 'offline_other_run'; h.store.set(JOURNAL, JSON.stringify(saved));
    h.pending[0](); await flush(); assert.equal(subtitle(h), '任务锁已变化');
    assert.equal(journal(h).lock.id, 'offline_other_run'); assert.equal(journal(h).confirmed, null);
});
test('并发调用同一原生上下文只允许持锁任务发送 POST', async () => {
    const h = await harness({ replies: [{ defer: true }] }); await h.invoke();
    assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '已有签到任务'); h.pending[0](); await flush();
    assert.equal(h.posts.length, 1); assert.equal(journal(h).confirmed.day, '2026-11-05');
});
test('创建超时兜底期间凭据已改变，真正调用 ctx.http.post 前校验并停止', async () => {
    const h = await harness({ timerHook: (store, options) => {
        store.set(KEY, JSON.stringify(state({ token: NEW_TOKEN, generation: NEXT }))); options.timerHook = null;
    } });
    assert.equal(h.posts.length, 0); assert.equal(subtitle(h), '凭据状态已变化');
    assert.equal(JSON.parse(h.store.get(KEY)).token, NEW_TOKEN); assert.equal(journal(h).confirmed, null);
    assert.equal(journal(h).lock, null);
});
test('解析/业务状态错误、checked_in 不为 true 均不标记成功或补 POST', async () => {
    for (const reply of [{ text: '<html>SECRET_BODY</html>' }, { text: 'null' }, { text: '[]' }, { text: '{' },
        { body: { result_code: 'failure', data: { checked_in: true } } }, { body: { result_code: 'success', data: [] } },
        { body: { result_code: 'success', data: { checked_in: 'true' } } }, { body: { result_code: 'success', data: { checked_in: false } } }]) {
        const h = await harness({ replies: [reply] }); assert.equal(h.posts.length, 1); assert.equal(journal(h).confirmed, null); assertPrivate(h);
    }
});
test('统计只收非负安全整数，缺失显示未知；不为补统计再请求', async () => {
    for (const stats of [{}, { continuous_days: 0, accumulate_days: 0 }, { continuous_checkin_days: -1, accumulate_days: 'SECRET_STATS' },
        { continuous_checkin_days: 1.5, accumulate_days: Number.MAX_SAFE_INTEGER + 1 },
        ...['', ' ', '-1', '1.5', '1e3', 'Infinity', '9007199254740992', '00000000000000000', true, null]
            .map(value => ({ continuous_checkin_days: value, accumulate_days: value }))]) {
        const h = await harness({ replies: [{ body: { result_code: 'success', data: { checked_in: true, stats } } }] });
        assert.equal(h.posts.length, 1); assert.match(h.notices[0].body, stats.continuous_days === 0 ? /0 天/ : /未知/); assertPrivate(h);
        assert.equal(h.logs.some(line => line.includes('统计字段类型：')), stats.continuous_days !== 0);
    }
});
test('统计数字字符串正常显示，缓存保存数字且当日不额外签到', async () => {
    for (const [data, consecutive, total] of [
        [{ stats: { continuous_checkin_days: '561', accumulate_days: '567' } }, 561, 567],
        [{ continuous_checkin_days: '561', accumulate_days: '567' }, 561, 567],
        [{ stats: { continuous_days: '0', accumulate_days: '0' } }, 0, 0],
        [{ stats: { continuous_checkin_days: '9007199254740991', accumulate_days: '9007199254740991' } },
            Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ]) {
        const h = await harness({ replies: [{ body: { result_code: 'success', data: { checked_in: true, ...data } } }] });
        assert.equal(h.posts.length, 1); assert.equal(h.notices[0].body, `🔥 连续签到：${consecutive} 天\n📊 累计签到：${total} 天`);
        assert.deepEqual(journal(h).confirmed.stats, { consecutive, total });
        assert.equal(h.logs.some(line => line.includes('统计字段类型：')), false);
        await h.invoke(); assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '今日已签到 ✅');
        assert.match(h.notices.at(-1).body, new RegExp(`连续签到：${consecutive} 天`)); assertPrivate(h);
    }
});
test('顶层连续签到字段 continuous_checkin_days 不丢失', async () => {
    const h = await harness({ replies: [{ body: { result_code: 'success', data: {
        checked_in: true, continuous_checkin_days: 7, accumulate_days: 11,
    } } }] });
    assert.equal(h.notices[0].body, '🔥 连续签到：7 天\n📊 累计签到：11 天');
    assert.deepEqual(journal(h).confirmed.stats, { consecutive: 7, total: 11 });
});
test('统计字段优先使用合法嵌套值，非法值回退到顶层', async () => {
    for (const [stats, consecutive, total] of [
        [{ continuous_checkin_days: '2', accumulate_days: '4' }, 2, 4],
        [{ continuous_checkin_days: -1, accumulate_days: 'SECRET_STATS' }, 8, 12],
        [{ continuous_days: 0, accumulate_days: 0 }, 0, 0],
    ]) {
        const h = await harness({ replies: [{ body: { result_code: 'success', data: {
            checked_in: true, stats, continuous_checkin_days: '8', continuous_days: 9, accumulate_days: '12',
        } } }] });
        assert.equal(h.notices[0].body, `🔥 连续签到：${consecutive} 天\n📊 累计签到：${total} 天`); assertPrivate(h);
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
            assert.equal(h.notices[0].body, `🔥 连续签到：564 天\n📊 累计签到：${Number(value)} 天`);
            assert.deepEqual(journal(h).confirmed.stats, { consecutive: 564, total: Number(value) });
            await h.invoke(); assert.equal(h.posts.length, 1); assertPrivate(h);
        }
    }
});
test('累计别名不覆盖已有合法字段，零值有效，非法主字段才能回退', async () => {
    for (const [partial, total] of [
        [{ stats: { accumulate_days: 0, accumulateDays: 888, total_days: 999 }, accumulate_days: 777 }, 0],
        [{ stats: { accumulate_days: null, accumulateDays: 999 }, accumulate_days: '0' }, 0],
        [{ stats: { accumulate_days: 'SECRET_STATS', accumulateDays: '570' }, accumulate_days: null }, 570],
    ]) {
        const data = { checked_in: true, ...partial, stats: { continuous_checkin_days: 564, ...partial.stats } };
        const h = await harness({ replies: [{ body: { result_code: 'success', data } }] });
        assert.equal(h.notices[0].body, `🔥 连续签到：564 天\n📊 累计签到：${total} 天`);
        assert.deepEqual(journal(h).confirmed.stats, { consecutive: 564, total });
        assert.equal(h.posts.length, 1); assertPrivate(h);
    }
});
test('累计别名仍拒绝任意文本、不安全数字与无效容器，不泄露响应值', async () => {
    for (const value of [true, {}, [], null, 'SECRET_STATS', '570天', ' 570', '570 ', '5.7e2',
        -1, 570.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
        const h = await harness({ replies: [{ body: { result_code: 'success', data: {
            checked_in: true, stats: { continuous_checkin_days: 564, accumulateDays: value, total_days: value },
            accumulateDays: value, total_days: value, award_info: { accumulate_days: value, total_days: value },
        } } }] });
        assert.equal(h.notices[0].body, '🔥 连续签到：564 天\n📊 累计签到：未知');
        assert.deepEqual(journal(h).confirmed.stats, { consecutive: 564 });
        assert.equal(h.posts.length, 1); assertPrivate(h);
    }
    for (const award_info of [[{ total_days: 570 }], 'SECRET_STATS', null, true]) {
        const h = await harness({ replies: [{ body: { result_code: 'success', data: {
            checked_in: true, stats: { continuous_checkin_days: 564 }, award_info,
        } } }] });
        assert.equal(h.notices[0].body, '🔥 连续签到：564 天\n📊 累计签到：未知'); assertPrivate(h);
    }
});
test('截图中的连续有值累计缺失不补签到、不把昨天累计加一', async () => {
    const store = stateStore();
    store.set(JOURNAL, JSON.stringify({ version: 1, lock: null, confirmed: {
        generation: GENERATION, day: '2026-11-05', confirmedAt: NOW,
        stats: { consecutive: 563, total: 569 },
    } }));
    const h = await harness({ store, clock: { now: NOW + 86400000 }, replies: [{ body: {
        result_code: 'success', data: { checked_in: true,
            stats: { continuous_checkin_days: 564, continuous_days: 564 } },
    } }] });
    assert.equal(h.notices[0].body, '🔥 连续签到：564 天\n📊 累计签到：未知');
    assert.equal(journal(h).confirmed.day, '2026-11-06');
    assert.deepEqual(journal(h).confirmed.stats, { consecutive: 564 });
    assert.match(h.logs.join('\n'), /stats\.accumulate_days=missing, accumulate_days=missing/);
    await h.invoke(); assert.equal(h.posts.length, 1); assertPrivate(h);
});
test('确认记录保存失败不伪报防重成功，保留租约并明确说明', async () => {
    const h = await harness({ writeHook: (key, value) => key === JOURNAL && value.confirmed ? false : undefined });
    assert.equal(subtitle(h), '签到成功 ✅'); assert.match(h.notices[0].body, /防重复记录未确认保存/);
    assert.equal(journal(h).confirmed, null); assert.ok(journal(h).lock); await h.invoke(); assert.equal(h.posts.length, 1);
});
test('通知异常不丢日志/成功记录；释放锁失败只留固定说明和到期边界', async () => {
    const notify = await harness({ notificationThrows: true }); assert.equal(notify.notices.length, 0);
    assert.equal(journal(notify).confirmed.day, '2026-11-05'); assert.match(notify.logs.join('\n'), /累计签到：4 天/); assertPrivate(notify);
    const release = await harness({ writeHook: (key, value) => { if (key === JOURNAL && value.confirmed && !value.lock) throw Error('SECRET_RELEASE'); } });
    assert.ok(journal(release).lock); assert.match(release.logs.join('\n'), /未确认释放/); assertPrivate(release);
    await release.invoke(); assert.equal(release.posts.length, 1);
});
test('捕获查询/HTTP 错误/服务端文本/存储异常均不进入日志通知', async () => {
    const h = await harness({ store: new Map(), request: captureRequest('https://app.nio.com/app/api/x?token=SECRET_QUERY') }); assertPrivate(h);
    const run = await harness({ replies: [{ body: { result_code: 'failure', message: 'SECRET_SERVER', data: {} } }] }); assertPrivate(run);
});
test('被动观察原样回传中文/BOM 字节、状态和响应头，不抓凭据或改动签到记录与现有锁', async () => {
    const lock = { id: 'offline_existing_lock', generation: GENERATION, acquiredAt: NOW - 1000, expiresAt: NOW + 29000 };
    const store = confirmedStore({ consecutive: 564 }, {}, lock), before = new Map(store);
    const response = observationResponse({ text: '\uFEFF' + JSON.stringify({ result_code: 'success', data: {
        checked_in: true, stats: { continuous_checkin_days: 564, accumulate_days: 570 }, message: '蔚来，签到完成🚗',
    } }), headers: { 'Set-Cookie': 'SECRET_RESPONSE_COOKIE', 'X-Original': '保留原响应头' } });
    const headers = response.headers, body = response.body;
    const h = await harness({ store, request: captureRequest(), response }); await h.promise;
    assertOriginalBytes(h, response); assert.equal(response.status, 200); assert.equal(response.headers, headers); assert.equal(response.body, body);
    assert.equal(response.headers.get('X-Original'), '保留原响应头'); assert.equal(response.headers.get('Set-Cookie'), 'SECRET_RESPONSE_COOKIE');
    assert.equal(store.get(KEY), before.get(KEY)); assert.equal(store.get(JOURNAL), before.get(JOURNAL));
    assert.deepEqual(h.writes.map(([key]) => key), [OBSERVATION]);
    assert.deepEqual(JSON.parse(store.get(OBSERVATION)).stats, { consecutive: 564, total: 570 });
    assert.deepEqual(h.reads.filter(key => key === JOURNAL), []);
});
test('同日观察补旧 partial 确认的诊断与当天去重通知，只写独立统计键', async () => {
    const store = confirmedStore(), before = store.get(JOURNAL);
    const response = observationResponse({ body: { result_code: 'success', data: {
        checked_in: true, stats: { continuous_checkin_days: 564, total_days: '570' },
    } } });
    const h = await harness({ store, request: captureRequest(), response }); await h.promise; assertOriginalBytes(h, response);
    const diagnostic = await h.invoke({});
    assert.match(diagnostic.children[0].text, /今日记录：已确认\n连续签到：564 天\n累计签到：570 天/);
    assert.match(diagnostic.children[0].text, /累计来源：当日同凭据的已观察响应/);
    await h.invoke(); assert.equal(h.posts.length, 0); assert.equal(subtitle(h), '今日已签到 ✅');
    assert.equal(h.notices.at(-1).body, '🔥 连续签到：564 天\n📊 累计签到：570 天');
    assert.equal(store.get(JOURNAL), before); assert.deepEqual(h.writes.map(([key]) => key), [OBSERVATION]); assertPrivate(h);
});
test('已有有效主统计与零优先，观察只补诊断和新签到的缺值', async () => {
    for (const primary of [{ consecutive: 0, total: 0 }, { consecutive: 7, total: 11 }, { consecutive: 564 }]) {
        const total = primary.total === undefined ? 777 : primary.total;
        const store = confirmedStore(primary); setObservation(store, { stats: { consecutive: 999, total: 777 } });
        const h = await harness({ store, generic: true }); await h.promise;
        assert.match(h.output.children[0].text, new RegExp(`连续签到：${primary.consecutive} 天\\n累计签到：${total} 天`));
        await h.invoke(); assert.equal(h.posts.length, 0); assert.equal(h.writes.length, 0); assertPrivate(h);
        const fresh = stateStore(); setObservation(fresh, { stats: { consecutive: 999, total: 777 } });
        const stats = { continuous_checkin_days: primary.consecutive, ...(primary.total === undefined ? {} : { accumulate_days: primary.total }) };
        const scheduled = await harness({ store: fresh, replies: [{ body: { result_code: 'success', data: { checked_in: true, stats } } }] });
        await scheduled.promise; assert.equal(scheduled.posts.length, 1);
        assert.deepEqual(journal(scheduled).confirmed.stats, { consecutive: primary.consecutive, total });
        assert.equal(scheduled.writes.some(([key]) => key === OBSERVATION || key === KEY), false); assertPrivate(scheduled);
    }
});
test('昨日、未来时间与另一 generation 的观察都不能填入今日确认', async () => {
    for (const extra of [
        { day: '2026-11-04', observedAt: NOW - 86400000 },
        { day: '2026-11-06', observedAt: NOW + 86400000 },
        { observedAt: NOW + 1000 }, { generation: NEXT },
    ]) {
        const store = confirmedStore(); setObservation(store, extra);
        const h = await harness({ store, generic: true }); await h.promise;
        assert.match(h.output.children[0].text, /今日记录：已确认\n连续签到：564 天\n累计签到：未知/);
        assert.doesNotMatch(h.output.children[0].text, /累计来源：|累计签到：570 天/);
        await h.invoke(); assert.match(h.notices.at(-1).body, /累计签到：未知/);
        assert.equal(h.posts.length, 0); assert.equal(h.writes.length, 0); assertPrivate(h);
    }
});
test('今日缺累计观察不沿用昨日 569，不自行加一或为补统计重发', async () => {
    const store = confirmedStore({ consecutive: 563, total: 569 }, { day: '2026-11-04', confirmedAt: NOW - 86400000 });
    setObservation(store, { day: '2026-11-04', observedAt: NOW - 86400000, stats: { consecutive: 563, total: 569 } });
    const before = store.get(JOURNAL), partial = { result_code: 'success', data: { checked_in: true,
        stats: { continuous_checkin_days: 564, continuous_days: 564 } } };
    const response = observationResponse({ body: partial });
    const h = await harness({ store, request: captureRequest(), response, replies: [{ body: partial }] }); await h.promise;
    assertOriginalBytes(h, response); assert.deepEqual(JSON.parse(store.get(OBSERVATION)).stats, { consecutive: 564 });
    assert.equal(store.get(JOURNAL), before);
    const diagnostic = await h.invoke({}); assert.match(diagnostic.children[0].text, /今日记录：未确认/);
    await h.invoke(); assert.equal(h.posts.length, 1); assert.deepEqual(journal(h).confirmed.stats, { consecutive: 564 });
    assert.equal(h.notices.at(-1).body, '🔥 连续签到：564 天\n📊 累计签到：未知');
    await h.invoke(); assert.equal(h.posts.length, 1); assertPrivate(h);
});
test('没有今日 confirmed 时独立观察不冒充签到成功，也不创建 journal 或锁', async () => {
    const store = stateStore(), before = store.get(KEY), response = observationResponse();
    const h = await harness({ store, request: captureRequest(), response }); await h.promise; assertOriginalBytes(h, response);
    const diagnostic = await h.invoke({}); assert.match(diagnostic.children[0].text, /今日记录：未确认/);
    assert.doesNotMatch(diagnostic.children[0].text, /连续签到：|累计签到：|累计来源：/);
    assert.equal(store.has(JOURNAL), false); assert.equal(store.get(KEY), before); assert.equal(h.notices.length, 0);
    assert.deepEqual(h.writes.map(([key]) => key), [OBSERVATION]); assertPrivate(h);
});
test('精确既有签到端点的 GET 和 POST 可被动观察，包括原查询与小写方法', async () => {
    for (const method of ['GET', 'POST', 'get', 'post']) for (const suffix of ['', '?app_id=10086&timestamp=SECRET_QUERY']) {
        const response = observationResponse();
        const h = await harness({ request: captureRequest('https://gateway-front-external.nio.com/moat/10086/c/award_cn/checkin' + suffix,
            TOKEN, undefined, method), response }); await h.promise;
        assertOriginalBytes(h, response); assert.equal(h.store.has(OBSERVATION), true);
        assert.deepEqual(h.writes.map(([key]) => key), [OBSERVATION]);
    }
});
test('错误域名/协议/路径/方法和非 200 响应不消费观察流、不写任何状态', async () => {
    const endpoint = captureRequest().url;
    const rejected = [
        ...['https://app.nio.com/app/api/checkin', 'https://api.nio.com/api/checkin', endpoint + '/', endpoint + '-extra', endpoint + '#fragment',
            endpoint.replace('https:', 'http:'), endpoint.replace('.nio.com/', '.nio.com.evil.test/'),
            endpoint.replace('.nio.com/', '.nio.com:443/'), endpoint.replace('.nio.com/', '.nio.com@evil.test/')]
            .map(url => [url, 'POST', 200]),
        ...['HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', '', null, undefined].map(method => [endpoint, method, 200]),
        ...[201, 204, 301, 401, 403, 429, 500, '200'].map(status => [endpoint, 'POST', status]),
    ];
    for (const [url, method, status] of rejected) {
        const store = stateStore(), before = new Map(store), response = observationResponse({ status });
        const h = await harness({ store, request: { ...captureRequest(url), method }, response }); await h.promise;
        assert.equal(response.consumed, 0); assert.equal(h.output, undefined); assert.deepEqual(store, before);
        assert.equal(h.posts.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.notices.length, 0); assertPrivate(h);
    }
});
test('无凭据、失效、损坏、未来保存时间或 Authorization 不一致不消费观察流', async () => {
    for (const options of [{ store: new Map() }, { store: stateStore({ invalid: true }) },
        { store: stateStore({ observedAt: NOW + 3600000 }) }, { store: stateStore({ generation: 'bad generation' }) },
        { store: new Map([[KEY, 'SECRET_BROKEN']]) }, { store: stateStore({ token: NEW_TOKEN }) },
        { request: captureRequest(undefined, NEW_TOKEN) }, { request: captureRequest(undefined, 'Bearer short') },
        { request: { ...captureRequest(), headers: new Headers() } }, { readThrows: true }]) {
        const response = observationResponse(), store = options.store || stateStore(), before = new Map(store);
        const h = await harness({ ...options, store, request: options.request || captureRequest(), response }); await h.promise;
        assert.equal(response.consumed, 0); assert.equal(h.output, undefined); assert.deepEqual(store, before);
        assert.equal(h.posts.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.notices.length, 0); assertPrivate(h);
    }
});
test('无正文或不支持的 charset 不消费；UTF-8 别名与未声明编码保留原字节', async () => {
    for (const options of [{ noBody: true }, ...['gb2312', 'gbk', 'utf-16', 'iso-8859-1', 'SECRET_CHARSET']
        .map(charset => ({ headers: { 'Content-Type': 'application/json; charset=' + charset } }))]) {
        const response = observationResponse(options), h = await harness({ request: captureRequest(), response }); await h.promise;
        assert.equal(response.consumed, 0); assert.equal(h.output, undefined); assert.equal(h.writes.length, 0);
        assert.equal(h.posts.length, 0); assertPrivate(h);
    }
    for (const contentType of ['application/json', 'application/json; charset=UTF8', "application/json; charset='utf-8'", 'application/json; charset=us-ascii']) {
        const response = observationResponse({ headers: { 'Content-Type': contentType } });
        const h = await harness({ request: captureRequest(), response }); await h.promise; assertOriginalBytes(h, response);
        assert.equal(h.store.has(OBSERVATION), true);
    }
});
test('非 JSON、错误业务码与非 true checked_in 都原样回传，不保存观察', async () => {
    for (const options of [...['<html>SECRET_BODY</html>', '{', 'null', '[]'].map(text => ({ text })),
        ...[{ result_code: 'failure', data: { checked_in: true } }, { result_code: 'invalid_token', data: { checked_in: true } },
            { result_code: 'success', data: [] }, { result_code: 'success', data: null },
            { result_code: 'success', data: { checked_in: false } }, { result_code: 'success', data: { checked_in: 'true' } },
            { result_code: 'success', data: {} }].map(body => ({ body }))]) {
        const store = stateStore(), before = new Map(store), response = observationResponse(options);
        const h = await harness({ store, request: captureRequest(), response }); await h.promise; assertOriginalBytes(h, response);
        assert.deepEqual(store, before); assert.equal(h.writes.length, 0);
    }
});
test('非法 UTF-8、截断、过长编码、代理项与越界码点不解析也不破坏原字节', async () => {
    for (const invalid of [[0x80], [0xff], [0xc0, 0xaf], [0xe0, 0x80, 0xaf], [0xe2, 0x82],
        [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80]]) {
        const bytes = Buffer.concat([Buffer.from('{"result_code":"success","data":{"checked_in":true,"message":"'),
            Buffer.from(invalid), Buffer.from('","stats":{"accumulate_days":570}}}')]);
        const response = observationResponse({ bytes }), h = await harness({ request: captureRequest(), response }); await h.promise;
        assertOriginalBytes(h, response); assert.equal(h.writes.length, 0); assert.equal(h.store.has(OBSERVATION), false);
    }
});
test('正文 262144 字节边界可观察，超尺寸正文原样回传且不保存', async () => {
    const json = Buffer.from(JSON.stringify(SIGNED));
    for (const length of [262144, 262145]) {
        const bytes = Buffer.concat([json, Buffer.alloc(length - json.length, 0x20)]), response = observationResponse({ bytes });
        const h = await harness({ request: captureRequest(), response }); await h.promise; assertOriginalBytes(h, response);
        assert.equal(h.store.has(OBSERVATION), length === 262144); assert.equal(h.writes.length, length === 262144 ? 1 : 0);
    }
});
test('观察流立即或延迟读取失败只读一次，不二读、不伪造空正文、不补请求', async () => {
    for (const options of [{ bodyThrows: true }, { defer: true }]) {
        const store = stateStore(), before = new Map(store), response = observationResponse(options);
        const h = await harness({ store, request: captureRequest(), response });
        if (options.defer) { assert.equal(h.completed, false); response.fail(); }
        await h.promise; assert.equal(h.completed, true); assert.equal(h.error, undefined); assert.equal(response.consumed, 1);
        assert.equal(h.output, undefined); assert.deepEqual(store, before); assert.equal(h.posts.length, 0);
        assert.equal(h.writes.length, 0); assert.equal(h.notices.length, 0); assertPrivate(h);
    }
});
test('观察正文 pending 超过三秒仍等待完整字节，不引入独立 race 丢失原响应', async () => {
    const response = observationResponse({ defer: true, text: '\uFEFF' + JSON.stringify(SIGNED) });
    const h = await harness({ request: captureRequest(), response }); assert.equal(h.completed, false); assert.equal(response.consumed, 1);
    await h.advance(4500); assert.equal(h.completed, false); assert.equal(h.writes.length, 0); assert.equal(h.output, undefined);
    assert.equal(h.timers.size, 0, '观察正文超时只交给原生模块，不创建本地竞争计时器');
    response.finish(); await h.promise; assertOriginalBytes(h, response);
    assert.equal(JSON.parse(h.store.get(OBSERVATION)).observedAt, NOW + 4500);
});
test('正文返回前 Token/generation/invalid/存储或 UTC+8 日界变化停止写观察', async () => {
    for (const change of [
        async h => h.store.set(KEY, JSON.stringify(state({ token: NEW_TOKEN }))),
        async h => h.store.set(KEY, JSON.stringify(state({ generation: NEXT }))),
        async h => h.store.set(KEY, JSON.stringify(state({ invalid: true }))),
        async h => h.store.delete(KEY), async h => h.store.set(KEY, 'SECRET_BROKEN'),
        async h => { h.options.readThrows = true; }, async h => h.advance(15 * 3600000),
    ]) {
        const response = observationResponse({ defer: true }), h = await harness({ request: captureRequest(), response });
        assert.equal(h.completed, false); await change(h); const before = new Map(h.store);
        response.finish(); await h.promise; assertOriginalBytes(h, response);
        assert.equal(h.writes.length, 0); assert.deepEqual(h.store, before);
    }
});
test('同日 partial 新观察保留此前真实缺项，只更新本次实际返回的合法数', async () => {
    const store = stateStore(); setObservation(store);
    const response = observationResponse({ body: { result_code: 'success', data: { checked_in: true,
        stats: { continuous_checkin_days: 565 } } } });
    const h = await harness({ store, request: captureRequest(), response }); await h.promise; assertOriginalBytes(h, response);
    assert.deepEqual(JSON.parse(store.get(OBSERVATION)).stats, { consecutive: 565, total: 570 });
    const nextResponse = observationResponse({ body: { result_code: 'success', data: { checked_in: true, award_info: { total_days: '571' } } } });
    const nextOutput = await h.invoke({ request: captureRequest(), response: nextResponse });
    assert.equal(nextResponse.consumed, 1); assert.deepEqual(Object.keys(nextOutput), ['body']);
    assert.deepEqual(Buffer.from(nextOutput.body), nextResponse.bytes);
    assert.deepEqual(JSON.parse(store.get(OBSERVATION)).stats, { consecutive: 565, total: 571 });
    assert.deepEqual(h.writes.map(([key]) => key), [OBSERVATION, OBSERVATION]); assert.equal(store.has(JOURNAL), false); assertPrivate(h);
});
test('观察写入异常、静默失败或回读被替换仍保留原 bytes、凭据和 journal', async () => {
    for (const options of [{ writeThrows: true }, { writeNoop: true }, { writeHook: (key, value, store) => {
        if (key === OBSERVATION) { store.set(key, JSON.stringify({ ...value, observedAt: NOW - 1 })); return false; }
    } }]) {
        const store = confirmedStore(), before = new Map(store), response = observationResponse();
        const h = await harness({ ...options, store, request: captureRequest(), response }); await h.promise; assertOriginalBytes(h, response);
        assert.equal(store.get(KEY), before.get(KEY)); assert.equal(store.get(JOURNAL), before.get(JOURNAL));
        assert.deepEqual(h.writes.map(([key]) => key), [OBSERVATION]);
        assert.equal(h.logs.some(line => line.includes('当日统计已观察；')), false);
        assert.match(h.logs.join('\n'), /统计观察未保存；原响应保持不变。/);
    }
});
test('可选观察缓存核心损坏只降级，不阻止正常签到或改动凭据', async () => {
    for (const raw of ['SECRET_BROKEN', 'null', '[]', '{}', JSON.stringify({ version: 1, generation: GENERATION,
        day: '2026-11-05', observedAt: NOW, stats: { total: -1 }, fields: fieldTypes() }),
        JSON.stringify({ version: 1, generation: GENERATION, day: '2026-11-04', observedAt: NOW, stats: {}, fields: fieldTypes() })]) {
        const store = stateStore(), before = store.get(KEY); store.set(OBSERVATION, raw);
        const h = await harness({ store }); await h.promise;
        assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '签到成功 ✅');
        assert.deepEqual(journal(h).confirmed.stats, { consecutive: 2, total: 4 }); assert.equal(journal(h).lock, null);
        assert.equal(store.get(KEY), before); assert.equal(store.get(OBSERVATION), raw);
        assert.equal(h.writes.some(([key]) => key === KEY || key === OBSERVATION), false); assertPrivate(h);
    }
});
test('观察字段元数据损坏只隐藏元数据，保留有效同日数字且不泄露损坏值', async () => {
    for (const fields of [null, [], { 'stats.accumulate_days': 'SECRET_METADATA' },
        fieldTypes({ 'stats.accumulate_days': 'SECRET_METADATA' }), fieldTypes({ secret: 'SECRET_METADATA' })]) {
        for (const stats of [{ consecutive: 564, total: 570 }, { consecutive: 564 }]) {
            const store = confirmedStore(); setObservation(store, { stats, fields });
            const h = await harness({ store, generic: true }); await h.promise;
            assert.match(h.output.children[0].text, /今日记录：已确认\n连续签到：564 天/);
            assert.match(h.output.children[0].text, stats.total === undefined ? /累计签到：未知/ : /累计签到：570 天/);
            assert.doesNotMatch(h.output.children[0].text, /累计字段类型：/);
            await h.invoke(); assert.equal(h.posts.length, 0); assert.equal(h.writes.length, 0); assertPrivate(h);
        }
    }
});
test('新 confirmed 固定字段类型可直接诊断，响应值与 Token 不进入日志或记录', async () => {
    const h = await harness({ replies: [{ body: { result_code: 'success', data: { checked_in: true,
        stats: { continuous_checkin_days: 564, accumulate_days: { token: 'SECRET_RESPONSE_TOKEN' } },
        message: 'SECRET_SERVER_MESSAGE',
    } } }] }); await h.promise;
    assert.deepEqual(journal(h).confirmed.fields, fieldTypes({ 'stats.continuous_checkin_days': 'number', 'stats.accumulate_days': 'object' }));
    assert.deepEqual(journal(h).confirmed.stats, { consecutive: 564 });
    const diagnostic = await h.invoke({});
    assert.match(diagnostic.children[0].text, /累计签到：未知\n累计字段类型：stats\.accumulate_days=object, accumulate_days=missing/);
    assert.doesNotMatch(JSON.stringify(journal(h)), /SECRET_|Bearer|OFFLINE_FIXTURE/);
    assert.equal(h.posts.length, 1); assertPrivate(h);
});
test('旧 3.0.1 confirmed 没有 fields 仍可诊断与当天去重，不重签或搬写', async () => {
    for (const stats of [{ consecutive: 563, total: 569 }, { consecutive: 564 }]) {
        const store = confirmedStore(stats), before = new Map(store), h = await harness({ store, generic: true }); await h.promise;
        assert.match(h.output.children[0].text, /今日记录：已确认/);
        assert.match(h.output.children[0].text, stats.total === undefined ? /旧记录没有字段类型/ : /累计签到：569 天/);
        await h.invoke(); assert.equal(subtitle(h), '今日已签到 ✅'); assert.equal(h.posts.length, 0);
        assert.equal(h.writes.length, 0); assert.deepEqual(store, before); assert.equal(journal(h).confirmed.fields, undefined); assertPrivate(h);
    }
});
test('非法 confirmed.fields 只忽略元数据，不废掉有效 today、阻止去重或重签', async () => {
    const lock = { id: 'offline_existing_lock', generation: GENERATION, acquiredAt: NOW - 1000, expiresAt: NOW + 29000 };
    for (const fields of [null, [], {}, { 'stats.accumulate_days': 'SECRET_METADATA' },
        fieldTypes({ 'stats.accumulate_days': 'SECRET_METADATA' }), fieldTypes({ extra: 'string' })]) {
        const store = confirmedStore({ consecutive: 564 }, { fields }, lock), before = new Map(store);
        const h = await harness({ store, generic: true }); await h.promise;
        assert.match(h.output.children[0].text, /今日记录：已确认\n连续签到：564 天\n累计签到：未知/);
        assert.match(h.output.children[0].text, /任务锁：有效/);
        assert.doesNotMatch(h.output.children[0].text, /本地状态无法读取|累计字段类型：/);
        await h.invoke(); assert.equal(subtitle(h), '今日已签到 ✅');
        assert.equal(h.posts.length, 0); assert.equal(h.writes.length, 0); assert.deepEqual(store, before); assertPrivate(h);
    }
});
test('被动观察仅保存固定字段名和有限类型，缺统计不伪造数或泄露响应、头与查询', async () => {
    const store = confirmedStore(), before = new Map(store), response = observationResponse({ headers: { 'X-Secret': 'SECRET_HEADER' },
        body: { result_code: 'success', message: 'SECRET_SERVER', data: { checked_in: true,
            stats: { continuous_checkin_days: 'SECRET_VALUE', continuous_days: false, accumulate_days: { token: 'SECRET_TOKEN' },
                accumulateDays: ['SECRET_ARRAY'], total_days: null },
            continuous_checkin_days: 'SECRET_STRING', continuous_days: [], accumulate_days: true,
            accumulateDays: 'SECRET_ALIAS', total_days: -1, award_info: { accumulate_days: {}, total_days: 'SECRET_AWARD' },
        } } });
    const h = await harness({ store, request: captureRequest(captureRequest().url + '?token=SECRET_QUERY'), response }); await h.promise;
    assertOriginalBytes(h, response);
    const saved = JSON.parse(store.get(OBSERVATION)); assert.deepEqual(saved.stats, {});
    assert.deepEqual(saved.fields, fieldTypes({ 'stats.continuous_checkin_days': 'string', 'stats.continuous_days': 'boolean',
        continuous_checkin_days: 'string', continuous_days: 'array', 'stats.accumulate_days': 'object', accumulate_days: 'boolean',
        'stats.accumulateDays': 'array', accumulateDays: 'string', 'stats.total_days': 'null', total_days: 'number',
        'award_info.accumulate_days': 'object', 'award_info.total_days': 'string' }));
    assert.doesNotMatch(store.get(OBSERVATION), /SECRET_|Bearer|OFFLINE_FIXTURE|https?:\/\//);
    assert.equal(store.get(KEY), before.get(KEY)); assert.equal(store.get(JOURNAL), before.get(JOURNAL));
    const diagnostic = await h.invoke({}); assert.match(diagnostic.children[0].text, /累计签到：未知\n累计字段类型：/);
    assertPrivate(h);
});
test('原生 YAML 四入口/版本/09:00/三个 MITM 主机、固定脚本引用都正确', () => {
    const version = source.match(/\/\/ Version: ([\d.]+)/)[1];
    assert.ok(yaml.description.startsWith(version));
    assert.ok(source.includes('version: "' + version + '"'));
    assert.equal(yaml.scriptings.length, 4);
    assert.deepEqual(yaml.scriptings.map(row => {
        assert.equal(Object.keys(row).length, 1); return Object.keys(row)[0];
    }).sort(), ['generic', 'http_request', 'http_response', 'schedule']);
    const find = type => yaml.scriptings.find(row => row[type])[type];
    const request = find('http_request'), response = find('http_response'), schedule = find('schedule'), generic = find('generic');
    assert.equal(new Set([request.script_url, response.script_url, schedule.script_url, generic.script_url]).size, 1);
    assert.equal(request.body_required, false); assert.equal(schedule.cron, '0 9 * * *'); assert.equal(schedule.timeout, 30);
    assert.equal(response.body_required, true); assert.equal(response.binary_body, true);
    assert.equal(response.max_size, 262144); assert.equal(response.timeout, 5);
    assert.equal(response.match, '^https://gateway-front-external\\.nio\\.com/moat/10086/c/award_cn/checkin(?:\\?|$)');
    const pattern = new RegExp(request.match); assert.equal(pattern.test(captureRequest().url), true);
    assert.equal(pattern.test('https://app.nio.com.evil.test/app/api/x'), false);
    const responsePattern = new RegExp(response.match); assert.equal(responsePattern.test(captureRequest().url), true);
    assert.equal(responsePattern.test(captureRequest().url + '?app_id=10086'), true);
    for (const url of [captureRequest().url + '/', captureRequest().url + '-extra', 'https://app.nio.com/app/api/checkin',
        captureRequest().url.replace('.nio.com/', '.nio.com.evil.test/')]) assert.equal(responsePattern.test(url), false);
    assert.deepEqual(yaml.mitm.hostnames.includes, ['gateway-front-external.nio.com', 'app.nio.com', 'api.nio.com']);
    for (const row of [request, response, schedule, generic]) {
        const url = new URL(row.script_url); assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'raw.githubusercontent.com');
        assert.equal(url.port, ''); assert.equal(url.username, ''); assert.equal(url.password, ''); assert.equal(url.hash, '');
        assert.match(url.pathname, /^\/atopsecret\/SurgeScripts\/[0-9a-f]{40}\/weilai\/weilai-auto-checkin\.egern\.js$/);
        assert.equal(url.search, '?v=' + version); assert.equal(url.searchParams.get('v'), version);
        assert.ok(fs.existsSync(path.join(root, path.basename(url.pathname))));
        assert.equal(row.update_interval, 3600);
    }
    const ref = new URL(request.script_url).pathname.split('/')[3];
    const pinned = execFileSync('git', ['show', ref + ':weilai/weilai-auto-checkin.egern.js'],
        { cwd: root, encoding: 'utf8', timeout: 5000 });
    assert.equal(pinned, source, '四入口固定提交的业务源码必须与本地被测版本逐字一致');
    assert.doesNotMatch(source, /\$(?:done|request|response|persistentStore|httpClient|notification)\b|\bimport\s/);
});
