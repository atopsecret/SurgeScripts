// 引擎：Egern 原生 generic 脚本 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：安装 cainiao-widget.egern.yaml 并填写 CAINIAO_COOKIE
// 依赖：core.mjs、render.mjs；发布文件内联，不下载其他代码
import {CW_VERSION, CW_API, CW_PATH, CW_UA, CW_STORE, cwObject, cwCookieMap, cwCookieHeader, cwOwner, cwUpdateCookies, cwRequestURL, cwReturnKind, cwReadPage, cwItems, md5} from "./core.mjs";
import {renderWidget} from "./render.mjs";

class CwFailure extends Error {
    constructor(kind) { super(kind); this.kind = kind; }
}

// 原生文档未承诺浏览器计时器；检测到支持时为 HTTP 与读体增加 Promise 等待上限。
// 无计时器时依赖 ctx.http.timeout 和脚本时限，仍在接受结果前复核预算。
export async function cwBounded(task, deadline, clock) {
    const remaining = deadline - clock();
    if (remaining <= 0) throw new CwFailure("partial");
    let timer;
    try {
        const work = Promise.resolve().then(task);
        let result;
        if (typeof globalThis.setTimeout === "function" && typeof globalThis.clearTimeout === "function") {
            const limit = new Promise((_, reject) => { timer = globalThis.setTimeout(() => reject(new CwFailure("partial")), remaining); });
            result = await Promise.race([work, limit]);
        } else result = await work;
        if (clock() >= deadline) throw new CwFailure("partial");
        return result;
    } finally {
        if (timer !== undefined) globalThis.clearTimeout(timer);
    }
}

function cwSnapshot(value, now) {
    if (!cwObject(value) || !Array.isArray(value.items) || value.items.length > 1000 || !Number.isFinite(Date.parse(value.updatedAt)) || Date.parse(value.updatedAt) > now + 60000) return null;
    if (value.items.some(item => !cwObject(item) || !/^[0-9a-f]{32}$/.test(item.id) || ["code", "station", "company", "tail"].some(k => typeof item[k] !== "string") || typeof item.requiresVerification !== "boolean")) return null;
    return {items: value.items.map(({id, code, station, company, tail, requiresVerification}) => ({id, code, station, company, tail, requiresVerification})), updatedAt: value.updatedAt};
}

function cwFailureMessage(kind, cached) {
    const messages = {
        expired: "登录已过期，请重新扫码",
        verify: "请在淘宝或菜鸟完成验证",
        offline: "暂时连不上，稍后再试",
        partial: "本次未查全，稍后刷新",
        schema: "接口数据有变化，暂未更新",
        account: "账号发生变化，请重新导入",
        error: "查询未成功，稍后再试",
    };
    return (messages[kind] || messages.error) + (cached ? " · 上次结果" : "");
}

export async function loadCainiaoModel(ctx, clock = () => Date.now()) {
    const now = clock(), env = ctx.env || {};
    const requestedInterval = Number(env.REFRESH_MINUTES || 15);
    const refreshMinutes = Number.isFinite(requestedInterval) ? Math.max(5, Math.min(120, Math.floor(requestedInterval))) : 15;
    const base = {items: [], total: 0, updatedAt: null, refreshMinutes,
        privacy: String(ctx.widgetFamily || "").startsWith("accessory") ? env.LOCKSCREEN_SHOW_CODE !== "true" : false};
    let imported;
    try { imported = cwCookieMap(env.CAINIAO_COOKIE || ""); }
    catch { return {...base, status: "setup", message: "登录参数格式有误，请重新粘贴"}; }
    if (!imported.size) {
        // 清空参数即退出本组件登录，同时覆盖本组件的旧缓存和 Cookie。
        try { await ctx.storage.setJSON(CW_STORE, null); } catch {}
        return {...base, status: "setup", message: "先运行扫码助手，再填写登录参数"};
    }
    const owner = cwOwner(imported), inputHash = md5(cwCookieHeader(imported));
    let old;
    try { old = await ctx.storage.getJSON(CW_STORE); } catch {}
    const sameAccount = cwObject(old) && old.owner === owner;
    if (sameAccount && old.inputHash === inputHash && old.invalidated === true) return {...base, status: "error", message: cwFailureMessage("account", false)};
    let snapshot = sameAccount ? cwSnapshot(old.snapshot, now) : null;
    let cookies = imported;
    if (sameAccount && old.inputHash === inputHash) {
        try {
            const stored = cwCookieMap(old.cookie);
            if (stored.size && (!imported.get("unb") || !stored.get("unb") || imported.get("unb") === stored.get("unb"))) cookies = stored;
        } catch {}
    }
    // 最多保留七天旧结果；更久的数据只保留更新时间用于说明，不再展示码。
    if (snapshot && now - Date.parse(snapshot.updatedAt) > 7 * 86400000) snapshot = null;
    const state = {version: CW_VERSION, owner, inputHash, cookie: cwCookieHeader(cookies), snapshot,
        observedUnb: imported.get("unb") || cookies.get("unb") || (sameAccount && old.inputHash === inputHash && typeof old.observedUnb === "string" ? old.observedUnb : "")};
    let storageOK = true;
    const persist = async () => {
        state.cookie = cwCookieHeader(cookies);
        try { await ctx.storage.setJSON(CW_STORE, state); } catch { storageOK = false; }
    };
    // 新账号先覆盖旧状态，失败也不能回显另一账号的包裹。
    await persist();
    const deadline = now + 18000;
    const getPage = async page => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const remaining = deadline - clock();
            if (remaining < 1200) throw new CwFailure("partial");
            let response;
            const beforeToken = cookies.get("_m_h5_tk") || "";
            try {
                response = await cwBounded(() => ctx.http.get(cwRequestURL(cookies, page, clock()), {
                    headers: {Cookie: cwCookieHeader(cookies), "User-Agent": CW_UA, Referer: "https://h5.m.taobao.com/", Accept: "application/json"},
                    timeout: Math.max(1, Math.min(7000, remaining - 500)), redirect: "manual", credentials: "omit", insecureTls: false,
                }), deadline, clock);
            } catch (error) { throw error instanceof CwFailure ? error : new CwFailure("offline"); }
            try { cwUpdateCookies(cookies, response.headers, clock()); } catch {}
            const nextUnb = cookies.get("unb") || "";
            if (state.observedUnb && state.observedUnb !== nextUnb) {
                state.snapshot = null; snapshot = null;
                state.invalidated = true;
                // 后续同一导入值不再复用已变更的会话，等待用户重新扫码导入。
                cookies = new Map();
                throw new CwFailure("account");
            }
            if (nextUnb) state.observedUnb = nextUnb;
            // 失败响应也可能下发新 token，须先持久化再分类。
            await persist();
            if ([301, 302, 303, 307, 308, 403, 429].includes(response.status)) throw new CwFailure("verify");
            if (response.status === 401) throw new CwFailure("expired");
            if (response.status >= 500) throw new CwFailure("offline");
            if (response.status !== 200) throw new CwFailure("error");
            let body;
            try {
                const raw = await cwBounded(() => response.text(), deadline, clock);
                if (raw.length > 3 * 1024 * 1024) throw new CwFailure("schema");
                if (/^\s*</.test(raw)) throw new CwFailure("verify");
                body = JSON.parse(raw);
            } catch (error) { throw error instanceof CwFailure ? error : new CwFailure("schema"); }
            const kind = cwReturnKind(body);
            if (kind === "success") {
                try { return cwReadPage(body, page); } catch { throw new CwFailure("schema"); }
            }
            if (kind === "token") {
                const nextToken = cookies.get("_m_h5_tk") || "";
                if (attempt < 2 && nextToken && nextToken !== beforeToken) continue;
                throw new CwFailure("expired");
            }
            throw new CwFailure(kind);
        }
        throw new CwFailure("error");
    };
    let collected = [], partialItems = [];
    const pageSignatures = new Set();
    try {
        for (let page = 1; page <= 20; page++) {
            const result = await getPage(page);
            // 相同分页响应不能造成“已经取全”的假象。
            const signature = md5(JSON.stringify(result.packages));
            if (result.packages.length && pageSignatures.has(signature)) throw new CwFailure("partial");
            pageSignatures.add(signature);
            collected = collected.concat(result.packages);
            try { partialItems = cwItems(collected); } catch { throw new CwFailure("schema"); }
            if (result.complete) {
                if (clock() >= deadline) throw new CwFailure("partial");
                snapshot = {items: partialItems, updatedAt: new Date(clock()).toISOString()};
                state.snapshot = snapshot;
                await persist();
                return {...base, ...snapshot, total: snapshot.items.length, status: "ready", message: storageOK ? "" : "本机缓存写入失败，刷新时将重新查询"};
            }
        }
        throw new CwFailure("partial");
    } catch (error) {
        const kind = error instanceof CwFailure ? error.kind : "error";
        await persist();
        if (snapshot) return {...base, ...snapshot, total: snapshot.items.length,
            status: ["expired", "verify", "offline"].includes(kind) ? kind : "error", message: cwFailureMessage(kind, true)};
        // 无历史快照时可展示已成功查到的部分，但不能缓存为完整结果或声称完整数量。
        if (partialItems.length && !["account", "expired", "verify"].includes(kind)) return {...base, items: partialItems, total: partialItems.length,
            updatedAt: new Date(clock()).toISOString(), partial: true, status: "partial", message: "只查到部分包裹，数量未取全"};
        return {...base, status: ["expired", "verify", "offline"].includes(kind) ? kind : "error", message: cwFailureMessage(kind, false)};
    }
}

export default async function(ctx) {
    const model = await loadCainiaoModel(ctx);
    return renderWidget(model, ctx.widgetFamily, Date.now());
}
