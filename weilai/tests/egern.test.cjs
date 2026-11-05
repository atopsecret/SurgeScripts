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
const source = fs.readFileSync(path.join(root, 'weilai-auto-checkin.egern.js'), 'utf8');
const yaml = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))',
    path.join(root, 'weilai-auto-checkin.egern.yaml')], { encoding: 'utf8', timeout: 5000 }));
const KEY = 'weilai_egern_auth_state_v1', JOURNAL = 'weilai_egern_checkin_v1';
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
function captureRequest(url = 'https://gateway-front-external.nio.com/moat/10086/c/award_cn/checkin', token = TOKEN, ua = 'NIOAppCN/6.10.0 offline') {
    return { url, headers: new Headers({ AUTHORIZATION: token, 'User-Agent': ua }), text: () => { throw Error('不能读取捕获请求正文'); } };
}
class Headers {
    constructor(values = {}) { Object.assign(this, values); }
    get(name) {
        const key = Object.keys(this).find(key => key.toLowerCase() === name.toLowerCase());
        return !key ? null : Array.isArray(this[key]) ? this[key].join(', ') : this[key];
    }
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
    const params = options.request ? { request: options.request } : options.generic ? {} : { cron: '0 9 * * *' };
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
    return { store, clock, posts, notices, logs, reads, writes, responses, pending, pendingBodies, promise,
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
    assert.equal(subtitle(h), '今日签到已确认'); assert.match(h.notices[0].body, /2 天\n累计签到：4 天/);
    assert.equal(h.responses[0].consumed, 1); assert.equal(journal(h).lock, null); assertPrivate(h);
});
test('request 捕获仅读 Headers，不消费 body、不执行签到，存储 API 返回 void 仍有效', async () => {
    const h = await harness({ store: new Map(), request: captureRequest() }); await h.promise;
    assert.equal(h.posts.length, 0); assert.equal(subtitle(h), '凭据已更新');
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
    assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '今日签到已确认');
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
test('捕获写入失败或静默未写入，不报告更新成功；读取不可用不覆盖状态', async () => {
    for (const options of [{ writeThrows: true }, { writeNoop: true }]) {
        const h = await harness({ ...options, store: new Map(), request: captureRequest() });
        assert.equal(subtitle(h), '凭据保存失败'); assert.equal(h.store.size, 0); assertPrivate(h);
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
        const h = await harness({ store }); assert.equal(h.posts.length, 0); assert.notEqual(subtitle(h), '今日签到已确认'); assertPrivate(h);
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
    assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '今日签到已确认（本地记录）');
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
    assert.equal(h.posts.length, 2); assert.equal(subtitle(h), '今日签到已确认');
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
    assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '今日签到已确认'); assert.equal(h.notices.length, 1);
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
        assert.equal(h.posts.length, 1); assert.equal(h.completed, true); assert.notEqual(subtitle(h), '今日签到已确认');
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
        assert.equal(h.posts.length, 1); assert.equal(h.notices[0].body, `连续签到：${consecutive} 天\n累计签到：${total} 天`);
        assert.deepEqual(journal(h).confirmed.stats, { consecutive, total });
        assert.equal(h.logs.some(line => line.includes('统计字段类型：')), false);
        await h.invoke(); assert.equal(h.posts.length, 1); assert.equal(subtitle(h), '今日签到已确认（本地记录）');
        assert.match(h.notices.at(-1).body, new RegExp(`连续签到：${consecutive} 天`)); assertPrivate(h);
    }
});
test('顶层连续签到字段 continuous_checkin_days 不丢失', async () => {
    const h = await harness({ replies: [{ body: { result_code: 'success', data: {
        checked_in: true, continuous_checkin_days: 7, accumulate_days: 11,
    } } }] });
    assert.equal(h.notices[0].body, '连续签到：7 天\n累计签到：11 天');
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
        assert.equal(h.notices[0].body, `连续签到：${consecutive} 天\n累计签到：${total} 天`); assertPrivate(h);
    }
});
test('确认记录保存失败不伪报防重成功，保留租约并明确说明', async () => {
    const h = await harness({ writeHook: (key, value) => key === JOURNAL && value.confirmed ? false : undefined });
    assert.equal(subtitle(h), '今日签到已确认'); assert.match(h.notices[0].body, /防重复记录未确认保存/);
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
test('原生 YAML 三入口/版本/09:00/三个 MITM 主机、文件引用都正确', () => {
    const version = source.match(/\/\/ Version: ([\d.]+)/)[1];
    assert.ok(yaml.description.startsWith(version));
    assert.ok(source.includes('version: "' + version + '"'));
    assert.equal(yaml.scriptings.length, 3);
    const request = yaml.scriptings[0].http_request, schedule = yaml.scriptings[1].schedule, generic = yaml.scriptings[2].generic;
    assert.equal(request.body_required, false); assert.equal(schedule.cron, '0 9 * * *'); assert.equal(schedule.timeout, 30);
    const pattern = new RegExp(request.match); assert.equal(pattern.test(captureRequest().url), true);
    assert.equal(pattern.test('https://app.nio.com.evil.test/app/api/x'), false);
    assert.deepEqual(yaml.mitm.hostnames.includes, ['gateway-front-external.nio.com', 'app.nio.com', 'api.nio.com']);
    for (const row of [request, schedule, generic]) {
        const url = new URL(row.script_url); assert.equal(url.hostname, 'raw.githubusercontent.com');
        assert.equal(url.pathname, '/atopsecret/SurgeScripts/main/weilai/weilai-auto-checkin.egern.js');
        assert.equal(url.searchParams.get('v'), version); assert.ok(fs.existsSync(path.join(root, path.basename(url.pathname))));
        assert.equal(row.update_interval, 3600);
    }
    assert.doesNotMatch(source, /\$(?:done|request|response|persistentStore|httpClient|notification)\b|\bimport\s/);
});
