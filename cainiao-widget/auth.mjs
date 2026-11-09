// 引擎：Egern 原生请求捕获 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：模块自动捕获；离线 node --test cainiao-widget/tests/auth.test.cjs
// 依赖：core.mjs；只读请求头，原样放行，不发送网络请求
import {CW_VERSION, CW_STORE, CW_AUTH_STORE, CW_CAPTURE_STORE, CW_APP_STORE, CW_RESPONSE_STORE, CW_TRANSPORT_STORE, CW_OFFICIAL_STORE, CW_SELF_HEADER, cwObject, cwKnownVersion, cwCookieMap, cwCookieHeader, cwOwner, md5} from "./core.mjs";
import {CW_APP_HOSTS, cwAppRoute, cwAppHeaderValues, cwAppNativeFields, cwObserveApp, cwAppSummary} from "./app.mjs";

const CW_AUTH_NAMES = new Set(["unb", "cookie2", "sgcookie", "munb", "_m_h5_tk", "_m_h5_tk_enc", "_tb_token_"]);
const CW_AUTH_STATUSES = new Set(["pending", "connected", "expired", "verify", "invalid", "unsupported"]);
const CW_AUTH_TERMINAL_STATUSES = new Set(["expired", "verify", "invalid", "unsupported"]);
const CW_QUERY_FAILURES = new Set(["TOKEN_NOT_ISSUED", "TOKEN_RETRY_EXHAUSTED", "AUTH_REJECTED", "ILLEGAL_ACCESS", "SESSION_MISSING",
    "SESSION_UNSTABLE", "IDENTITY_UNVERIFIED", "ACCOUNT_MISMATCH", "API_MISMATCH", "SCHEMA_INVALID", "VERIFY_REQUIRED", "OFFLINE",
    "DEADLINE", "PARTIAL", "STORAGE_UNCONFIRMED", "NONE", "UNKNOWN"]);
const CW_QUERY_RET_CODES = new Set(["SUCCESS", "FAIL_SYS_TOKEN_EMPTY", "FAIL_SYS_TOKEN_EXPIRED", "FAIL_SYS_TOKEN_EXOIRED",
    "FAIL_SYS_SESSION_EXPIRED", "FAIL_SYS_SESSION_MISSING", "FAIL_SYS_LOGIN_REQUIRED", "FAIL_SYS_USER_NOT_LOGIN", "FAIL_SYS_AUTH_REJECT",
    "FAIL_SYS_ILLEGAL_ACCESS", "FAIL_SYS_USER_VALIDATE", "FAIL_SYS_ACCESS_DENIED", "FAIL_SYS_TRAFFIC_LIMIT", "FAIL_SYS_FLOW_LIMIT",
    "FAIL_SYS_RGV587_ERROR", "FAIL_SYS_API_NOT_FOUND", "FAIL_SYS_SERVICE_NOT_EXIST", "FAIL_SYS_PARAM_MISSING", "NONE", "OTHER"]);
const CW_QUERY_HTTP_CLASSES = new Set(["HTTP_200", "HTTP_401", "HTTP_403", "HTTP_429", "HTTP_3XX", "HTTP_5XX", "HTTP_OTHER", "NONE"]);
const CW_QUERY_WINDOW = 7 * 86400000;
const CW_CAPTURE_RESULTS = {
    saved: "已保存 App 会话候选，等待个人列表查询确认",
    unchanged: "登录态未变化，保留当前状态",
    anonymous: "已看到 App 请求，但本次没有完整可复用会话",
    invalid: "本次请求头无效，未保存凭据",
    conflict: "App 账号字段冲突，旧登录态与快照已隔离",
    storage: "本机存储未确认保存，请检查 Egern 后重开 App 快递列表",
    superseded: "已有更新的捕获结果，未回写旧凭据",
};

export function cwConnectionMode(env = {}) {
    const mode = env.CONNECTION_MODE || "auto";
    return ["auto", "manual", "off"].includes(mode) ? mode : "invalid";
}

export function cwCaptureURL(value) {
    return cwAppRoute(value)?.host || "";
}

export function cwHeaderValues(headers, name) {
    return cwAppHeaderValues(headers, name);
}

export function cwCapturedCookies(headers) {
    const values = cwHeaderValues(headers, "cookie");
    if (values.length > 8 || values.reduce((size, value) => size + value.length + 2, 0) > 32768) throw new Error("cookie-format");
    // 分开解析和检测多头重名，不能使用 Headers.get() 的逗号合并结果。
    const cookies = new Map();
    for (const value of values) {
        for (const [name, item] of cwCookieMap(value, true)) {
            if (cookies.has(name) && cookies.get(name) !== item) throw new Error("cookie-duplicate");
            cookies.set(name, item);
        }
    }
    return cwAuthCookies(new Map([...cookies].filter(([, value]) => value)));
}

export function cwAuthCookies(cookies) {
    return new Map([...cookies].filter(([name]) => CW_AUTH_NAMES.has(name)));
}

export function cwLoginCandidate(cookies) {
    return /^[A-Za-z0-9_-]{1,128}$/.test(cookies.get("unb") || "") && (cookies.has("cookie2") || cookies.has("sgcookie"));
}

export function cwSessionHash(cookies) {
    return md5("capture-session:" + ["unb", "cookie2", "sgcookie", "munb"].map(name => name + "=" + (cookies.get(name) || "")).join(";"));
}

export function cwRequiresIdentity(state) {
    return !!state && ["native_session_candidate", "request_cookie_candidate", "response_cookie_candidate"].includes(state.captureKind);
}

export function cwAuthState(value, now = Date.now()) {
    const legacy = cwObject(value) && value.version === "1.1.0";
    if (!cwObject(value) || !cwKnownVersion(value.version) || !CW_AUTH_STATUSES.has(value.status)
        || typeof value.generation !== "string" || !/^[0-9a-f]{32}$/.test(value.generation)
        || !Number.isFinite(value.capturedAt) || value.capturedAt <= 0 || value.capturedAt > now + 60000
        || !(value.confirmedAt === null || Number.isFinite(value.confirmedAt) && value.confirmedAt > 0 && value.confirmedAt <= now + 60000)
        || value.status === "connected" && value.confirmedAt === null
        || !(legacy ? ["h5api.m.taobao.com", "acs.m.taobao.com"] : CW_APP_HOSTS).includes(value.sourceHost)
        || legacy && value.status === "unsupported") return null;
    const captureKind = legacy ? "request_cookie" : value.captureKind;
    const sourceChannel = legacy ? "h5" : value.sourceChannel;
    const accountCheckedAt = legacy ? null : value.accountCheckedAt;
    const accountSessionHash = legacy ? "" : value.accountSessionHash;
    const restricted = cwRequiresIdentity({captureKind});
    if (!["request_cookie", "native_session_candidate", "request_cookie_candidate", "response_cookie_candidate"].includes(captureKind)
        || captureKind === "response_cookie_candidate" && !["1.2.3", "1.2.4", "1.3.0", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", CW_VERSION].includes(value.version)
        || value.version === "1.2.0" && captureKind === "request_cookie_candidate" || !["h5", "gw"].includes(sourceChannel)
        || !(accountCheckedAt === null || Number.isFinite(accountCheckedAt) && accountCheckedAt > 0 && accountCheckedAt <= now + 60000)
        || typeof accountSessionHash !== "string" || accountSessionHash !== "" && !/^[0-9a-f]{32}$/.test(accountSessionHash)
        || (accountCheckedAt === null) !== (accountSessionHash === "")
        || restricted && (captureKind !== "response_cookie_candidate" && sourceChannel !== "gw" || value.status === "connected"
            && (accountCheckedAt === null || accountCheckedAt > value.confirmedAt))
        || captureKind === "request_cookie" && (accountCheckedAt !== null || value.status === "unsupported")) return null;
    let cookies;
    try { cookies = cwCookieMap(value.cookie); } catch { return null; }
    if (!cwLoginCandidate(cookies) || [...cookies.keys()].some(name => !CW_AUTH_NAMES.has(name))
        || value.cookie !== cwCookieHeader(cookies) || value.owner !== cwOwner(cookies)
        || value.sessionHash !== cwSessionHash(cookies) || value.inputHash !== md5(value.cookie)
        || restricted && !/^[1-9][0-9]{0,19}$/.test(cookies.get("unb") || "")
        || captureKind === "native_session_candidate" && (!/^[A-Za-z0-9._~%+/=-]{8,8192}$/.test(cookies.get("cookie2") || "")
            || [...cookies.keys()].some(name => !["unb", "cookie2"].includes(name)))) return null;
    return {version: CW_VERSION, owner: value.owner, sessionHash: value.sessionHash, generation: value.generation,
        inputHash: value.inputHash, cookie: value.cookie, status: value.status,
        capturedAt: value.capturedAt, confirmedAt: value.confirmedAt, sourceHost: value.sourceHost,
        captureKind, sourceChannel, accountCheckedAt, accountSessionHash};
}

export function cwCachedAuthStatus(cached, auth) {
    return cwObject(cached) && auth && cwKnownVersion(cached.version) && cached.source === "auto"
        && cached.owner === auth.owner && cached.generation === auth.generation && cached.inputHash === auth.inputHash
        && CW_AUTH_TERMINAL_STATUSES.has(cached.terminalStatus) ? cached.terminalStatus : "";
}

export function cwQueryRetCode(body) {
    if (!cwObject(body) || !Array.isArray(body.ret) || !body.ret.length) return "NONE";
    // 只输出固定前缀；未知值和 :: 后的服务端文本均不进入报告。
    const codes = body.ret.map(value => typeof value === "string" ? value.split("::", 1)[0].toUpperCase() : "OTHER");
    const code = codes.find(value => value !== "SUCCESS") || "SUCCESS";
    return CW_QUERY_RET_CODES.has(code) && !["NONE", "OTHER"].includes(code) ? code : "OTHER";
}

export function cwQueryFields(record, now = Date.now()) {
    if (!cwObject(record) || record.schema !== 1 || !["initial", "refresh", "revalidate"].includes(record.phase)
        || !["identity", "count", "pds"].includes(record.stage) || !CW_QUERY_FAILURES.has(record.failure)
        || !CW_QUERY_RET_CODES.has(record.retCode) || !CW_QUERY_HTTP_CLASSES.has(record.httpClass)
        || typeof record.tokenPresentBefore !== "boolean" || typeof record.tokenUpdated !== "boolean"
        || !Number.isInteger(record.sessionAttempt) || record.sessionAttempt < 1 || record.sessionAttempt > 3
        || !Number.isInteger(record.tokenAttempt) || record.tokenAttempt < 1 || record.tokenAttempt > 3
        || !(record.stage === "pds" ? Number.isInteger(record.page) && record.page >= 1 && record.page <= 20 : record.page === null)
        || !Number.isSafeInteger(now) || !Number.isSafeInteger(record.at) || record.at <= 0 || record.at > now + 60000
        || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= record.at || record.expiresAt - record.at > CW_QUERY_WINDOW
        || now >= record.expiresAt) return null;
    const {schema, phase, stage, failure, retCode, httpClass, tokenPresentBefore, tokenUpdated, sessionAttempt, tokenAttempt, page, at, expiresAt} = record;
    return {schema, phase, stage, failure, retCode, httpClass, tokenPresentBefore, tokenUpdated, sessionAttempt, tokenAttempt, page, at, expiresAt};
}

export function cwQueryDiagnostic(cached, auth, now = Date.now()) {
    const checked = cwAuthState(auth, now);
    return checked && cwObject(cached) && ["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.3.0", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", CW_VERSION].includes(cached.version) && cached.source === "auto" && cached.blocked !== true
        && cached.owner === checked.owner && cached.inputHash === checked.inputHash && cached.generation === checked.generation
        && typeof cached.runId === "string" && /^[0-9a-f]{32}$/.test(cached.runId) ? cwQueryFields(cached.queryDiagnostic, now) : null;
}

export function cwReadAuth(ctx, now = Date.now()) {
    const value = ctx.storage.getJSON(CW_AUTH_STORE);
    if (value === null || value === undefined) return null;
    const state = cwAuthState(value, now);
    if (!state) throw new Error("auth-format");
    return state;
}

export function cwSameAuth(a, b) {
    return !!a && !!b && a.owner === b.owner && a.generation === b.generation && a.inputHash === b.inputHash && a.captureKind === b.captureKind;
}

export function cwWriteAuth(ctx, state, now = Date.now()) {
    if (!cwAuthState(state, now) || state.version !== CW_VERSION) return false;
    ctx.storage.setJSON(CW_AUTH_STORE, state);
    if (ctx.storage.getJSON(CW_AUTH_STORE)?.version !== CW_VERSION) return false;
    const saved = cwReadAuth(ctx, now);
    return cwSameAuth(saved, state) && saved.cookie === state.cookie && saved.status === state.status
        && saved.capturedAt === state.capturedAt && saved.confirmedAt === state.confirmedAt
        && saved.sourceHost === state.sourceHost && saved.sourceChannel === state.sourceChannel && saved.accountCheckedAt === state.accountCheckedAt
        && saved.accountSessionHash === state.accountSessionHash;
}

export function cwClearLocal(ctx) {
    // off 模式只清本组件键，不改系统代理、CA 或其他模块。
    const keys = [CW_AUTH_STORE, CW_STORE, CW_CAPTURE_STORE, CW_APP_STORE, CW_RESPONSE_STORE, CW_TRANSPORT_STORE, CW_OFFICIAL_STORE];
    for (const key of keys) ctx.storage.setJSON(key, null);
    if (keys.some(key => ctx.storage.getJSON(key) !== null)) throw new Error("storage-not-confirmed");
}

function cwCaptureResult(ctx, code, now) {
    if (!Object.hasOwn(CW_CAPTURE_RESULTS, code)) return;
    try {
        const previous = ctx.storage.getJSON(CW_CAPTURE_STORE);
        if (cwObject(previous) && previous.version === CW_VERSION && previous.code === code && Number.isFinite(previous.at)
            && now >= previous.at && now - previous.at < 30000) return;
        ctx.storage.setJSON(CW_CAPTURE_STORE, {version: CW_VERSION, code, at: now});
    } catch {
        // 完全无法写入时仍有不含 Cookie、账号、URL 或异常原文的固定提示。
        console.log("[菜鸟连接] 本机捕获状态无法保存，请检查 Egern 存储。");
    }
}

function cwIsolateAccount(ctx, owner) {
    const barrier = {version: CW_VERSION, owner, source: "capture", blocked: true, cookie: "", snapshot: null};
    ctx.storage.setJSON(CW_STORE, barrier);
    const saved = ctx.storage.getJSON(CW_STORE);
    if (!cwObject(saved) || saved.owner !== owner || saved.blocked !== true
        || saved.source !== "capture" || saved.snapshot !== null || saved.cookie !== "") throw new Error("cache-not-isolated");
}

function cwOfficialOwnsCapture(ctx) {
    // 新路径存在即独占会话写入；损坏或终止的状态也不能借旧 H5 撤回账号屏障。
    const state = ctx.storage.getJSON(CW_OFFICIAL_STORE);
    if (state !== null && state !== undefined) return true;
    const barrier = ctx.storage.getJSON(CW_STORE);
    return cwObject(barrier) && barrier.blocked === true && barrier.officialBinding === "bearer";
}

export function captureCainiaoCredentials(ctx, clock = () => Date.now()) {
    if (cwConnectionMode(ctx.env) !== "auto" || !ctx.request || ctx.response) return;
    const route = cwAppRoute(ctx.request.url, ctx.request.headers);
    if (!route) return;
    const now = clock();
    if (!Number.isSafeInteger(now) || now <= 0) return;
    let observedCookies, native;
    try {
        if (cwHeaderValues(ctx.request.headers, CW_SELF_HEADER).length) return;
        observedCookies = cwCapturedCookies(ctx.request.headers);
        native = cwAppNativeFields(ctx.request.headers);
    } catch { cwCaptureResult(ctx, "invalid", now); return; }
    const observe = () => {
        try { cwObserveApp(ctx, route, observedCookies, native, now); }
        catch { console.log("[菜鸟连接] App 请求状态无法保存，未记录敏感内容。"); }
    };
    try {
        if (cwOfficialOwnsCapture(ctx)) { observe(); cwCaptureResult(ctx, "unchanged", now); return; }
    } catch { cwCaptureResult(ctx, "storage", now); return; }
    if (observedCookies.get("unb") && native.uid && observedCookies.get("unb") !== native.uid) {
        try { cwIsolateAccount(ctx, md5("capture-conflicting-identities")); }
        catch { cwCaptureResult(ctx, "storage", now); return; }
        observe(); cwCaptureResult(ctx, "conflict", now); return;
    }
    // 公共时间不是新的接入来源；完整 Cookie 也不能替换候选或撤销另一账号屏障。
    // 明确同次身份冲突仍由上方隔离，正常非公共采集沿用原流程。
    if (["public_time", "logout"].includes(route.apiKind)) { observe(); cwCaptureResult(ctx, "anonymous", now); return; }
    const fromCookie = cwLoginCandidate(observedCookies);
    const hasSessionCookie = observedCookies.has("cookie2") || observedCookies.has("sgcookie");
    const candidateRoute = route.channel === "gw";
    const fromCookieCandidate = !fromCookie && !observedCookies.has("unb") && hasSessionCookie && candidateRoute && native.uid;
    const fromNative = !fromCookie && !hasSessionCookie && candidateRoute && native.uid && native.sid;
    if (!fromCookie && !fromCookieCandidate && !fromNative) { observe(); cwCaptureResult(ctx, "anonymous", now); return; }
    const captureKind = fromCookie ? "request_cookie" : fromCookieCandidate ? "request_cookie_candidate" : "native_session_candidate";
    // 真实会话只补同次 UID，不以 SID 替换 cookie2，也不借其它请求或旧缓存。
    const cookies = fromCookie ? observedCookies : fromCookieCandidate ? new Map([...observedCookies, ["unb", native.uid]])
        : new Map([["unb", native.uid], ["cookie2", native.sid]]);
    const owner = cwOwner(cookies), cookie = cwCookieHeader(cookies), inputHash = md5(cookie), sessionHash = cwSessionHash(cookies);
    let previous, cached, cachedTerminal = "";
    try {
        const raw = ctx.storage.getJSON(CW_AUTH_STORE);
        // 有效新请求可修复损坏的 JSON；读取 API 抛错则停止，不猜旧状态。
        previous = cwAuthState(raw, now);
        cached = ctx.storage.getJSON(CW_STORE);
        cachedTerminal = cwCachedAuthStatus(cached, previous);
    } catch { cwCaptureResult(ctx, "storage", now); return; }
    const active = previous && !cachedTerminal && ["pending", "connected"].includes(previous.status);
    const sameSession = active && previous.sessionHash === sessionHash && previous.captureKind === captureKind;
    if (previous && previous.owner === owner && (fromNative && ["request_cookie", "request_cookie_candidate", "response_cookie_candidate"].includes(previous.captureKind)
        || !fromCookie && previous.captureKind === "response_cookie_candidate"
        || active && (fromNative && previous.status === "connected" || !fromCookie && previous.captureKind === "request_cookie"))) {
        observe(); cwCaptureResult(ctx, "unchanged", now); return;
    }
    // 弱流量已在上方拒绝，不能用它改回另一个账号保存失败时留下的屏障。
    try {
        if (previous && previous.owner !== owner || cwObject(cached) && cached.owner !== owner) cwIsolateAccount(ctx, owner);
    } catch { cwCaptureResult(ctx, "storage", now); return; }
    if (sameSession && previous.inputHash === inputHash && previous.captureKind === captureKind) {
        observe(); cwCaptureResult(ctx, "unchanged", now); return;
    }
    if (!fromCookie && !sameSession) {
        // 新受限候选即便账号相同也须隔离旧 token 与旧码；同类型 token 更新保留代次。
        try { cwIsolateAccount(ctx, owner); }
        catch { cwCaptureResult(ctx, "storage", now); return; }
    }
    const state = {version: CW_VERSION, owner, sessionHash, inputHash, cookie,
        generation: sameSession ? previous.generation : md5(now + ":" + Math.random() + ":" + Math.random()),
        status: sameSession ? previous.status : "pending", capturedAt: now,
        confirmedAt: sameSession ? previous.confirmedAt : null, sourceHost: route.host, sourceChannel: route.channel,
        captureKind, accountCheckedAt: cwRequiresIdentity({captureKind}) && sameSession ? previous.accountCheckedAt : null,
        accountSessionHash: cwRequiresIdentity({captureKind}) && sameSession ? previous.accountSessionHash : ""};
    try {
        if (!cwWriteAuth(ctx, state, now)) {
            const latest = cwReadAuth(ctx, now);
            cwCaptureResult(ctx, latest && latest.capturedAt >= now && !cwSameAuth(latest, previous) ? "superseded" : "storage", now);
            return;
        }
    } catch { cwCaptureResult(ctx, "storage", now); return; }
    observe();
    cwCaptureResult(ctx, "saved", now);
}

// 仅消费同次实际响应的已过滤 Cookie；来源和身份仍在这里二次核对。
export function captureCainiaoResponseCandidate(ctx, candidate, clock = () => Date.now()) {
    const now = clock();
    const finish = code => { cwCaptureResult(ctx, code, now); return code; };
    if (cwConnectionMode(ctx.env) !== "auto" || !ctx.request || !ctx.response
        || !Number.isSafeInteger(now) || now <= 0) return "invalid";
    const route = cwAppRoute(ctx.request.url, ctx.request.headers);
    if (!route || !cwObject(candidate) || !cwObject(candidate.route)
        || ["host", "channel", "apiKind"].some(key => candidate.route[key] !== route[key])
        || ctx.response.status !== 200 || ["public_time", "logout"].includes(route.apiKind)) return "invalid";
    try {
        if (cwOfficialOwnsCapture(ctx)) return finish("unchanged");
    } catch { return finish("storage"); }
    let cookies, requestCookies, requestUids;
    try {
        if (cwHeaderValues(ctx.request.headers, CW_SELF_HEADER).length) return "invalid";
        if (!(candidate.cookies instanceof Map) || candidate.cookies.size > CW_AUTH_NAMES.size
            || [...candidate.cookies].some(([name, value]) => !CW_AUTH_NAMES.has(name) || typeof value !== "string" || !value)) return finish("invalid");
        cookies = cwCookieMap(cwCookieHeader(candidate.cookies));
        if (!/^[1-9][0-9]{0,19}$/.test(cookies.get("unb") || "") || !cwLoginCandidate(cookies)) return finish("anonymous");
        requestCookies = cwCapturedCookies(ctx.request.headers);
        requestUids = cwHeaderValues(ctx.request.headers, "x-uid").map(value => value.trim()).filter(Boolean);
        if (requestUids.some(value => !/^[1-9][0-9]{0,19}$/.test(value))) return finish("invalid");
        if (requestCookies.get("unb") && !/^[1-9][0-9]{0,19}$/.test(requestCookies.get("unb"))) return finish("invalid");
    } catch { return finish("invalid"); }
    const identities = [cookies.get("unb"), requestCookies.get("unb"), ...requestUids].filter(Boolean);
    if (identities.some(value => value !== identities[0])) {
        try { cwIsolateAccount(ctx, md5("capture-conflicting-identities")); }
        catch { return finish("storage"); }
        return finish("conflict");
    }
    const owner = cwOwner(cookies), cookie = cwCookieHeader(cookies), inputHash = md5(cookie), sessionHash = cwSessionHash(cookies);
    let previous, cached, cachedTerminal;
    try {
        previous = cwAuthState(ctx.storage.getJSON(CW_AUTH_STORE), now);
        cached = ctx.storage.getJSON(CW_STORE);
        cachedTerminal = cwCachedAuthStatus(cached, previous);
    } catch { return finish("storage"); }
    const active = previous && !cachedTerminal && ["pending", "connected"].includes(previous.status);
    const sameResponseSession = previous && previous.captureKind === "response_cookie_candidate" && previous.sessionHash === sessionHash;
    // 新账号保存失败后，旧响应的 token 更新不是账号切换证据，不能撤销屏障。
    if (sameResponseSession && cwObject(cached) && cached.blocked === true && cached.owner !== owner) return finish("unchanged");
    // 终止记录绑定稳定响应会话；短期 token 和重复响应不能解除停止状态。
    if (sameResponseSession && (!active || previous.inputHash === inputHash)
        || previous && previous.owner === owner && previous.captureKind === "request_cookie" && active) return finish("unchanged");
    const sameSession = active && sameResponseSession;
    try {
        if (!sameSession || cwObject(cached) && cached.owner !== owner) cwIsolateAccount(ctx, owner);
    } catch { return finish("storage"); }
    const state = {version: CW_VERSION, owner, sessionHash, inputHash, cookie,
        generation: sameSession ? previous.generation : md5(now + ":" + Math.random() + ":" + Math.random()),
        status: sameSession ? previous.status : "pending", capturedAt: now,
        confirmedAt: sameSession ? previous.confirmedAt : null, sourceHost: route.host, sourceChannel: route.channel,
        captureKind: "response_cookie_candidate", accountCheckedAt: sameSession ? previous.accountCheckedAt : null,
        accountSessionHash: sameSession ? previous.accountSessionHash : ""};
    try {
        if (!cwWriteAuth(ctx, state, now)) {
            const latest = cwReadAuth(ctx, now);
            return finish(latest && latest.capturedAt >= now && !cwSameAuth(latest, previous) ? "superseded" : "storage");
        }
    } catch { return finish("storage"); }
    return finish("saved");
}

export function diagnoseCainiaoConnection(ctx, clock = () => Date.now()) {
    const now = clock(), lines = ["菜鸟 App 连接状态 " + CW_VERSION, "连接模式：" + cwConnectionMode(ctx.env)];
    const labels = {pending: "已捕获，尚未通过个人列表验证", connected: "个人列表查询已确认", expired: "小组件会话失效，请重开 App 快递列表",
        verify: "需在淘宝或菜鸟 App 完成验证", invalid: "身份失效，请重开 App 快递列表", unsupported: "App 接入未确认，尚未通过完整个人查询"};
    try {
        const auth = cwReadAuth(ctx, now);
        const cached = ctx.storage.getJSON(CW_STORE);
        const blocked = cwObject(cached) && cached.blocked === true && (!auth || cached.owner !== auth.owner);
        const cachedStatus = cwCachedAuthStatus(cached, auth), recordedStatus = cachedStatus || auth?.status;
        const firstFailure = !!auth && auth.confirmedAt === null && recordedStatus === "expired";
        const status = firstFailure ? "unsupported" : recordedStatus;
        const label = status === "unsupported" && auth?.confirmedAt !== null ? "本次独立查询未确认，已停止重试" : labels[status];
        lines.push("自动登录态：" + (blocked ? "新账号尚未保存，旧登录态已阻断" : (auth ? label : "尚未捕获")));
        if (cachedStatus && auth.status !== cachedStatus) lines.push("登录标志写入未确认；缓存已记录停止状态，新的 App 采集才会重试。");
        if (auth && !blocked) {
            const source = auth.captureKind === "native_session_candidate" ? "App native 候选，兼容性须由个人查询确认"
                : auth.captureKind === "request_cookie_candidate" ? "同次 App 实际 Cookie＋native UID，须验证个人身份"
                : auth.captureKind === "response_cookie_candidate" ? "同次 App 服务端 Cookie 候选，须验证个人身份" : "App 请求 Cookie";
            lines.push("会话来源：" + source);
            lines.push("保存的 Cookie 字段名：" + [...cwCookieMap(auth.cookie).keys()].join("、"));
            lines.push("捕获时间：" + new Date(auth.capturedAt).toISOString());
            if (auth.accountCheckedAt) lines.push("账号检查时间：" + new Date(auth.accountCheckedAt).toISOString());
            const diagnostic = cwQueryDiagnostic(cached, auth, now);
            if (diagnostic) {
                lines.push("个人查询：" + diagnostic.phase + " · " + diagnostic.stage + " · " + diagnostic.failure);
                lines.push("返回分类：" + diagnostic.retCode + " · " + diagnostic.httpClass);
                lines.push("token：请求前" + (diagnostic.tokenPresentBefore ? "存在" : "缺失") + "，本次" + (diagnostic.tokenUpdated ? "已更新" : "未更新"));
                lines.push("验证轮次：" + diagnostic.sessionAttempt + "；token 轮次：" + diagnostic.tokenAttempt
                    + (diagnostic.page === null ? "" : "；页码：" + diagnostic.page));
                lines.push("记录时间：" + new Date(diagnostic.at).toISOString());
            } else if (firstFailure) lines.push("旧版本未记录原因；保持停止状态，未重新请求。");
        }
        const result = ctx.storage.getJSON(CW_CAPTURE_STORE);
        if (cwObject(result) && Object.hasOwn(CW_CAPTURE_RESULTS, result.code)) lines.push("最近捕获：" + CW_CAPTURE_RESULTS[result.code]);
    } catch { lines.push("本机存储无法读取，请检查 Egern 后重新打开 App 快递列表。"); }
    try {
        const app = cwAppSummary(ctx, now);
        lines.push("App 请求：" + (app.observed ? "已观察到" : "尚未观察到目标请求"));
        if (app.observed) lines.push("以下观察字段为窗口内多请求并集，不代表同次会话；实际保存字段见上方。");
        for (const row of app.rows) {
            lines.push(row.host + " · " + row.channel + " · " + row.count + " 次");
            lines.push("字段名：" + ([...row.cookies, ...row.nativeHeaders].join("、") || "未见必要会话字段"));
        }
    } catch { lines.push("App 请求状态无法读取，未显示异常原文。"); }
    lines.push("连接信息不显示凭据、不发送个人查询；发送对照只使用固定测试字段。关闭 App 后的新查询仍需手机验收。");
    return {type: "widget", padding: 12, children: [{type: "text", text: lines.join("\n")}]};
}
