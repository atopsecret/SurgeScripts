// 引擎：Node.js 20+ 内置测试 | 版本：1.2.4 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --experimental-vm-modules --test cainiao-widget/tests/app-entry.test.cjs
// 依赖：本地源码与 auth-fixture.cjs；仅合成会话、模拟网络和模拟存储
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {NOW, headers, parcel, response, success, fixture} = require("./auth-fixture.cjs");

const HOSTS = ["h5api.m.taobao.com", "acs.m.taobao.com", "cn-acs.m.cainiao.com", "e2e-mtop.cainiao.com"];
const UID = "900000000000000001";
const OTHER_UID = "900000000000000002";
const SID = "synthetic-native-session-a";
const OTHER_SID = "synthetic-native-session-b";
const API = "mtop.cainiao.lpc.packageservice.queryPdsPackageDataList";
const COUNT_API = "mtop.cainiao.lpc.packageservice.user.package.count.query";
const H5_URL = "https://acs.m.taobao.com/h5/" + API.toLowerCase() + "/1.0/";
const GW_URL = "https://cn-acs.m.cainiao.com/gw/" + API.toLowerCase() + "/1.0/";
const H5_COOKIE = "unb=" + UID + "; cookie2=synthetic-h5-session-a; _m_h5_tk=synthetic-h5-token_1";
const NATIVE_NAMES = ["x-sid", "x-uid", "x-t", "x-sign", "x-mini-wua", "x-umt", "x-sgext"];
let app, auth, core, runtime;

before(async () => {
    app = await import("../app.mjs");
    auth = await import("../auth.mjs");
    core = await import("../core.mjs");
    runtime = await import("../runtime.mjs");
});

function nativeInput(f, {uid = UID, sid = SID, cookie = "", url = GW_URL, extra = []} = {}) {
    const values = [];
    if (uid !== null) values.push(["x-uid", uid]);
    if (sid !== null) values.push(["x-sid", sid]);
    return f.incoming(cookie, url, values.concat(extra));
}
function captureNative(f, options) {
    return auth.captureCainiaoCredentials(nativeInput(f, options), f.clock);
}
const saved = f => f.memory.get(core.CW_AUTH_STORE);
const metadata = f => f.memory.get(core.CW_APP_STORE);
const summary = f => app.cwAppSummary(f.ctx, f.clock());
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);

function legacyState(status = "connected") {
    const cookies = core.cwCookieMap(H5_COOKIE), cookie = core.cwCookieHeader(cookies);
    return {version: "1.1.0", owner: core.cwOwner(cookies), sessionHash: auth.cwSessionHash(cookies),
        generation: core.md5("synthetic-legacy-generation"), inputHash: core.md5(cookie), cookie,
        status, capturedAt: NOW - 1000, confirmedAt: status === "connected" ? NOW - 500 : null,
        sourceHost: "acs.m.taobao.com"};
}
function cachedState(state, code = "8-1-1111") {
    return {version: state.version, owner: state.owner, inputHash: state.inputHash, source: "auto",
        generation: state.generation, runId: core.md5("synthetic-old-run"), cookie: state.cookie,
        observedUnb: core.cwCookieMap(state.cookie).get("unb"),
        snapshot: {items: core.cwItems([parcel("old", code)]), updatedAt: new Date(NOW - 500).toISOString()}};
}
function identityResponse(uid = UID, changes = {}) {
    return response({api: "mtop.user.getUserSimple", ret: ["SUCCESS::成功"], userNumId: uid,
        data: {nick: "synthetic-identity-nick-must-not-persist"}, ...changes});
}
function countResponse(changes = {}) {
    return response({api: COUNT_API, ret: ["SUCCESS::成功"], data: {count: 1}, ...changes});
}
function nativePds(packages = [parcel()], totalPage = 1, currentPage = 1) {
    return response({api: API, ret: ["SUCCESS::成功"], data: {packages, totalPage, currentPage}});
}

test("1.3.0 保留 App 采集的四网关及本机元数据键", () => {
    assert.equal(core.CW_VERSION, "1.3.0");
    assert.equal(core.CW_APP_STORE, "cainiao-widget.app.v1");
    assert.deepEqual([...app.CW_APP_HOSTS].sort(), HOSTS.slice().sort());
});

test("四网关 H5 数字版本与 GW 数字、缺省、星号版本均严格识别", () => {
    for (const host of HOSTS) {
        for (const suffix of ["/h5/mtop.example.test/1.0/", "/h5/mtop.example.test/2.1.3?x=1", "/gw/mtop.example.test/1.0/", "/gw/mtop.example.test/2.1.3/?x=1", "/gw/mtop.example.test", "/gw/mtop.example.test/", "/gw/mtop.example.test/*", "/gw/mtop.example.test/*/?x=1"]) {
            for (const port of ["", ":443"]) {
                const url = "https://" + host + port + suffix;
                const route = app.cwAppRoute(url);
                assert.deepEqual(route, {host, channel: suffix.startsWith("/h5/") ? "h5" : "gw", apiKind: "other"}, url);
                assert.equal(auth.cwCaptureURL(url), host);
            }
        }
    }
});

test("路由不接受伪域、用户信息、片段、异常端口、尾路径或编码分隔符", () => {
    for (const url of [
        "http://acs.m.taobao.com/gw/mtop.example/1.0/",
        "https://acs.m.taobao.com.evil.invalid/gw/mtop.example/1.0/",
        "https://evil.invalid/acs.m.taobao.com/gw/mtop.example/1.0/",
        "https://user@acs.m.taobao.com/gw/mtop.example/1.0/",
        "https://@acs.m.taobao.com/gw/mtop.example/1.0/",
        "https://:secret@acs.m.taobao.com/gw/mtop.example/1.0/",
        "https://acs.m.taobao.com:80/gw/mtop.example/1.0/",
        "https://acs.m.taobao.com:444/gw/mtop.example/1.0/",
        "https://acs.m.taobao.com/h5/mtop.example/",
        "https://acs.m.taobao.com/h5/mtop.example/*/",
        "https://acs.m.taobao.com/gw/mtop.example/latest/",
        "https://acs.m.taobao.com/gw/mtop.example/1.0/extra",
        "https://acs.m.taobao.com/gw/mtop.example/*/extra",
        "https://acs.m.taobao.com/gw/mtop/1.0/",
        "https://acs.m.taobao.com/gw/mtop.example%2fother/1.0/",
        GW_URL + "?x=1#fragment", GW_URL + "\n", GW_URL + "?x=bad value", null,
    ]) assert.equal(app.cwAppRoute(url), null, String(url));
});

test("Host 存在时必须与 URL 同主机同 HTTPS 端口，允许相同重复头", () => {
    for (const hostValue of ["cn-acs.m.cainiao.com", "cn-acs.m.cainiao.com:443", "CN-ACS.M.CAINIAO.COM"]) {
        assert(app.cwAppRoute(GW_URL, headers([["Host", hostValue], ["host", hostValue]])));
    }
    for (const values of [
        ["acs.m.taobao.com"], ["cn-acs.m.cainiao.com:80"], ["cn-acs.m.cainiao.com:444"],
        ["cn-acs.m.cainiao.com, evil.invalid"], ["cn-acs.m.cainiao.com", "evil.invalid"],
        ["user@cn-acs.m.cainiao.com"], ["cn-acs.m.cainiao.com\r\nX-Secret: bad"], [true],
    ]) assert.equal(app.cwAppRoute(GW_URL, headers(values.map(value => ["Host", value]))), null);
    const f = fixture();
    captureNative(f, {extra: [["Host", "evil.invalid"]]});
    assert.equal(saved(f), undefined); assert.equal(f.requests.length, 0);
});

test("路由只返回固定 API 分类，不保存任意 API 名称或查询参数", () => {
    for (const [api, apiKind] of [[API, "personal_list"], [COUNT_API, "personal_count"], ["mtop.common.getTimestamp", "public_time"], ["mtop.synthetic.private.account.marker", "other"]]) {
        const route = app.cwAppRoute("https://acs.m.taobao.com/gw/" + api + "/*/?uid=synthetic-sensitive-value");
        assert.deepEqual(route, {host: "acs.m.taobao.com", channel: "gw", apiKind});
        assert(!JSON.stringify(route).includes(api));
        assert(!JSON.stringify(route).includes("synthetic-sensitive-value"));
    }
});

test("同次原生 SID 与 UID 只保存为待验证候选，不读取正文、不改请求、不查询", () => {
    const f = fixture(), input = nativeInput(f, {extra: [["x-sign", "synthetic-fixed-signature"], ["x-mini-wua", "synthetic-device-proof"], ["User-Agent", "synthetic-ua"]]});
    const original = input.request.headers;
    Object.defineProperty(input.request, "body", {get() {throw new Error("不得读取 App body");}});
    assert.equal(auth.captureCainiaoCredentials(input, f.clock), undefined);
    assert.equal(input.request.headers, original); assert.equal(input.request.url, GW_URL);
    const state = saved(f), cookies = core.cwCookieMap(state.cookie);
    assert.equal(state.captureKind, "native_session_candidate"); assert.equal(state.sourceChannel, "gw");
    assert.equal(state.sourceHost, "cn-acs.m.cainiao.com"); assert.equal(state.status, "pending");
    assert.equal(state.confirmedAt, null); assert.equal(state.accountCheckedAt, null);
    assert.equal(cookies.get("unb"), UID); assert.equal(cookies.get("cookie2"), SID);
    assert.deepEqual([...cookies.keys()].sort(), ["cookie2", "unb"]);
    assert.equal(f.requests.length, 0);
    for (const secret of ["synthetic-fixed-signature", "synthetic-device-proof", "synthetic-ua"]) assert(!JSON.stringify(state).includes(secret));
});

test("App GW 请求内的真实 Cookie 优先于原生候选，保留其自带网关 token", () => {
    const f = fixture(); captureNative(f, {cookie: H5_COOKIE});
    const state = saved(f), cookies = core.cwCookieMap(state.cookie);
    assert.equal(state.captureKind, "request_cookie"); assert.equal(state.sourceChannel, "gw");
    assert.equal(cookies.get("cookie2"), "synthetic-h5-session-a");
    assert.equal(cookies.get("_m_h5_tk"), "synthetic-h5-token_1");
    assert(!state.cookie.includes(SID)); assert.equal(state.status, "pending");
});

test("跨请求 UID 与 SID 不拼接，累计字段存在不等于同次会话", () => {
    const f = fixture(); captureNative(f, {sid: null}); f.advance(1000); captureNative(f, {uid: null});
    assert.equal(saved(f), undefined); assert.equal(f.requests.length, 0);
    const info = summary(f); assert.equal(info.observed, true); assert.equal(info.sameRequestNativeSession, false);
    assert.equal(info.sameRequestLoginFields, false);
    assert(info.rows[0].nativeHeaders.includes("x-uid")); assert(info.rows[0].nativeHeaders.includes("x-sid"));
});

test("跨请求 Cookie 账号与会话也不拼接，累计名称不制造登录证据", () => {
    const f = fixture();
    auth.captureCainiaoCredentials(f.incoming("unb=" + UID, H5_URL), f.clock);
    f.advance(1000); auth.captureCainiaoCredentials(f.incoming("cookie2=synthetic-separate-session", H5_URL), f.clock);
    assert.equal(saved(f), undefined);
    const info = summary(f); assert.equal(info.sameRequestLoginFields, false);
    assert(info.rows[0].cookies.includes("unb")); assert(info.rows[0].cookies.includes("cookie2"));
});

test("x-sign 子串、WUA、访客 token 和独立账号标识都不能生成会话", () => {
    for (const extra of [
        [["x-signature", "synthetic-not-x-sign"], ["x-user-id", UID], ["x-session-id", SID]],
        [["x-sign", "synthetic-fixed-signature"], ["x-mini-wua", "synthetic-wua"]],
        [["x-uid", UID]], [["x-sid", SID]],
    ]) {
        const f = fixture(); auth.captureCainiaoCredentials(f.incoming("_m_h5_tk=synthetic-guest-token_1", GW_URL, extra), f.clock);
        assert.equal(saved(f), undefined); assert.equal(f.requests.length, 0);
    }
});

test("公共时间原生请求仅计观察，不生成原生登录候选", () => {
    const f = fixture(); captureNative(f, {url: "https://acs.m.taobao.com/gw/mtop.common.getTimestamp/*/"});
    assert.equal(saved(f), undefined); assert.equal(f.requests.length, 0);
    const info = summary(f); assert.equal(info.observed, true); assert.equal(info.rows[0].apiKind, "public_time");
});

test("H5 路由不把只有 native SID/UID 的请求改当 Cookie 会话", () => {
    const f = fixture(); captureNative(f, {url: H5_URL});
    assert.equal(saved(f), undefined); assert.equal(f.requests.length, 0);
});

test("原生 UID 与 SID 严格校验类型、长度、字符及冲突重复", () => {
    for (const options of [
        {uid: "0"}, {uid: "01"}, {uid: "synthetic-user"}, {uid: "9".repeat(21)}, {uid: "900\r\nHost:evil.invalid"}, {uid: true},
        {sid: "short"}, {sid: "x".repeat(8193)}, {sid: "synthetic session"}, {sid: "synthetic;cookie2=extra"},
        {sid: "synthetic,merged-value"}, {sid: "synthetic\r\nX:secret"}, {sid: true},
        {extra: [["x-uid", OTHER_UID]]}, {extra: [["x-sid", OTHER_SID]]},
    ]) {
        const f = fixture(); captureNative(f, options);
        assert.equal(saved(f), undefined, JSON.stringify(options)); assert.equal(f.requests.length, 0);
    }
    const f = fixture(); captureNative(f, {extra: [["X-UID", UID], ["X-SID", SID]]});
    assert.equal(saved(f).status, "pending");
});

test("头 API 超限、非法返回类型和逗号合并的会话头均拒绝", () => {
    for (const badHeaders of [
        {getAll: () => "not-an-array"}, {getAll: () => [true]},
        {getAll: name => name.toLowerCase() === "x-sid" ? Array(17).fill(SID) : name.toLowerCase() === "x-uid" ? [UID] : []},
        {get: name => name.toLowerCase() === "x-sid" ? SID + ", " + OTHER_SID : name.toLowerCase() === "x-uid" ? UID : null},
    ]) {
        const f = fixture(), input = nativeInput(f); input.request.headers = badHeaders;
        assert.equal(auth.captureCainiaoCredentials(input, f.clock), undefined);
        assert.equal(saved(f), undefined); assert.equal(f.requests.length, 0);
    }
});

test("同次真实 Cookie 加有效 native UID 保留原值，但只是待验证候选", () => {
    const f = fixture(); captureNative(f, {cookie: "cookie2=synthetic-anonymous-cookie; _m_h5_tk=synthetic-guessed-token_1; munb=synthetic-old-munb"});
    const cookies = core.cwCookieMap(saved(f).cookie);
    assert.deepEqual([...cookies.keys()].sort(), ["_m_h5_tk", "cookie2", "munb", "unb"]);
    assert.equal(cookies.get("cookie2"), "synthetic-anonymous-cookie");
    assert.equal(cookies.get("_m_h5_tk"), "synthetic-guessed-token_1");
    assert.equal(cookies.get("munb"), "synthetic-old-munb");
    assert.equal(saved(f).captureKind, "request_cookie_candidate");
    assert.equal(saved(f).status, "pending"); assert.equal(saved(f).confirmedAt, null);
    assert(!saved(f).cookie.includes(SID)); assert.equal(f.requests.length, 0);
});

test("同账号已有已确认 Cookie 时不同 native SID 不降级、不丢 token 或缓存", () => {
    const f = fixture(), previous = legacyState(), cached = cachedState(previous);
    f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, cached);
    captureNative(f, {sid: OTHER_SID});
    assert.deepEqual(saved(f), previous); assert.deepEqual(f.memory.get(core.CW_STORE), cached);
    const current = auth.cwReadAuth(f.ctx, f.clock()); assert.equal(current.captureKind, "request_cookie");
    assert.equal(current.status, "connected"); assert(current.cookie.includes("synthetic-h5-token_1"));
});

test("更换账号的 native 候选先隔离旧码，绝不混入旧 Cookie、token 或快照", () => {
    const f = fixture(), previous = legacyState();
    f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, cachedState(previous));
    const start = f.writes.length; captureNative(f, {uid: OTHER_UID, sid: OTHER_SID});
    const changes = f.writes.slice(start).filter(write => [core.CW_STORE, core.CW_AUTH_STORE].includes(write.key)), state = saved(f), cached = f.memory.get(core.CW_STORE);
    assert.equal(changes[0].key, core.CW_STORE); assert.equal(changes[0].value.snapshot, null);
    assert.equal(cached.snapshot, null); assert.equal(cached.cookie, "");
    assert.equal(state.status, "pending"); assert.notEqual(state.owner, previous.owner);
    assert.equal(core.cwCookieMap(state.cookie).get("unb"), OTHER_UID);
    for (const value of ["synthetic-h5-session-a", "synthetic-h5-token_1", "8-1-1111"]) assert(!JSON.stringify(state).includes(value));
});

test("Cookie 与同次 native UID 冲突时不保存新会话，并阻断旧码再展示", async () => {
    const f = fixture(), previous = legacyState();
    f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, cachedState(previous));
    captureNative(f, {uid: OTHER_UID, cookie: H5_COOKIE});
    assert.deepEqual(saved(f), previous);
    assert.equal(f.memory.get(core.CW_STORE).blocked, true); assert.equal(f.memory.get(core.CW_STORE).snapshot, null);
    const model = await load(f); assert.equal(model.status, "setup"); assert.equal(model.items.length, 0);
    assert(!JSON.stringify(model).includes("8-1-1111")); assert.equal(f.requests.length, 0);
});

test("native 候选失效后没有新 App 请求就不恢复，重新采集清旧 token 与缓存", async () => {
    const f = fixture(); captureNative(f);
    const old = {...saved(f), status: "expired"}; f.memory.set(core.CW_AUTH_STORE, old);
    const cached = cachedState(old); cached.cookie += "; _m_h5_tk=synthetic-stale-server-token_1";
    f.memory.set(core.CW_STORE, cached);
    const model = await load(f); assert.equal(model.status, "setup"); assert.equal(model.setupTitle, "App 接入未确认"); assert.equal(f.requests.length, 0);
    assert.equal(saved(f).status, "expired");
    f.advance(1000); captureNative(f);
    assert.equal(saved(f).status, "pending"); assert.notEqual(saved(f).generation, old.generation);
    assert.equal(saved(f).confirmedAt, null); assert.equal(saved(f).accountCheckedAt, null);
    assert(!JSON.stringify(f.memory.get(core.CW_STORE)).includes("synthetic-stale-server-token_1"));
    assert.equal(f.memory.get(core.CW_STORE).snapshot, null);
});

test("新账号 native 候选保存失败仍留下屏障，恢复存储不能继续查旧账号", async () => {
    for (const failure of ["throw", "noop"]) {
        const f = fixture(), previous = legacyState();
        f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, cachedState(previous));
        const write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {
            if (key === core.CW_AUTH_STORE) {if (failure === "throw") throw new Error("synthetic-private-storage-message"); return;}
            write(key, value);
        };
        captureNative(f, {uid: OTHER_UID, sid: OTHER_SID}); f.ctx.storage.setJSON = write;
        assert.deepEqual(saved(f), previous); assert.equal(f.memory.get(core.CW_STORE).blocked, true);
        const model = await load(f); assert.equal(model.items.length, 0); assert.equal(model.status, "setup");
        assert.equal(f.requests.length, 0); assert(!JSON.stringify(model).includes("synthetic-private-storage-message"));
    }
});

test("已校验的 1.1.0 Cookie 状态规范迁移，不要求老用户再次打开 App", async () => {
    const f = fixture([success([])]), previous = legacyState();
    f.memory.set(core.CW_AUTH_STORE, previous); f.memory.set(core.CW_STORE, cachedState(previous));
    const migrated = auth.cwReadAuth(f.ctx, f.clock());
    assert.equal(migrated.version, core.CW_VERSION); assert.equal(migrated.captureKind, "request_cookie");
    assert.equal(migrated.sourceChannel, "h5"); assert.equal(migrated.accountCheckedAt, null);
    for (const key of ["owner", "generation", "inputHash", "sessionHash", "cookie", "status", "capturedAt", "confirmedAt"]) assert.equal(migrated[key], previous[key]);
    const model = await load(f); assert.equal(model.status, "ready"); assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url.searchParams.get("api"), API);
    assert(f.requests[0].options.headers.Cookie.includes("synthetic-h5-token_1"));
    assert.equal(saved(f).version, core.CW_VERSION); assert.equal(saved(f).captureKind, "request_cookie");
});

test("1.1.0 迁移仍复核旧状态完整性，损坏值或其他版本不能跳过验证", () => {
    const previous = legacyState();
    for (const changes of [{owner: "wrong"}, {inputHash: core.md5("wrong")}, {sessionHash: core.md5("wrong")},
        {cookie: previous.cookie + "; tracking=synthetic-extra"}, {sourceHost: "cn-acs.m.cainiao.com"},
        {confirmedAt: null}, {capturedAt: NOW + 120000}, {version: "1.0.0"}, {version: "1.4.0"}]) {
        assert.equal(auth.cwAuthState({...previous, ...changes}, NOW), null, JSON.stringify(changes));
    }
});

test("native connected 缺少账号检查时间不能被当作有效已连接状态", () => {
    const f = fixture(); captureNative(f);
    assert.equal(auth.cwAuthState({...saved(f), status: "connected", confirmedAt: NOW, accountCheckedAt: null}, NOW), null);
    assert.equal(auth.cwAuthState({...saved(f), status: "connected", confirmedAt: NOW, accountCheckedAt: NOW + 120000}, NOW), null);
});

test("组件自己发出的请求完全忽略，不增加 App 观察或形成新会话", () => {
    const f = fixture(); captureNative(f, {extra: [[core.CW_SELF_HEADER.toLowerCase(), "1"]]});
    assert.equal(saved(f), undefined); assert.equal(metadata(f), undefined); assert.equal(f.writes.length, 0);
    assert.equal(summary(f).observed, false); assert.equal(f.requests.length, 0);
});

test("App 元数据仅含固定类别与字段名，正文、UID、SID、签名和设备值不落盘", () => {
    const f = fixture(); captureNative(f, {url: "https://e2e-mtop.cainiao.com/gw/mtop.synthetic.private.account.marker/*/?secret=synthetic-url-secret",
        extra: [["x-t", "synthetic-time-value"], ["x-sign", "synthetic-sign-value"], ["x-mini-wua", "synthetic-wua-value"], ["x-umt", "synthetic-umt-value"], ["x-sgext", "synthetic-sgext-value"], ["User-Agent", "synthetic-agent-value"]]});
    const text = JSON.stringify(metadata(f));
    for (const value of [UID, SID, "mtop.synthetic.private.account.marker", "synthetic-url-secret", "synthetic-time-value", "synthetic-sign-value", "synthetic-wua-value", "synthetic-umt-value", "synthetic-sgext-value", "synthetic-agent-value"]) assert(!text.includes(value), value);
    assert.equal(metadata(f).rows[0].apiKind, "other");
    assert.deepEqual(metadata(f).rows[0].nativeHeaders, NATIVE_NAMES);
    const info = summary(f); assert.equal(info.sameRequestNativeSession, true);
    assert.equal(info.lastAt, NOW); assert.equal(info.observed, true);
});

test("七天采样窗口不可由新请求续期旧字段或同次登录证据", () => {
    const f = fixture(); captureNative(f, {cookie: H5_COOKIE});
    assert.equal(summary(f).sameRequestLoginFields, true); assert.equal(summary(f).sameRequestNativeSession, true);
    const startedAt = metadata(f).startedAt;
    f.advance(6 * 86400000); auth.captureCainiaoCredentials(f.incoming("", GW_URL), f.clock);
    assert.equal(metadata(f).startedAt, startedAt);
    f.advance(2 * 86400000); auth.captureCainiaoCredentials(f.incoming("", GW_URL), f.clock);
    const current = summary(f);
    assert.equal(metadata(f).startedAt, f.clock()); assert.equal(current.sameRequestLoginFields, false);
    assert.equal(current.sameRequestNativeSession, false);
    assert.deepEqual(current.rows[0].cookies, []); assert.deepEqual(current.rows[0].nativeHeaders, []);
});

test("只读摘要清洗未知字段、伪造类别、未来时间及多余行，不泄漏存储原文", () => {
    const f = fixture(); captureNative(f);
    const good = structuredClone(metadata(f).rows[0]);
    const noisy = {version: core.CW_VERSION, startedAt: NOW, secret: "synthetic-envelope-secret",
        rows: [{...good, secret: "synthetic-row-secret", cookies: ["unb", "unknown-cookie-secret"], nativeHeaders: ["x-uid", "unknown-native-secret"]},
            {...good, host: "evil.invalid", secret: "synthetic-foreign-row"}, {...good, apiKind: "synthetic-secret-api"},
            {...good, at: NOW + 1000}, ...Array.from({length: 40}, () => ({...good}))]};
    f.memory.set(core.CW_APP_STORE, noisy); const before = structuredClone([...f.memory]);
    const current = summary(f), text = JSON.stringify(current);
    assert(current.rows.length <= 32);
    for (const value of ["synthetic-envelope-secret", "synthetic-row-secret", "unknown-cookie-secret", "unknown-native-secret", "evil.invalid", "synthetic-foreign-row", "synthetic-secret-api"]) assert(!text.includes(value));
    assert(current.rows.every(row => row.at <= NOW)); assert.deepEqual([...f.memory], before);
    f.memory.set(core.CW_APP_STORE, {...noisy, startedAt: NOW + 1000}); assert.equal(summary(f).observed, false);
});

test("同次标记必须有完整名称和本窗口时间，不能信任损坏的持久化布尔", () => {
    const f = fixture(); captureNative(f);
    const row = structuredClone(metadata(f).rows[0]);
    for (const changes of [
        {nativeHeaders: ["x-uid"], sameRequestNativeSession: true, sameRequestNativeSessionAt: NOW},
        {nativeHeaders: ["x-sid", "x-uid"], sameRequestNativeSession: true, sameRequestNativeSessionAt: NOW + 1},
        {nativeHeaders: ["x-sid", "x-uid"], sameRequestNativeSession: true, sameRequestNativeSessionAt: NOW - 1},
    ]) {
        f.memory.set(core.CW_APP_STORE, {version: core.CW_VERSION, startedAt: NOW, rows: [{...row, ...changes}]});
        assert.equal(summary(f).sameRequestNativeSession, false);
    }
});

test("同组件连接状态可分享且只读，不输出账号、会话、摘要、设备值或异常", () => {
    const f = fixture(); captureNative(f, {extra: [["x-sign", "synthetic-diagnostic-sign-secret"]]});
    const before = structuredClone([...f.memory]), output = auth.diagnoseCainiaoConnection(f.ctx, f.clock);
    const text = JSON.stringify(output), state = saved(f);
    for (const value of [UID, SID, state.owner, state.inputHash, state.generation, state.sessionHash, state.cookie, "synthetic-diagnostic-sign-secret"]) assert(!text.includes(value));
    assert.deepEqual([...f.memory], before); assert.equal(f.requests.length, 0);
    const read = f.ctx.storage.getJSON;
    f.ctx.storage.getJSON = () => {throw new Error("synthetic-diagnostic-exception-secret");};
    assert(!JSON.stringify(auth.diagnoseCainiaoConnection(f.ctx, f.clock)).includes("synthetic-diagnostic-exception-secret"));
    f.ctx.storage.getJSON = read;
});

test("手动、关闭与无效连接模式不观察 App；off 仅清本组件新增元数据键", () => {
    for (const mode of ["manual", "off", "invalid"]) {
        const f = fixture(); f.ctx.env.CONNECTION_MODE = mode; captureNative(f);
        assert.equal(f.writes.length, 0); assert.equal(metadata(f), undefined); assert.equal(f.requests.length, 0);
    }
    const f = fixture(); captureNative(f); f.memory.set("synthetic-other-module", {keep: true});
    auth.cwClearLocal(f.ctx); assert.equal(f.memory.get(core.CW_APP_STORE), null);
    assert.deepEqual(f.memory.get("synthetic-other-module"), {keep: true});
});

test("一次 App 原生采集后身份、COUNT 和完整 PDS 成功才连接，关闭 App 后仍请求新物流", async () => {
    const f = fixture([identityResponse(), countResponse(), nativePds([parcel("a", "8-1-1111")])]);
    captureNative(f); assert.equal(f.requests.length, 0); assert.equal(saved(f).status, "pending");
    const first = await load(f); assert.equal(first.status, "ready"); assert.equal(first.items[0].code, "8-1-1111");
    assert.equal(saved(f).status, "connected"); assert.equal(saved(f).confirmedAt, NOW); assert.equal(saved(f).accountCheckedAt, NOW);
    assert.equal(f.requests.length, 3);
    assert.deepEqual(f.requests.map(request => request.url.searchParams.get("api")), ["mtop.user.getUserSimple", COUNT_API, API]);
    assert.equal(f.requests[0].url.searchParams.get("data"), "{}");
    assert.equal(f.requests[1].url.searchParams.get("data"), '{"appName":"GUOGUO"}');
    const generation = saved(f).generation, capturedAt = saved(f).capturedAt;
    f.advance(15 * 60000); f.replies.push(nativePds([parcel("b", "8-2-2222")]));
    const second = await load(f); assert.equal(second.status, "ready"); assert.equal(second.items[0].code, "8-2-2222");
    assert(!JSON.stringify(second).includes("8-1-1111")); assert.equal(f.requests.length, 4);
    assert.equal(f.requests[3].url.searchParams.get("api"), API);
    assert.notEqual(f.requests[2].url.href, f.requests[3].url.href);
    assert.notEqual(f.requests[2].url.searchParams.get("t"), f.requests[3].url.searchParams.get("t"));
    assert.notEqual(f.requests[2].url.searchParams.get("sign"), f.requests[3].url.searchParams.get("sign"));
    assert.equal(saved(f).generation, generation); assert.equal(saved(f).capturedAt, capturedAt);
    assert.equal(saved(f).accountCheckedAt, NOW); assert.equal(saved(f).confirmedAt, NOW + 15 * 60000);
    assert.equal(second.updatedAt, new Date(NOW + 15 * 60000).toISOString());
});

test("native 身份 token 引导会重新签名，三种个人请求都固定主机、参数和安全 HTTP 选项", async () => {
    const f = fixture([
        response({ret: ["FAIL_SYS_TOKEN_EMPTY::空"]}, ["_m_h5_tk=synthetic-native-server-token_2; Domain=.taobao.com; Path=/"]),
        identityResponse(), countResponse(), nativePds([]),
    ]);
    captureNative(f, {extra: [["x-sign", "synthetic-app-sign-do-not-replay"], ["x-mini-wua", "synthetic-app-wua-do-not-replay"]]});
    assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, 4);
    assert(!f.requests[0].options.headers.Cookie.includes("_m_h5_tk"));
    assert(f.requests.slice(1).every(request => request.options.headers.Cookie.includes("synthetic-native-server-token_2")));
    assert.notEqual(f.requests[0].url.searchParams.get("t"), f.requests[1].url.searchParams.get("t"));
    assert.notEqual(f.requests[0].url.searchParams.get("sign"), f.requests[1].url.searchParams.get("sign"));
    for (const request of f.requests) {
        assert.equal(request.url.protocol, "https:"); assert.equal(request.url.hostname, "h5api.m.taobao.com");
        assert.equal(request.url.searchParams.get("appKey"), "12574478");
        const cookies = core.cwCookieMap(request.options.headers.Cookie), rawToken = cookies.get("_m_h5_tk");
        const token = rawToken ? rawToken.split("_")[0] : "undefined";
        const expected = createHash("md5").update(token + "&" + request.url.searchParams.get("t") + "&12574478&" + request.url.searchParams.get("data")).digest("hex");
        assert.equal(request.url.searchParams.get("sign"), expected);
        assert.equal(request.options.headers[core.CW_SELF_HEADER], "1");
        assert.equal(request.options.redirect, "manual"); assert.equal(request.options.credentials, "omit"); assert.equal(request.options.insecureTls, false);
        assert(request.options.timeout > 0 && request.options.timeout <= 7000);
        assert(!JSON.stringify(request.options).includes("synthetic-app-sign-do-not-replay"));
        assert(!JSON.stringify(request.options).includes("synthetic-app-wua-do-not-replay"));
    }
    assert(!JSON.stringify([...f.memory]).includes("synthetic-identity-nick-must-not-persist"));
});

test("native 空列表也必须先取得匹配身份和 COUNT 证据，不能把公共 SUCCESS 当登录", async () => {
    const good = fixture([identityResponse(), countResponse({data: {count: 0}}), nativePds([])]);
    captureNative(good); const ready = await load(good); assert.equal(ready.status, "ready"); assert.equal(ready.total, 0);
    assert.equal(saved(good).status, "connected"); assert.equal(good.requests.length, 3);
    for (const stage of ["identity", "count", "pds"]) {
        const publicTime = response({api: "mtop.common.getTimestamp", ret: ["SUCCESS::成功"], data: {t: "synthetic-public-time"}});
        const f = fixture(stage === "identity" ? [publicTime] : stage === "count" ? [identityResponse(), publicTime] : [identityResponse(), countResponse(), publicTime]);
        captureNative(f); const model = await load(f);
        assert.notEqual(model.status, "ready"); assert.equal(model.items.length, 0); assert.equal(model.updatedAt, null);
        assert.equal(saved(f).status, "unsupported"); assert.equal(saved(f).confirmedAt, null); assert.equal(saved(f).accountCheckedAt, null);
        const before = f.requests.length; await load(f); assert.equal(f.requests.length, before);
    }
});

test("identity 只接受顶层 userNumId，嵌套值、昵称、别名、零值及不安全数字不通过", async () => {
    const bodies = [
        {api: "mtop.user.getUserSimple", ret: ["SUCCESS::成功"], data: {userNumId: UID}},
        {api: "mtop.user.getUserSimple", ret: ["SUCCESS::成功"], data: {unb: UID, nick: UID}, userId: UID},
        {api: "mtop.user.getUserSimple", ret: ["SUCCESS::成功"], userNumId: "0", data: {}},
        {api: "mtop.user.getUserSimple", ret: ["SUCCESS::成功"], userNumId: "01", data: {}},
        {api: "mtop.user.getUserSimple", ret: ["SUCCESS::成功"], userNumId: true, data: {}},
        {api: "mtop.user.getUserSimple", ret: ["SUCCESS::成功"], userNumId: Number(UID), data: {}},
        {ret: ["SUCCESS::成功"], userNumId: UID, data: {}},
    ];
    for (const body of bodies) {
        const f = fixture([response(body)]); captureNative(f); const model = await load(f);
        assert.notEqual(model.status, "ready"); assert.equal(saved(f).status, "unsupported");
        assert.equal(saved(f).confirmedAt, null); assert.equal(f.requests.length, 1); assert.equal(model.items.length, 0);
    }
    const f = fixture([identityResponse(123456789), countResponse(), nativePds([])]);
    captureNative(f, {uid: "123456789"}); assert.equal((await load(f)).status, "ready"); assert.equal(saved(f).status, "connected");
});

test("identity 匹配另一 UID 立即失效清缓存，不能回显旧码或继续 COUNT", async () => {
    const f = fixture([identityResponse(OTHER_UID)]); captureNative(f);
    f.memory.set(core.CW_STORE, cachedState(saved(f)));
    const model = await load(f); assert.equal(saved(f).status, "invalid"); assert.equal(saved(f).confirmedAt, null);
    assert.equal(model.items.length, 0); assert.equal(model.updatedAt, null); assert.equal(f.requests.length, 1);
    assert.equal(f.memory.get(core.CW_STORE).snapshot, null); assert.equal(f.memory.get(core.CW_STORE).cookie, "");
    await load(f); assert.equal(f.requests.length, 1);
});

test("COUNT 成功但 PDS 网络失败不会连接或留下已确认账号时间", async () => {
    const f = fixture([identityResponse(), countResponse(), new Error("synthetic-pds-offline")]); captureNative(f);
    const model = await load(f); assert.equal(model.status, "offline"); assert.equal(model.items.length, 0);
    assert.equal(saved(f).status, "pending"); assert.equal(saved(f).confirmedAt, null); assert.equal(saved(f).accountCheckedAt, null);
    assert.equal(f.memory.get(core.CW_STORE).snapshot, null); assert.equal(f.requests.length, 3);
    f.replies.push(identityResponse(), countResponse(), nativePds([]));
    assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, 6);
});

test("COUNT 的错误 echo 或非对象数据拒绝，native PDS 缺 api echo 也不兼容", async () => {
    for (const replies of [
        [identityResponse(), countResponse({api: API})],
        [identityResponse(), countResponse({data: null})],
        [identityResponse(), countResponse({data: []})],
        [identityResponse(), countResponse(), success([])],
    ]) {
        const f = fixture(replies); captureNative(f); const model = await load(f);
        assert.notEqual(model.status, "ready"); assert.equal(saved(f).status, "unsupported");
        assert.equal(saved(f).confirmedAt, null); assert.equal(saved(f).accountCheckedAt, null);
        const before = f.requests.length; await load(f); assert.equal(f.requests.length, before);
    }
});

test("native 完整分页才确认，部分结果不是连接成功也不覆盖完整快照", async () => {
    const f = fixture([identityResponse(), countResponse(), nativePds([parcel("a")], 2, 1), new Error("synthetic-page-two-offline")]);
    captureNative(f); const partial = await load(f);
    assert.equal(partial.status, "partial"); assert.equal(partial.partial, true); assert.equal(partial.total, 1);
    assert.equal(saved(f).status, "pending"); assert.equal(saved(f).confirmedAt, null); assert.equal(saved(f).accountCheckedAt, null);
    assert.equal(f.memory.get(core.CW_STORE).snapshot, null);
    f.replies.push(identityResponse(), countResponse(), nativePds([parcel("a")], 2, 1), nativePds([parcel("b")], 2, 2));
    const complete = await load(f); assert.equal(complete.status, "ready"); assert.equal(complete.total, 2); assert.equal(saved(f).status, "connected");
});

test("不兼容 native 身份只试一次，新 App 采集后才重新验证", async () => {
    const f = fixture([identityResponse(undefined, {userNumId: undefined})]); captureNative(f);
    const before = saved(f).generation;
    await load(f); assert.equal(saved(f).status, "unsupported"); await load(f); assert.equal(f.requests.length, 1);
    f.advance(1000); captureNative(f); assert.equal(saved(f).status, "pending"); assert.notEqual(saved(f).generation, before);
    f.replies.push(identityResponse(), countResponse(), nativePds([])); assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, 4);
});

test("native 身份网关 token 不更新就停止，令牌更新重试仍最多三次", async () => {
    const noChange = fixture([response({ret: ["FAIL_SYS_TOKEN_EXPIRED::过期"]})]); captureNative(noChange);
    const unchanged = await load(noChange);
    assert.equal(unchanged.status, "setup"); assert.equal(unchanged.setupTitle, "App 接入未确认");
    assert.equal(saved(noChange).status, "unsupported"); assert.equal(noChange.requests.length, 1);
    const f = fixture(Array.from({length: 4}, (_, index) => response({ret: ["FAIL_SYS_TOKEN_EXPIRED::过期"]}, ["_m_h5_tk=synthetic-retry-token-" + index + "_2; Path=/"])));
    captureNative(f); const exhausted = await load(f);
    assert.equal(exhausted.status, "setup"); assert.equal(exhausted.setupTitle, "App 接入未确认"); assert.equal(f.requests.length, 3);
    assert.equal(saved(f).status, "unsupported"); await load(f); assert.equal(f.requests.length, 3);
});

test("native 身份和 COUNT 共用十八秒预算，预算不足不能继续个人列表查询", async () => {
    const f = fixture([() => {f.advance(17500); return identityResponse();}]); captureNative(f);
    const model = await load(f); assert.notEqual(model.status, "ready"); assert.equal(model.items.length, 0);
    assert.equal(saved(f).status, "pending"); assert.equal(f.requests.length, 1);
});

test("native 身份或 COUNT 请求在途换号停止旧任务，不能覆盖新候选或返回旧码", async () => {
    for (const stage of ["identity", "count"]) {
        const f = fixture(); captureNative(f);
        const change = () => {captureNative(f, {uid: OTHER_UID, sid: OTHER_SID}); return stage === "identity" ? identityResponse() : countResponse();};
        f.replies.push(...(stage === "identity" ? [change] : [identityResponse(), change]));
        const model = await load(f); assert.equal(model.status, "setup"); assert.equal(model.items.length, 0);
        assert.equal(core.cwCookieMap(saved(f).cookie).get("unb"), OTHER_UID); assert.equal(saved(f).status, "pending");
        assert.equal(f.memory.get(core.CW_STORE).snapshot, null);
    }
});

test("native 初次并发验证的迟到身份响应不能回滚较新的连接和完整快照", async () => {
    const f = fixture(); captureNative(f);
    let finish;
    f.replies.push(() => new Promise(resolve => {finish = resolve;}));
    const first = load(f);
    for (let step = 0; !finish && step < 100; step++) await Promise.resolve();
    assert.equal(typeof finish, "function", "首个验证任务应已进入模拟 HTTP 等待");
    f.advance(1000); f.replies.push(identityResponse(), countResponse(), nativePds([parcel("new", "8-2-2222")]));
    const latest = await load(f); assert.equal(latest.status, "ready"); assert.equal(saved(f).status, "connected");
    finish(identityResponse()); const stale = await first;
    assert.equal(stale.status, "setup"); assert.equal(stale.items.length, 0);
    assert.deepEqual(f.memory.get(core.CW_STORE).snapshot.items, latest.items);
    assert.equal(f.memory.get(core.CW_STORE).snapshot.updatedAt, latest.updatedAt);
});

test("native 连接标志写入失败只能返回实时结果，不能声称首次凭据持久验证成功", async () => {
    const f = fixture([identityResponse(), countResponse(), nativePds([])]); captureNative(f);
    const write = f.ctx.storage.setJSON;
    f.ctx.storage.setJSON = (key, value) => {if (key !== core.CW_AUTH_STORE) write(key, value);};
    const model = await load(f); assert.equal(model.status, "ready"); assert.match(model.message, /写入失败/);
    assert.equal(saved(f).status, "pending"); assert.equal(saved(f).accountCheckedAt, null); assert.equal(saved(f).confirmedAt, null);
});

test("关闭 App 后 PDS 登录过期保留明确旧结果，新 capture 才重新走身份及 COUNT", async () => {
    const f = fixture([identityResponse(), countResponse(), nativePds([parcel("a", "8-1-1111")]), response({ret: ["FAIL_SYS_SESSION_EXPIRED::过期"]})]);
    captureNative(f); const first = await load(f); f.advance(60000);
    const expired = await load(f); assert.equal(expired.status, "expired"); assert.deepEqual(expired.items, first.items);
    assert.equal(expired.updatedAt, first.updatedAt); assert.match(expired.message, /上次结果/);
    assert.equal(saved(f).status, "expired"); assert.equal(f.requests.length, 4); await load(f); assert.equal(f.requests.length, 4);
    captureNative(f); f.replies.push(identityResponse(), countResponse(), nativePds([]));
    assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, 7);
    assert.deepEqual(f.requests.slice(4).map(request => request.url.searchParams.get("api")), ["mtop.user.getUserSimple", COUNT_API, API]);
});

test("已确认 native 会话关闭 App 后仍能自动轮换 H5 token 并供下一次查询复用", async () => {
    const f = fixture([
        response({ret: ["FAIL_SYS_TOKEN_EMPTY::空"]}, ["_m_h5_tk=synthetic-native-token-first_2; Domain=.taobao.com; Path=/"]),
        identityResponse(), countResponse(), nativePds([parcel("a", "8-1-1111")]),
        response({ret: ["FAIL_SYS_TOKEN_EXPIRED::过期"]}, ["_m_h5_tk=synthetic-native-token-rotated_3; Domain=.taobao.com; Path=/"]),
        nativePds([parcel("b", "8-2-2222")]), nativePds([]),
    ]);
    captureNative(f); assert.equal((await load(f)).status, "ready");
    const generation = saved(f).generation, inputHash = saved(f).inputHash;
    f.advance(15 * 60000); const changed = await load(f); assert.equal(changed.status, "ready");
    assert.equal(changed.items[0].code, "8-2-2222"); assert.equal(f.requests.length, 6);
    assert.equal(f.requests[4].url.searchParams.get("api"), API); assert.equal(f.requests[5].url.searchParams.get("api"), API);
    assert(f.requests[4].options.headers.Cookie.includes("synthetic-native-token-first_2"));
    assert(f.requests[5].options.headers.Cookie.includes("synthetic-native-token-rotated_3"));
    assert.notEqual(f.requests[4].url.searchParams.get("t"), f.requests[5].url.searchParams.get("t"));
    assert.notEqual(f.requests[4].url.searchParams.get("sign"), f.requests[5].url.searchParams.get("sign"));
    f.advance(15 * 60000); assert.equal((await load(f)).status, "ready");
    assert(f.requests[6].options.headers.Cookie.includes("synthetic-native-token-rotated_3"));
    assert.equal(saved(f).generation, generation); assert.equal(saved(f).inputHash, inputHash); assert.equal(saved(f).status, "connected");
});

function withSetCookies(reply, cookies) {
    return {...reply, headers: headers(cookies.map(value => ["set-cookie", value]))};
}

test("首个缓存写入 noop 时在途 Cookie/native 冲突仍立即阻断旧账号结果与回写", async () => {
    const f = fixture([success([parcel("old", "8-1-1111")])]);
    auth.captureCainiaoCredentials(f.incoming(H5_COOKIE, H5_URL), f.clock);
    assert.equal((await load(f)).status, "ready"); const generation = saved(f).generation;
    const write = f.ctx.storage.setJSON; let skipped = false, barrier;
    f.ctx.storage.setJSON = (key, value) => {
        if (!skipped && key === core.CW_STORE) {skipped = true; return;}
        write(key, value);
    };
    f.replies.push(() => {
        captureNative(f, {uid: OTHER_UID, cookie: H5_COOKIE});
        barrier = structuredClone(f.memory.get(core.CW_STORE));
        return success([parcel("stale", "8-9-9999")]);
    });
    const model = await load(f);
    assert.equal(skipped, true); assert.equal(model.status, "setup"); assert.equal(model.items.length, 0);
    assert(!JSON.stringify(model).includes("8-1-1111")); assert(!JSON.stringify(model).includes("8-9-9999"));
    assert.equal(saved(f).generation, generation); assert.equal(barrier.blocked, true); assert.equal(barrier.snapshot, null);
    assert.deepEqual(f.memory.get(core.CW_STORE), barrier); assert.equal(f.requests.length, 2);
});

test("首个缓存写入 noop 的旧任务不能覆盖同账号较新快照，迟到成功或失败均不返回旧码", async () => {
    for (const late of ["success", "failure"]) {
        const f = fixture([success([parcel("old", "8-1-1111")])]);
        auth.captureCainiaoCredentials(f.incoming(H5_COOKIE, H5_URL), f.clock);
        assert.equal((await load(f)).status, "ready");
        const write = f.ctx.storage.setJSON; let skipped = false, finish;
        f.ctx.storage.setJSON = (key, value) => {
            if (!skipped && key === core.CW_STORE) {skipped = true; return;}
            write(key, value);
        };
        f.replies.push(() => new Promise(resolve => {finish = resolve;}));
        const first = load(f);
        for (let step = 0; !finish && step < 100; step++) await Promise.resolve();
        assert.equal(typeof finish, "function", "初写失败的首任务应已进入模拟网络等待");
        f.advance(1000); f.replies.push(success([parcel("new", "8-2-2222")]));
        const latest = await load(f); assert.equal(latest.status, "ready");
        const stable = structuredClone(f.memory.get(core.CW_STORE));
        finish(late === "success" ? success([parcel("stale", "8-9-9999")]) : response({}, [], 503));
        const stale = await first;
        assert.equal(skipped, true); assert.equal(stale.status, "setup"); assert.equal(stale.items.length, 0);
        assert(!JSON.stringify(stale).includes("8-1-1111")); assert(!JSON.stringify(stale).includes("8-9-9999"));
        assert.deepEqual(f.memory.get(core.CW_STORE), stable);
        assert.deepEqual(stable.snapshot.items, latest.items); assert.equal(stable.snapshot.updatedAt, latest.updatedAt);
    }
});

test("native identity 响应删除稳定 session 时终止首次接入，排队的 COUNT/PDS SUCCESS 也不得继续", async () => {
    const f = fixture([
        withSetCookies(identityResponse(), ["cookie2=; Max-Age=0; Path=/"]),
        countResponse({data: {count: 0}}), nativePds([]),
    ]);
    captureNative(f); const model = await load(f);
    assert.equal(model.status, "setup"); assert.equal(model.setupTitle, "App 接入未确认"); assert.equal(model.items.length, 0); assert.equal(model.updatedAt, null);
    assert.equal(f.requests.length, 1); assert.equal(saved(f).status, "unsupported");
    assert.equal(saved(f).accountCheckedAt, null); assert.equal(saved(f).confirmedAt, null);
    assert.equal(f.memory.get(core.CW_STORE).snapshot, null);
    await load(f); assert.equal(f.requests.length, 1);
});

test("已连接 native 缓存只剩账号与 token 时不能无 session 发 PDS 或显示零件成功", async () => {
    const f = fixture([identityResponse(), countResponse(), nativePds([parcel("old", "8-1-1111")])]);
    captureNative(f); assert.equal((await load(f)).status, "ready");
    const cache = f.memory.get(core.CW_STORE);
    cache.cookie = "unb=" + UID + "; _m_h5_tk=synthetic-token-without-session_2";
    f.memory.set(core.CW_STORE, cache); f.replies.push(nativePds([]));
    const model = await load(f);
    assert.equal(model.status, "expired"); assert.equal(f.requests.length, 3); assert.notEqual(saved(f).status, "connected");
    await load(f); assert.equal(f.requests.length, 3);
});

test("native identity 或 COUNT 轮换 cookie2 后丢弃旧证明，自动重新验证并绑定新稳定会话", async () => {
    const rotated = "synthetic-native-rotated-session-a";
    for (const stage of ["identity", "count"]) {
        const rotating = withSetCookies(stage === "identity" ? identityResponse(OTHER_UID) : countResponse(), ["cookie2=" + rotated + "; Path=/"]);
        const f = fixture(stage === "identity"
            ? [rotating, identityResponse(), countResponse(), nativePds([parcel("new", "8-2-2222")])]
            : [identityResponse(), rotating, identityResponse(), countResponse(), nativePds([parcel("new", "8-2-2222")])]);
        captureNative(f); const model = await load(f); assert.equal(model.status, "ready"); assert.equal(model.items[0].code, "8-2-2222");
        assert.equal(saved(f).status, "connected");
        assert.deepEqual(f.requests.map(request => request.url.searchParams.get("api")), stage === "identity"
            ? ["mtop.user.getUserSimple", "mtop.user.getUserSimple", COUNT_API, API]
            : ["mtop.user.getUserSimple", COUNT_API, "mtop.user.getUserSimple", COUNT_API, API]);
        const rotationIndex = stage === "identity" ? 0 : 1;
        for (const request of f.requests.slice(rotationIndex + 1)) assert.equal(core.cwCookieMap(request.options.headers.Cookie).get("cookie2"), rotated);
        const cache = f.memory.get(core.CW_STORE), current = core.cwCookieMap(cache.cookie);
        assert.equal(current.get("cookie2"), rotated); assert.equal(cache.accountSessionHash, auth.cwSessionHash(current));
        assert.equal(cache.accountCheckedAt, saved(f).accountCheckedAt);
        const count = f.requests.length; f.advance(60000); f.replies.push(nativePds([]));
        assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, count + 1);
        assert.equal(f.requests[count].url.searchParams.get("api"), API);
        assert.equal(core.cwCookieMap(f.requests[count].options.headers.Cookie).get("cookie2"), rotated);
    }
});

test("native 翻页时 cookie2 轮换须丢弃先前分页并重验，从第一页取完整新列表", async () => {
    const rotated = "synthetic-native-rotated-session-b";
    const f = fixture([
        identityResponse(), countResponse(), nativePds([parcel("old-first", "8-1-1111")], 2, 1),
        withSetCookies(nativePds([parcel("old-second", "8-9-9999")], 2, 2), ["cookie2=" + rotated + "; Path=/"]),
        identityResponse(), countResponse(), nativePds([parcel("new", "8-2-2222")]),
    ]);
    captureNative(f); const model = await load(f);
    assert.equal(model.status, "ready"); assert.equal(model.total, 1); assert.equal(model.items[0].code, "8-2-2222");
    assert(!JSON.stringify(model).includes("8-1-1111")); assert(!JSON.stringify(model).includes("8-9-9999"));
    assert.deepEqual(f.requests.map(request => request.url.searchParams.get("api")), ["mtop.user.getUserSimple", COUNT_API, API, API, "mtop.user.getUserSimple", COUNT_API, API]);
    assert.equal(JSON.parse(f.requests[2].url.searchParams.get("data")).currentPage, 1);
    assert.equal(JSON.parse(f.requests[3].url.searchParams.get("data")).currentPage, 2);
    assert.equal(JSON.parse(f.requests[6].url.searchParams.get("data")).currentPage, 1);
    const cache = f.memory.get(core.CW_STORE);
    assert.equal(cache.accountSessionHash, auth.cwSessionHash(core.cwCookieMap(cache.cookie)));
    assert.equal(cache.accountCheckedAt, saved(f).accountCheckedAt); assert.deepEqual(cache.snapshot.items, model.items);
});

test("native 稳定 session 反复轮换最多三轮，不能无限重验或确认未稳定的空列表", async () => {
    const f = fixture(Array.from({length: 4}, (_, index) => withSetCookies(identityResponse(), ["cookie2=synthetic-unstable-session-" + index + "; Path=/"])));
    captureNative(f); const model = await load(f);
    assert.notEqual(model.status, "ready"); assert.equal(model.items.length, 0);
    assert.equal(f.requests.length, 3); assert(f.requests.every(request => request.url.searchParams.get("api") === "mtop.user.getUserSimple"));
    assert.notEqual(saved(f).status, "connected"); assert.equal(saved(f).confirmedAt, null); assert.equal(saved(f).accountCheckedAt, null);
});

test("native 已连接缓存证明缺失或不匹配时必须重验身份和 COUNT，不直接查询 PDS", async () => {
    for (const changes of [
        {accountSessionHash: undefined}, {accountSessionHash: "synthetic-wrong-session-hash"},
        {accountCheckedAt: null}, {accountCheckedAt: NOW - 1},
    ]) {
        const f = fixture([identityResponse(), countResponse(), nativePds([parcel("old", "8-1-1111")])]);
        captureNative(f); assert.equal((await load(f)).status, "ready");
        const current = f.memory.get(core.CW_STORE); f.memory.set(core.CW_STORE, {...current, ...changes});
        f.advance(60000); f.replies.push(identityResponse(), countResponse(), nativePds([parcel("new", "8-2-2222")]));
        const model = await load(f); assert.equal(model.status, "ready"); assert.equal(model.items[0].code, "8-2-2222");
        assert.deepEqual(f.requests.slice(3).map(request => request.url.searchParams.get("api")), ["mtop.user.getUserSimple", COUNT_API, API]);
        const cache = f.memory.get(core.CW_STORE);
        assert.equal(cache.accountSessionHash, auth.cwSessionHash(core.cwCookieMap(cache.cookie)));
        assert.equal(cache.accountCheckedAt, saved(f).accountCheckedAt);
    }
});

test("native AUTH 终止写入 noop 时缓存 unsupported 阻止重复试探，新 capture 创建新代次恢复", async () => {
    const f = fixture([identityResponse(undefined, {userNumId: undefined})]); captureNative(f);
    const generation = saved(f).generation, write = f.ctx.storage.setJSON;
    f.ctx.storage.setJSON = (key, value) => {if (key !== core.CW_AUTH_STORE) write(key, value);};
    const first = await load(f); assert.equal(first.status, "setup"); assert.equal(first.setupTitle, "App 接入未确认"); assert.match(first.message, /写入失败/);
    assert.equal(saved(f).status, "pending"); assert.equal(saved(f).accountCheckedAt, null);
    const terminal = f.memory.get(core.CW_STORE);
    assert.equal(terminal.terminalStatus, "unsupported"); assert.equal(terminal.source, "auto");
    assert.equal(terminal.owner, saved(f).owner); assert.equal(terminal.inputHash, saved(f).inputHash); assert.equal(terminal.generation, generation);
    assert.notEqual((await load(f)).status, "ready"); assert.equal(f.requests.length, 1);
    assert(!JSON.stringify(auth.diagnoseCainiaoConnection(f.ctx, f.clock)).includes("个人列表查询已确认"));
    f.ctx.storage.setJSON = write; f.advance(1000); captureNative(f);
    assert.notEqual(saved(f).generation, generation); assert.equal(saved(f).status, "pending");
    assert.notEqual(f.memory.get(core.CW_STORE).terminalStatus, "unsupported");
    f.replies.push(identityResponse(), countResponse(), nativePds([]));
    assert.equal((await load(f)).status, "ready"); assert.equal(saved(f).status, "connected"); assert.equal(f.requests.length, 4);
});

test("native 首次 AUTH 拒绝、verify 或 invalid 写入 noop 时本机缓存仍终止请求，重捕获才能解除", async () => {
    for (const [terminalStatus, reply] of [
        ["unsupported", response({ret: ["FAIL_SYS_SESSION_EXPIRED::过期"]})],
        ["verify", response({ret: ["FAIL_SYS_USER_VALIDATE::验证"]})],
        ["invalid", identityResponse(OTHER_UID)],
    ]) {
        const f = fixture([reply]); captureNative(f); const generation = saved(f).generation, write = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {if (key !== core.CW_AUTH_STORE) write(key, value);};
        const first = await load(f); assert.notEqual(first.status, "ready"); assert.match(first.message, /写入失败/);
        assert.equal(f.memory.get(core.CW_STORE).terminalStatus, terminalStatus); assert.equal(saved(f).status, "pending");
        await load(f); assert.equal(f.requests.length, 1);
        f.ctx.storage.setJSON = write; f.advance(1000); captureNative(f);
        assert.notEqual(saved(f).generation, generation); assert.equal(saved(f).status, "pending");
        f.replies.push(identityResponse(), countResponse(), nativePds([])); assert.equal((await load(f)).status, "ready");
    }
});

test("native AUTH 与缓存都静默写入失败时本轮必须提示，不伪造可持久阻止重试", async () => {
    const f = fixture([identityResponse(undefined, {userNumId: undefined})]); captureNative(f);
    f.ctx.storage.setJSON = () => {};
    const model = await load(f); assert.notEqual(model.status, "ready"); assert.match(model.message, /写入失败/);
    assert.notEqual(saved(f).status, "connected"); assert.equal(saved(f).accountCheckedAt, null);
});
