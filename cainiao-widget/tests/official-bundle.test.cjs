// 引擎：Node.js 20+ 内置测试 | 版本：1.3.4 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --experimental-vm-modules --test cainiao-widget/tests/official-bundle.test.cjs
// 依赖：内置库；执行实际自包含发布入口，只有合成会话、内存 HTTP 和内存存储
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {headers} = require("./auth-fixture.cjs");

const SOURCE = fs.readFileSync(path.join(__dirname, "../cainiao-widget.egern.js"), "utf8");
const STORE = "cainiao-widget.official.v1";
const CACHE = "cainiao-widget.local.v1";
const AUTH = "cainiao-widget.auth.v1";
const UID = "900000000000000101";
const OTHER_UID = "900000000000000102";
const TOKEN = "synthetic-bundle-widget-token-A";
const OTHER_TOKEN = "synthetic-bundle-widget-token-B";
const COOKIE = "synthetic-bundle-cookie-never-rpc";
const SIGN = "synthetic-bundle-native-sign-never-rpc";
const API = "mtop.cainiao.guoguo.widget.token.get.cn";
const RPC = "https://guoguouser.cainiao.com/com.cainiao.guoguo.guoguouser.widget.WidgetLogisticsService/1.0.0/queryWidgetDetailsV2";
const ARG = "com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest";
const NOW = Date.UTC(2026, 10, 9, 1, 0);
let externalNetwork = 0;

before(() => {
    const deny = () => { externalNetwork++; throw new Error("自包含组件回归禁止真实网络"); };
    for (const name of ["node:http", "node:https"]) {
        const module = require(name);
        for (const key of ["get", "request"]) mock.method(module, key, deny);
    }
    mock.method(require("node:net").Socket.prototype, "connect", deny);
    mock.method(require("node:tls"), "connect", deny);
    if (typeof globalThis.fetch === "function") mock.method(globalThis, "fetch", deny);
});
after(() => { mock.restoreAll(); assert.equal(externalNetwork, 0); });

const json = value => JSON.parse(JSON.stringify(value));
const bytes = value => value instanceof Uint8Array ? value : new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const summary = (count = 2) => ({success: true, code: 0, data: {packageInfo: {
    agentSignPackNum: count,
    packageItemInfoList: count ? [{logisticsStatus: 900, logisticsStatusSimpleDesc: "合成待取摘要 3-1-2468", stationName: "合成驿站", mailNo: "SYNTHETIC1111"}] : [],
}}});
const reply = body => ({status: 200, headers: headers([["Content-Type", "application/json"]]), text: async () => JSON.stringify(body)});
const bodyTemplate = token => ({argsTypes: [ARG], argsObjs: [{
    appName: "GUOGUO_APP", source: "synthetic-observed-iPhone", channel: "synthetic-channel", brand: "synthetic-brand",
    installStatus: JSON.stringify({isLargeInstall: false, isMediumInstall: true, isSmallInstall: false, isNewSmallInstall: false, isLargeV2Install: false}),
    version: 2, ext: '{"apiVersion":"V3"}', token, timestamp: NOW - 60000, lbs: "synthetic-location-not-retained",
}]});

async function fixture() {
    const memory = new Map(), requests = [], replies = [], logs = [];
    let now = NOW;
    const sandbox = vm.createContext({URL, Uint8Array, ArrayBuffer, setTimeout, clearTimeout,
        clockValue: () => now, console: {log: (...args) => logs.push(args.join(" "))}});
    vm.runInContext("Date.now = () => clockValue();", sandbox);
    const module = new vm.SourceTextModule(SOURCE, {context: sandbox});
    await module.link(() => { throw new Error("发布脚本不得有外部导入"); });
    await module.evaluate();
    const ctx = {env: {CONNECTION_MODE: "auto"}, widgetFamily: "systemMedium", storage: {
        getJSON: key => structuredClone(memory.get(key) ?? null),
        setJSON: (key, value) => memory.set(key, structuredClone(value)),
    }, http: {}};
    for (const method of ["get", "post"]) ctx.http[method] = async (url, options) => {
        requests.push({method, url, options: json(options)});
        const item = replies.shift();
        if (typeof item === "function") return item(url, options);
        if (item instanceof Error) throw item;
        if (!item) throw new Error("synthetic-bundle-offline");
        return item;
    };
    return {ctx, memory, requests, replies, logs, entry: module.namespace.default,
        state: () => memory.get(STORE), advance: ms => {now += ms;}, now: () => now};
}

function tokenRequest(f, uid = UID) {
    return {...f.ctx, request: {method: "GET", url: "https://acs.m.taobao.com/gw/" + API + "/*/?t=" + f.now(),
        headers: headers([["Cookie", "unb=" + uid + "; cookie2=" + COOKIE], ["x-uid", uid], ["x-sign", SIGN]]),
        arrayBuffer: async () => { throw new Error("签发票据不得读取请求正文"); }}};
}

function withBody(ctx, body, response = false, extra = []) {
    const raw = bytes(body), calls = {reads: 0};
    const object = {headers: headers([["Content-Type", "application/json"], ...extra]),
        arrayBuffer: async () => {calls.reads++; return raw;},
        text: async () => { throw new Error("hook 必须只读一次原字节"); }};
    return {ctx: response ? {...ctx, response: {...object, status: 200}}
        : {...ctx, request: {...ctx.request, ...object}}, raw, calls};
}

async function issue(f, uid = UID, token = TOKEN, changes = {}) {
    const request = tokenRequest(f, uid);
    await f.entry(request);
    const response = withBody(request, {api: API, v: "1.0", ret: ["SUCCESS::合成签发"], data: {result: token}, ...changes}, true);
    const result = await f.entry(response.ctx);
    assert.deepEqual(Buffer.from(result.body), Buffer.from(response.raw));
    assert.equal(response.calls.reads, 1);
    return response;
}

async function bind(f, token = TOKEN, changes = {}) {
    const body = bodyTemplate(token);
    Object.assign(body.argsObjs[0], changes);
    const request = withBody({...f.ctx, request: {method: "POST", url: RPC}}, body);
    const result = await f.entry(request.ctx);
    assert.deepEqual(Buffer.from(result.body), Buffer.from(request.raw));
    assert.equal(request.calls.reads, 1);
    return request;
}

async function connected(f) {
    await issue(f); await bind(f); f.replies.push(reply(summary()));
    const result = await f.entry(f.ctx);
    assert.equal(f.state().status, "ready");
    return result;
}

test("实际发布入口捕获专用凭据和真实模板后，关闭 App 不再调用 hook 也能发第二个新 POST", async () => {
    const f = await fixture();
    await connected(f);
    f.advance(60000); f.replies.push(reply(summary(1)));
    const widget = await f.entry(f.ctx);
    assert.equal(f.state().status, "ready");
    assert.equal(f.state().requestCount, 2); assert.equal(f.state().successCount, 2);
    assert.equal(f.requests.length, 2);
    for (const request of f.requests) {
        assert.equal(request.method, "post"); assert.equal(request.url, RPC);
        assert.equal(request.options.headers["Http-Rpc-Type"], "JsonContent");
        assert.equal(request.options.credentials, "omit"); assert.equal(request.options.redirect, "manual");
        assert.equal(request.options.insecureTls, false);
        const object = JSON.parse(request.options.body).argsObjs[0];
        assert.equal(object.token, TOKEN); assert.equal(object.source, "synthetic-observed-iPhone");
        assert.equal(object.version, 2); assert.equal(object.ext, '{"apiVersion":"V3"}');
        assert(!Object.hasOwn(object, "lbs"));
        for (const secret of [UID, COOKIE, SIGN, "synthetic-location-not-retained"]) assert(!JSON.stringify(request).includes(secret));
    }
    const times = f.requests.map(request => JSON.parse(request.options.body).argsObjs[0].timestamp);
    assert.equal(times[0], NOW); assert(times[1] > times[0]);
    assert.equal(f.state().snapshot.total, 1);
    for (const secret of [TOKEN, UID, COOKIE, SIGN]) assert(!JSON.stringify([widget, f.logs]).includes(secret));
    assert.equal(f.memory.get(AUTH), undefined);
});

test("实际发布入口合成 RPC-only 无 UID 直接接入，跨两次新查询不借旧 H5", async () => {
    const f = await fixture(); await bind(f); assert.equal(f.state().binding, "bearer"); assert.equal(f.state().status, "pending");
    assert.equal(f.requests.length, 0); assert.equal(f.state().snapshot, null); assert.equal(f.state().successCount, 0);
    for (let i = 0; i < 2; i++) {f.replies.push(reply(summary())); await f.entry(f.ctx); f.advance(1000);}
    assert.equal(f.state().status, "ready"); assert.equal(f.state().successCount, 2); assert.equal(f.requests.length, 2);
    assert.equal(f.memory.get(AUTH), undefined);
    const times = f.requests.map(row => JSON.parse(row.options.body).argsObjs[0].timestamp); assert(times[1] > times[0]);
    for (const row of f.requests) {assert.equal(row.url, RPC); assert.equal(JSON.parse(row.options.body).argsObjs[0].token, TOKEN);}
});

test("实际发布入口未知合成 RPC 只保存固定形状，不将字段值或 token 输出到诊断", async () => {
    const f = await fixture(); await bind(f, TOKEN, {version: "synthetic-private-version", secretUnknown: "synthetic-private-value"});
    assert.equal(f.state().binding, "unbound"); assert.equal(f.state().token, ""); assert.equal(f.requests.length, 0);
    const widget = await f.entry({...f.ctx, env: {...f.ctx.env, CAINIAO_DIAGNOSTIC: "true"}});
    const text = JSON.stringify(widget); assert.match(text, /RPC.*已观察/); assert.match(text, /version 类型=string/);
    assert(text.includes("RPC 形状观察时间：" + new Date(NOW).toISOString()));
    const types = {appName: "string", source: "string", channel: "string", brand: "string", installStatus: "string",
        version: "string", ext: "string", token: "string", timestamp: "number", lbs: "string"};
    for (const [key, type] of Object.entries(types)) assert(text.includes(key + "=" + type), key);
    assert(text.includes("brand 可省略"));
    for (const value of [TOKEN, "synthetic-private", "secretUnknown"]) assert(!JSON.stringify([widget, [...f.memory]]).includes(value));
});

test("实际 bundle 从旧受限会话屏障记录未知合同，再以合法 RPC 首次迁移并执行两次新查询", async () => {
    const f = await fixture();
    await f.entry({...f.ctx, request: {method: "GET", url: "https://acs.m.taobao.com/gw/mtop.synthetic.account.query/*/",
        headers: headers([["Cookie", "cookie2=" + COOKIE], ["x-uid", UID]])}});
    assert.equal(f.memory.get(CACHE).blocked, true); assert.equal(f.state(), undefined);
    const previous = JSON.stringify(f.memory.get(CACHE));
    await bind(f, TOKEN, {version: "synthetic-private-version"});
    assert.equal(f.state().binding, "unbound"); assert.equal(JSON.stringify(f.memory.get(CACHE)), previous);
    const waiting = await f.entry(f.ctx); assert.match(JSON.stringify(waiting), /等待实际 RPC 合同/); assert.equal(f.requests.length, 0);
    const diagnosis = await f.entry({...f.ctx, env: {...f.ctx.env, CAINIAO_DIAGNOSTIC: "true"}});
    assert.match(JSON.stringify(diagnosis), /RPC version 类型=string/);
    for (const secret of [TOKEN, UID, COOKIE, "synthetic-private-version"]) assert(!JSON.stringify(diagnosis).includes(secret));
    await bind(f); assert.equal(f.state().binding, "bearer"); assert.equal(f.state().snapshot, null);
    for (let i = 0; i < 2; i++) {f.replies.push(reply(summary())); await f.entry(f.ctx); f.advance(1000);}
    assert.equal(f.state().successCount, 2); assert.equal(f.requests.length, 2);
    const times = f.requests.map(row => JSON.parse(row.options.body).argsObjs[0].timestamp); assert(times[1] > times[0]);
    for (const row of f.requests) for (const secret of [UID, COOKIE]) assert(!JSON.stringify(row).includes(secret));
});

test("实际 bundle 接受省略 brand 的合成 iOS 形状，两次新 POST 均不注入该字段", async () => {
    const f = await fixture(), body = bodyTemplate(TOKEN); delete body.argsObjs[0].brand;
    const incoming = withBody({...f.ctx, request: {method: "POST", url: RPC}}, body);
    const result = await f.entry(incoming.ctx);
    assert.deepEqual(Buffer.from(result.body), Buffer.from(incoming.raw)); assert.equal(incoming.calls.reads, 1);
    assert.equal(f.state().binding, "bearer"); assert.equal(Object.hasOwn(f.state().template, "brand"), false);
    for (let i = 0; i < 2; i++) {f.replies.push(reply(summary())); await f.entry(f.ctx); f.advance(1000);}
    assert.equal(f.state().successCount, 2); assert.equal(f.requests.length, 2);
    for (const row of f.requests) assert.equal(Object.hasOwn(JSON.parse(row.options.body).argsObjs[0], "brand"), false);
});

test("只有专用 token 而未观察到实际 RPC 模板时不请求，不硬填 Android 参数", async () => {
    const f = await fixture(); await issue(f);
    const widget = await f.entry(f.ctx);
    assert.equal(f.requests.length, 0); assert.equal(f.state().status, "waiting_template");
    assert.match(JSON.stringify(widget), /等待 App 官方查询/);
});

test("App 包裹响应不作为组件新查询缓存，实际入口必须单独 POST", async () => {
    const f = await fixture(); await issue(f); await bind(f);
    const incoming = withBody({...f.ctx, request: {method: "POST", url: RPC, headers: headers()}}, summary(), true);
    await f.entry(incoming.ctx);
    assert.equal(incoming.calls.reads, 0); assert.equal(f.state().snapshot, null);
    assert.equal(f.state().successCount, 0); assert.equal(f.requests.length, 0);
    f.replies.push(reply(summary())); await f.entry(f.ctx);
    assert.equal(f.requests.length, 1); assert.equal(f.state().successCount, 1);
});

test("实际 token 响应显式版本冲突，原字节仍透传但不采纳", async () => {
    for (const v of ["2.0", 1, null]) {
        const f = await fixture(); await issue(f, UID, TOKEN, {v});
        assert.equal(f.state().token, ""); assert.equal(f.requests.length, 0);
    }
});

test("未知及超限 token 正文只透传一次，不从二进制或压缩内容猜 token", async () => {
    for (const [raw, extra] of [[new Uint8Array([255, 0, 128]), []],
        [new Uint8Array(262145), []], [bytes({ret: ["SUCCESS"], data: {result: TOKEN}}), [["Content-Encoding", "gzip"]]]]) {
        const f = await fixture(), request = tokenRequest(f);
        await f.entry(request);
        const response = withBody(request, raw, true, extra);
        const result = await f.entry(response.ctx);
        assert.deepEqual(Buffer.from(result.body), Buffer.from(raw)); assert.equal(response.calls.reads, 1);
        assert.equal(f.state().token, ""); assert.equal(f.requests.length, 0);
    }
});

test("实际固定 RPC 路由拒绝 query 和其它路径，不读正文或更新模板", async () => {
    const f = await fixture(); await issue(f);
    for (const suffix of ["?t=synthetic", "/", "#fragment", "/extra"]) {
        const incoming = withBody({...f.ctx, request: {method: "POST", url: RPC + suffix}}, bodyTemplate(TOKEN));
        await f.entry(incoming.ctx);
        assert.equal(incoming.calls.reads, 0); assert.equal(f.state().template, null);
    }
});

test("B 写入失败留下屏障，默认链的旧 A 普通请求与响应不得恢复旧查询", async () => {
    const f = await fixture(); await connected(f);
    const old = json(f.state()), write = f.ctx.storage.setJSON;
    f.ctx.storage.setJSON = (key, value) => {
        if (key === STORE && value?.owner !== old.owner) throw new Error("synthetic-B-write-failure");
        return write(key, value);
    };
    f.advance(1000); await f.entry(tokenRequest(f, OTHER_UID));
    const blocked = json(f.memory.get(CACHE));
    assert.equal(blocked.blocked, true); assert.notEqual(blocked.owner, old.owner);
    f.ctx.storage.setJSON = write;
    const oldRequest = tokenRequest(f);
    oldRequest.request.url = "https://acs.m.taobao.com/gw/mtop.cainiao.lpc.packageservice.querypdspackagedatalist/1.0/";
    await f.entry(oldRequest);
    const response = {...oldRequest, response: {status: 200,
        headers: headers([["Set-Cookie", "unb=" + UID + "; Domain=.taobao.com; Path=/"],
            ["Set-Cookie", "cookie2=" + COOKIE + "; Domain=.taobao.com; Path=/"]])}};
    await f.entry(response);
    assert.deepEqual(f.memory.get(CACHE), blocked); assert.equal(f.memory.get(AUTH), undefined);
    await f.entry(f.ctx); assert.equal(f.requests.length, 1);
    f.advance(1000); await issue(f, OTHER_UID, OTHER_TOKEN); await bind(f, OTHER_TOKEN);
    f.replies.push(reply(summary(1))); await f.entry(f.ctx);
    assert.equal(f.state().status, "ready"); assert.equal(f.requests.length, 2);
    assert.equal(JSON.parse(f.requests[1].options.body).argsObjs[0].token, OTHER_TOKEN);
});

test("旧 H5 已在途时捕获官方专用票据，旧结果不越过新路径写回", async () => {
    const f = await fixture();
    const incoming = tokenRequest(f);
    incoming.request.url = "https://acs.m.taobao.com/h5/mtop.cainiao.lpc.packageservice.querypdspackagedatalist/1.0/";
    await f.entry(incoming);
    assert(f.memory.get(AUTH));
    let release;
    f.replies.push(() => new Promise(resolve => {release = resolve;}));
    const running = f.entry(f.ctx);
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
    assert.equal(typeof release, "function");
    await f.entry(tokenRequest(f));
    const cacheAfterCapture = json(f.memory.get(CACHE) ?? null);
    release(reply({ret: ["SUCCESS"], data: {packages: [], totalPage: 1, currentPage: 1}}));
    const widget = await running;
    assert.deepEqual(f.memory.get(CACHE) ?? null, cacheAfterCapture);
    assert.equal(f.state().snapshot, null); assert.match(JSON.stringify(widget), /刷新小组件/);
});

test("未出现官方专用状态的用户仍可沿原 H5 捕获路径保存候选", async () => {
    const f = await fixture(), incoming = tokenRequest(f);
    incoming.request.url = "https://acs.m.taobao.com/gw/mtop.cainiao.lpc.packageservice.querypdspackagedatalist/1.0/";
    await f.entry(incoming);
    assert.equal(f.memory.get(STORE), undefined); assert(f.memory.get(AUTH));
    assert.equal(f.requests.length, 0);
});

test("连接状态只读显示新路径与旧 H5 的区别，不发送查询或泄露凭据", async () => {
    const f = await fixture(); await connected(f);
    const saved = json(f.state()), count = f.requests.length;
    const widget = await f.entry({...f.ctx, env: {...f.ctx.env, CAINIAO_DIAGNOSTIC: "true"}});
    assert.equal(f.requests.length, count); assert.deepEqual(f.state(), saved);
    const text = JSON.stringify(widget);
    assert.match(text, /官方/); assert.match(text, /旧 H5 备用状态/);
    for (const secret of [TOKEN, UID, COOKIE, SIGN, "3-1-2468", "SYNTHETIC1111"]) assert(!text.includes(secret));
});

test("实际查询的所有锁屏尺寸默认隐藏整个摘要，桌面显示官方计数", async () => {
    for (const family of ["systemSmall", "systemMedium", "systemLarge", "systemExtraLarge", "accessoryCircular", "accessoryRectangular", "accessoryInline"]) {
        const f = await fixture(); f.ctx.widgetFamily = family;
        const widget = await connected(f), text = JSON.stringify(widget);
        assert.equal(f.state().snapshot.total, 2);
        if (family.startsWith("accessory")) {
            assert(!text.includes("3-1-2468")); assert(!text.includes("合成待取摘要")); assert(!text.includes("合成驿站"));
        } else assert(text.includes("3-1-2468"));
        assert(!text.includes(TOKEN));
    }
});

test("专用 INVALID_TOKEN 终止后重复同值签发不复活，也不继续 POST", async () => {
    const f = await fixture(); await connected(f); f.advance(1000);
    f.replies.push(reply({success: true, data: {status: "INVALID_TOKEN"}}));
    await f.entry(f.ctx); assert.equal(f.state().status, "expired");
    const before = f.requests.length;
    f.advance(1000); await issue(f); await bind(f); await f.entry(f.ctx);
    assert.equal(f.state().status, "expired"); assert.equal(f.requests.length, before);
});
