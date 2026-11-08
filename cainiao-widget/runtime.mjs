// 引擎：Egern 原生 generic 脚本 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：导入模块，打开本人淘宝／菜鸟 App 快递列表，再运行组件
// 依赖：core.mjs、app.mjs、auth.mjs、render.mjs；发布文件内联，不下载其他代码
import {CW_VERSION, CW_API, CW_COUNT_API, CW_IDENTITY_API, CW_PATH, CW_COUNT_PATH, CW_IDENTITY_PATH, CW_UA, CW_STORE, CW_SELF_HEADER, cwObject, cwCookieMap, cwCookieHeader, cwOwner, cwUpdateCookies, cwRequestURL, cwAccountRequestURL, cwIdentityRequestURL, cwResponseAPI, cwIdentityMatch, cwReturnKind, cwReadPage, cwItems, md5} from "./core.mjs";
import {cwConnectionMode, cwReadAuth, cwSameAuth, cwWriteAuth, cwAuthCookies, cwLoginCandidate, cwSessionHash, cwCachedAuthStatus, cwClearLocal, captureCainiaoCredentials, diagnoseCainiaoConnection} from "./auth.mjs";
import {cwAppSummary} from "./app.mjs";
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
        expired: automatic ? "登录已过期，请重开 App 快递列表" : "登录已过期，请更新手动登录参数",
        verify: "请在淘宝或菜鸟完成验证",
        offline: "暂时连不上，稍后再试",
        partial: "本次未查全，稍后刷新",
        schema: "接口数据有变化，暂未更新",
        account: automatic ? "App 账号未匹配，请重开快递列表连接" : "账号发生变化，请重新导入登录参数",
        unsupported: "App 会话尚不能用于独立查询，请重开快递列表接入",
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
        catch { return {...base, status: "setup", setupTitle: "检查 Egern 存储", message: "本机登录态无法读取，请重开 App 快递列表"}; }
    }
    let imported;
    try { imported = cwCookieMap(automatic ? automatic.cookie : env.CAINIAO_COOKIE || ""); }
    catch { return {...base, status: "setup", setupTitle: "检查手动登录参数", message: "登录参数格式有误，请重新粘贴"}; }
    if (!imported.size) {
        try {
            const saved = ctx.storage.getJSON(CW_STORE);
            if (!cwObject(saved) || saved.blocked !== true) ctx.storage.setJSON(CW_STORE, null);
        } catch {}
        if (mode === "manual") return {...base, status: "setup", setupTitle: "填写手动登录参数", message: "手动模式尚未填写登录参数"};
        let message = "打开淘宝或菜鸟 App 的快递列表";
        try {
            const app = cwAppSummary(ctx, now);
            if (app.observed) message = app.sameRequestNativeSession ? "已看到 App 原生会话，尚无可复用登录态" : "已看到 App 请求，尚无完整登录会话";
        } catch {}
        return {...base, status: "setup", message};
    }
    const owner = cwOwner(imported), inputHash = md5(cwCookieHeader(imported));
    let old, storageOK = true;
    try { old = ctx.storage.getJSON(CW_STORE); }
    catch {
        if (mode === "auto") return {...base, status: "setup", setupTitle: "检查 Egern 存储", message: "账号隔离状态无法读取，请检查 Egern 后重试"};
        storageOK = false;
    }
    if (cwObject(old) && old.blocked === true && old.owner !== owner) return {...base, status: "setup", setupTitle: "重开 App 快递列表",
        message: "新账号登录态尚未保存，请重开 App 快递列表"};
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
    let initialCacheSignature;
    try { initialCacheSignature = JSON.stringify(old ?? null); }
    catch { return {...base, status: "setup", setupTitle: "检查 Egern 存储", message: "本机缓存格式无法确认，请重新连接"}; }
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
    const guardCache = () => {
        let saved;
        try {
            saved = ctx.storage.getJSON(CW_STORE);
            // 初始写入失败也不能越过之后成功写入的账号屏障或另一任务。
            if (!ownsState && JSON.stringify(saved ?? null) !== initialCacheSignature) throw new CwFailure("superseded");
        } catch (error) {
            if (error instanceof CwFailure) throw error;
            if (mode === "auto") throw new CwFailure("local");
            storageOK = false; return;
        }
        if (ownsState) {
            if (!cwObject(saved) || saved.owner !== owner || saved.inputHash !== inputHash
                || saved.source !== state.source || saved.generation !== state.generation || saved.runId !== state.runId) throw new CwFailure("superseded");
        }
    };
    const guard = () => {
        const current = currentAuth();
        if (current && (terminalStatus ? current.status !== terminalStatus : !["pending", "connected"].includes(current.status))) throw new CwFailure("superseded");
        guardCache();
    };
    const stopped = kind => ({...base, status: "setup", setupTitle: kind === "local" ? "检查 Egern 存储" : "刷新小组件", message: kind === "local"
        ? "本机登录态无法读取，请检查 Egern 后重开 App 快递列表" : "登录态已更新，请刷新小组件"});
    const cachedTerminal = cwCachedAuthStatus(old, automatic), authStatus = cachedTerminal || automatic?.status;
    if (automatic && !["pending", "connected"].includes(authStatus)) {
        try { currentAuth(); guardCache(); } catch (error) { return stopped(error.kind); }
        const storageMessage = cachedTerminal && authStatus !== automatic.status ? " · 登录标志写入未确认，已停止重试" : "";
        if (authStatus === "invalid") return {...base, status: "setup", message: cwFailureMessage("account", false, true) + storageMessage};
        if (authStatus === "unsupported") return {...base, status: "setup", setupTitle: "App 接入未确认", message: cwFailureMessage("unsupported", false, true) + storageMessage};
        return {...base, ...(snapshot || {}), total: snapshot?.items.length || 0, status: authStatus,
            message: cwFailureMessage(authStatus, !!snapshot, true) + storageMessage};
    }
    const native = automatic?.captureKind === "native_session_candidate";
    const validAccountProof = native && sameInput && automatic.status === "connected" && old.accountCheckedAt === automatic.accountCheckedAt
        && old.accountSessionHash === automatic.accountSessionHash && old.accountSessionHash === cwSessionHash(cookies);
    let accountCheckedAt = validAccountProof ? automatic.accountCheckedAt : null;
    state = {version: CW_VERSION, owner, inputHash, source: automatic ? "auto" : "manual",
        generation: automatic?.generation || "", runId: md5(now + ":" + Math.random() + ":" + Math.random()), cookie: cwCookieHeader(cookies), snapshot,
        observedUnb: imported.get("unb") || cookies.get("unb") || (sameInput && typeof old.observedUnb === "string" ? old.observedUnb : ""),
        accountSessionHash: validAccountProof ? cwSessionHash(cookies) : "", accountCheckedAt, terminalStatus: ""};
    const persist = () => {
        guard();
        state.cookie = cwCookieHeader(cookies);
        try {
            ctx.storage.setJSON(CW_STORE, state);
            const saved = ctx.storage.getJSON(CW_STORE);
            if (!cwObject(saved) || saved.owner !== owner || saved.inputHash !== inputHash || saved.source !== state.source
                || saved.generation !== state.generation || saved.runId !== state.runId || saved.cookie !== state.cookie || saved.invalidated !== state.invalidated
                || saved.accountSessionHash !== state.accountSessionHash || saved.accountCheckedAt !== state.accountCheckedAt || saved.terminalStatus !== state.terminalStatus
                || JSON.stringify(cwSnapshot(saved.snapshot, clock())) !== JSON.stringify(state.snapshot)) storageOK = false;
            else ownsState = true;
        } catch { storageOK = false; }
        guard();
    };
    const clearAccountProof = () => { accountCheckedAt = null; state.accountSessionHash = ""; state.accountCheckedAt = null; };
    const markAuth = status => {
        if (!automatic) return;
        guard();
        const current = currentAuth();
        if (native && status === "connected" && accountCheckedAt === null) throw new CwFailure("unsupported");
        const updated = {...current, status, confirmedAt: status === "connected" ? clock() : current.confirmedAt,
            accountCheckedAt: native && status === "connected" ? accountCheckedAt : current.accountCheckedAt,
            accountSessionHash: native && status === "connected" ? cwSessionHash(cookies) : current.accountSessionHash};
        if (!["pending", "connected"].includes(status)) state.terminalStatus = status;
        try {
            if (cwWriteAuth(ctx, updated, clock())) {
                if (!["pending", "connected"].includes(status)) terminalStatus = status;
            } else storageOK = false;
        } catch { storageOK = false; }
        guard();
    };
    const deadline = now + 18000;
    let requestTime = now - 1;
    const getMtop = async (requestURL, requestPath, read) => {
        for (let attempt = 0; attempt < 3; attempt++) {
            guard();
            if (automatic && !cwLoginCandidate(cookies)) { clearAccountProof(); throw new CwFailure("expired"); }
            const remaining = deadline - clock();
            if (remaining < 1200) throw new CwFailure("partial");
            let response;
            const beforeToken = cookies.get("_m_h5_tk") || "";
            const beforeSession = native ? cwSessionHash(cookies) : "";
            try {
                response = await cwBounded(() => {
                    guard();
                    requestTime = Math.max(Math.floor(clock()), requestTime + 1);
                    return ctx.http.get(requestURL(cookies, requestTime), {
                        headers: {Cookie: cwCookieHeader(cookies), "User-Agent": CW_UA, Referer: "https://h5.m.taobao.com/", Accept: "application/json", [CW_SELF_HEADER]: "1"},
                        timeout: Math.max(1, Math.min(7000, remaining - 500)), redirect: "manual", credentials: "omit", insecureTls: false,
                    });
                }, deadline, clock);
            } catch (error) { throw error instanceof CwFailure ? error : new CwFailure("offline"); }
            guard();
            try { cwUpdateCookies(cookies, response.headers, clock(), requestPath); } catch {}
            if (automatic) cookies = cwAuthCookies(cookies);
            const nextUnb = cookies.get("unb") || "";
            if (state.observedUnb && state.observedUnb !== nextUnb) {
                state.snapshot = null; snapshot = null;
                state.invalidated = true;
                // 旧会话失效后等待新的手机捕获或手动导入，不回显旧码。
                cookies = new Map();
                clearAccountProof();
                throw new CwFailure("account");
            }
            if (nextUnb) state.observedUnb = nextUnb;
            if (automatic && !cwLoginCandidate(cookies)) {
                clearAccountProof(); persist(); throw new CwFailure("expired");
            }
            if (native && cwSessionHash(cookies) !== beforeSession) {
                // 稳定会话变化时丢弃这次证明／列表；新会话重新验证，不沿用旧 UID 成功响应。
                clearAccountProof(); persist(); throw new CwFailure("session");
            }
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
                try { return read(body); }
                catch (error) { throw error instanceof CwFailure ? error : new CwFailure(native ? "unsupported" : "schema"); }
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
    const getPage = page => getMtop((current, tick) => cwRequestURL(current, page, tick), CW_PATH, body => {
        if (native && !cwResponseAPI(body, CW_API)) throw new CwFailure("unsupported");
        return cwReadPage(body, page);
    });
    let collected = [], partialItems = [];
    const pageSignatures = new Set();
    try {
        // 新账号先覆盖旧状态，失败也不能回显另一账号的包裹。
        persist();
        for (let sessionAttempt = 0; sessionAttempt < 3; sessionAttempt++) {
            try {
                collected = []; partialItems = []; pageSignatures.clear();
                if (native && (automatic.status === "pending" || accountCheckedAt === null)) {
                    await getMtop(cwIdentityRequestURL, CW_IDENTITY_PATH, body => {
                        const match = cwIdentityMatch(body, imported.get("unb"));
                        if (match === "unverified") throw new CwFailure("unsupported");
                        if (match === "mismatch") {
                            state.snapshot = null; snapshot = null; state.invalidated = true; cookies = new Map();
                            clearAccountProof(); throw new CwFailure("account");
                        }
                    });
                    await getMtop(cwAccountRequestURL, CW_COUNT_PATH, body => {
                        if (!cwResponseAPI(body, CW_COUNT_API) || !cwObject(body.data)) throw new CwFailure("unsupported");
                    });
                    // 此证明只在完整 PDS 成功后写入；COUNT 单独成功不是连接成功。
                    accountCheckedAt = clock();
                }
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
                        if (native && accountCheckedAt === null) throw new CwFailure("unsupported");
                        snapshot = {items: partialItems, updatedAt: new Date(clock()).toISOString()};
                        state.snapshot = snapshot;
                        state.accountSessionHash = native ? cwSessionHash(cookies) : "";
                        state.accountCheckedAt = native ? accountCheckedAt : null;
                        persist();
                        markAuth("connected");
                        guard();
                        return {...base, ...snapshot, total: snapshot.items.length, status: "ready", message: storageOK ? "" : "本机缓存写入失败，刷新时将重新查询"};
                    }
                }
                throw new CwFailure("partial");
            } catch (error) {
                if (error instanceof CwFailure && error.kind === "session") {
                    if (sessionAttempt < 2) continue;
                    throw new CwFailure("expired");
                }
                throw error;
            }
        }
        throw new CwFailure("partial");
    } catch (error) {
        const kind = error instanceof CwFailure ? error.kind : "error";
        if (["superseded", "local"].includes(kind)) return stopped(kind);
        try {
            if (["expired", "verify", "account", "unsupported"].includes(kind)) markAuth(kind === "account" ? "invalid" : kind);
            persist();
            guard();
        } catch (failure) { return stopped(failure.kind); }
        const failureMessage = cached => cwFailureMessage(kind, cached, !!automatic) + (storageOK ? "" : " · 本机状态写入失败");
        if (snapshot) return {...base, ...snapshot, total: snapshot.items.length,
            status: ["expired", "verify", "offline"].includes(kind) ? kind : "error", message: failureMessage(true)};
        // 无历史快照时可展示已成功查到的部分，但不能缓存为完整结果或声称完整数量。
        if (partialItems.length && !["account", "expired", "verify"].includes(kind)) return {...base, items: partialItems, total: partialItems.length,
            updatedAt: new Date(clock()).toISOString(), partial: true, status: "partial", message: "只查到部分包裹，数量未取全" + (storageOK ? "" : " · 本机状态写入失败")};
        return {...base, status: ["expired", "verify", "offline"].includes(kind) ? kind : "error", message: failureMessage(false)};
    }
}

export default async function(ctx) {
    // 没有配置 response hook；误调用时也不消费正文或将其当作新的 App 捕获。
    if (ctx.response) return;
    if (ctx.request) {
        try { captureCainiaoCredentials(ctx); }
        catch { console.log("[菜鸟连接] 捕获未完成，原请求继续透传。"); }
        return;
    }
    if (ctx.env?.CAINIAO_DIAGNOSTIC === "true") return diagnoseCainiaoConnection(ctx);
    const model = await loadCainiaoModel(ctx);
    return renderWidget(model, ctx.widgetFamily, Date.now());
}
