// Engine | Egern 原生脚本 API | JavaScript ES module
// Build: 无需构建
// Run: 导入 weilai-auto-checkin.egern.yaml；重新捕获凭据；定时任务每天 09:00
// Deps: Egern ctx API；测试：node --experimental-vm-modules --test weilai/tests/egern.test.cjs
// Version: 3.1.1
// Author: atopsecret；与本目录 Surge 版使用相同业务路径，凭据存储独立。

export const CONFIG = Object.freeze({
    version: "3.1.1",
    stateKey: "weilai_egern_auth_state_v1",
    journalKey: "weilai_egern_checkin_v1",
    statisticsKey: "weilai_egern_statistics_v1",
    captureNoticeKey: "weilai_egern_capture_notice_v1",
    captureNoticeCooldownMs: 30000,
    endpoint: "https://gateway-front-external.nio.com/moat/10086/c/award_cn/checkin",
    budgetMs: 24000,
    requestTimeoutMs: 5000,
    leaseMs: 30000,
    maxObservationBytes: 262144,
    maxAttempts: 3,
    fallbackUA: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NIOAppCN/6.10.0 (com.do1.WeiLaiApp; build:2682; OS:iOS) webview/lg _dsbridge"
});
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const validTime = value => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= Date.now() + 300000;
const statNumber = value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validStats = value => record(value) && Object.keys(value).every(key =>
    ["consecutive", "total"].includes(key) && statNumber(value[key]));
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
    // 原生 JSON 编码器不保证对象键顺序；统一存取原始字符串，仍回读验证真正写入。
    const encoded = JSON.stringify(value);
    ctx.storage.set(key, encoded);
    if (ctx.storage.get(key) !== encoded) throw new Error("storage-not-confirmed");
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
function claimCaptureNotice(ctx) {
    // 只合并凭据提醒；每次有效捕获仍照常保存，提醒记录不含 Token 或账号代号。
    try {
        const now = Date.now(), raw = ctx.storage.get(CONFIG.captureNoticeKey);
        const previous = typeof raw === "string" && /^[0-9]{1,16}$/.test(raw) ? Number(raw) : 0;
        if (statNumber(previous) && previous > 0 && previous <= now && now - previous < CONFIG.captureNoticeCooldownMs) return false;
        writeVerified(ctx, CONFIG.captureNoticeKey, now);
        return true;
    } catch (_) {
        // 可选提醒失败不能把已经保存成功的凭据说成保存失败，也不补发网络请求。
        console.log("[蔚来签到] 凭据提醒暂未发送。");
        return false;
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
    if (!same) report(ctx, "凭据已更新", "", claimCaptureNotice(ctx));
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
            !validStats(item.stats)) {
            throw new StateFormatError("invalid-confirmation");
        }
        if (item.fields !== undefined && !validFieldTypes(item.fields)) {
            // 可选诊断元数据损坏时只丢弃本次读取的元数据，不作废有效签到和锁。
            console.log("[蔚来签到] 统计字段诊断不可用；签到确认仍有效。");
            return { version: 1, lock: saved.lock, confirmed: { ...item, fields: undefined } };
        }
    }
    return { version: 1, lock: saved.lock, confirmed: saved.confirmed };
}
function statisticFields(data) {
    const stats = record(data.stats) ? data.stats : {};
    const award = record(data.award_info) ? data.award_info : {};
    const consecutiveFields = [
        ["stats.continuous_checkin_days", stats.continuous_checkin_days],
        ["stats.continuous_days", stats.continuous_days],
        ["continuous_checkin_days", data.continuous_checkin_days],
        ["continuous_days", data.continuous_days]
    ];
    // 保留现有两个字段的优先级，再兼容旧版累计字段；不把缺失值当作零。
    const totalFields = [
        ["stats.accumulate_days", stats.accumulate_days], ["accumulate_days", data.accumulate_days],
        ["stats.accumulateDays", stats.accumulateDays], ["accumulateDays", data.accumulateDays],
        ["stats.total_days", stats.total_days], ["total_days", data.total_days],
        ["award_info.accumulate_days", award.accumulate_days], ["award_info.total_days", award.total_days]
    ];
    return { consecutiveFields, totalFields };
}
function fieldTypes(data) {
    const { consecutiveFields, totalFields } = statisticFields(data);
    return Object.fromEntries(consecutiveFields.concat(totalFields).map(([name, value]) => [name,
        value === undefined ? "missing" : value === null ? "null" : Array.isArray(value) ? "array" : typeof value]));
}
function validFieldTypes(value) {
    if (!record(value)) return false;
    const names = Object.keys(fieldTypes({}));
    const types = ["missing", "null", "array", "string", "number", "boolean", "object"];
    return Object.keys(value).length === names.length && names.every(name =>
        Object.prototype.hasOwnProperty.call(value, name) && types.includes(value[name]));
}
function statistics(data) {
    const { consecutiveFields, totalFields } = statisticFields(data);
    const first = fields => fields.map(([, value]) => {
        // 只转换有限长度的纯数字串；不接受布尔值、指数、小数或任意文本。
        if (typeof value === "string" && /^[0-9]{1,16}$/.test(value)) value = Number(value);
        return statNumber(value) ? value : undefined;
    }).find(value => value !== undefined);
    const consecutive = first(consecutiveFields), total = first(totalFields);
    if (consecutive === undefined || total === undefined) {
        // 固定字段名与类型便于诊断缺统计，不记录响应值或整包正文。
        const types = Object.entries(fieldTypes(data)).map(([name, type]) => name + "=" + type);
        console.log("[蔚来签到] 统计字段类型：" + types.join(", "));
    }
    const output = {};
    if (consecutive !== undefined) output.consecutive = consecutive;
    if (total !== undefined) output.total = total;
    return output;
}
function matchingObservation(ctx, state, now = Date.now()) {
    try {
        const saved = readJSON(ctx, CONFIG.statisticsKey);
        if (saved === null) return null;
        if (!record(saved) || saved.version !== 1 || !validId(saved.generation) ||
            !validTime(saved.observedAt) || saved.observedAt > now ||
            saved.day !== businessDay(saved.observedAt) || !validStats(saved.stats)) {
            throw new StateFormatError("invalid-statistics");
        }
        if (saved.generation !== state.generation || saved.day !== businessDay(now)) return null;
        if (!validFieldTypes(saved.fields)) {
            console.log("[蔚来签到] 统计观察的字段诊断不可用；仅保留已校验数字。");
            return { ...saved, fields: undefined };
        }
        return saved;
    } catch (_) {
        // 可选统计观察损坏不能作废凭据、覆盖任务锁或阻止已确认签到。
        console.log("[蔚来签到] 本地统计观察记录不可用；未改动签到状态。");
        return null;
    }
}
function completeStatistics(base, observed) {
    const output = { ...base };
    for (const name of ["consecutive", "total"]) {
        if (!statNumber(output[name]) && observed && statNumber(observed.stats[name])) output[name] = observed.stats[name];
    }
    return output;
}
// 与项目其它原生模块相同：保留原字节后严格解码，不依赖额外运行时。
function decodeUTF8(bytes) {
    const parts = [];
    let chunk = "";
    for (let i = 0; i < bytes.length;) {
        const first = bytes[i++];
        let point = first, count = 0, minimum = 0;
        if (first >= 0xc2 && first <= 0xdf) { point &= 0x1f; count = 1; minimum = 0x80; }
        else if (first >= 0xe0 && first <= 0xef) { point &= 0x0f; count = 2; minimum = 0x800; }
        else if (first >= 0xf0 && first <= 0xf4) { point &= 0x07; count = 3; minimum = 0x10000; }
        else if (first > 0x7f) throw new Error("invalid-utf8");
        for (let j = 0; j < count; j++) {
            const next = bytes[i++];
            if (next === undefined || (next & 0xc0) !== 0x80) throw new Error("invalid-utf8");
            point = point * 64 + (next & 0x3f);
        }
        if (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error("invalid-utf8");
        chunk += String.fromCodePoint(point);
        if (chunk.length >= 8192) { parts.push(chunk); chunk = ""; }
    }
    parts.push(chunk);
    return parts.join("");
}
async function observeStatistics(ctx) {
    if (!ctx.request || !/^https:\/\/gateway-front-external\.nio\.com\/moat\/10086\/c\/award_cn\/checkin(?:\?|$)/i.test(String(ctx.request.url || "")) ||
        !["GET", "POST"].includes(String(ctx.request.method || "").toUpperCase()) || ctx.response.status !== 200 ||
        ctx.response.body === null) return;
    let snapshot;
    const startedAt = Date.now();
    try {
        snapshot = readState(ctx);
        if (!snapshot || snapshot.invalid || header(ctx.request.headers, "authorization") !== snapshot.token) return;
        const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(header(ctx.response.headers, "Content-Type"));
        if (charset && !/^(?:utf-8|utf8|us-ascii)$/i.test(charset[1])) return;
    } catch (_) { return; }
    let bytes;
    // 不独立 race 正文读取：超时后底层读取未取消，提前返回会丢掉稍后读完的原字节。
    // 执行超时与正文大小由原生 YAML 负责，正文只消费一次并显式回传。
    try { bytes = new Uint8Array(await ctx.response.arrayBuffer()); }
    catch (_) {
        // 读取失败没有足够字节重建正文；不二次消费，也不伪造空响应。
        console.log("[蔚来签到] 统计观察正文未读完；未补发请求。");
        return;
    }
    try {
        if (bytes.length > CONFIG.maxObservationBytes) return { body: bytes };
        const result = JSON.parse(decodeUTF8(bytes).replace(/^\uFEFF/, ""));
        if (!record(result) || result.result_code !== "success" || !record(result.data) || result.data.checked_in !== true) return { body: bytes };
        const now = Date.now(), current = readState(ctx);
        if (!current || current.invalid || current.token !== snapshot.token || current.generation !== snapshot.generation ||
            businessDay(startedAt) !== businessDay(now)) return { body: bytes };
        const previous = matchingObservation(ctx, current, now);
        const stats = { ...(previous ? previous.stats : {}), ...statistics(result.data) };
        writeVerified(ctx, CONFIG.statisticsKey, {
            version: 1, generation: current.generation, day: businessDay(now), observedAt: now,
            stats, fields: fieldTypes(result.data)
        });
        console.log("[蔚来签到] 当日统计已观察；未额外发送请求。");
    } catch (_) {
        console.log("[蔚来签到] 统计观察未保存；原响应保持不变。");
    }
    // 只返回已取得的原字节，不修改状态码、请求头或响应头，也不写任务记录键。
    return { body: bytes };
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
        const stats = completeStatistics(journal.confirmed.stats, matchingObservation(ctx, state));
        report(ctx, "今日签到已确认（本地记录）", statsMessage(stats) + "\n本次未发送签到请求。"); return;
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
            const stats = completeStatistics(statistics(result.data), matchingObservation(ctx, state));
            const latest = guard(ctx, state, lease, deadline).journal;
            const confirmedAt = Date.now();
            try {
                writeVerified(ctx, CONFIG.journalKey, { ...latest, confirmed: {
                    generation: state.generation, day: businessDay(confirmedAt), confirmedAt, stats, fields: fieldTypes(result.data)
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
        if (confirmed) {
            const observed = matchingObservation(ctx, state), stats = completeStatistics(journal.confirmed.stats, observed);
            lines.push(statsMessage(stats));
            if (!statNumber(journal.confirmed.stats.total) && observed && statNumber(observed.stats.total)) {
                lines.push("累计来源：当日同凭据的已观察响应");
            }
            if (!statNumber(stats.total)) {
                const fields = (observed && observed.fields) || journal.confirmed.fields;
                lines.push(fields ? "累计字段类型：" + statisticFields({}).totalFields.map(([name]) => name + "=" + fields[name]).join(", ") :
                    "旧记录没有字段类型；可打开蔚来签到页等待新响应观察。");
            }
        }
        lines.push("任务锁：" + (journal.lock && journal.lock.expiresAt > Date.now() ? "有效，等待任务结束或到期" : "无有效锁"));
    } catch (_) { lines.push("本地状态无法读取；此诊断不发送签到请求。"); }
    lines.push("仅定时任务执行 POST；诊断不抓取、搬运或输出凭据。");
    for (const line of lines) console.log("[蔚来诊断] " + line);
    return { type: "widget", padding: 12, children: [{ type: "text", text: lines.join("\n") }] };
}

export default async function(ctx) {
    if (ctx.response) return observeStatistics(ctx);
    if (ctx.request) {
        // http-request 只抓头，不消费正文、不执行签到；response 入口也不重新抓取凭据。
        try { capture(ctx); } catch (_) { report(ctx, "凭据处理未完成", "本地 API 异常，请检查 Egern 后重新打开蔚来 App。"); }
        return;
    }
    if (typeof ctx.cron === "string" && ctx.cron.trim()) { await runCheckin(ctx); return; }
    return diagnostic(ctx);
}
