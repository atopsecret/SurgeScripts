// Engine | Egern 原生脚本 API | JavaScript ES module
// Build: 无需构建
// Run: 导入 weilai-auto-checkin.egern.yaml；重新捕获凭据；定时任务每天 09:00
// Deps: Egern ctx API；测试：node --experimental-vm-modules --test weilai/tests/egern.test.cjs
// Version: 3.0.0
// Author: atopsecret；业务路径与响应契约沿用本目录 Surge 2.1.2，旧文件不改。

export const CONFIG = Object.freeze({
    version: "3.0.0",
    stateKey: "weilai_egern_auth_state_v1",
    journalKey: "weilai_egern_checkin_v1",
    endpoint: "https://gateway-front-external.nio.com/moat/10086/c/award_cn/checkin",
    budgetMs: 24000,
    requestTimeoutMs: 5000,
    leaseMs: 30000,
    maxAttempts: 3,
    fallbackUA: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NIOAppCN/6.10.0 (com.do1.WeiLaiApp; build:2682; OS:iOS) webview/lg _dsbridge"
});
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const validTime = value => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= Date.now() + 300000;
const statNumber = value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
class StateFormatError extends Error {}
class TimeoutError extends Error {}
class TaskStop extends Error {
    constructor(title, body, keepLease = false) { super(title); this.title = title; this.body = body; this.keepLease = keepLease; }
}

export function validToken(value) {
    return typeof value === "string" && /^Bearer [^\s\x00-\x1f\x7f]{16,4096}$/i.test(value);
}
export function validUA(value) {
    return typeof value === "string" && /NIOAppCN\//.test(value) && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
}
export function captureURL(url) {
    return /^https:\/\/(?:gateway-front-external\.nio\.com|app\.nio\.com|api\.nio\.com)\/(?:moat\/10086\/+(?:n\/c\/award\/|c\/award_cn\/)|(?:n\/c\/)?(?:account\/user\/|user\/|profile\/)|app\/api\/|api\/)/i.test(String(url || ""));
}
function header(headers, name) {
    const value = headers && headers.get(name);
    return typeof value === "string" ? value : "";
}
function readJSON(ctx, key) {
    // 原生 get() 先区分“没有键”和损坏的 JSON；不回退读取 Surge 或旧凭据键。
    const raw = ctx.storage.get(key);
    if (raw === null) return null;
    if (typeof raw !== "string" || !raw) throw new StateFormatError("invalid-storage");
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { throw new StateFormatError("invalid-json"); }
    if (parsed === null) throw new StateFormatError("invalid-null");
    return parsed;
}
function writeVerified(ctx, key, value) {
    // Egern setJSON() 返回 void，不以 === true 判断；回读才能识别静默未写入。
    ctx.storage.setJSON(key, value);
    if (JSON.stringify(ctx.storage.getJSON(key)) !== JSON.stringify(value)) throw new Error("storage-not-confirmed");
}
function readState(ctx) {
    const state = readJSON(ctx, CONFIG.stateKey);
    if (state === null) return null;
    if (!record(state) || !validToken(state.token) || !validTime(state.observedAt) ||
        typeof state.invalid !== "boolean" || !validId(state.generation)) throw new StateFormatError("invalid-state");
    return state;
}
function uniqueId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
}
function report(ctx, title, body, notify = true) {
    console.log("[蔚来签到] " + title);
    if (body) for (const line of body.split("\n")) console.log("[蔚来签到] " + line);
    if (notify) {
        try { ctx.notify({ title: "蔚来签到", subtitle: title, body, sound: false }); }
        catch (_) { /* 通知失败不改变已完成的请求、状态和本地日志。 */ }
    }
}
function capture(ctx) {
    if (!captureURL(ctx.request.url)) return;
    const token = header(ctx.request.headers, "authorization");
    if (!validToken(token)) return;
    let previous;
    try { previous = readState(ctx); }
    catch (error) {
        // 真正的新请求可以修复损坏的状态；读取 API 不可用时则停止，不猜旧状态。
        if (error instanceof StateFormatError) previous = null;
        else { report(ctx, "凭据状态无法读取", "请检查 Egern 本地存储后重新打开蔚来 App。"); return; }
    }
    const same = previous && previous.token === token;
    const ua = header(ctx.request.headers, "user-agent");
    const state = {
        token, observedAt: Date.now(), invalid: Boolean(same && previous.invalid),
        userAgent: validUA(ua) ? ua : (same && validUA(previous.userAgent) ? previous.userAgent : ""),
        generation: same ? previous.generation : uniqueId()
    };
    try { writeVerified(ctx, CONFIG.stateKey, state); }
    catch (_) { report(ctx, "凭据保存失败", "本地写入未确认，请检查存储后重新打开蔚来 App。"); return; }
    if (!same) report(ctx, "凭据已更新", "已保存到 Egern 本地。请运行定时任务验证；不会搬运 Surge 存储。");
}

// 蔚来中国业务使用 UTC+8 日界；cron 仍使用 Egern 的设备时区，不猜测服务器奖励时间。
export function businessDay(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
function readJournal(ctx) {
    const saved = readJSON(ctx, CONFIG.journalKey);
    if (saved === null) return { version: 1, lock: null, confirmed: null };
    if (!record(saved) || saved.version !== 1 || !(saved.lock === null || record(saved.lock)) ||
        !(saved.confirmed === null || record(saved.confirmed))) throw new StateFormatError("invalid-journal");
    if (saved.lock) {
        const lock = saved.lock;
        if (!validId(lock.id) || !validId(lock.generation) || !validTime(lock.acquiredAt) ||
            !Number.isFinite(lock.expiresAt) || lock.expiresAt !== lock.acquiredAt + CONFIG.leaseMs) {
            throw new StateFormatError("invalid-lock");
        }
    }
    if (saved.confirmed) {
        const item = saved.confirmed;
        if (!validId(item.generation) || !validTime(item.confirmedAt) ||
            typeof item.day !== "string" || item.day !== businessDay(item.confirmedAt) ||
            !record(item.stats) || Object.keys(item.stats).some(key =>
                !["consecutive", "total"].includes(key) || !statNumber(item.stats[key]))) {
            throw new StateFormatError("invalid-confirmation");
        }
    }
    return { version: 1, lock: saved.lock, confirmed: saved.confirmed };
}
function statistics(data) {
    const stats = record(data.stats) ? data.stats : {};
    const first = values => values.find(statNumber);
    const consecutive = first([stats.continuous_checkin_days, stats.continuous_days, data.continuous_days]);
    const total = first([stats.accumulate_days, data.accumulate_days]);
    const output = {};
    if (consecutive !== undefined) output.consecutive = consecutive;
    if (total !== undefined) output.total = total;
    return output;
}
function statsMessage(stats) {
    return "连续签到：" + (statNumber(stats.consecutive) ? stats.consecutive + " 天" : "未知") +
        "\n累计签到：" + (statNumber(stats.total) ? stats.total + " 天" : "未知");
}
function guard(ctx, snapshot, lease, deadline) {
    let current, journal;
    try { current = readState(ctx); journal = readJournal(ctx); }
    catch (_) { throw new TaskStop("凭据状态无法读取", "任务已停止，请检查本地存储；不继续使用旧快照。"); }
    if (!current || current.invalid || current.token !== snapshot.token || current.generation !== snapshot.generation) {
        throw new TaskStop("凭据状态已变化", "本次旧任务已停止，不切换账号继续提交或保存旧响应。");
    }
    if (!journal.lock || journal.lock.id !== lease.id || journal.lock.generation !== snapshot.generation ||
        journal.lock.expiresAt <= Date.now()) {
        throw new TaskStop("任务锁已变化", "本次任务已停止，不覆盖其他运行的状态。");
    }
    if (Date.now() >= deadline) throw new TaskStop("签到结果未确认", "已超过时间预算，请在 App 查看；不自动重复提交。", true);
    return { current, journal };
}
function release(ctx, lease) {
    try {
        const journal = readJournal(ctx);
        if (journal.lock && journal.lock.id === lease.id) {
            writeVerified(ctx, CONFIG.journalKey, { ...journal, lock: null });
        }
    } catch (_) { console.log("[蔚来签到] 任务锁未确认释放，将在到期后允许新任务。"); }
}
function limited(operation, milliseconds) {
    // ctx.http 的原生超时负责请求；此兜底同时限制异常挂起的 Promise 和响应流。
    // 没有文档化的 AbortSignal，不声称 Promise 超时能自行取消已发送的 POST。
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => { if (!settled) { settled = true; reject(new TimeoutError("timeout")); } }, Math.max(1, milliseconds));
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            if (typeof clearTimeout === "function") clearTimeout(timer);
            callback(value);
        };
        let result;
        try { result = operation(); } catch (error) { finish(reject, error); return; }
        Promise.resolve(result).then(value => finish(resolve, value), error => finish(reject, error));
    });
}
export function retryDelay(value, now = Date.now()) {
    if (!value) return 2000;
    const text = value.trim();
    if (!text) return 2000;
    let delay;
    if (/^\d+$/.test(text)) delay = Number(text) * 1000;
    else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) {
        const time = Date.parse(text);
        // 拒绝 Date.parse() 宽松归一化出的不存在日期或错误星期。
        delay = Number.isFinite(time) && new Date(time).toUTCString() === text ? time - now : NaN;
    } else return NaN;
    return Number.isFinite(delay) ? Math.max(1000, delay) : NaN;
}
function invalidate(ctx, snapshot, lease, deadline) {
    const { current } = guard(ctx, snapshot, lease, deadline);
    writeVerified(ctx, CONFIG.stateKey, { ...current, invalid: true });
}
async function runCheckin(ctx) {
    console.log("[蔚来签到] Egern 原生脚本版本 " + CONFIG.version);
    let state, journal;
    try { state = readState(ctx); journal = readJournal(ctx); }
    catch (_) { report(ctx, "凭据或任务状态损坏", "请检查 Egern 本地存储并重新捕获凭据；不会读取旧 Surge 键。"); return; }
    if (!state || state.invalid) { report(ctx, "需要更新凭据", "请在 Egern 开启解密后，重新登录蔚来 App 并打开签到或个人页面。"); return; }
    if (journal.confirmed && journal.confirmed.generation === state.generation && journal.confirmed.day === businessDay()) {
        report(ctx, "今日签到已确认（本地记录）", statsMessage(journal.confirmed.stats) + "\n本次未发送签到请求。"); return;
    }
    if (journal.lock && journal.lock.expiresAt > Date.now()) {
        report(ctx, "已有签到任务", "本地任务锁尚未到期，本次不重复提交。"); return;
    }
    const acquiredAt = Date.now();
    const lease = { id: uniqueId(), generation: state.generation, acquiredAt, expiresAt: acquiredAt + CONFIG.leaseMs };
    const deadline = lease.acquiredAt + CONFIG.budgetMs;
    let acquired = false, keepLease = false, posted = false;
    try {
        // 短同步临界段 + 写入回读防止常见重入；storage 无 CAS，不宣称跨进程绝对互斥。
        writeVerified(ctx, CONFIG.journalKey, { ...journal, lock: lease });
        acquired = true;
        for (let attempt = 1; attempt <= CONFIG.maxAttempts; attempt++) {
            guard(ctx, state, lease, deadline);
            if (deadline - Date.now() < CONFIG.requestTimeoutMs + 500) {
                report(ctx, "签到未完成", "剩余时间不足，请在 App 查看或稍后手动运行。"); return;
            }
            const attemptDeadline = Date.now() + CONFIG.requestTimeoutMs;
            const url = CONFIG.endpoint + "?app_id=10086&timestamp=" + Math.floor(Date.now() / 1000);
            const options = {
                headers: { authorization: state.token, "content-type": "application/x-www-form-urlencoded", accept: "application/json",
                    "user-agent": validUA(state.userAgent) ? state.userAgent : CONFIG.fallbackUA },
                body: "event=checkin", timeout: CONFIG.requestTimeoutMs,
                redirect: "manual", credentials: "omit", insecureTls: false
            };
            console.log("[蔚来签到] 提交尝试 " + attempt + "/" + CONFIG.maxAttempts);
            let response;
            try {
                response = await limited(() => {
                    // 在真正调用 POST 前再次校验，不能只依赖进入 Promise 之前的快照。
                    guard(ctx, state, lease, deadline);
                    if (Date.now() >= attemptDeadline) throw new TaskStop("签到未完成", "请求发出前已超过单次预算，本次不提交。");
                    posted = true;
                    return ctx.http.post(url, options);
                }, attemptDeadline - Date.now());
            } catch (error) {
                if (error instanceof TaskStop) throw error;
                keepLease = posted;
                guard(ctx, state, lease, deadline);
                report(ctx, "签到结果未确认", "请求失败或超时，服务端可能已处理；不自动重复提交，任务锁保留至到期。"); return;
            }
            guard(ctx, state, lease, deadline);
            const status = response && response.status;
            if (status === 401) {
                try { invalidate(ctx, state, lease, deadline); }
                catch (error) {
                    if (error instanceof TaskStop) throw error;
                    report(ctx, "授权失败", "失效标记未确认保存，请检查存储并重新登录。"); return;
                }
                report(ctx, "授权失败", "请重新登录蔚来 App 并捕获新凭据。"); return;
            }
            if (status === 429) {
                const delay = retryDelay(header(response.headers, "retry-after"));
                if (!Number.isFinite(delay)) { report(ctx, "请求被限流", "无法识别 Retry-After，本次不自动重试。"); return; }
                if (attempt === CONFIG.maxAttempts || delay + CONFIG.requestTimeoutMs + 500 >= deadline - Date.now()) {
                    report(ctx, "请求被限流", "已达到次数或时间预算，本次不再提交。"); return;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                guard(ctx, state, lease, deadline);
                continue;
            }
            if (status !== 200 && status !== 403) {
                keepLease = true;
                report(ctx, "签到结果未确认", "HTTP 状态异常，未作废凭据；请在 App 查看，不自动重复提交。"); return;
            }
            let result = null;
            try {
                const text = await limited(() => response.text(), Math.min(attemptDeadline, deadline) - Date.now());
                try { result = JSON.parse(text); } catch (_) { /* 不输出服务端正文。 */ }
            } catch (_) {
                keepLease = true;
                guard(ctx, state, lease, deadline);
                report(ctx, "签到结果未确认", "响应读取失败或超时，请在 App 查看；不自动重复提交。"); return;
            }
            guard(ctx, state, lease, deadline);
            const code = record(result) ? result.result_code : undefined;
            if (["invalid_token", "token_expired", "unauthorized"].includes(code)) {
                try { invalidate(ctx, state, lease, deadline); }
                catch (error) {
                    if (error instanceof TaskStop) throw error;
                    report(ctx, "授权失败", "失效标记未确认保存，请检查存储并重新登录。"); return;
                }
                report(ctx, "授权失败", "请重新登录蔚来 App 并捕获新凭据。"); return;
            }
            if (status === 403) { report(ctx, "访问被拒绝", "普通 HTTP 403 可能是权限或风控，未作废凭据；请在 App 检查。"); return; }
            if (!record(result) || code !== "success" || !record(result.data) || result.data.checked_in !== true) {
                keepLease = true;
                report(ctx, "签到未确认", "响应格式或业务状态未确认已签到；不自动重试，也不写每日成功记录。"); return;
            }
            const stats = statistics(result.data);
            const latest = guard(ctx, state, lease, deadline).journal;
            const confirmedAt = Date.now();
            try {
                writeVerified(ctx, CONFIG.journalKey, { ...latest, confirmed: {
                    generation: state.generation, day: businessDay(confirmedAt), confirmedAt, stats
                } });
            } catch (_) {
                keepLease = true;
                report(ctx, "今日签到已确认", statsMessage(stats) + "\n本地防重复记录未确认保存，请勿因存储错误立即重复提交。"); return;
            }
            guard(ctx, state, lease, deadline);
            // checked_in=true 不能区分新奖励与已签到，只报告已确认结果。
            report(ctx, "今日签到已确认", statsMessage(stats)); return;
        }
    } catch (error) {
        keepLease = keepLease || (error instanceof TaskStop ? error.keepLease : posted);
        if (error instanceof TaskStop) report(ctx, error.title, error.body);
        else report(ctx, "本地任务未完成", "本地 API 或存储异常，未继续提交；请检查 Egern 日志和 App。");
    } finally {
        // 网络/解析结果未知时保留短租约，不假装可以取消在途请求或马上安全重发。
        if (acquired && !keepLease) release(ctx, lease);
    }
}
function diagnostic(ctx) {
    const lines = ["Egern 原生脚本 " + CONFIG.version];
    try {
        const state = readState(ctx), journal = readJournal(ctx);
        lines.push("凭据：" + (!state ? "尚未捕获" : state.invalid ? "已标记失效，请重新登录" : "已捕获（不显示内容）"));
        const confirmed = state && journal.confirmed && journal.confirmed.generation === state.generation && journal.confirmed.day === businessDay();
        lines.push("今日记录：" + (confirmed ? "已确认" : "未确认"));
        if (confirmed) lines.push(statsMessage(journal.confirmed.stats));
        lines.push("任务锁：" + (journal.lock && journal.lock.expiresAt > Date.now() ? "有效，等待任务结束或到期" : "无有效锁"));
    } catch (_) { lines.push("本地状态无法读取；此诊断不发送签到请求。"); }
    lines.push("仅定时任务执行 POST；诊断不抓取、搬运或输出凭据。");
    for (const line of lines) console.log("[蔚来诊断] " + line);
    return { type: "widget", padding: 12, children: [{ type: "text", text: lines.join("\n") }] };
}

export default async function(ctx) {
    if (ctx.request) {
        // http-request 只抓头，不消费 body；response 上下文误挂载也不重复抓取。
        if (!ctx.response) {
            try { capture(ctx); } catch (_) { report(ctx, "凭据处理未完成", "本地 API 异常，请检查 Egern 后重新打开蔚来 App。"); }
        }
        return;
    }
    if (ctx.response) return;
    if (typeof ctx.cron === "string" && ctx.cron.trim()) { await runCheckin(ctx); return; }
    return diagnostic(ctx);
}
