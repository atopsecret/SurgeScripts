// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --test cainiao-widget/tests/official-legacy-handoff.test.cjs
// 依赖：auth-fixture.cjs；仅合成凭据和正文，不代表已经取得 iOS 正文
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const {NOW, headers, response, fixture} = require("./auth-fixture.cjs");
const RPC = "https://guoguouser.cainiao.com/com.cainiao.guoguo.guoguouser.widget.WidgetLogisticsService/1.0.0/queryWidgetDetailsV2";
const APP = "https://acs.m.taobao.com/gw/mtop.synthetic.account.query/*/";
const API = "mtop.cainiao.guoguo.widget.token.get.cn", ARG = "com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest";
const UID = "900000000000000801", OTHER_UID = "900000000000000802";
const TOKEN = "synthetic-legacy-handoff-token", SESSION = "synthetic-legacy-handoff-session";
let core, runtime, official, clock = () => NOW, network = 0;

before(async () => {
    const deny = () => {network++; throw new Error("迁移回归禁止真实网络");};
    for (const name of ["node:http", "node:https"]) for (const method of ["get", "request"]) mock.method(require(name), method, deny);
    mock.method(require("node:net").Socket.prototype, "connect", deny); mock.method(require("node:tls"), "connect", deny);
    if (typeof globalThis.fetch === "function") mock.method(globalThis, "fetch", deny);
    mock.method(Date, "now", () => clock());
    core = await import("../core.mjs"); runtime = await import("../runtime.mjs"); official = await import("../official.mjs");
});
after(() => {mock.restoreAll(); assert.equal(network, 0);});

function setup() {
    const f = fixture(); clock = f.clock; f.ctx.env.CONNECTION_MODE = "auto";
    f.ctx.http.post = async (url, options) => {
        f.requests.push({method: "POST", url, options}); const reply = f.replies.shift();
        if (typeof reply === "function") return reply(); if (reply instanceof Error) throw reply;
        if (!reply) throw new Error("合成离线"); return reply;
    };
    return f;
}
const state = f => f.memory.get(core.CW_OFFICIAL_STORE);
const barrier = f => f.memory.get(core.CW_STORE);
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);
const summary = () => response({success: true, data: {packageInfo: {agentSignPackNum: 1,
    packageItemInfoList: [{logisticsStatus: 900, logisticsStatusSimpleDesc: "合成新迁移摘要", stationName: "合成驿站"}]}}});
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
function template(changes = {}) {
    return {argsTypes: [ARG], argsObjs: [{appName: "GUOGUO_APP", source: "synthetic-observed-source", channel: "synthetic-channel", brand: "synthetic-brand",
        version: 2, ext: '{"apiVersion":"V3"}', token: TOKEN, timestamp: NOW - 1000,
        installStatus: JSON.stringify({isLargeInstall: false, isMediumInstall: true, isSmallInstall: false, isNewSmallInstall: false, isLargeV2Install: false}), ...changes}]};
}
async function legacy(f, kind = "native") {
    if (kind === "complete_switch") {
        await runtime.default(f.incoming("unb=" + OTHER_UID + "; cookie2=synthetic-old-session", APP));
        await runtime.default(f.incoming("unb=" + UID + "; cookie2=" + SESSION, APP));
    } else {
        const cookie = kind === "cookie_candidate" ? "cookie2=" + SESSION : "";
        await runtime.default(f.incoming(cookie, APP, [["x-uid", UID], ...(kind === "native" ? [["x-sid", SESSION]] : [])]));
    }
    assert.equal(state(f), undefined); assert.equal(barrier(f).blocked, true); assert.equal(f.memory.get(core.CW_AUTH_STORE).status, "pending");
    assert.deepEqual(Object.keys(barrier(f)).sort(), ["version", "owner", "source", "blocked", "cookie", "snapshot"].sort());
}
function rpc(f, body = template(), read = null) {
    const raw = new TextEncoder().encode(JSON.stringify(body)), hook = {raw, reads: 0};
    hook.ctx = {...f.ctx, request: {method: "POST", url: RPC, headers: headers([["Content-Type", "application/json"], ["Http-Rpc-Type", "JsonContent"]]),
        arrayBuffer: async () => {hook.reads++; return read ? read(raw) : raw.slice().buffer;}}};
    return hook;
}
async function capture(f, body = template(), read = null) {
    const hook = rpc(f, body, read), result = await runtime.default(hook.ctx);
    assert.equal(hook.reads, 1); assert.deepEqual(Object.keys(result || {}), ["body"]); assert.deepEqual([...result.body], [...hook.raw]); return hook;
}

test("真实默认入口旧 native/受限 Cookie/完整 Cookie 换号捕获后，合法 RPC 首次迁移并独立查询两次", async () => {
    for (const kind of ["native", "cookie_candidate", "complete_switch"]) {
        const f = setup(); await legacy(f, kind); const oldAuth = structuredClone(f.memory.get(core.CW_AUTH_STORE));
        await capture(f); assert.equal(state(f)?.binding, "bearer"); assert.equal(state(f).status, "pending");
        assert.equal(state(f).snapshot, null); assert.equal(state(f).successCount, 0); assert.equal(state(f).lastSuccessAt, null);
        assert.equal(barrier(f).officialBinding, "bearer"); assert.equal(barrier(f).owner, state(f).owner);
        assert.deepEqual(f.memory.get(core.CW_AUTH_STORE), oldAuth); assert.equal(f.requests.length, 0);
        for (let i = 0; i < 2; i++) {f.replies.push(summary()); await runtime.default(f.ctx); f.advance(1000);}
        assert.equal(state(f).status, "ready"); assert.equal(state(f).successCount, 2); assert.equal(f.requests.length, 2);
        const times = f.requests.map(row => JSON.parse(row.options.body).argsObjs[0].timestamp); assert(times[1] > times[0]);
        for (const row of f.requests) {assert.equal(row.method, "POST"); assert.equal(row.url, RPC); assert(!JSON.stringify(row).includes(UID)); assert(!JSON.stringify(row).includes(SESSION));}
    }
});

test("旧 H5 屏障下未知 RPC 仅保留固定 shape，屏障逐字不变且等待合同零查询；后续合法 RPC 可迁移", async () => {
    const f = setup(); await legacy(f); const previous = JSON.stringify(barrier(f)), oldAuth = structuredClone(f.memory.get(core.CW_AUTH_STORE));
    await capture(f, template({version: "synthetic-private-version", syntheticUnknown: "synthetic-private-value"}));
    assert.equal(state(f)?.binding, "unbound"); assert.equal(state(f).token, ""); assert.equal(state(f).snapshot, null);
    assert.equal(JSON.stringify(barrier(f)), previous); assert.deepEqual(f.memory.get(core.CW_AUTH_STORE), oldAuth);
    const model = await load(f); assert.equal(model.status, "setup"); assert.match(model.message, /正文合同尚未接受/); assert.equal(f.requests.length, 0);
    const lines = official.cwOfficialLines(f.ctx, f.clock()).join("\n"); assert.match(lines, /屏障/); assert.match(lines, /RPC/); assert.match(lines, /version 类型=string/);
    for (const secret of [TOKEN, "synthetic-private", "syntheticUnknown"]) assert(!JSON.stringify([state(f), lines]).includes(secret));
    await capture(f); assert.equal(state(f).binding, "bearer"); assert.equal(state(f).status, "pending");
});

test("首次迁移只接受六键已知版本旧 capture 屏障，未知或冲突占位不能例外", async () => {
    const changes = [value => ({...value, extra: true}), value => ({...value, version: "99.0.0"}), value => ({...value, source: "unknown"}),
        value => ({...value, owner: core.md5("capture-conflicting-identities")}), value => ({...value, cookie: "synthetic-private-cookie"}),
        value => ({...value, snapshot: {items: []}}), value => {const copy = {...value}; delete copy.version; return copy;}];
    for (const change of changes) {
        const f = setup(); await legacy(f); f.memory.set(core.CW_STORE, change(barrier(f))); const previous = structuredClone(barrier(f));
        await capture(f, template({version: "unknown"})); await capture(f);
        assert.equal(state(f), undefined); assert.deepEqual(barrier(f), previous); assert.equal(f.requests.length, 0);
    }
});

test("已有官方 UID 等待/换号/冲突与损坏 raw 不能借旧 H5 首次迁移入口绕过", async () => {
    for (const kind of ["waiting", "switch", "conflict", "damaged"]) {
        const f = setup(); await legacy(f);
        if (kind === "damaged") f.memory.set(core.CW_OFFICIAL_STORE, {version: core.CW_VERSION, invalid: true});
        else {
            const request = f.incoming("unb=" + UID + "; cookie2=" + SESSION, "https://acs.m.taobao.com/gw/" + API + "/*/", [["x-uid", UID]]);
            await runtime.default(request); assert.equal(state(f).binding, "uid");
            if (kind === "switch") f.memory.set(core.CW_STORE, {...barrier(f), owner: core.md5("account:" + OTHER_UID)});
            if (kind === "conflict") await runtime.default(f.incoming("unb=" + UID, APP, [["x-uid", OTHER_UID]]));
        }
        const previous = structuredClone(state(f)), fence = structuredClone(barrier(f));
        for (const body of [template({version: "unknown"}), template()]) {
            const hook = rpc(f, body), result = await runtime.default(hook.ctx);
            if (hook.reads) assert.deepEqual([...result.body], [...hook.raw]);
            else assert.equal(result, undefined, "明确冲突允许在读取正文前停止");
        }
        assert.deepEqual(state(f), previous); assert.deepEqual(barrier(f), fence); assert.equal(f.requests.length, 0);
    }
});

test("迁移后 bearer 已撤销/停止或只有 bearer 屏障时，不被 legacy 例外复活", async () => {
    for (const kind of ["revoked", "stopped", "missing_state"]) {
        const f = setup(); await capture(f); const hash = core.md5(TOKEN);
        f.memory.set(core.CW_STORE, {...barrier(f), retiredTokenHashes: [hash], stopped: kind === "stopped"});
        if (kind === "missing_state") f.memory.delete(core.CW_OFFICIAL_STORE);
        const previous = structuredClone(state(f)), fence = structuredClone(barrier(f));
        await capture(f, template({version: "unknown"})); await capture(f);
        assert.deepEqual(state(f), previous); assert.deepEqual(barrier(f), fence);
        const model = await load(f); assert.notEqual(model.status, "ready"); assert.equal(f.requests.length, 0);
    }
});

test("旧 H5 查询在途时合法 RPC 接管，旧响应不恢复旧缓存或覆写新会话", {timeout: 3000}, async () => {
    const f = setup(); await legacy(f); const entered = deferred(), release = deferred();
    f.replies.push(() => {entered.resolve(); return release.promise;}); const task = load(f); await entered.promise;
    f.advance(1); await capture(f); assert.equal(state(f)?.binding, "bearer"); const previous = structuredClone(state(f)), fence = structuredClone(barrier(f));
    release.resolve(response({ret: ["SUCCESS"], data: {userId: UID}})); const old = await task;
    assert.notEqual(old.status, "ready"); assert.deepEqual(state(f), previous); assert.deepEqual(barrier(f), fence);
    assert.equal(f.requests.length, 1); assert.equal(state(f).successCount, 0);
});

test("legacy 迁移屏障或状态写入 noop/throw 时保持 fail-closed，同 token 可完成保存", async () => {
    for (const target of ["barrier", "state"]) for (const failure of ["noop", "throw"]) {
        const f = setup(); await legacy(f); const previous = structuredClone(barrier(f)), write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {
            if (target === "barrier" && key === core.CW_STORE && value?.officialBinding === "bearer"
                || target === "state" && key === core.CW_OFFICIAL_STORE && value?.binding === "bearer") {
                if (failure === "throw") throw new Error("synthetic-private-handoff-write"); return;
            }
            write(key, value);
        };
        await capture(f); f.ctx.storage.setJSON = write; assert.equal(state(f), undefined); assert.equal(f.requests.length, 0);
        if (target === "barrier") assert.deepEqual(barrier(f), previous);
        else {assert.equal(barrier(f).officialBinding, "bearer"); assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);}
        await capture(f); assert.equal(state(f)?.binding, "bearer"); assert.equal(state(f).snapshot, null);
        assert(!JSON.stringify([...f.memory]).includes("synthetic-private-handoff-write"));
    }
});

test("legacy RPC 读体期间账号屏障或官方状态变化，迟到正文原样透传但不得迁移", {timeout: 3000}, async () => {
    for (const change of ["barrier", "official"]) {
        const f = setup(); await legacy(f); const entered = deferred(), release = deferred();
        const hook = rpc(f, template(), raw => {entered.resolve(); return release.promise.then(() => raw.slice().buffer);});
        const task = runtime.default(hook.ctx); await entered.promise;
        if (change === "barrier") f.memory.set(core.CW_STORE, {...barrier(f), owner: core.md5("account:" + OTHER_UID)});
        else f.memory.set(core.CW_OFFICIAL_STORE, {version: core.CW_VERSION, invalid: true});
        const previous = structuredClone(state(f)), fence = structuredClone(barrier(f)); release.resolve(); const result = await task;
        assert.deepEqual([...result.body], [...hook.raw]); assert.deepEqual(state(f), previous); assert.deepEqual(barrier(f), fence); assert.equal(f.requests.length, 0);
    }
});

test("1.3.1 bearer/unbound/终止状态迁移保留归属、形状和撤销记录，不因升级复活", async () => {
    for (const kind of ["active", "unbound", "terminal"]) {
        const f = setup(); await capture(f, kind === "unbound" ? template({version: "unknown"}) : template());
        if (kind === "terminal") {
            await runtime.default(f.incoming("unb=" + UID, "https://acs.m.taobao.com/gw/com.taobao.mtop.mLoginUnitService.logout/*/"));
            assert.equal(state(f).status, "signed_out");
        }
        const old = {...structuredClone(state(f)), version: "1.3.1"}; f.memory.set(core.CW_OFFICIAL_STORE, old);
        const parsed = official.cwOfficialState(old, f.clock()); assert(parsed); assert.equal(parsed.version, core.CW_VERSION);
        for (const key of ["binding", "owner", "generation", "tokenHash", "rpcShape", "retiredTokenHashes", "status"])
            assert.deepEqual(parsed[key], old[key]);
        assert.deepEqual(state(f), old, "只读迁移不写状态");
        if (kind === "terminal") {await capture(f); assert.deepEqual(state(f), old); assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);}
    }
});
