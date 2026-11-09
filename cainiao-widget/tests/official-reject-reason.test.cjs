// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// 构建：无需编译
// 运行：node --test cainiao-widget/tests/official-reject-reason.test.cjs
// 依赖：auth-fixture.cjs；仅合成字段，拒绝真实网络，不读取手机凭据或正文
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const {NOW, headers, fixture} = require("./auth-fixture.cjs");
const RPC = "https://guoguouser.cainiao.com/com.cainiao.guoguo.guoguouser.widget.WidgetLogisticsService/1.0.0/queryWidgetDetailsV2";
const ARG = "com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest";
const TOKEN = "synthetic-private-reject-token", SECRET = "synthetic-private-reject-value";
const REASONS = ["WRAPPER", "APP_NAME", "SOURCE", "CHANNEL", "BRAND", "INSTALL_STATUS", "VERSION", "EXT", "TOKEN", "TIMESTAMP", "LBS", "RPC_HEADER", "BODY"];
let core, official, runtime, network = 0, clock = () => NOW;

before(async () => {
    const deny = () => {network++; throw new Error("拒绝分类回归禁止真实网络");};
    for (const name of ["node:http", "node:https"]) for (const method of ["get", "request"]) mock.method(require(name), method, deny);
    mock.method(require("node:net").Socket.prototype, "connect", deny); mock.method(require("node:tls"), "connect", deny);
    if (typeof globalThis.fetch === "function") mock.method(globalThis, "fetch", deny);
    mock.method(Date, "now", () => clock());
    core = await import("../core.mjs"); official = await import("../official.mjs"); runtime = await import("../runtime.mjs");
});
after(() => {mock.restoreAll(); assert.equal(network, 0);});

function body(changes = {}) {
    return {argsTypes: [ARG], argsObjs: [{appName: "GUOGUO_APP", source: SECRET, channel: SECRET,
        installStatus: JSON.stringify({isLargeInstall: false, isMediumInstall: true, isSmallInstall: false, isNewSmallInstall: false, isLargeV2Install: false}),
        version: 2, ext: '{"apiVersion":"V3"}', token: TOKEN, timestamp: NOW - 1000, ...changes}]};
}
function setup() {
    const f = fixture(); clock = f.clock; f.ctx.env.CONNECTION_MODE = "auto";
    f.ctx.http.post = async () => {f.requests.push("unexpected-post"); throw new Error("拒绝的合成正文不得查询");};
    return f;
}
const state = f => f.memory.get(core.CW_OFFICIAL_STORE);
async function capture(f, value, extra = []) {
    const raw = value instanceof Uint8Array ? value : new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)); let reads = 0;
    const result = await runtime.default({...f.ctx, request: {method: "POST", url: RPC,
        headers: headers([["Content-Type", "application/json"], ["Http-Rpc-Type", "JsonContent"], ...extra]),
        arrayBuffer: async () => {reads++; return raw.slice().buffer;}, text: () => {throw new Error("不得重复读取正文");}}});
    assert.equal(reads, 1); assert.deepEqual(Object.keys(result), ["body"]); assert.deepEqual([...result.body], [...raw]);
}
const cases = () => [
    ["WRAPPER", {...body(), syntheticUnknownRoot: SECRET}],
    ["WRAPPER", body({syntheticUnknownField: SECRET})],
    ["APP_NAME", body({appName: SECRET})], ["SOURCE", body({source: ""})], ["CHANNEL", body({channel: "x".repeat(257)})],
    ["BRAND", body({brand: null})], ["INSTALL_STATUS", body({installStatus: '{"isSmallInstall":false}'})],
    ["VERSION", body({version: 3})], ["EXT", body({ext: '{"apiVersion":"synthetic-private-api"}'})],
    ["TOKEN", body({token: ""})], ["TIMESTAMP", body({timestamp: 1.5})], ["LBS", body({lbs: null})],
];

test("模板各拒绝点携带固定原因，导出签名和 SCHEMA_INVALID 不变", () => {
    assert.equal(official.cwOfficialTemplate.length, 1);
    for (const [reason, value] of cases()) assert.throws(() => official.cwOfficialTemplate(value), error => {
        assert.equal(error.officialCode, "SCHEMA_INVALID"); assert.equal(error.message, "SCHEMA_INVALID"); assert.equal(error.rejectReason, reason);
        assert(!JSON.stringify(error).includes(SECRET)); return true;
    }, reason);
    assert.equal(official.cwOfficialTemplate(body()).template.brand, undefined);
});

test("缺失已知必填字段和字符串内部 JSON 失败均定位固定字段，brand/lbs 仍可省略", () => {
    for (const [key, reason] of [["appName", "APP_NAME"], ["source", "SOURCE"], ["channel", "CHANNEL"], ["installStatus", "INSTALL_STATUS"],
        ["version", "VERSION"], ["ext", "EXT"], ["token", "TOKEN"], ["timestamp", "TIMESTAMP"]]) {
        const value = body(); delete value.argsObjs[0][key]; assert.throws(() => official.cwOfficialTemplate(value), error => error.rejectReason === reason, key);
    }
    for (const [key, reason] of [["installStatus", "INSTALL_STATUS"], ["ext", "EXT"]]) {
        for (const value of ["\n" + SECRET, "{", '{"duplicate":1,"duplicate":2}'])
            assert.throws(() => official.cwOfficialTemplate(body({[key]: value})), error => error.rejectReason === reason, key);
    }
});

test("默认 hook 将固定原因写入新 shape，失败只读一次原字节透传且零查询", async () => {
    for (const [reason, value] of cases()) {
        const f = setup(); await capture(f, value);
        assert.equal(state(f).binding, "unbound"); assert.equal(state(f).rpcShape.rejectReason, reason); assert.equal(state(f).token, "");
        assert.equal(state(f).failure, "SCHEMA_INVALID"); assert.equal(state(f).requestCount, 0);
        assert.equal((await runtime.loadCainiaoModel(f.ctx, f.clock)).status, "setup"); assert.equal(f.requests.length, 0);
        const text = JSON.stringify([state(f), official.cwOfficialLines(f.ctx, f.clock())]);
        for (const secret of [TOKEN, SECRET, "syntheticUnknownRoot", "syntheticUnknownField", "synthetic-private-api"]) assert(!text.includes(secret), reason);
    }
});

test("RPC 头和未解析正文单独分类，未知字节和压缩正文仍透传且不猜内容", async () => {
    for (const [value, extra, reason] of [[body(), [["Http-Rpc-Type", SECRET]], "RPC_HEADER"],
        [body(), [["Content-Type", "text/plain"]], "RPC_HEADER"], [body(), [["Content-Encoding", "gzip"]], "RPC_HEADER"],
        [new Uint8Array([255, 0, 254]), [], "BODY"], [SECRET, [], "BODY"], ['{"argsObjs":[],"argsObjs":[]}', [], "BODY"]]) {
        const f = setup(); await capture(f, value, extra); assert.equal(state(f).rpcShape.rejectReason, reason); assert.equal(f.requests.length, 0);
        assert(!JSON.stringify([...f.memory]).includes(SECRET));
    }
});

test("旧二十键 shape 原样回读，新二十一键只接受固定枚举且不新增写入", async () => {
    const f = setup(); await capture(f, body({timestamp: 0}));
    const current = structuredClone(state(f)), old = {...structuredClone(current), version: "1.3.4"}; delete old.rpcShape.rejectReason;
    assert.equal(Object.keys(old.rpcShape).length, 20);
    const writes = f.writes.length;
    assert.deepEqual(official.cwOfficialState(old, f.clock()).rpcShape, old.rpcShape);
    for (const reason of REASONS) {
        const value = {...current, rpcShape: {...old.rpcShape, rejectReason: reason}};
        assert.equal(Object.keys(value.rpcShape).length, 21); assert.deepEqual(official.cwOfficialState(value, f.clock()).rpcShape, value.rpcShape);
    }
    assert.equal(f.writes.length, writes);
    for (const reason of [undefined, null, "", SECRET, 1, [], {}])
        assert.equal(official.cwOfficialState({...current, rpcShape: {...old.rpcShape, rejectReason: reason}}, f.clock()), null);
    for (const value of [{...old.rpcShape, syntheticUnknownShape: SECRET}, {...current.rpcShape, syntheticUnknownShape: SECRET},
        (() => {const shape = {...current.rpcShape}; delete shape.at; return shape;})()]) {
        const poisoned = {...current, rpcShape: value}; assert.equal(official.cwOfficialState(poisoned, f.clock()), null);
        f.memory.set(core.CW_OFFICIAL_STORE, poisoned); assert(!official.cwOfficialLines(f.ctx, f.clock()).join("\n").includes(SECRET));
    }
});

test("屏障下拒绝原因紧接首条形状诊断，旧 shape 明确未记录且保持原存储", async () => {
    const f = setup(); f.memory.set(core.CW_STORE, {version: core.CW_VERSION, owner: core.md5("account:synthetic-only-owner"),
        source: "capture", blocked: true, cookie: "", snapshot: null});
    const fence = structuredClone(f.memory.get(core.CW_STORE)); await capture(f, body({timestamp: 0}));
    assert.deepEqual(f.memory.get(core.CW_STORE), fence);
    const lines = official.cwOfficialLines(f.ctx, f.clock()), index = lines.findIndex(line => line.startsWith("RPC 固定形状："));
    assert(index >= 0); assert.equal(lines[index + 1], "RPC 合同拒绝字段：TIMESTAMP");
    const old = structuredClone(state(f)); delete old.rpcShape.rejectReason; f.memory.set(core.CW_OFFICIAL_STORE, old);
    const previous = structuredClone([...f.memory]), writes = f.writes.length, oldLines = official.cwOfficialLines(f.ctx, f.clock());
    assert.equal(oldLines[index + 1], "RPC 合同拒绝字段：未记录"); assert.deepEqual([...f.memory], previous); assert.equal(f.writes.length, writes);
});

test("同 token 坏合同只停止旧模板并保存原因，随后合法模板不继承拒绝分类", async () => {
    const f = setup(); await capture(f, body()); assert.equal(state(f).binding, "bearer");
    await capture(f, body({source: ""})); assert.equal(state(f).status, "waiting_template"); assert.equal(state(f).rpcShape.rejectReason, "SOURCE");
    assert.equal(state(f).template, null); assert.equal(f.requests.length, 0);
    await capture(f, body()); assert.equal(state(f).status, "pending"); assert.equal(Object.hasOwn(state(f).rpcShape, "rejectReason"), false);
    assert.equal(f.requests.length, 0);
});
