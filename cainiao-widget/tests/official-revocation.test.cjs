// 引擎：Node.js 20+ | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs（仅隔离副本）
// 运行：node --test cainiao-widget/tests/official-revocation.test.cjs
// 依赖：本地冻结的原1.3.6实际bundle合成full32 fixture；无原仓库路径、个人数据或网络
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const {NOW, fixture, headers, response} = require("./auth-fixture.cjs");
const FULL32 = require("./fixtures/official-revocation-full32-1.3.6.synthetic.json");
const FROZEN = JSON.stringify(FULL32);
const PREFIX = "cainiao-widget.official.revoked.v1.";
const MARK = "REVOKED_V1";
const A = "synthetic-revocation-A", B = "synthetic-revocation-B", C = "synthetic-revocation-C";
const UID = "900000000000000101", OTHER = "900000000000000102";
let core, official, runtime, network = 0, stopped;
before(async () => {
    const deny = () => {network++; throw new Error("合成撤销回归禁止网络");};
    for (const module of ["node:http", "node:https"]) for (const method of ["get", "request"]) mock.method(require(module), method, deny);
    mock.method(require("node:net").Socket.prototype, "connect", deny);
    mock.method(require("node:tls"), "connect", deny);
    if (typeof globalThis.fetch === "function") mock.method(globalThis, "fetch", deny);
    core = await import("../core.mjs"); official = await import("../official.mjs"); runtime = await import("../runtime.mjs");
    assert.equal(FULL32.schema, "cainiao-official-full32-synthetic-v1"); assert.equal(FULL32.synthetic, true);
    assert.equal(FULL32.source.bundleSha256, "7d800eaed265f5fa2f754ca55456e7ad4eaf57d2e54f824309e9397f1faab5b1");
    assert.equal(FULL32.source.commit, "7e02f0c4dc90ab1145ebf355943de61905b77918");
    assert(official.cwOfficialState(FULL32.state, FULL32.clock));
    assert.equal(FULL32.state.captureResult, "revocation_full"); assert.equal(FULL32.state.retiredTokenHashes.length, 32);
    assert.deepEqual(FULL32.state.retiredTokenHashes, FULL32.barrier.retiredTokenHashes); assert.equal(FULL32.barrier.stopped, true);
    assert.deepEqual(FULL32.state.retiredTokenHashes, Array.from({length: 32}, (_, index) => core.md5("synthetic-legacy-" + index)));
    stopped = [[core.CW_OFFICIAL_STORE, FULL32.state], [core.CW_STORE, FULL32.barrier]];
});
after(() => {mock.restoreAll(); assert.equal(network, 0); assert.equal(JSON.stringify(FULL32), FROZEN);});
const state = f => f.memory.get(core.CW_OFFICIAL_STORE);
const barrier = f => f.memory.get(core.CW_STORE);
const tomb = (f, token) => f.memory.get(PREFIX + core.md5(token));
const summary = () => response({success: true, data: {packageInfo: {agentSignPackNum: 0, packageItemInfoList: []}}});
function setup(copy = false) {
    const f = fixture(); f.ctx.env.CONNECTION_MODE = "auto";
    f.ctx.http.post = async (url, options) => {f.requests.push({url, options}); const reply = f.replies.shift(); if (!reply) throw new Error("合成离线"); return typeof reply === "function" ? reply() : reply;};
    if (copy) {
        for (const [key, value] of stopped) f.memory.set(key, structuredClone(value));
        f.advance(Math.max(0, FULL32.clock - f.clock()) + 1);
    }
    return f;
}
function template(token, changes = {}) {return {argsTypes: ["com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest"], argsObjs: [{
    appName: "GUOGUO_APP", source: "synthetic-source", channel: "synthetic-channel", version: 2,
    installStatus: '{"isLargeInstall":false,"isMediumInstall":true,"isSmallInstall":false,"isNewSmallInstall":false,"isLargeV2Install":false}',
    ext: '{"apiVersion":"V3"}', timestamp: NOW, token, ...changes,
}]};}
function hook(f, token, changes = {}, read) {
    const bytes = new TextEncoder().encode(JSON.stringify(template(token, changes)));
    return {...f.ctx, request: {url: official.CW_OFFICIAL_QUERY_URL, method: "POST", headers: headers([["Content-Type", "application/json"], ["Http-Rpc-Type", "JsonContent"]]),
        arrayBuffer: async () => read ? read(bytes) : bytes.buffer}};
}
async function capture(f, token = A, changes = {}) {f.advance(1); return official.captureCainiaoOfficialRequest(hook(f, token, changes), f.clock);}
function uid(f, api, conflict = false) {return {...f.ctx, request: {url: "https://cn-acs.m.cainiao.com/gw/" + api + "/1.0", method: "GET",
    headers: headers([["Cookie", "unb=" + UID], ["x-uid", conflict ? OTHER : UID]])}};}
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);

test("至少101个正常不同token持续接入，全部100个旧token精确拒绝", async () => {
    const f = setup();
    for (let index = 0; index <= 100; index++) {await capture(f, "synthetic-continuous-" + index); assert.equal(state(f).status, "pending"); assert.equal(barrier(f).stopped, false);}
    const current = structuredClone(state(f)), fence = structuredClone(barrier(f));
    for (let index = 0; index < 100; index++) {assert.equal(tomb(f, "synthetic-continuous-" + index), MARK); await capture(f, "synthetic-continuous-" + index);}
    assert.deepEqual(state(f), current); assert.deepEqual(barrier(f), fence); assert.equal(f.requests.length, 0);
});

test("真实旧32满形状只有新RPC可恢复，旧32全迁移回读，不继承凭据摘要或确认", async () => {
    const f = setup(true), old = structuredClone(state(f)), oldFence = structuredClone(barrier(f));
    for (let index = 0; index < 2; index++) {assert.notEqual((await load(f)).status, "ready"); assert.deepEqual(state(f), old);}
    assert.deepEqual(barrier(f), oldFence); assert.equal(f.requests.length, 0);
    await capture(f, "synthetic-new-after-full");
    assert.equal(state(f).status, "pending"); assert.equal(state(f).token, "synthetic-new-after-full"); assert.equal(barrier(f).stopped, false);
    assert.equal(state(f).snapshot, null); assert.equal(state(f).successCount, 0); assert.equal(state(f).lastSuccessAt, null);
    assert.notEqual(state(f).generation, old.generation);
    for (const hash of old.retiredTokenHashes) assert.equal(f.memory.get(PREFIX + hash), MARK);
    for (let index = 0; index < 32; index++) await capture(f, "synthetic-legacy-" + index);
    assert.equal(state(f).token, "synthetic-new-after-full");
    f.replies.push(summary()); assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, 1);
});

test("同token重复和模板变动不追加撤销，自己的新查询不占撤销位", async () => {
    const f = setup(); await capture(f);
    for (let index = 0; index < 100; index++) await capture(f, A, {channel: "synthetic-channel-" + index});
    assert.equal([...f.memory.keys()].filter(key => key.startsWith(PREFIX)).length, 0);
    f.replies.push(summary()); assert.equal((await load(f)).status, "ready");
    assert.equal([...f.memory.keys()].filter(key => key.startsWith(PREFIX)).length, 0);
});

test("旧满形状每个近似门都不允许借容量例外恢复", async () => {
    for (const mutate of [f => {state(f).captureResult = "conflict";}, f => {state(f).status = "signed_out";}, f => {state(f).failure = "SIGNED_OUT";},
        f => {barrier(f).owner = core.md5("synthetic-other-owner");}, f => {barrier(f).version = "unknown";}, f => {barrier(f).extra = true;},
        f => {state(f).retiredTokenHashes.pop();}, f => {barrier(f).retiredTokenHashes.pop();},
        f => {state(f).requestCount = 1;}, f => {state(f).lastRequestAt = f.clock();}]) {
        const f = setup(true); mutate(f); const before = structuredClone(state(f)), fence = structuredClone(barrier(f));
        await capture(f, B); assert.deepEqual(state(f), before); assert.deepEqual(barrier(f), fence); assert.equal(f.requests.length, 0);
    }
});

test("迁移每个旧位的noop/throw中止，已有记录保留，新RPC屏障不允许旧或第三候选", async () => {
    for (const failIndex of [0, 15, 31]) for (const kind of ["noop", "throw"]) {
        const f = setup(true), old = structuredClone(state(f)), write = f.ctx.storage.setJSON;
        let index = 0;
        f.ctx.storage.setJSON = (key, value) => {if (key.startsWith(PREFIX) && index++ === failIndex) {if (kind === "throw") throw new Error("SYNTHETIC_PRIVATE_QUOTA"); return;} write(key, value);};
        await capture(f, B); f.ctx.storage.setJSON = write;
        assert.deepEqual(state(f), old); assert.equal(barrier(f).owner, core.md5("official-bearer:" + core.md5(B)));
        const saved = structuredClone(barrier(f)); await capture(f, C); assert.deepEqual(barrier(f), saved);
        assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
        await capture(f, B); assert.equal(state(f).token, B);
        for (const hash of old.retiredTokenHashes) assert.equal(f.memory.get(PREFIX + hash), MARK);
    }
});

test("logout/身份冲突仍撤销当前，不借满集恢复门复活；正常fresh新token保留原语义", async () => {
    for (const conflict of [false, true]) {
        const f = setup(); for (let index = 0; index < 105; index++) await capture(f, "synthetic-before-stop-" + index);
        const current = state(f).token;
        await official.captureCainiaoOfficialRequest(uid(f, conflict ? "mtop.synthetic.query" : "com.taobao.mtop.mLoginUnitService.logout", conflict), f.clock);
        assert.equal(state(f).status, conflict ? "invalid" : "signed_out"); assert.equal(tomb(f, current), MARK);
        const frozen = structuredClone(state(f)); await capture(f, current); assert.deepEqual(state(f), frozen);
        assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
        await capture(f, B); assert.equal(state(f).token, B); assert.equal(state(f).snapshot, null);
    }
});

test("归档当前token失败时B屏障先落地，A零查询，B可重试但C不能越过", async () => {
    for (const kind of ["noop", "throw"]) {
        const f = setup(); await capture(f); const write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {if (key === PREFIX + core.md5(A)) {if (kind === "throw") throw new Error("SYNTHETIC_PRIVATE_WRITE"); return;} write(key, value);};
        await capture(f, B); f.ctx.storage.setJSON = write;
        assert.equal(state(f).token, A); assert.equal(barrier(f).owner, core.md5("official-bearer:" + core.md5(B)));
        assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
        await capture(f, C); assert.equal(state(f).token, A); await capture(f, B); assert.equal(state(f).token, B); assert.equal(tomb(f, A), MARK);
    }
});

test("墓碑损坏或读取异常固定失败，不能接受候选或查询当前已撤销token", async () => {
    for (const kind of ["poison", "throw"]) {
        const f = setup(); await capture(f); const get = f.ctx.storage.getJSON;
        if (kind === "poison") f.memory.set(PREFIX + core.md5(B), "SYNTHETIC_PRIVATE_POISON");
        else f.ctx.storage.getJSON = key => {if (key === PREFIX + core.md5(B)) throw new Error("SYNTHETIC_PRIVATE_READ"); return get(key);};
        const old = structuredClone(state(f)); await capture(f, B); assert.deepEqual(state(f), old);
        f.ctx.storage.getJSON = get;
        f.memory.set(PREFIX + core.md5(A), MARK); assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
    }
});

test("异步旧A正文晚于新B仍透传但不回写，归档不减弱原代次guard", async () => {
    const f = setup(); await capture(f);
    let release, entered; const ready = new Promise(resolve => {entered = resolve;});
    const delayed = hook(f, B, {}, bytes => {entered(); return new Promise(resolve => {release = () => resolve(bytes.buffer);});});
    const task = official.captureCainiaoOfficialRequest(delayed, f.clock); await ready;
    await capture(f, C); const old = structuredClone(state(f)); release(); const result = await task;
    assert(result.body instanceof Uint8Array); assert.deepEqual(state(f), old); assert.equal(state(f).token, C); assert.equal(tomb(f, A), MARK);
});

test("墓碑写入期间同步重入logout先撤销，外层候选不越过新终止", async () => {
    const f = setup(); await capture(f); const write = f.ctx.storage.setJSON; let invoked = false;
    f.ctx.storage.setJSON = (key, value) => {
        write(key, value);
        if (!invoked && key === PREFIX + core.md5(A)) {invoked = true; void official.captureCainiaoOfficialRequest(uid(f, "com.taobao.mtop.mLoginUnitService.logout"), f.clock);}
    };
    await capture(f, B); f.ctx.storage.setJSON = write;
    assert(invoked); assert.equal(state(f).status, "signed_out"); assert.equal(state(f).token, ""); assert.equal(tomb(f, A), MARK);
});

test("off先归档再清凭据，永久墓碑不删；UID重签不能复活已撤销bearer", async () => {
    const f = setup(); await capture(f); await capture(f, B); f.ctx.env.CONNECTION_MODE = "off"; await load(f);
    assert.equal(state(f), null); assert.equal(tomb(f, A), MARK); assert.equal(tomb(f, B), MARK);
    f.ctx.env.CONNECTION_MODE = "auto";
    const request = uid(f, official.CW_OFFICIAL_TOKEN_API); await official.captureCainiaoOfficialRequest(request, f.clock);
    const bytes = new TextEncoder().encode(JSON.stringify({ret: ["SUCCESS"], data: {result: A}}));
    await official.captureCainiaoOfficialResponse({...request, response: {status: 200, headers: headers(), arrayBuffer: async () => bytes.buffer}}, f.clock);
    assert.notEqual(state(f)?.token, A); assert.equal(tomb(f, A), MARK); assert.equal(f.requests.length, 0);
});

test("off归档失败不清原状态，保留屏障和所有已落地撤销记录", async () => {
    const f = setup(); await capture(f); const old = structuredClone(state(f)), write = f.ctx.storage.setJSON;
    f.ctx.storage.setJSON = (key, value) => {if (key.startsWith(PREFIX)) return; write(key, value);};
    f.ctx.env.CONNECTION_MODE = "off"; const result = await load(f); assert.match(result.message, /未确认/); assert.deepEqual(state(f), old);
});

test("logout或冲突归档失败保留stopped屏障，旧ready与其它新RPC均不被接纳", async () => {
    for (const conflict of [false, true]) for (const kind of ["noop", "throw"]) {
        const f = setup(); await capture(f); f.replies.push(summary()); assert.equal((await load(f)).status, "ready");
        const old = structuredClone(state(f)), write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {if (key === PREFIX + core.md5(A)) {if (kind === "throw") throw new Error("SYNTHETIC_PRIVATE_STOP_WRITE"); return;} write(key, value);};
        const request = uid(f, conflict ? "mtop.synthetic.query" : "com.taobao.mtop.mLoginUnitService.logout", conflict);
        await official.captureCainiaoOfficialRequest(request, f.clock); f.ctx.storage.setJSON = write;
        assert.deepEqual(state(f), old); assert.equal(barrier(f).stopped, true);
        assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 1);
        await capture(f, B); assert.deepEqual(state(f), old);
        await official.captureCainiaoOfficialRequest(request, f.clock);
        assert.equal(state(f).status, conflict ? "invalid" : "signed_out"); assert.equal(tomb(f, A), MARK);
        await capture(f, B); assert.equal(state(f).token, B);
    }
});

test("真实旧full之后的新logout或冲突归档失败，不再借revocation_full恢复门放行", async () => {
    for (const conflict of [false, true]) for (const kind of ["noop", "throw"]) {
        const f = setup(true), old = structuredClone(state(f)), write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {if (key === PREFIX + old.retiredTokenHashes[0]) {if (kind === "throw") throw new Error("SYNTHETIC_PRIVATE_FULL_STOP"); return;} write(key, value);};
        const request = uid(f, conflict ? "mtop.synthetic.query" : "com.taobao.mtop.mLoginUnitService.logout", conflict);
        await official.captureCainiaoOfficialRequest(request, f.clock); f.ctx.storage.setJSON = write;
        assert.deepEqual(state(f), old); assert.equal(barrier(f).stopped, true);
        const fence = structuredClone(barrier(f)); await capture(f, B);
        assert.deepEqual(state(f), old); assert.deepEqual(barrier(f), fence);
        assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
        await official.captureCainiaoOfficialRequest(request, f.clock);
        assert.equal(state(f).status, conflict ? "invalid" : "signed_out");
        for (const hash of old.retiredTokenHashes) assert.equal(f.memory.get(PREFIX + hash), MARK);
        await capture(f, B); assert.equal(state(f).token, B);
    }
});
