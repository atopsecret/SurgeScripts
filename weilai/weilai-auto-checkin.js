// Engine | Surge iOS / macOS | JavaScript
// Build: 无需构建
// Run: 导入模块后每天 09:00 自动运行；也可手动运行定时任务立即验证
// Deps: Surge 脚本 API；测试：node --test weilai/tests/checkin.test.cjs
// Version: 2.1.6
(function () {
    "use strict";
    const CONFIG = {
        version: "2.1.6",
        stateKey: "weilai_auth_state_v1",
        endpoint: "https://gateway-front-external.nio.com/moat/10086/c/award_cn/checkin",
        budgetMs: 24000, requestTimeoutSeconds: 5, maxAttempts: 3,
        fallbackUA: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NIOAppCN/6.10.0 (com.do1.WeiLaiApp; build:2682; OS:iOS) webview/lg _dsbridge"
    };
    let ended = false, watchdog, retryTimer;
    function finish(subtitle, message) {
        if (ended) return;
        ended = true;
        // Surge JSC 不提供 clearTimeout；ended 同样保护迟到回调和计时器。
        if (typeof clearTimeout === "function") {
            if (watchdog !== undefined) clearTimeout(watchdog);
            if (retryTimer !== undefined) clearTimeout(retryTimer);
        }
        if (subtitle) {
            console.log("[蔚来签到] " + subtitle);
            // message 只来自本地固定文案或经过数字校验的统计；日志不带通知表情。
            if (message) for (const line of message.split("\n")) console.log("[蔚来签到] " + line);
            // 只修饰通知展示；日志和服务器成功条件保持原样。
            const confirmed = subtitle === "今日签到已确认";
            const noticeTitle = confirmed ? "签到成功 ✅" : subtitle;
            const noticeBody = confirmed ? (message || "").replace(/^连续签到：/m, "🔥 连续签到：")
                .replace(/^累计签到：/m, "📊 累计签到：") : message;
            try { $notification.post("蔚来签到", noticeTitle, noticeBody); } catch (_) {}
        }
        $done({});
    }
    function header(headers, name) {
        if (!headers || typeof headers !== "object") return "";
        const key = Object.keys(headers).find(k => k.toLowerCase() === name);
        return key && typeof headers[key] === "string" ? headers[key] : "";
    }
    function validToken(value) {
        return typeof value === "string" && /^Bearer [^\s\x00-\x1f\x7f]{16,4096}$/i.test(value);
    }
    function validUA(value) {
        return typeof value === "string" && /NIOAppCN\//.test(value) &&
            value.length <= 1024 && !/[\r\n]/.test(value);
    }
    function readState() {
        const raw = $persistentStore.read(CONFIG.stateKey);
        if (raw) {
            const state = JSON.parse(raw);
            if (!state || !validToken(state.token) || !Number.isFinite(state.observedAt) ||
                state.observedAt <= 0 || state.observedAt > Date.now() + 300000 ||
                typeof state.invalid !== "boolean") throw new Error("invalid-state");
            return state;
        }
        // 兼容旧存储；下一次抓取迁移为单键写入，不删除旧数据。
        const token = $persistentStore.read("weilai_auth_token");
        const rawTime = $persistentStore.read("weilai_token_last_update");
        if (!token && !rawTime) return null;
        const observedAt = Number(rawTime);
        if (!validToken(token) || !Number.isFinite(observedAt) || observedAt <= 0 ||
            observedAt > Date.now() + 300000) throw new Error("invalid-legacy-state");
        return { token, observedAt, invalid: false };
    }
    function saveState(state) {
        try { return $persistentStore.write(JSON.stringify(state), CONFIG.stateKey) === true; }
        catch (_) { return false; }
    }
    function capture(request) {
        // 不记录完整 URL；限制主机及业务路径，拒绝同名恶意主机。
        if (!/^https:\/\/(?:gateway-front-external\.nio\.com|app\.nio\.com|api\.nio\.com)\/(?:moat\/10086\/+(?:n\/c\/award\/|c\/award_cn\/)|(?:n\/c\/)?(?:account\/user\/|user\/|profile\/)|app\/api\/|api\/)/i.test(String(request.url || ""))) {
            finish(); return;
        }
        const token = header(request.headers, "authorization");
        if (!validToken(token)) { finish(); return; }
        let previous;
        try { previous = readState(); } catch (_) { previous = null; }
        const same = previous && previous.token === token;
        const ua = header(request.headers, "user-agent");
        const state = { token, observedAt: Date.now(), invalid: Boolean(same && previous.invalid),
            userAgent: validUA(ua) ? ua : (same && validUA(previous.userAgent) ? previous.userAgent : "") };
        if (!saveState(state)) {
            finish("凭据保存失败", "客户端存储未确认写入，请检查存储后重新打开蔚来 App。"); return;
        }
        if (!same) finish("凭据已更新", "");
        else finish();
    }
    function statsMessage(data) {
        const stats = data.stats && typeof data.stats === "object" && !Array.isArray(data.stats) ? data.stats : {};
        const award = data.award_info && typeof data.award_info === "object" && !Array.isArray(data.award_info) ? data.award_info : {};
        const consecutiveFields = [
            ["stats.continuous_checkin_days", stats.continuous_checkin_days],
            ["stats.continuous_days", stats.continuous_days],
            ["continuous_checkin_days", data.continuous_checkin_days],
            ["continuous_days", data.continuous_days]
        ];
        // 保留现有字段优先级，再兼容旧版累计字段；零值仍是有效统计。
        const totalFields = [
            ["stats.accumulate_days", stats.accumulate_days], ["accumulate_days", data.accumulate_days],
            ["stats.accumulateDays", stats.accumulateDays], ["accumulateDays", data.accumulateDays],
            ["stats.total_days", stats.total_days], ["total_days", data.total_days],
            ["award_info.accumulate_days", award.accumulate_days], ["award_info.total_days", award.total_days]
        ];
        const first = fields => fields.map(([, value]) => {
            // 只转换有限长度的纯数字串，拒绝任意文本和不安全的整数。
            if (typeof value === "string" && /^[0-9]{1,16}$/.test(value)) value = Number(value);
            return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
        }).find(value => value !== undefined);
        const consecutive = first(consecutiveFields), total = first(totalFields);
        if (consecutive === undefined || total === undefined) {
            // 仅输出固定字段名和类型，不输出响应值或整包正文。
            const types = consecutiveFields.concat(totalFields).map(([name, value]) =>
                name + "=" + (value === undefined ? "missing" : typeof value));
            console.log("[蔚来签到] 统计字段类型：" + types.join(", "));
        }
        return "连续签到：" + (consecutive === undefined ? "未知" : consecutive + " 天") +
            "\n累计签到：" + (total === undefined ? "未知" : total + " 天");
    }
    function markInvalid(token) {
        try {
            const current = readState();
            // 迟到的旧请求不能作废刚抓取的新 Token。
            if (!current || current.token !== token) return true;
            return saveState({ ...current, invalid: true });
        } catch (_) { return false; }
    }
    function runCheckin() {
        console.log("[蔚来签到] 脚本版本 " + CONFIG.version);
        let state;
        try { state = readState(); }
        catch (_) { finish("凭据状态损坏", "请重新打开蔚来 App 抓取凭据。"); return; }
        if (!state || state.invalid) {
            finish("需要更新凭据", "请在蔚来 App 中重新登录并打开签到或个人页面。"); return;
        }
        const deadline = Date.now() + CONFIG.budgetMs;
        watchdog = setTimeout(() => finish("签到结果未确认", "任务超过时间预算；请在 App 查看，不自动重复提交。"), CONFIG.budgetMs);
        function credentialsUnchanged() {
            let current;
            try { current = readState(); }
            catch (_) {
                finish("凭据状态无法读取", "任务已停止，请检查本地存储后重试。"); return false;
            }
            if (!current || current.invalid || current.token !== state.token) {
                finish("凭据状态已变化", "本次旧任务已停止，请使用当前账号重新运行签到任务。"); return false;
            }
            return true;
        }
        function attempt(number) {
            if (ended) return;
            if (!credentialsUnchanged()) return;
            if (deadline - Date.now() < CONFIG.requestTimeoutSeconds * 1000 + 500) {
                finish("签到未完成", "剩余时间不足，请稍后手动运行任务。"); return;
            }
            const request = {
                url: CONFIG.endpoint + "?app_id=10086&timestamp=" + Math.floor(Date.now() / 1000),
                headers: { authorization: state.token, "content-type": "application/x-www-form-urlencoded",
                    accept: "application/json", "user-agent": validUA(state.userAgent) ? state.userAgent : CONFIG.fallbackUA },
                body: "event=checkin", timeout: CONFIG.requestTimeoutSeconds,
                "auto-redirect": false, "auto-cookie": false
            };
            console.log("[蔚来签到] 提交尝试 " + number + "/" + CONFIG.maxAttempts);
            let called = false;
            try {
                $httpClient.post(request, (error, response, text) => {
                    if (ended || called) return;
                    called = true;
                    // 切换账号或抓到新 Token 后，不重发旧凭据，也不把旧结果当作新账号结果。
                    if (!credentialsUnchanged()) return;
                    if (error || !response) {
                        finish("签到结果未确认", "网络请求失败，服务端可能已处理；请在 App 查看，不自动重复提交。"); return;
                    }
                    const status = Number(response.status);
                    let result;
                    try { result = JSON.parse(text); } catch (_) { result = null; }
                    const code = result && result.result_code;
                    // 不根据自由文本猜认证状态，也不输出服务端原文。
                    if (status === 401 || ((status === 200 || status === 403) &&
                        ["invalid_token", "token_expired", "unauthorized"].includes(code))) {
                        const saved = markInvalid(state.token);
                        finish("授权失败", saved ? "请重新登录蔚来 App 并抓取新凭据。" :
                            "失效标记未保存，请检查客户端存储并重新登录。"); return;
                    }
                    if (status === 403) {
                        finish("访问被拒绝", "HTTP 403 可能由权限或风控导致，未作废凭据；请在 App 检查。"); return;
                    }
                    // 只有明确限流才自动重试。网络、解析或 5xx 错误可能发生于写入之后。
                    if (status === 429) {
                        const value = header(response.headers, "retry-after").trim();
                        let delay = 2000;
                        if (value) {
                            if (/^\d+$/.test(value)) delay = Number(value) * 1000;
                            else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) delay = Date.parse(value) - Date.now();
                            else delay = NaN;
                            if (!Number.isFinite(delay)) {
                                finish("请求被限流", "无法识别服务端重试时间，请稍后再运行任务。"); return;
                            }
                            delay = Math.max(1000, delay);
                        }
                        if (number < CONFIG.maxAttempts &&
                            delay + CONFIG.requestTimeoutSeconds * 1000 + 500 < deadline - Date.now()) {
                            retryTimer = setTimeout(() => attempt(number + 1), delay); return;
                        }
                        finish("请求被限流", "已达到重试次数或时间预算，请稍后运行。"); return;
                    }
                    if (status !== 200) {
                        finish("签到结果未确认", "HTTP 状态异常，请在 App 查看；不自动重复提交。"); return;
                    }
                    if (!result || typeof result !== "object" || Array.isArray(result) || code !== "success" ||
                        !result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
                        finish("签到未确认", "响应格式或业务状态异常，请查看 App；本次不自动重试。"); return;
                    }
                    if (result.data.checked_in !== true) {
                        finish("签到未确认", "响应未确认已签到，请查看 App。"); return;
                    }
                    // checked_in=true 无法区分本次首次签到和之前已经签到，统一报告确认结果。
                    const summary = statsMessage(result.data);
                    finish("今日签到已确认", summary);
                });
            } catch (_) {
                finish("签到结果未确认", "请求执行异常，请在 App 查看；不自动重复提交。");
            }
        }
        attempt(1);
    }
    try {
        if (typeof $request !== "undefined" && $request) capture($request);
        else runCheckin();
    } catch (_) {
        finish("任务未完成", "本地处理异常，请重新抓取凭据或检查客户端环境。");
    }
}());
