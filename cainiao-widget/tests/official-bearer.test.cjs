// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --test cainiao-widget/tests/official-bearer.test.cjs
// 依赖：auth-fixture.cjs；下列请求形状全部合成，不代表已取得 iOS 正文
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const {NOW, headers, response, fixture} = require("./auth-fixture.cjs");

const URL = "https://guoguouser.cainiao.com/com.cainiao.guoguo.guoguouser.widget.WidgetLogisticsService/1.0.0/queryWidgetDetailsV2";
const ARG = "com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest";
const API = "mtop.cainiao.guoguo.widget.token.get.cn";
const A = "synthetic-rpc-bearer-token-A", B = "synthetic-rpc-bearer-token-B";
const UID = "900000000000000701", UID_B = "900000000000000702";
let core, official, runtime, network = 0;

before(async () => {
    const deny = () => {network++; throw new Error("合成 bearer 回归禁止真实网络");};
    for (const name of ["node:http", "node:https"]) for (const method of ["get", "request"])
        mock.method(require(name), method, deny);
    mock.method(require("node:net").Socket.prototype, "connect", deny);
    mock.method(require("node:tls"), "connect", deny);
    if (typeof globalThis.fetch === "function") mock.method(globalThis, "fetch", deny);
    core = await import("../core.mjs"); official = await import("../official.mjs"); runtime = await import("../runtime.mjs");
});
after(() => {mock.restoreAll(); assert.equal(network, 0);});

function template(token = A, changes = {}) {
    return {argsTypes: [ARG], argsObjs: [{appName: "GUOGUO_APP", source: "synthetic-observed-source",
        channel: "synthetic-channel", brand: "synthetic-brand", version: 2, ext: '{"apiVersion":"V3"}',
        installStatus: JSON.stringify({isLargeInstall: false, isMediumInstall: true, isSmallInstall: false,
            isNewSmallInstall: false, isLargeV2Install: false}), token, timestamp: NOW - 60000, ...changes}]};
}
const summary = (label = "合成 bearer 摘要", total = 1) => response({success: true, data: {packageInfo: {
    agentSignPackNum: total, packageItemInfoList: [{logisticsStatus: 900, logisticsStatusSimpleDesc: label, stationName: "合成驿站"}],
}}});
const state = f => f.memory.get(core.CW_OFFICIAL_STORE);
const barrier = f => f.memory.get(core.CW_STORE);
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};

function setup() {
    const f = fixture(); f.ctx.env.CONNECTION_MODE = "auto";
    f.ctx.http.post = async (url, options) => {
        f.requests.push({url, options}); const reply = f.replies.shift();
        if (typeof reply === "function") return reply();
        if (reply instanceof Error) throw reply;
        if (!reply) throw new Error("synthetic-bearer-offline");
        return reply;
    };
    return f;
}
function rpc(f, body = template(), extra = [], read = null) {
    const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body));
    const ctx = {...f.ctx, request: {url: URL, method: "POST", headers: headers([
        ["Content-Type", "application/json"], ["Http-Rpc-Type", "JsonContent"], ...extra]),
        arrayBuffer: async () => {result.reads++; return read ? read(bytes) : bytes.slice().buffer;},
        text: () => {throw new Error("不能读取第二份正文");}}};
    const result = {ctx, bytes, reads: 0}; return result;
}
async function capture(f, token = A, changes = {}) {
    const hook = rpc(f, template(token, changes)); const result = await official.captureCainiaoOfficialRequest(hook.ctx, f.clock);
    assertPassthrough(result, hook); return hook;
}
function assertPassthrough(result, hook) {
    assert.equal(hook.reads, 1); assert.deepEqual(Object.keys(result || {}), ["body"]);
    assert.deepEqual([...result.body], [...hook.bytes]);
}
async function connect(f, token = A) {
    await capture(f, token); f.replies.push(summary()); const model = await load(f);
    assert.equal(model.status, "ready"); return model;
}
function uidRequest(f, uid = UID, api = "mtop.synthetic.account.query") {
    return {...f.ctx, request: {url: "https://acs.m.taobao.com/gw/" + api + "/*/?t=" + f.clock(), method: "GET",
        headers: headers([["x-uid", uid], ["Cookie", "unb=" + uid + "; cookie2=synthetic-not-bearer"]]),
        arrayBuffer: () => {throw new Error("普通 MTOP 不得读体");}}};
}

test("合成 RPC-only：无状态无 UID 首次捕获 pending，关闭 App 后两次新 POST 才累计确认", async () => {
    const f = setup(); await capture(f);
    assert.equal(state(f)?.binding, "bearer"); assert.equal(state(f).status, "pending");
    assert.equal(state(f).snapshot, null); assert.equal(state(f).successCount, 0); assert.equal(f.requests.length, 0);
    assert.equal(state(f).token, A); assert.equal(state(f).owner, core.md5("official-bearer:" + core.md5(A)));
    for (let i = 0; i < 2; i++) {f.replies.push(summary("合成新查询" + i)); assert.equal((await load(f)).status, "ready"); f.advance(1000);}
    assert.equal(state(f).requestCount, 2); assert.equal(state(f).successCount, 2); assert.equal(f.requests.length, 2);
    const times = f.requests.map(row => JSON.parse(row.options.body).argsObjs[0].timestamp);
    assert(times[0] > NOW - 60000); assert(times[1] > times[0]);
    for (const {url, options} of f.requests) {
        assert.equal(url, URL); assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "manual");
        assert.equal(options.insecureTls, false); assert.deepEqual(Object.keys(options.headers).sort(), ["Content-Type", "Http-Rpc-Type", core.CW_SELF_HEADER].sort());
        assert.equal(JSON.parse(options.body).argsObjs[0].token, A);
    }
});

test("合成 RPC-only：无签发候选不借旧 H5 的 UID、Cookie、缓存或成功证明", async () => {
    const f = setup(); f.memory.set(core.CW_STORE, {owner: core.md5("account:" + UID), snapshot: {items: [{summary: "synthetic-old-h5-private"}]}});
    await capture(f); assert.equal(state(f)?.binding, "bearer"); assert.equal(state(f).snapshot, null);
    assert(!JSON.stringify(state(f)).includes(UID)); assert(!JSON.stringify(state(f)).includes("synthetic-old-h5-private"));
    f.replies.push(summary()); assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, 1);
});

test("合成 bearer：同 token 重复保留代次和旧确认，不刷新快照时间", async () => {
    const f = setup(); await connect(f); const previous = structuredClone(state(f)); f.advance(1000); await capture(f);
    assert.deepEqual(state(f), previous);
});

test("合成 bearer：INVALID_TOKEN 后同 token RPC 不复活，新 token 不带旧摘要和确认", async () => {
    const f = setup(); await connect(f); const generation = state(f).generation;
    f.replies.push(response({success: true, data: {status: "INVALID_TOKEN"}})); await load(f);
    assert.equal(state(f).status, "expired"); const expired = structuredClone(state(f)); await capture(f);
    assert.deepEqual(state(f), expired); const count = f.requests.length; assert.equal((await load(f)).status, "expired"); assert.equal(f.requests.length, count);
    f.advance(1); await capture(f, B); assert.equal(state(f).status, "pending"); assert.notEqual(state(f).generation, generation);
    assert.equal(state(f).snapshot, null); assert.equal(state(f).successCount, 0); assert.equal(state(f).lastSuccessAt, null);
    assert.equal(state(f).requestCount, 0); assert.equal(state(f).token, B);
});

test("合成 bearer：A→B 后旧 A RPC 倒灌不得恢复会话或撤销屏障", async () => {
    const f = setup(); await connect(f); f.advance(1); await capture(f, B);
    const next = structuredClone(state(f)), fence = structuredClone(barrier(f)); f.advance(1); await capture(f, A);
    assert.deepEqual(state(f), next); assert.deepEqual(barrier(f), fence); assert.equal(state(f).token, B);
    assert(state(f).retiredTokenHashes.includes(core.md5(A)));
});

test("合成 bearer：B 状态写入 noop/throw 后保留 B 屏障，A 不能查询或恢复，B 可重捕获", async () => {
    for (const failure of ["noop", "throw"]) {
        const f = setup(); await connect(f); const previous = structuredClone(state(f)), write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {
            if (key === core.CW_OFFICIAL_STORE && value?.token === B) {if (failure === "throw") throw new Error("synthetic-B-private-write-error"); return;}
            write(key, value);
        };
        await capture(f, B); f.ctx.storage.setJSON = write;
        assert.deepEqual(state(f), previous); assert.equal(barrier(f).owner, core.md5("official-bearer:" + core.md5(B)));
        const fence = structuredClone(barrier(f)), count = f.requests.length; await capture(f, A);
        assert.deepEqual(barrier(f), fence); assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, count);
        await capture(f, B); assert.equal(state(f).token, B); assert.equal(state(f).snapshot, null);
        assert(!JSON.stringify([...f.memory]).includes("synthetic-B-private-write-error"));
    }
});

test("合成 bearer：RPC A 异步读体晚于 B 捕获时原样透传，不覆盖 B", {timeout: 3000}, async () => {
    const f = setup(), entered = deferred(), release = deferred();
    const hook = rpc(f, template(A), [], bytes => {entered.resolve(); return release.promise.then(() => bytes.slice().buffer);});
    const task = official.captureCainiaoOfficialRequest(hook.ctx, f.clock); await entered.promise;
    f.advance(1); await capture(f, B); const previous = structuredClone(state(f)); release.resolve();
    assertPassthrough(await task, hook); assert.deepEqual(state(f), previous); assert.equal(state(f).token, B);
});

test("合成 bearer：A 新查询在途时 B 接管，迟到 A 成功不得输出或存入 B", {timeout: 3000}, async () => {
    const f = setup(); await capture(f); assert.equal(state(f)?.status, "pending"); const entered = deferred(), release = deferred();
    f.replies.push(() => {entered.resolve(); return release.promise;}); const task = load(f); await entered.promise;
    f.advance(1); await capture(f, B); f.replies.push(summary("合成 B 新摘要")); assert.equal((await load(f)).status, "ready");
    const current = structuredClone(state(f)); release.resolve(summary("synthetic-late-A-private")); const old = await task;
    assert.notEqual(old.status, "ready"); assert.deepEqual(state(f), current); assert(!JSON.stringify(old).includes("synthetic-late-A-private"));
});

test("合成 bearer：旧 UID 签发响应不得覆盖后到的 RPC bearer B", async () => {
    const f = setup(), request = uidRequest(f, UID, API); await official.captureCainiaoOfficialRequest(request, f.clock);
    // 新分支仅从无状态开始；模拟模块启用时没有保留旧签发票据，但旧响应仍在途。
    f.memory.delete(core.CW_OFFICIAL_STORE); f.advance(1); await capture(f, B); const previous = structuredClone(state(f));
    const raw = new TextEncoder().encode(JSON.stringify({ret: ["SUCCESS"], data: {result: A}}));
    const result = await official.captureCainiaoOfficialResponse({...request, response: {status: 200, headers: headers([["Content-Type", "application/json"]]), arrayBuffer: async () => raw}}, f.clock);
    assert.deepEqual([...result.body], [...raw]); assert.deepEqual(state(f), previous);
});

test("合成 bearer：普通 MTOP UID 不与 token owner 混比，也不补成 UID 已确认", async () => {
    const f = setup(); await connect(f); const previous = structuredClone(state(f));
    for (const uid of [UID, UID_B]) {await official.captureCainiaoOfficialRequest(uidRequest(f, uid), f.clock); assert.deepEqual(state(f), previous);}
    assert.equal(state(f).binding, "bearer"); assert(!JSON.stringify(state(f)).includes(UID));
    const lines = official.cwOfficialLines(f.ctx, f.clock()).join("\n"); assert.match(lines, /凭据会话/); assert.match(lines, /UID.*未确认/);
});

test("合成 bearer：明确 logout 与同次身份冲突停止会话且同 token 不复活", async () => {
    for (const action of ["logout", "conflict"]) {
        const f = setup(); await connect(f); const count = f.requests.length;
        const request = uidRequest(f, UID, action === "logout" ? "com.taobao.mtop.mLoginUnitService.logout" : "mtop.synthetic.account.query");
        if (action === "conflict") request.request.headers = headers([["Cookie", "unb=" + UID], ["x-uid", UID_B]]);
        await official.captureCainiaoOfficialRequest(request, f.clock); assert.equal(state(f).token, ""); assert.equal(state(f).snapshot, null);
        assert(["invalid", "signed_out"].includes(state(f).status)); const previous = structuredClone(state(f)); await capture(f);
        assert.deepEqual(state(f), previous); assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, count);
    }
});

test("合成 bearer：manual/off/self 不读体，off 清本组件状态且保留其它键", async () => {
    for (const mode of ["manual", "off", "self"]) {
        const f = setup(); await capture(f); const previous = structuredClone(state(f));
        if (mode !== "self") f.ctx.env.CONNECTION_MODE = mode;
        const hook = rpc(f, template(B), mode === "self" ? [[core.CW_SELF_HEADER, "1"]] : []);
        assert.equal(await official.captureCainiaoOfficialRequest(hook.ctx, f.clock), undefined); assert.equal(hook.reads, 0); assert.deepEqual(state(f), previous);
        if (mode === "off") {f.memory.set("other-app", {kept: true}); await load(f); assert.equal(state(f), null); assert.deepEqual(f.memory.get("other-app"), {kept: true});}
        assert.equal(f.requests.length, 0);
    }
});

test("合成 bearer：未知实际模板保存固定脱敏形状，随后合法 RPC 可接入", async () => {
    const f = setup(), body = template(A, {version: "synthetic-private-version", installStatus: '{"isSmallInstall":"synthetic-private-install","unknown":"private-value"}',
        ext: '{"apiVersion":"synthetic-private-api","extra":"private-value"}', syntheticUnknownPrivateField: "private-value"});
    delete body.argsObjs[0].source; const hook = rpc(f, body);
    assertPassthrough(await official.captureCainiaoOfficialRequest(hook.ctx, f.clock), hook);
    assert.equal(state(f)?.binding, "unbound"); assert.equal(state(f).token, ""); assert.equal(state(f).snapshot, null);
    assert.equal((await load(f)).status, "setup"); assert.equal(f.requests.length, 0);
    const text = JSON.stringify([...f.memory]);
    for (const privateText of [A, "synthetic-private", "syntheticUnknownPrivateField", "private-value"]) assert(!text.includes(privateText));
    const lines = official.cwOfficialLines(f.ctx, f.clock()).join("\n");
    assert.match(lines, /RPC.*已观察/); assert.match(lines, /source/); assert.match(lines, /version.*string/); assert.match(lines, /installStatus/); assert.match(lines, /apiVersion/);
    await capture(f); assert.equal(state(f).binding, "bearer"); f.replies.push(summary()); assert.equal((await load(f)).status, "ready");
});

test("合成 bearer：无效 UTF8/JSON/重复键/压缩/未知字段原字节透传，不保存原文或猜 token", async () => {
    for (const [body, extra] of [[new Uint8Array([255, 0, 254]), []], ['{"argsObjs":[],"argsObjs":[]}', []],
        ["synthetic-private-not-json", []], [template(A, {syntheticUnknownSecret: "synthetic-private-value"}), []],
        [new Uint8Array([31, 139, 8, 0]), [["Content-Encoding", "gzip"]]]]) {
        const f = setup(), hook = rpc(f, body, extra); assertPassthrough(await official.captureCainiaoOfficialRequest(hook.ctx, f.clock), hook);
        assert.equal(state(f)?.binding, "unbound"); assert(!state(f).token); assert.equal(f.requests.length, 0);
        assert(!JSON.stringify([...f.memory]).includes("synthetic-private"));
    }
});

test("合成 bearer：UID 绑定 B 账号屏障未完成时 RPC 不得绕过旧保护", async () => {
    const f = setup(), request = uidRequest(f, UID, API); await official.captureCainiaoOfficialRequest(request, f.clock);
    const previous = structuredClone(state(f)); f.memory.set(core.CW_STORE, {version: core.CW_VERSION,
        owner: core.md5("account:" + UID_B), source: "capture", blocked: true, cookie: "", snapshot: null});
    const fence = structuredClone(barrier(f)); await capture(f, B);
    assert.deepEqual(state(f), previous); assert.deepEqual(barrier(f), fence); assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
});

test("合成 bearer：超过原32容量仍接入，精确永久撤销不允许旧 token 倒灌", async () => {
    const f = setup(); await capture(f);
    for (let i = 0; i < 100; i++) {f.advance(1); await capture(f, "synthetic-bounded-rotation-" + i); assert.equal(state(f).status, "pending");}
    assert.equal(f.memory.get("cainiao-widget.official.revoked.v1." + core.md5(A)), "REVOKED_V1");
    const previous = structuredClone(state(f)), fence = structuredClone(barrier(f));
    await capture(f, A); assert.deepEqual(state(f), previous); assert.deepEqual(barrier(f), fence);
    f.replies.push(summary()); assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, 1);
});

test("合成 bearer：业务失败和未知响应结构不能借 HTTP200 确认成功", async () => {
    for (const reply of [response({success: false, data: {status: "INVALID_TOKEN"}}), response({success: true, data: {}}), new Error("synthetic-private-offline")]) {
        const f = setup(); await capture(f); f.replies.push(reply); assert.notEqual((await load(f)).status, "ready");
        assert.equal(state(f)?.successCount, 0); assert.equal(state(f).snapshot, null); assert.equal(state(f).lastSuccessAt, null);
        assert(!JSON.stringify([...f.memory]).includes("synthetic-private-offline"));
    }
});

test("1.3.0 官方 UID 状态只读迁移；旧终止不因 1.3.1 升级或同 token 模板复活", async () => {
    for (const terminal of [false, true]) {
        const f = setup(), request = uidRequest(f, UID, API); await official.captureCainiaoOfficialRequest(request, f.clock);
        const raw = new TextEncoder().encode(JSON.stringify({ret: ["SUCCESS"], data: {result: A}}));
        await official.captureCainiaoOfficialResponse({...request, response: {status: 200, headers: headers([["Content-Type", "application/json"]]), arrayBuffer: async () => raw}}, f.clock);
        await capture(f); if (terminal) {f.replies.push(response({success: true, data: {status: "INVALID_TOKEN"}})); await load(f);}
        const legacy = {...structuredClone(state(f)), version: "1.3.0"};
        delete legacy.binding; delete legacy.retiredTokenHashes; delete legacy.rpcShape; f.memory.set(core.CW_OFFICIAL_STORE, legacy);
        const read = official.cwOfficialState(legacy, f.clock()); assert.equal(read.version, core.CW_VERSION); assert.equal(read.binding, "uid");
        assert.deepEqual(read.retiredTokenHashes, []); assert.deepEqual(state(f), legacy, "只读解析不写入迁移结果");
        if (terminal) {const count = f.requests.length; await capture(f); assert.equal((await load(f)).status, "expired"); assert.equal(f.requests.length, count);}
        else {f.replies.push(summary()); assert.equal((await load(f)).status, "ready"); assert.equal(state(f).version, core.CW_VERSION); assert.equal(state(f).binding, "uid");}
    }
});

test("合成 bearer：首次新键写失败时即使旧 H5 可用也不得回落查询，屏障仍可由同 token 完成", async () => {
    const f = setup(), write = f.ctx.storage.setJSON;
    f.ctx.storage.setJSON = (key, value) => {if (key !== core.CW_OFFICIAL_STORE) write(key, value);};
    await capture(f, B); f.ctx.storage.setJSON = write;
    assert.equal(state(f), undefined); assert.equal(barrier(f).officialBinding, "bearer");
    assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
    const fence = structuredClone(barrier(f)); await runtime.default(uidRequest(f));
    assert.deepEqual(barrier(f), fence, "旧 H5 捕获不得撤回没有新键的官方屏障");
    await capture(f, B); assert.equal(state(f).binding, "bearer"); assert.equal(state(f).token, B);
});

test("合成 bearer：logout/冲突终止写失败时同 owner 屏障撤销旧 token，新 token 仍可恢复", async () => {
    for (const action of ["logout", "conflict"]) for (const failure of ["noop", "throw"]) {
        const f = setup(); await connect(f, B); const previous = structuredClone(state(f)), write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {
            if (key === core.CW_OFFICIAL_STORE && ["signed_out", "invalid"].includes(value?.status)) {
                if (failure === "throw") throw new Error("synthetic-private-stop-write-failed");
                return;
            }
            write(key, value);
        };
        const request = uidRequest(f, UID, action === "logout" ? "com.taobao.mtop.mLoginUnitService.logout" : "mtop.synthetic.account.query");
        if (action === "conflict") request.request.headers = headers([["Cookie", "unb=" + UID], ["x-uid", UID_B]]);
        await official.captureCainiaoOfficialRequest(request, f.clock); f.ctx.storage.setJSON = write;
        assert.deepEqual(state(f), previous, "失败写入保留旧 ready，屏障必须独立撤销旧 token");
        assert.equal(barrier(f).owner, previous.owner); assert.equal(barrier(f).stopped, false);
        assert(barrier(f).retiredTokenHashes.includes(core.md5(B)));
        const count = f.requests.length; f.replies.push(summary("synthetic-old-revoked-query"));
        const model = await load(f); assert.notEqual(model.status, "ready"); assert.deepEqual(model.items, []);
        assert.equal(f.requests.length, count, "已撤销的同 owner token 不得发送新的查询");
        await capture(f, B); assert.deepEqual(state(f), previous); assert.equal(f.requests.length, count);
        f.replies.length = 0; f.advance(1); await capture(f, A);
        assert.equal(state(f).token, A); assert.equal(state(f).snapshot, null); assert.equal(state(f).successCount, 0);
        f.replies.push(summary("合成撤销后新凭据摘要")); assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, count + 1);
    }
});
