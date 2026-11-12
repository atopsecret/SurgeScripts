// 引擎：Node.js 20+ 内置测试 | 版本：1.2.4 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --experimental-vm-modules --test cainiao-widget/tests/version-migration.test.cjs
// 依赖：内置库与 auth-fixture.cjs；仅合成会话、内存存储与模拟 HTTP
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {NOW, parcel, response, fixture} = require("./auth-fixture.cjs");

const FROM_VERSION = "1.2.1";
const UID = "900000000000000001";
const OTHER_UID = "900000000000000002";
const SESSION = "synthetic-migration-real-session";
const SID = "synthetic-migration-native-sid";
const CAPTURED_TOKEN = "synthetic-migration-captured-token_1";
const SERVER_TOKEN = "synthetic-migration-server-token_2";
const IDENTITY_API = "mtop.user.getUserSimple";
const COUNT_API = "mtop.cainiao.lpc.packageservice.user.package.count.query";
const PDS_API = "mtop.cainiao.lpc.packageservice.queryPdsPackageDataList";
const PDS_DATA = '{"pageSize":50,"currentPage":1,"needTemporality":false,"needDynInfo":"{\'needFindTemporality\':true,\'needAppointment\':true}"}';
const H5_URL = "https://acs.m.taobao.com/h5/" + PDS_API.toLowerCase() + "/1.0/";
const GW_URL = "https://cn-acs.m.cainiao.com/gw/" + PDS_API.toLowerCase() + "/*/";
const DAY = 86400000;
const AUTH_FIELDS = ["owner", "sessionHash", "generation", "inputHash", "cookie", "status", "capturedAt", "confirmedAt",
    "sourceHost", "captureKind", "sourceChannel", "accountCheckedAt", "accountSessionHash"];
const QUERY_KEYS = ["schema", "phase", "stage", "failure", "retCode", "httpClass", "tokenPresentBefore",
    "tokenUpdated", "sessionAttempt", "tokenAttempt", "page", "at", "expiresAt"];
let core, auth, runtime, app, networkAttempts = 0;

before(async () => {
    const denyNetwork = () => {networkAttempts++; throw new Error("迁移回归禁止真实网络");};
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
    app = await import("../app.mjs");
});

after(() => {
    mock.restoreAll();
    assert.equal(networkAttempts, 0, "迁移只允许夹具内存 HTTP");
});

const digest = value => createHash("md5").update(value).digest("hex");
const saved = f => f.memory.get(core.CW_AUTH_STORE);
const cached = f => f.memory.get(core.CW_STORE);
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);
const diagnostic = f => auth.cwQueryDiagnostic(cached(f), auth.cwReadAuth(f.ctx, f.clock()), f.clock());
const identity = (cookies = []) => response({api: IDENTITY_API, ret: ["SUCCESS::成功"], userNumId: UID, data: {}}, cookies);
const count = () => response({api: COUNT_API, ret: ["SUCCESS::成功"], data: {count: 1}});
const pds = (code = "8-2-2222") => response({api: PDS_API, ret: ["SUCCESS::成功"],
    data: {packages: [parcel("migration-new-" + code, code)], totalPage: 1, currentPage: 1}});

function oldAuth({kind = "request_cookie_candidate", status = "connected", confirmed = status === "connected"} = {}) {
    const restricted = kind !== "request_cookie";
    const cookies = core.cwCookieMap(kind === "native_session_candidate" ? "unb=" + UID + "; cookie2=" + SID
        : "unb=" + UID + "; cookie2=" + SESSION + "; sgcookie=synthetic-migration-sg; munb=synthetic-migration-munb; _m_h5_tk="
            + CAPTURED_TOKEN + "; _m_h5_tk_enc=synthetic-migration-captured-enc; _tb_token_=synthetic-migration-tb");
    const cookie = core.cwCookieHeader(cookies);
    return {version: FROM_VERSION, owner: core.cwOwner(cookies), sessionHash: auth.cwSessionHash(cookies),
        generation: digest("synthetic-migration-generation:" + kind + ":" + status), inputHash: digest(cookie), cookie,
        status, capturedAt: NOW - 120000, confirmedAt: confirmed ? NOW - 60000 : null,
        sourceHost: restricted ? "cn-acs.m.cainiao.com" : "acs.m.taobao.com", captureKind: kind, sourceChannel: restricted ? "gw" : "h5",
        accountCheckedAt: restricted && confirmed ? NOW - 60000 : null, accountSessionHash: restricted && confirmed ? auth.cwSessionHash(cookies) : ""};
}

function queryRecord(changes = {}) {
    return {schema: 1, phase: "initial", stage: "identity", failure: "AUTH_REJECTED", retCode: "FAIL_SYS_SESSION_EXPIRED",
        httpClass: "HTTP_200", tokenPresentBefore: false, tokenUpdated: false, sessionAttempt: 1, tokenAttempt: 1,
        page: null, at: NOW - 60000, expiresAt: NOW - 60000 + 7 * DAY, ...changes};
}

function oldCache(state, {snapshot = state.confirmedAt !== null, terminalStatus = "", queryDiagnostic = null} = {}) {
    const cookies = core.cwCookieMap(state.cookie);
    cookies.set("_m_h5_tk", SERVER_TOKEN);
    cookies.set("_m_h5_tk_enc", "synthetic-migration-server-enc");
    return {version: FROM_VERSION, owner: state.owner, inputHash: state.inputHash, source: "auto", generation: state.generation,
        runId: digest("synthetic-migration-old-run"), cookie: core.cwCookieHeader(cookies), observedUnb: UID,
        accountCheckedAt: state.accountCheckedAt, accountSessionHash: state.accountSessionHash, terminalStatus, queryDiagnostic,
        snapshot: snapshot ? {items: core.cwItems([parcel("migration-old", "8-1-1111")]), updatedAt: new Date(NOW - 60000).toISOString()} : null};
}

function seed(f, state, cache = oldCache(state)) {
    f.memory.set(core.CW_AUTH_STORE, structuredClone(state));
    f.memory.set(core.CW_STORE, structuredClone(cache));
    return cache;
}

function readSnapshot(f) {
    return {memory: structuredClone([...f.memory]), writes: f.writes.length, requests: f.requests.length};
}

function assertReadOnly(f, before) {
    assert.equal(f.writes.length, before.writes);
    assert.equal(f.requests.length, before.requests);
    assert.deepEqual([...f.memory], before.memory);
}

function assertMigrated(state, previous) {
    assert.equal(state.version, core.CW_VERSION);
    for (const key of AUTH_FIELDS) assert.equal(state[key], previous[key], key);
}

function assertSigned(request, api, time, token) {
    const data = api === IDENTITY_API ? "{}" : api === COUNT_API ? '{"appName":"GUOGUO"}' : PDS_DATA;
    assert.equal(request.url.origin, "https://h5api.m.taobao.com");
    assert.equal(request.url.pathname, "/h5/" + api.toLowerCase() + "/1.0/");
    assert.equal(request.url.searchParams.get("api"), api);
    assert.equal(request.url.searchParams.get("t"), String(time));
    assert.equal(request.url.searchParams.get("data"), data);
    const prefix = token ? token.split("_")[0] : undefined;
    assert.equal(request.url.searchParams.get("sign"), digest(String(prefix) + "&" + time + "&12574478&" + data));
}

function oldAppState() {
    return {version: FROM_VERSION, startedAt: NOW - 5 * DAY, rows: [
        {host: "cn-acs.m.cainiao.com", channel: "gw", apiKind: "personal_list", count: 4, at: NOW - DAY,
            cookies: ["cookie2", "sgcookie", "munb", "_tb_token_"], nativeHeaders: ["x-sid", "x-uid"],
            sameRequestLoginFields: false, sameRequestLoginFieldsAt: null, sameRequestNativeSession: true, sameRequestNativeSessionAt: NOW - 2 * DAY},
        {host: "acs.m.taobao.com", channel: "h5", apiKind: "personal_count", count: 2, at: NOW - 2 * DAY,
            cookies: ["unb", "cookie2", "_m_h5_tk"], nativeHeaders: [],
            sameRequestLoginFields: true, sameRequestLoginFieldsAt: NOW - 3 * DAY, sameRequestNativeSession: false, sameRequestNativeSessionAt: null},
    ]};
}

test("1.4.0 明确认识已发布历史版本，未知版本不进入迁移", () => {
    assert.equal(core.CW_VERSION, "1.4.0");
    for (const version of ["1.1.0", "1.2.0", "1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.3.0", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", "1.3.6", "1.4.0"]) assert.equal(core.cwKnownVersion(version), true, version);
    for (const version of ["1.2.5", "1.3.7", "1.2", "1.2.1 ", null, true]) assert.equal(core.cwKnownVersion(version), false);
});

for (const version of ["1.3.0", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", "1.3.6"]) test(version + " 升级保留旧响应候选、终止诊断与 App 观察窗口，读取不重试或续期", async () => {
    const f = fixture(), previous = {...oldAuth({kind: "response_cookie_candidate", status: "expired", confirmed: true}), version};
    const cache = {...oldCache(previous, {terminalStatus: "expired", queryDiagnostic: queryRecord()}), version};
    seed(f, previous, cache);
    const appState = {...oldAppState(), version};
    f.memory.set(core.CW_APP_STORE, appState);
    const before = readSnapshot(f), migrated = auth.cwReadAuth(f.ctx, f.clock());
    assertMigrated(migrated, previous);
    assert.equal(auth.cwQueryDiagnostic(cache, migrated, f.clock()).failure, "AUTH_REJECTED");
    assert.deepEqual(app.cwAppSummary(f.ctx, f.clock()).rows, appState.rows);
    assert.notEqual((await load(f)).status, "ready");
    assertReadOnly(f, before);
});

test("1.2.1 完整 request_cookie 的 pending 与 connected 只读迁移保留所有账号会话字段", () => {
    for (const status of ["pending", "connected"]) {
        const f = fixture(), previous = oldAuth({kind: "request_cookie", status});
        seed(f, previous);
        const before = readSnapshot(f), migrated = auth.cwReadAuth(f.ctx, f.clock());
        assertMigrated(migrated, previous);
        assert.equal(auth.cwRequiresIdentity(migrated), false);
        assertReadOnly(f, before);
    }
});

test("1.2.1 实际 Cookie 候选的 pending 与 connected 迁移保留真实 Cookie 及匹配证明", () => {
    for (const status of ["pending", "connected"]) {
        const f = fixture(), previous = oldAuth({status});
        seed(f, previous);
        const before = readSnapshot(f), migrated = auth.cwReadAuth(f.ctx, f.clock());
        assertMigrated(migrated, previous);
        assert.equal(auth.cwRequiresIdentity(migrated), true);
        assert.equal(core.cwCookieMap(migrated.cookie).get("cookie2"), SESSION);
        assert.equal(core.cwCookieMap(migrated.cookie).get("_m_h5_tk"), CAPTURED_TOKEN);
        assertReadOnly(f, before);
    }
});

test("1.2.1 native 的 pending 与 connected 迁移不把缓存 token 注入捕获 Cookie", () => {
    for (const status of ["pending", "connected"]) {
        const f = fixture(), previous = oldAuth({kind: "native_session_candidate", status});
        seed(f, previous);
        const before = readSnapshot(f), migrated = auth.cwReadAuth(f.ctx, f.clock());
        assertMigrated(migrated, previous);
        assert.equal(auth.cwRequiresIdentity(migrated), true);
        assert.deepEqual([...core.cwCookieMap(migrated.cookie).keys()].sort(), ["cookie2", "unb"]);
        assert.equal(core.cwCookieMap(cached(f).cookie).get("_m_h5_tk"), SERVER_TOKEN);
        assertReadOnly(f, before);
    }
});

test("完整 Cookie 升级后网络失败仍保留旧 token、快照和原更新时间", async () => {
    const f = fixture([new Error("synthetic-migration-offline")]), previous = oldAuth({kind: "request_cookie"});
    const cache = seed(f, previous), model = await load(f);
    assert.equal(model.status, "offline");
    assert.deepEqual(model.items, cache.snapshot.items);
    assert.equal(model.updatedAt, cache.snapshot.updatedAt);
    assert.equal(f.requests.length, 1);
    assertSigned(f.requests[0], PDS_API, NOW, SERVER_TOKEN);
    assert.equal(f.requests[0].options.headers.Cookie, cache.cookie);
    assert.equal(cached(f).version, core.CW_VERSION);
    for (const key of ["owner", "generation", "inputHash", "cookie"]) assert.equal(cached(f)[key], cache[key]);
    assert.deepEqual(cached(f).snapshot, cache.snapshot);
    assertMigrated(auth.cwReadAuth(f.ctx, f.clock()), previous);
});

async function assertConfirmedRefresh(kind) {
    const f = fixture([pds(), pds("8-3-3333")]), previous = oldAuth({kind});
    const cache = seed(f, previous), first = await load(f);
    assert.equal(first.status, "ready");
    assert.equal(first.items[0].code, "8-2-2222");
    assert.equal(f.requests.length, 1, "匹配的旧证明不应因升级重复 identity 或 COUNT");
    assertSigned(f.requests[0], PDS_API, NOW, SERVER_TOKEN);
    assert.equal(f.requests[0].options.headers.Cookie, cache.cookie);
    assert.equal(saved(f).version, core.CW_VERSION);
    assert.equal(cached(f).version, core.CW_VERSION);
    for (const key of ["owner", "generation", "inputHash", "cookie", "accountCheckedAt", "accountSessionHash"]) assert.equal(saved(f)[key], previous[key]);
    f.advance(60000);
    const second = await load(f);
    assert.equal(second.status, "ready");
    assert.equal(second.items[0].code, "8-3-3333");
    assert.equal(f.requests.length, 2);
    assertSigned(f.requests[1], PDS_API, NOW + 60000, SERVER_TOKEN);
    assert.notEqual(f.requests[0].url.searchParams.get("sign"), f.requests[1].url.searchParams.get("sign"));
    assert.notEqual(first.updatedAt, second.updatedAt);
    assert.equal(saved(f).generation, previous.generation);
    assert.equal(saved(f).capturedAt, previous.capturedAt);
    assert.equal(saved(f).accountCheckedAt, previous.accountCheckedAt);
    assert.equal(f.writes.filter(write => write.key === core.CW_CAPTURE_STORE || write.key === core.CW_APP_STORE).length, 0);
}

test("已确认实际 Cookie 候选升级后直接新 PDS，关闭 App 后第二次仍独立重签", async () => {
    await assertConfirmedRefresh("request_cookie_candidate");
});

test("已确认 native 升级保留缓存 token 和身份证明，关闭 App 后直接新 PDS", async () => {
    await assertConfirmedRefresh("native_session_candidate");
});

test("两种 pending 候选迁移仍须 identity COUNT 完整 PDS，不凭旧 token 确认", async () => {
    for (const kind of ["request_cookie_candidate", "native_session_candidate"]) {
        const f = fixture([identity(), count(), pds()]), previous = oldAuth({kind, status: "pending"});
        const cache = seed(f, previous, oldCache(previous, {snapshot: false}));
        const model = await load(f);
        assert.equal(model.status, "ready");
        assert.equal(f.requests.length, 3);
        for (const [index, api] of [IDENTITY_API, COUNT_API, PDS_API].entries()) assertSigned(f.requests[index], api, NOW + index, SERVER_TOKEN);
        assert.equal(f.requests[0].options.headers.Cookie, cache.cookie);
        assert.equal(saved(f).version, core.CW_VERSION);
        assert.equal(saved(f).generation, previous.generation);
        assert.equal(saved(f).accountCheckedAt, NOW);
        assert.equal(saved(f).accountSessionHash, auth.cwSessionHash(core.cwCookieMap(cached(f).cookie)));
        assert.equal(saved(f).status, "connected");
    }
});

test("1.2.1 三类 auth 终止态升级不复活，不更改 Cookie、旧快照或确认时间", async () => {
    for (const kind of ["request_cookie", "request_cookie_candidate", "native_session_candidate"]) {
        const statuses = kind === "request_cookie" ? ["expired", "verify", "invalid"] : ["expired", "verify", "invalid", "unsupported"];
        for (const status of statuses) {
            const previous = oldAuth({kind, status, confirmed: true}), f = fixture();
            const cache = seed(f, previous, oldCache(previous, {snapshot: status !== "invalid", queryDiagnostic: queryRecord()}));
            const before = readSnapshot(f);
            assertMigrated(auth.cwReadAuth(f.ctx, f.clock()), previous);
            for (let repeat = 0; repeat < 2; repeat++) {
                const model = await load(f);
                assert.equal(model.status, status === "invalid" ? "setup" : status === "unsupported" ? "error" : status);
                assert.deepEqual(model.items, cache.snapshot?.items || []);
                assert.equal(model.updatedAt, cache.snapshot?.updatedAt || null);
            }
            assertReadOnly(f, before);
        }
    }
});

test("旧 AUTH 仍 pending 而缓存已 unsupported 时升级保持停止，不重新请求或续期", async () => {
    for (const kind of ["request_cookie_candidate", "native_session_candidate"]) {
        const previous = oldAuth({kind, status: "pending"}), f = fixture(), record = queryRecord();
        seed(f, previous, oldCache(previous, {snapshot: false, terminalStatus: "unsupported", queryDiagnostic: record}));
        const before = readSnapshot(f), model = await load(f);
        assert.equal(model.status, "setup");
        assert.equal(model.setupTitle, "App 接入未确认");
        assert.match(model.message, /写入未确认|停止重试/);
        assert.equal(auth.cwCachedAuthStatus(cached(f), auth.cwReadAuth(f.ctx, f.clock())), "unsupported");
        assert.deepEqual(diagnostic(f), record);
        assert.match(JSON.stringify(auth.diagnoseCainiaoConnection(f.ctx, f.clock)), /登录标志写入未确认/);
        assertReadOnly(f, before);
    }
});

test("已绑定 1.2.1 queryDiagnostic 白名单读取保留原七天时间且不写存储", () => {
    const f = fixture(), previous = oldAuth({status: "unsupported", confirmed: false}), record = queryRecord();
    seed(f, previous, oldCache(previous, {snapshot: false, queryDiagnostic: {...record, url: "https://synthetic.invalid/migration-private-url", sid: SID}}));
    const before = readSnapshot(f), migrated = auth.cwReadAuth(f.ctx, f.clock()), result = auth.cwQueryDiagnostic(cached(f), migrated, f.clock());
    assert.deepEqual(result, record);
    assert.deepEqual(Object.keys(result).sort(), QUERY_KEYS.slice().sort());
    assert.equal(result.at, record.at);
    assert.equal(result.expiresAt, record.expiresAt);
    const text = JSON.stringify(auth.diagnoseCainiaoConnection(f.ctx, f.clock));
    assert.match(text, /AUTH_REJECTED/);
    for (const secret of [UID, SESSION, SID, CAPTURED_TOKEN, SERVER_TOKEN, previous.owner, previous.inputHash, previous.generation,
        previous.sessionHash, cached(f).runId, "migration-private-url"]) assert(!text.includes(secret));
    assertReadOnly(f, before);
});

test("迁移诊断到原 expiresAt 即拒绝，升级及重复读取不能延长窗口或复活候选", async () => {
    const f = fixture(), previous = oldAuth({status: "unsupported", confirmed: false}), record = queryRecord();
    seed(f, previous, oldCache(previous, {snapshot: false, queryDiagnostic: record}));
    assert.deepEqual(diagnostic(f), record);
    f.advance(record.expiresAt - f.clock());
    const before = readSnapshot(f);
    assert.equal(diagnostic(f), null);
    assert(!JSON.stringify(auth.diagnoseCainiaoConnection(f.ctx, f.clock)).includes("AUTH_REJECTED"));
    const model = await load(f);
    assert.equal(model.status, "setup");
    assert.equal(saved(f).status, "unsupported");
    assert.equal(cached(f).queryDiagnostic.expiresAt, record.expiresAt);
    assertReadOnly(f, before);
});

test("迁移诊断拒绝旧 1.2.0、未知版本及归属冲突，不能跨账号或输入借记录", () => {
    const f = fixture(), previous = oldAuth({status: "unsupported", confirmed: false});
    const cache = seed(f, previous, oldCache(previous, {snapshot: false, queryDiagnostic: queryRecord()}));
    const state = auth.cwReadAuth(f.ctx, f.clock()), before = readSnapshot(f);
    assert(diagnostic(f));
    for (const changes of [
        {version: "1.1.0"}, {version: "1.2.0"}, {version: "1.2.5"}, {owner: digest("synthetic-foreign-owner")},
        {inputHash: digest("synthetic-foreign-input")}, {generation: digest("synthetic-foreign-generation")},
        {source: "manual"}, {source: "capture"}, {blocked: true}, {runId: "synthetic-invalid-run"},
    ]) assert.equal(auth.cwQueryDiagnostic({...cache, ...changes}, state, f.clock()), null, JSON.stringify(changes));
    for (const version of ["1.2.2", core.CW_VERSION]) assert.deepEqual(auth.cwQueryDiagnostic({...cache, version}, state, f.clock()), queryRecord());
    for (const changes of [{version: "1.2.5"}, {owner: digest("synthetic-foreign-owner")}]) {
        assert.equal(auth.cwAuthState({...previous, ...changes}, f.clock()), null);
        assert.equal(auth.cwQueryDiagnostic(cache, {...state, ...changes}, f.clock()), null);
    }
    assertReadOnly(f, before);
});

test("未知缓存版本或另一账号缓存不继承 token、快照或证明，首先重新验证身份", async () => {
    for (const changes of [{version: "1.2.5"}, {owner: digest("account:" + OTHER_UID)}]) {
        const f = fixture([new Error("synthetic-migration-untrusted-cache-offline")]), previous = oldAuth();
        seed(f, previous, {...oldCache(previous), ...changes});
        const model = await load(f);
        assert.equal(model.status, "offline");
        assert.equal(model.items.length, 0);
        assert.equal(model.updatedAt, null);
        assert.equal(f.requests.length, 1);
        assertSigned(f.requests[0], IDENTITY_API, NOW, CAPTURED_TOKEN);
        assert.equal(f.requests[0].options.headers.Cookie, previous.cookie);
        assert.equal(cached(f).accountCheckedAt, null);
        assert.equal(cached(f).accountSessionHash, "");
        assert.equal(cached(f).snapshot, null);
    }
});

test("另一账号阻断屏障在已知或未知版本升级后仍优先，旧账号不查询也不显示快照", async () => {
    for (const version of ["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5"]) {
        const f = fixture(), previous = oldAuth();
        seed(f, previous, {version, owner: digest("account:" + OTHER_UID), source: "capture", blocked: true, cookie: "", snapshot: null});
        const before = readSnapshot(f), model = await load(f);
        assert.equal(model.status, "setup");
        assert.equal(model.items.length, 0);
        assert.equal(model.updatedAt, null);
        assert.equal(diagnostic(f), null);
        assertReadOnly(f, before);
    }
});

test("1.2.1 App 元数据只读迁移保留行、同次布尔和原窗口起点", () => {
    const f = fixture(), original = oldAppState();
    f.memory.set(core.CW_APP_STORE, {...original, cookie: SESSION, rows: original.rows.map(row => ({...row, sid: SID, url: "synthetic-private-app-url"}))});
    const before = readSnapshot(f), result = app.cwAppSummary(f.ctx, f.clock());
    assert.equal(result.observed, true);
    assert.equal(result.lastAt, NOW - DAY);
    assert.equal(result.sameRequestLoginFields, true);
    assert.equal(result.sameRequestNativeSession, true);
    assert.deepEqual(result.rows, original.rows);
    assert.equal(f.memory.get(core.CW_APP_STORE).startedAt, original.startedAt);
    assert.equal(f.memory.get(core.CW_APP_STORE).version, FROM_VERSION);
    for (const value of [SESSION, SID, "synthetic-private-app-url"]) assert(!JSON.stringify(result).includes(value));
    assertReadOnly(f, before);
});

test("升级后新匿名观察保留 App startedAt，不续期旧同次证据或伪造累计字段登录", () => {
    const f = fixture(), original = oldAppState();
    f.memory.set(core.CW_APP_STORE, original);
    f.advance(DAY);
    auth.captureCainiaoCredentials(f.incoming("", GW_URL, [["x-uid", UID]]), f.clock);
    const state = f.memory.get(core.CW_APP_STORE), result = app.cwAppSummary(f.ctx, f.clock());
    assert.equal(state.version, core.CW_VERSION);
    assert.equal(state.startedAt, original.startedAt);
    assert.equal(state.rows[0].count, original.rows[0].count + 1);
    assert.equal(state.rows[0].sameRequestNativeSessionAt, original.rows[0].sameRequestNativeSessionAt);
    assert.equal(state.rows[0].sameRequestLoginFields, false);
    assert.equal(state.rows[0].sameRequestLoginFieldsAt, null);
    assert.equal(result.sameRequestNativeSession, true);
    assert.equal(saved(f), undefined);
    assert.equal(f.requests.length, 0);
    f.advance(DAY + 1);
    const before = readSnapshot(f);
    assert.equal(app.cwAppSummary(f.ctx, f.clock()).observed, false, "原窗口七天后旧证据必须失效");
    assertReadOnly(f, before);
});

test("App 行接受 1.2.1、1.2.2、1.2.3 与当前版本，旧 1.2.0 和未知版本不得借合法字段复用", () => {
    for (const version of ["1.1.0", "1.2.0", "1.2.5", null]) {
        const f = fixture();
        f.memory.set(core.CW_APP_STORE, {...oldAppState(), version});
        const before = readSnapshot(f), result = app.cwAppSummary(f.ctx, f.clock());
        assert.equal(result.observed, false);
        assert.equal(result.lastAt, null);
        assert.equal(result.sameRequestLoginFields, false);
        assert.equal(result.sameRequestNativeSession, false);
        assert.deepEqual(result.rows, []);
        assertReadOnly(f, before);
    }
    for (const version of ["1.2.2", "1.2.3", core.CW_VERSION]) {
        const f = fixture(), original = {...oldAppState(), version};
        f.memory.set(core.CW_APP_STORE, original);
        assert.deepEqual(app.cwAppSummary(f.ctx, f.clock()).rows, original.rows);
    }
});

test("原 App 窗口过期后只读不改时间，新观察创建空证据新窗口不搬旧行", () => {
    const f = fixture(), original = oldAppState();
    f.memory.set(core.CW_APP_STORE, original);
    f.advance(2 * DAY + 1);
    const before = readSnapshot(f);
    assert.equal(app.cwAppSummary(f.ctx, f.clock()).observed, false);
    assertReadOnly(f, before);
    auth.captureCainiaoCredentials(f.incoming("", GW_URL), f.clock);
    const state = f.memory.get(core.CW_APP_STORE);
    assert.equal(state.version, core.CW_VERSION);
    assert.equal(state.startedAt, f.clock());
    assert.equal(state.rows.length, 1);
    assert.equal(state.rows[0].count, 1);
    assert.deepEqual(state.rows[0].cookies, []);
    assert.deepEqual(state.rows[0].nativeHeaders, []);
    assert.equal(state.rows[0].sameRequestLoginFields, false);
    assert.equal(state.rows[0].sameRequestNativeSession, false);
    assert.equal(saved(f), undefined);
    assert.equal(f.requests.length, 0);
});

test("升级不恢复旧失败，新的真实 App 采集创建新代次后才可完成无 token 引导验证", async () => {
    for (const kind of ["request_cookie", "request_cookie_candidate", "native_session_candidate"]) {
        const previous = oldAuth({kind, status: kind === "request_cookie" ? "expired" : "unsupported", confirmed: kind === "request_cookie"});
        const f = fixture(), terminalStatus = previous.status;
        seed(f, previous, oldCache(previous, {queryDiagnostic: queryRecord(), terminalStatus}));
        const before = readSnapshot(f), oldModel = await load(f);
        assert.notEqual(oldModel.status, "ready");
        assertReadOnly(f, before);
        f.advance(1000);
        const newSession = "synthetic-migration-new-real-session", issued = "synthetic-migration-new-issued-token_3";
        auth.captureCainiaoCredentials(f.incoming("cookie2=" + newSession, GW_URL, [["x-uid", UID], ["x-sid", SID]]), f.clock);
        const next = saved(f);
        assert.equal(next.version, core.CW_VERSION);
        assert.equal(next.captureKind, "request_cookie_candidate");
        assert.equal(next.status, "pending");
        assert.equal(next.confirmedAt, null);
        assert.equal(next.accountCheckedAt, null);
        assert.equal(next.accountSessionHash, "");
        assert.notEqual(next.generation, previous.generation);
        assert.equal(core.cwCookieMap(next.cookie).get("cookie2"), newSession);
        assert.equal(core.cwCookieMap(next.cookie).has("_m_h5_tk"), false);
        assert.equal(cached(f).cookie, "");
        assert.equal(cached(f).snapshot, null);
        assert.equal(diagnostic(f), null);
        assert.equal(f.requests.length, 0);
        f.replies.push(response({ret: ["FAIL_SYS_TOKEN_EMPTY::合成新候选引导"]}, ["_m_h5_tk=" + issued + "; Path=/"]), identity(), count(), pds());
        const model = await load(f);
        assert.equal(model.status, "ready");
        assert.equal(model.items[0].code, "8-2-2222");
        assert.equal(f.requests.length, 4);
        for (const [index, api] of [IDENTITY_API, IDENTITY_API, COUNT_API, PDS_API].entries()) {
            assertSigned(f.requests[index], api, NOW + 1000 + index, index === 0 ? undefined : issued);
        }
        assert.equal(saved(f).status, "connected");
        assert.equal(saved(f).generation, next.generation);
        assert.equal(saved(f).accountCheckedAt, f.clock());
        assert.equal(diagnostic(f).failure, "NONE");
    }
});
