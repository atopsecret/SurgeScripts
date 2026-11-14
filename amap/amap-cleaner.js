// Engine | Surge iOS 6.x | JavaScript (WebView)
// Build: python3 amap/build.py; python3 amap/build.py --check
// Run: 导入 amap/amap-adblock.sgmodule；手动运行“高德净化诊断”查看本地计数
// Deps: Surge $request/$response/$persistentStore/$done; no network requests.
// Decode only valid UTF-8 and retain unknown/error responses byte-for-byte.
// Diagnostics save only route/status/count, never URLs, headers, account tokens or body.
(function () {
  'use strict';
    // Engine | Surge / Egern 共用纯处理策略 | JavaScript ES module
    // Build: python3 amap/build.py（内联到两个独立客户端脚本，不增加运行时依赖）
    // Run: node --input-type=module --check < amap/amap-policy.js
    // Deps: 无客户端全局、网络、存储或第三方库
    const VERSION = "2.1.0";
    const PATHS = [
        ["notice", "message/notice/list"],
        ["home", "faas/amap-navigation/main-page(?:-assets|-aiqs)?"],
        ["message", "msgbox/pull"],
        ["profile", "shield/dsp/profile/index/nodefaas(?:v3)?"],
        ["hotword", "shield/search/new_hotword"],
        ["config", "shield/frogserver/aocs/updatable"],
        ["nearby", "(?:shield/search/nearbyrec_smart|smartui/near_recommend)"],
        ["taxi", "promotion-web/resource"],
        ["poi", "shield/search/poi/detail"],
        ["suggest", "shield/search_business/process/middleLayer/sug"],
        ["quicklink", "c3frontend/af-search/search"],
        ["taxiOrder", "boss/car/order/content_info"],
        ["hitch", "amap/hitch/passenger/content_info"],
        ["tools", "opc/tools/list"],
        ["scene", "shield/scene/recommend"]
    ];
    const ROUTES = PATHS.map(([id, pattern]) => [id, new RegExp("^/ws/" + pattern + "(?:/|$)")]);
    const AD_CARDS = ["AdCard", "AdvertCard", "AdvertisingCard", "PromotionCard", "BannerCard", "CommercialCard"];
    const CONFIG_KEYS = [
        "gd_notch_logo", "home_business_position_config", "operation_layer", "SplashScreenControl", "splashview_config",
        "adCustomerRetainArchitecture", "adImEntryConfig", "adVenueConfig", "adPerfSwitch", "EndNaviC3AdCard",
        "infoCpcReport", "hotsaleConfig", "marketing_resource_config", "sug_coupon_opt", "giftEntryConfig", "splashscreen",
        "feedback_banner", "TrainOrderBanner", "nearby_business_popup", "shortcut_popup_frequency", "tel_retention_popup",
        "hotel_activity", "taxi_activity", "hotel_privilege", "sportsActivityConfig", "activity_qingke_contry_control",
        "920bestwishes", "homepage_resource_config", "hotel_tipsicon", "sur_bar", "nearby_map_entry_guide"
    ];
    const NEARBY_KEYS = ["coupon", "scene", "activity", "commodity_rec", "operation_activity"];
    const POI_PROMOTIONS = [
        "CouponBanner", "CouponPush", "adStoreBigBannerModule", "adv_gift", "co_branded_card", "common_coupon_bar",
        "common_coupon_card", "ggc_entry", "image_banner", "operation_banner", "new_operation_banner", "matrix_banner",
        "poster_banner", "bigListBizRec", "listBizRec_1", "listBizRec_2", "smallListBizRec", "nearbyRecommendModule",
        "nearbyGoodCar", "nearby_play_rec", "newRelatedRecommends", "relatedRecommends", "waterFallFeed",
        "waterFallFeedTitle", "poiDetailWaterFeed", "poiDetailWaterFeedTitle", "yellowPageAdRecommendModule",
        "shopStructGift", "poiDetailBottomBarOperation", "poiDetailNewBeltV2", "poiDetailNewBeltCardV2"
    ];
    const SCENE_PROMOTIONS = ["ad", "ads", "advertisement", "banner", "promotion", "operation_activity"];
    const TAXI_PROMO_TOOLS = ["dache_toolbox_promo", "dache_toolbox_marketing"];
    const NESTED_REMOVALS = {
        engine_render: ["can_show_advert", "advert_note_num"],
        sportsGroupConfig: ["group_banner"],
        sportsRouteConfig: ["group_banner"],
        his_input_tip: ["channel_zhitiao"],
        navi_end: ["operator_btns"],
        detail_config: ["shelf_coupon_refresh"],
        amap_basemap_config: [
            "splash", "ai_splash", "ipSquare_window_video_config", "usercenter_lottery_switch", "coins_lottery", "coins_wish",
            "newYearLotteryTips", "mileage_coin_scene", "licheng_coin_mine_entry", "member_grabbing",
            "vip_checkout_welfare_dialog_config", "task_poi_card_coupon_switch", "pointExchangeCenter", "pointExchangeGoCommentUrl",
            "recently_activity", "business_position", "mainBubble", "suit_set_popup", "pop_selection", "msgbox_show_popwindow"
        ],
        navi_cloud: [
            "long_trip_service_coupon", "long_trip_service_coupon_enter", "long_trip_service_coupon_links", "QQMusicVipText",
            "QQMusicMembershipVoice", "ETCGuide", "etc_banner", "music_sdk_recommend_title", "voicePlayground",
            "route_search_Starbucks", "Starbucksfinish", "operation_consumer_bubble", "operation_chat_add_group",
            "consumeAfterPopup_days", "Rescue_popup_service"
        ],
        taxi: [
            "denghuo_ad", "banner_picture_url", "intercity_index_page_header", "chauffeurBannerSort", "dache_toolbox_promo",
            "dache_toolbox_marketing", "PaymentOneClickLayerInfo", "s_reward_center_config", "taxi_personal_virtual_gold_url",
            "discount_bubble", "coupon_traction_bubble_v3", "vip-h5", "retainPopupDiscount", "taxi_coupon_entry_new",
            "isUseChauffeurNewMarketingSlot", "operation_module_render_new"
        ]
    };
    const NESTED_ZEROS = {
        his_input_tip: ["his_recommend_bangdan"],
        detail_config: ["isGoodsShelfPerfV2", "NearbySearchOptimization"],
        navi_cloud: ["end_auto_foot_explore", "ExtremelyRecommendCount"],
        taxi: ["recommend_point_optimization", "recommend_point_service_overview", "end_point_optimization", "hitch_way_point_nav_default"],
        favorites_info: ["nearby_picture_on", "nearby_picture_distance"],
        nore_rec: ["recommend"]
    };
    function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
    function owns(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
    function at(value, keys) {
        for (const key of keys) {
            if (!record(value) || !owns(value, key)) return undefined;
            value = value[key];
        }
        return value;
    }
    function route(url) {
        const match = /^https?:\/\/(?:[a-z0-9-]+\.)+amap\.com(?::[0-9]+)?(\/[^?#]*)/i.exec(String(url || ""));
        const found = match && ROUTES.find(entry => entry[1].test(match[1]));
        return found ? found[0] : null;
    }
    function clear(node, key) {
        if (!record(node)) return;
        if (Array.isArray(node[key])) node[key] = [];
        else if (record(node[key])) node[key] = {};
    }
    function remove(node, keys) { if (record(node)) for (const key of keys) delete node[key]; }
    function adCard(item) {
        return record(item) && (AD_CARDS.includes(item.dataType) || item.isAd === true || item.is_ad === true || item.adFlag === 1);
    }
    function cards(node, key) {
        if (!record(node)) return;
        if (Array.isArray(node[key])) node[key] = node[key].filter(item => !adCard(item));
        else if (record(node[key])) for (const name of Object.keys(node[key])) if (adCard(node[key][name])) delete node[key][name];
    }
    function zero(node, key) {
        if (record(node) && owns(node, key) &&
            (typeof node[key] === "number" || typeof node[key] === "boolean" || ["0", "1"].includes(node[key]))) node[key] = 0;
    }
    function config(data) {
        for (const key of CONFIG_KEYS) if (record(data[key]) &&
            typeof data[key].value === "string" && typeof data[key].version === "string") {
            data[key] = { ...data[key], status: 1, version: "", value: "" };
        }
        // 只解析精确配置名；不按 ai_ 等子串清空未知导航、音乐或 AI 功能。
        for (const key of new Set([...Object.keys(NESTED_REMOVALS), ...Object.keys(NESTED_ZEROS)])) {
            if (!record(data[key]) || typeof data[key].value !== "string") continue;
            let inner;
            try { inner = JSON.parse(data[key].value); } catch (_) { continue; }
            if (!record(inner)) continue;
            const before = JSON.stringify(inner);
            remove(inner, NESTED_REMOVALS[key] || []);
            for (const field of NESTED_ZEROS[key] || []) zero(inner, field);
            if (key === "his_input_tip") zero(inner.nearby_hotword, "search_detail");
            const after = JSON.stringify(inner);
            if (before !== after) data[key].value = after;
        }
    }
    function filterRefs(value, removed) {
        return Array.isArray(value) ? value.filter(item => !(typeof item === "string" && removed.has(item))) : value;
    }
    function trimTargets(node, key, targetKey, removed) {
        if (!record(node) || !Array.isArray(node[key])) return;
        node[key] = node[key].filter(item => {
            if (!record(item) || !Array.isArray(item[targetKey])) return true;
            const before = item[targetKey];
            item[targetKey] = filterRefs(before, removed);
            // 原来就是空数组或未知引用时保持；只丢弃目标全部被广告策略移除的项。
            return before.length === 0 || item[targetKey].length !== 0;
        });
    }
    function modules(data, names) {
        const removed = new Set(names);
        if (record(data.modules)) for (const key of Object.keys(data.modules)) {
            if (removed.has(key) || adCard(data.modules[key])) { removed.add(key); delete data.modules[key]; }
        }
        if (record(data.regions)) for (const key of Object.keys(data.regions)) data.regions[key] = filterRefs(data.regions[key], removed);
        if (record(data.meta) && owns(data.meta, "half_hidden_modules")) {
            data.meta.half_hidden_modules = filterRefs(data.meta.half_hidden_modules, removed);
        }
        return removed;
    }
    function poi(data) {
        const removed = modules(data, POI_PROMOTIONS);
        trimTargets(at(data, ["modules", "anchor", "data"]), "items", "anchor", removed);
        trimTargets(at(data, ["modules", "poiDetailCommonConfig", "data", "swipeUpPanelConfig"]), "swipeUpPanelTextList", "modulesMap", removed);
        const comment = at(data, ["modules", "combineReviews", "data", "write_comment"]);
        if (record(comment)) {
            delete comment.btnRightTag;
            if (typeof comment.title === "string" && /赢奖励|赢红包|赚积分|领金币/.test(comment.title)) delete comment.title;
        }
    }
    function promoTool(item) {
        return adCard(item) || (record(item) && record(item.biz) &&
            (adCard(item.biz) || TAXI_PROMO_TOOLS.includes(item.biz.id)));
    }
    function taxiOrder(data) {
        const luban = data.lubanData;
        remove(luban, ["skin", "kingToolBoxBubble", "popup"]);
        const box = at(luban, ["kingToolBox"]);
        if (record(box) && Array.isArray(box.dataList)) box.dataList = box.dataList.filter(item => !promoTool(item));
        const sort = at(luban, ["kingToolSort"]);
        if (record(sort) && Array.isArray(sort.dataList)) for (const item of sort.dataList) {
            const biz = record(item) && item.biz;
            if (record(biz) && Array.isArray(biz.kingToolIdList)) biz.kingToolIdList = biz.kingToolIdList.filter(id => !TAXI_PROMO_TOOLS.includes(id));
        }
    }
    function tools(data) {
        if (!Array.isArray(data.category)) return;
        for (const category of data.category) if (record(category) && Array.isArray(category.tools)) {
            category.tools = category.tools.filter(item => !(record(item) && (item.id === 547 || item.id === "547" || adCard(item))));
            for (const item of category.tools) if (record(item)) delete item.tips;
        }
    }
    function scene(data) {
        const shading = at(data, ["shadingWords", "data"]);
        if (record(shading)) modules(shading, SCENE_PROMOTIONS);
        const recommended = at(data, ["toolsRecommend", "data"]);
        if (record(recommended) && Array.isArray(recommended.default)) {
            recommended.default = recommended.default.filter(item => !(adCard(item) || (record(item) && (item.id === 547 || item.id === "547"))));
        }
    }
    function clean(id, root) {
        const data = root.data;
        if (id === "notice") clear(data, "noticeList");
        else if (id === "message") {
            clear(root, "msgs"); clear(root.pull3, "msgs");
            clear(data, "msgs"); if (record(data)) clear(data.pull3, "msgs");
        } else if (id === "suggest") {
            if (Array.isArray(root.tip_list)) root.tip_list = root.tip_list.filter(item => {
                const tip = record(item) && item.tip;
                return !(adCard(item) || adCard(tip) || (record(tip) &&
                    (["ad", "poi_ad"].includes(tip.result_type) || tip.task_tag === "ad" || tip.datatype_spec === "12" || tip.datatype_spec === 12)));
            });
        } else if (!record(data)) return;
        else if (id === "home") {
            cards(data, "cardList"); cards(data, "mapBizList");
            clear(data, "business_position"); clear(data.pull3, "msgs");
        } else if (id === "profile") { delete data.tipData; cards(data, "cardList"); }
        else if (id === "hotword") clear(data, "header_hotword");
        else if (id === "config") config(data);
        else if (id === "nearby") {
            remove(data, NEARBY_KEYS);
            if (Array.isArray(data.modules)) data.modules = data.modules.filter(item => !(typeof item === "string" && NEARBY_KEYS.includes(item)));
            else if (record(data.modules)) remove(data.modules, NEARBY_KEYS);
        } else if (id === "taxi") {
            for (const key of ["icon", "banner", "tips", "popup", "bubble", "other", "alpha", "bravo", "charlie", "push"]) clear(data, key);
        } else if (id === "poi") poi(data);
        else if (id === "quicklink") {
            const items = at(data, ["modules", "quickLink", "data", "list"]);
            if (Array.isArray(items)) for (const item of items) {
                if (record(item) && record(item.badge) && typeof item.badge.text === "string") item.badge.text = "";
            }
        } else if (id === "taxiOrder") taxiOrder(data);
        else if (id === "hitch") remove(data.lubanData, ["banner"]);
        else if (id === "tools") tools(data);
        else if (id === "scene") scene(data);
    }
    function successful(root) {
        if (root.result !== undefined && ![true, "true", 1, "1", "success"].includes(root.result)) return false;
        if (root.success !== undefined && root.success !== true) return false;
        return root.code === undefined || [1, "1", 0, "0", 200, "200"].includes(root.code);
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
        return before === after ? { status: "unchanged" } : { status: "changed", body: after };
    }

  const COMMON_VERSION = '2.1.0';
  function commonHeader(headers, name) {
    const wanted = name.toLowerCase();
    if (Array.isArray(headers)) {
      const entry = headers.find(item => item && String(item.field || item.name).toLowerCase() === wanted);
      return entry ? String(entry.value || '') : '';
    }
    for (const key of Object.keys(headers || {})) if (key.toLowerCase() === wanted) return String(headers[key] || '');
    return '';
  }
  function commonBytes(body) {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return typeof body === 'string' ? new TextEncoder().encode(body) : null;
  }
  function commonDecode(bytes) {
    const chunks = []; let chunk = '';
    for (let i = 0; i < bytes.length;) {
      const first = bytes[i++]; let point = first, count = 0, minimum = 0;
      if (first >= 0xc2 && first <= 0xdf) { point &= 31; count = 1; minimum = 128; }
      else if (first >= 0xe0 && first <= 0xef) { point &= 15; count = 2; minimum = 2048; }
      else if (first >= 0xf0 && first <= 0xf4) { point &= 7; count = 3; minimum = 65536; }
      else if (first > 127) throw new Error('invalid-utf8');
      for (let j = 0; j < count; j++) {
        const next = bytes[i++];
        if (next === undefined || (next & 192) !== 128) throw new Error('invalid-utf8');
        point = point * 64 + (next & 63);
      }
      if (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error('invalid-utf8');
      chunk += String.fromCodePoint(point);
      if (chunk.length > 8192) { chunks.push(chunk); chunk = ''; }
    }
    chunks.push(chunk); return chunks.join('');
  }
  function commonAllowed(headers, jsonOnly) {
    const type = commonHeader(headers, 'content-type');
    const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(type);
    if (charset && !/^(?:utf-8|utf8|us-ascii)$/i.test(charset[1])) return false;
    return !jsonOnly || !type || /^\s*(?:application\/(?:[\w.+-]+\+)?json|text\/json)\s*(?:;|$)/i.test(type);
  }
  function commonResponseHeaders(input, json, extra) {
    const stale = new Set(['content-length','content-encoding','transfer-encoding','etag','content-md5','cache-control','digest','content-digest','repr-digest']);
    if (json) stale.add('content-type');
    const additions = [{ field: 'Cache-Control', value: 'no-store' }];
    if (json) additions.push({ field: 'Content-Type', value: 'application/json; charset=utf-8' });
    for (const [field, value] of Object.entries(extra || {})) { stale.add(field.toLowerCase()); additions.push({ field, value }); }
    if (Array.isArray(input)) return input.filter(item => item && !stale.has(String(item.field || item.name).toLowerCase())).concat(additions);
    const output = {};
    for (const key of Object.keys(input || {})) if (!stale.has(key.toLowerCase())) output[key] = input[key];
    for (const item of additions) output[item.field] = item.value;
    return output;
  }
    const STORE = "skernelx_amap_cleaner_v2";
    function responseHeaders(input) {
        return commonResponseHeaders(input, true, { 'X-AMap-Cleaner-Version': VERSION });
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
            const number = k => Number.isSafeInteger(row[k]) && row[k] >= 0 ? Math.min(row[k], 999999) : 0;
            console.log("[高德净化] " + id + ": 已改写=" + number("changed") + ", 无变化=" + number("unchanged") +
                ", 格式不符=" + (number("format") + number("empty")) + ", 错误放行=" + (number("server-error") + number("http-error")));
        }
        console.log("[高德净化] 开屏由 Map Local 处理，不计入上述脚本命中。请查 splash_screen_rt 的 Map Local 记录与 X-AMap-Cleaner-Version 响应头。");
    }

function run() {
  if (typeof $request === 'undefined' || !$request) { diagnostic(); return {}; }
  if (typeof $response !== 'object' || !$response) return {};
  const id = route($request.url); if (!id) return {};
  if (Number($response.status) !== 200) { count(id,'http-error'); return {}; }
  if (!commonAllowed($response.headers,false)) { count(id,'format'); return {}; }
  const bytes = commonBytes($response.body); if (!bytes) return {};
  try {
    const result = transform(id,commonDecode(bytes)); count(id,result.status);
    return result.status === 'changed' ? {body:new TextEncoder().encode(result.body),headers:commonResponseHeaders($response.headers,true,{'X-AMap-Cleaner-Version':COMMON_VERSION})} : {};
  } catch (_) { count(id,'format'); return {}; }
}
  if (typeof module !== 'undefined' && module.exports) module.exports = { VERSION, PATHS, route, transform, responseHeaders, run, commonDecode, commonResponseHeaders, commonAllowed };
  if (typeof $done === 'function') {
    let result;
    try { result = run() || {}; } catch (_) { result = {}; }
    $done(result);
  }
}());
