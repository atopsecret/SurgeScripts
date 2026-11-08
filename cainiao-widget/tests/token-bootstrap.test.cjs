// 引擎：Node.js 20+ 内置测试 | 协议：MTOP 2.7.4 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --experimental-vm-modules --test cainiao-widget/tests/token-bootstrap.test.cjs
// 依赖：内置库与 auth-fixture.cjs；仅合成会话、内存存储和模拟 HTTP
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {NOW, parcel, response, fixture} = require("./auth-fixture.cjs");

const UID = "900000000000000001";
const SID = "synthetic-bootstrap-native-sid";
const SESSION = "synthetic-bootstrap-real-session";
const SESSION_COOKIE = "cookie2=" + SESSION;
const IDENTITY_API = "mtop.user.getUserSimple";
const COUNT_API = "mtop.cainiao.lpc.packageservice.user.package.count.query";
const PDS_API = "mtop.cainiao.lpc.packageservice.queryPdsPackageDataList";
const GW_URL = "https://cn-acs.m.cainiao.com/gw/" + PDS_API.toLowerCase() + "/*/";
const QUERY_KEYS = ["schema", "phase", "stage", "failure", "retCode", "httpClass", "tokenPresentBefore",
    "tokenUpdated", "sessionAttempt", "tokenAttempt", "page", "at", "expiresAt"];
let core, auth, runtime, networkAttempts = 0;

before(async () => {
    // 任一误用真实网络的实现都会使测试失败；模拟 ctx.http 不经过这些入口。
    const denyNetwork = () => {networkAttempts++; throw new Error("本回归禁止真实网络");};
    for (const name of ["node:http", "node:https"]) {
        const module = require(name);
        for (const method of ["get", "request"]) mock.method(module, method, denyNetwork);
    }
    const net = require("node:net");
    for (const method of ["connect", "createConnection"]) mock.method(net, method, denyNetwork);
    mock.method(net.Socket.prototype, "connect", denyNetwork);
    mock.method(require("node:tls"), "connect", denyNetwork);
    if (typeof globalThis.fetch === "function") mock.method(globalThis, "fetch", denyNetwork);
    core = await import("../core.mjs");
    auth = await import("../auth.mjs");
    runtime = await import("../runtime.mjs");
});

after(() => {
    mock.restoreAll();
    assert.equal(networkAttempts, 0, "所有请求必须只走合成 HTTP 夹具");
});

// 预期签名只用独立 node:crypto，不调用生产 md5 或生产 data 构建器。
function signature(token, time, data) {
    return createHash("md5").update(String(token) + "&" + String(Math.floor(time)) + "&12574478&" + data).digest("hex");
}

function pdsData(page) {
    return '{"pageSize":50,"currentPage":' + page
        + ',"needTemporality":false,"needDynInfo":"{\'needFindTemporality\':true,\'needAppointment\':true}"}';
}

function requestsFor(page = 2) {
    return [
        {api: IDENTITY_API, data: "{}", build: (cookies, time) => core.cwIdentityRequestURL(cookies, time)},
        {api: COUNT_API, data: '{"appName":"GUOGUO"}', build: (cookies, time) => core.cwAccountRequestURL(cookies, time)},
        {api: PDS_API, data: pdsData(page), build: (cookies, time) => core.cwRequestURL(cookies, page, time)},
    ];
}

function assertRequest(value, api, data, token, time) {
    const url = value instanceof URL ? value : new URL(value);
    assert.equal(url.origin, "https://h5api.m.taobao.com");
    assert.equal(url.pathname, "/h5/" + api.toLowerCase() + "/1.0/");
    assert.equal(url.searchParams.get("api"), api);
    assert.equal(url.searchParams.get("appKey"), "12574478");
    assert.equal(url.searchParams.get("jsv"), "2.7.4");
    assert.equal(url.searchParams.get("t"), String(Math.floor(time)));
    assert.equal(url.searchParams.get("data"), data);
    assert.equal(url.searchParams.get("sign"), signature(token, time, data), "签名必须使用官方 token 缺省与原始 data 语义");
    return url;
}

const saved = f => f.memory.get(core.CW_AUTH_STORE);
const cached = f => f.memory.get(core.CW_STORE);
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);
const diagnostic = f => auth.cwQueryDiagnostic(cached(f), auth.cwReadAuth(f.ctx, f.clock()), f.clock());

function captureCandidate(f, cookie = SESSION_COOKIE, extra = []) {
    assert.equal(auth.captureCainiaoCredentials(f.incoming(cookie, GW_URL, [["x-uid", UID], ...extra]), f.clock), undefined);
    assert.equal(saved(f).captureKind, "request_cookie_candidate");
    assert.equal(saved(f).status, "pending");
    assert.equal(f.requests.length, 0, "采集只读请求头，不发送个人查询");
}

const identity = (cookies = []) => response({api: IDENTITY_API, ret: ["SUCCESS::成功"], userNumId: UID, data: {}}, cookies);
const count = () => response({api: COUNT_API, ret: ["SUCCESS::成功"], data: {count: 1}});
const pds = (packages = [parcel()]) => response({api: PDS_API, ret: ["SUCCESS::成功"], data: {packages, totalPage: 1, currentPage: 1}});

function assertUnconfirmed(f, model) {
    assert.equal(model.status, "setup");
    assert.equal(model.setupTitle, "App 接入未确认");
    assert.equal(model.items.length, 0);
    assert.equal(model.updatedAt, null);
    assert.equal(saved(f).status, "unsupported");
    assert.equal(saved(f).confirmedAt, null);
    assert.equal(saved(f).accountCheckedAt, null);
    assert.equal(saved(f).accountSessionHash, "");
    assert.equal(cached(f).snapshot, null);
}

function assertDiagnostic(f, expected) {
    const record = diagnostic(f);
    assert(record, "失败诊断应绑定当前候选并保持可读");
    assert.deepEqual(Object.keys(record).sort(), QUERY_KEYS.slice().sort());
    for (const [key, value] of Object.entries(expected)) assert.equal(record[key], value, key);
    assert(record.at <= f.clock());
    assert(record.expiresAt > f.clock());
    assert(record.expiresAt - record.at <= 7 * 86400000);
    return record;
}

test("identity 缺 token 精确签 undefined&T&12574478&{}，不是空字符串", () => {
    const spec = requestsFor()[0];
    const url = assertRequest(spec.build(new Map(), NOW), spec.api, spec.data, undefined, NOW);
    assert.notEqual(url.searchParams.get("sign"), signature("", NOW, spec.data));
});

test("COUNT 缺 token 精确签 undefined 与原始 GUOGUO JSON", () => {
    const spec = requestsFor()[1];
    const url = assertRequest(spec.build(new Map(), NOW), spec.api, spec.data, undefined, NOW);
    assert.notEqual(url.searchParams.get("sign"), signature("", NOW, spec.data));
});

test("PDS 缺 token 精确签 undefined 与独立构造的第二页原始 JSON", () => {
    const spec = requestsFor()[2];
    const url = assertRequest(spec.build(new Map(), NOW), spec.api, spec.data, undefined, NOW);
    assert.notEqual(url.searchParams.get("sign"), signature("", NOW, spec.data));
});

test("只有 _m_h5_tk_enc 时三个接口仍缺 token，不借用 enc 值", () => {
    const enc = "synthetic-bootstrap-enc-not-a-token";
    const cookies = new Map([["_m_h5_tk_enc", enc]]);
    for (const spec of requestsFor()) {
        const url = assertRequest(spec.build(cookies, NOW), spec.api, spec.data, undefined, NOW);
        assert.notEqual(url.searchParams.get("sign"), signature(enc, NOW, spec.data));
    }
});

test("Map 中 _m_h5_tk 空值与已解析的空 Cookie 都按缺 token 处理", () => {
    const jars = [new Map([["_m_h5_tk", ""]]), core.cwCookieMap("_m_h5_tk=; cookie2=" + SESSION)];
    for (const cookies of jars) for (const spec of requestsFor()) {
        assertRequest(spec.build(cookies, NOW), spec.api, spec.data, undefined, NOW);
    }
});

test("UID、实际会话与 SID 候选 Cookie 不能替代缺失 H5 token", () => {
    for (const cookie2 of [SESSION, SID]) {
        const cookies = core.cwCookieMap("unb=" + UID + "; cookie2=" + cookie2
            + "; sgcookie=synthetic-bootstrap-sg; munb=synthetic-bootstrap-munb; _tb_token_=synthetic-bootstrap-tb");
        for (const spec of requestsFor()) {
            const url = assertRequest(spec.build(cookies, NOW), spec.api, spec.data, undefined, NOW);
            for (const substitute of [UID, cookie2, "synthetic-bootstrap-tb"]) {
                assert.notEqual(url.searchParams.get("sign"), signature(substitute, NOW, spec.data));
            }
        }
    }
});

test("正常 token 只取第一个下划线之前，额外后缀不参与三个签名", () => {
    const raw = "synthetic-bootstrap-token_1700000000000_extra-synthetic-suffix";
    const cookies = new Map([["_m_h5_tk", raw], ["_m_h5_tk_enc", "synthetic-other-enc"]]);
    for (const spec of requestsFor()) {
        const url = assertRequest(spec.build(cookies, NOW), spec.api, spec.data, "synthetic-bootstrap-token", NOW);
        assert.notEqual(url.searchParams.get("sign"), signature(raw, NOW, spec.data));
    }
});

test("非空 raw token '_123' 保留切分后的空前缀，不改成 undefined", () => {
    const cookies = new Map([["_m_h5_tk", "_123"]]);
    for (const spec of requestsFor()) {
        const url = assertRequest(spec.build(cookies, NOW), spec.api, spec.data, "", NOW);
        assert.notEqual(url.searchParams.get("sign"), signature(undefined, NOW, spec.data));
    }
});

test("没有下划线的非空 token 原样参与三个接口的独立 MD5", () => {
    const token = "synthetic-bootstrap-token-no-suffix";
    for (const spec of requestsFor()) assertRequest(spec.build(new Map([["_m_h5_tk", token]]), NOW), spec.api, spec.data, token, NOW);
});

test("三个 URL 先签原始紧凑 data 再编码，字段顺序与编码次数固定", () => {
    const token = "synthetic-bootstrap-data-token", cookies = new Map([["_m_h5_tk", token + "_1"]]);
    for (const spec of requestsFor()) {
        const value = spec.build(cookies, NOW);
        const url = assertRequest(value, spec.api, spec.data, token, NOW);
        const expected = "https://h5api.m.taobao.com/h5/" + spec.api.toLowerCase() + "/1.0/?jsv=2.7.4&appKey=12574478&t="
            + NOW + "&sign=" + signature(token, NOW, spec.data) + "&api=" + encodeURIComponent(spec.api)
            + "&v=1.0&type=originaljson&dataType=json&data=" + encodeURIComponent(spec.data);
        assert.equal(value, expected);
        assert.notEqual(url.searchParams.get("sign"), signature(token, NOW, encodeURIComponent(spec.data)));
        assert.notEqual(url.searchParams.get("sign"), signature(token, NOW, JSON.stringify(spec.data)));
    }
});

test("请求时间独立取整，不使用 token 后缀中的时间戳", () => {
    const cookies = new Map([["_m_h5_tk", "synthetic-bootstrap-clock_9876543210000"]]);
    for (const spec of requestsFor()) {
        const url = assertRequest(spec.build(cookies, NOW + 0.875), spec.api, spec.data, "synthetic-bootstrap-clock", NOW);
        assert.notEqual(url.searchParams.get("t"), "9876543210000");
    }
});

test("服务端两次真实更新 token 后每次重签新 t，并继续身份 COUNT 完整 PDS", async () => {
    const firstToken = "synthetic-bootstrap-issued-first", lastToken = "synthetic-bootstrap-issued-last";
    const f = fixture([
        response({ret: ["FAIL_SYS_TOKEN_EMPTY::合成首次缺失"]}, ["_m_h5_tk=" + firstToken + "_1; Path=/"]),
        response({ret: ["FAIL_SYS_TOKEN_EXPIRED::合成轮换"]}, ["_m_h5_tk=" + lastToken + "_2; Path=/"]),
        identity(), count(), pds(),
    ]);
    captureCandidate(f);
    const generation = saved(f).generation, model = await load(f);
    assert.equal(model.status, "ready");
    assert.equal(saved(f).status, "connected");
    assert.equal(saved(f).generation, generation);
    assert.equal(f.requests.length, 5);
    assert.deepEqual(f.requests.map(request => request.url.searchParams.get("api")), [IDENTITY_API, IDENTITY_API, IDENTITY_API, COUNT_API, PDS_API]);
    assert(!core.cwCookieMap(f.requests[0].options.headers.Cookie).has("_m_h5_tk"));
    for (let index = 1; index < f.requests.length; index++) {
        const request = f.requests[index], spec = index < 3 ? requestsFor()[0] : requestsFor(1)[index - 2];
        const token = index === 1 ? firstToken : lastToken;
        assertRequest(request.url, spec.api, spec.data, token, NOW + index);
        assert.equal(core.cwCookieMap(request.options.headers.Cookie).get("_m_h5_tk"), token + (index === 1 ? "_1" : "_2"));
    }
    assert.deepEqual(f.requests.map(request => request.url.searchParams.get("t")), Array.from({length: 5}, (_, index) => String(NOW + index)));
    assert.equal(new Set(f.requests.map(request => request.url.searchParams.get("sign"))).size, 5);
    assert.equal(core.cwCookieMap(cached(f).cookie).get("_m_h5_tk"), lastToken + "_2");
    assertDiagnostic(f, {failure: "NONE", stage: "pds", tokenAttempt: 1, sessionAttempt: 1, page: 1});
});

test("SESSION 拒绝即使同时更新 token 仍停止，不继续 COUNT 或 PDS", async () => {
    const token = "synthetic-bootstrap-rejected-issued";
    const f = fixture([
        response({ret: ["FAIL_SYS_SESSION_EXPIRED::synthetic-session-refusal-detail"]}, ["_m_h5_tk=" + token + "_2; Path=/"]),
        identity(), count(), pds([]),
    ]);
    captureCandidate(f);
    assertUnconfirmed(f, await load(f));
    assert.equal(f.requests.length, 1);
    assert.equal(f.replies.length, 3);
    assert.equal(core.cwCookieMap(cached(f).cookie).get("_m_h5_tk"), token + "_2");
    assertDiagnostic(f, {phase: "initial", stage: "identity", failure: "AUTH_REJECTED", retCode: "FAIL_SYS_SESSION_EXPIRED",
        httpClass: "HTTP_200", tokenPresentBefore: false, tokenUpdated: true, sessionAttempt: 1, tokenAttempt: 1, page: null});
    assertUnconfirmed(f, await load(f));
    assert.equal(f.requests.length, 1);
});

test("无 token 更新的 TOKEN_EMPTY 不重试，不以公共引导替代身份", async () => {
    const f = fixture([response({ret: ["FAIL_SYS_TOKEN_EMPTY::synthetic-no-token-detail"]}), identity(), count(), pds([])]);
    captureCandidate(f);
    assertUnconfirmed(f, await load(f));
    assert.equal(f.requests.length, 1);
    assert.equal(f.replies.length, 3);
    assertDiagnostic(f, {phase: "initial", stage: "identity", failure: "TOKEN_NOT_ISSUED", retCode: "FAIL_SYS_TOKEN_EMPTY",
        tokenPresentBefore: false, tokenUpdated: false, tokenAttempt: 1, sessionAttempt: 1});
    await load(f);
    assert.equal(f.requests.length, 1);
});

test("只下发 _m_h5_tk_enc 不算 token 更新，首次失败仍只有一个请求", async () => {
    const enc = "synthetic-bootstrap-issued-enc-only";
    const f = fixture([response({ret: ["FAIL_SYS_TOKEN_EMPTY::合成仅 enc"]}, ["_m_h5_tk_enc=" + enc + "; Path=/"]), identity(), count(), pds([])]);
    captureCandidate(f);
    assertUnconfirmed(f, await load(f));
    assert.equal(f.requests.length, 1);
    const cookies = core.cwCookieMap(cached(f).cookie);
    assert.equal(cookies.get("_m_h5_tk_enc"), enc);
    assert.equal(cookies.has("_m_h5_tk"), false);
    assertDiagnostic(f, {failure: "TOKEN_NOT_ISSUED", tokenPresentBefore: false, tokenUpdated: false, tokenAttempt: 1});
});

test("公共时间 SUCCESS 即使附带匹配 UID 也不能通过身份门禁", async () => {
    const f = fixture([response({api: "mtop.common.getTimestamp", ret: ["SUCCESS::成功"], userNumId: UID, data: {t: String(NOW)}}), count(), pds([])]);
    captureCandidate(f);
    assertUnconfirmed(f, await load(f));
    assert.equal(f.requests.length, 1);
    assertDiagnostic(f, {stage: "identity", failure: "API_MISMATCH", retCode: "SUCCESS"});
});

test("公共 SUCCESS 不因附带 count 或空 packages 而冒充 COUNT 或完整 PDS", async () => {
    for (const stage of ["count", "pds"]) {
        const publicReply = response({api: "mtop.common.getTimestamp", ret: ["SUCCESS::成功"],
            data: {t: String(NOW), count: 0, packages: [], totalPage: 0, currentPage: 1}});
        const f = fixture(stage === "count" ? [identity(), publicReply, pds([])] : [identity(), count(), publicReply]);
        captureCandidate(f);
        assertUnconfirmed(f, await load(f));
        assert.equal(f.requests.length, stage === "count" ? 2 : 3);
        assertDiagnostic(f, {stage, failure: "API_MISMATCH", retCode: "SUCCESS", page: stage === "count" ? null : 1});
    }
});

test("完整确认后不再打开 App，短期 token 更新和后续独立 PDS 都使用新签名", async () => {
    const capturedToken = "synthetic-bootstrap-captured", serverToken = "synthetic-bootstrap-server", refreshedToken = "synthetic-bootstrap-refreshed";
    const f = fixture([
        identity(["_m_h5_tk=" + serverToken + "_2; Path=/"]), count(), pds([parcel("before", "8-1-1111")]),
        response({ret: ["FAIL_SYS_TOKEN_EXPIRED::合成关闭 App 后轮换"]}, ["_m_h5_tk=" + refreshedToken + "_3; Path=/"]),
        pds([parcel("after", "8-2-2222")]), pds([]),
    ]);
    captureCandidate(f, SESSION_COOKIE + "; _m_h5_tk=" + capturedToken + "_1");
    const first = await load(f);
    assert.equal(first.status, "ready");
    const confirmed = structuredClone(saved(f)), captureWrites = f.writes.filter(write => write.key === core.CW_CAPTURE_STORE).length;
    f.advance(60000);
    const second = await load(f);
    assert.equal(second.status, "ready");
    assert.equal(second.items[0].code, "8-2-2222");
    assert.notEqual(second.updatedAt, first.updatedAt);
    f.advance(60000);
    const third = await load(f);
    assert.equal(third.status, "ready");
    assert.equal(third.items.length, 0);
    assert.equal(f.requests.length, 6);
    assert.deepEqual(f.requests.map(request => request.url.searchParams.get("api")), [IDENTITY_API, COUNT_API, PDS_API, PDS_API, PDS_API, PDS_API]);
    const tokens = [capturedToken, serverToken, serverToken, serverToken, refreshedToken, refreshedToken];
    const times = [NOW, NOW + 1, NOW + 2, NOW + 60000, NOW + 60001, NOW + 120000];
    for (let index = 0; index < f.requests.length; index++) {
        const spec = requestsFor(1)[Math.min(index, 2)];
        assertRequest(f.requests[index].url, spec.api, spec.data, tokens[index], times[index]);
    }
    assert.equal(saved(f).generation, confirmed.generation);
    assert.equal(saved(f).capturedAt, confirmed.capturedAt);
    assert.equal(saved(f).inputHash, confirmed.inputHash);
    assert.equal(saved(f).accountCheckedAt, confirmed.accountCheckedAt);
    assert.equal(saved(f).accountSessionHash, confirmed.accountSessionHash);
    assert.equal(f.writes.filter(write => write.key === core.CW_CAPTURE_STORE).length, captureWrites);
    assertDiagnostic(f, {phase: "refresh", stage: "pds", failure: "NONE", tokenPresentBefore: true, tokenUpdated: false});
});

test("同组件诊断只读且白名单脱敏，不泄露 token SID UID 签名或返回正文", async () => {
    const enc = "synthetic-bootstrap-private-enc", issued = "synthetic-bootstrap-private-issued";
    const detail = "synthetic-bootstrap-private-ret", rawURL = "https://synthetic.invalid/private-bootstrap-url";
    const f = fixture([response({ret: ["FAIL_SYS_SESSION_EXPIRED::" + detail], nick: "synthetic-bootstrap-private-nick"},
        ["_m_h5_tk=" + issued + "_4; Path=/"])]);
    captureCandidate(f, SESSION_COOKIE + "; sgcookie=synthetic-bootstrap-private-sg; _m_h5_tk_enc=" + enc,
        [["x-sid", SID], ["x-sign", "synthetic-bootstrap-private-native-sign"]]);
    assertUnconfirmed(f, await load(f));
    const clean = assertDiagnostic(f, {stage: "identity", failure: "AUTH_REJECTED", tokenPresentBefore: false, tokenUpdated: true});
    const state = saved(f), cache = cached(f);
    const dirty = {...clean, cookie: cache.cookie, url: rawURL, uid: UID, sid: SID, sign: f.requests[0].url.searchParams.get("sign"),
        rawBody: {nick: "synthetic-bootstrap-private-nick"}, owner: state.owner, inputHash: state.inputHash};
    assert.deepEqual(auth.cwQueryFields(dirty, f.clock()), clean);
    f.memory.set(core.CW_STORE, {...cache, queryDiagnostic: dirty});
    assert.deepEqual(diagnostic(f), clean);
    const memory = structuredClone([...f.memory]), writes = f.writes.length, requestCount = f.requests.length;
    const text = JSON.stringify(auth.diagnoseCainiaoConnection(f.ctx, f.clock));
    assert.match(text, /identity|身份/);
    assert.match(text, /AUTH_REJECTED|拒绝/);
    assert.match(text, /cookie2/);
    for (const secret of [UID, SID, SESSION, enc, issued, detail, rawURL, "synthetic-bootstrap-private-sg", "synthetic-bootstrap-private-nick",
        "synthetic-bootstrap-private-native-sign", state.owner, state.generation, state.inputHash, state.sessionHash, cache.runId,
        f.requests[0].url.searchParams.get("sign")]) assert(!text.includes(secret), "诊断不能输出任何凭据或摘要原值");
    assert.equal(f.writes.length, writes);
    assert.equal(f.requests.length, requestCount);
    assert.deepEqual([...f.memory], memory);
    f.advance(clean.expiresAt - f.clock());
    assert.equal(diagnostic(f), null);
    await load(f);
    assert.equal(f.requests.length, requestCount, "诊断过期不能复活已拒绝候选");
});
