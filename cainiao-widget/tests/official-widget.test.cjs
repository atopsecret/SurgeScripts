// 引擎：Node.js 20+ 内置测试 | 版本：1.3.0 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --test cainiao-widget/tests/official-widget.test.cjs
// 依赖：内置库及 auth-fixture.cjs；仅合成 token、内存 HTTP 和内存存储
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {NOW, headers, parcel, response, fixture} = require("./auth-fixture.cjs");

const HOSTS = ["h5api.m.taobao.com", "acs.m.taobao.com", "cn-acs.m.cainiao.com", "e2e-mtop.cainiao.com"];
const TOKEN_API = "mtop.cainiao.guoguo.widget.token.get.cn";
const RPC_URL = "https://guoguouser.cainiao.com/com.cainiao.guoguo.guoguouser.widget.WidgetLogisticsService/1.0.0/queryWidgetDetailsV2";
const ARG_TYPE = "com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest";
const UID = "900000000000000001";
const OTHER_UID = "900000000000000002";
const TOKEN = "synthetic-official-widget-token-A";
const OTHER_TOKEN = "synthetic-official-widget-token-B";
const SESSION = "synthetic-official-request-cookie-not-rpc-auth";
const SIGN = "synthetic-official-native-one-shot-sign-not-rpc";
const SOURCE = "synthetic-observed-iOS-widget";
const CHANNEL = "synthetic-observed-ios-channel";
const BRAND = "synthetic-observed-ios-brand";
const DAY = 86400000;
const INSTALL = JSON.stringify({isLargeInstall: false, isMediumInstall: true, isSmallInstall: false,
    isNewSmallInstall: false, isLargeV2Install: false});
let core, auth, official, runtime, render, networkAttempts = 0;

before(async () => {
    const deny = () => {networkAttempts++; throw new Error("官方取数回归禁止真实网络");};
    for (const name of ["node:http", "node:https"]) {
        const module = require(name);
        for (const method of ["get", "request"]) mock.method(module, method, deny);
    }
    const net = require("node:net");
    for (const method of ["connect", "createConnection"]) mock.method(net, method, deny);
    mock.method(net.Socket.prototype, "connect", deny);
    mock.method(require("node:tls"), "connect", deny);
    if (typeof globalThis.fetch === "function") mock.method(globalThis, "fetch", deny);
    core = await import("../core.mjs");
    auth = await import("../auth.mjs");
    official = await import("../official.mjs");
    runtime = await import("../runtime.mjs");
    render = await import("../render.mjs");
});

after(() => {
    mock.restoreAll();
    assert.equal(networkAttempts, 0, "全部请求必须走内存夹具，不得访问真实接口");
});

const digest = value => createHash("md5").update(value).digest("hex");
const saved = f => f.memory.get(core.CW_OFFICIAL_STORE);
const posts = f => f.requests.filter(request => request.method === "POST");
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);
const bytesOf = value => value instanceof Uint8Array ? value.slice()
    : new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const memoryJSON = f => JSON.stringify([...f.memory]);

function officialFixture(replies = []) {
    const f = fixture(replies);
    f.ctx.http.post = async (url, options) => {
        f.requests.push({url: new URL(url), options, method: "POST"});
        const reply = f.replies.shift();
        if (typeof reply === "function") return reply(url, options);
        if (reply instanceof Error) throw reply;
        if (!reply) throw new Error("synthetic-official-offline-private-text");
        return reply;
    };
    return f;
}

function tokenURL({host = "acs.m.taobao.com", channel = "gw", version = channel === "gw" ? "*" : "1.0", t = NOW} = {}) {
    return "https://" + host + "/" + channel + "/" + TOKEN_API + "/" + version + "/?t=" + t + "&sign=" + SIGN;
}

function tokenRequest(f, {uid = UID, unb = uid, url = tokenURL({t: f.clock()}), extra = [], method = "GET"} = {}) {
    const cookie = (unb === null ? "" : "unb=" + unb + "; ") + "cookie2=" + SESSION;
    const ctx = f.incoming(cookie, url, (uid === null ? [] : [["x-uid", uid]]).concat(extra));
    ctx.env = f.ctx.env;
    ctx.request.method = method;
    const calls = {arrayBuffer: 0, text: 0};
    ctx.request.arrayBuffer = async () => {calls.arrayBuffer++; throw new Error("签发票据不得读取请求正文");};
    ctx.request.text = async () => {calls.text++; throw new Error("签发票据不得读取请求文本");};
    Object.defineProperty(ctx.request, "body", {get() {throw new Error("不得直接读取请求 body");}});
    return {ctx, calls};
}

function tokenReply(ticket, {token = TOKEN, body = {ret: ["SUCCESS::合成签发"], data: {result: token}}, status = 200,
    extra = [], read = null} = {}) {
    const bytes = bytesOf(body), calls = {arrayBuffer: 0, text: 0};
    const ctx = {...ticket.ctx, response: {
        status, headers: headers([["Content-Type", "application/json"], ...extra]),
        arrayBuffer: async () => {calls.arrayBuffer++; return read ? read(bytes) : bytes.slice().buffer;},
        text: async () => {calls.text++; throw new Error("签发响应只能有界读取 arrayBuffer 一次");},
    }};
    return {ctx, calls, bytes};
}

function template({token = TOKEN, timestamp = NOW, changes = {}} = {}) {
    return {argsTypes: [ARG_TYPE], argsObjs: [{appName: "GUOGUO_APP", source: SOURCE, token, timestamp,
        channel: CHANNEL, brand: BRAND, installStatus: INSTALL, version: 1, ext: '{"apiVersion":"V3"}', ...changes}]};
}

function rpcRequest(f, {body = template({timestamp: f.clock()}), uid = null, cookie = "", url = RPC_URL,
    extra = [], read = null, method = "POST"} = {}) {
    const ctx = f.incoming(cookie, url, (uid === null ? [] : [["x-uid", uid]]).concat(extra));
    ctx.env = f.ctx.env;
    ctx.request.method = method;
    const bytes = bytesOf(body), calls = {arrayBuffer: 0, text: 0};
    ctx.request.headers = headers([["Content-Type", "application/json"], ...extra,
        ...(uid === null ? [] : [["x-uid", uid]]), ...(cookie ? [["Cookie", cookie]] : [])]);
    ctx.request.arrayBuffer = async () => {calls.arrayBuffer++; return read ? read(bytes) : bytes.slice().buffer;};
    ctx.request.text = async () => {calls.text++; throw new Error("模板采集不得调用 text");};
    Object.defineProperty(ctx.request, "body", {get() {throw new Error("不得直接读取模板 body");}});
    return {ctx, calls, bytes};
}

function assertPassthrough(result, hook) {
    assert(result && result.body instanceof Uint8Array, "已读取的原 body 必须以 Uint8Array 返回");
    assert.deepEqual(Object.keys(result), ["body"], "hook 不得替换原头、状态或其它内容");
    assert.deepEqual([...result.body], [...hook.bytes]);
    assert.deepEqual(hook.calls, {arrayBuffer: 1, text: 0});
}

async function issue(f, options = {}) {
    const request = tokenRequest(f, options);
    assert.equal(await official.captureCainiaoOfficialRequest(request.ctx, f.clock), undefined);
    assert.deepEqual(request.calls, {arrayBuffer: 0, text: 0});
    const reply = tokenReply(request, options);
    const result = await official.captureCainiaoOfficialResponse(reply.ctx, f.clock);
    assertPassthrough(result, reply);
    return {request, reply};
}

async function captureTemplate(f, options = {}) {
    const hook = rpcRequest(f, options);
    const original = {request: hook.ctx.request, headers: hook.ctx.request.headers, url: hook.ctx.request.url, method: hook.ctx.request.method};
    const result = await official.captureCainiaoOfficialRequest(hook.ctx, f.clock);
    assertPassthrough(result, hook);
    assert.equal(hook.ctx.request, original.request); assert.equal(hook.ctx.request.headers, original.headers);
    assert.equal(hook.ctx.request.url, original.url); assert.equal(hook.ctx.request.method, original.method);
    return hook;
}

const item = (changes = {}) => ({logisticsStatus: 900, logisticsStatusSimpleDesc: "合成摘要：凭 8-2-2046 领取",
    stationName: "合成官方驿站", hasAuthCode: true, mailNo: "SYNTHETIC-OFFICIAL-MAIL-001", ...changes});
function queryBody({items = [item()], total = 1, status = "SUCCESS", changes = {}} = {}) {
    return {success: true, data: {status, packageInfo: {agentSignPackNum: total, packageItemInfoList: items}}, ...changes};
}
const queryReply = options => response(queryBody(options));

async function bound(f, options = {}) {
    await issue(f, options);
    await captureTemplate(f, {body: template({token: options.token || TOKEN, timestamp: f.clock()})});
    assert(saved(f), "真实签发与实际模板完成后应有本机专用状态");
    assert.equal(saved(f).status, "pending");
    assert.equal(posts(f).length, 0, "hook 采集不得主动查询个人数据");
}

async function connected(options = {}) {
    const f = officialFixture(); await bound(f);
    f.replies.push(queryReply(options));
    const model = await load(f); assertReady(model);
    return {f, model};
}

function assertReady(model) {
    assert.equal(model.status, "ready"); assert.equal(model.coverage, "official_summary");
    assert.equal(model.complete, false); assert.equal(model.pickupCodesConfirmed, false);
    assert(model.updatedAt && Number.isFinite(Date.parse(model.updatedAt)));
    assert(model.items.every(value => value.code === ""), "摘要不能补造结构化取件码");
}

function assertNewPost(request, expectedToken = TOKEN, expectedTemplate = template().argsObjs[0]) {
    assert.equal(request.method, "POST"); assert.equal(request.url.href, RPC_URL);
    assert.equal(request.url.search, ""); assert.equal(request.options.credentials, "omit");
    assert.equal(request.options.redirect, "manual"); assert.equal(request.options.insecureTls, false);
    assert(Number.isFinite(request.options.timeout) && request.options.timeout > 0 && request.options.timeout <= 18000,
        "Egern timeout 的单位是毫秒，必须受十八秒总预算约束");
    assert.equal(typeof request.options.body, "string");
    const outgoing = JSON.parse(request.options.body);
    assert.deepEqual(Object.keys(outgoing).sort(), ["argsObjs", "argsTypes"]);
    assert.deepEqual(outgoing.argsTypes, [ARG_TYPE]); assert.equal(outgoing.argsObjs.length, 1);
    const value = outgoing.argsObjs[0];
    assert.equal(value.token, expectedToken); assert(Number.isSafeInteger(value.timestamp) && value.timestamp > 0);
    for (const key of ["appName", "source", "channel", "brand", "installStatus", "version", "ext"])
        assert.equal(value[key], expectedTemplate[key], key + " 必须取自实际模板，不硬填 Android 参数");
    assert.deepEqual(Object.keys(value).sort(), ["appName", "source", "token", "timestamp", "channel", "brand", "installStatus", "version", "ext"].sort());
    const outgoingHeaders = new Map(Object.entries(request.options.headers).map(([name, value]) => [name.toLowerCase(), value]));
    assert.equal(outgoingHeaders.get("http-rpc-type"), "JsonContent");
    assert.equal(outgoingHeaders.get("content-type"), "application/json");
    assert.equal(outgoingHeaders.get(core.CW_SELF_HEADER.toLowerCase()), "1");
    assert.deepEqual([...outgoingHeaders.keys()].sort(), ["content-type", "http-rpc-type", core.CW_SELF_HEADER.toLowerCase()].sort());
    return value;
}

function assertNoPrivateLines(f, additional = []) {
    const state = saved(f);
    const text = official.cwOfficialLines(f.ctx, f.clock()).join("\n");
    for (const marker of [TOKEN, OTHER_TOKEN, UID, OTHER_UID, SIGN, SESSION, RPC_URL,
        state?.owner, state?.generation, state?.tokenHash, state?.templateHash, ...additional].filter(Boolean))
        assert(!text.includes(marker), "连接状态不得显示 token、UID、URL、摘要或服务端原文");
    return text;
}

function deferred() {
    let resolve;
    const promise = new Promise(done => {resolve = done;});
    return {promise, resolve};
}

test("1.3.0 专用 key 与四 MTOP token 路由返回固定结构", () => {
    assert.equal(core.CW_VERSION, "1.3.0"); assert.equal(typeof core.CW_OFFICIAL_STORE, "string");
    assert(core.CW_OFFICIAL_STORE.length > 0);
    assert(![core.CW_STORE, core.CW_AUTH_STORE, core.CW_APP_STORE, core.CW_RESPONSE_STORE, core.CW_TRANSPORT_STORE].includes(core.CW_OFFICIAL_STORE));
    for (const host of HOSTS) for (const channel of ["h5", "gw"]) {
        const url = tokenURL({host, channel});
        assert.deepEqual(official.cwOfficialRoute(url, headers([["Host", host + ":443"]])), {kind: "token", host, channel});
    }
    for (const path of ["/gw/" + TOKEN_API, "/gw/" + TOKEN_API + "/", "/gw/" + TOKEN_API + "/1.0/"])
        assert.equal(official.cwOfficialRoute("https://acs.m.taobao.com" + path)?.kind, "token");
});

test("token 路由拒绝伪域、HTTP、userinfo、片段、越界路径与非法 H5 版本", () => {
    const valid = tokenURL();
    const urls = [valid.replace("https:", "http:"), valid.replace("acs.m.taobao.com", "acs.m.taobao.com.evil.invalid"),
        valid.replace("acs.m.taobao.com", "evil.invalid@acs.m.taobao.com"), valid.replace("acs.m.taobao.com", "acs.m.taobao.com:80"),
        valid + "#fragment", valid.replace("/*/", "/*/extra/"), valid.replace(TOKEN_API, TOKEN_API + "evil"),
        tokenURL({channel: "h5", version: "*"}), tokenURL({channel: "h5", version: ""}), tokenURL({version: "1.x"})];
    for (const url of urls) assert.equal(official.cwOfficialRoute(url), null, url);
});

test("RPC 只匹配精确 HTTPS 主机服务版本和方法，Host 必须一致", () => {
    assert.deepEqual(official.cwOfficialRoute(RPC_URL), {kind: "query", host: "guoguouser.cainiao.com", channel: "rpc"});
    assert.equal(official.cwOfficialRoute(RPC_URL.replace(".com/", ".com:443/"))?.kind, "query");
    for (const url of [RPC_URL.replace("https:", "http:"), RPC_URL.replace(".com/", ".com:444/"),
        RPC_URL.replace("guoguouser.cainiao.com", "guoguouser.cainiao.com.evil.invalid"), RPC_URL + "/extra", RPC_URL + "#x",
        RPC_URL.replace("/1.0.0/", "/2.0.0/"), RPC_URL.replace("queryWidgetDetailsV2", "queryWidgetDetails")])
        assert.equal(official.cwOfficialRoute(url), null, url);
    assert.equal(official.cwOfficialRoute(RPC_URL, headers([["Host", "acs.m.taobao.com"]])), null);
});

test("官方 route 对头类型、冲突重复、控制字符和超大 Host 失败关闭", () => {
    for (const value of [{Host: true}, {Host: ["acs.m.taobao.com", "evil.invalid"]}, {Host: "acs.m.taobao.com\r\nX:1"},
        {Host: "a".repeat(70000)}, {getAll: () => "acs.m.taobao.com"}]) assert.equal(official.cwOfficialRoute(tokenURL(), value), null);
    assert(official.cwOfficialRoute(tokenURL(), {Host: ["acs.m.taobao.com", "acs.m.taobao.com"]}));
});

test("无专用状态返回 null，原 H5 空状态仍由主组件提示接入", async () => {
    const f = officialFixture();
    const base = {items: [], total: 0, updatedAt: null, refreshMinutes: 15, privacy: false};
    assert.equal(await official.loadCainiaoOfficialModel(f.ctx, f.clock, base, runtime.cwBounded), null);
    assert.equal((await load(f)).status, "setup"); assert.equal(f.requests.length, 0);
});

test("签发请求只建本机票据，不读正文、不查询、不保存原生证明", async () => {
    const f = officialFixture(), hook = tokenRequest(f, {extra: [["x-sign", SIGN], ["x-mini-wua", "synthetic-wua-private"]]});
    const original = hook.ctx.request.headers;
    assert.equal(await official.captureCainiaoOfficialRequest(hook.ctx, f.clock), undefined);
    assert.deepEqual(hook.calls, {arrayBuffer: 0, text: 0}); assert.equal(hook.ctx.request.headers, original);
    assert(saved(f)); assert.equal(saved(f).status, "waiting_token"); assert.equal(f.requests.length, 0);
    for (const marker of [SIGN, "synthetic-wua-private", SESSION, UID, hook.ctx.request.url]) assert(!memoryJSON(f).includes(marker));
});

test("同次 token API SUCCESS 的真实 result 绑定账号，原响应字节透传", async () => {
    for (const method of ["GET", "POST"]) {
        const f = officialFixture(); await issue(f, {method});
        assert.equal(saved(f).token, TOKEN); assert.equal(saved(f).status, "waiting_template");
        assert.equal(saved(f).owner, core.cwOwner(new Map([["unb", UID]])));
        assert.equal(saved(f).snapshot, null); assert.equal(saved(f).successCount, 0); assert.equal(f.requests.length, 0);
        assertNoPrivateLines(f);
    }
});

test("未见签发请求或请求 URL 换票的响应不采纳 token", async () => {
    for (const mode of ["no-ticket", "changed-url"]) {
        const f = officialFixture(), request = tokenRequest(f);
        if (mode === "changed-url") {
            await official.captureCainiaoOfficialRequest(request.ctx, f.clock);
            request.ctx.request.url = tokenURL({t: NOW + 1});
        }
        const hook = tokenReply(request); assertPassthrough(await official.captureCainiaoOfficialResponse(hook.ctx, f.clock), hook);
        assert(!saved(f)?.token); assert.equal(posts(f).length, 0);
    }
});

test("公共 SUCCESS、HTTP 非200、失败 ret 和非字符串 result 都不签发会话", async () => {
    const bodies = [{ret: ["SUCCESS::公共"], data: {t: String(NOW)}},
        {api: "mtop.common.getTimestamp", ret: ["SUCCESS::公共"], data: {result: TOKEN}},
        {ret: ["SUCCESS::合成"], data: {token: TOKEN}}, {ret: ["FAIL_SYS_SESSION_EXPIRED::synthetic"], data: {result: TOKEN}},
        {ret: ["SUCCESS::合成", "FAIL_SYS_USER_VALIDATE::合成"] , data: {result: TOKEN}},
        ...["", null, true, 123, {}, []].map(result => ({ret: ["SUCCESS::合成"], data: {result}}))];
    for (const body of bodies) {
        const f = officialFixture(); await issue(f, {body}); assert(!saved(f)?.token);
        assert.equal(posts(f).length, 0); assert.equal(saved(f)?.successCount || 0, 0);
    }
    for (const status of [201, 301, 401, 403, 500]) {
        const f = officialFixture(); await issue(f, {status}); assert(!saved(f)?.token); assert.equal(posts(f).length, 0);
    }
    const f = officialFixture(), request = tokenRequest(f, {url: tokenURL().replace(TOKEN_API, "mtop.common.gettimestamp")});
    assert.equal(await official.captureCainiaoOfficialRequest(request.ctx, f.clock), undefined);
    const hook = tokenReply(request);
    assert.equal(await official.captureCainiaoOfficialResponse(hook.ctx, f.clock), undefined);
    assert.deepEqual(hook.calls, {arrayBuffer: 0, text: 0}); assert(!saved(f)?.token);
});

test("签发账号只来自同次合法 unb/x-uid，不跨请求拼接或接受非法 UID", async () => {
    for (const uid of [null, "0", "01", "9".repeat(21), "synthetic-user", true]) {
        const f = officialFixture(), request = tokenRequest(f, {uid, unb: null});
        await official.captureCainiaoOfficialRequest(request.ctx, f.clock);
        const hook = tokenReply(request); await official.captureCainiaoOfficialResponse(hook.ctx, f.clock);
        assert(!saved(f)?.token); assert.equal(posts(f).length, 0);
    }
    const f = officialFixture();
    const first = tokenRequest(f, {uid: UID, unb: null}); await official.captureCainiaoOfficialRequest(first.ctx, f.clock);
    const anonymous = tokenRequest(f, {uid: null, unb: null, url: tokenURL({t: NOW + 1})});
    await official.captureCainiaoOfficialRequest(anonymous.ctx, f.clock);
    await official.captureCainiaoOfficialResponse(tokenReply(anonymous).ctx, f.clock);
    assert(!saved(f)?.token);
});

test("已有专用账号面对同次 unb/x-uid 或重复 UID 冲突必须隔离", async () => {
    for (const options of [{uid: OTHER_UID, unb: UID}, {extra: [["x-uid", OTHER_UID]]}]) {
        const {f} = await connected(), count = f.requests.length;
        f.advance(1); const request = tokenRequest(f, options);
        await official.captureCainiaoOfficialRequest(request.ctx, f.clock);
        await official.captureCainiaoOfficialResponse(tokenReply(request).ctx, f.clock);
        const model = await load(f);
        assert.notEqual(model.status, "ready"); assert.deepEqual(model.items, []); assert.equal(model.updatedAt, null);
        assert.equal(f.requests.length, count);
    }
});

test("新签发请求替换票据后，旧请求的 token 响应不得覆盖新会话", async () => {
    const f = officialFixture(), old = tokenRequest(f); await official.captureCainiaoOfficialRequest(old.ctx, f.clock);
    f.advance(1000); await issue(f, {token: OTHER_TOKEN}); const current = structuredClone(saved(f));
    const reply = tokenReply(old); assertPassthrough(await official.captureCainiaoOfficialResponse(reply.ctx, f.clock), reply);
    assert.deepEqual(saved(f), current); assert.equal(saved(f).token, OTHER_TOKEN);
});

test("过时签发响应不得续期或采纳 token", async () => {
    const f = officialFixture(), request = tokenRequest(f); await official.captureCainiaoOfficialRequest(request.ctx, f.clock);
    f.advance(7 * DAY + 1);
    const hook = tokenReply(request); assertPassthrough(await official.captureCainiaoOfficialResponse(hook.ctx, f.clock), hook);
    assert(!saved(f)?.token); assert.equal(posts(f).length, 0);
});

test("实际 iOS source/channel/brand 与授权版本只能从匹配模板采集", async () => {
    for (const version of [1, 2]) {
        const f = officialFixture(); await issue(f);
        await captureTemplate(f, {body: template({changes: {version}})});
        assert.equal(saved(f).status, "pending"); f.replies.push(queryReply()); assertReady(await load(f));
        assertNewPost(posts(f)[0], TOKEN, template({changes: {version}}).argsObjs[0]);
        assert(!JSON.stringify(saved(f).template).includes("Android"));
    }
});

test("只有专用 token 而没有实际 RPC 模板时不猜 Android 请求或退到 H5", async () => {
    const f = officialFixture(); await issue(f);
    const model = await load(f); assert.equal(model.status, "setup"); assert.equal(model.updatedAt, null);
    assert.deepEqual(model.items, []); assert.equal(f.requests.length, 0); assert.equal(saved(f).status, "waiting_template");
    assert(!memoryJSON(f).includes('"source":"Android"'));
});

test("模板 token 必须与该代次签发结果逐字相等，不能借另一份 token", async () => {
    for (const token of [OTHER_TOKEN, TOKEN + " ", "sid-is-not-widget-token", "synthetic-h5-token_1"]) {
        const f = officialFixture(); await issue(f); await captureTemplate(f, {body: template({token})});
        const model = await load(f); assert.notEqual(model.status, "ready"); assert.equal(f.requests.length, 0);
        assert.equal(saved(f).token, TOKEN); assert.equal(saved(f).snapshot, null);
    }
});

test("实际模板的必需参数类型或版本未知时停止，不补默认值", async () => {
    const changes = [{appName: "GUOGUO"}, {source: ""}, {source: 1}, {brand: null}, {channel: {}},
        {version: "1"}, {version: 3}, {timestamp: 1.5}, {timestamp: "123"},
        {installStatus: {}}, {installStatus: "[]"}, {installStatus: '{"isLargeInstall":"true"}'},
        {ext: {apiVersion: "V3"}}, {ext: '{"apiVersion":"V4"}'}];
    for (const values of changes) {
        const f = officialFixture(); await issue(f); await captureTemplate(f, {body: template({changes: values})});
        assert.equal(f.requests.length, 0); assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
    }
    const f = officialFixture(); await issue(f);
    const body = template(); delete body.argsObjs[0].source;
    await captureTemplate(f, {body}); assert.equal(f.requests.length, 0); assert.equal((await load(f)).status, "setup");
});

test("RPC 包装、未知业务字段及未知安装键不兼容时不建立可查询模板", async () => {
    const ordinary = template();
    const bodies = [ordinary.argsObjs, {...ordinary, argsTypes: [ARG_TYPE, ARG_TYPE]}, {...ordinary, argsObjs: [ordinary.argsObjs[0], ordinary.argsObjs[0]]},
        {...ordinary, argsTypes: [ARG_TYPE + "Unknown"]}, {...ordinary, syntheticUnknownRoot: true},
        template({changes: {userId: UID}}), template({changes: {deviceProof: "synthetic-proof"}}),
        template({changes: {installStatus: JSON.stringify({...JSON.parse(INSTALL), unknownInstall: true})}})];
    for (const body of bodies) {
        const f = officialFixture(); await issue(f); await captureTemplate(f, {body});
        assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
    }
});

test("可选 lbs 和 App 设备/会话证明不保存、不发往新 RPC", async () => {
    const f = officialFixture(); await issue(f);
    const position = "121.123456,31.654321", device = "synthetic-private-device-proof";
    await captureTemplate(f, {body: template({changes: {lbs: position}}), uid: UID,
        cookie: "unb=" + UID + "; cookie2=" + SESSION, extra: [["x-sign", SIGN], ["x-mini-wua", device], ["x-sid", "synthetic-native-sid"]]});
    f.replies.push(queryReply()); assertReady(await load(f)); const request = posts(f)[0]; assertNewPost(request);
    for (const marker of [position, SESSION, SIGN, device, "synthetic-native-sid", UID]) {
        assert(!JSON.stringify(saved(f)).includes(marker)); assert(!JSON.stringify(request.options).includes(marker));
    }
});

test("第一次主组件运行产生新 POST，只有两官方头、自身标记和实际模板", async () => {
    const f = officialFixture(); await bound(f); f.advance(1000); f.replies.push(queryReply());
    const model = await load(f); assertReady(model); assert.equal(f.requests.length, 1);
    const body = assertNewPost(posts(f)[0]); assert.equal(body.timestamp, f.clock()); assert.notEqual(body.timestamp, NOW);
    assert.equal(saved(f).requestCount, 1); assert.equal(saved(f).successCount, 1);
});

test("模拟关闭 App 后不再 capture，第二次仍发新的 POST 和递增 timestamp", async () => {
    const {f, model: first} = await connected(); const one = assertNewPost(posts(f)[0]);
    f.advance(5 * 60000); f.replies.push(queryReply({items: [item({logisticsStatusSimpleDesc: "合成关闭 App 后新摘要"})], total: 2}));
    const two = await load(f); assertReady(two); assert.equal(posts(f).length, 2); const next = assertNewPost(posts(f)[1]);
    assert(next.timestamp > one.timestamp); assert(Date.parse(two.updatedAt) > Date.parse(first.updatedAt));
    assert.equal(two.total, 2); assert.equal(two.items[0].summary, "合成关闭 App 后新摘要");
    assert.equal(saved(f).requestCount, 2); assert.equal(saved(f).successCount, 2);
});

test("即使两次运行处于同一毫秒，新查询 timestamp 也不能复用", async () => {
    const {f} = await connected(); const one = assertNewPost(posts(f)[0]);
    f.replies.push(queryReply()); assertReady(await load(f)); const two = assertNewPost(posts(f)[1]);
    assert(two.timestamp > one.timestamp);
});

test("App RPC 响应不读正文、不存包裹，也不能代替组件的新查询", async () => {
    const f = officialFixture(); await bound(f); const previous = structuredClone(saved(f));
    const hook = rpcRequest(f); const appText = "synthetic-private-app-parcel-response";
    const ctx = {...hook.ctx, response: {status: 200, headers: headers(),
        arrayBuffer: async () => {throw new Error("不得读取 App 包裹响应 " + appText);}, text: async () => {throw new Error(appText);}}};
    assert.equal(await official.captureCainiaoOfficialResponse(ctx, f.clock), undefined);
    assert.deepEqual(saved(f), previous); assert.equal(saved(f).snapshot, null); assert(!memoryJSON(f).includes(appText));
    f.replies.push(queryReply()); assertReady(await load(f)); assert.equal(posts(f).length, 1);
});

test("官方摘要成功不写 H5 完整 PDS 确认、身份检查或 COUNT 请求", async () => {
    const f = officialFixture(); await bound(f);
    assert.equal(f.memory.get(core.CW_AUTH_STORE), undefined); assert.equal(f.memory.get(core.CW_STORE), undefined);
    f.replies.push(queryReply()); const model = await load(f); assertReady(model);
    assert.equal(f.memory.get(core.CW_AUTH_STORE), undefined); assert.equal(f.memory.get(core.CW_STORE), undefined);
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url.href, RPC_URL);
    assert(!/完整.*(?:成功|确认)|结构化取件码.*(?:成功|确认)/.test(model.message));
});

test("待取摘要严格筛数值 900，不退回字符串900、在途或任意第一条", async () => {
    const values = [item({logisticsStatus: 10101, logisticsStatusSimpleDesc: "synthetic-transit-do-not-display"}),
        item({logisticsStatus: "900", logisticsStatusSimpleDesc: "synthetic-string900-do-not-display"}),
        item({logisticsStatus: 1, logisticsStatusSimpleDesc: "synthetic-other-do-not-display"}),
        item({logisticsStatus: 900, logisticsStatusSimpleDesc: "合成真正待取摘要"})];
    const {model} = await connected({items: values, total: 7});
    assert.equal(model.total, 7); assert.equal(model.items.length, 1); assert.equal(model.items[0].summary, "合成真正待取摘要");
    for (const marker of ["synthetic-transit", "synthetic-string900", "synthetic-other"]) assert(!JSON.stringify(model).includes(marker));
});

test("正计数但没有可用待取摘要仍保留件数，不能写成没有待取", async () => {
    for (const items of [[], [item({logisticsStatus: 10101})], [item({logisticsStatusSimpleDesc: ""})]]) {
        const {model} = await connected({items, total: 5});
        assert.equal(model.total, 5); assert.deepEqual(model.items, []); assert.match(model.message, /摘要未提供/);
        assert(!/没有待取|暂无待取|没有包裹/.test(model.message));
    }
});

test("只使用 packageInfo.agentSignPackNum，不混拼 V2 计数或数组长度", async () => {
    const f = officialFixture(); await bound(f);
    const body = queryBody({items: [item()], total: 9});
    body.data.packageInfo.agentSignNum = 77;
    body.data.packageInfoV2 = {agentSignNum: 88, agentSignPackNum: 99, packageItemInfoList: [item({logisticsStatusSimpleDesc: "synthetic-v2-ignore"})]};
    f.replies.push(response(body)); const model = await load(f); assertReady(model); assert.equal(model.total, 9);
    assert(!JSON.stringify(model).includes("synthetic-v2-ignore"));
    const other = officialFixture(); await bound(other);
    other.replies.push(response({success: true, data: {status: "SUCCESS", packageInfoV2: body.data.packageInfoV2}}));
    assert.notEqual((await load(other)).status, "ready"); assert.equal(saved(other).successCount, 0);
});

test("摘要中的数字和 hasAuthCode 不成为结构化取件码或完整列表确认", async () => {
    const {model} = await connected({items: [item({logisticsStatusSimpleDesc: "合成取件信息 8-2-2046，短信 13500000000", hasAuthCode: true})]});
    assert.equal(model.items[0].code, ""); assert.equal(model.items[0].summary, "合成取件信息 8-2-2046，短信 13500000000");
    assert.equal(model.items[0].station, "合成官方驿站"); assert.equal(model.complete, false); assert.equal(model.pickupCodesConfirmed, false);
});

test("真实零计数和空摘要也必须由新查询成功确认，不能由捕获默认成零", async () => {
    const f = officialFixture(); await bound(f); assert.equal(saved(f).snapshot, null); assert.equal(saved(f).successCount, 0);
    f.replies.push(queryReply({items: [], total: 0})); const model = await load(f); assertReady(model);
    assert.equal(model.total, 0); assert.deepEqual(model.items, []); assert.equal(posts(f).length, 1); assert.equal(saved(f).successCount, 1);
});

test("QUERY_ERROR、false、非法结构及网络错误只回退原摘要和原更新时间", async () => {
    const failures = [response(queryBody({status: "QUERY_ERROR"})), response({success: false, data: {message: "synthetic-server-secret"}}),
        response({success: true, data: {status: "SUCCESS", packageInfo: {agentSignPackNum: "1", packageItemInfoList: []}}}),
        response("{not-json"), response(queryBody(), [], 500), new Error("synthetic-official-network-secret")];
    for (const failure of failures) {
        const {f, model: old} = await connected(); const previous = structuredClone(saved(f).snapshot), successes = saved(f).successCount;
        f.advance(1000); f.replies.push(failure); const model = await load(f);
        assert.notEqual(model.status, "ready"); assert.deepEqual(model.items, old.items); assert.equal(model.total, old.total);
        assert.equal(model.updatedAt, old.updatedAt); assert.deepEqual(saved(f).snapshot, previous); assert.equal(saved(f).successCount, successes);
        assert(!memoryJSON(f).includes("synthetic-server-secret")); assertNoPrivateLines(f, ["synthetic-official-network-secret"]);
    }
});

test("INVALID_TOKEN 明确停止，相同 token 重复签发和模板不能复活该代次", async () => {
    const {f, model: old} = await connected(); f.advance(1000); f.replies.push(queryReply({status: "INVALID_TOKEN"}));
    const rejected = await load(f); assert.notEqual(rejected.status, "ready"); assert.equal(rejected.updatedAt, old.updatedAt);
    assert.equal(saved(f).status, "expired"); const generation = saved(f).generation, count = posts(f).length;
    f.advance(1000); await issue(f); await captureTemplate(f);
    assert.equal(saved(f).status, "expired"); assert.equal(saved(f).generation, generation);
    const stopped = await load(f); assert.notEqual(stopped.status, "ready"); assert.equal(stopped.updatedAt, old.updatedAt);
    assert.equal(posts(f).length, count); assertNoPrivateLines(f);
});

test("新 token 不能继承旧模板，实际新模板绑定后才能重新新查询", async () => {
    const {f} = await connected(); f.replies.push(queryReply({status: "INVALID_TOKEN"})); await load(f);
    const count = posts(f).length, generation = saved(f).generation; f.advance(1000); await issue(f, {token: OTHER_TOKEN});
    assert.equal(saved(f).status, "waiting_template"); assert.notEqual(saved(f).generation, generation);
    assert.equal((await load(f)).status, "setup"); assert.equal(posts(f).length, count);
    await captureTemplate(f, {body: template({token: OTHER_TOKEN, timestamp: f.clock()})});
    f.replies.push(queryReply()); assertReady(await load(f)); assert.equal(posts(f).length, count + 1); assertNewPost(posts(f).at(-1), OTHER_TOKEN);
});

test("首次查询业务失败不能写 ready、更新时间、摘要或成功计数", async () => {
    for (const failure of [response(queryBody({status: "QUERY_ERROR"})), response({success: false}), response({ret: ["SUCCESS::公共时间"], data: {t: NOW}})]) {
        const f = officialFixture(); await bound(f); f.replies.push(failure); const model = await load(f);
        assert.notEqual(model.status, "ready"); assert.equal(model.updatedAt, null); assert.deepEqual(model.items, []);
        assert.equal(saved(f).snapshot, null); assert.equal(saved(f).successCount, 0); assert.equal(posts(f).length, 1);
    }
});

test("未知服务端文本、数值 code 和异常原文不进入失败状态或诊断", async () => {
    const privateText = "synthetic-server-private-token-900000000000000009";
    for (const reply of [response({success: false, code: 1234567, message: privateText, data: {status: privateText}}), new Error(privateText)]) {
        const f = officialFixture(); await bound(f); f.replies.push(reply); await load(f);
        assert(!memoryJSON(f).includes(privateText)); assertNoPrivateLines(f, [privateText, "1234567"]);
    }
});

test("锁屏默认隐藏可能含取件信息的完整官方摘要，显式允许才显示", async () => {
    for (const family of ["accessoryInline", "accessoryCircular", "accessoryRectangular"]) {
        const f = officialFixture(); f.ctx.widgetFamily = family; await bound(f); f.replies.push(queryReply());
        const model = await load(f); assertReady(model); assert.equal(model.privacy, true);
        const json = JSON.stringify(render.renderWidget(model, family, f.clock()));
        assert(!json.includes("8-2-2046")); assert(!json.includes("合成摘要")); assert(!json.includes("合成官方驿站"));
    }
    const f = officialFixture(); f.ctx.widgetFamily = "accessoryRectangular"; f.ctx.env.LOCKSCREEN_SHOW_CODE = "true";
    await bound(f); f.replies.push(queryReply()); const model = await load(f); assert.equal(model.privacy, false);
    assert(JSON.stringify(render.renderWidget(model, f.ctx.widgetFamily, f.clock())).includes("8-2-2046"));
});

test("官方连接状态只读且不泄露 token、UID、URL、摘要或内部归属摘要", async () => {
    const {f} = await connected(); const memory = structuredClone([...f.memory]), writes = f.writes.length, count = f.requests.length;
    const text = assertNoPrivateLines(f, ["8-2-2046", "合成官方驿站", "合成摘要"]);
    assert(text.length < 6000); assert(!/完整.*(?:已确认|成功)/.test(text));
    assert.deepEqual([...f.memory], memory); assert.equal(f.writes.length, writes); assert.equal(f.requests.length, count);
});

test("签发或模板存储 noop/throw 时未取得归属，不发送任何个人查询", async () => {
    for (const failure of ["noop", "throw"]) for (const stage of ["issue", "template"]) {
        const f = officialFixture(); if (stage === "template") await issue(f);
        const write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {
            if (key === core.CW_OFFICIAL_STORE) {if (failure === "throw") throw new Error("synthetic-official-write-private"); return;}
            write(key, value);
        };
        if (stage === "issue") await issue(f); else await captureTemplate(f);
        assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
        assert(!memoryJSON(f).includes("synthetic-official-write-private"));
    }
});

test("查询 runId 初写未确认时不能借已保存 token 发 POST", async () => {
    for (const failure of ["noop", "throw"]) {
        const f = officialFixture(); await bound(f); const write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {
            if (key === core.CW_OFFICIAL_STORE) {if (failure === "throw") throw new Error("synthetic-query-run-write-failed"); return;}
            write(key, value);
        };
        f.replies.push(queryReply()); const model = await load(f);
        assert.notEqual(model.status, "ready"); assert.equal(f.requests.length, 0); assert.equal(saved(f).successCount, 0);
    }
});

test("H5 新账号保存失败留下 B 屏障时，旧官方 A 不得继续查询或显示旧摘要", async () => {
    const {f} = await connected(); const count = f.requests.length;
    f.memory.set(core.CW_STORE, {version: "synthetic-unknown-version", owner: core.cwOwner(new Map([["unb", OTHER_UID]])),
        source: "capture", blocked: true, cookie: "", snapshot: null});
    const model = await load(f); assert.notEqual(model.status, "ready"); assert.deepEqual(model.items, []); assert.equal(model.updatedAt, null);
    assert.equal(f.requests.length, count); assert.equal(f.memory.get(core.CW_STORE).blocked, true);
});

test("新官方 B 签发不得带入 A 模板和摘要，匹配 B 模板后才查询", async () => {
    const {f} = await connected(); const previous = structuredClone(saved(f)), count = f.requests.length;
    f.advance(1000); await issue(f, {uid: OTHER_UID, token: OTHER_TOKEN});
    assert.notEqual(saved(f).owner, previous.owner); assert.notEqual(saved(f).generation, previous.generation);
    assert.equal(saved(f).status, "waiting_template"); assert.equal(saved(f).snapshot, null);
    const pending = await load(f); assert.equal(pending.status, "setup"); assert.deepEqual(pending.items, []); assert.equal(pending.updatedAt, null);
    assert.equal(f.requests.length, count);
    await captureTemplate(f, {body: template({token: OTHER_TOKEN})}); f.replies.push(queryReply({items: [], total: 0}));
    assertReady(await load(f)); assertNewPost(posts(f).at(-1), OTHER_TOKEN);
});

test("已知 logout 原请求不改且停止旧专用会话，普通同值 token 不复活退出", async () => {
    const {f} = await connected(); const count = f.requests.length;
    const url = "https://acs.m.taobao.com/gw/com.taobao.mtop.mLoginUnitService.logout/*/";
    const ctx = f.incoming("unb=" + UID + "; cookie2=" + SESSION, url, [["x-uid", UID]]), original = ctx.request.headers;
    assert.equal(await runtime.default(ctx), undefined); assert.equal(ctx.request.headers, original); assert.equal(ctx.request.url, url);
    assert.equal(saved(f).status, "signed_out"); const model = await load(f);
    assert.notEqual(model.status, "ready"); assert.deepEqual(model.items, []); assert.equal(f.requests.length, count);
});

test("token 读体等待期间换账号，旧响应仍透传但不得覆盖 B", {timeout: 3000}, async () => {
    const f = officialFixture(), request = tokenRequest(f); await official.captureCainiaoOfficialRequest(request.ctx, f.clock);
    const entered = deferred(), release = deferred();
    const hook = tokenReply(request, {read: bytes => {entered.resolve(); return release.promise.then(() => bytes.slice().buffer);}});
    const task = official.captureCainiaoOfficialResponse(hook.ctx, f.clock); await entered.promise;
    f.advance(1000); await issue(f, {uid: OTHER_UID, token: OTHER_TOKEN}); const current = structuredClone(saved(f));
    release.resolve(); assertPassthrough(await task, hook);
    assert.deepEqual(saved(f), current); assert.equal(saved(f).token, OTHER_TOKEN); assert.equal(f.requests.length, 0);
});

test("RPC 模板读体等待期间新 token 签发，旧模板不能拼到新代次", {timeout: 3000}, async () => {
    const f = officialFixture(); await issue(f); const entered = deferred(), release = deferred();
    const hook = rpcRequest(f, {read: bytes => {entered.resolve(); return release.promise.then(() => bytes.slice().buffer);}});
    const task = official.captureCainiaoOfficialRequest(hook.ctx, f.clock); await entered.promise;
    f.advance(1000); await issue(f, {token: OTHER_TOKEN}); const current = structuredClone(saved(f));
    release.resolve(); assertPassthrough(await task, hook); assert.deepEqual(saved(f), current);
    assert.equal((await load(f)).status, "setup"); assert.equal(f.requests.length, 0);
});

test("旧 POST 响应晚于新 token 与新查询时不覆写归属，不返回旧摘要", {timeout: 3000}, async () => {
    const f = officialFixture(); await bound(f); const entered = deferred(), release = deferred();
    f.replies.push(() => {entered.resolve(); return release.promise;}); const old = load(f); await entered.promise;
    f.advance(1000); await issue(f, {token: OTHER_TOKEN}); await captureTemplate(f, {body: template({token: OTHER_TOKEN})});
    f.replies.push(queryReply({items: [item({logisticsStatusSimpleDesc: "合成新代次摘要"})], total: 3}));
    const current = await load(f); assertReady(current); const state = structuredClone(saved(f));
    release.resolve(queryReply({items: [item({logisticsStatusSimpleDesc: "synthetic-late-old-summary"})], total: 9}));
    const stale = await old; assert.notEqual(stale.status, "ready"); assert(!JSON.stringify(stale).includes("synthetic-late-old-summary"));
    assert.deepEqual(saved(f), state); assert.equal(saved(f).snapshot.updatedAt, current.updatedAt); assert.equal(posts(f).length, 2);
});

test("off 清所有组件本机键包括 official，保持其它应用键原样且不发请求", async () => {
    const {f} = await connected(); f.memory.set("synthetic-other-application-key", {preserved: true});
    f.ctx.env.CONNECTION_MODE = "off"; const count = f.requests.length;
    const model = await load(f); assert.equal(model.status, "setup"); assert.equal(model.setupTitle, "连接已关闭");
    assert.equal(f.memory.get(core.CW_OFFICIAL_STORE), null); assert.equal(f.requests.length, count);
    assert.deepEqual(f.memory.get("synthetic-other-application-key"), {preserved: true});
});

test("self 标记、manual 与 off 入口不读取或采集专用正文", async () => {
    for (const mode of ["manual", "off"]) {
        const f = officialFixture(); f.ctx.env.CONNECTION_MODE = mode;
        const req = tokenRequest(f), rpc = rpcRequest(f);
        assert.equal(await official.captureCainiaoOfficialRequest(req.ctx, f.clock), undefined);
        assert.equal(await official.captureCainiaoOfficialRequest(rpc.ctx, f.clock), undefined);
        const reply = tokenReply(req);
        assert.equal(await official.captureCainiaoOfficialResponse(reply.ctx, f.clock), undefined);
        assert.deepEqual(reply.calls, {arrayBuffer: 0, text: 0});
        assert.deepEqual(rpc.calls, {arrayBuffer: 0, text: 0}); assert(!saved(f)); assert.equal(f.requests.length, 0);
    }
    const f = officialFixture(), request = tokenRequest(f, {extra: [[core.CW_SELF_HEADER, "1"]]});
    const rpc = rpcRequest(f, {extra: [[core.CW_SELF_HEADER, "1"]]});
    assert.equal(await official.captureCainiaoOfficialRequest(request.ctx, f.clock), undefined);
    assert.equal(await official.captureCainiaoOfficialRequest(rpc.ctx, f.clock), undefined);
    const reply = tokenReply(request);
    assert.equal(await official.captureCainiaoOfficialResponse(reply.ctx, f.clock), undefined);
    assert.deepEqual(reply.calls, {arrayBuffer: 0, text: 0});
    assert.deepEqual(rpc.calls, {arrayBuffer: 0, text: 0}); assert(!saved(f));
});

test("1.2.4 合法 H5 auth/cache 仍只读迁移，不虚构官方状态或复活终止", async () => {
    for (const status of ["pending", "connected", "expired", "verify", "invalid"]) {
        const f = officialFixture(), cookie = "unb=" + UID + "; cookie2=" + SESSION;
        const values = core.cwCookieMap(cookie), owner = core.cwOwner(values), generation = digest("synthetic-legacy-official-fallback:" + status);
        const state = {version: "1.2.4", owner, sessionHash: auth.cwSessionHash(values), generation, inputHash: digest(core.cwCookieHeader(values)),
            cookie: core.cwCookieHeader(values), status, capturedAt: NOW - 1000, confirmedAt: status === "connected" ? NOW - 500 : null,
            sourceHost: "acs.m.taobao.com", captureKind: "request_cookie", sourceChannel: "h5", accountCheckedAt: null, accountSessionHash: ""};
        const oldItems = core.cwItems([parcel("official-legacy", "8-1-1111")]);
        const cache = {version: "1.2.4", source: "auto", owner, generation, inputHash: state.inputHash, cookie: state.cookie,
            runId: digest("synthetic-legacy-cache-run"), observedUnb: UID, accountCheckedAt: null, accountSessionHash: "",
            terminalStatus: ["expired", "verify", "invalid"].includes(status) ? status : "",
            snapshot: status === "connected" ? {items: oldItems, updatedAt: new Date(NOW - 500).toISOString()} : null};
        f.memory.set(core.CW_AUTH_STORE, structuredClone(state)); f.memory.set(core.CW_STORE, structuredClone(cache));
        const before = structuredClone([...f.memory]), writes = f.writes.length;
        assert(auth.cwReadAuth(f.ctx, f.clock())); assertNoPrivateLines(f);
        assert.deepEqual([...f.memory], before); assert.equal(f.writes.length, writes); assert.equal(saved(f), undefined);
        if (["expired", "verify", "invalid"].includes(status)) {
            assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 0);
        } else {
            f.replies.push(response({ret: ["SUCCESS::旧 H5"], data: {packages: [parcel("official-h5-new")], totalPage: 1, currentPage: 1}}));
            const model = await load(f); assert.equal(model.status, "ready"); assert.equal(posts(f).length, 0);
            assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url.searchParams.get("api"), core.CW_API);
        }
    }
});

test("专用旧摘要超过七天失败时不显示过时取件信息", async () => {
    const {f} = await connected(); f.advance(7 * DAY + 1); f.replies.push(new Error("synthetic-week-old-offline"));
    const model = await load(f); assert.notEqual(model.status, "ready"); assert.deepEqual(model.items, []);
    assert(!JSON.stringify(model).includes("8-2-2046"));
});

test("十八秒预算耗尽的迟到响应不能写本次摘要查询成功", async () => {
    const f = officialFixture(); await bound(f);
    f.replies.push(() => {f.advance(18001); return queryReply();});
    const model = await load(f); assert.notEqual(model.status, "ready"); assert.equal(model.updatedAt, null);
    assert.equal(saved(f).snapshot, null); assert.equal(saved(f).successCount, 0); assert.equal(posts(f).length, 1);
});

test("读取异常或已声明超限不伪造空正文；读到的未知字节始终原样透传", async () => {
    const f = officialFixture(); await issue(f);
    const failure = rpcRequest(f, {read: () => {throw new Error("synthetic-body-private-read-failure");}});
    assert.equal(await official.captureCainiaoOfficialRequest(failure.ctx, f.clock), undefined);
    assert.deepEqual(failure.calls, {arrayBuffer: 1, text: 0});
    const large = rpcRequest(f, {extra: [["Content-Length", String(256 * 1024 + 1)]]});
    assert.equal(await official.captureCainiaoOfficialRequest(large.ctx, f.clock), undefined);
    assert.deepEqual(large.calls, {arrayBuffer: 0, text: 0});
    for (const body of [new Uint8Array([0, 255, 123, 10, 13]), "not-json", new Uint8Array(256 * 1024 + 1)]) {
        const hook = rpcRequest(f, {body}); assertPassthrough(await official.captureCainiaoOfficialRequest(hook.ctx, f.clock), hook);
        assert.equal(posts(f).length, 0);
    }
    assert(!memoryJSON(f).includes("synthetic-body-private-read-failure"));
});

test("压缩模板只透传不解压猜测，非 POST 的 RPC 不读取正文", async () => {
    const f = officialFixture(); await issue(f);
    const compressed = rpcRequest(f, {body: new Uint8Array([31, 139, 8, 0]), extra: [["Content-Encoding", "gzip"]]});
    assertPassthrough(await official.captureCainiaoOfficialRequest(compressed.ctx, f.clock), compressed);
    assert.equal((await load(f)).status, "setup"); assert.equal(f.requests.length, 0);
    const get = rpcRequest(f, {method: "GET"});
    assert.equal(await official.captureCainiaoOfficialRequest(get.ctx, f.clock), undefined);
    assert.deepEqual(get.calls, {arrayBuffer: 0, text: 0});
});

test("同账号并发新 runId 接管，首任务迟到成功或失败都不能覆盖较新结果", {timeout: 3000}, async () => {
    for (const lateFailure of [false, true]) {
        const f = officialFixture(); await bound(f); const entered = deferred(), release = deferred();
        f.replies.push(() => {entered.resolve(); return release.promise;});
        const first = load(f); await entered.promise;
        f.advance(1000); f.replies.push(queryReply({items: [item({logisticsStatusSimpleDesc: "合成并发较新摘要"})], total: 2}));
        const second = await load(f); assertReady(second); const state = structuredClone(saved(f));
        release.resolve(lateFailure ? response({success: false, message: "synthetic-late-failure-private"})
            : queryReply({items: [item({logisticsStatusSimpleDesc: "synthetic-late-success-private"})], total: 9}));
        const old = await first; assert.notEqual(old.status, "ready");
        assert(!JSON.stringify(old).includes("synthetic-late-success-private")); assert.deepEqual(saved(f), state);
        assert.equal(posts(f).length, 2); assert.equal(saved(f).snapshot.updatedAt, second.updatedAt);
    }
});

test("独立响应 text 等待期间新捕获或 off，迟到原文不写成功或恢复会话", {timeout: 3000}, async () => {
    for (const action of ["new-token", "off"]) {
        const f = officialFixture(); await bound(f); const entered = deferred(), release = deferred();
        const late = response({});
        late.text = async () => {entered.resolve(); await release.promise; return JSON.stringify(queryBody({items: [item({logisticsStatusSimpleDesc: "synthetic-late-body-private"})]}));};
        f.replies.push(late); const task = load(f); await entered.promise;
        f.advance(1000);
        if (action === "new-token") await issue(f, {token: OTHER_TOKEN});
        else {f.ctx.env.CONNECTION_MODE = "off"; await load(f);}
        const state = structuredClone(saved(f)); release.resolve(); const old = await task;
        assert.notEqual(old.status, "ready"); assert(!JSON.stringify(old).includes("synthetic-late-body-private"));
        assert.deepEqual(saved(f), state);
        if (action === "off") assert.equal(saved(f), null);
        else {assert.equal(saved(f).token, OTHER_TOKEN); assert.equal(saved(f).snapshot, null);}
    }
});

test("精确入口之外的请求与响应不读取 body，也不改变已有专用会话", async () => {
    const f = officialFixture(); await bound(f); const previous = structuredClone(saved(f));
    for (const url of ["https://evil.invalid/private", "https://acs.m.taobao.com/gw/mtop.common.gettimestamp/*/",
        RPC_URL.replace("queryWidgetDetailsV2", "queryOtherPrivateService")]) {
        const request = rpcRequest(f, {url});
        assert.equal(await official.captureCainiaoOfficialRequest(request.ctx, f.clock), undefined);
        assert.deepEqual(request.calls, {arrayBuffer: 0, text: 0});
        const reply = tokenReply(request);
        assert.equal(await official.captureCainiaoOfficialResponse(reply.ctx, f.clock), undefined);
        assert.deepEqual(reply.calls, {arrayBuffer: 0, text: 0});
        assert.deepEqual(saved(f), previous);
    }
});

test("不透明专用 token 保留百分号原字节，模板及新请求不解码或换成 SID", async () => {
    const token = "synthetic-opaque-widget%2F%2B=~._-", f = officialFixture();
    await issue(f, {token, body: {api: TOKEN_API.toUpperCase(), v: "1.0", ret: ["SUCCESS::合成"], data: {result: token}}});
    assert.equal(saved(f).token, token);
    await captureTemplate(f, {body: template({token})}); f.replies.push(queryReply()); assertReady(await load(f));
    assertNewPost(posts(f)[0], token);
    assert(!posts(f)[0].options.body.includes("synthetic-opaque-widget/+")); assertNoPrivateLines(f, [token]);
});

test("token 响应超限、压缩、读取异常和未知字节不猜凭据且原文正确透传", async () => {
    const f = officialFixture(), request = tokenRequest(f); await official.captureCainiaoOfficialRequest(request.ctx, f.clock);
    const large = tokenReply(request, {extra: [["Content-Length", String(256 * 1024 + 1)]]});
    assert.equal(await official.captureCainiaoOfficialResponse(large.ctx, f.clock), undefined);
    assert.deepEqual(large.calls, {arrayBuffer: 0, text: 0}); assert(!saved(f)?.token);
    const failure = tokenReply(request, {read: () => {throw new Error("synthetic-token-private-read-failure");}});
    assert.equal(await official.captureCainiaoOfficialResponse(failure.ctx, f.clock), undefined);
    assert.deepEqual(failure.calls, {arrayBuffer: 1, text: 0}); assert(!saved(f)?.token);
    for (const options of [{body: new Uint8Array([31, 139, 8, 0]), extra: [["Content-Encoding", "gzip"]]},
        {body: "<html>synthetic-not-token</html>"}, {body: new Uint8Array(256 * 1024 + 1)}]) {
        const hook = tokenReply(request, options);
        assertPassthrough(await official.captureCainiaoOfficialResponse(hook.ctx, f.clock), hook);
        assert(!saved(f)?.token);
    }
    assert(!memoryJSON(f).includes("synthetic-token-private-read-failure")); assert.equal(f.requests.length, 0);
});

// 以下只追加官方摘要及会话归属的风险回归，不改上面的 56 项行为断言。
test("缺失或 null 摘要列表及描述只保留官方真实计数，不伪造零件或码值", async () => {
    for (const missing of ["list_absent", "list_null", "description_absent", "description_null"]) {
        const f = officialFixture(); await bound(f);
        const body = queryBody({total: 5}), info = body.data.packageInfo;
        if (missing === "list_absent") delete info.packageItemInfoList;
        else if (missing === "list_null") info.packageItemInfoList = null;
        else if (missing === "description_absent") delete info.packageItemInfoList[0].logisticsStatusSimpleDesc;
        else info.packageItemInfoList[0].logisticsStatusSimpleDesc = null;
        f.replies.push(response(body)); const model = await load(f); assertReady(model);
        assert.equal(model.total, 5, missing); assert.deepEqual(model.items, [], missing);
        assert.match(model.message, /摘要未提供/); assert(!/没有待取|暂无待取|没有包裹/.test(model.message));
        assert.equal(saved(f).snapshot.total, 5); assert.deepEqual(saved(f).snapshot.items, []);
        assert.equal(saved(f).successCount, 1); assert.equal(posts(f).length, 1); assertNewPost(posts(f)[0]);
    }
});

test("非数组的未知摘要列表结构拒绝，不能当作成功空列表", async () => {
    for (const unknown of [{}, "[]", "synthetic-unknown-list-private", true, false, 1]) {
        const f = officialFixture(); await bound(f);
        f.replies.push(queryReply({items: unknown, total: 5})); const model = await load(f);
        assert.equal(model.status, "error"); assert.equal(model.updatedAt, null); assert.deepEqual(model.items, []);
        assert.equal(saved(f).failure, "SCHEMA_INVALID"); assert.equal(saved(f).successCount, 0); assert.equal(saved(f).snapshot, null);
        assert.equal(posts(f).length, 1); assert.match(model.message, /结构未确认/);
        assert(!memoryJSON(f).includes("synthetic-unknown-list-private")); assertNoPrivateLines(f);
    }
});

test("有效待取摘要条数超过官方计数时拒绝矛盾响应，保留旧摘要和原更新时间", async () => {
    for (const previouslyConnected of [false, true]) for (const total of [0, 1]) {
        const f = previouslyConnected ? (await connected()).f : officialFixture();
        if (!previouslyConnected) await bound(f);
        const previous = structuredClone(saved(f).snapshot), successes = saved(f).successCount, count = posts(f).length;
        f.advance(1000);
        const items = [item({mailNo: "SYNTHETIC-CONTRADICTION-001", logisticsStatusSimpleDesc: "synthetic-contradictory-first"}),
            item({mailNo: "SYNTHETIC-CONTRADICTION-002", logisticsStatusSimpleDesc: "synthetic-contradictory-second"})];
        f.replies.push(queryReply({items, total})); const model = await load(f);
        assert.equal(model.status, "error"); assert.equal(saved(f).failure, "SCHEMA_INVALID");
        assert.equal(saved(f).successCount, successes); assert.deepEqual(saved(f).snapshot, previous);
        assert.equal(model.updatedAt, previous?.updatedAt || null); assert.deepEqual(model.items, previous?.items || []);
        assert(!JSON.stringify(model).includes("synthetic-contradictory")); assert.equal(posts(f).length, count + 1);
    }
});

test("success=false 携带 INVALID_TOKEN 仍属业务失败，不注销已绑定的有效 token", async () => {
    const {f, model: old} = await connected(), previous = structuredClone(saved(f));
    f.advance(1000); f.replies.push(response(queryBody({status: "INVALID_TOKEN", changes: {success: false}})));
    const failed = await load(f);
    assert.equal(failed.status, "error"); assert.equal(saved(f).failure, "BUSINESS_FAILURE"); assert.notEqual(saved(f).status, "expired");
    assert.equal(saved(f).token, previous.token); assert.equal(saved(f).generation, previous.generation);
    assert.deepEqual(saved(f).template, previous.template); assert.deepEqual(saved(f).snapshot, previous.snapshot);
    assert.equal(failed.updatedAt, old.updatedAt); assert.deepEqual(failed.items, old.items); assert.equal(saved(f).successCount, 1);
    f.advance(1000); f.replies.push(queryReply({total: 2})); const next = await load(f); assertReady(next);
    assert.equal(next.total, 2); assert.equal(posts(f).length, 3); assert.equal(saved(f).successCount, 2);
    assertNewPost(posts(f)[2]); assertNoPrivateLines(f);
});

test("同 token 的未知唯一 RPC 参数停止旧模板，pending 和 ready 都不得沿旧参数继续查询", async () => {
    const changes = [{deviceProof: "synthetic-unrecognized-template-private"}, {version: 3}, {source: ""}, {ext: '{"apiVersion":"V4"}'}];
    for (const previouslyConnected of [false, true]) for (const values of changes) {
        const f = previouslyConnected ? (await connected()).f : officialFixture();
        if (!previouslyConnected) await bound(f);
        const previous = structuredClone(saved(f)), count = posts(f).length; f.advance(1000);
        await captureTemplate(f, {body: template({timestamp: f.clock(), changes: values})});
        assert.equal(saved(f).token, previous.token); assert.equal(saved(f).generation, previous.generation);
        assert.equal(saved(f).template, null); assert.equal(saved(f).templateHash, ""); assert.equal(saved(f).templateCapturedAt, null);
        assert.notEqual(saved(f).revision, previous.revision, "停止旧模板必须取消旧执行归属");
        assert.equal(saved(f).failure, "SCHEMA_INVALID"); assert.deepEqual(saved(f).snapshot, previous.snapshot);
        f.replies.push(queryReply()); const model = await load(f); assert.equal(model.status, "setup"); assert.equal(posts(f).length, count);
        assert(!memoryJSON(f).includes("synthetic-unrecognized-template-private")); assertNoPrivateLines(f);
    }
});

test("另一 token 或歧义 RPC 包装的未知参数无权撤销当前合法模板", async () => {
    const unknown = template({changes: {deviceProof: "synthetic-other-template-proof"}});
    const bodies = [template({token: OTHER_TOKEN, changes: {deviceProof: "synthetic-other-template-proof"}}),
        {...unknown, argsTypes: [ARG_TYPE, ARG_TYPE]}, {...unknown, argsObjs: [unknown.argsObjs[0], unknown.argsObjs[0]]},
        {...unknown, argsTypes: [ARG_TYPE + ".Unknown"]}, unknown.argsObjs];
    for (const body of bodies) {
        const {f} = await connected(); const previous = structuredClone(saved(f)); f.advance(1000);
        await captureTemplate(f, {body}); assert.deepEqual(saved(f), previous);
        f.replies.push(queryReply({total: 2})); const model = await load(f); assertReady(model); assert.equal(model.total, 2);
        assert.equal(posts(f).length, 2); assertNewPost(posts(f)[1]); assert(!memoryJSON(f).includes("synthetic-other-template-proof"));
    }
});

test("未知同 token 正文迟到时不得撤销新捕获的合法模板或新代次", {timeout: 3000}, async () => {
    for (const action of ["same_token_new_template", "new_token_new_template"]) {
        const f = officialFixture(); await bound(f); const entered = deferred(), release = deferred();
        const hook = rpcRequest(f, {body: template({changes: {deviceProof: "synthetic-late-unknown-template"}}),
            read: bytes => {entered.resolve(); return release.promise.then(() => bytes.slice().buffer);}});
        const late = official.captureCainiaoOfficialRequest(hook.ctx, f.clock); await entered.promise; f.advance(1000);
        const token = action === "new_token_new_template" ? OTHER_TOKEN : TOKEN;
        if (action === "new_token_new_template") await issue(f, {token});
        const observed = template({token, timestamp: f.clock(), changes: {channel: "synthetic-observed-new-ios-channel"}});
        await captureTemplate(f, {body: observed}); const previous = structuredClone(saved(f));
        release.resolve(); assertPassthrough(await late, hook); assert.deepEqual(saved(f), previous);
        f.replies.push(queryReply()); assertReady(await load(f)); assert.equal(posts(f).length, 1);
        assertNewPost(posts(f)[0], token, observed.argsObjs[0]); assert(!memoryJSON(f).includes("synthetic-late-unknown-template"));
    }
});

test("A 的官方会话观察到公共时间单一 B 身份后停止 A，但不自动为 B 建接入或查询", async () => {
    for (const identity of [{uid: OTHER_UID, unb: null}, {uid: null, unb: OTHER_UID}]) {
        const {f} = await connected(); const count = posts(f).length;
        const url = "https://acs.m.taobao.com/gw/mtop.common.gettimestamp/*/";
        const request = tokenRequest(f, {...identity, url}); f.advance(1000);
        assert.equal(await official.captureCainiaoOfficialRequest(request.ctx, f.clock), undefined);
        assert.deepEqual(request.calls, {arrayBuffer: 0, text: 0});
        assert.equal(saved(f).token, ""); assert.equal(saved(f).template, null); assert.equal(saved(f).snapshot, null); assert.equal(saved(f).issueTicket, null);
        const barrier = structuredClone(f.memory.get(core.CW_STORE));
        assert.equal(barrier.owner, digest("account:" + OTHER_UID)); assert.equal(barrier.blocked, true);
        const publicReply = tokenReply(request);
        assert.equal(await official.captureCainiaoOfficialResponse(publicReply.ctx, f.clock), undefined);
        assert.deepEqual(publicReply.calls, {arrayBuffer: 0, text: 0});
        f.replies.push(queryReply()); const model = await load(f);
        assert.equal(model.status, "setup"); assert.deepEqual(model.items, []); assert.equal(model.updatedAt, null);
        assert.equal(posts(f).length, count); assert.deepEqual(f.memory.get(core.CW_STORE), barrier); assertNoPrivateLines(f);
    }
});

test("明确身份冲突占位隔离后，新的同次一致签发及实际模板可以重新接入", async () => {
    for (const uid of [UID, OTHER_UID]) {
        const {f} = await connected(); const count = posts(f).length, generation = saved(f).generation; f.advance(1000);
        const conflicting = tokenRequest(f, {uid: OTHER_UID, unb: UID});
        assert.equal(await official.captureCainiaoOfficialRequest(conflicting.ctx, f.clock), undefined);
        assert.equal(saved(f).status, "invalid"); assert.equal(saved(f).captureResult, "conflict");
        assert.equal(saved(f).token, ""); assert.equal(saved(f).template, null); assert.equal(saved(f).snapshot, null);
        assert.equal((await load(f)).status, "setup"); assert.equal(posts(f).length, count);
        f.advance(1000); await issue(f, {uid, unb: uid, token: OTHER_TOKEN});
        assert.equal(saved(f).status, "waiting_template"); assert.equal(saved(f).token, OTHER_TOKEN);
        assert.equal(saved(f).owner, digest("account:" + uid)); assert.notEqual(saved(f).generation, generation);
        assert.equal(saved(f).snapshot, null); assert.equal((await load(f)).status, "setup"); assert.equal(posts(f).length, count);
        await captureTemplate(f, {body: template({token: OTHER_TOKEN, timestamp: f.clock()})});
        f.advance(1000); f.replies.push(queryReply()); assertReady(await load(f)); assert.equal(posts(f).length, count + 1);
        assertNewPost(posts(f).at(-1), OTHER_TOKEN); assertNoPrivateLines(f);
    }
});

test("异常远未来 lastRequestAt 不得生成未来 POST 或借旧摘要宣称本轮成功", async () => {
    for (const future of [DAY, 7 * DAY, Number.MAX_SAFE_INTEGER - NOW]) {
        const {f} = await connected(); const count = posts(f).length;
        f.memory.set(core.CW_OFFICIAL_STORE, {...structuredClone(saved(f)), lastRequestAt: f.clock() + future});
        f.replies.push(queryReply()); const model = await load(f);
        assert.notEqual(model.status, "ready"); assert.equal(posts(f).length, count);
        assertNoPrivateLines(f);
    }
});

test("签发响应显式 v 只能为字符串 1.0，缺失允许但其它类型或版本拒绝", async () => {
    for (const version of [undefined, "1.0", "1", "2.0", "", 1, null, true, {}, []]) {
        const f = officialFixture(), body = {api: TOKEN_API.toUpperCase(), ret: ["SUCCESS::合成"], data: {result: TOKEN}};
        if (version !== undefined) body.v = version;
        await issue(f, {body});
        if (version === undefined || version === "1.0") {
            assert.equal(saved(f).token, TOKEN); assert.equal(saved(f).status, "waiting_template");
        } else {
            assert(!saved(f)?.token); assert.equal(saved(f)?.successCount || 0, 0);
        }
        assert.equal(posts(f).length, 0); assertNoPrivateLines(f);
    }
});

test("RPC 路由不接受 query 包括裸问号，越界 URL 不读取正文或撤销实际模板", async () => {
    const f = officialFixture(); await bound(f); const previous = structuredClone(saved(f));
    for (const query of ["?", "?a=1", "?token=" + TOKEN, "?redirect=https%3A%2F%2Fevil.invalid"] ) {
        const url = RPC_URL + query; assert.equal(official.cwOfficialRoute(url), null);
        const hook = rpcRequest(f, {url});
        assert.equal(await official.captureCainiaoOfficialRequest(hook.ctx, f.clock), undefined);
        assert.deepEqual(hook.calls, {arrayBuffer: 0, text: 0}); assert.deepEqual(saved(f), previous);
    }
    assert.equal(posts(f).length, 0);
});

async function defaultIsolationFixture({terminal = false} = {}) {
    const f = officialFixture();
    auth.captureCainiaoCredentials(f.incoming("unb=" + UID + "; cookie2=" + SESSION), f.clock);
    assert.equal(f.memory.get(core.CW_AUTH_STORE).owner, digest("account:" + UID));
    if (terminal) f.memory.set(core.CW_AUTH_STORE, {...f.memory.get(core.CW_AUTH_STORE), status: "expired"});
    await bound(f); f.replies.push(queryReply()); assertReady(await load(f));
    return f;
}

async function failDefaultBSwitch(f, failure) {
    const previous = structuredClone(saved(f)), oldAuth = structuredClone(f.memory.get(core.CW_AUTH_STORE));
    const write = f.ctx.storage.setJSON; f.advance(1000);
    f.ctx.storage.setJSON = (key, value) => {
        if (key === core.CW_OFFICIAL_STORE && value?.owner === digest("account:" + OTHER_UID)) {
            if (failure === "throw") throw new Error("synthetic-default-B-state-write-failed-private");
            return;
        }
        write(key, value);
    };
    try {
        const request = tokenRequest(f, {uid: OTHER_UID, unb: OTHER_UID});
        assert.equal(await runtime.default(request.ctx), undefined); assert.deepEqual(request.calls, {arrayBuffer: 0, text: 0});
    } finally { f.ctx.storage.setJSON = write; }
    const barrier = structuredClone(f.memory.get(core.CW_STORE));
    assert.equal(barrier.owner, digest("account:" + OTHER_UID)); assert.equal(barrier.blocked, true);
    assert.deepEqual(saved(f), previous, "B 写入未确认不能以 H5 旁路变更已有官方 A");
    assert.deepEqual(f.memory.get(core.CW_AUTH_STORE), oldAuth, "官方状态存在时旧 H5 只观察，不改旧 auth");
    assert(!memoryJSON(f).includes("synthetic-default-B-state-write-failed-private"));
    return {previous, oldAuth, barrier};
}

async function reconnectDefaultB(f) {
    const count = posts(f).length; f.advance(1000);
    const request = tokenRequest(f, {uid: OTHER_UID, unb: OTHER_UID});
    assert.equal(await runtime.default(request.ctx), undefined); assert.deepEqual(request.calls, {arrayBuffer: 0, text: 0});
    const reply = tokenReply(request, {token: OTHER_TOKEN}); assertPassthrough(await runtime.default(reply.ctx), reply);
    assert.equal(saved(f).token, OTHER_TOKEN); assert.equal(saved(f).owner, digest("account:" + OTHER_UID));
    assert.equal(saved(f).status, "waiting_template"); assert.equal(saved(f).snapshot, null);
    const rpc = rpcRequest(f, {body: template({token: OTHER_TOKEN, timestamp: f.clock()})});
    assertPassthrough(await runtime.default(rpc.ctx), rpc);
    assert.equal(saved(f).status, "pending");
    f.advance(1000); f.replies.push(queryReply({items: [item({logisticsStatusSimpleDesc: "合成默认入口新 B 摘要"})], total: 3}));
    const model = await load(f); assertReady(model); assert.equal(model.total, 3);
    assert.equal(model.items[0].summary, "合成默认入口新 B 摘要"); assert.equal(posts(f).length, count + 1);
    assertNewPost(posts(f).at(-1), OTHER_TOKEN); assertNoPrivateLines(f);
}

test("默认请求完整链：B 官方保存失败后旧 A 的 token 或普通 MTOP 不撤销 B 屏障，B 新签发仍可恢复", async () => {
    for (const failure of ["noop", "throw"]) for (const kind of ["token", "ordinary_mtop"]) {
        const f = await defaultIsolationFixture(), date = mock.method(Date, "now", f.clock);
        try {
            const {previous, oldAuth, barrier} = await failDefaultBSwitch(f, failure), count = f.requests.length;
            f.advance(1000);
            const url = kind === "token" ? tokenURL({t: f.clock()})
                : "https://acs.m.taobao.com/gw/mtop.synthetic.observed/1.0/?t=" + f.clock();
            const request = tokenRequest(f, {uid: UID, unb: UID, url}), original = request.ctx.request.headers;
            assert.equal(await runtime.default(request.ctx), undefined); assert.equal(request.ctx.request.headers, original);
            assert.deepEqual(request.calls, {arrayBuffer: 0, text: 0}); assert.deepEqual(saved(f), previous);
            assert.deepEqual(f.memory.get(core.CW_AUTH_STORE), oldAuth); assert.deepEqual(f.memory.get(core.CW_STORE), barrier);
            const model = await load(f); assert.equal(model.status, "setup"); assert.deepEqual(model.items, []); assert.equal(model.updatedAt, null);
            assert.equal(f.requests.length, count, "旧 H5 请求不得解锁旧官方 A 的新查询");
            await reconnectDefaultB(f);
        } finally { date.mock.restore(); }
    }
});

test("默认响应完整链：普通或登录 schema 的旧 A Cookie 响应只观察，不撤销 B 屏障或复活旧 H5", async () => {
    for (const failure of ["noop", "throw"]) for (const kind of ["headers", "login_schema"]) {
        const f = await defaultIsolationFixture({terminal: true}), date = mock.method(Date, "now", f.clock);
        try {
            const {previous, oldAuth, barrier} = await failDefaultBSwitch(f, failure), count = f.requests.length;
            f.advance(1000);
            const url = kind === "headers" ? "https://acs.m.taobao.com/gw/mtop.synthetic.observed/1.0/"
                : "https://acs.m.taobao.com/gw/com.taobao.mtop.mLoginUnitService.login/*/";
            const request = tokenRequest(f, {uid: UID, unb: UID, url});
            const hook = tokenReply(request, {body: {data: {returnValue: {data: {success: true, loginSuccess: true}}}},
                extra: [["Set-Cookie", "unb=" + UID + "; Domain=.taobao.com; Path=/; Secure"],
                    ["Set-Cookie", "cookie2=synthetic-default-response-A; Domain=.taobao.com; Path=/; Secure"]]});
            const originalHeaders = hook.ctx.response.headers;
            if (kind === "login_schema") f.ctx.env.CW_LOGIN_SCHEMA = "true";
            const result = await runtime.default(hook.ctx);
            if (kind === "login_schema") assertPassthrough(result, hook);
            else {assert.equal(result, undefined); assert.deepEqual(hook.calls, {arrayBuffer: 0, text: 0});}
            delete f.ctx.env.CW_LOGIN_SCHEMA;
            assert.equal(hook.ctx.response.headers, originalHeaders); assert.deepEqual(saved(f), previous);
            assert.deepEqual(f.memory.get(core.CW_AUTH_STORE), oldAuth); assert.deepEqual(f.memory.get(core.CW_STORE), barrier);
            const model = await load(f); assert.equal(model.status, "setup"); assert.deepEqual(model.items, []); assert.equal(model.updatedAt, null);
            assert.equal(f.requests.length, count); await reconnectDefaultB(f);
        } finally { delete f.ctx.env.CW_LOGIN_SCHEMA; date.mock.restore(); }
    }
});

test("没有官方新状态时默认请求和响应仍保留原 H5 候选行为，不被全局阻断", async () => {
    for (const state of ["absent", "null"]) for (const kind of ["request", "response"]) {
        const f = officialFixture(), date = mock.method(Date, "now", f.clock);
        if (state === "null") f.memory.set(core.CW_OFFICIAL_STORE, null);
        try {
            const request = tokenRequest(f, {url: "https://acs.m.taobao.com/gw/mtop.synthetic.observed/1.0/"});
            if (kind === "request") {
                assert.equal(await runtime.default(request.ctx), undefined);
                assert.equal(f.memory.get(core.CW_AUTH_STORE)?.captureKind, "request_cookie");
            } else {
                const reply = tokenReply(request, {extra: [["Set-Cookie", "unb=" + UID + "; Domain=.taobao.com; Path=/"],
                    ["Set-Cookie", "cookie2=synthetic-legacy-response-session; Domain=.taobao.com; Path=/"]]});
                assert.equal(await runtime.default(reply.ctx), undefined); assert.deepEqual(reply.calls, {arrayBuffer: 0, text: 0});
                assert.equal(f.memory.get(core.CW_AUTH_STORE)?.captureKind, "response_cookie_candidate");
            }
            assert.equal(f.memory.get(core.CW_AUTH_STORE)?.status, "pending"); assert.equal(f.requests.length, 0); assert(!saved(f));
        } finally { date.mock.restore(); }
    }
});

test("旧 H5 留下 A 自己的屏障时，默认完整链仍允许同次一致 B 正常换号接入", async () => {
    for (const version of ["1.2.4", core.CW_VERSION]) {
        const f = await defaultIsolationFixture({terminal: true}), date = mock.method(Date, "now", f.clock);
        try {
            const previous = structuredClone(saved(f)), oldAuth = structuredClone(f.memory.get(core.CW_AUTH_STORE));
            f.memory.set(core.CW_STORE, {version, owner: previous.owner, source: "capture", blocked: true, cookie: "", snapshot: null});
            const count = f.requests.length; await reconnectDefaultB(f);
            assert.equal(f.requests.length, count + 1); assert.notEqual(saved(f).owner, previous.owner);
            assert.notEqual(saved(f).generation, previous.generation); assert.equal(saved(f).successCount, 1);
            assert.equal(f.memory.get(core.CW_STORE).owner, digest("account:" + OTHER_UID));
            assert.deepEqual(f.memory.get(core.CW_AUTH_STORE), oldAuth, "正常官方换号也不能复活旧 H5 终止状态");
        } finally { date.mock.restore(); }
    }
});
