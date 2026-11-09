// 引擎：Node.js 20+ 内置测试 | 版本：1.2.4 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --experimental-vm-modules --test cainiao-widget/tests/acquisition.test.cjs
// 依赖：内置库与 auth-fixture.cjs；仅合成 Cookie、内存 HTTP 和内存存储
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {NOW, headers, parcel, response, fixture} = require("./auth-fixture.cjs");

const UID = "900000000000000001";
const OTHER_UID = "900000000000000002";
const SESSION = "synthetic-acquisition-session";
const SG = "synthetic-acquisition-sg";
const SID = "synthetic-acquisition-native-sid-not-cookie";
const TOKEN = "synthetic-acquisition-token_1";
const IDENTITY_API = "mtop.user.getUserSimple";
const COUNT_API = "mtop.cainiao.lpc.packageservice.user.package.count.query";
const PDS_API = "mtop.cainiao.lpc.packageservice.queryPdsPackageDataList";
const PUBLIC_API = "mtop.common.getTimestamp";
const LOGIN_APIS = ["com.taobao.mtop.mLoginUnitService.login", "com.taobao.mtop.mLoginUnitService.autoLogin", "com.taobao.mtop.mLoginUnitService.logout"];
const AUTH_FIELDS = ["owner", "sessionHash", "generation", "inputHash", "cookie", "status", "capturedAt", "confirmedAt",
    "sourceHost", "captureKind", "sourceChannel", "accountCheckedAt", "accountSessionHash"];
let core, auth, app, runtime, acquisition, transport, networkAttempts = 0;

before(async () => {
    const deny = () => {networkAttempts++; throw new Error("接入集成回归禁止真实网络");};
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
    app = await import("../app.mjs");
    runtime = await import("../runtime.mjs");
    acquisition = await import("../response.mjs");
    transport = await import("../transport.mjs");
});

after(() => {
    mock.restoreAll();
    assert.equal(networkAttempts, 0, "全部 HTTP 必须走合成内存夹具");
});

const digest = value => createHash("md5").update(value).digest("hex");
const saved = f => f.memory.get(core.CW_AUTH_STORE);
const cached = f => f.memory.get(core.CW_STORE);
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);
const diagnostic = f => auth.cwQueryDiagnostic(cached(f), auth.cwReadAuth(f.ctx, f.clock()), f.clock());

function routeURL({host = "acs.m.taobao.com", channel = "gw", api = PDS_API} = {}) {
    return "https://" + host + "/" + channel + "/" + api.toLowerCase() + "/" + (channel === "gw" ? "*" : "1.0") + "/?fixture=synthetic-hook";
}

function serverCookies({uid = null, session = SESSION, sg = SG, token = TOKEN, domain = ".taobao.com", path = "/"} = {}) {
    const values = {cookie2: session, sgcookie: sg, munb: "synthetic-acquisition-munb", _tb_token_: "synthetic-acquisition-tb"};
    if (uid !== null) values.unb = uid;
    if (token !== null) Object.assign(values, {_m_h5_tk: token, _m_h5_tk_enc: "synthetic-acquisition-enc"});
    return Object.entries(values).filter(([, value]) => value !== null).map(([name, value]) => name + "=" + value
        + (domain === null ? "" : "; Domain=" + domain) + (path === null ? "" : "; Path=" + path) + "; Secure; HttpOnly");
}

function responseHook(f, options = {}) {
    const {uid = UID, requestCookie = "", setCookies = serverCookies(), schema = false, body = "synthetic-unread-body",
        bodyError = false, extraRequestHeaders = [], extraResponseHeaders = [], requestHeaders = null} = options;
    const native = uid === null ? [] : [["x-uid", uid]];
    const ctx = f.incoming(requestCookie, options.url || routeURL(options), native.concat(extraRequestHeaders));
    if (requestHeaders !== null) ctx.request.headers = requestHeaders;
    ctx.env = {...f.ctx.env, ...(schema ? {CW_LOGIN_SCHEMA: "true"} : {})};
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    const calls = {text: 0, arrayBuffer: 0};
    ctx.response = {
        status: 200, headers: headers(setCookies.map(value => ["Set-Cookie", value]).concat(extraResponseHeaders)),
        text: async () => {calls.text++; throw new Error("接入 hook 不得调用 text");},
        arrayBuffer: async () => {
            calls.arrayBuffer++;
            if (bodyError) throw new Error("synthetic-response-read-error-private-text");
            return bytes.slice().buffer;
        },
    };
    return {ctx, calls, bytes};
}

async function captureResponse(f, options) {
    const hook = responseHook(f, options);
    const original = hook.ctx.response, originalHeaders = original.headers;
    const result = await acquisition.captureCainiaoResponse(hook.ctx, f.clock);
    assert.equal(result, undefined, "响应头入口只观察，不替换原响应");
    assert.equal(hook.ctx.response, original);
    assert.equal(hook.ctx.response.headers, originalHeaders);
    assert.deepEqual(hook.calls, {text: 0, arrayBuffer: 0}, "普通响应不能读正文");
    return hook;
}

const identity = (uid = UID, changes = {}, cookies = []) => response({api: IDENTITY_API, ret: ["SUCCESS::成功"],
    userNumId: uid, data: {nick: "synthetic-identity-nick-must-not-persist"}, ...changes}, cookies);
const count = (changes = {}) => response({api: COUNT_API, ret: ["SUCCESS::成功"], data: {count: 2}, ...changes});
const pds = (packages = [parcel("acquisition", "8-2-2222")], totalPage = 1, currentPage = 1, cookies = []) => response({
    api: PDS_API, ret: ["SUCCESS::成功"], data: {packages, totalPage, currentPage},
}, cookies);

function assertPending(f, channel = "gw") {
    assert.equal(saved(f).captureKind, "response_cookie_candidate");
    assert.equal(saved(f).sourceChannel, channel);
    assert.equal(saved(f).status, "pending");
    assert.equal(saved(f).confirmedAt, null);
    assert.equal(saved(f).accountCheckedAt, null);
    assert.equal(saved(f).accountSessionHash, "");
    assert.equal(auth.cwRequiresIdentity(saved(f)), true);
}

function assertSigned(request, api, token) {
    const data = api === IDENTITY_API ? "{}" : api === COUNT_API ? '{"appName":"GUOGUO"}'
        : null;
    const raw = request.url.searchParams.get("data");
    if (api === IDENTITY_API || api === COUNT_API) assert.equal(raw, data);
    else {
        const page = JSON.parse(raw).currentPage;
        assert.equal(raw, '{"pageSize":50,"currentPage":' + page
            + ',"needTemporality":false,"needDynInfo":"{\'needFindTemporality\':true,\'needAppointment\':true}"}');
    }
    assert.equal(request.url.origin, "https://h5api.m.taobao.com");
    assert.equal(request.url.pathname, "/h5/" + api.toLowerCase() + "/1.0/");
    assert.equal(request.url.searchParams.get("api"), api);
    assert.equal(request.options.credentials, "omit", "发送对照不能自动切换个人查询的 Cookie 管理");
    assert.equal(request.options.redirect, "manual");
    assert.equal(request.options.insecureTls, false);
    const prefix = token ? token.split("_")[0] : undefined;
    assert.equal(request.url.searchParams.get("sign"), digest(String(prefix) + "&" + request.url.searchParams.get("t") + "&12574478&" + raw));
}

function oldAuth({kind = "request_cookie_candidate", status = "connected", confirmed = status === "connected"} = {}) {
    const restricted = kind !== "request_cookie";
    const cookies = core.cwCookieMap("unb=" + UID + "; cookie2=" + (kind === "native_session_candidate" ? SID : SESSION)
        + (kind === "native_session_candidate" ? "" : "; _m_h5_tk=" + TOKEN));
    const cookie = core.cwCookieHeader(cookies);
    return {version: "1.2.2", owner: core.cwOwner(cookies), sessionHash: auth.cwSessionHash(cookies),
        generation: digest("synthetic-acquisition-old:" + kind + ":" + status), inputHash: digest(cookie), cookie,
        status, capturedAt: NOW - 120000, confirmedAt: confirmed ? NOW - 60000 : null,
        sourceHost: restricted ? "cn-acs.m.cainiao.com" : "acs.m.taobao.com", captureKind: kind,
        sourceChannel: restricted ? "gw" : "h5", accountCheckedAt: restricted && confirmed ? NOW - 60000 : null,
        accountSessionHash: restricted && confirmed ? auth.cwSessionHash(cookies) : ""};
}

function oldCache(state, {snapshot = state.confirmedAt !== null, terminalStatus = ""} = {}) {
    const cookies = core.cwCookieMap(state.cookie);
    cookies.set("_m_h5_tk", "synthetic-acquisition-old-server-token_2");
    return {version: "1.2.2", owner: state.owner, inputHash: state.inputHash, source: "auto", generation: state.generation,
        runId: digest("synthetic-acquisition-old-run"), cookie: core.cwCookieHeader(cookies), observedUnb: UID,
        accountCheckedAt: state.accountCheckedAt, accountSessionHash: state.accountSessionHash, terminalStatus, queryDiagnostic: null,
        snapshot: snapshot ? {items: core.cwItems([parcel("acquisition-old", "8-1-1111")]), updatedAt: new Date(NOW - 60000).toISOString()} : null};
}

function seedOld(f, state, cache = oldCache(state)) {
    f.memory.set(core.CW_AUTH_STORE, structuredClone(state));
    f.memory.set(core.CW_STORE, structuredClone(cache));
    return cache;
}

test("1.3.0 保留响应头候选门禁，七项原值只存本组件认证键", async () => {
    assert.equal(core.CW_VERSION, "1.3.0");
    assert.equal(typeof core.CW_RESPONSE_STORE, "string");
    assert.equal(typeof core.CW_TRANSPORT_STORE, "string");
    const f = fixture();
    await captureResponse(f, {setCookies: serverCookies({uid: UID}), extraRequestHeaders: [["x-sid", SID]]});
    assertPending(f);
    const cookies = core.cwCookieMap(saved(f).cookie);
    assert.equal(cookies.get("unb"), UID);
    assert.equal(cookies.get("cookie2"), SESSION, "真实服务端 cookie2 不能被 SID 替换");
    assert.equal(cookies.get("_m_h5_tk"), TOKEN);
    assert.deepEqual([...cookies.keys()].sort(), ["unb", "cookie2", "sgcookie", "munb", "_m_h5_tk", "_m_h5_tk_enc", "_tb_token_"].sort());
    assert.equal(f.requests.length, 0, "采集本身不查询个人接口");
    assert.equal(cached(f).snapshot, null);
});

for (const channel of ["h5", "gw"]) test(channel + " 同次完整响应 Cookie 必须身份、COUNT、完整分页后才连接，关 App 后新签名直接 PDS", async () => {
    const f = fixture([identity(), count(), pds([parcel("first", "8-1-1111")], 2, 1), pds([parcel("second", "8-2-2222")], 2, 2)]);
    await captureResponse(f, {channel, setCookies: serverCookies({uid: UID})});
    assertPending(f, channel);
    const first = await load(f);
    assert.equal(first.status, "ready");
    assert.equal(first.items.length, 2);
    assert.equal(saved(f).status, "connected");
    assert.equal(saved(f).confirmedAt, NOW);
    assert.equal(saved(f).accountCheckedAt, NOW);
    assert.match(saved(f).accountSessionHash, /^[0-9a-f]{32}$/);
    assert.deepEqual(f.requests.map(request => request.url.searchParams.get("api")), [IDENTITY_API, COUNT_API, PDS_API, PDS_API]);
    for (const request of f.requests) assertSigned(request, request.url.searchParams.get("api"), TOKEN);
    const previous = f.requests.at(-1), proofAt = saved(f).accountCheckedAt;
    f.advance(60000);
    f.replies.push(pds([parcel("closed-app-new", "8-3-3333")]));
    const next = await load(f);
    assert.equal(next.status, "ready");
    assert.equal(next.items[0].code, "8-3-3333");
    assert.equal(f.requests.length, 5, "不再调用捕获或身份／COUNT");
    assert.equal(saved(f).accountCheckedAt, proofAt);
    assertSigned(f.requests[4], PDS_API, TOKEN);
    assert.notEqual(f.requests[4].url.searchParams.get("t"), previous.url.searchParams.get("t"));
    assert.notEqual(f.requests[4].url.searchParams.get("sign"), previous.url.searchParams.get("sign"));
    assert.equal(next.updatedAt, new Date(f.clock()).toISOString());
});

test("同次服务端 unb 可约束响应候选，但没有请求 UID 仍不能跳过身份", async () => {
    const f = fixture([identity(), count(), pds([])]);
    await captureResponse(f, {uid: null, channel: "h5", setCookies: serverCookies({uid: UID})});
    assertPending(f, "h5");
    const model = await load(f);
    assert.equal(model.status, "ready");
    assert.deepEqual(model.items, []);
    assert.equal(f.requests[0].url.searchParams.get("api"), IDENTITY_API);
    assert.equal(saved(f).status, "connected");
});

test("无同次身份的 session 响应不能借前次请求 UID 或旧账号成为候选", async () => {
    const f = fixture(), previous = oldAuth({status: "pending"});
    seedOld(f, previous);
    auth.captureCainiaoCredentials(f.incoming("", routeURL(), [["x-uid", UID]]), f.clock);
    const before = structuredClone(saved(f));
    await captureResponse(f, {uid: null, setCookies: serverCookies({token: null})});
    assert.deepEqual(saved(f), before);
    assert.equal(f.requests.length, 0);
    const empty = fixture();
    await captureResponse(empty, {uid: null, setCookies: serverCookies()});
    assert.equal(saved(empty), undefined);
});

test("token-only 响应不借同次请求 Cookie 或旧 session 组成响应候选", async () => {
    const f = fixture(), previous = oldAuth();
    seedOld(f, previous);
    const before = structuredClone([...f.memory]);
    await captureResponse(f, {requestCookie: "unb=" + UID + "; cookie2=" + SESSION,
        setCookies: ["_m_h5_tk=synthetic-response-token-only_2; Domain=.taobao.com; Path=/", "_m_h5_tk_enc=synthetic-only-enc; Domain=.taobao.com; Path=/"]});
    assert.deepEqual(saved(f), previous);
    assert.deepEqual(cached(f), before.find(([key]) => key === core.CW_STORE)[1]);
    assert.equal(f.requests.length, 0);
});

test("公共时间响应即使有完整 Set-Cookie 与 UID 也不创建认证候选或读取 SUCCESS 正文", async () => {
    const f = fixture();
    await captureResponse(f, {api: PUBLIC_API, setCookies: serverCookies({uid: UID}),
        body: JSON.stringify({api: PUBLIC_API, ret: ["SUCCESS::成功"], data: {t: "synthetic-public-time"}})});
    assert.equal(saved(f), undefined);
    assert.equal(f.requests.length, 0);
    assert.equal((await load(f)).status, "setup");
});

test("四来源域拒绝跨域 Cookie，不把菜鸟域或伪造淘宝 Domain 摊平到 H5", async () => {
    for (const [host, domain] of [
        ["acs.m.taobao.com", ".cainiao.com"], ["h5api.m.taobao.com", ".com"],
        ["cn-acs.m.cainiao.com", ".taobao.com"], ["e2e-mtop.cainiao.com", ".cainiao.com"],
        ["acs.m.taobao.com", "taobao.com.evil.invalid"],
    ]) {
        const f = fixture();
        await captureResponse(f, {host, setCookies: serverCookies({uid: UID, domain})});
        assert.equal(saved(f), undefined, host + " / " + domain);
        assert.equal(f.requests.length, 0);
    }
});

test("Set-Cookie Path 必须同时可供身份、COUNT、PDS，单 API 路径与 GW 默认路径不接受", async () => {
    for (const path of ["/h5/mtop.user.getusersimple/", "/h5/" + COUNT_API.toLowerCase() + "/", "/h5/" + PDS_API.toLowerCase() + "/", "/gw/", "/H5/", null]) {
        const f = fixture();
        await captureResponse(f, {setCookies: serverCookies({uid: UID, path})});
        assert.equal(saved(f), undefined, String(path));
    }
    const valid = fixture();
    await captureResponse(valid, {setCookies: serverCookies({uid: UID, path: "/h5/"})});
    assertPending(valid);
});

test("host-only 仅实际 H5 目标主机可用，ACS 与两个菜鸟主机不能借为 H5 Cookie", async () => {
    for (const host of ["acs.m.taobao.com", "cn-acs.m.cainiao.com", "e2e-mtop.cainiao.com"]) {
        const f = fixture();
        await captureResponse(f, {host, setCookies: serverCookies({uid: UID, domain: null})});
        assert.equal(saved(f), undefined, host);
    }
    const valid = fixture();
    await captureResponse(valid, {host: "h5api.m.taobao.com", channel: "h5", setCookies: serverCookies({domain: null})});
    assertPending(valid, "h5");
});

test("响应 Cookie 百分号、加号与等号原值保留，诊断和观察键不保存这些值", async () => {
    const values = {cookie2: "synthetic%2F+%3D=", sgcookie: "synthetic%252B+=", munb: "synthetic%25", _m_h5_tk: "synthetic%2F+%3D_999",
        _m_h5_tk_enc: "synthetic%2b%3d", _tb_token_: "synthetic%3D="};
    const f = fixture();
    await captureResponse(f, {setCookies: Object.entries(values).map(([name, value]) => name + "=" + value + "; Domain=.taobao.com; Path=/"),
        extraResponseHeaders: [["x-sign", "synthetic-response-sign-never-save"], ["Authorization", "synthetic-response-auth-never-save"]]});
    assertPending(f);
    const cookies = core.cwCookieMap(saved(f).cookie);
    for (const [name, value] of Object.entries(values)) assert.equal(cookies.get(name), value, name);
    const publicState = JSON.stringify({app: f.memory.get(core.CW_APP_STORE), response: f.memory.get(core.CW_RESPONSE_STORE),
        capture: f.memory.get(core.CW_CAPTURE_STORE), lines: auth.diagnoseCainiaoConnection(f.ctx, f.clock),
        responseLines: acquisition.cwResponseLines(f.ctx, f.clock())});
    for (const value of [...Object.values(values), UID, "synthetic-response-sign-never-save", "synthetic-response-auth-never-save"])
        assert(!publicState.includes(value), "只读诊断和观察不展开 Cookie、账号、签名或认证头");
});

test("同次服务端 unb 与请求 UID 冲突隔离旧快照，不保存新候选或返回旧码", async () => {
    for (const options of [
        {setCookies: serverCookies({uid: OTHER_UID})},
        {requestCookie: "unb=" + OTHER_UID + "; cookie2=synthetic-conflicting-request-session", setCookies: serverCookies({uid: UID})},
        {extraRequestHeaders: [["x-uid", OTHER_UID]], setCookies: serverCookies({uid: UID})},
    ]) {
        const f = fixture(), previous = oldAuth({kind: "request_cookie"});
        seedOld(f, previous);
        await captureResponse(f, options);
        assert.equal(cached(f).blocked, true);
        assert.equal(cached(f).snapshot, null);
        assert.notEqual(cached(f).owner, previous.owner);
        assert.deepEqual(saved(f), previous);
        const model = await load(f);
        assert.equal(model.status, "setup");
        assert.deepEqual(model.items, []);
        assert.equal(f.requests.length, 0);
    }
});

test("plain object 同次 UID 数组、大小写重名或 Cookie 身份冲突同样隔离旧快照", async () => {
    for (const requestHeaders of [
        {Host: "acs.m.taobao.com", "x-uid": [UID, OTHER_UID]},
        {host: "acs.m.taobao.com", "X-UID": UID, "x-uid": OTHER_UID},
        {Host: "acs.m.taobao.com", "x-uid": UID, Cookie: "unb=" + OTHER_UID + "; cookie2=synthetic-plain-conflicting-session"},
    ]) {
        const f = fixture(), previous = oldAuth({kind: "request_cookie"});
        seedOld(f, previous);
        await captureResponse(f, {requestHeaders, setCookies: serverCookies({uid: UID})});
        assert.equal(cached(f).blocked, true);
        assert.equal(cached(f).snapshot, null);
        assert.notEqual(cached(f).owner, previous.owner);
        assert.deepEqual(saved(f), previous);
        const model = await load(f);
        assert.equal(model.status, "setup");
        assert.deepEqual(model.items, []);
        assert.equal(f.requests.length, 0);
    }
});

test("plain object Host 覆盖、重名冲突或非法类型拒绝，合法同源重复值才能采集", async () => {
    for (const requestHeaders of [
        {Host: "cn-acs.m.cainiao.com", "x-uid": UID},
        {Host: ["acs.m.taobao.com", "evil.invalid"], "x-uid": UID},
        {host: "acs.m.taobao.com", Host: "h5api.m.taobao.com", "x-uid": UID},
        {Host: 443, "x-uid": UID},
    ]) {
        const f = fixture();
        await captureResponse(f, {requestHeaders, setCookies: serverCookies({uid: UID})});
        assert.equal(saved(f), undefined);
        assert.equal(f.requests.length, 0);
        assert.equal(f.writes.length, 0, "Host 无法确认时不写候选或响应证据");
    }
    const valid = fixture();
    await captureResponse(valid, {requestHeaders: {Host: ["acs.m.taobao.com", "acs.m.taobao.com:443"], "x-uid": [UID, UID]},
        setCookies: serverCookies({uid: UID})});
    assertPending(valid);
});

test("已知 logout 请求含完整 Cookie 只观察，不保存新候选、不复活旧终止态且原请求不改", () => {
    for (const channel of ["h5", "gw"]) for (const status of [null, "expired", "verify", "invalid"]) {
        const f = fixture();
        if (status !== null) {
            const previous = oldAuth({kind: "request_cookie", status, confirmed: true});
            seedOld(f, previous, oldCache(previous, {terminalStatus: status}));
        }
        const previous = structuredClone(saved(f)), cache = structuredClone(cached(f));
        const ctx = f.incoming("unb=" + UID + "; cookie2=synthetic-logout-full-session; sgcookie=synthetic-logout-full-sg; _m_h5_tk=" + TOKEN,
            routeURL({channel, api: LOGIN_APIS[2]}), [["x-uid", UID], ["x-sid", SID]]);
        const request = ctx.request, originalHeaders = request.headers, calls = {text: 0, arrayBuffer: 0};
        request.text = () => {calls.text++; throw new Error("logout 请求不读正文");};
        request.arrayBuffer = () => {calls.arrayBuffer++; throw new Error("logout 请求不读二进制");};
        assert.equal(auth.captureCainiaoCredentials(ctx, f.clock), undefined);
        assert.equal(ctx.request, request);
        assert.equal(ctx.request.headers, originalHeaders);
        assert.equal(ctx.request.url, routeURL({channel, api: LOGIN_APIS[2]}));
        assert.deepEqual(calls, {text: 0, arrayBuffer: 0});
        assert.deepEqual(saved(f), previous);
        assert.deepEqual(cached(f), cache);
        assert.equal(f.memory.get(core.CW_CAPTURE_STORE).code, "anonymous");
        assert.equal(f.requests.length, 0);
    }
});

test("响应候选不能以公共 SUCCESS 或 COUNT 成功、PDS 失败绕过完整确认", async () => {
    for (const replies of [
        [response({api: PUBLIC_API, ret: ["SUCCESS::成功"], data: {t: "synthetic"}})],
        [identity(), count(), response({api: PDS_API, ret: ["FAIL_SYS_SESSION_EXPIRED::synthetic-reject"], data: {}})],
    ]) {
        const f = fixture(replies);
        await captureResponse(f);
        const model = await load(f);
        assert.equal(model.status, "setup");
        assert.equal(saved(f).status, "unsupported");
        assert.equal(saved(f).confirmedAt, null);
        assert.equal(saved(f).accountCheckedAt, null);
        assert.equal(cached(f).snapshot, null);
    }
});

test("响应候选首次 SESSION 拒绝终止，重复相同响应或短期 token 更新不复活", async () => {
    const f = fixture([response({api: IDENTITY_API, ret: ["FAIL_SYS_SESSION_EXPIRED::synthetic-reject"], data: {}})]);
    await captureResponse(f);
    const first = await load(f);
    assert.equal(first.status, "setup");
    assert.equal(first.setupTitle, "App 接入未确认");
    const generation = saved(f).generation;
    assert.equal(saved(f).status, "unsupported");
    assert.equal(diagnostic(f).failure, "AUTH_REJECTED");
    for (const token of [TOKEN, "synthetic-acquisition-token-refresh_2"]) {
        f.advance(1000);
        await captureResponse(f, {setCookies: serverCookies({token})});
        assert.equal(saved(f).status, "unsupported");
        assert.equal(saved(f).generation, generation);
        assert.equal((await load(f)).status, "setup");
        assert.equal(f.requests.length, 1, "同稳定响应会话失败后不能重发个人请求");
    }
});

test("新的真实响应稳定会话才创建新代次，隔离旧 token 与诊断并重新完整验证", async () => {
    const f = fixture([response({api: IDENTITY_API, ret: ["FAIL_SYS_SESSION_EXPIRED::synthetic-reject"], data: {}})]);
    await captureResponse(f);
    await load(f);
    const old = structuredClone(saved(f));
    f.advance(1000);
    await captureResponse(f, {setCookies: serverCookies({session: "synthetic-acquisition-new-session", token: null})});
    assertPending(f);
    assert.notEqual(saved(f).generation, old.generation);
    assert.equal(core.cwCookieMap(saved(f).cookie).has("_m_h5_tk"), false);
    assert.equal(cached(f).snapshot, null);
    assert.equal(diagnostic(f), null);
    f.replies.push(identity(), count(), pds([]));
    assert.equal((await load(f)).status, "ready");
    assert.equal(saved(f).status, "connected");
    assert.deepEqual(f.requests.slice(1).map(request => request.url.searchParams.get("api")), [IDENTITY_API, COUNT_API, PDS_API]);
});

test("同账号已确认的完整请求 Cookie 不被响应试探降级或清除快照", async () => {
    const f = fixture(), previous = oldAuth({kind: "request_cookie"});
    const cache = seedOld(f, previous);
    await captureResponse(f, {setCookies: serverCookies({session: "synthetic-response-weaker-new-session"})});
    assert.deepEqual(saved(f), previous);
    assert.deepEqual(cached(f), cache);
    assert.equal(f.requests.length, 0);
});

test("响应实际 Cookie 的 pending、connected、terminal 均不被同账号 SID-only 覆盖", async () => {
    for (const status of ["pending", "connected", "unsupported", "verify", "invalid"]) {
        const f = fixture();
        await captureResponse(f);
        if (status === "connected") {
            f.replies.push(identity(), count(), pds());
            assert.equal((await load(f)).status, "ready");
        } else if (status !== "pending") {
            f.memory.set(core.CW_AUTH_STORE, {...saved(f), status});
        }
        const previous = structuredClone(saved(f)), cache = structuredClone(cached(f));
        auth.captureCainiaoCredentials(f.incoming("", routeURL(), [["x-uid", UID], ["x-sid", SID]]), f.clock);
        assert.deepEqual(saved(f), previous, status);
        assert.deepEqual(cached(f), cache, status);
    }
});

test("新账号响应 AUTH 写入 noop 留隔离屏障，旧响应候选的弱 native 流量不能撤销", async () => {
    const f = fixture();
    await captureResponse(f);
    const previous = structuredClone(saved(f));
    const write = f.ctx.storage.setJSON;
    f.ctx.storage.setJSON = (key, value) => {if (key !== core.CW_AUTH_STORE) write(key, value);};
    await captureResponse(f, {uid: OTHER_UID, setCookies: serverCookies({session: "synthetic-new-account-session"})});
    f.ctx.storage.setJSON = write;
    assert.deepEqual(saved(f), previous);
    assert.equal(cached(f).blocked, true);
    assert.notEqual(cached(f).owner, previous.owner);
    assert.equal(cached(f).snapshot, null);
    const barrier = structuredClone(cached(f));
    auth.captureCainiaoCredentials(f.incoming("", routeURL(), [["x-uid", UID], ["x-sid", SID]]), f.clock);
    assert.deepEqual(cached(f), barrier);
    assert.deepEqual(saved(f), previous);
    const model = await load(f);
    assert.equal(model.status, "setup");
    assert.deepEqual(model.items, []);
    assert.equal(f.requests.length, 0);
});

test("B 响应候选保存失败后，A 同稳定会话迟到 token 更新不能穿透账号屏障", async () => {
    for (const status of ["pending", "connected"]) for (const writeFailure of ["noop", "throw"])
        for (const barrierVersion of ["1.2.3", "1.2.2", "synthetic-unknown-version"]) {
            const f = fixture(), channel = status === "connected" ? "h5" : "gw";
            await captureResponse(f, {channel});
            if (status === "connected") {
                f.replies.push(identity(), count(), pds());
                assert.equal((await load(f)).status, "ready");
            }
            const previous = structuredClone(saved(f)), requestsBeforeBarrier = f.requests.length;
            const write = f.ctx.storage.setJSON;
            f.ctx.storage.setJSON = (key, value) => {
                if (key === core.CW_AUTH_STORE) {
                    if (writeFailure === "throw") throw new Error("synthetic-new-account-auth-write-error");
                    return;
                }
                write(key, value);
            };
            try {
                f.advance(1000);
                await captureResponse(f, {uid: OTHER_UID, channel,
                    setCookies: serverCookies({session: "synthetic-blocked-other-account-session"})});
            } finally { f.ctx.storage.setJSON = write; }
            assert.deepEqual(saved(f), previous);
            assert.equal(cached(f).blocked, true);
            assert.equal(cached(f).snapshot, null);
            assert.notEqual(cached(f).owner, previous.owner);
            f.memory.set(core.CW_STORE, {...cached(f), version: barrierVersion});
            const barrier = structuredClone(cached(f)), writeOffset = f.writes.length;
            f.advance(1000);
            await captureResponse(f, {channel, setCookies: serverCookies({token: "synthetic-late-account-a-token_2"})});
            assert.deepEqual(saved(f), previous, status + " / " + writeFailure + " / " + barrierVersion);
            assert.deepEqual(cached(f), barrier);
            assert.equal(f.writes.slice(writeOffset).some(item => [core.CW_AUTH_STORE, core.CW_STORE].includes(item.key)), false,
                "迟到 token 流量不能短暂改写凭据或账号屏障");
            const model = await load(f);
            assert.equal(model.status, "setup");
            assert.deepEqual(model.items, []);
            assert.equal(model.updatedAt, null);
            assert.equal(f.requests.length, requestsBeforeBarrier, "B 屏障建立后不再发旧 A 个人请求");
            assert.deepEqual(saved(f), previous);
            assert.deepEqual(cached(f), barrier);
        }
});

test("App 观察第 33 个新类别先淘汰最旧行，原七天窗口与真实保存均保持最多 32 行", t => {
    let writeFailureLogs = 0;
    t.mock.method(console, "log", () => {writeFailureLogs++;});
    const kinds = ["personal_list", "personal_count", "public_time", "other"];
    const routes = app.CW_APP_HOSTS.flatMap(host => ["h5", "gw"].flatMap(channel => kinds.map(apiKind => ({host, channel, apiKind}))));
    const key = row => row.host + "|" + row.channel + "|" + row.apiKind;
    assert.equal(routes.length, 32);
    assert.equal(new Set(routes.map(key)).size, 32);
    for (const version of ["1.2.2", "1.2.3"]) {
        const f = fixture(), startedAt = NOW - 5 * 86400000;
        const rows = routes.map((route, index) => ({...route, count: 1, at: NOW - 60000 + index,
            cookies: [], nativeHeaders: [], sameRequestLoginFields: false, sameRequestLoginFieldsAt: null,
            sameRequestNativeSession: false, sameRequestNativeSessionAt: null}));
        f.memory.set(core.CW_APP_STORE, {version, startedAt, rows});
        assert.equal(app.cwAppSummary(f.ctx, f.clock()).rows.length, 32);
        assert.equal(f.writes.length, 0, "旧观察读取不续期或写回版本");
        f.advance(1000);
        const incoming = f.incoming("", routeURL({host: "acs.m.taobao.com", channel: "gw", api: LOGIN_APIS[1]}));
        assert.equal(auth.captureCainiaoCredentials(incoming, f.clock), undefined);
        const stored = f.memory.get(core.CW_APP_STORE), summary = app.cwAppSummary(f.ctx, f.clock());
        assert.equal(stored.rows.length, 32, "实际存储不能先写 33 行再由 reader 丢掉");
        assert.equal(summary.rows.length, 32);
        assert.equal(stored.startedAt, startedAt, "新增类别不能续期原观察窗口");
        assert.equal(stored.version, "1.3.0");
        assert.equal(new Set(stored.rows.map(key)).size, 32);
        const newKey = "acs.m.taobao.com|gw|session_refresh";
        assert(stored.rows.some(row => key(row) === newKey));
        assert(summary.rows.some(row => key(row) === newKey));
        assert.equal(stored.rows.some(row => key(row) === key(rows[0])), false, "淘汰的是时间最旧的原行");
        assert.equal(summary.rows.some(row => key(row) === key(rows[0])), false);
        assert.equal(stored.rows.find(row => key(row) === newKey).at, f.clock());
        assert.equal(stored.rows.find(row => key(row) === newKey).count, 1);
        assert.equal(f.memory.get(core.CW_CAPTURE_STORE).code, "anonymous");
        assert.equal(saved(f), undefined);
        assert.equal(f.requests.length, 0);
    }
    assert.equal(writeFailureLogs, 0, "合法新行不能触发假写失败日志");
});

test("响应账号在途替换会取消旧查询，迟到身份 SUCCESS 不继续 COUNT 或覆盖新候选", async () => {
    const f = fixture();
    await captureResponse(f);
    f.replies.push(async () => {
        f.advance(1);
        await captureResponse(f, {uid: OTHER_UID, setCookies: serverCookies({session: "synthetic-inflight-other-session"})});
        return identity();
    });
    const model = await load(f);
    assert.equal(model.status, "setup");
    assert.deepEqual(model.items, []);
    assert.equal(f.requests.length, 1);
    assert.equal(core.cwCookieMap(saved(f).cookie).get("unb"), OTHER_UID);
    assert.equal(saved(f).status, "pending");
    assert.equal(saved(f).confirmedAt, null);
    assert.equal(cached(f).snapshot, null);
});

test("响应候选已确认后的稳定 session 轮换丢弃旧 PDS，重新身份与 COUNT 后使用新结果", async () => {
    const f = fixture([identity(), count(), pds()]);
    await captureResponse(f);
    assert.equal((await load(f)).status, "ready");
    f.advance(60000);
    f.replies.push(pds([parcel("discarded", "8-4-4444")], 1, 1,
        ["cookie2=synthetic-runtime-rotated-session; Domain=.taobao.com; Path=/"]), identity(), count(), pds([parcel("new-session", "8-5-5555")]));
    const model = await load(f);
    assert.equal(model.status, "ready");
    assert.deepEqual(model.items.map(item => item.code), ["8-5-5555"]);
    assert.deepEqual(f.requests.slice(3).map(request => request.url.searchParams.get("api")), [PDS_API, IDENTITY_API, COUNT_API, PDS_API]);
    assert.equal(diagnostic(f).phase, "revalidate");
    assert.equal(saved(f).accountCheckedAt, f.clock());
});

for (const kind of ["request_cookie", "request_cookie_candidate", "native_session_candidate"]) test("1.2.2 " + kind + " pending/connected/terminal 升级保留归属、Cookie、快照和停止，不自动重试", async () => {
    const statuses = kind === "request_cookie" ? ["pending", "connected", "expired", "verify", "invalid"]
        : ["pending", "connected", "expired", "verify", "invalid", "unsupported"];
    for (const status of statuses) {
        const f = fixture(), previous = oldAuth({kind, status});
        const cache = seedOld(f, previous, oldCache(previous, {terminalStatus: ["pending", "connected"].includes(status) ? "" : status}));
        const memory = structuredClone([...f.memory]), writes = f.writes.length;
        const migrated = auth.cwReadAuth(f.ctx, f.clock());
        assert.equal(migrated.version, "1.3.0");
        for (const key of AUTH_FIELDS) assert.equal(migrated[key], previous[key], key + " / " + status);
        const lines = auth.diagnoseCainiaoConnection(f.ctx, f.clock);
        assert.equal(lines.type, "widget");
        assert.deepEqual([...f.memory], memory, "读取诊断不写回升级或续期");
        assert.equal(f.writes.length, writes);
        if (!["pending", "connected"].includes(status)) {
            const model = await load(f);
            assert.notEqual(model.status, "ready");
            assert.equal(f.requests.length, 0, "升级不能复活失败候选");
            assert.deepEqual(saved(f), previous);
            assert.deepEqual(cached(f), cache);
        }
    }
});

test("runtime 原响应头入口优先于请求采集，普通 MTOP 保持头和正文不动", async t => {
    const f = fixture();
    t.mock.method(Date, "now", f.clock);
    const hook = responseHook(f, {requestCookie: "unb=" + UID + "; cookie2=synthetic-request-not-response-session", body: "synthetic-unread-sensitive-body"});
    const original = hook.ctx.response;
    assert.equal(await runtime.default(hook.ctx), undefined);
    assert.equal(hook.ctx.response, original);
    assert.deepEqual(hook.calls, {text: 0, arrayBuffer: 0});
    assertPending(f);
    assert.equal(core.cwCookieMap(saved(f).cookie).get("cookie2"), SESSION);
    assert.equal(f.requests.length, 0);
});

test("runtime 已知登录 schema 入口一次采集实际响应头并原字节返回，正文不提取凭据且 logout 不建候选", async t => {
    const f = fixture();
    t.mock.method(Date, "now", f.clock);
    for (const api of LOGIN_APIS) {
        const body = JSON.stringify({api, ret: ["SUCCESS::synthetic-return-text-never-save"], data: {returnValue: JSON.stringify({
            data: {userId: UID, cookies: ["cookie2=synthetic-body-private-session"], sid: "synthetic-body-private-sid"},
        })}});
        const previous = structuredClone(saved(f));
        const authWrites = f.writes.filter(write => write.key === core.CW_AUTH_STORE).length;
        const hook = responseHook(f, {api, schema: true, body, setCookies: serverCookies({uid: UID})});
        const original = hook.ctx.response, originalHeaders = original.headers;
        const result = await runtime.default(hook.ctx);
        assert(result && result.body instanceof Uint8Array, "读到正文后通过 Uint8Array 透传");
        assert.deepEqual([...result.body], [...hook.bytes]);
        assert.deepEqual(Object.keys(result), ["body"]);
        assert.equal(hook.ctx.response, original);
        assert.equal(hook.ctx.response.headers, originalHeaders);
        assert.deepEqual(hook.calls, {text: 0, arrayBuffer: 1});
        if (api === LOGIN_APIS[2]) {
            assert.deepEqual(saved(f), previous, "logout 不形成或更新登录候选");
        } else {
            assertPending(f);
            assert.equal(core.cwCookieMap(saved(f).cookie).get("cookie2"), SESSION, "候选值来自同次合法 Set-Cookie，不来自正文");
        }
        assert.equal(f.writes.filter(write => write.key === core.CW_AUTH_STORE).length - authWrites,
            previous ? 0 : 1, "同稳定会话不重复写认证候选");
    }
    const publicState = JSON.stringify({state: f.memory.get(core.CW_RESPONSE_STORE), lines: acquisition.cwResponseLines(f.ctx, f.clock())});
    for (const value of [UID, "synthetic-body-private-session", "synthetic-body-private-sid", "synthetic-return-text-never-save"])
        assert(!publicState.includes(value));
    assert.equal(f.requests.length, 0);
});

test("schema 开关不会读其它 MTOP 或伪登录路径；已知二进制原样返回，读失败不伪造空体", async () => {
    for (const options of [{api: PDS_API}, {api: PUBLIC_API}, {api: LOGIN_APIS[0] + ".evil"}]) {
        const f = fixture(), hook = responseHook(f, {...options, schema: true, bodyError: true});
        assert.equal(await acquisition.captureCainiaoResponse(hook.ctx, f.clock), undefined);
        assert.deepEqual(hook.calls, {text: 0, arrayBuffer: 0});
        assert.equal(saved(f), undefined);
    }
    const f = fixture(), hook = responseHook(f, {api: LOGIN_APIS[1], schema: true, body: new Uint8Array([0, 255, 31, 139, 0, 13, 10])});
    const result = await acquisition.captureCainiaoResponse(hook.ctx, f.clock);
    assert(result.body instanceof Uint8Array);
    assert.deepEqual([...result.body], [...hook.bytes]);
    const failed = responseHook(f, {api: LOGIN_APIS[0], schema: true, bodyError: true});
    assert.equal(await acquisition.captureCainiaoResponse(failed.ctx, f.clock), undefined);
    assert.deepEqual(failed.calls, {text: 0, arrayBuffer: 1});
});

test("generic 诊断只发两次固定合成 echo，凭据不泄露且结果不确认个人连接；同窗口不重复", async t => {
    const f = fixture([response({headers: {cookie: "CW_TEST=123"}}), response({headers: {cookie: "CW_TEST=123"}})]);
    t.mock.method(Date, "now", f.clock);
    await captureResponse(f);
    const previous = structuredClone(saved(f)), cache = structuredClone(cached(f));
    f.ctx.env = {CAINIAO_DIAGNOSTIC: "true", CW_TRANSPORT_CHECK: "true", CAINIAO_COOKIE: "unb=synthetic-manual-secret; cookie2=synthetic-manual-secret-session"};
    const output = await runtime.default(f.ctx);
    assert.equal(output.type, "widget");
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests.map(request => request.options.credentials), ["omit", "include"]);
    for (const request of f.requests) {
        assert.equal(request.url.href, transport.CW_TRANSPORT_ECHO_URL);
        assert.equal(request.options.headers.Cookie, transport.CW_TRANSPORT_TEST_COOKIE);
        assert.equal(request.options.redirect, "manual");
        assert.equal(request.options.insecureTls, false);
        const sent = JSON.stringify({url: request.url.href, options: request.options});
        for (const value of [UID, SESSION, SG, TOKEN, SID, "synthetic-manual-secret", "synthetic-manual-secret-session"])
            assert(!sent.includes(value), "发送对照不得读取或复制个人凭据");
    }
    assert.deepEqual(saved(f), previous);
    assert.deepEqual(cached(f), cache);
    assert.equal(saved(f).status, "pending");
    assert.equal(saved(f).accountCheckedAt, null);
    assert(f.memory.get(core.CW_TRANSPORT_STORE));
    const text = JSON.stringify(output);
    for (const value of [UID, SESSION, TOKEN, "CW_TEST=123"]) assert(!text.includes(value));
    const second = await runtime.default(f.ctx);
    assert.equal(second.type, "widget");
    assert.equal(f.requests.length, 2, "同窗口第二次连接状态不再发 echo");
});

test("原诊断函数保持只读；manual/off/非法模式及响应 hook 不触发发送对照", async t => {
    for (const mode of ["auto", "manual", "off", "invalid-mode"]) {
        const f = fixture();
        t.mock.method(Date, "now", f.clock);
        f.ctx.env = {CAINIAO_DIAGNOSTIC: "true", CW_TRANSPORT_CHECK: "true", CONNECTION_MODE: mode};
        const before = structuredClone([...f.memory]);
        assert.equal(auth.diagnoseCainiaoConnection(f.ctx, f.clock).type, "widget");
        assert.deepEqual([...f.memory], before);
        assert.equal(f.requests.length, 0);
        assert.equal(f.writes.length, 0);
        if (mode !== "auto") {
            assert.equal((await runtime.default(f.ctx)).type, "widget");
            assert.equal(f.requests.length, 0);
        }
        const hook = responseHook(f);
        assert.equal(await runtime.default(hook.ctx), undefined);
        assert.equal(f.requests.length, 0, "HTTP hook 入口不能做发送对照");
    }
});

test("off 只清本组件六个键，新增响应与发送结果一并清除，不动其他模块", async () => {
    const f = fixture();
    const keys = [core.CW_AUTH_STORE, core.CW_STORE, core.CW_CAPTURE_STORE, core.CW_APP_STORE, core.CW_RESPONSE_STORE, core.CW_TRANSPORT_STORE];
    assert.equal(new Set(keys).size, 6);
    for (const key of keys) f.memory.set(key, {synthetic: true});
    f.memory.set("synthetic-other-module", {keep: true});
    f.ctx.env = {CONNECTION_MODE: "off"};
    assert.equal((await load(f)).status, "setup");
    for (const key of keys) assert.equal(f.memory.get(key), null);
    assert.deepEqual(f.memory.get("synthetic-other-module"), {keep: true});
    assert.equal(f.requests.length, 0);
});
