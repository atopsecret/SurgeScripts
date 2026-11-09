// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --test cainiao-widget/tests/official-ios-template.test.cjs
// 依赖：auth-fixture.cjs；仅使用与固定形状一致的合成值，未读取手机凭据或正文
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const {NOW, headers, response, fixture} = require("./auth-fixture.cjs");
const RPC = "https://guoguouser.cainiao.com/com.cainiao.guoguo.guoguouser.widget.WidgetLogisticsService/1.0.0/queryWidgetDetailsV2";
const ARG = "com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest";
const TOKEN = "synthetic-ios-no-brand-token", UID = "900000000000000901", SID = "synthetic-ios-native-session";
let core, official, runtime, clock = () => NOW, network = 0;

before(async () => {
    const deny = () => {network++; throw new Error("iOS 模板回归禁止真实网络");};
    for (const name of ["node:http", "node:https"]) for (const method of ["get", "request"]) mock.method(require(name), method, deny);
    mock.method(require("node:net").Socket.prototype, "connect", deny); mock.method(require("node:tls"), "connect", deny);
    if (typeof globalThis.fetch === "function") mock.method(globalThis, "fetch", deny);
    mock.method(Date, "now", () => clock());
    core = await import("../core.mjs"); official = await import("../official.mjs"); runtime = await import("../runtime.mjs");
});
after(() => {mock.restoreAll(); assert.equal(network, 0);});

function setup() {
    const f = fixture(); clock = f.clock; f.ctx.env.CONNECTION_MODE = "auto";
    f.ctx.http.post = async (url, options) => {
        f.requests.push({url, options}); const reply = f.replies.shift();
        if (!reply) throw new Error("合成离线"); return reply;
    };
    return f;
}
const state = f => f.memory.get(core.CW_OFFICIAL_STORE);
const barrier = f => f.memory.get(core.CW_STORE);
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);
const summary = () => response({success: true, data: {packageInfo: {agentSignPackNum: 1,
    packageItemInfoList: [{logisticsStatus: 900, logisticsStatusSimpleDesc: "合成 iOS 摘要", stationName: "合成驿站"}]}}});
function template(changes = {}) {
    return {argsTypes: [ARG], argsObjs: [{appName: "GUOGUO_APP", source: "synthetic-observed-ios-source", channel: "synthetic-ios-channel",
        version: 2, ext: '{"apiVersion":"V3"}', token: TOKEN, timestamp: NOW - 1000,
        installStatus: JSON.stringify({isLargeInstall: false, isMediumInstall: true, isSmallInstall: false, isNewSmallInstall: false, isLargeV2Install: false}), ...changes}]};
}
async function capture(f, body = template()) {
    const raw = new TextEncoder().encode(JSON.stringify(body)); let reads = 0;
    const result = await runtime.default({...f.ctx, request: {method: "POST", url: RPC,
        headers: headers([["Content-Type", "application/json"], ["Http-Rpc-Type", "JsonContent"]]),
        arrayBuffer: async () => {reads++; return raw.slice().buffer;}}});
    assert.equal(reads, 1); assert.deepEqual([...result.body], [...raw]); assert.deepEqual(Object.keys(result), ["body"]);
}
async function legacy(f) {
    await runtime.default(f.incoming("", "https://acs.m.taobao.com/gw/mtop.synthetic.account.query/*/", [["x-uid", UID], ["x-sid", SID]]));
    assert.equal(barrier(f).blocked, true); assert.equal(state(f), undefined);
}

test("已确认无 brand 的合成 iOS 模板仅保留六个实际业务字段，不补品牌", () => {
    const body = template(), parsed = official.cwOfficialTemplate(body);
    assert.equal(parsed.token, TOKEN); assert.deepEqual(Object.keys(parsed.template).sort(), ["appName", "source", "channel", "installStatus", "version", "ext"].sort());
    assert.equal(Object.hasOwn(parsed.template, "brand"), false); assert.equal(Object.hasOwn(body.argsObjs[0], "brand"), false);
});

test("默认入口 legacy 屏障后无 brand RPC 首次接入，两次独立 POST 均省略 brand", async () => {
    const f = setup(); await legacy(f); await capture(f);
    assert.equal(state(f)?.binding, "bearer"); assert.equal(state(f).status, "pending"); assert.equal(state(f).snapshot, null);
    assert.equal(Object.hasOwn(state(f).template, "brand"), false); assert.equal(f.requests.length, 0);
    for (let i = 0; i < 2; i++) {f.replies.push(summary()); assert.equal((await load(f)).status, "ready"); f.advance(1000);}
    assert.equal(state(f).successCount, 2); assert.equal(f.requests.length, 2);
    const times = [];
    for (const row of f.requests) {
        const object = JSON.parse(row.options.body).argsObjs[0]; times.push(object.timestamp);
        assert.equal(row.url, RPC); assert.equal(Object.hasOwn(object, "brand"), false); assert.equal(object.source, template().argsObjs[0].source);
        assert.equal(object.token, TOKEN); assert(!JSON.stringify(row).includes(UID)); assert(!JSON.stringify(row).includes(SID));
    }
    assert(times[1] > times[0]); assert.equal(official.cwOfficialState(state(f), f.clock()).template.brand, undefined);
});

test("已有 brand 字符串模板保持原值，包括明确空字符串，不将缺省与空串混淆", async () => {
    for (const brand of ["synthetic-existing-brand", ""]) {
        const f = setup(); await capture(f, template({brand})); assert.equal(state(f).template.brand, brand);
        f.replies.push(summary()); assert.equal((await load(f)).status, "ready");
        const object = JSON.parse(f.requests[0].options.body).argsObjs[0]; assert.equal(Object.hasOwn(object, "brand"), true); assert.equal(object.brand, brand);
    }
});

test("brand 有值时仍拒绝坏类型、超限和控制字符，未知字段也不放行", () => {
    for (const brand of [null, false, 1, {}, [], "x".repeat(257), "synthetic\nprivate", undefined])
        assert.throws(() => official.cwOfficialTemplate(template({brand})));
    assert.throws(() => official.cwOfficialTemplate(template({syntheticUnknown: "synthetic-private-value"})));
});

test("无 brand 不放松其它必填字段、包装、版本及安装/ext 合同", async () => {
    for (const key of ["appName", "source", "channel", "installStatus", "version", "ext", "token", "timestamp"]) {
        const body = template(); delete body.argsObjs[0][key]; assert.throws(() => official.cwOfficialTemplate(body), key);
    }
    const bodies = [template({version: "2"}), template({version: 3}), template({installStatus: "{}"}), template({ext: '{"apiVersion":"V4"}'}),
        {...template(), argsTypes: [ARG, ARG]}, {...template(), unknownRoot: true}, {...template(), argsObjs: [template().argsObjs[0], template().argsObjs[0]]}];
    for (const body of bodies) {
        const f = setup(); assert.throws(() => official.cwOfficialTemplate(body)); await capture(f, body);
        assert.equal(state(f)?.binding, "unbound"); assert.equal(state(f).token, ""); assert.equal(f.requests.length, 0);
    }
});

test("无 brand 候选保存必须回读确认，noop/throw 后不查询且同次合成 token 可重捕获", async () => {
    for (const failure of ["noop", "throw"]) {
        const f = setup(); await legacy(f); const write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {
            if (key === core.CW_OFFICIAL_STORE && value?.binding === "bearer") {if (failure === "throw") throw new Error("synthetic-private-ios-write"); return;}
            write(key, value);
        };
        await capture(f); f.ctx.storage.setJSON = write; assert.equal(state(f), undefined); assert.equal(barrier(f).officialBinding, "bearer");
        assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
        await capture(f); assert.equal(state(f).binding, "bearer"); assert.equal(Object.hasOwn(state(f).template, "brand"), false);
        f.replies.push(summary()); assert.equal((await load(f)).status, "ready"); assert(!JSON.stringify([...f.memory]).includes("synthetic-private-ios-write"));
    }
});

test("1.3.2 已观察仅缺 brand 的 unbound 状态只读迁移，随后实际无 brand RPC 可接入", async () => {
    const f = setup(); await legacy(f); await capture(f, template({version: "unknown"}));
    const old = {...structuredClone(state(f)), version: "1.3.2"}; old.rpcShape.fieldTypes[5] = "number"; old.rpcShape.versionKnown = true;
    f.memory.set(core.CW_OFFICIAL_STORE, old); const previous = structuredClone(barrier(f));
    const parsed = official.cwOfficialState(old, f.clock()); assert(parsed); assert.equal(parsed.binding, "unbound");
    assert.equal(parsed.rpcShape.fieldTypes[3], "missing"); assert.deepEqual(parsed.rpcShape, old.rpcShape); assert.deepEqual(state(f), old);
    assert.equal((await load(f)).status, "setup"); assert.deepEqual(barrier(f), previous); assert.equal(f.requests.length, 0);
    await capture(f); assert.equal(state(f).binding, "bearer"); assert.equal(Object.hasOwn(state(f).template, "brand"), false);
});

test("1.3.2 带 brand 的 bearer 终止状态升级仍保持撤销，不能用去掉 brand 的同 token 复活", async () => {
    const f = setup(); await capture(f, template({brand: "synthetic-old-brand"}));
    await runtime.default(f.incoming("unb=" + UID, "https://acs.m.taobao.com/gw/com.taobao.mtop.mLoginUnitService.logout/*/"));
    const old = {...structuredClone(state(f)), version: "1.3.2"}; f.memory.set(core.CW_OFFICIAL_STORE, old);
    const parsed = official.cwOfficialState(old, f.clock()); assert(parsed); assert.equal(parsed.status, "signed_out"); assert.deepEqual(parsed.retiredTokenHashes, old.retiredTokenHashes);
    await capture(f); assert.deepEqual(state(f), old); assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
});
