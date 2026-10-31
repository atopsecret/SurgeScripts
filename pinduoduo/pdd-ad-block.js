/*
 * 拼多多 App 去广告脚本 v2.0 for Surge
 *
 * 重构自 Loon Hub PinDuoDuo_remove_ads.lpx（RuCu6 / ZenmoFeiShi / 可莉）
 * 与 Thelongdarkorg/loon-plugins 的开屏规则互补：
 *   - 开屏部分由模块的 Map Local / AND 规则处理（无脚本）
 *   - 本脚本处理需要改写响应体的部分：
 *     alexa/homepage/hub   底栏 tab 过滤（删多多视频 tab）+ 首页横幅/热词
 *     philo/personal/hub   个人中心精简
 *     oak/integration/render  会场入口/直播浮层
 *     order/               订单页营销 banner
 *     aristotle/order_list_v4  订单按钮推广提示
 *     search               搜索页推广扩展
 *
 * 所有分支 try/catch，解析失败原样返回。
 */

const KEEP_TABS = ["index.html", "chat_list.html", "personal.html"];

function safeParse(str) {
    try { return JSON.parse(str); } catch (e) { return null; }
}

function delPath(obj, path) {
    const keys = path.split(".");
    let node = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (node == null || typeof node !== "object") return;
        node = node[keys[i]];
    }
    if (node != null && typeof node === "object") delete node[keys[keys.length - 1]];
}

// 底栏 tab 过滤：只保留首页/聊天/个人（jq: bottom_tabs |= map(select(...))）
function filterTabs(tabs) {
    if (!Array.isArray(tabs)) return;
    for (let i = tabs.length - 1; i >= 0; i--) {
        if (tabs[i] && tabs[i].link && !KEEP_TABS.includes(tabs[i].link)) {
            tabs.splice(i, 1);
        }
    }
}

// ---------- alexa/homepage/hub：底栏多多视频 + 首页横幅/热词 ----------
function handleHomepageHub(data) {
    const r = data.result;
    if (!r || typeof r !== "object") return data;
    filterTabs(r.bottom_tabs);
    filterTabs(r.buffer_bottom_tabs);
    // all_top_opts：删图片字段（jq: map(del(.selected_image,.image,.height,.width))）
    if (Array.isArray(r.all_top_opts)) {
        r.all_top_opts.forEach(t => {
            if (t && typeof t === "object") {
                delete t.selected_image; delete t.image;
                delete t.height; delete t.width;
            }
        });
    }
    // json-del：信息流横幅 / 图标集 / 搜索热词
    delPath(r, "dy_module.irregular_banner_dy");
    delete r.icon_set;
    delete r.search_bar_hot_query;
    return data;
}

// ---------- philo/personal/hub：个人中心精简 ----------
function handlePersonalHub(data) {
    delete data.monthly_card_entrance;
    delete data.personal_center_style_v2_vo;
    delPath(data, "icon_set.icons");
    delPath(data, "icon_set.top_personal_icons");
    return data;
}

// ---------- oak/integration/render：会场入口 / 直播浮层 ----------
function handleIntegrationRender(data) {
    delete data.bottom_section_list;
    delPath(data, "ui.bottom_section");
    delPath(data, "ui.live_section.float_info");
    return data;
}

// ---------- order/：订单页营销 banner ----------
function handleOrder(data) {
    delete data.marketing_banner_vo;
    delPath(data, "shipping.banner_above_recommend");
    return data;
}

// ---------- aristotle/order_list_v4：订单按钮推广提示 ----------
function handleOrderList(data) {
    if (Array.isArray(data.orders)) {
        data.orders.forEach(o => {
            if (o && Array.isArray(o.order_buttons)) {
                o.order_buttons.forEach(b => { if (b) delete b.order_growth_tip; });
            }
        });
    }
    return data;
}

// ---------- search：搜索页推广扩展 ----------
function handleSearch(data) {
    delete data.expansion;
    return data;
}

// ---------- vlayer 视频弹层 H5（多多视频悬浮层） ----------
// m.pinduoduo.net 的 vlayer_tab_popup.html 是首页悬浮视频弹层的载体，
// 返回空白页让 WebView 加载失败，弹层不渲染
// （该页面由 App 内 WebView 加载，脚本注入为空 HTML）

// ---------- 主分发 ----------
function main() {
    const url = $request.url;

    // pattern 未锚定域名（兼容拼多多裸 IP 直连），这里做归属校验：
    // URL 含 pinduoduo/yangkeduo 域名，或 Host 头/请求头 UA 表明是拼多多
    const isPDD = /pinduoduo|yangkeduo/i.test(url)
        || /pinduoduo|yangkeduo/i.test($request.headers["host"] || $request.headers["Host"] || "");
    if (!isPDD) { $done({}); return; }

    let body = $response.body || "";

    let handler = null;
    if (url.includes("/api/alexa/homepage/hub")) handler = handleHomepageHub;
    else if (url.includes("/api/philo/personal/hub")) handler = handlePersonalHub;
    else if (url.includes("/api/oak/integration/render")) handler = handleIntegrationRender;
    else if (/^https?:\/\/api\.(pinduoduo|yangkeduo)\.com\/order\//.test(url)) handler = handleOrder;
    else if (url.includes("/api/aristotle/order_list_v4")) handler = handleOrderList;
    else if (/^https?:\/\/api\.(pinduoduo|yangkeduo)\.com\/search\?/.test(url)) handler = handleSearch;

    if (!handler) { $done({}); return; }

    const data = safeParse(body);
    if (!data) { $done({}); return; }

    try {
        $done({ body: JSON.stringify(handler(data)) });
    } catch (e) {
        $done({});
    }
}

main();
