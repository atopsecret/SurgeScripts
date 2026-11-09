// 引擎：Node.js 20+ 内置测试 | 版本：1.2.4 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --experimental-vm-modules --test cainiao-widget/tests/session-candidate.test.cjs
// 依赖：本地源码与 auth-fixture.cjs；仅合成会话、模拟 HTTP 和内存存储
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {NOW, headers, parcel, response, success, fixture} = require("./auth-fixture.cjs");

const UID = "900000000000000001";
const OTHER_UID = "900000000000000002";
const SID = "synthetic-native-sid-candidate";
const OTHER_SID = "synthetic-native-sid-other";
const API = "mtop.cainiao.lpc.packageservice.queryPdsPackageDataList";
const COUNT_API = "mtop.cainiao.lpc.packageservice.user.package.count.query";
const IDENTITY_API = "mtop.user.getUserSimple";
const GW_URL = "https://cn-acs.m.cainiao.com/gw/" + API.toLowerCase() + "/*/";
const H5_URL = "https://acs.m.taobao.com/h5/" + API.toLowerCase() + "/1.0/";
const CAPTURED = {
    cookie2: "synthetic-captured-real-session",
    sgcookie: "synthetic-captured-real-sg",
    munb: "synthetic-captured-munb",
    _m_h5_tk: "synthetic-captured-token_1",
    _m_h5_tk_enc: "synthetic-captured-token-enc",
    _tb_token_: "synthetic-captured-tb-token",
};
const COOKIE = Object.entries(CAPTURED).map(([name, value]) => name + "=" + value).join("; ");
const FAILURES = ["TOKEN_NOT_ISSUED", "TOKEN_RETRY_EXHAUSTED", "AUTH_REJECTED", "ILLEGAL_ACCESS", "SESSION_MISSING", "SESSION_UNSTABLE", "IDENTITY_UNVERIFIED", "ACCOUNT_MISMATCH", "API_MISMATCH", "SCHEMA_INVALID", "VERIFY_REQUIRED", "OFFLINE", "DEADLINE", "PARTIAL", "STORAGE_UNCONFIRMED", "NONE", "UNKNOWN"];
const HTTP_CLASSES = ["HTTP_200", "HTTP_401", "HTTP_403", "HTTP_429", "HTTP_3XX", "HTTP_5XX", "HTTP_OTHER", "NONE"];
const QUERY_KEYS = ["schema", "phase", "stage", "failure", "retCode", "httpClass", "tokenPresentBefore", "tokenUpdated", "sessionAttempt", "tokenAttempt", "page", "at", "expiresAt"];
let auth, core, runtime;

before(async () => {
    core = await import("../core.mjs");
    auth = await import("../auth.mjs");
    runtime = await import("../runtime.mjs");
});

const saved = f => f.memory.get(core.CW_AUTH_STORE);
const cached = f => f.memory.get(core.CW_STORE);
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);
const diagnostic = f => auth.cwQueryDiagnostic(cached(f), auth.cwReadAuth(f.ctx, f.clock()), f.clock());
const renderedDiagnostic = f => JSON.stringify(auth.diagnoseCainiaoConnection(f.ctx, f.clock));

function incoming(f, {cookie = COOKIE, uid = UID, sid = SID, url = GW_URL, extra = []} = {}) {
    const values = [];
    if (uid !== null) values.push(["x-uid", uid]);
    if (sid !== null) values.push(["x-sid", sid]);
    return f.incoming(cookie, url, values.concat(extra));
}

function capture(f, options) {
    return auth.captureCainiaoCredentials(incoming(f, options), f.clock);
}

function identity(uid = UID, changes = {}, setCookies = []) {
    return response({api: IDENTITY_API, ret: ["SUCCESS::成功"], userNumId: uid,
        data: {nick: "synthetic-identity-nick-do-not-persist"}, ...changes}, setCookies);
}

function count(changes = {}, setCookies = []) {
    return response({api: COUNT_API, ret: ["SUCCESS::成功"], data: {count: 1}, ...changes}, setCookies);
}

function pds(packages = [parcel()], totalPage = 1, currentPage = 1, setCookies = []) {
    return response({api: API, ret: ["SUCCESS::成功"], data: {packages, totalPage, currentPage}}, setCookies);
}

function legacyAuth({version = "1.2.0", kind = "request_cookie", status = "connected", confirmed = status === "connected", uid = UID, token = true} = {}) {
    const values = kind === "native_session_candidate" ? {unb: uid, cookie2: SID}
        : {unb: uid, cookie2: CAPTURED.cookie2, ...(token ? {_m_h5_tk: CAPTURED._m_h5_tk} : {})};
    const cookies = core.cwCookieMap(Object.entries(values).map(([name, value]) => name + "=" + value).join("; "));
    const cookie = core.cwCookieHeader(cookies);
    const state = {version, owner: core.cwOwner(cookies), sessionHash: auth.cwSessionHash(cookies),
        generation: core.md5("synthetic-legacy-generation:" + version + ":" + kind), inputHash: core.md5(cookie), cookie,
        status, capturedAt: NOW - 1000, confirmedAt: confirmed ? NOW - 500 : null, sourceHost: "acs.m.taobao.com"};
    if (version !== "1.1.0") Object.assign(state, {captureKind: kind, sourceChannel: kind === "request_cookie" ? "h5" : "gw",
        accountCheckedAt: kind === "native_session_candidate" && confirmed ? NOW - 500 : null,
        accountSessionHash: kind === "native_session_candidate" && confirmed ? auth.cwSessionHash(cookies) : ""});
    return state;
}

function cacheFor(state, {code = "8-1-1111", snapshot = true, cookie = state.cookie, terminalStatus = "", version = state.version} = {}) {
    const values = core.cwCookieMap(cookie);
    return {version, owner: state.owner, inputHash: state.inputHash, source: "auto", generation: state.generation,
        runId: core.md5("synthetic-cache-run"), cookie, observedUnb: values.get("unb") || "",
        accountCheckedAt: state.accountCheckedAt ?? null, accountSessionHash: state.accountSessionHash || "", terminalStatus,
        snapshot: snapshot ? {items: core.cwItems([parcel("legacy", code)]), updatedAt: new Date(NOW - 500).toISOString()} : null};
}

function confirmedState(state) {
    const cookies = core.cwCookieMap(state.cookie);
    return {...state, status: "connected", confirmedAt: NOW, accountCheckedAt: NOW, accountSessionHash: auth.cwSessionHash(cookies)};
}

function queryRecord(changes = {}) {
    return {schema: 1, phase: "initial", stage: "identity", failure: "AUTH_REJECTED", retCode: "FAIL_SYS_SESSION_EXPIRED",
        httpClass: "HTTP_200", tokenPresentBefore: true, tokenUpdated: false, sessionAttempt: 1, tokenAttempt: 1,
        page: null, at: NOW, expiresAt: NOW + 7 * 86400000, ...changes};
}

function assertUnconfirmed(f, model) {
    assert.equal(model.status, "setup");
    assert.equal(model.setupTitle, "App 接入未确认");
    assert.equal(model.items.length, 0); assert.equal(model.updatedAt, null);
    assert.equal(saved(f).status, "unsupported"); assert.equal(saved(f).confirmedAt, null);
    assert.equal(saved(f).accountCheckedAt, null); assert.equal(saved(f).accountSessionHash, "");
    assert(!/App.*(?:退出|已过期)|登录(?:已)?过期/.test(model.message));
}

function assertBoundedRecord(f, expected = {}) {
    const record = diagnostic(f);
    assert(record, "本轮失败应有已绑定、未过期的脱敏诊断");
    assert.deepEqual(Object.keys(record).sort(), QUERY_KEYS.slice().sort());
    assert(FAILURES.includes(record.failure)); assert(HTTP_CLASSES.includes(record.httpClass));
    assert(record.at <= f.clock()); assert(record.expiresAt > f.clock());
    assert(record.expiresAt - record.at <= 7 * 86400000);
    for (const [key, value] of Object.entries(expected)) assert.equal(record[key], value, key);
    return record;
}

test("1.3.0 保留实际 Cookie 加 UID 候选与纯 native 候选的身份门禁", () => {
    assert.equal(core.CW_VERSION, "1.3.0");
    for (const [captureKind, expected] of [["request_cookie_candidate", true], ["native_session_candidate", true], ["request_cookie", false]]) {
        assert.equal(auth.cwRequiresIdentity({captureKind}), expected);
    }
});

test("同次缺 unb 的 GW 真实 Cookie 加 UID 只补账号，SID 不覆盖六个原值", () => {
    const f = fixture(), input = incoming(f, {extra: [["x-sign", "synthetic-app-signature"], ["x-mini-wua", "synthetic-app-wua"]]});
    Object.defineProperty(input.request, "body", {get() {throw new Error("不得读取 App 正文");}});
    const originalHeaders = input.request.headers;
    assert.equal(auth.captureCainiaoCredentials(input, f.clock), undefined);
    assert.equal(input.request.headers, originalHeaders); assert.equal(input.request.url, GW_URL);
    const state = saved(f), values = core.cwCookieMap(state.cookie);
    assert.equal(state.captureKind, "request_cookie_candidate"); assert.equal(state.sourceChannel, "gw");
    assert.equal(state.status, "pending"); assert.equal(state.confirmedAt, null); assert.equal(state.accountCheckedAt, null);
    assert.equal(values.get("unb"), UID); assert.equal(values.size, 7);
    for (const [name, value] of Object.entries(CAPTURED)) assert.equal(values.get(name), value, name);
    for (const marker of [SID, "synthetic-app-signature", "synthetic-app-wua"]) assert(!JSON.stringify(state).includes(marker));
    assert.equal(f.requests.length, 0);
});

test("实际会话 Cookie 加同次 UID 不需要 SID，采集不发送请求", () => {
    const f = fixture(); capture(f, {sid: null});
    assert.equal(saved(f).captureKind, "request_cookie_candidate"); assert.equal(saved(f).status, "pending");
    assert.equal(core.cwCookieMap(saved(f).cookie).get("cookie2"), CAPTURED.cookie2);
    assert.equal(f.requests.length, 0);
});

test("sgcookie 单独有效或 cookie2 为空时仍保留实际 sgcookie 候选", () => {
    for (const cookie of ["sgcookie=synthetic-real-sg-only; munb=synthetic-munb-only", "cookie2=; sgcookie=synthetic-real-sg-only"]) {
        const f = fixture(); capture(f, {cookie, sid: null});
        const values = core.cwCookieMap(saved(f).cookie);
        assert.equal(saved(f).captureKind, "request_cookie_candidate"); assert.equal(values.get("unb"), UID);
        assert.equal(values.get("sgcookie"), "synthetic-real-sg-only"); assert.equal(values.has("cookie2"), false);
    }
});

test("实际 Cookie 候选的 UID 仍严格拒绝零值、前导零、超长和非法头", () => {
    for (const uid of ["0", "01", "synthetic-user", "9".repeat(21), true, "123\r\nHost:evil.invalid"]) {
        const f = fixture(); capture(f, {uid, sid: null});
        assert.equal(saved(f), undefined); assert.equal(f.requests.length, 0);
    }
    const f = fixture(); capture(f, {sid: null, extra: [["X-UID", OTHER_UID]]});
    assert.equal(saved(f), undefined);
});

test("无 UID、token-only 和跨请求字段不拼出实际 Cookie 账号候选", () => {
    for (const options of [{uid: null, sid: null}, {cookie: "_m_h5_tk=synthetic-token-only_1; munb=synthetic-opaque-munb", sid: null}, {cookie: "cookie2=; sgcookie=", sid: null}]) {
        const f = fixture(); capture(f, options); assert.equal(saved(f), undefined); assert.equal(f.requests.length, 0);
    }
    const f = fixture(); capture(f, {cookie: "", sid: null}); f.advance(1000); capture(f, {uid: null, sid: null});
    assert.equal(saved(f), undefined); assert.equal(f.requests.length, 0);
});

test("实际 Cookie 加 UID 候选仅接受非公共时间精确 GW，自身与关闭模式忽略", () => {
    for (const options of [
        {url: H5_URL}, {url: "https://acs.m.taobao.com/gw/mtop.common.getTimestamp/*/"},
        {url: GW_URL.replace("cn-acs.m.cainiao.com", "cn-acs.m.cainiao.com.evil.invalid")},
        {url: GW_URL + "#fragment"}, {extra: [[core.CW_SELF_HEADER, "1"]]},
    ]) {
        const f = fixture(); capture(f, {...options, sid: null}); assert.equal(saved(f), undefined); assert.equal(f.requests.length, 0);
    }
    for (const mode of ["off", "manual", "invalid"]) {
        const f = fixture(); f.ctx.env.CONNECTION_MODE = mode; capture(f, {sid: null}); assert.equal(saved(f), undefined);
    }
});

test("完整真实 Cookie 的 unb 保持最高优先级，不改成受限新候选", () => {
    const f = fixture(); capture(f, {cookie: "unb=" + UID + "; " + COOKIE});
    assert.equal(saved(f).captureKind, "request_cookie"); assert.equal(auth.cwRequiresIdentity(saved(f)), false);
    assert(!saved(f).cookie.includes(SID));
    for (const [name, value] of Object.entries(CAPTURED)) assert.equal(core.cwCookieMap(saved(f).cookie).get(name), value);
});

test("实际 Cookie 候选包括终止态都不被同账号 SID-only 流量替换或复活", () => {
    for (const status of ["pending", "unsupported", "expired", "verify", "invalid", "connected"]) {
        const f = fixture(); capture(f);
        const previous = status === "connected" ? confirmedState(saved(f)) : {...saved(f), status};
        f.memory.set(core.CW_AUTH_STORE, previous);
        const snapshot = structuredClone(cached(f));
        f.advance(1000); capture(f, {cookie: "", sid: OTHER_SID});
        assert.deepEqual(saved(f), previous, status); assert.deepEqual(cached(f), snapshot, status);
    }
});

test("同账号活跃完整 Cookie 不被缺 unb 的实际候选降级", () => {
    for (const status of ["pending", "connected"]) {
        const f = fixture(), previous = legacyAuth({version: core.CW_VERSION, status});
        f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, cacheFor(previous));
        capture(f, {sid: null, cookie: COOKIE.replace(CAPTURED.cookie2, "synthetic-different-candidate-session")});
        assert.deepEqual(saved(f), previous); assert.equal(saved(f).captureKind, "request_cookie");
    }
});

test("候选类型变化即使稳定 Cookie 相同也创建新代次且不继承身份证明", () => {
    for (const direction of ["native-to-real", "real-to-complete"]) {
        const f = fixture();
        capture(f, direction === "native-to-real" ? {cookie: ""} : {cookie: "cookie2=" + SID, sid: null});
        const previous = confirmedState(saved(f)); f.memory.set(core.CW_AUTH_STORE, previous);
        f.memory.set(core.CW_STORE, cacheFor(previous)); f.advance(1000);
        capture(f, {cookie: (direction === "real-to-complete" ? "unb=" + UID + "; " : "") + "cookie2=" + SID, sid: null});
        const next = saved(f);
        assert.equal(next.sessionHash, previous.sessionHash); assert.notEqual(next.generation, previous.generation);
        assert.equal(next.captureKind, direction === "native-to-real" ? "request_cookie_candidate" : "request_cookie");
        assert.equal(next.status, "pending"); assert.equal(next.confirmedAt, null);
        assert.equal(next.accountCheckedAt, null); assert.equal(next.accountSessionHash, "");
    }
});

test("完整 Cookie 与 native UID 冲突仍隔离旧账号，不保存新实际会话", async () => {
    const f = fixture(), previous = legacyAuth();
    f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, cacheFor(previous));
    capture(f, {uid: OTHER_UID, cookie: "unb=" + UID + "; " + COOKIE});
    assert.deepEqual(saved(f), previous); assert.equal(cached(f).blocked, true); assert.equal(cached(f).snapshot, null);
    const model = await load(f); assert.equal(model.status, "setup"); assert.equal(model.items.length, 0);
    assert.equal(f.requests.length, 0);
});

test("新账号实际候选 AUTH 写入失败仍留下隔离屏障，不能回显旧码", async () => {
    for (const failure of ["throw", "noop"]) {
        const f = fixture(), previous = legacyAuth();
        f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, cacheFor(previous));
        const write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {
            if (key === core.CW_AUTH_STORE) {if (failure === "throw") throw new Error("synthetic-private-write-error"); return;}
            write(key, value);
        };
        capture(f, {uid: OTHER_UID, sid: null}); f.ctx.storage.setJSON = write;
        assert.deepEqual(saved(f), previous); assert.equal(cached(f).blocked, true); assert.equal(cached(f).snapshot, null);
        const model = await load(f); assert.equal(model.status, "setup"); assert.equal(model.items.length, 0);
        assert.equal(f.requests.length, 0); assert(!JSON.stringify(model).includes("synthetic-private-write-error"));
    }
});

test("合法 1.1.0、1.2.0 与 1.2.1 已连接 Cookie auth/cache 迁移保留账号、代次、token 和旧快照", async () => {
    for (const version of ["1.1.0", "1.2.0", "1.2.1"]) {
        const f = fixture([new Error("synthetic-migration-offline")]), previous = legacyAuth({version});
        const oldCache = cacheFor(previous);
        f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, oldCache);
        const state = auth.cwReadAuth(f.ctx, f.clock());
        assert.equal(state.version, core.CW_VERSION); assert.equal(state.captureKind, "request_cookie");
        for (const key of ["owner", "generation", "inputHash", "sessionHash", "cookie", "status", "capturedAt", "confirmedAt"]) assert.equal(state[key], previous[key], key);
        const model = await load(f); assert.equal(model.status, "offline"); assert.deepEqual(model.items, oldCache.snapshot.items);
        assert.equal(model.updatedAt, oldCache.snapshot.updatedAt); assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].url.searchParams.get("api"), API);
        assert(f.requests[0].options.headers.Cookie.includes(CAPTURED._m_h5_tk));
        assert.equal(cached(f).version, core.CW_VERSION); assert.equal(saved(f).status, "connected");
    }
});

test("旧 auth 终止态及 AUTH noop 的旧缓存终止标志在迁移后仍禁止查询", async () => {
    for (const version of ["1.1.0", "1.2.0", "1.2.1"]) {
        for (const fromCache of [false, true]) {
            const previous = legacyAuth({version, status: fromCache ? "connected" : "expired", confirmed: true});
            const f = fixture(), oldCache = cacheFor(previous, {terminalStatus: "expired"});
            f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, oldCache);
            const state = auth.cwReadAuth(f.ctx, f.clock());
            assert.equal(state.status, previous.status); assert.equal(state.generation, previous.generation);
            const model = await load(f); assert.equal(model.status, "expired"); assert.equal(f.requests.length, 0);
            assert.deepEqual(model.items, oldCache.snapshot.items); assert.equal(model.updatedAt, oldCache.snapshot.updatedAt);
            assert.equal(cached(f).terminalStatus, "expired");
        }
    }
});

test("1.2.0 已连接 native 及匹配缓存证明迁移后保留确认，直接执行新 PDS", async () => {
    const previous = legacyAuth({kind: "native_session_candidate"});
    const f = fixture([pds([parcel("new", "8-2-2222")])]), oldCache = cacheFor(previous);
    f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, oldCache);
    const state = auth.cwReadAuth(f.ctx, f.clock());
    assert.equal(state.version, core.CW_VERSION); assert.equal(state.accountSessionHash, previous.accountSessionHash);
    assert.equal(state.accountCheckedAt, previous.accountCheckedAt); assert.equal(state.generation, previous.generation);
    const model = await load(f); assert.equal(model.status, "ready"); assert.equal(model.items[0].code, "8-2-2222");
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url.searchParams.get("api"), API);
    assert.equal(cached(f).version, core.CW_VERSION); assert.equal(saved(f).version, core.CW_VERSION);
});

test("旧首次 native expired 只纠正接入提示，不复活、猜真实 Cookie 或补造错误原因", async () => {
    const previous = legacyAuth({kind: "native_session_candidate", status: "expired", confirmed: false});
    const f = fixture(); f.memory.set(core.CW_AUTH_STORE, previous);
    f.memory.set(core.CW_STORE, cacheFor(previous, {snapshot: false, terminalStatus: "expired"}));
    const model = await load(f); assert.equal(model.status, "setup"); assert.equal(model.setupTitle, "App 接入未确认");
    assert.equal(model.items.length, 0); assert.equal(f.requests.length, 0);
    const state = auth.cwReadAuth(f.ctx, f.clock()); assert.equal(state.status, "expired"); assert.equal(state.cookie, previous.cookie);
    assert.equal(state.generation, previous.generation); assert.equal(diagnostic(f), null);
    const text = renderedDiagnostic(f); assert.match(text, /旧版本未记录原因/);
    assert(!/登录(?:已)?过期/.test(text)); assert(!/TOKEN_NOT_ISSUED|AUTH_REJECTED|IDENTITY_UNVERIFIED/.test(text));
});

test("损坏旧 auth 和未知缓存版本不能绕过身份门禁或继承旧证明", async () => {
    const previous = legacyAuth();
    for (const changes of [{version: "1.4.0"}, {owner: "synthetic-wrong-owner"}, {sessionHash: core.md5("synthetic-wrong")}, {inputHash: core.md5("synthetic-wrong")}, {cookie: previous.cookie + "; cna=synthetic-tracker"}]) {
        assert.equal(auth.cwAuthState({...previous, ...changes}, NOW), null);
    }
    const f = fixture([identity(), count(), pds([parcel("new", "8-2-2222")])]); capture(f);
    const connected = confirmedState(saved(f)); f.memory.set(core.CW_AUTH_STORE, connected);
    f.memory.set(core.CW_STORE, cacheFor(connected, {version: "1.4.0"}));
    const model = await load(f); assert.equal(model.status, "ready"); assert.equal(model.items[0].code, "8-2-2222");
    assert.deepEqual(f.requests.map(request => request.url.searchParams.get("api")), [IDENTITY_API, COUNT_API, API]);
});

test("实际 Cookie 候选须身份 COUNT 完整 PDS，关闭 App 后连续两次请求新物流与新签名", async () => {
    const f = fixture([identity(), count(), pds([parcel("first", "8-1-1111")])]); capture(f, {sid: null});
    const first = await load(f); assert.equal(first.status, "ready"); assert.equal(saved(f).status, "connected");
    assert.equal(saved(f).accountCheckedAt, NOW); assert.equal(saved(f).confirmedAt, NOW);
    assert.deepEqual(f.requests.map(request => request.url.searchParams.get("api")), [IDENTITY_API, COUNT_API, API]);
    assert.equal(f.requests[0].url.searchParams.get("data"), "{}");
    assert.equal(f.requests[1].url.searchParams.get("data"), '{"appName":"GUOGUO"}');
    const generation = saved(f).generation, capturedAt = saved(f).capturedAt;
    for (const [index, code] of [[1, "8-2-2222"], [2, "8-3-3333"]]) {
        f.advance(15 * 60000); f.replies.push(pds([parcel("refresh-" + index, code)]));
        const model = await load(f); assert.equal(model.status, "ready"); assert.equal(model.items[0].code, code);
        assert.equal(f.requests.length, 3 + index); assert.equal(f.requests[2 + index].url.searchParams.get("api"), API);
        assert.notEqual(f.requests[1 + index].url.searchParams.get("t"), f.requests[2 + index].url.searchParams.get("t"));
        assert.notEqual(f.requests[1 + index].url.searchParams.get("sign"), f.requests[2 + index].url.searchParams.get("sign"));
        assert.equal(saved(f).generation, generation); assert.equal(saved(f).capturedAt, capturedAt);
    }
    for (const request of f.requests) {
        const values = core.cwCookieMap(request.options.headers.Cookie);
        for (const [name, value] of Object.entries(CAPTURED)) assert.equal(values.get(name), value);
        const token = values.get("_m_h5_tk").split("_")[0];
        const expected = createHash("md5").update(token + "&" + request.url.searchParams.get("t") + "&12574478&" + request.url.searchParams.get("data")).digest("hex");
        assert.equal(request.url.searchParams.get("sign"), expected); assert.equal(request.url.hostname, "h5api.m.taobao.com");
        assert.equal(request.options.headers[core.CW_SELF_HEADER], "1"); assert.equal(request.options.redirect, "manual");
        assert.equal(request.options.credentials, "omit"); assert.equal(request.options.insecureTls, false);
    }
    assert(!JSON.stringify([...f.memory]).includes("synthetic-identity-nick-do-not-persist"));
});

test("纯 native 首次 H5 登录拒绝同样是 unsupported，不误报 App 登录过期", async () => {
    const f = fixture([response({ret: ["FAIL_SYS_SESSION_EXPIRED::合成错误"]})]); capture(f, {cookie: ""});
    const model = await load(f); assertUnconfirmed(f, model); assert.equal(f.requests.length, 1);
    assertBoundedRecord(f, {phase: "initial", stage: "identity", failure: "AUTH_REJECTED", retCode: "FAIL_SYS_SESSION_EXPIRED", httpClass: "HTTP_200"});
    await load(f); assert.equal(f.requests.length, 1);
});

test("真实会话候选首次 SESSION 拒绝或 HTTP401 保存固定阶段并停止相同代次", async () => {
    for (const [reply, retCode, httpClass] of [
        [response({ret: ["FAIL_SYS_SESSION_EXPIRED::synthetic-private-ret-text"]}), "FAIL_SYS_SESSION_EXPIRED", "HTTP_200"],
        [response({}, [], 401), "NONE", "HTTP_401"],
    ]) {
        const f = fixture([reply]); capture(f, {sid: null});
        const model = await load(f); assertUnconfirmed(f, model);
        assertBoundedRecord(f, {phase: "initial", stage: "identity", failure: "AUTH_REJECTED", retCode, httpClass});
        assert(!JSON.stringify(cached(f).queryDiagnostic).includes("synthetic-private-ret-text"));
        await load(f); assert.equal(f.requests.length, 1);
    }
});

test("首次 token 未签发保留 TOKEN_NOT_ISSUED，不继续 COUNT 或伪造登录过期", async () => {
    const f = fixture([response({ret: ["FAIL_SYS_TOKEN_EMPTY::合成空 token"]})]);
    capture(f, {cookie: "cookie2=" + CAPTURED.cookie2, sid: null});
    assertUnconfirmed(f, await load(f)); assert.equal(f.requests.length, 1);
    assertBoundedRecord(f, {stage: "identity", failure: "TOKEN_NOT_ISSUED", retCode: "FAIL_SYS_TOKEN_EMPTY",
        tokenPresentBefore: false, tokenUpdated: false, tokenAttempt: 1, sessionAttempt: 1, page: null});
});

test("首次 token 持续更换仍最多三次，诊断记录 TOKEN_RETRY_EXHAUSTED 及真实轮次", async () => {
    const f = fixture(Array.from({length: 4}, (_, index) => response({ret: ["FAIL_SYS_TOKEN_EXPIRED::合成 token 失败"]},
        ["_m_h5_tk=synthetic-renewed-token-" + index + "_2; Path=/"])));
    capture(f, {sid: null}); assertUnconfirmed(f, await load(f)); assert.equal(f.requests.length, 3);
    assertBoundedRecord(f, {failure: "TOKEN_RETRY_EXHAUSTED", tokenAttempt: 3, sessionAttempt: 1, tokenPresentBefore: true, tokenUpdated: true});
    assert(new Set(f.requests.map(request => request.url.searchParams.get("sign"))).size === 3);
    await load(f); assert.equal(f.requests.length, 3);
});

test("首次 ILLEGAL_ACCESS 只保存固定错误类别，不把未知返回正文带入诊断", async () => {
    const f = fixture([response({ret: ["FAIL_SYS_ILLEGAL_ACCESS::synthetic-private-ret-explanation"]})]); capture(f, {sid: null});
    assertUnconfirmed(f, await load(f));
    assertBoundedRecord(f, {failure: "ILLEGAL_ACCESS", retCode: "FAIL_SYS_ILLEGAL_ACCESS", stage: "identity"});
    assert(!JSON.stringify(cached(f).queryDiagnostic).includes("synthetic-private-ret-explanation"));
});

test("首次 identity 删除最后实际会话 Cookie 为 SESSION_MISSING，最多一个请求", async () => {
    const f = fixture([identity(UID, {}, ["cookie2=; Max-Age=0; Path=/"]), count(), pds([])]);
    capture(f, {cookie: "cookie2=" + CAPTURED.cookie2, sid: null});
    assertUnconfirmed(f, await load(f)); assert.equal(f.requests.length, 1);
    assertBoundedRecord(f, {failure: "SESSION_MISSING", phase: "initial", stage: "identity"});
    await load(f); assert.equal(f.requests.length, 1);
});

test("首次稳定会话连续轮换最多三轮且不确认空列表，保存 SESSION_UNSTABLE", async () => {
    const f = fixture(Array.from({length: 4}, (_, index) => identity(UID, {}, ["cookie2=synthetic-unstable-session-" + index + "; Path=/"])));
    capture(f, {sid: null}); assertUnconfirmed(f, await load(f)); assert.equal(f.requests.length, 3);
    assert(f.requests.every(request => request.url.searchParams.get("api") === IDENTITY_API));
    assertBoundedRecord(f, {failure: "SESSION_UNSTABLE", sessionAttempt: 3, stage: "identity"});
});

test("新类型身份仍只接受精确顶层 UID，未知结构终止而另一账号清除旧结果", async () => {
    for (const changes of [{userNumId: undefined, data: {userNumId: UID}}, {userNumId: "0"}, {userNumId: Number(UID)}]) {
        const f = fixture([identity(UID, changes)]); capture(f, {sid: null});
        assertUnconfirmed(f, await load(f)); assert.equal(f.requests.length, 1);
        assertBoundedRecord(f, {failure: "IDENTITY_UNVERIFIED", stage: "identity"});
    }
    const f = fixture([identity(OTHER_UID)]); capture(f, {sid: null});
    f.memory.set(core.CW_STORE, cacheFor(saved(f)));
    const model = await load(f); assert.equal(model.items.length, 0); assert.equal(saved(f).status, "invalid");
    assert.equal(cached(f).snapshot, null); assert.equal(cached(f).cookie, ""); assert.equal(f.requests.length, 1);
    assertBoundedRecord(f, {failure: "ACCOUNT_MISMATCH", stage: "identity"});
});

test("COUNT API echo 或结构不兼容不能连接，失败记录绑定 count 阶段", async () => {
    for (const [changes, failure] of [[{api: API}, "API_MISMATCH"], [{data: []}, "SCHEMA_INVALID"]]) {
        const f = fixture([identity(), count(changes)]); capture(f, {sid: null});
        assertUnconfirmed(f, await load(f)); assert.equal(f.requests.length, 2);
        assertBoundedRecord(f, {stage: "count", failure, page: null});
    }
});

test("新候选 PDS 缺少 API echo 或分页结构不兼容不连接且记录 pds 页号", async () => {
    for (const [reply, failure] of [
        [success([]), "API_MISMATCH"],
        [response({api: API, ret: ["SUCCESS::成功"], data: {packages: "synthetic-invalid-schema"}}), "SCHEMA_INVALID"],
    ]) {
        const f = fixture([identity(), count(), reply]); capture(f, {sid: null});
        assertUnconfirmed(f, await load(f)); assert.equal(f.requests.length, 3);
        assertBoundedRecord(f, {stage: "pds", failure, page: 1});
    }
});

test("COUNT 成功而 PDS 网络失败不保存确认时间，下一轮重新身份 COUNT", async () => {
    const f = fixture([identity(), count(), new Error("synthetic-private-network-error")]); capture(f, {sid: null});
    const model = await load(f); assert.equal(model.status, "offline"); assert.equal(saved(f).status, "pending");
    assert.equal(saved(f).confirmedAt, null); assert.equal(saved(f).accountCheckedAt, null); assert.equal(cached(f).snapshot, null);
    assertBoundedRecord(f, {phase: "initial", stage: "pds", failure: "OFFLINE", page: 1});
    assert(!renderedDiagnostic(f).includes("synthetic-private-network-error"));
    f.advance(1000); f.replies.push(identity(), count(), pds([]));
    assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, 6);
    assert.deepEqual(f.requests.slice(3).map(request => request.url.searchParams.get("api")), [IDENTITY_API, COUNT_API, API]);
});

test("新候选仅成功第一页不能 connected，第二页失败诊断不冒充完整查询", async () => {
    const f = fixture([identity(), count(), pds([parcel("partial")], 2, 1), new Error("synthetic-partial-offline")]);
    capture(f, {sid: null}); const model = await load(f);
    assert.equal(model.status, "partial"); assert.equal(model.partial, true); assert.equal(saved(f).status, "pending");
    assert.equal(saved(f).confirmedAt, null); assert.equal(saved(f).accountCheckedAt, null); assert.equal(cached(f).snapshot, null);
    assertBoundedRecord(f, {stage: "pds", page: 2, failure: "OFFLINE"});
});

test("真实 Cookie 身份或分页时轮换会话丢弃旧证明与旧页，从第一页重验", async () => {
    for (const stage of ["identity", "pds"]) {
        const rotated = "synthetic-real-rotated-session";
        const replies = stage === "identity"
            ? [identity(OTHER_UID, {}, ["cookie2=" + rotated + "; Path=/"]), identity(), count(), pds([parcel("new", "8-2-2222")])]
            : [identity(), count(), pds([parcel("old-first", "8-1-1111")], 2, 1), pds([parcel("old-second", "8-9-9999")], 2, 2, ["cookie2=" + rotated + "; Path=/"]), identity(), count(), pds([parcel("new", "8-2-2222")])];
        const f = fixture(replies); capture(f, {sid: null}); const model = await load(f);
        assert.equal(model.status, "ready"); assert.equal(model.items.length, 1); assert.equal(model.items[0].code, "8-2-2222");
        assert(!JSON.stringify(model).includes("8-1-1111")); assert(!JSON.stringify(model).includes("8-9-9999"));
        const currentCookies = core.cwCookieMap(cached(f).cookie);
        assert.equal(currentCookies.get("cookie2"), rotated);
        assert.equal(cached(f).accountSessionHash, auth.cwSessionHash(currentCookies));
        assert.equal(cached(f).accountSessionHash, saved(f).accountSessionHash); assert.equal(cached(f).accountCheckedAt, saved(f).accountCheckedAt);
        assert.equal(JSON.parse(f.requests.at(-1).url.searchParams.get("data")).currentPage, 1);
        assertBoundedRecord(f, {phase: "revalidate", stage: "pds", failure: "NONE"});
    }
});

test("完整确认后 H5 登录拒绝仍为 expired 和明确旧结果，不宣称 App 退出", async () => {
    const f = fixture([identity(), count(), pds([parcel("old", "8-1-1111")]), response({ret: ["FAIL_SYS_SESSION_EXPIRED::合成过期"]})]);
    capture(f, {sid: null}); const first = await load(f); f.advance(60000);
    const model = await load(f); assert.equal(model.status, "expired"); assert.deepEqual(model.items, first.items);
    assert.equal(model.updatedAt, first.updatedAt); assert.match(model.message, /上次结果/); assert.equal(saved(f).status, "expired");
    assert(!/App.*(?:退出|登录已过期)/.test(model.message));
    assertBoundedRecord(f, {phase: "refresh", stage: "pds", failure: "AUTH_REJECTED", page: 1});
    await load(f); assert.equal(f.requests.length, 4);
});

test("确认后的短期 token 轮换不重验身份且供下一次独立 PDS 复用", async () => {
    const f = fixture([identity(), count(), pds([parcel("first")]),
        response({ret: ["FAIL_SYS_TOKEN_EXPIRED::合成 token 过期"]}, ["_m_h5_tk=synthetic-refresh-token_2; Path=/"]),
        pds([parcel("next")]), pds([])]);
    capture(f, {sid: null}); assert.equal((await load(f)).status, "ready");
    const generation = saved(f).generation, proof = saved(f).accountSessionHash;
    f.advance(60000); assert.equal((await load(f)).status, "ready");
    assert.deepEqual(f.requests.slice(3).map(request => request.url.searchParams.get("api")), [API, API]);
    assert.equal(saved(f).generation, generation); assert.equal(saved(f).accountSessionHash, proof);
    f.advance(60000); assert.equal((await load(f)).status, "ready");
    assert(f.requests.at(-1).options.headers.Cookie.includes("synthetic-refresh-token_2"));
    assert.equal(f.requests.at(-1).url.searchParams.get("api"), API);
});

test("新候选首次失败 AUTH noop 时缓存 unsupported 与诊断仍停止，重捕获新代次才恢复", async () => {
    const f = fixture([response({}, [], 401)]); capture(f, {sid: null});
    const previous = saved(f), write = f.ctx.storage.setJSON;
    f.ctx.storage.setJSON = (key, value) => {if (key !== core.CW_AUTH_STORE) write(key, value);};
    const model = await load(f); assert.notEqual(model.status, "ready"); assert.match(model.message, /写入失败|未确认/);
    assert.equal(saved(f).status, "pending"); assert.equal(cached(f).terminalStatus, "unsupported");
    assertBoundedRecord(f, {failure: "AUTH_REJECTED", stage: "identity"});
    await load(f); assert.equal(f.requests.length, 1); assert(!/查询已确认/.test(renderedDiagnostic(f)));
    f.ctx.storage.setJSON = write; f.advance(1000); capture(f, {sid: null});
    assert.notEqual(saved(f).generation, previous.generation); assert.equal(saved(f).status, "pending");
    assert.equal(diagnostic(f), null);
    f.replies.push(identity(), count(), pds([])); assert.equal((await load(f)).status, "ready");
});

test("初始缓存 noop 后在途换号不能把旧包裹或旧失败诊断写进新账号", async () => {
    const f = fixture([identity(), count(), pds([parcel("old", "8-1-1111")])]); capture(f, {sid: null});
    assert.equal((await load(f)).status, "ready");
    const write = f.ctx.storage.setJSON; let skipped = false, barrier;
    f.ctx.storage.setJSON = (key, value) => {
        if (!skipped && key === core.CW_STORE) {skipped = true; return;}
        write(key, value);
    };
    f.replies.push(() => {capture(f, {uid: OTHER_UID, sid: null}); barrier = structuredClone(cached(f)); return pds([parcel("stale", "8-9-9999")]);});
    const model = await load(f); assert.equal(skipped, true); assert.equal(model.status, "setup"); assert.equal(model.items.length, 0);
    assert.deepEqual(cached(f), barrier); assert.equal(cached(f).blocked, true); assert.equal(cached(f).snapshot, null);
    assert.equal(core.cwCookieMap(saved(f).cookie).get("unb"), OTHER_UID); assert.equal(diagnostic(f), null);
});

test("同账号并发旧响应不覆盖较新快照与诊断，初始 noop 下迟到成功失败均停止", async () => {
    for (const late of ["success", "failure"]) {
        const f = fixture([identity(), count(), pds([parcel("old", "8-1-1111")])]); capture(f, {sid: null});
        assert.equal((await load(f)).status, "ready");
        const write = f.ctx.storage.setJSON; let skipped = false, finish;
        f.ctx.storage.setJSON = (key, value) => {
            if (!skipped && key === core.CW_STORE) {skipped = true; return;}
            write(key, value);
        };
        f.replies.push(() => new Promise(resolve => {finish = resolve;}));
        const first = load(f);
        for (let step = 0; !finish && step < 200; step++) await Promise.resolve();
        assert.equal(typeof finish, "function", "首任务应已进入合成等待");
        f.advance(1000); f.replies.push(pds([parcel("latest", "8-2-2222")]));
        const latest = await load(f); assert.equal(latest.status, "ready"); const stable = structuredClone(cached(f));
        finish(late === "success" ? pds([parcel("stale", "8-9-9999")]) : response({}, [], 401));
        const stale = await first; assert.equal(stale.status, "setup"); assert.equal(stale.items.length, 0);
        assert.deepEqual(cached(f), stable); assert.deepEqual(stable.snapshot.items, latest.items);
        assert.equal(auth.cwQueryDiagnostic(stable, auth.cwReadAuth(f.ctx, f.clock()), f.clock()).failure, "NONE");
    }
});

test("queryDiagnostic 白名单重建准确字段，剥离正文 URL 凭据与摘要等附加值", () => {
    const original = queryRecord({url: "https://evil.invalid/synthetic-private-url", cookie: COOKIE, uid: UID, sid: SID,
        body: {secret: "synthetic-private-body"}, owner: core.md5("synthetic-owner"), runId: core.md5("synthetic-run")});
    const clean = auth.cwQueryFields(original, NOW);
    assert.deepEqual(clean, queryRecord()); assert.deepEqual(Object.keys(clean).sort(), QUERY_KEYS.slice().sort());
    clean.failure = "UNKNOWN"; assert.equal(original.failure, "AUTH_REJECTED", "不得修改调用方记录");
    for (const secret of [COOKIE, UID, SID, "synthetic-private-url", "synthetic-private-body"]) assert(!JSON.stringify(clean).includes(secret));
});

test("queryDiagnostic 只接受固定 phase stage failure HTTP 类及整数轮次和页号", () => {
    for (const phase of ["initial", "refresh", "revalidate"]) assert(auth.cwQueryFields(queryRecord({phase}), NOW));
    for (const stage of ["identity", "count", "pds"]) assert(auth.cwQueryFields(queryRecord({stage, page: stage === "pds" ? 1 : null}), NOW));
    for (const failure of FAILURES) assert(auth.cwQueryFields(queryRecord({failure}), NOW), failure);
    for (const httpClass of HTTP_CLASSES) assert(auth.cwQueryFields(queryRecord({httpClass}), NOW), httpClass);
    for (const retCode of ["NONE", "OTHER", "SUCCESS", "FAIL_SYS_TOKEN_EMPTY", "FAIL_SYS_SESSION_EXPIRED"]) assert(auth.cwQueryFields(queryRecord({retCode}), NOW), retCode);
    for (const changes of [
        {schema: 2}, {phase: "synthetic-secret-phase"}, {stage: "synthetic-secret-stage"}, {failure: "synthetic-secret-failure"},
        {httpClass: "HTTP_418_RAW_VALUE"}, {retCode: "synthetic-private-return-code"}, {tokenPresentBefore: 1}, {tokenUpdated: "false"},
        {sessionAttempt: 0}, {sessionAttempt: 4}, {sessionAttempt: 1.5}, {tokenAttempt: 0}, {tokenAttempt: 4}, {tokenAttempt: true},
        {page: 0}, {page: 21}, {page: "1"}, {page: false},
    ]) assert.equal(auth.cwQueryFields(queryRecord(changes), NOW), null, JSON.stringify(changes));
});

test("queryDiagnostic 的时间须安全整数且最长七天，过期未来或损坏记录拒绝", () => {
    assert(auth.cwQueryFields(queryRecord({expiresAt: NOW + 7 * 86400000}), NOW));
    for (const changes of [
        {at: 0}, {at: NOW + 120000}, {at: String(NOW)}, {at: NOW + 0.5}, {at: Number.MAX_SAFE_INTEGER + 1},
        {expiresAt: NOW}, {expiresAt: NOW - 1}, {expiresAt: NOW + 7 * 86400000 + 1},
        {expiresAt: String(NOW + 1000)}, {expiresAt: Infinity}, {expiresAt: Number.MAX_SAFE_INTEGER + 1},
    ]) assert.equal(auth.cwQueryFields(queryRecord(changes), NOW), null);
    for (const value of [null, false, [], "synthetic-not-record"]) assert.equal(auth.cwQueryFields(value, NOW), null);
});

test("queryDiagnostic 必须绑定当前自动 auth 的版本账号输入和代次，不认手动或外来缓存", () => {
    const f = fixture(); capture(f, {sid: null});
    const state = auth.cwReadAuth(f.ctx, NOW), valid = {...cacheFor(state, {snapshot: false}), queryDiagnostic: queryRecord()};
    assert.deepEqual(auth.cwQueryDiagnostic(valid, state, NOW), queryRecord());
    for (const changes of [
        {version: "1.4.0"}, {source: "manual"}, {source: "capture"}, {owner: core.md5("synthetic-other-owner")},
        {inputHash: core.md5("synthetic-other-input")}, {generation: core.md5("synthetic-other-generation")},
    ]) assert.equal(auth.cwQueryDiagnostic({...valid, ...changes}, state, NOW), null);
    assert.equal(auth.cwQueryDiagnostic(valid, null, NOW), null);
    assert.equal(auth.cwQueryDiagnostic(null, state, NOW), null);
});

test("同组件诊断只读输出失败阶段与保存字段名，不输出实际值未知 ret 或异常", async () => {
    const f = fixture([response({ret: ["FAIL_SYS_SESSION_EXPIRED::synthetic-private-ret-detail"]})]); capture(f);
    await load(f); const state = saved(f), values = Object.values(CAPTURED);
    const writes = f.writes.length, requests = f.requests.length, memory = structuredClone([...f.memory]);
    const text = renderedDiagnostic(f);
    assert.match(text, /identity|身份/); assert.match(text, /AUTH_REJECTED|拒绝/);
    assert.match(text, /cookie2/); assert.match(text, /sgcookie/); assert.match(text, /unb/);
    for (const secret of values.concat([UID, SID, state.owner, state.generation, state.inputHash, state.sessionHash, "synthetic-private-ret-detail"])) assert(!text.includes(secret));
    assert.equal(f.writes.length, writes); assert.equal(f.requests.length, requests); assert.deepEqual([...f.memory], memory);
    const dirty = {...cached(f), queryDiagnostic: queryRecord({retCode: "synthetic-private-unknown-ret", failure: "synthetic-private-unknown-failure", url: "https://evil.invalid/synthetic-private-url"})};
    f.memory.set(core.CW_STORE, dirty); const dirtyText = renderedDiagnostic(f);
    for (const secret of ["synthetic-private-unknown-ret", "synthetic-private-unknown-failure", "synthetic-private-url"]) assert(!dirtyText.includes(secret));
});

test("诊断过期后不延长原因、不恢复终止会话，匿名和 SID-only 流量不续期", async () => {
    const f = fixture([response({ret: ["FAIL_SYS_SESSION_EXPIRED::合成初次拒绝"]})]); capture(f, {sid: null});
    assertUnconfirmed(f, await load(f)); const state = structuredClone(saved(f)), raw = structuredClone(cached(f).queryDiagnostic);
    f.advance(raw.expiresAt - f.clock() + 1);
    assert.equal(diagnostic(f), null); const text = renderedDiagnostic(f);
    assert(!text.includes("AUTH_REJECTED")); assert.deepEqual(saved(f), state); assert.deepEqual(cached(f).queryDiagnostic, raw);
    capture(f, {cookie: "", uid: null, sid: null}); capture(f, {cookie: "", sid: OTHER_SID});
    assert.deepEqual(saved(f), state); assert.deepEqual(cached(f).queryDiagnostic, raw);
    assert.equal(diagnostic(f), null); const model = await load(f); assert.equal(model.status, "setup");
    assert.equal(f.requests.length, 1); assert.equal(saved(f).status, "unsupported");
});

async function assertSidOnlyKeepsForeignBarrier(status) {
    for (const failure of ["throw", "noop"]) {
        for (const barrierVersion of [core.CW_VERSION, "1.2.1", "1.2.0", "1.1.0", "1.4.0"]) {
            const label = status + "/" + failure + "/" + barrierVersion;
            const f = fixture(); capture(f, {sid: null});
            const wasConfirmed = ["connected", "expired", "verify", "invalid"].includes(status);
            const previous = {...(wasConfirmed ? confirmedState(saved(f)) : saved(f)), status};
            f.memory.set(core.CW_AUTH_STORE, previous);
            f.memory.set(core.CW_STORE, cacheFor(previous, {snapshot: wasConfirmed}));
            const write = f.ctx.storage.setJSON;
            f.ctx.storage.setJSON = (key, value) => {
                if (key === core.CW_AUTH_STORE) {
                    if (failure === "throw") throw new Error("synthetic-account-b-save-failure");
                    return;
                }
                write(key, value);
            };
            f.advance(1000); capture(f, {uid: OTHER_UID, sid: null});
            f.ctx.storage.setJSON = write;
            assert.deepEqual(saved(f), previous, label);
            assert.equal(cached(f).blocked, true, label); assert.notEqual(cached(f).owner, previous.owner, label);
            assert.equal(cached(f).snapshot, null, label); assert.equal(cached(f).cookie, "", label);
            const barrier = {...structuredClone(cached(f)), version: barrierVersion};
            f.memory.set(core.CW_STORE, barrier);
            const writes = f.writes.filter(item => [core.CW_AUTH_STORE, core.CW_STORE].includes(item.key)).length;
            f.advance(1000); capture(f, {cookie: "", sid: OTHER_SID});
            assert.deepEqual(saved(f), previous, label); assert.deepEqual(cached(f), barrier, label);
            assert.equal(f.writes.filter(item => [core.CW_AUTH_STORE, core.CW_STORE].includes(item.key)).length, writes, label);
            const model = await load(f);
            assert.equal(model.status, "setup", label); assert.equal(model.items.length, 0, label);
            assert.equal(model.updatedAt, null, label); assert.equal(f.requests.length, 0, label);
            assert(!JSON.stringify(model).includes("8-1-1111"), label);
            assert.deepEqual(saved(f), previous, label); assert.deepEqual(cached(f), barrier, label);
        }
    }
}

test("强实际 Cookie pending A 的 SID-only 不撤销 B 保存失败屏障，包括旧与未知屏障版本", async () => {
    await assertSidOnlyKeepsForeignBarrier("pending");
});

test("强实际 Cookie connected A 的 SID-only 不撤销 B 保存失败屏障或重新查询旧码", async () => {
    await assertSidOnlyKeepsForeignBarrier("connected");
});

test("强实际 Cookie terminal A 的 SID-only 不撤销 B 保存失败屏障或复活终止会话", async () => {
    for (const status of ["unsupported", "expired", "verify", "invalid"]) await assertSidOnlyKeepsForeignBarrier(status);
});

test("完整 request_cookie 旧版及当前 expired verify invalid 不被 SID-only 替换或复活", async () => {
    for (const version of ["1.1.0", "1.2.0", "1.2.1", core.CW_VERSION]) {
        for (const status of ["expired", "verify", "invalid"]) {
            const label = version + "/" + status;
            const previous = legacyAuth({version, status, confirmed: true}), oldCache = cacheFor(previous, {terminalStatus: status});
            const f = fixture();
            f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, oldCache);
            const before = auth.cwReadAuth(f.ctx, f.clock());
            assert.equal(before.captureKind, "request_cookie", label); assert.equal(auth.cwRequiresIdentity(before), false, label);
            const writes = f.writes.filter(item => [core.CW_AUTH_STORE, core.CW_STORE].includes(item.key)).length;
            f.advance(1000); capture(f, {cookie: "", sid: OTHER_SID});
            assert.deepEqual(saved(f), previous, label); assert.deepEqual(cached(f), oldCache, label);
            assert.equal(f.writes.filter(item => [core.CW_AUTH_STORE, core.CW_STORE].includes(item.key)).length, writes, label);
            const model = await load(f); assert.notEqual(model.status, "ready", label); assert.equal(f.requests.length, 0, label);
            const current = auth.cwReadAuth(f.ctx, f.clock());
            assert.equal(current.status, status, label); assert.equal(current.cookie, previous.cookie, label);
            assert.equal(current.generation, previous.generation, label); assert.equal(current.captureKind, "request_cookie", label);
            assert(!current.cookie.includes(OTHER_SID), label);
        }
    }
});

test("完整旧版及当前 Cookie terminal A 的 SID-only 不撤销 B AUTH 保存失败屏障", async () => {
    for (const version of ["1.1.0", "1.2.0", "1.2.1", core.CW_VERSION]) {
        for (const status of ["expired", "verify", "invalid"]) {
            for (const failure of ["throw", "noop"]) {
                for (const barrierVersion of ["1.1.0", "1.2.0", "1.2.1", core.CW_VERSION, "1.4.0"]) {
                    const label = version + "/" + status + "/" + failure + "/" + barrierVersion;
                    const previous = legacyAuth({version, status, confirmed: true}), f = fixture();
                    f.memory.set(core.CW_AUTH_STORE, previous);
                    f.memory.set(core.CW_STORE, cacheFor(previous, {terminalStatus: status}));
                    const write = f.ctx.storage.setJSON;
                    f.ctx.storage.setJSON = (key, value) => {
                        if (key === core.CW_AUTH_STORE) {
                            if (failure === "throw") throw new Error("synthetic-complete-cookie-b-save-failure");
                            return;
                        }
                        write(key, value);
                    };
                    f.advance(1000); capture(f, {uid: OTHER_UID, sid: null}); f.ctx.storage.setJSON = write;
                    assert.deepEqual(saved(f), previous, label);
                    assert.equal(cached(f).blocked, true, label); assert.notEqual(cached(f).owner, previous.owner, label);
                    assert.equal(cached(f).snapshot, null, label); assert.equal(cached(f).cookie, "", label);
                    const barrier = {...structuredClone(cached(f)), version: barrierVersion};
                    f.memory.set(core.CW_STORE, barrier);
                    const writes = f.writes.filter(item => [core.CW_AUTH_STORE, core.CW_STORE].includes(item.key)).length;
                    f.advance(1000); capture(f, {cookie: "", sid: OTHER_SID});
                    assert.deepEqual(saved(f), previous, label); assert.deepEqual(cached(f), barrier, label);
                    assert.equal(f.writes.filter(item => [core.CW_AUTH_STORE, core.CW_STORE].includes(item.key)).length, writes, label);
                    const model = await load(f);
                    assert.equal(model.status, "setup", label); assert.equal(model.items.length, 0, label);
                    assert.equal(model.updatedAt, null, label); assert.equal(f.requests.length, 0, label);
                    assert(!JSON.stringify(model).includes("8-1-1111"), label);
                    assert.deepEqual(saved(f), previous, label); assert.deepEqual(cached(f), barrier, label);
                    assert.equal(auth.cwReadAuth(f.ctx, f.clock()).captureKind, "request_cookie", label);
                }
            }
        }
    }
});

test("已完整确认后接口或身份重验不兼容保留非空及空快照原时间，终止重试而非首次 setup", async () => {
    for (const packages of [[parcel("confirmed", "8-1-1111")], []]) {
        for (const stage of ["pds", "identity"]) {
            const label = stage + "/" + (packages.length ? "nonempty" : "empty");
            const f = fixture([identity(), count(), pds(packages)]); capture(f, {sid: null});
            const first = await load(f); assert.equal(first.status, "ready", label);
            const confirmedAt = saved(f).confirmedAt, originalSnapshot = structuredClone(cached(f).snapshot);
            assert.equal(confirmedAt, NOW, label); assert(first.updatedAt, label);
            f.advance(60000);
            if (stage === "pds") {
                f.replies.push(response({api: COUNT_API, ret: ["SUCCESS::成功"], data: {packages: [], totalPage: 1, currentPage: 1}}));
            } else {
                f.replies.push(pds([], 1, 1, ["cookie2=synthetic-confirmed-revalidate-session; Path=/"]), identity(UID, {userNumId: undefined}));
            }
            const failed = await load(f);
            assert.equal(failed.status, "error", label); assert.notEqual(failed.setupTitle, "App 接入未确认", label);
            assert.deepEqual(failed.items, first.items, label); assert.equal(failed.total, first.total, label);
            assert.equal(failed.updatedAt, first.updatedAt, label); assert.match(failed.message, /上次结果/, label);
            assert.equal(saved(f).status, "unsupported", label); assert.equal(saved(f).confirmedAt, confirmedAt, label);
            assert.deepEqual(cached(f).snapshot, originalSnapshot, label);
            assertBoundedRecord(f, {phase: stage === "pds" ? "refresh" : "revalidate", stage,
                failure: stage === "pds" ? "API_MISMATCH" : "IDENTITY_UNVERIFIED"});
            const requests = f.requests.length; f.advance(1000);
            const stopped = await load(f);
            assert.equal(stopped.status, "error", label); assert.notEqual(stopped.setupTitle, "App 接入未确认", label);
            assert.deepEqual(stopped.items, first.items, label); assert.equal(stopped.updatedAt, first.updatedAt, label);
            assert.equal(stopped.total, first.total, label); assert.equal(f.requests.length, requests, label);
            assert.equal(saved(f).status, "unsupported", label); assert.equal(saved(f).confirmedAt, confirmedAt, label);
            assert.deepEqual(cached(f).snapshot, originalSnapshot, label);
            const text = renderedDiagnostic(f);
            assert.match(text, /本次独立查询未确认/, label);
            assert(!/App 接入未确认，尚未通过完整个人查询|首次.*(?:未完成|未确认)/.test(text), label);
            assert.equal(f.requests.length, requests, label);
        }
    }
});
