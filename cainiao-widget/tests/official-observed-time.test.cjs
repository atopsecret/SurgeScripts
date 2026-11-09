// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// 构建：无需编译
// 运行：node --test cainiao-widget/tests/official-observed-time.test.cjs
// 依赖：auth-fixture.cjs；时间、凭据及响应全部合成，不代表已读取 iOS 字段值
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const {NOW, headers, response, fixture} = require("./auth-fixture.cjs");
const RPC = "https://guoguouser.cainiao.com/com.cainiao.guoguo.guoguouser.widget.WidgetLogisticsService/1.0.0/queryWidgetDetailsV2";
const ARG = "com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest", API = "mtop.cainiao.guoguo.widget.token.get.cn";
const UID = "900000000000001101", OTHER_UID = "900000000000001102", TOKEN = "synthetic-observed-time-token", NEXT = "synthetic-next-time-token";
const FRACTIONS = [1780000000123.375, 1780000000.375];
let core, official, runtime, network = 0, clock = () => NOW;

before(async () => {
    const deny = () => {network++; throw new Error("捕获时间回归禁止真实网络");};
    for (const name of ["node:http", "node:https"]) for (const method of ["get", "request"]) mock.method(require(name), method, deny);
    mock.method(require("node:net").Socket.prototype, "connect", deny); mock.method(require("node:tls"), "connect", deny);
    if (typeof globalThis.fetch === "function") mock.method(globalThis, "fetch", deny);
    mock.method(Date, "now", () => clock());
    core = await import("../core.mjs"); official = await import("../official.mjs"); runtime = await import("../runtime.mjs");
});
after(() => {mock.restoreAll(); assert.equal(network, 0);});

function setup() {
    const f = fixture(); clock = f.clock; f.ctx.env.CONNECTION_MODE = "auto";
    f.ctx.http.post = async (url, options) => {f.requests.push({url, options}); const reply = f.replies.shift(); if (!reply) throw new Error("合成离线"); return reply;};
    return f;
}
const state = f => f.memory.get(core.CW_OFFICIAL_STORE);
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);
const summary = () => response({success: true, data: {packageInfo: {agentSignPackNum: 1,
    packageItemInfoList: [{logisticsStatus: 900, logisticsStatusSimpleDesc: "合成时间摘要", stationName: "合成驿站"}]}}});
function body(timestamp = FRACTIONS[0], changes = {}) {
    return {argsTypes: [ARG], argsObjs: [{appName: "GUOGUO_APP", source: "synthetic-time-source", channel: "synthetic-time-channel",
        installStatus: JSON.stringify({isLargeInstall: false, isMediumInstall: true, isSmallInstall: false, isNewSmallInstall: false, isLargeV2Install: false}),
        version: 2, ext: '{"apiVersion":"V3"}', token: TOKEN, timestamp, lbs: "synthetic-private-location", ...changes}]};
}
async function capture(f, value = body()) {
    const raw = new TextEncoder().encode(JSON.stringify(value)); let reads = 0;
    const result = await runtime.default({...f.ctx, request: {method: "POST", url: RPC,
        headers: headers([["Content-Type", "application/json"], ["Http-Rpc-Type", "JsonContent"]]),
        arrayBuffer: async () => {reads++; return raw.slice().buffer;}, text: () => {throw new Error("不得重复读体");}}});
    assert.equal(reads, 1); assert.deepEqual(Object.keys(result), ["body"]); assert.deepEqual([...result.body], [...raw]);
}
async function legacy(f) {
    await runtime.default(f.incoming("", "https://acs.m.taobao.com/gw/mtop.synthetic.account.query/*/", [["x-uid", UID], ["x-sid", "synthetic-time-session"]]));
    assert.equal(f.memory.get(core.CW_STORE).blocked, true); assert.equal(state(f), undefined);
}

test("捕获时间允许合成小数毫秒/秒及有限正数边界，解析结果不含原时间", () => {
    for (const timestamp of [...FRACTIONS, 1.5, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER]) {
        const value = body(timestamp), previous = structuredClone(value), parsed = official.cwOfficialTemplate(value);
        assert.equal(parsed.token, TOKEN); assert.equal(Object.hasOwn(parsed.template, "timestamp"), false);
        assert.deepEqual(value, previous); assert(!JSON.stringify(parsed.template).includes(String(timestamp)));
    }
});

test("旧采集屏障后小数时间 RPC 接入，两次独立 POST 均生成新整数毫秒时间而不复用输入", async () => {
    for (const timestamp of FRACTIONS) {
        const f = setup(); await legacy(f); await capture(f, body(timestamp));
        assert.equal(state(f).binding, "bearer"); assert.equal(state(f).status, "pending"); assert.equal(f.requests.length, 0);
        assert.equal(Object.hasOwn(state(f).template, "timestamp"), false); assert.equal(Object.hasOwn(state(f).template, "lbs"), false);
        assert(!JSON.stringify([...f.memory]).includes(String(timestamp)));
        for (let index = 0; index < 2; index++) {f.replies.push(summary()); assert.equal((await load(f)).status, "ready");}
        const times = f.requests.map(row => JSON.parse(row.options.body).argsObjs[0].timestamp);
        assert.deepEqual(times, [NOW, NOW + 1]); assert(times.every(Number.isSafeInteger)); assert.equal(state(f).successCount, 2);
        for (const row of f.requests) {
            assert.equal(row.url, RPC); assert(!row.options.body.includes(String(timestamp))); assert(!row.options.body.includes("synthetic-private-location"));
            assert.equal(JSON.parse(row.options.body).argsObjs[0].token, TOKEN);
        }
        assert(!official.cwOfficialLines(f.ctx, f.clock()).join("\n").includes(String(timestamp)));
    }
});

test("1.3.5 TIMESTAMP unbound 形状只读迁移，不借旧记录放行，新的小数 RPC 才绑定", async () => {
    const f = setup(); await legacy(f); await capture(f, body(0));
    const old = {...structuredClone(state(f)), version: "1.3.5"}; f.memory.set(core.CW_OFFICIAL_STORE, old);
    const previous = structuredClone([...f.memory]), writes = f.writes.length;
    assert.deepEqual(official.cwOfficialState(old, f.clock()).rpcShape, old.rpcShape);
    assert.equal((await load(f)).status, "setup"); assert.deepEqual([...f.memory], previous); assert.equal(f.writes.length, writes); assert.equal(f.requests.length, 0);
    await capture(f); assert.equal(state(f).binding, "bearer"); assert.equal(Object.hasOwn(state(f).rpcShape, "rejectReason"), false);
    assert.equal(state(f).snapshot, null); assert.equal(state(f).successCount, 0); assert.equal(f.requests.length, 0);
});

test("字符串、零、负数、非有限数与超安全上界仍拒绝为 TIMESTAMP，原字节透传且不查询", async () => {
    for (const timestamp of [String(FRACTIONS[0]), 0, -0, -1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, null, true, {}, []]) {
        assert.throws(() => official.cwOfficialTemplate(body(timestamp)), error => error.officialCode === "SCHEMA_INVALID" && error.rejectReason === "TIMESTAMP");
        const f = setup(); await capture(f, body(timestamp)); assert.equal(state(f).binding, "unbound"); assert.equal(state(f).rpcShape.rejectReason, "TIMESTAMP");
        assert.equal(state(f).token, ""); assert.equal((await load(f)).status, "setup"); assert.equal(f.requests.length, 0);
    }
    const value = body(); delete value.argsObjs[0].timestamp;
    assert.throws(() => official.cwOfficialTemplate(value), error => error.rejectReason === "TIMESTAMP");
});

test("捕获时间放宽不改变本机状态、形状观察时间、计数与当前时钟的整数约束", async () => {
    const f = setup(); await capture(f, body(NOW - 1000)); const saved = structuredClone(state(f));
    for (const key of ["at", "tokenCapturedAt", "templateCapturedAt", "lastRequestAt", "lastSuccessAt", "requestCount", "successCount"])
        assert.equal(official.cwOfficialState({...saved, [key]: 1.5}, f.clock()), null, key);
    assert.equal(official.cwOfficialState({...saved, rpcShape: {...saved.rpcShape, at: 1.5}}, f.clock()), null);
    assert.equal(official.cwOfficialState(saved, NOW + 0.5), null);
    f.advance(0.5); let reads = 0;
    assert.equal(await official.captureCainiaoOfficialRequest({...f.ctx, request: {method: "POST", url: RPC, headers: headers(),
        arrayBuffer: async () => {reads++; return new ArrayBuffer(0);}}}, f.clock), undefined);
    assert.equal(reads, 0); assert.deepEqual(state(f), saved); assert.equal(f.requests.length, 0);
});

test("1.3.5 已撤销 bearer 不能因小数时间复活，新 token 仍需全新候选", async () => {
    const f = setup(); await capture(f, body(NOW - 1000));
    await runtime.default(f.incoming("unb=" + UID, "https://acs.m.taobao.com/gw/com.taobao.mtop.mLoginUnitService.logout/*/"));
    const stopped = {...structuredClone(state(f)), version: "1.3.5"}; f.memory.set(core.CW_OFFICIAL_STORE, stopped);
    const fence = structuredClone(f.memory.get(core.CW_STORE)); await capture(f);
    assert.deepEqual(state(f), stopped); assert.deepEqual(f.memory.get(core.CW_STORE), fence); assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
    await capture(f, body(FRACTIONS[1], {token: NEXT})); assert.equal(state(f).status, "pending"); assert.equal(state(f).token, NEXT);
    assert.equal(state(f).snapshot, null); assert.equal(state(f).successCount, 0); assert.equal(f.requests.length, 0);
});

test("小数时间不能绕过已有 UID 签发等待或另一账号 B 的隔离屏障", async () => {
    for (const blocked of [false, true]) {
        const f = setup(); await runtime.default(f.incoming("unb=" + UID, "https://acs.m.taobao.com/gw/" + API + "/*/"));
        assert.equal(state(f).binding, "uid");
        if (blocked) f.memory.set(core.CW_STORE, {version: core.CW_VERSION, owner: core.md5("account:" + OTHER_UID), source: "capture", blocked: true, cookie: "", snapshot: null});
        const previous = structuredClone([...f.memory]); await capture(f); assert.deepEqual([...f.memory], previous);
        assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
    }
});
