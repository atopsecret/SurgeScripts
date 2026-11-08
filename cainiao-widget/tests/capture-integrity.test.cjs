// 引擎：Node.js 20+ 内置测试 | 版本：1.2.4 回归合同 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --experimental-vm-modules --test cainiao-widget/tests/capture-integrity.test.cjs
// 依赖：内置库与 auth-fixture.cjs；仅合成 Cookie、内存 HTTP 和内存存储
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {NOW, headers, parcel, response, fixture} = require("./auth-fixture.cjs");

const FROM_VERSION = "1.2.3";
const UID = "900000000000000001", OTHER_UID = "900000000000000002";
const SESSION = "synthetic-integrity-real-session", SG = "synthetic-integrity-real-sg";
const TOKEN = "synthetic-integrity-token_1", SERVER_TOKEN = "synthetic-integrity-server-token_2";
const API = "mtop.cainiao.lpc.packageservice.queryPdsPackageDataList";
const IDENTITY_API = "mtop.user.getUserSimple", COUNT_API = "mtop.cainiao.lpc.packageservice.user.package.count.query";
const PUBLIC_API = "mtop.common.getTimestamp";
const HOSTS = ["h5api.m.taobao.com", "acs.m.taobao.com", "cn-acs.m.cainiao.com", "e2e-mtop.cainiao.com"];
const DAY = 86400000;
const AUTH_FIELDS = ["owner", "sessionHash", "generation", "inputHash", "cookie", "status", "capturedAt", "confirmedAt",
    "sourceHost", "captureKind", "sourceChannel", "accountCheckedAt", "accountSessionHash"];
let core, auth, app, runtime, acquisition, transport, networkAttempts = 0;

before(async () => {
    const deny = () => {networkAttempts++; throw new Error("采集完整性回归禁止真实网络");};
    for (const name of ["node:http", "node:https"]) for (const method of ["get", "request"]) mock.method(require(name), method, deny);
    for (const method of ["connect", "createConnection"]) mock.method(require("node:net"), method, deny);
    mock.method(require("node:net").Socket.prototype, "connect", deny);
    mock.method(require("node:tls"), "connect", deny);
    if (typeof globalThis.fetch === "function") mock.method(globalThis, "fetch", deny);
    core = await import("../core.mjs"); auth = await import("../auth.mjs"); app = await import("../app.mjs");
    runtime = await import("../runtime.mjs"); acquisition = await import("../response.mjs"); transport = await import("../transport.mjs");
});

after(() => {
    mock.restoreAll();
    assert.equal(networkAttempts, 0, "所有请求必须走合成内存 HTTP");
    console.log("capture-integrity-network-guard=" + networkAttempts);
});

const digest = value => createHash("md5").update(value).digest("hex");
const saved = f => f.memory.get(core.CW_AUTH_STORE), cached = f => f.memory.get(core.CW_STORE);
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);
const diagnostic = f => auth.cwQueryDiagnostic(cached(f), auth.cwReadAuth(f.ctx, f.clock()), f.clock());
const connectionText = f => auth.diagnoseCainiaoConnection(f.ctx, f.clock).children[0].text;
const identity = (uid = UID) => response({api: IDENTITY_API, ret: ["SUCCESS::成功"], userNumId: uid, data: {}});
const count = () => response({api: COUNT_API, ret: ["SUCCESS::成功"], data: {count: 1}});
const pds = (packages = [parcel("integrity", "8-2-2222")]) => response({api: API, ret: ["SUCCESS::成功"], data: {packages, totalPage: 1, currentPage: 1}});
const sessionRejected = () => response({api: API, ret: ["FAIL_SYS_SESSION_EXPIRED::synthetic-reject"], data: {}});

function url({host = "acs.m.taobao.com", channel = "gw", api = API} = {}) {
    return "https://" + host + "/" + channel + "/" + api.toLowerCase() + "/" + (channel === "gw" ? "*" : "1.0") + "/";
}

function values({uid = UID, unb = true, token = false} = {}) {
    return {...(unb ? {unb: uid} : {}), cookie2: SESSION, sgcookie: SG, munb: "synthetic-integrity-munb",
        _tb_token_: "synthetic-integrity-tb", ...(token ? {_m_h5_tk: TOKEN, _m_h5_tk_enc: "synthetic-integrity-enc"} : {})};
}

function capture(f, {uid = UID, unb = true, token = false, headerUid = uid, ...route} = {}) {
    const cookie = Object.entries(values({uid, unb, token})).map(([name, value]) => name + "=" + value).join("; ");
    const ctx = f.incoming(cookie, url(route), headerUid === null ? [] : [["x-uid", headerUid]]);
    const originalHeaders = ctx.request.headers, originalURL = ctx.request.url;
    Object.defineProperty(ctx.request, "body", {get() {throw new Error("采集不得读取请求正文");}});
    assert.equal(auth.captureCainiaoCredentials(ctx, f.clock), undefined);
    assert.equal(ctx.request.headers, originalHeaders); assert.equal(ctx.request.url, originalURL);
}

async function captureResponse(f, uid = UID) {
    const ctx = f.incoming("", url(), [["x-uid", uid]]);
    ctx.response = {status: 200,
        headers: headers(Object.entries(values({uid})).map(([name, value]) => ["Set-Cookie", name + "=" + value + "; Domain=.taobao.com; Path=/; Secure"])),
        text: async () => {throw new Error("响应头入口不得读取正文");},
        arrayBuffer: async () => {throw new Error("响应头入口不得读取二进制");}};
    const original = ctx.response, originalHeaders = original.headers;
    assert.equal(await acquisition.captureCainiaoResponse(ctx, f.clock), undefined);
    assert.equal(ctx.response, original); assert.equal(ctx.response.headers, originalHeaders);
}

function signed(request, api) {
    assert.equal(request.url.origin, "https://h5api.m.taobao.com");
    assert.equal(request.url.pathname, "/h5/" + api.toLowerCase() + "/1.0/");
    assert.equal(request.url.searchParams.get("api"), api);
    assert.equal(request.options.credentials, "omit"); assert.equal(request.options.redirect, "manual");
    assert.equal(request.options.insecureTls, false);
    const raw = core.cwCookieMap(request.options.headers.Cookie).get("_m_h5_tk");
    const token = raw ? raw.split("_")[0] : undefined;
    assert.equal(request.url.searchParams.get("sign"), digest(String(token) + "&" + request.url.searchParams.get("t")
        + "&12574478&" + request.url.searchParams.get("data")));
}

async function establish(f, kind, status = "pending") {
    if (kind === "response_cookie_candidate") await captureResponse(f);
    else capture(f, {unb: kind !== "request_cookie_candidate"});
    assert.equal(saved(f).captureKind, kind); assert.equal(saved(f).status, "pending");
    if (["connected", "expired"].includes(status)) {
        const offset = f.requests.length;
        if (kind !== "request_cookie") f.replies.push(identity(), count());
        f.replies.push(pds());
        assert.equal((await load(f)).status, "ready");
        const expected = kind === "request_cookie" ? [API] : [IDENTITY_API, COUNT_API, API];
        assert.deepEqual(f.requests.slice(offset).map(request => request.url.searchParams.get("api")), expected);
        f.requests.slice(offset).forEach((request, index) => signed(request, expected[index]));
        if (kind !== "request_cookie") assert.equal(saved(f).accountCheckedAt, f.clock());
        if (status === "expired") {f.advance(1000); f.replies.push(sessionRejected()); await load(f);}
    } else if (status !== "pending") {
        const reply = status === "unsupported" ? sessionRejected() : status === "verify"
            ? response({ret: ["FAIL_SYS_USER_VALIDATE::synthetic-verify"]}) : identity(OTHER_UID);
        f.replies.push(reply); await load(f);
    }
    assert.equal(saved(f).status, status);
}

function snapshot(f) {return {memory: structuredClone([...f.memory]), writes: f.writes.length, requests: f.requests.length};}
function assertReadOnly(f, before) {
    assert.deepEqual([...f.memory], before.memory); assert.equal(f.writes.length, before.writes); assert.equal(f.requests.length, before.requests);
}
function assertNoAuthCacheWrites(f, start) {
    assert.equal(f.writes.slice(start).some(row => [core.CW_AUTH_STORE, core.CW_STORE].includes(row.key)), false,
        "公共流量不能短暂写入或撤销 auth/cache");
}

test("完整 public_time 的 H5/GW 四主机只观察，没有 native UID 也不能建候选", () => {
    for (const host of HOSTS) for (const channel of ["h5", "gw"]) for (const headerUid of [null, UID]) {
        const f = fixture(); capture(f, {host, channel, api: PUBLIC_API, headerUid});
        assert.equal(saved(f), undefined, host + " / " + channel);
        assert.equal(cached(f), undefined); assertNoAuthCacheWrites(f, 0); assert.equal(f.requests.length, 0);
        const observed = app.cwAppSummary(f.ctx, f.clock());
        assert.equal(observed.observed, true); assert.equal(observed.rows[0].apiKind, "public_time");
        assert.deepEqual(observed.rows[0].cookies, ["unb", "cookie2", "sgcookie", "munb", "_tb_token_"]);
    }
});

test("公共完整 Cookie 不替换两受限来源的 pending、已确认及全部终止状态", async () => {
    for (const kind of ["request_cookie_candidate", "response_cookie_candidate"])
        for (const status of ["pending", "connected", "unsupported", "expired", "verify", "invalid"]) {
            const f = fixture(); await establish(f, kind, status);
            const previous = structuredClone(saved(f)), cache = structuredClone(cached(f)), offset = f.writes.length;
            const requests = f.requests.length;
            f.advance(1000); capture(f, {api: PUBLIC_API});
            assert.deepEqual(saved(f), previous, kind + " / " + status);
            assert.deepEqual(cached(f), cache); assertNoAuthCacheWrites(f, offset);
            assert.equal(auth.cwRequiresIdentity(saved(f)), true); assert.equal(f.requests.length, requests);
        }
});

test("B AUTH noop/throw 留下的屏障不被 A 公共完整 Cookie 撤销或恢复旧查询", async () => {
    for (const kind of ["request_cookie", "request_cookie_candidate", "response_cookie_candidate"])
        for (const status of ["pending", "connected"]) for (const writeFailure of ["noop", "throw"])
            for (const barrierVersion of [FROM_VERSION, "synthetic-unknown-version"]) {
                const f = fixture(); await establish(f, kind, status);
                const previous = structuredClone(saved(f)), requestCount = f.requests.length, write = f.ctx.storage.setJSON;
                f.ctx.storage.setJSON = (key, value) => {
                    if (key === core.CW_AUTH_STORE) {if (writeFailure === "throw") throw new Error("synthetic-new-account-write-failure"); return;}
                    write(key, value);
                };
                try {f.advance(1000); await captureResponse(f, OTHER_UID);}
                finally {f.ctx.storage.setJSON = write;}
                assert.deepEqual(saved(f), previous); assert.equal(cached(f).blocked, true);
                assert.notEqual(cached(f).owner, previous.owner); assert.equal(cached(f).snapshot, null);
                f.memory.set(core.CW_STORE, {...cached(f), version: barrierVersion});
                const barrier = structuredClone(cached(f)), offset = f.writes.length;
                f.advance(1000); capture(f, {api: PUBLIC_API});
                assert.deepEqual(saved(f), previous); assert.deepEqual(cached(f), barrier);
                assertNoAuthCacheWrites(f, offset);
                const model = await load(f);
                assert.equal(model.status, "setup"); assert.deepEqual(model.items, []); assert.equal(model.updatedAt, null);
                assert.equal(f.requests.length, requestCount); assert.deepEqual(cached(f), barrier);
            }
});

test("公共明确 UID 冲突仍隔离，后续非公共一致的新账号可以恢复", async () => {
    for (const channel of ["h5", "gw"]) {
        const f = fixture(); await establish(f, "request_cookie", "connected");
        const previous = structuredClone(saved(f)), requests = f.requests.length;
        f.advance(1000); capture(f, {channel, api: PUBLIC_API, headerUid: OTHER_UID});
        assert.deepEqual(saved(f), previous); assert.equal(cached(f).blocked, true);
        assert.notEqual(cached(f).owner, previous.owner); assert.equal(cached(f).snapshot, null);
        assert.equal(f.memory.get(core.CW_CAPTURE_STORE).code, "conflict");
        const blocked = await load(f);
        assert.equal(blocked.status, "setup"); assert.deepEqual(blocked.items, []); assert.equal(f.requests.length, requests);
        f.advance(1000); capture(f, {uid: OTHER_UID, channel});
        assert.equal(saved(f).status, "pending"); assert.notEqual(saved(f).owner, previous.owner);
        assert.equal(core.cwCookieMap(saved(f).cookie).get("unb"), OTHER_UID);
        f.replies.push(pds()); assert.equal((await load(f)).status, "ready");
        assert.equal(f.requests.length, requests + 1); signed(f.requests.at(-1), API);
    }
});

test("非公共 H5/GW 正常新账号 AUTH 保存失败后，同值有效再采集仍可恢复", async () => {
    for (const channel of ["h5", "gw"]) for (const failure of ["noop", "throw"]) {
        const f = fixture(); await establish(f, "request_cookie", "connected");
        const previous = structuredClone(saved(f)), requests = f.requests.length, write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {
            if (key === core.CW_AUTH_STORE) {if (failure === "throw") throw new Error("synthetic-auth-write-failure"); return;}
            write(key, value);
        };
        try {f.advance(1000); capture(f, {uid: OTHER_UID, channel});}
        finally {f.ctx.storage.setJSON = write;}
        assert.deepEqual(saved(f), previous); assert.equal(cached(f).blocked, true); assert.notEqual(cached(f).owner, previous.owner);
        assert.equal((await load(f)).status, "setup"); assert.equal(f.requests.length, requests);
        f.advance(1000); capture(f, {uid: OTHER_UID, channel});
        assert.equal(saved(f).status, "pending"); assert.notEqual(saved(f).owner, previous.owner);
        assert.notEqual(saved(f).generation, previous.generation); assert.equal(saved(f).sourceChannel, channel);
        assert.equal(cached(f).owner, saved(f).owner); assert.equal(cached(f).snapshot, null);
        f.replies.push(pds()); assert.equal((await load(f)).status, "ready");
        assert.equal(saved(f).status, "connected"); assert.equal(f.requests.length, requests + 1);
    }
});

test("首次非公共完整 Cookie 的 SESSION 拒绝显示未确认，但 raw expired 和固定诊断不变", async () => {
    for (const channel of ["h5", "gw"]) {
        const f = fixture([sessionRejected()]); capture(f, {channel, headerUid: null});
        const model = await load(f);
        assert.equal(model.status, "setup"); assert.equal(model.setupTitle, "App 接入未确认");
        assert.deepEqual(model.items, []); assert.equal(model.updatedAt, null);
        assert.equal(saved(f).captureKind, "request_cookie"); assert.equal(saved(f).status, "expired");
        assert.equal(cached(f).terminalStatus, "expired"); assert.equal(saved(f).confirmedAt, null);
        assert.equal(auth.cwAuthState({...saved(f), status: "unsupported"}, f.clock()), null);
        const record = diagnostic(f);
        assert.equal(record.phase, "initial"); assert.equal(record.stage, "pds"); assert.equal(record.failure, "AUTH_REJECTED");
        assert.equal(record.retCode, "FAIL_SYS_SESSION_EXPIRED"); assert.equal(record.httpClass, "HTTP_200");
        assert.equal(record.tokenPresentBefore, false); assert.equal(record.tokenUpdated, false); assert.equal(record.page, 1);
        assert.equal(record.tokenAttempt, 1); assert.equal(record.sessionAttempt, 1); assert.equal(f.requests.length, 1);
        const before = snapshot(f), again = await load(f), text = connectionText(f);
        assert.equal(again.status, "setup"); assert.equal(again.setupTitle, "App 接入未确认");
        assert(text.includes("App 接入未确认")); assert(text.includes("initial · pds · AUTH_REJECTED"));
        assert(!text.includes("小组件会话失效")); assert(!/App.*(?:已退出|退出登录|登录已过期)/.test(model.message));
        assert.deepEqual(diagnostic(f), record); assertReadOnly(f, before);
    }
});

test("首次完整 Cookie 的 token、HTTP401 或会话删除拒绝也保持 expired 停止而不伪造 unsupported", async () => {
    const cases = [
        {reply: response({ret: ["FAIL_SYS_TOKEN_EMPTY::synthetic-token"]}), token: false, failure: "TOKEN_NOT_ISSUED"},
        {reply: response({ret: ["FAIL_SYS_TOKEN_EXPIRED::synthetic-token"]}), token: true, failure: "TOKEN_RETRY_EXHAUSTED"},
        {reply: response({}, [], 401), token: false, failure: "AUTH_REJECTED"},
        {reply: response({api: API, ret: ["SUCCESS::成功"], data: {packages: [], totalPage: 1, currentPage: 1}},
            ["cookie2=; Max-Age=0; Path=/", "sgcookie=; Max-Age=0; Path=/"]), token: false, failure: "SESSION_MISSING"},
    ];
    for (const item of cases) {
        const f = fixture([item.reply]); capture(f, {channel: "h5", token: item.token});
        const model = await load(f);
        assert.equal(model.status, "setup"); assert.equal(model.setupTitle, "App 接入未确认");
        assert.equal(saved(f).status, "expired"); assert.equal(cached(f).terminalStatus, "expired");
        assert.equal(saved(f).confirmedAt, null); assert.equal(diagnostic(f).failure, item.failure);
        assert.equal(f.requests.length, 1); const before = snapshot(f);
        assert.equal((await load(f)).status, "setup"); assertReadOnly(f, before);
    }
});

test("已确认完整 Cookie 失效仍保留非空或空快照的原更新时间及确认时间", async () => {
    for (const packages of [[], [parcel("confirmed-old", "8-1-1111")]]) {
        const f = fixture([pds(packages)]); capture(f, {channel: "h5"});
        assert.equal((await load(f)).status, "ready");
        const previous = structuredClone(saved(f)), cache = structuredClone(cached(f));
        f.advance(60000); f.replies.push(sessionRejected());
        const model = await load(f);
        assert.equal(model.status, "expired"); assert.deepEqual(model.items, cache.snapshot.items);
        assert.equal(model.updatedAt, cache.snapshot.updatedAt); assert(model.message.includes("上次结果"));
        assert.equal(saved(f).status, "expired"); assert.equal(saved(f).confirmedAt, previous.confirmedAt);
        assert.equal(cached(f).terminalStatus, "expired"); assert.deepEqual(cached(f).snapshot, cache.snapshot);
        assert.equal(diagnostic(f).phase, "refresh");
        const before = snapshot(f), again = await load(f), text = connectionText(f);
        assert.equal(again.status, "expired"); assert.equal(again.updatedAt, cache.snapshot.updatedAt);
        assert(text.includes("小组件会话失效")); assert(!text.includes("App 接入未确认")); assertReadOnly(f, before);
    }
});

function oldAuth({kind = "request_cookie", status = "connected", confirmed = status === "connected" || status === "expired"} = {}) {
    const cookies = core.cwCookieMap(Object.entries(values()).map(([name, value]) => name + "=" + value).join("; "));
    const cookie = core.cwCookieHeader(cookies), restricted = kind !== "request_cookie";
    return {version: FROM_VERSION, owner: core.cwOwner(cookies), sessionHash: auth.cwSessionHash(cookies),
        generation: digest("synthetic-integrity-old:" + kind + ":" + status), inputHash: digest(cookie), cookie,
        status, capturedAt: NOW - 120000, confirmedAt: confirmed ? NOW - 60000 : null,
        sourceHost: "acs.m.taobao.com", captureKind: kind, sourceChannel: restricted ? "gw" : "h5",
        accountCheckedAt: restricted && confirmed ? NOW - 60000 : null,
        accountSessionHash: restricted && confirmed ? auth.cwSessionHash(cookies) : ""};
}

function queryRecord(state) {
    const confirmed = state.confirmedAt !== null, terminal = !["pending", "connected"].includes(state.status);
    return {schema: 1, phase: confirmed ? "refresh" : "initial", stage: state.captureKind === "response_cookie_candidate" && !confirmed ? "identity" : "pds",
        failure: terminal ? "AUTH_REJECTED" : "NONE", retCode: terminal ? "FAIL_SYS_SESSION_EXPIRED" : "SUCCESS", httpClass: "HTTP_200",
        tokenPresentBefore: true, tokenUpdated: false, sessionAttempt: 1, tokenAttempt: 1,
        page: state.captureKind === "response_cookie_candidate" && !confirmed ? null : 1, at: NOW - 60000, expiresAt: NOW - 60000 + 7 * DAY};
}

function oldCache(state) {
    const cookies = core.cwCookieMap(state.cookie); cookies.set("_m_h5_tk", SERVER_TOKEN);
    return {version: FROM_VERSION, owner: state.owner, inputHash: state.inputHash, generation: state.generation, source: "auto",
        runId: digest("synthetic-integrity-old-run"), cookie: core.cwCookieHeader(cookies), observedUnb: UID,
        accountCheckedAt: state.accountCheckedAt, accountSessionHash: state.accountSessionHash,
        terminalStatus: ["pending", "connected"].includes(state.status) ? "" : state.status, queryDiagnostic: queryRecord(state),
        snapshot: state.confirmedAt === null ? null : {items: core.cwItems([parcel("migration-old", "8-1-1111")]), updatedAt: new Date(NOW - 60000).toISOString()}};
}

async function assertMigration(kind) {
    const statuses = kind === "request_cookie" ? ["pending", "connected", "expired", "verify", "invalid"]
        : ["pending", "connected", "expired", "verify", "invalid", "unsupported"];
    for (const status of statuses) {
        const f = fixture(), previous = oldAuth({kind, status}), cache = oldCache(previous);
        f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, cache);
        const before = snapshot(f), migrated = auth.cwReadAuth(f.ctx, f.clock());
        assert.equal(migrated.version, core.CW_VERSION);
        for (const key of AUTH_FIELDS) assert.equal(migrated[key], previous[key], kind + " / " + status + " / " + key);
        assert.deepEqual(diagnostic(f), cache.queryDiagnostic);
        assert.equal(core.cwCookieMap(cached(f).cookie).get("_m_h5_tk"), SERVER_TOKEN);
        connectionText(f); assertReadOnly(f, before);
        if (!["pending", "connected"].includes(status)) {
            const model = await load(f); assert.notEqual(model.status, "ready");
            assert.equal(f.requests.length, 0); assertReadOnly(f, before);
        }
        for (const change of [{owner: digest("synthetic-other-owner")}, {generation: digest("synthetic-other-generation")},
            {inputHash: digest("synthetic-other-input")}, {source: "manual"}, {version: "synthetic-unknown-version"}])
            assert.equal(auth.cwQueryDiagnostic({...cache, ...change}, migrated, f.clock()), null);
        assert.equal(auth.cwQueryDiagnostic({...cache, queryDiagnostic: {...cache.queryDiagnostic, expiresAt: f.clock()}}, migrated, f.clock()), null);
        assertReadOnly(f, before);
    }
}

test("1.2.3 request_cookie auth/cache/诊断只读迁移，不丢账号、token、快照或终止状态", async () => {
    await assertMigration("request_cookie");
});

test("1.2.3 response 候选的归属、身份证明和停止状态只读迁移，不以升级重试", async () => {
    await assertMigration("response_cookie_candidate");
});

test("1.2.3 echo COMPLETE 和新旧 RUNNING 租约保留七天窗口，不重发或续期", async () => {
    for (const item of [{kind: "COMPLETE", age: 5 * DAY, result: "COMPLETE"},
        {kind: "RUNNING", age: 1000, result: "RUNNING"}, {kind: "RUNNING", age: 5 * DAY, result: "INCOMPLETE_UNKNOWN"}]) {
        const f = fixture(), startedAt = NOW - item.age;
        f.ctx.env.CW_TRANSPORT_CHECK = "true";
        const sample = item.kind === "COMPLETE" ? {kind: "ECHO", markerReceived: true, extraCookies: false, at: startedAt}
            : {kind: "NOT_RUN", markerReceived: null, extraCookies: null, at: null};
        const record = {schema: 1, version: FROM_VERSION, runId: digest("synthetic-old-transport-run"), kind: item.kind,
            startedAt, leaseUntil: startedAt + 30000, at: startedAt, expiresAt: startedAt + 7 * DAY,
            omit: {...sample}, include: {...sample}};
        f.memory.set(core.CW_TRANSPORT_STORE, record);
        f.memory.set(core.CW_AUTH_STORE, oldAuth());
        const before = snapshot(f), normalized = transport.cwTransportState(record, f.clock());
        assert(normalized); assert.equal(normalized.version, core.CW_VERSION);
        for (const key of ["runId", "kind", "startedAt", "leaseUntil", "at", "expiresAt", "omit", "include"])
            assert.deepEqual(normalized[key], record[key]);
        const result = await transport.runCainiaoTransportCheck(f.ctx, f.clock);
        assert.equal(result.kind, item.result); assert.equal(result.startedAt, record.startedAt);
        assert.equal(result.at, record.at); assert.equal(result.expiresAt, record.expiresAt);
        assert.deepEqual(result.omit, record.omit); assert.deepEqual(result.include, record.include);
        transport.cwTransportLines(f.ctx, f.clock()); assertReadOnly(f, before);
        assert.equal(transport.cwTransportState({...record, version: "synthetic-unknown-version"}, f.clock()), null);
    }
});

test("1.2.3 请求和响应观察保留原始窗口、计数和时间，到期只读不续窗", () => {
    const f = fixture(), startedAt = NOW - 5 * DAY, at = NOW - DAY;
    const requests = {version: FROM_VERSION, startedAt, rows: [{host: "acs.m.taobao.com", channel: "gw", apiKind: "public_time",
        count: 5, at, cookies: ["unb", "cookie2", "sgcookie", "munb", "_tb_token_"], nativeHeaders: ["x-uid"],
        sameRequestLoginFields: true, sameRequestLoginFieldsAt: NOW - 2 * DAY, sameRequestNativeSession: false, sameRequestNativeSessionAt: null}]};
    const responses = {version: FROM_VERSION, startedAt, rows: [{host: "acs.m.taobao.com", channel: "gw", apiKind: "public_time",
        mode: "headers", count: 5, at, result: "public_time", httpClass: "HTTP_200", cookies: [], usable: 0,
        headerCount: 0, scopeCount: 0, deletedCount: 0, schema: null}]};
    f.memory.set(core.CW_APP_STORE, requests); f.memory.set(core.CW_RESPONSE_STORE, responses);
    const before = snapshot(f), summary = app.cwAppSummary(f.ctx, f.clock()), lines = acquisition.cwResponseLines(f.ctx, f.clock()).join("\n");
    assert.equal(summary.observed, true); assert.equal(summary.lastAt, at); assert.deepEqual(summary.rows, requests.rows);
    assert(lines.includes("公共时间 · headers · 5 次")); assert(lines.includes(new Date(at).toISOString()));
    assert(!lines.includes("尚无有效记录")); assertReadOnly(f, before);
    f.advance(3 * DAY);
    assert.equal(app.cwAppSummary(f.ctx, f.clock()).observed, false);
    assert(acquisition.cwResponseLines(f.ctx, f.clock()).join("\n").includes("尚无有效记录")); assertReadOnly(f, before);
});
