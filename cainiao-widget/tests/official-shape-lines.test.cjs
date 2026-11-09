// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// 构建：无需编译
// 运行：node --test cainiao-widget/tests/official-shape-lines.test.cjs
// 依赖：auth-fixture.cjs；仅合成正文和本机存储，不读取手机数据或访问网络
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {NOW, headers, fixture} = require("./auth-fixture.cjs");
const RPC = "https://guoguouser.cainiao.com/com.cainiao.guoguo.guoguouser.widget.WidgetLogisticsService/1.0.0/queryWidgetDetailsV2";
const ARG = "com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest";
const TOKEN = "synthetic-private-shape-token";
const FIELDS = ["appName", "source", "channel", "brand", "installStatus", "version", "ext", "token", "timestamp", "lbs"];
let core, official;

before(async () => {core = await import("../core.mjs"); official = await import("../official.mjs");});

function body(changes = {}) {
    return {argsTypes: [ARG], argsObjs: [{appName: "GUOGUO_APP", source: "synthetic-private-source", channel: "synthetic-private-channel",
        installStatus: JSON.stringify({isLargeInstall: false, isMediumInstall: true, isSmallInstall: false, isNewSmallInstall: false, isLargeV2Install: false}),
        version: 2, ext: '{"apiVersion":"V3"}', token: TOKEN, timestamp: "synthetic-private-timestamp", lbs: ["synthetic-private-location"], ...changes}]};
}

async function capture(f, value = body()) {
    const raw = new TextEncoder().encode(JSON.stringify(value)); let reads = 0;
    const result = await official.captureCainiaoOfficialRequest({...f.ctx, request: {method: "POST", url: RPC,
        headers: headers([["Content-Type", "application/json"], ["Http-Rpc-Type", "JsonContent"]]),
        arrayBuffer: async () => {reads++; return raw.slice().buffer;}}}, f.clock);
    assert.equal(reads, 1); assert.deepEqual([...result.body], [...raw]);
    assert.equal(f.memory.get(core.CW_OFFICIAL_STORE)?.binding, "unbound");
}

test("已有旧版本 shape 只读回读，观察时间显示保存的 ISO 时间而非诊断时间", async () => {
    for (const version of ["1.3.1", "1.3.2", "1.3.3"]) {
        const f = fixture(); await capture(f);
        const raw = {...f.memory.get(core.CW_OFFICIAL_STORE), version}; f.memory.set(core.CW_OFFICIAL_STORE, raw);
        const previous = structuredClone([...f.memory]), writes = f.writes.length;
        f.advance(86400000);
        const parsed = official.cwOfficialState(raw, f.clock()), lines = official.cwOfficialLines(f.ctx, f.clock());
        assert.deepEqual(parsed.rpcShape, raw.rpcShape); assert.deepEqual([...f.memory], previous); assert.equal(f.writes.length, writes);
        assert(lines.includes("RPC 形状观察时间：" + new Date(NOW).toISOString()));
        assert(!lines.join("\n").includes(new Date(f.clock()).toISOString())); assert.equal(f.requests.length, 0);
    }
});

test("固定十字段的已存类型全部可见，各位置按实际类型显示", async () => {
    const f = fixture(); await capture(f, body({source: 7, channel: false, brand: null, installStatus: {}, version: [], ext: undefined}));
    const expected = ["string", "number", "boolean", "null", "object", "array", "missing", "string", "string", "array"];
    assert.deepEqual(f.memory.get(core.CW_OFFICIAL_STORE).rpcShape.fieldTypes, expected);
    const lines = official.cwOfficialLines(f.ctx, f.clock()).filter(line => line.startsWith("RPC 字段类型：")).join("；");
    for (let index = 0; index < FIELDS.length; index++) assert(lines.includes(FIELDS[index] + "=" + expected[index]), FIELDS[index]);
    assert.equal(f.requests.length, 0);
});

test("legacy 屏障下保留原五行并注明 brand 可省略，凭据及未知键值不进入诊断", async () => {
    const f = fixture(); f.memory.set(core.CW_STORE, {version: core.CW_VERSION, owner: core.md5("account:synthetic-private-owner"),
        source: "capture", blocked: true, cookie: "", snapshot: null});
    const unknownKey = "syntheticPrivateUnknownField", unknownRoot = "syntheticPrivateUnknownRoot";
    const value = body({[unknownKey]: "synthetic-private-object-value"}); value[unknownRoot] = "synthetic-private-root-value";
    await capture(f, value); const previous = structuredClone([...f.memory]), writes = f.writes.length;
    const lines = official.cwOfficialLines(f.ctx, f.clock()), text = lines.join("\n");
    for (const line of [
        "RPC 固定形状：正文=object；argsTypes=array；已知唯一类型=是；argsObjs=array；对象数量=1",
        "RPC 已知字段缺失：brand；根额外字段=1；对象额外字段=1",
        "RPC version 类型=number；是否数值 1/2=是；appName 是否已知=是",
        "RPC installStatus 类型=string；JSON=object；缺失=无；多余=0；非布尔已知键=无",
        "RPC ext 类型=string；JSON=object；apiVersion 类型=string；是否 V3=是；多余=0",
    ]) assert(lines.includes(line), line);
    assert.match(text, /账号屏障生效/); assert.match(text, /brand=missing/); assert.match(text, /brand 可省略/);
    for (const secret of [TOKEN, "synthetic-private", unknownKey, unknownRoot, ARG, RPC]) assert(!text.includes(secret), secret);
    assert.deepEqual([...f.memory], previous); assert.equal(f.writes.length, writes); assert.equal(f.requests.length, 0);
});
