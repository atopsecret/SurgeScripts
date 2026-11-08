// 引擎：Egern 原生请求捕获 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：模块自动捕获；离线 node --test cainiao-widget/tests/auth.test.cjs
// 依赖：core.mjs；只读请求头，原样放行，不发送网络请求
import {CW_VERSION, CW_STORE, CW_AUTH_STORE, CW_CAPTURE_STORE, CW_SELF_HEADER, cwObject, cwCookieMap, cwCookieHeader, cwOwner, md5} from "./core.mjs";

const CW_CAPTURE_PATTERN = /^https:\/\/(h5api\.m\.taobao\.com|acs\.m\.taobao\.com)(?::443)?\/h5\/mtop(?:\.[A-Za-z0-9_-]+)+\/[0-9]+(?:\.[0-9]+)*\/?(?:\?[^#\r\n]*)?$/i;
const CW_AUTH_NAMES = new Set(["unb", "cookie2", "sgcookie", "munb", "_m_h5_tk", "_m_h5_tk_enc", "_tb_token_"]);
const CW_AUTH_STATUSES = new Set(["pending", "connected", "expired", "verify", "invalid"]);
const CW_CAPTURE_RESULTS = {
    saved: "已保存登录态，等待个人列表查询确认",
    unchanged: "登录态未变化，保留当前状态",
    anonymous: "本次请求没有账号登录态，未覆盖已有凭据",
    invalid: "本次请求头无效，未保存凭据",
    storage: "本机存储未确认保存，请检查 Egern 后重开查件页",
    superseded: "已有更新的捕获结果，未回写旧凭据",
};

export function cwConnectionMode(env = {}) {
    const mode = env.CONNECTION_MODE || "auto";
    return ["auto", "manual", "off"].includes(mode) ? mode : "invalid";
}

export function cwCaptureURL(value) {
    if (typeof value !== "string" || value.length > 65536 || /[\x00-\x20\x7f]/.test(value)) return "";
    return CW_CAPTURE_PATTERN.exec(value)?.[1].toLowerCase() || "";
}

export function cwHeaderValues(headers, name) {
    if (!headers) return [];
    const values = typeof headers.getAll === "function" ? headers.getAll(name)
        : typeof headers.get === "function" ? [headers.get(name)].filter(value => value !== null) : [];
    if (!Array.isArray(values) || values.some(value => typeof value !== "string")) throw new Error("header-format");
    return values;
}

export function cwCapturedCookies(headers) {
    const values = cwHeaderValues(headers, "cookie");
    if (values.length > 8 || values.reduce((size, value) => size + value.length + 2, 0) > 32768) throw new Error("cookie-format");
    // 分开解析和检测多头重名，不能使用 Headers.get() 的逗号合并结果。
    const cookies = new Map();
    for (const value of values) {
        for (const [name, item] of cwCookieMap(value)) {
            if (cookies.has(name) && cookies.get(name) !== item) throw new Error("cookie-duplicate");
            cookies.set(name, item);
        }
    }
    return cwAuthCookies(cookies);
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

export function cwAuthState(value, now = Date.now()) {
    if (!cwObject(value) || value.version !== CW_VERSION || !CW_AUTH_STATUSES.has(value.status)
        || !/^[0-9a-f]{32}$/.test(value.generation || "")
        || !Number.isFinite(value.capturedAt) || value.capturedAt <= 0 || value.capturedAt > now + 60000
        || !(value.confirmedAt === null || Number.isFinite(value.confirmedAt) && value.confirmedAt > 0 && value.confirmedAt <= now + 60000)
        || value.status === "connected" && value.confirmedAt === null
        || !["h5api.m.taobao.com", "acs.m.taobao.com"].includes(value.sourceHost)) return null;
    let cookies;
    try { cookies = cwCookieMap(value.cookie); } catch { return null; }
    if (!cwLoginCandidate(cookies) || [...cookies.keys()].some(name => !CW_AUTH_NAMES.has(name))
        || value.cookie !== cwCookieHeader(cookies) || value.owner !== cwOwner(cookies)
        || value.sessionHash !== cwSessionHash(cookies) || value.inputHash !== md5(value.cookie)) return null;
    return {version: value.version, owner: value.owner, sessionHash: value.sessionHash, generation: value.generation,
        inputHash: value.inputHash, cookie: value.cookie, status: value.status,
        capturedAt: value.capturedAt, confirmedAt: value.confirmedAt, sourceHost: value.sourceHost};
}

export function cwReadAuth(ctx, now = Date.now()) {
    const value = ctx.storage.getJSON(CW_AUTH_STORE);
    if (value === null || value === undefined) return null;
    const state = cwAuthState(value, now);
    if (!state) throw new Error("auth-format");
    return state;
}

export function cwSameAuth(a, b) {
    return !!a && !!b && a.owner === b.owner && a.generation === b.generation && a.inputHash === b.inputHash;
}

export function cwWriteAuth(ctx, state, now = Date.now()) {
    ctx.storage.setJSON(CW_AUTH_STORE, state);
    const saved = cwReadAuth(ctx, now);
    return cwSameAuth(saved, state) && saved.cookie === state.cookie && saved.status === state.status
        && saved.capturedAt === state.capturedAt && saved.confirmedAt === state.confirmedAt;
}

export function cwClearLocal(ctx) {
    // off 模式只清本组件键，不改系统代理、CA 或其他模块。
    ctx.storage.setJSON(CW_AUTH_STORE, null);
    ctx.storage.setJSON(CW_STORE, null);
    ctx.storage.setJSON(CW_CAPTURE_STORE, null);
    if (ctx.storage.getJSON(CW_AUTH_STORE) !== null || ctx.storage.getJSON(CW_STORE) !== null
        || ctx.storage.getJSON(CW_CAPTURE_STORE) !== null) throw new Error("storage-not-confirmed");
}

function cwCaptureResult(ctx, code, now) {
    if (!Object.hasOwn(CW_CAPTURE_RESULTS, code)) return;
    try {
        const previous = ctx.storage.getJSON(CW_CAPTURE_STORE);
        if (cwObject(previous) && previous.code === code && Number.isFinite(previous.at)
            && now >= previous.at && now - previous.at < 30000) return;
        ctx.storage.setJSON(CW_CAPTURE_STORE, {version: CW_VERSION, code, at: now});
    } catch {
        // 完全无法写入时仍有不含 Cookie、账号、URL 或异常原文的固定提示。
        console.log("[菜鸟连接] 本机捕获状态无法保存，请检查 Egern 存储。");
    }
}

export function captureCainiaoCredentials(ctx, clock = () => Date.now()) {
    if (cwConnectionMode(ctx.env) !== "auto" || !ctx.request) return;
    const sourceHost = cwCaptureURL(ctx.request.url);
    if (!sourceHost) return;
    const now = clock();
    let cookies;
    try {
        if (cwHeaderValues(ctx.request.headers, CW_SELF_HEADER).length) return;
        cookies = cwCapturedCookies(ctx.request.headers);
    } catch { cwCaptureResult(ctx, "invalid", now); return; }
    if (!cwLoginCandidate(cookies)) { cwCaptureResult(ctx, "anonymous", now); return; }
    let previous;
    try {
        const raw = ctx.storage.getJSON(CW_AUTH_STORE);
        // 有效新请求可修复损坏的 JSON；读取 API 抛错则停止，不猜旧状态。
        previous = cwAuthState(raw, now);
        const cached = ctx.storage.getJSON(CW_STORE), owner = cwOwner(cookies);
        if (previous && previous.owner !== owner || cwObject(cached) && cached.owner !== owner) {
            // 新候选可能写入失败；屏障保留目标账号，防止之后重新查询已知旧账号。
            const barrier = {version: CW_VERSION, owner, source: "capture", blocked: true, cookie: "", snapshot: null};
            ctx.storage.setJSON(CW_STORE, barrier);
            const saved = ctx.storage.getJSON(CW_STORE);
            if (!cwObject(saved) || saved.owner !== owner || saved.blocked !== true
                || saved.source !== "capture" || saved.snapshot !== null || saved.cookie !== "") throw new Error("cache-not-isolated");
        }
    } catch { cwCaptureResult(ctx, "storage", now); return; }
    const cookie = cwCookieHeader(cookies), inputHash = md5(cookie), sessionHash = cwSessionHash(cookies);
    const active = previous && ["pending", "connected"].includes(previous.status);
    const sameSession = active && previous.sessionHash === sessionHash;
    if (sameSession && previous.inputHash === inputHash) { cwCaptureResult(ctx, "unchanged", now); return; }
    const state = {version: CW_VERSION, owner: cwOwner(cookies), sessionHash, inputHash, cookie,
        generation: sameSession ? previous.generation : md5(now + ":" + Math.random() + ":" + Math.random()),
        status: sameSession ? previous.status : "pending", capturedAt: now,
        confirmedAt: sameSession ? previous.confirmedAt : null, sourceHost};
    try {
        if (!cwWriteAuth(ctx, state, now)) {
            const latest = cwReadAuth(ctx, now);
            cwCaptureResult(ctx, latest && latest.capturedAt >= now && !cwSameAuth(latest, previous) ? "superseded" : "storage", now);
            return;
        }
    } catch { cwCaptureResult(ctx, "storage", now); return; }
    cwCaptureResult(ctx, "saved", now);
}

export function diagnoseCainiaoConnection(ctx, clock = () => Date.now()) {
    const now = clock(), lines = ["菜鸟连接诊断 " + CW_VERSION, "连接模式：" + cwConnectionMode(ctx.env)];
    const labels = {pending: "已捕获，尚未通过个人列表验证", connected: "个人列表查询已确认", expired: "登录过期，请重开手机查件页", verify: "需在官方页面完成验证", invalid: "身份失效，请重开手机查件页"};
    try {
        const auth = cwReadAuth(ctx, now);
        const cached = ctx.storage.getJSON(CW_STORE);
        const blocked = cwObject(cached) && cached.blocked === true && (!auth || cached.owner !== auth.owner);
        lines.push("自动登录态：" + (blocked ? "新账号尚未保存，旧登录态已阻断" : (auth ? labels[auth.status] : "尚未捕获")));
        if (auth) lines.push("捕获时间：" + new Date(auth.capturedAt).toISOString());
        const result = ctx.storage.getJSON(CW_CAPTURE_STORE);
        if (cwObject(result) && Object.hasOwn(CW_CAPTURE_RESULTS, result.code)) lines.push("最近捕获：" + CW_CAPTURE_RESULTS[result.code]);
    } catch { lines.push("本机存储无法读取，请检查 Egern 后重新打开查件页。"); }
    lines.push("此诊断只读本机状态，不发送个人查询，不显示凭据。");
    return {type: "widget", padding: 12, children: [{type: "text", text: lines.join("\n")}]};
}
