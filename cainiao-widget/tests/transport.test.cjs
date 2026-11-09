// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --test cainiao-widget/tests/transport.test.cjs
// 依赖：内置库；所有 HTTP、存储、Cookie 均为合成夹具，禁止真实网络
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const dgram = require("node:dgram");
let transport, core, forbiddenCalls = 0;
const restores = [];
const NOW = Date.UTC(2026, 10, 9, 1, 0);
const WINDOW = 7 * 86400000;
const PRIVATE = "SYNTHETIC_PRIVATE_DO_NOT_PERSIST";

before(async () => {
    const forbid = () => { forbiddenCalls++; throw new Error("transport-test-forbids-real-network"); };
    for (const [owner, key] of [[globalThis, "fetch"], [net, "connect"], [net, "createConnection"], [net.Socket.prototype, "connect"],
        [http, "request"], [http, "get"], [https, "request"], [https, "get"], [tls, "connect"], [dgram.Socket.prototype, "send"]]) {
        const original = owner[key]; owner[key] = forbid; restores.push(() => { owner[key] = original; });
    }
    transport = await import("../transport.mjs"); core = await import("../core.mjs");
});
after(() => {
    for (const restore of restores.reverse()) restore();
    assert.equal(forbiddenCalls, 0, "传输回归不得尝试真实 socket/fetch");
});

function response(raw, status = 200) {
    return {status, text: async () => typeof raw === "string" ? raw : JSON.stringify(raw)};
}
function echo(cookie = "CW_TEST=123", status = 200) {
    return response({headers: {host: "postman-echo.com", ...(cookie === null ? {} : {cookie})}}, status);
}
function fixture(replies = [echo(), echo()]) {
    const memory = new Map(), requests = [], writes = [], reads = [];
    let now = NOW;
    const ctx = {
        env: {CONNECTION_MODE: "auto", CW_TRANSPORT_CHECK: "true"},
        storage: {
            getJSON: key => { reads.push(key); assert.equal(key, core.CW_TRANSPORT_STORE); return structuredClone(memory.get(key) ?? null); },
            setJSON: (key, value) => { assert.equal(key, core.CW_TRANSPORT_STORE); writes.push(structuredClone(value)); memory.set(key, structuredClone(value)); },
        },
        http: {get: async (url, options) => {
            requests.push({url, options: structuredClone(options)});
            const value = replies.shift();
            if (value instanceof Error) throw value;
            if (typeof value === "function") return value(url, options);
            if (!value) throw new Error("synthetic-transport-offline");
            return value;
        }},
    };
    return {ctx, memory, requests, writes, reads, replies, clock: () => now, advance: ms => { now += ms; }};
}
function stored(f) { return f.memory.get(core.CW_TRANSPORT_STORE); }
function sample(kind = "NOT_RUN", at = null, markerReceived = null, extraCookies = null) {
    return {kind, markerReceived, extraCookies, at};
}
function running(now = NOW, changes = {}) {
    return {schema: 1, version: core.CW_VERSION, runId: "a".repeat(32), kind: "RUNNING", startedAt: now,
        leaseUntil: now + 30000, at: now, expiresAt: now + WINDOW, omit: sample(), include: sample(), ...changes};
}
function complete(now = NOW, changes = {}) {
    return running(now, {kind: "COMPLETE", omit: sample("ECHO", now, true, false), include: sample("ECHO", now, true, false), ...changes});
}
function run(f) { return transport.runCainiaoTransportCheck(f.ctx, f.clock); }
function stream(raw, changes = {}) {
    const rows = [new Uint8Array(Buffer.from(raw))];
    let cancelled = 0, released = 0;
    const reader = {read: async () => rows.length ? {done: false, value: rows.shift()} : {done: true},
        cancel: () => { cancelled++; }, releaseLock: () => { released++; }, ...changes};
    return {response: {status: 200, body: {getReader: () => reader}, text: () => { throw new Error("不得二次消费正文"); }},
        reader, rows, cancelled: () => cancelled, released: () => released};
}

test("常量端点与两种 GET 模式固定，只有合成 Cookie 和 Accept 头", async () => {
    const f = fixture(), result = await run(f);
    assert.equal(transport.CW_TRANSPORT_ECHO_URL, "https://postman-echo.com/headers");
    assert.equal(transport.CW_TRANSPORT_TEST_COOKIE, "CW_TEST=123");
    assert.equal(result.kind, "COMPLETE"); assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests.map(row => row.options.credentials), ["omit", "include"]);
    for (const row of f.requests) {
        assert.equal(row.url, transport.CW_TRANSPORT_ECHO_URL);
        assert.deepEqual(row.options.headers, {Cookie: "CW_TEST=123", Accept: "application/json"});
        assert.equal(row.options.redirect, "manual"); assert.equal(row.options.insecureTls, false); assert.equal(row.options.timeout, 4000);
        assert.deepEqual(Object.keys(row.options).sort(), ["headers", "credentials", "redirect", "insecureTls", "timeout"].sort());
    }
});

test("1.3.0 升级保留已完成发送对照的原始窗口，不重新发出回显请求", async () => {
    const f = fixture(), previous = complete(NOW - 60000, {version: "1.3.0"});
    f.memory.set(core.CW_TRANSPORT_STORE, previous);
    const result = await run(f);
    assert.equal(result.kind, "COMPLETE");
    assert.equal(result.startedAt, previous.startedAt);
    assert.equal(result.expiresAt, previous.expiresAt);
    assert.equal(f.requests.length, 0);
    assert.equal(f.writes.length, 0);
    assert.deepEqual(stored(f), previous);
});

test("不读取手动 Cookie、App 原始头或个人存储，也不修改已有 auth", async () => {
    const f = fixture();
    Object.defineProperty(f.ctx.env, "CAINIAO_COOKIE", {get() { throw new Error(PRIVATE); }});
    const privateKey = "cainiao-widget.auth.v1", original = {cookie: PRIVATE, status: "unsupported"};
    f.memory.set(privateKey, original);
    const result = await run(f);
    assert.equal(result.kind, "COMPLETE"); assert.deepEqual(f.memory.get(privateKey), original);
    assert(f.reads.every(key => key === core.CW_TRANSPORT_STORE));
    assert(!JSON.stringify(f.requests).includes(PRIVATE)); assert(!JSON.stringify(f.writes).includes(PRIVATE));
});

test("手动与关闭模式不读取存储、不请求、不清除个人状态", async () => {
    for (const mode of ["manual", "off", "invalid", true, false, 0, {}, []]) {
        const f = fixture(); f.ctx.env.CONNECTION_MODE = mode;
        assert.equal((await run(f)).kind, "DISABLED"); assert.equal(f.requests.length, 0); assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
    }
});

test("未显式启用或非字符串 true 不运行发送对照", async () => {
    for (const enabled of [undefined, false, true, "false", "TRUE", 1]) {
        const f = fixture(); f.ctx.env.CW_TRANSPORT_CHECK = enabled;
        assert.equal((await run(f)).kind, "DISABLED"); assert.equal(f.requests.length, 0); assert.equal(f.reads.length, 0);
    }
});

test("请求与响应 hook 均在读取头和 body 前拒绝", async () => {
    for (const kind of ["request", "response"]) {
        const f = fixture(), item = {};
        for (const key of ["headers", "body", "url"]) Object.defineProperty(item, key, {get() { throw new Error(PRIVATE); }});
        f.ctx[kind] = item;
        assert.equal((await run(f)).kind, "DISABLED"); assert.equal(f.requests.length, 0); assert.equal(f.reads.length, 0);
    }
});

test("手动 generic 没有 widgetFamily 和 script 字段也可执行", async () => {
    const f = fixture(); assert.equal(f.ctx.widgetFamily, undefined); assert.equal(f.ctx.script, undefined);
    assert.equal((await run(f)).kind, "COMPLETE"); assert.equal(f.requests.length, 2);
});

test("有效 schema 中缺 Cookie 是明确未见标记，不与网络失败混淆", () => {
    assert.deepEqual(transport.cwTransportEcho('{"headers":{"host":"postman-echo.com"}}'), {kind: "ECHO", markerReceived: false, extraCookies: false});
    assert.deepEqual(transport.cwTransportEcho('{"headers":{"cookie":""}}'), {kind: "ECHO", markerReceived: false, extraCookies: false});
});

test("回显字段 Cookie 大小写无关，Cookie 名自身区分大小写", () => {
    assert.deepEqual(transport.cwTransportEcho('{"headers":{"CoOkIe":"CW_TEST=123"}}'), {kind: "ECHO", markerReceived: true, extraCookies: false});
    assert.deepEqual(transport.cwTransportEcho('{"headers":{"cookie":"cw_test=123"}}'), {kind: "ECHO", markerReceived: false, extraCookies: true});
});

test("额外与重复 Cookie 只留下布尔值，不保存值", async () => {
    const f = fixture([echo("CW_TEST=123; SID=" + PRIVATE), echo("CW_TEST=123; CW_TEST=123")]), result = await run(f);
    assert.equal(result.omit.markerReceived, true); assert.equal(result.omit.extraCookies, true);
    assert.equal(result.include.markerReceived, true); assert.equal(result.include.extraCookies, true);
    assert(!JSON.stringify(result).includes(PRIVATE)); assert(!JSON.stringify(f.writes).includes(PRIVATE));
    assert(!transport.cwTransportLines(f.ctx, f.clock()).join("\n").includes(PRIVATE));
});

test("标记值不匹配不会报告已收到，未知 Cookie 不输出名字和值", async () => {
    const f = fixture([echo("CW_TEST=" + PRIVATE), echo("only_private=" + PRIVATE)]), result = await run(f);
    for (const mode of ["omit", "include"]) {
        assert.equal(result[mode].kind, "ECHO"); assert.equal(result[mode].markerReceived, false); assert.equal(result[mode].extraCookies, true);
    }
    assert(!transport.cwTransportLines(f.ctx, f.clock()).join("\n").includes("only_private"));
});

test("root/headers/值类型与额外根字段严格拒绝，异常为 unknown", () => {
    for (const body of ["null", "[]", "{}", '{"headers":null}', '{"headers":[]}', '{"headers":{"cookie":123}}',
        '{"headers":{"cookie":["CW_TEST=123"]}}', '{"headers":{},"secret":"' + PRIVATE + '"}', '<html>' + PRIVATE + '</html>']) {
        const result = transport.cwTransportEcho(body);
        assert.equal(result.kind, "SCHEMA_UNKNOWN"); assert.equal(result.markerReceived, null); assert.equal(result.extraCookies, null);
        assert(!JSON.stringify(result).includes(PRIVATE));
    }
});

test("重复、转义后同名、大小写同名头和重复根 headers 都拒绝", () => {
    for (const raw of ['{"headers":{"cookie":"bad","cookie":"CW_TEST=123"}}', '{"headers":{"cookie":"bad","Cookie":"CW_TEST=123"}}',
        '{"headers":{"cookie":"bad","\\u0063ookie":"CW_TEST=123"}}', '{"headers":{},"headers":{"cookie":"CW_TEST=123"}}']) {
        assert.equal(transport.cwTransportEcho(raw).kind, "SCHEMA_UNKNOWN");
    }
});

test("无效 JSON、尾部数据、尾逗号和控制头值拒绝", () => {
    for (const raw of ['{"headers":{}} trailing', '{"headers":{"cookie":"CW_TEST=123",}}', '{"headers":{},}',
        '{"headers":{"invalid name":"x"}}', '{"headers":{"cookie":"CW_TEST=123\\r\\nX:bad"}}', '{"headers":{"x":"\\u0000"}}',
        '{"headers":{"x":"\\q"}}']) assert.equal(transport.cwTransportEcho(raw).kind, "SCHEMA_UNKNOWN");
});

test("Cookie 合并逗号或非法语法归 unknown，不猜测被剥离", () => {
    for (const cookie of ["CW_TEST=123, other=x", "CW_TEST=123; ", "not-a-pair", "CW_TEST=123\n", "bad name=x", "other=汉字"]) {
        const result = transport.cwTransportEcho(JSON.stringify({headers: {cookie}}));
        assert.equal(result.kind, "SCHEMA_UNKNOWN"); assert.equal(result.markerReceived, null);
    }
});

test("六十四 KiB 按 UTF-8 字节而非仅 JS 字符数限制", () => {
    const prefix = '{"headers":{}}';
    assert.equal(transport.cwTransportEcho(prefix + " ".repeat(65536 - prefix.length)).kind, "ECHO");
    assert.equal(transport.cwTransportEcho(prefix + " ".repeat(65537 - prefix.length)).kind, "SIZE_UNKNOWN");
    const unicode = JSON.stringify({headers: {x: "汉".repeat(23000)}});
    assert(unicode.length < 65536); assert.equal(transport.cwTransportEcho(unicode).kind, "SIZE_UNKNOWN");
});

test("响应头字段数量和名称长度受限", () => {
    const headers = Object.fromEntries(Array.from({length: 129}, (_, i) => ["x-" + i, "v"]));
    assert.equal(transport.cwTransportEcho(JSON.stringify({headers})).kind, "SCHEMA_UNKNOWN");
    assert.equal(transport.cwTransportEcho(JSON.stringify({headers: {["x".repeat(129)]: "v"}})).kind, "SCHEMA_UNKNOWN");
});

test("三百类响应不读体，不跟随到任意其它 URL", async () => {
    let bodyReads = 0;
    const f = fixture([300, 302].map(status => ({status, text: () => { bodyReads++; throw new Error(PRIVATE); }})));
    const result = await run(f);
    assert.equal(bodyReads, 0); assert.equal(f.requests.length, 2);
    for (const mode of ["omit", "include"]) { assert.equal(result[mode].kind, "REDIRECT_UNKNOWN"); assert.equal(result[mode].markerReceived, null); }
});

test("HTTP 错误和状态类型错误分类固定，不解析错误正文", async () => {
    const f = fixture([{status: 503, text: () => { throw new Error(PRIVATE); }}, {status: "200", text: () => { throw new Error(PRIVATE); }}]);
    const result = await run(f);
    assert.equal(result.omit.kind, "HTTP_UNKNOWN"); assert.equal(result.include.kind, "SCHEMA_UNKNOWN");
    assert.equal(result.omit.markerReceived, null); assert(!JSON.stringify(result).includes(PRIVATE));
});

test("HTTP 调用抛错只存 NETWORK_UNKNOWN，完成记录抑制同窗口重试", async () => {
    const f = fixture([new Error(PRIVATE), new Error(PRIVATE)]), result = await run(f);
    for (const mode of ["omit", "include"]) { assert.equal(result[mode].kind, "NETWORK_UNKNOWN"); assert.equal(result[mode].markerReceived, null); }
    assert.equal((await run(f)).kind, "COMPLETE"); assert.equal(f.requests.length, 2);
    assert(!JSON.stringify(f.writes).includes(PRIVATE)); assert(!transport.cwTransportLines(f.ctx, f.clock()).join("\n").includes(PRIVATE));
});

test("读体异常和非字符串正文均归 schema unknown，不保存异常", async () => {
    const f = fixture([{status: 200, text: async () => { throw new Error(PRIVATE); }}, {status: 200, text: async () => ({headers: {cookie: PRIVATE}})}]);
    const result = await run(f);
    assert.equal(result.omit.kind, "SCHEMA_UNKNOWN"); assert.equal(result.include.kind, "SCHEMA_UNKNOWN"); assert(!JSON.stringify(f.writes).includes(PRIVATE));
});

test("HTTP 四秒等待与十秒总预算接受前复核", async () => {
    const f = fixture();
    f.replies.splice(0, 2, () => { f.advance(5000); return echo(); }, () => { f.advance(5000); return echo(); });
    const result = await run(f);
    assert.equal(result.omit.kind, "TIMEOUT_UNKNOWN"); assert.equal(result.include.kind, "TIMEOUT_UNKNOWN"); assert.equal(f.requests.length, 2);
    assert.equal(result.omit.markerReceived, null); assert.equal(stored(f).expiresAt, NOW + WINDOW);
});

test("首个读体耗尽总预算，第二模式不再发 HTTP", async () => {
    const f = fixture([{status: 200, text: async () => { f.advance(10000); return JSON.stringify({headers: {cookie: "CW_TEST=123"}}); }}, echo()]);
    const result = await run(f);
    assert.equal(result.omit.kind, "TIMEOUT_UNKNOWN"); assert.equal(result.include.kind, "TIMEOUT_UNKNOWN"); assert.equal(f.requests.length, 1);
    assert.equal(result.kind, "COMPLETE");
});

test("临近总预算的第二次 HTTP timeout 缩短，不延长四秒或十秒上限", async () => {
    const f = fixture([{status: 200, text: async () => { f.advance(9999); return '{"headers":{}}'; }}, echo()]);
    const result = await run(f);
    assert.equal(result.kind, "COMPLETE"); assert.equal(f.requests[1].options.timeout, 1); assert.equal(f.requests.length, 2);
});

test("读取租约或结果失败在首次请求前停止", async () => {
    const f = fixture(); f.ctx.storage.getJSON = () => { throw new Error(PRIVATE); };
    const result = await run(f);
    assert.equal(result.kind, "STORAGE_UNKNOWN"); assert.equal(f.requests.length, 0); assert.equal(f.writes.length, 0);
    assert(transport.cwTransportResultLines(result, NOW).join("\n").includes("写入或读取未确认"));
    assert(!JSON.stringify(result).includes(PRIVATE));
});

test("初始租约写入抛错与静默 noop 均不发 HTTP", async () => {
    for (const throws of [true, false]) {
        const f = fixture(); f.ctx.storage.setJSON = () => { if (throws) throw new Error(PRIVATE); };
        const result = await run(f);
        assert.equal(result.kind, "STORAGE_UNKNOWN"); assert.equal(f.requests.length, 0);
        assert(transport.cwTransportResultLines(result, NOW).join("\n").includes("结果未知")); assert(!JSON.stringify(result).includes(PRIVATE));
    }
});

test("初始写后回读失败或字段不匹配在首次请求前停止", async () => {
    for (const corruption of ["read", "field"]) {
        const f = fixture(), get = f.ctx.storage.getJSON, set = f.ctx.storage.setJSON;
        let wrote = false;
        f.ctx.storage.setJSON = (key, value) => { set(key, value); wrote = true; };
        f.ctx.storage.getJSON = key => {
            if (wrote && corruption === "read") throw new Error(PRIVATE);
            const value = get(key);
            if (wrote && value) value.expiresAt++;
            return value;
        };
        const result = await run(f);
        assert.equal(result.kind, "STORAGE_UNKNOWN"); assert.equal(f.requests.length, 0);
    }
});

test("初始读取后另一运行写入，不覆盖其租约或发 HTTP", async () => {
    const f = fixture(), get = f.ctx.storage.getJSON, other = running(); let reads = 0;
    f.ctx.storage.getJSON = key => { if (++reads === 2) f.memory.set(key, other); return get(key); };
    const result = await run(f);
    assert.equal(result.kind, "SUPERSEDED"); assert.equal(f.requests.length, 0); assert.deepEqual(stored(f), other);
});

test("初始写入后另一运行替换 runId，回读不确认归属", async () => {
    const f = fixture(), set = f.ctx.storage.setJSON;
    f.ctx.storage.setJSON = (key, value) => set(key, {...value, runId: "b".repeat(32)});
    assert.equal((await run(f)).kind, "SUPERSEDED"); assert.equal(f.requests.length, 0); assert.equal(stored(f).runId, "b".repeat(32));
});

test("同一存储并发入口看到 RUNNING 后不重复发请求", async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const f = fixture([() => pending, echo()]), first = run(f);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.requests.length, 1); assert.equal((await run(f)).kind, "RUNNING"); assert.equal(f.requests.length, 1);
    release(echo()); assert.equal((await first).kind, "COMPLETE"); assert.equal(f.requests.length, 2);
});

test("在途 runId 替换停止旧运行，迟到回显不覆盖新状态", async () => {
    const f = fixture(); let other;
    f.replies.splice(0, 2, () => { other = {...stored(f), runId: "c".repeat(32)}; f.memory.set(core.CW_TRANSPORT_STORE, other); return echo(); }, echo());
    const result = await run(f);
    assert.equal(result.kind, "SUPERSEDED"); assert.equal(f.requests.length, 1); assert.deepEqual(stored(f), other);
});

test("在途删除独立键停止旧运行，不重新创建租约或结果", async () => {
    const f = fixture(); f.replies.splice(0, 2, () => { f.memory.delete(core.CW_TRANSPORT_STORE); return echo(); }, echo());
    assert.equal((await run(f)).kind, "SUPERSEDED"); assert.equal(f.requests.length, 1); assert.equal(stored(f), undefined); assert.equal(f.writes.length, 1);
});

test("HTTP 等待途中关闭或改手动模式，不读 body、不发第二请求、不回写", async () => {
    for (const mode of ["off", "manual"]) {
        let bodies = 0; const f = fixture();
        f.replies.splice(0, 2, () => { f.ctx.env.CONNECTION_MODE = mode; return {status: 200, text: () => { bodies++; return '{"headers":{}}'; }}; }, echo());
        const result = await run(f);
        assert.equal(result.kind, "MODE_CHANGED"); assert.equal(f.requests.length, 1); assert.equal(bodies, 0); assert.equal(f.writes.length, 1);
    }
});

test("读体途中取消显式开关，不把迟到回显保存成结果", async () => {
    const f = fixture([{status: 200, text: async () => { f.ctx.env.CW_TRANSPORT_CHECK = "false"; return '{"headers":{"cookie":"CW_TEST=123"}}'; }}, echo()]);
    assert.equal((await run(f)).kind, "MODE_CHANGED"); assert.equal(f.requests.length, 1); assert.equal(stored(f).omit.kind, "NOT_RUN");
});

test("第一份结果写失败停止第二请求，直接结果提示不被旧缓存覆盖", async () => {
    const f = fixture(), set = f.ctx.storage.setJSON; let writes = 0;
    f.ctx.storage.setJSON = (key, value) => { if (++writes > 1) throw new Error(PRIVATE); set(key, value); };
    const result = await run(f);
    assert.equal(result.kind, "STORAGE_UNKNOWN"); assert.equal(f.requests.length, 1); assert.equal(stored(f).kind, "RUNNING");
    assert(transport.cwTransportResultLines(result, NOW).join("\n").includes("本机写入或读取未确认"));
    assert(!transport.cwTransportResultLines(result, NOW).join("\n").includes(PRIVATE));
});

test("最终 COMPLETE 写入静默失败明确未知，不冒充已持久完成", async () => {
    const f = fixture(), set = f.ctx.storage.setJSON;
    f.ctx.storage.setJSON = (key, value) => { if (value.kind !== "COMPLETE") set(key, value); };
    const result = await run(f);
    assert.equal(result.kind, "STORAGE_UNKNOWN"); assert.equal(f.requests.length, 2); assert.equal(stored(f).kind, "RUNNING");
});

test("三十秒租约到期后的未完成记录仍在原七天内抑制请求", async () => {
    const f = fixture(); f.memory.set(core.CW_TRANSPORT_STORE, running()); f.advance(30000);
    const before = structuredClone(stored(f));
    assert.equal((await run(f)).kind, "INCOMPLETE_UNKNOWN"); assert.equal(f.requests.length, 0); assert.equal(f.writes.length, 0);
    assert.deepEqual(stored(f), before); assert(transport.cwTransportLines(f.ctx, f.clock()).join("\n").includes("原七天窗口内不重复请求"));
});

test("完成后七天内重复进入与只读诊断不续期", async () => {
    const f = fixture(); await run(f); const before = structuredClone(stored(f)), writes = f.writes.length;
    f.advance(WINDOW - 1);
    for (let i = 0; i < 3; i++) {
        assert.equal((await run(f)).kind, "COMPLETE"); assert(transport.cwTransportLines(f.ctx, f.clock()).length > 1);
    }
    assert.equal(f.requests.length, 2); assert.equal(f.writes.length, writes); assert.deepEqual(stored(f), before);
});

test("七天刚到期时只读显示过期，显式 generic 才创建新窗口", async () => {
    const f = fixture([echo(), echo(), echo(), echo()]); await run(f); f.advance(WINDOW);
    const writes = f.writes.length;
    assert(transport.cwTransportLines(f.ctx, f.clock()).join("\n").includes("记录已到期")); assert.equal(f.writes.length, writes); assert.equal(f.requests.length, 2);
    assert.equal((await run(f)).kind, "COMPLETE"); assert.equal(f.requests.length, 4); assert.equal(stored(f).startedAt, NOW + WINDOW); assert.equal(stored(f).expiresAt, NOW + 2 * WINDOW);
});

test("错误版本、未知分类、超长 TTL、非法时间和外来字段不作缓存或覆盖", async () => {
    const cases = [running(NOW, {version: "9.9.9"}), running(NOW, {runId: PRIVATE}), running(NOW, {kind: PRIVATE}),
        running(NOW, {expiresAt: NOW + WINDOW + 1}), running(NOW, {leaseUntil: NOW + 30001}), running(NOW, {at: NOW + 60001}),
        running(NOW, {startedAt: NaN}), running(NOW, {privateValue: PRIVATE}), running(NOW, {omit: sample("NETWORK_UNKNOWN", NOW, false, false)})];
    for (const value of cases) {
        const f = fixture(); f.memory.set(core.CW_TRANSPORT_STORE, value);
        assert.equal((await run(f)).kind, "STATE_UNKNOWN"); assert.equal(f.requests.length, 0); assert.equal(f.writes.length, 0);
        assert(!transport.cwTransportLines(f.ctx, f.clock()).join("\n").includes(PRIVATE));
    }
});

test("state 重建仅已知字段，完成状态不能包含尚未执行的模式", () => {
    const value = complete(); assert.deepEqual(transport.cwTransportState(value, NOW), value);
    assert.equal(transport.cwTransportState({...value, include: sample()}, NOW), null);
    assert.equal(transport.cwTransportState(running(NOW, {include: sample("ECHO", NOW, true, false)}), NOW), null);
});

test("非法或回退 clock 在请求前或在途停止，不借时钟延长租约", async () => {
    for (const clock of [() => 0, () => -1, () => NaN, () => NOW + 0.5, () => { throw new Error(PRIVATE); }]) {
        const f = fixture(); assert.equal((await transport.runCainiaoTransportCheck(f.ctx, clock)).kind, "CLOCK_UNKNOWN"); assert.equal(f.requests.length, 0);
    }
    const f = fixture(); f.replies.splice(0, 2, () => { f.advance(-1); return echo(); }, echo());
    assert.equal((await run(f)).kind, "CLOCK_UNKNOWN"); assert.equal(f.requests.length, 1); assert.equal(stored(f).omit.kind, "NOT_RUN");
});

test("guard 观察到租约期限已过时，不接受迟到响应或回写", async () => {
    const f = fixture(); f.replies.splice(0, 2, () => { f.advance(30000); return echo(); }, echo());
    const result = await run(f);
    assert.equal(result.kind, "SUPERSEDED"); assert.equal(f.requests.length, 1); assert.equal(f.writes.length, 1); assert.equal(stored(f).omit.kind, "NOT_RUN");
});

test("流式读取只消费 body，严格 UTF-8 解码和释放 reader", async () => {
    const first = stream('{"headers":{"cookie":"CW_TEST=123","x":"汉字"}}'), second = stream('{"headers":{}}');
    const f = fixture([first.response, second.response]), result = await run(f);
    assert.equal(result.omit.kind, "ECHO"); assert.equal(result.omit.markerReceived, true); assert.equal(result.include.markerReceived, false);
    assert.equal(first.released(), 1); assert.equal(first.cancelled(), 0); assert.equal(second.released(), 1);
});

test("流式大正文提前停止并取消，不积累超过六十四 KiB", async () => {
    const first = stream("x".repeat(65537)), f = fixture([first.response, echo()]), result = await run(f);
    assert.equal(result.omit.kind, "SIZE_UNKNOWN"); assert.equal(result.omit.markerReceived, null); assert.equal(first.cancelled(), 1); assert.equal(first.released(), 1);
});

test("流式畸形字节、无界空块或非字节块不会被当回显成功", async () => {
    const fixtures = [stream("", {read: async () => ({done: false, value: "not-bytes"})}),
        stream("", {read: async () => ({done: false, value: new Uint8Array()})}), stream("")];
    fixtures[2].rows.splice(0, 1, new Uint8Array([0xc0, 0xaf]));
    for (const current of fixtures) {
        const f = fixture([current.response, echo()]); assert.equal((await run(f)).omit.kind, "SCHEMA_UNKNOWN");
        assert.equal(current.released(), 1);
    }
});

test("迟到异步 HTTP 在模式变化后仅停止旧任务，不重写本机键", async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; }), f = fixture([() => pending, echo()]), task = run(f);
    await new Promise(resolve => setImmediate(resolve));
    f.ctx.env.CONNECTION_MODE = "off"; release(echo());
    assert.equal((await task).kind, "MODE_CHANGED"); assert.equal(f.requests.length, 1); assert.equal(f.writes.length, 1);
});

test("readonly lines 不触发 HTTP、写入或输出 runId、Cookie 和未知文本", async () => {
    const f = fixture([echo("CW_TEST=123; external=" + PRIVATE), echo()]); await run(f);
    const before = structuredClone(stored(f)), count = f.writes.length;
    const lines = transport.cwTransportLines(f.ctx, f.clock()).join("\n");
    assert(lines.includes("omit：测试标记已收到")); assert(lines.includes("include：测试标记已收到"));
    for (const value of [before.runId, PRIVATE, "CW_TEST=123", "postman-echo.com", "external="]) assert(!lines.includes(value));
    assert.equal(f.requests.length, 2); assert.equal(f.writes.length, count); assert.deepEqual(stored(f), before);
});

test("本轮与只读输出对畸形输入和异常始终使用固定 unknown 文案", () => {
    const f = fixture(); f.ctx.storage.getJSON = () => { throw new Error(PRIVATE); };
    assert(!transport.cwTransportLines(f.ctx, NOW).join("\n").includes(PRIVATE));
    for (const value of [null, {kind: PRIVATE}, {kind: "COMPLETE", startedAt: NOW, at: NOW, expiresAt: NOW + WINDOW, omit: {kind: PRIVATE}, include: sample()}]) {
        const lines = transport.cwTransportResultLines(value, NOW).join("\n");
        assert(lines.includes("未知")); assert(!lines.includes(PRIVATE));
    }
});

test("公开返回与所有持久写入只含固定结果和本机租约元数据", async () => {
    const f = fixture([echo("CW_TEST=123; extra=" + PRIVATE), echo()]), result = await run(f);
    assert.deepEqual(Object.keys(result).sort(), ["kind", "startedAt", "at", "expiresAt", "omit", "include"].sort());
    for (const value of f.writes) {
        assert.deepEqual(Object.keys(value).sort(), ["schema", "version", "runId", "kind", "startedAt", "leaseUntil", "at", "expiresAt", "omit", "include"].sort());
        for (const mode of ["omit", "include"]) assert.deepEqual(Object.keys(value[mode]).sort(), ["kind", "markerReceived", "extraCookies", "at"].sort());
        assert(!JSON.stringify(value).includes(PRIVATE)); assert(!JSON.stringify(value).includes("headers")); assert(!JSON.stringify(value).includes("CW_TEST"));
    }
});

test("模块只有一行 core import，原生 ES module 语法且无真实 fetch/client 依赖", () => {
    const source = fs.readFileSync(require.resolve("../transport.mjs"), "utf8");
    assert.equal((source.match(/^import .* from ['"]\.\/core\.mjs['"];$/gm) || []).length, 1);
    assert.equal((source.match(/^import /gm) || []).length, 1);
    assert(!/\b(?:fetch|require)\s*\(/.test(source)); assert(!/ctx\.env(?:\?|)\.CAINIAO_COOKIE/.test(source));
    assert(!/CW_AUTH_STORE|CW_CAPTURE_STORE|CW_APP_STORE|console\./.test(source));
    new vm.Script(source.replace(/^import .*\n/m, "").replace(/^export (?=(?:const|function|async function)\b)/gm, ""));
});

test("无计时器原生环境仍使用 HTTP timeout 与结果接受预算，不发明浏览器全局", async () => {
    const source = fs.readFileSync(require.resolve("../transport.mjs"), "utf8").replace(/^import .*\n/m, "").replace(/^export (?=(?:const|function|async function)\b)/gm, "");
    const sandbox = vm.createContext({CW_TRANSPORT_STORE: core.CW_TRANSPORT_STORE, CW_VERSION: core.CW_VERSION, md5: core.md5});
    new vm.Script(source + "\nthis.transportCheck = runCainiaoTransportCheck;").runInContext(sandbox);
    const f = fixture([echo(), echo()]);
    const result = await sandbox.transportCheck(f.ctx, f.clock);
    assert.equal(result.kind, "COMPLETE"); assert.equal(f.requests.length, 2); assert.equal(f.requests[0].options.timeout, 4000);
});

test("计时器分支能终止挂起 HTTP，迟到回显不消费正文或覆盖结果", async () => {
    const realTimeout = globalThis.setTimeout;
    let release, lateReads = 0;
    const pending = new Promise(resolve => { release = resolve; }), f = fixture([() => pending, echo()]);
    try {
        globalThis.setTimeout = (callback, delay, ...args) => realTimeout(callback, Math.min(delay, 5), ...args);
        const result = await run(f);
        assert.equal(result.kind, "COMPLETE"); assert.equal(result.omit.kind, "TIMEOUT_UNKNOWN"); assert.equal(result.omit.markerReceived, null);
        assert.equal(result.include.kind, "ECHO"); assert.equal(f.requests.length, 2);
        const before = structuredClone(stored(f)), writes = f.writes.length;
        release({status: 200, text: async () => { lateReads++; return '{"headers":{"cookie":"CW_TEST=123"}}'; }});
        await new Promise(resolve => realTimeout(resolve, 10));
        assert.equal(lateReads, 0); assert.equal(f.writes.length, writes); assert.deepEqual(stored(f), before);
    } finally { globalThis.setTimeout = realTimeout; }
});

test("流读取取消失败的异常被吞掉，不记录或产生未处理拒绝", async () => {
    const current = stream("x".repeat(65537), {cancel: () => Promise.reject(new Error(PRIVATE))});
    const f = fixture([current.response, echo()]), result = await run(f);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(result.omit.kind, "SIZE_UNKNOWN"); assert(!JSON.stringify(f.writes).includes(PRIVATE)); assert.equal(current.released(), 1);
});

test("每次构造独立常量头，客户端改写第一份对象不能污染第二请求", async () => {
    const f = fixture([(url, options) => { options.headers.Cookie = PRIVATE; options.headers.Authorization = PRIVATE; return echo(); }, echo()]);
    const result = await run(f);
    assert.equal(result.kind, "COMPLETE"); assert.deepEqual(f.requests[1].options.headers, {Cookie: "CW_TEST=123", Accept: "application/json"});
    assert(!JSON.stringify(f.requests).includes(PRIVATE)); assert(!JSON.stringify(f.writes).includes(PRIVATE));
});

test("租约读取过程中模式改变，初始写入或实际 HTTP 前再次拒绝", async () => {
    for (const changeAt of [2, 5]) {
        const f = fixture(), get = f.ctx.storage.getJSON; let reads = 0;
        f.ctx.storage.getJSON = key => {
            const value = get(key);
            if (++reads === changeAt) f.ctx.env.CONNECTION_MODE = "off";
            return value;
        };
        assert.equal((await run(f)).kind, "MODE_CHANGED"); assert.equal(f.requests.length, 0);
        assert.equal(f.writes.length, changeAt === 2 ? 0 : 1);
    }
});
