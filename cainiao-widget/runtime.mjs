// 引擎：Egern 原生 generic 脚本 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：导入模块，在手机官方查件页登录并回到 Egern 刷新
// 依赖：core.mjs、auth.mjs、render.mjs；发布文件内联，不下载其他代码
import {CW_VERSION, CW_UA, CW_STORE, CW_SELF_HEADER, cwObject, cwCookieMap, cwCookieHeader, cwOwner, cwUpdateCookies, cwRequestURL, cwReturnKind, cwReadPage, cwItems, md5} from "./core.mjs";
import {cwConnectionMode, cwReadAuth, cwSameAuth, cwWriteAuth, cwAuthCookies, cwClearLocal, captureCainiaoCredentials, diagnoseCainiaoConnection} from "./auth.mjs";
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

function cwFailureMessage(kind, cached, automatic = false) {
    const messages = {
        expired: automatic ? "登录已过期，请重开手机查件页" : "登录已过期，请更新手动登录参数",
        verify: "请在淘宝或菜鸟完成验证",
        offline: "暂时连不上，稍后再试",
        partial: "本次未查全，稍后刷新",
        schema: "接口数据有变化，暂未更新",
        account: automatic ? "登录身份失效，请重开手机查件页" : "账号发生变化，请重新导入登录参数",
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
    const mode = cwConnectionMode(env);
    if (mode === "invalid") return {...base, status: "setup", setupTitle: "检查连接设置", message: "连接方式无效，请恢复自动连接"};
    if (mode === "off") {
        try { cwClearLocal(ctx); }
        catch { return {...base, status: "setup", setupTitle: "连接已关闭", message: "本机登录态清除未确认，请检查 Egern"}; }
        return {...base, status: "setup", setupTitle: "连接已关闭", message: "本机登录态已清除，切回 auto 可重新连接"};
    }
    let automatic = null;
    if (mode === "auto") {
        try { automatic = cwReadAuth(ctx, now); }
        catch { return {...base, status: "setup", setupTitle: "检查 Egern 存储", message: "本机登录态无法读取，请重开手机查件页"}; }
    }
    let imported;
    try { imported = cwCookieMap(automatic ? automatic.cookie : env.CAINIAO_COOKIE || ""); }
    catch { return {...base, status: "setup", setupTitle: "检查手动登录参数", message: "登录参数格式有误，请重新粘贴"}; }
    if (!imported.size) {
        try {
            const saved = ctx.storage.getJSON(CW_STORE);
            if (!cwObject(saved) || saved.blocked !== true) ctx.storage.setJSON(CW_STORE, null);
        } catch {}
        return {...base, status: "setup", ...(mode === "manual" ? {setupTitle: "填写手动登录参数"} : {}),
            message: mode === "auto" ? "点击组件，打开手机查件页连接" : "手动模式尚未填写登录参数"};
    }
    const owner = cwOwner(imported), inputHash = md5(cwCookieHeader(imported));
    let old, storageOK = true;
    try { old = ctx.storage.getJSON(CW_STORE); }
    catch {
        if (mode === "auto") return {...base, status: "setup", setupTitle: "检查 Egern 存储", message: "账号隔离状态无法读取，请检查 Egern 后重试"};
        storageOK = false;
    }
    if (cwObject(old) && old.blocked === true && old.owner !== owner) return {...base, status: "setup", setupTitle: "重开手机查件页",
        message: "新账号登录态尚未保存，请重开手机查件页"};
    const sameAccount = cwObject(old) && old.owner === owner;
    const sameInput = sameAccount && old.inputHash === inputHash && (automatic
        ? old.source === "auto" && old.generation === automatic.generation : old.source !== "auto");
    if (sameInput && old.invalidated === true) return {...base, status: "error", message: cwFailureMessage("account", false, !!automatic)};
    let snapshot = sameAccount ? cwSnapshot(old.snapshot, now) : null;
    let cookies = imported;
    if (sameInput) {
        try {
            const stored = cwCookieMap(old.cookie);
            if (stored.size && (!imported.get("unb") || !stored.get("unb") || imported.get("unb") === stored.get("unb"))) cookies = stored;
        } catch {}
    }
    if (automatic) cookies = cwAuthCookies(cookies);
    // 最多保留七天旧结果；更久的数据只保留更新时间用于说明，不再展示码。
    if (snapshot && now - Date.parse(snapshot.updatedAt) > 7 * 86400000) snapshot = null;
    let terminalStatus = null, ownsState = false, state;
    const currentAuth = () => {
        if (mode !== "auto") return null;
        let current;
        try { current = cwReadAuth(ctx, clock()); }
        catch { throw new CwFailure("local"); }
        if (automatic ? !cwSameAuth(current, automatic) : current !== null) throw new CwFailure("superseded");
        return current;
    };
    const guard = () => {
        const current = currentAuth();
        if (current && (terminalStatus ? current.status !== terminalStatus : !["pending", "connected"].includes(current.status))) throw new CwFailure("superseded");
        if (ownsState) {
            let saved;
            try { saved = ctx.storage.getJSON(CW_STORE); }
            catch { if (mode === "auto") throw new CwFailure("local"); storageOK = false; return; }
            if (!cwObject(saved) || saved.owner !== owner || saved.inputHash !== inputHash
                || saved.source !== state.source || saved.generation !== state.generation || saved.runId !== state.runId) throw new CwFailure("superseded");
        }
    };
    const stopped = kind => ({...base, status: "setup", setupTitle: kind === "local" ? "检查 Egern 存储" : "刷新小组件", message: kind === "local"
        ? "本机登录态无法读取，请检查 Egern 后重开查件页" : "登录态已更新，请刷新小组件"});
    if (automatic && !["pending", "connected"].includes(automatic.status)) {
        try { currentAuth(); } catch (error) { return stopped(error.kind); }
        if (automatic.status === "invalid") return {...base, status: "setup", message: cwFailureMessage("account", false, true)};
        return {...base, ...(snapshot || {}), total: snapshot?.items.length || 0, status: automatic.status,
            message: cwFailureMessage(automatic.status, !!snapshot, true)};
    }
    state = {version: CW_VERSION, owner, inputHash, source: automatic ? "auto" : "manual",
        generation: automatic?.generation || "", runId: md5(now + ":" + Math.random() + ":" + Math.random()), cookie: cwCookieHeader(cookies), snapshot,
        observedUnb: imported.get("unb") || cookies.get("unb") || (sameInput && typeof old.observedUnb === "string" ? old.observedUnb : "")};
    const persist = () => {
        guard();
        state.cookie = cwCookieHeader(cookies);
        try {
            ctx.storage.setJSON(CW_STORE, state);
            const saved = ctx.storage.getJSON(CW_STORE);
            if (!cwObject(saved) || saved.owner !== owner || saved.inputHash !== inputHash || saved.source !== state.source
                || saved.generation !== state.generation || saved.runId !== state.runId || saved.cookie !== state.cookie || saved.invalidated !== state.invalidated
                || JSON.stringify(cwSnapshot(saved.snapshot, clock())) !== JSON.stringify(state.snapshot)) storageOK = false;
            else ownsState = true;
        } catch { storageOK = false; }
        guard();
    };
    const markAuth = status => {
        if (!automatic) return;
        guard();
        const current = currentAuth();
        const updated = {...current, status, confirmedAt: status === "connected" ? clock() : current.confirmedAt};
        try {
            if (cwWriteAuth(ctx, updated, clock())) {
                if (!["pending", "connected"].includes(status)) terminalStatus = status;
            } else storageOK = false;
        } catch { storageOK = false; }
        guard();
    };
    const deadline = now + 18000;
    const getPage = async page => {
        for (let attempt = 0; attempt < 3; attempt++) {
            guard();
            const remaining = deadline - clock();
            if (remaining < 1200) throw new CwFailure("partial");
            let response;
            const beforeToken = cookies.get("_m_h5_tk") || "";
            try {
                response = await cwBounded(() => { guard(); return ctx.http.get(cwRequestURL(cookies, page, clock()), {
                    headers: {Cookie: cwCookieHeader(cookies), "User-Agent": CW_UA, Referer: "https://h5.m.taobao.com/", Accept: "application/json", [CW_SELF_HEADER]: "1"},
                    timeout: Math.max(1, Math.min(7000, remaining - 500)), redirect: "manual", credentials: "omit", insecureTls: false,
                }); }, deadline, clock);
            } catch (error) { throw error instanceof CwFailure ? error : new CwFailure("offline"); }
            guard();
            try { cwUpdateCookies(cookies, response.headers, clock()); } catch {}
            if (automatic) cookies = cwAuthCookies(cookies);
            const nextUnb = cookies.get("unb") || "";
            if (state.observedUnb && state.observedUnb !== nextUnb) {
                state.snapshot = null; snapshot = null;
                state.invalidated = true;
                // 旧会话失效后等待新的手机捕获或手动导入，不回显旧码。
                cookies = new Map();
                throw new CwFailure("account");
            }
            if (nextUnb) state.observedUnb = nextUnb;
            // 失败响应也可能下发新 token，须先持久化再分类。
            persist();
            if ([301, 302, 303, 307, 308, 403, 429].includes(response.status)) throw new CwFailure("verify");
            if (response.status === 401) throw new CwFailure("expired");
            if (response.status >= 500) throw new CwFailure("offline");
            if (response.status !== 200) throw new CwFailure("error");
            let body;
            try {
                const raw = await cwBounded(() => response.text(), deadline, clock);
                guard();
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
        // 新账号先覆盖旧状态，失败也不能回显另一账号的包裹。
        persist();
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
                persist();
                markAuth("connected");
                guard();
                return {...base, ...snapshot, total: snapshot.items.length, status: "ready", message: storageOK ? "" : "本机缓存写入失败，刷新时将重新查询"};
            }
        }
        throw new CwFailure("partial");
    } catch (error) {
        const kind = error instanceof CwFailure ? error.kind : "error";
        if (["superseded", "local"].includes(kind)) return stopped(kind);
        try {
            persist();
            if (["expired", "verify", "account"].includes(kind)) markAuth(kind === "account" ? "invalid" : kind);
            guard();
        } catch (failure) { return stopped(failure.kind); }
        if (snapshot) return {...base, ...snapshot, total: snapshot.items.length,
            status: ["expired", "verify", "offline"].includes(kind) ? kind : "error", message: cwFailureMessage(kind, true, !!automatic)};
        // 无历史快照时可展示已成功查到的部分，但不能缓存为完整结果或声称完整数量。
        if (partialItems.length && !["account", "expired", "verify"].includes(kind)) return {...base, items: partialItems, total: partialItems.length,
            updatedAt: new Date(clock()).toISOString(), partial: true, status: "partial", message: "只查到部分包裹，数量未取全"};
        return {...base, status: ["expired", "verify", "offline"].includes(kind) ? kind : "error", message: cwFailureMessage(kind, false, !!automatic)};
    }
}

export default async function(ctx) {
    if (ctx.request) {
        try { captureCainiaoCredentials(ctx); }
        catch { console.log("[菜鸟连接] 捕获未完成，原请求继续透传。"); }
        return;
    }
    if (ctx.env?.CAINIAO_DIAGNOSTIC === "true") return diagnoseCainiaoConnection(ctx);
    const model = await loadCainiaoModel(ctx);
    return renderWidget(model, ctx.widgetFamily, Date.now());
}
