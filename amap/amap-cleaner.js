// Engine | Surge iOS 5.9.1+ / Mac 5.5.1+ | JavaScript
// Build: 无需构建
// Run: 导入 amap-adblock.sgmodule；手动运行“高德净化诊断”查看计数
// Deps: Surge 脚本 API；测试：node --test amap/tests/cleaner.test.cjs
// Version: 2.0.0
(function () {
    "use strict";
    const VERSION = "2.0.0";
    const STORE = "skernelx_amap_cleaner_v2";
    const ROUTES = [
        ["notice", /^\/ws\/message\/notice\/list(?:\/|$)/],
        ["home", /^\/ws\/faas\/amap-navigation\/main-page(?:\/|$)/],
        ["message", /^\/ws\/msgbox\/pull(?:\/|$)/],
        ["profile", /^\/ws\/shield\/dsp\/profile\/index\/nodefaas(?:\/|$)/],
        ["hotword", /^\/ws\/shield\/search\/new_hotword(?:\/|$)/],
        ["config", /^\/ws\/shield\/frogserver\/aocs\/updatable(?:\/|$)/],
        ["nearby", /^\/ws\/shield\/search\/nearbyrec_smart(?:\/|$)/],
        ["taxi", /^\/ws\/promotion-web\/resource(?:\/|$)/]
    ];
    const AD_CARDS = ["AdCard", "AdvertCard", "AdvertisingCard", "PromotionCard", "BannerCard", "CommercialCard"];
    const CONFIG_KEYS = ["gd_notch_logo", "home_business_position_config", "his_input_tip", "operation_layer", "SplashScreenControl", "splashview_config"];
    const NEARBY_KEYS = ["coupon", "scene", "activity", "commodity_rec", "operation_activity"];
    function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
    function route(url) {
        const match = /^https?:\/\/(?:[a-z0-9-]+\.)+amap\.com(?::[0-9]+)?(\/[^?#]*)/i.exec(String(url || ""));
        if (!match) return null;
        const found = ROUTES.find(entry => entry[1].test(match[1]));
        return found ? found[0] : null;
    }
    function clear(node, key) {
        if (!record(node)) return;
        if (Array.isArray(node[key])) node[key] = [];
        else if (record(node[key])) node[key] = {};
    }
    function adCard(item) {
        return record(item) && (AD_CARDS.includes(item.dataType) || item.isAd === true || item.is_ad === true || item.adFlag === 1);
    }
    function cards(node, key) {
        if (!record(node)) return;
        const value = node[key];
        if (Array.isArray(value)) node[key] = value.filter(item => !adCard(item));
        else if (record(value)) {
            // 保留字典类型与未识别业务卡片，不把字典转换成数组。
            for (const name of Object.keys(value)) if (adCard(value[name])) delete value[name];
        }
    }
    function clean(id, root) {
        const data = root.data;
        if (id === "notice") clear(data, "noticeList");
        else if (id === "message") {
            clear(root, "msgs"); clear(root.pull3, "msgs");
            clear(data, "msgs"); if (record(data)) clear(data.pull3, "msgs");
        } else if (id === "home" && record(data)) {
            cards(data, "cardList"); cards(data, "mapBizList");
            clear(data, "business_position"); clear(data.pull3, "msgs");
        } else if (id === "profile" && record(data)) {
            delete data.tipData; cards(data, "cardList");
        } else if (id === "hotword") clear(data, "header_hotword");
        else if (id === "config" && record(data)) {
            // 精确配置名；不按 ai_ 等宽泛子串清空导航或 AI 功能。
            for (const key of CONFIG_KEYS) if (record(data[key]) &&
                typeof data[key].value === "string" && typeof data[key].version === "string") {
                data[key] = { ...data[key], status: 1, version: "", value: "" };
            }
        } else if (id === "nearby" && record(data)) {
            for (const key of NEARBY_KEYS) delete data[key];
            if (Array.isArray(data.modules)) data.modules = data.modules.filter(item =>
                !(typeof item === "string" && NEARBY_KEYS.includes(item)));
        } else if (id === "taxi" && record(data)) {
            for (const key of ["icon", "banner", "tips", "popup", "bubble", "other"]) clear(data, key);
        }
    }
    function successful(root) {
        // 高德常见响应状态；任何明确失败均原样保留，不抹掉错误。
        if (root.result !== undefined && ![true, "true", 1, "1", "success"].includes(root.result)) return false;
        if (root.success !== undefined && root.success !== true) return false;
        if (root.code !== undefined && ![1, "1", 0, "0", 200, "200"].includes(root.code)) return false;
        return true;
    }
    function transform(id, body) {
        if (!ROUTES.some(entry => entry[0] === id)) return { status: "unsupported" };
        if (typeof body !== "string" || !body.length) return { status: "empty" };
        let root;
        try { root = JSON.parse(body); } catch (_) { return { status: "format" }; }
        if (!record(root)) return { status: "format" };
        if (!successful(root)) return { status: "server-error" };
        const before = JSON.stringify(root);
        clean(id, root);
        const after = JSON.stringify(root);
        return after === before ? { status: "unchanged" } : { status: "changed", body: after };
    }
    function responseHeaders(input) {
        const output = {};
        const stale = ["content-length", "content-encoding", "transfer-encoding", "etag", "content-md5", "content-type", "cache-control"];
        for (const key of Object.keys(input || {})) if (!stale.includes(key.toLowerCase())) output[key] = input[key];
        output["Content-Type"] = "application/json; charset=utf-8";
        output["Cache-Control"] = "no-store";
        output["X-AMap-Cleaner-Version"] = VERSION;
        return output;
    }
    function load() {
        try {
            const raw = $persistentStore.read(STORE);
            if (!raw) return { version: VERSION, routes: {}, warning: "本版尚无页面处理记录，不能据此判断开屏是否被拦截" };
            const value = JSON.parse(raw);
            if (!record(value) || value.version !== VERSION || !record(value.routes)) {
                return { version: VERSION, routes: {}, warning: "已有统计版本不同或结构不符，以下显示本版零值" };
            }
            return { version: VERSION, routes: value.routes };
        } catch (_) { return { version: VERSION, routes: {}, warning: "本地存储不可读取，以下零值不代表没有命中" }; }
    }
    function count(id, status) {
        // 仅存固定路由名、结果枚举和有限计数，不保存 URL、请求头或响应内容。
        try {
            const value = load();
            const old = record(value.routes[id]) ? value.routes[id] : {};
            const next = {};
            for (const key of ["changed", "unchanged", "empty", "format", "server-error", "http-error"]) {
                const n = old[key]; next[key] = Number.isSafeInteger(n) && n >= 0 ? Math.min(n, 999999) : 0;
            }
            next[status] = Math.min((next[status] || 0) + 1, 999999);
            value.routes[id] = next;
            const routes = {};
            for (const [name] of ROUTES) if (record(value.routes[name])) routes[name] = value.routes[name];
            if ($persistentStore.write(JSON.stringify({ version: VERSION, routes }), STORE) !== true) console.log("[高德净化 " + VERSION + "] 本地计数未保存");
        } catch (_) { /* 诊断不能阻止页面响应。 */ }
    }
    function diagnostic() {
        console.log("[高德净化] 脚本版本 " + VERSION);
        const value = load();
        if (value.warning) console.log("[高德净化] " + value.warning);
        for (const [id] of ROUTES) {
            const row = record(value.routes[id]) ? value.routes[id] : {};
            const number = k => Number.isSafeInteger(row[k]) && row[k] >= 0 ? row[k] : 0;
            console.log("[高德净化] " + id + ": 已改写=" + number("changed") + ", 无变化=" + number("unchanged") +
                ", 格式不符=" + (number("format") + number("empty")) + ", 错误放行=" + (number("server-error") + number("http-error")));
        }
        console.log("[高德净化] 开屏由 Map Local 处理，不计入上述脚本命中。请查 splash_screen_rt 的 Map Local 记录与 X-AMap-Cleaner-Version 响应头。");
    }
    if (typeof module !== "undefined" && module.exports) module.exports = { VERSION, route, transform, responseHeaders };
    if (typeof $done !== "function") return;
    let ended = false;
    function finish(value) { if (!ended) { ended = true; $done(value || {}); } }
    try {
        if (typeof $request === "undefined" || !$request) { diagnostic(); finish(); return; }
        const id = route($request.url);
        if (!id || typeof $response !== "object" || !$response) { finish(); return; }
        const status = Number($response.status);
        const result = status === 200 ? transform(id, $response.body) : { status: "http-error" };
        count(id, result.status);
        console.log("[高德净化 " + VERSION + "] " + id + ": " + result.status);
        finish(result.status === "changed" ? { body: result.body, headers: responseHeaders($response.headers) } : {});
    } catch (_) {
        console.log("[高德净化 " + VERSION + "] 本地处理异常，保留原响应");
        finish();
    }
}());
