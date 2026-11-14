// Engine | Surge iOS 6.x | JavaScript (WebView)
// Build: node --check pinduoduo/pdd-ad-block.js
// Run: 导入同目录 canonical Surge 模块；响应脚本独立执行
// Deps: Surge $request/$response/$persistentStore/$done; no network requests.
// Decode only valid UTF-8 and retain unknown/error responses byte-for-byte.
// Diagnostics save only route/status/count, never URLs, headers, account tokens or body.
// Sources: Thelongdarkorg/loon-plugins; RuCu6 / ZenmoFeiShi / 可莉 (see README).
(function () {
  'use strict';
  const VERSION = "eg-native-20261105-r1";
const STORE = "skernelx_pdd_native_diag_v1";
const KEEP_TABS = ["index.html", "chat_list.html", "personal.html"];
const API_HOSTS = ["api.pinduoduo.com", "api.yangkeduo.com"];

function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function header(headers,name){return commonHeader(headers,name);}

function bareIP(hostname) {
    if (/^\[[0-9a-f:]+\]$/i.test(hostname)) return true;
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) && hostname.split(".").every(part => Number(part) <= 255);
}

function owned(request, url) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    if (API_HOSTS.includes(url.hostname)) return true;
    if (!bareIP(url.hostname)) return false;
    // 裸 IP 直连只接受已知 API 的精确 Host；域名子串和 UA 均不能替代它。
    const match = /^(api\.(?:pinduoduo|yangkeduo)\.com)(?::([0-9]{1,5}))?$/.exec(header(request.headers, "host").trim().toLowerCase());
    return Boolean(match && (!match[2] || Number(match[2]) > 0 && Number(match[2]) <= 65535));
}

function apiPath(pathname) {
    const known = new Map([
        ["/api/alexa/homepage/hub", "homepage"],
        ["/api/philo/personal/hub", "personal"],
        ["/api/oak/integration/render", "integration"],
        ["/api/aristotle/order_list_v4", "order-list"],
        ["/search", "search"]
    ]);
    return known.get(pathname) || (pathname.startsWith("/order/") ? "order" : "");
}

function delPath(root, path) {
    const keys = path.split(".");
    let node = root;
    for (const key of keys.slice(0, -1)) {
        if (!record(node)) return;
        node = node[key];
    }
    if (record(node)) delete node[keys[keys.length - 1]];
}

function filterTabs(tabs) {
    if (!Array.isArray(tabs) || !tabs.every(item => record(item) && typeof item.link === "string")) return { tabs, removed: 0 };
    // 只有识别到首页、聊天、个人三个核心入口，才使用原来源的导航白名单。
    // 缺少核心入口、对象类型变化或新协议时整份导航原样保留，避免清空底栏。
    if (!KEEP_TABS.every(link => tabs.some(item => item.link === link))) return { tabs, removed: 0 };
    const kept = tabs.filter(item => KEEP_TABS.includes(item.link));
    return { tabs: kept, removed: tabs.length - kept.length };
}

function failed(data) {
    return data.success === false || data.is_success === false || data.error_code !== undefined && ![0, "0", null, ""].includes(data.error_code);
}

function clean(data, api) {
    let removed = 0;
    if (api === "homepage" && record(data.result)) {
        const root = data.result;
        for (const key of ["bottom_tabs", "buffer_bottom_tabs"]) {
            const filtered = filterTabs(root[key]);
            if (filtered.removed) { root[key] = filtered.tabs; removed += filtered.removed; }
        }
        if (Array.isArray(root.all_top_opts)) {
            for (const option of root.all_top_opts) {
                if (!record(option)) continue;
                for (const key of ["selected_image", "image", "height", "width"]) delete option[key];
            }
        }
        delPath(root, "dy_module.irregular_banner_dy");
        delete root.icon_set;
        delete root.search_bar_hot_query;
    } else if (api === "personal") {
        delete data.monthly_card_entrance;
        delete data.personal_center_style_v2_vo;
        delPath(data, "icon_set.icons");
        delPath(data, "icon_set.top_personal_icons");
    } else if (api === "integration") {
        delete data.bottom_section_list;
        delPath(data, "ui.bottom_section");
        delPath(data, "ui.live_section.float_info");
    } else if (api === "order") {
        delete data.marketing_banner_vo;
        delPath(data, "shipping.banner_above_recommend");
    } else if (api === "order-list" && Array.isArray(data.orders)) {
        for (const order of data.orders) {
            if (!record(order) || !Array.isArray(order.order_buttons)) continue;
            for (const button of order.order_buttons) if (record(button)) delete button.order_growth_tip;
        }
    } else if (api === "search") delete data.expansion;
    return removed;
}


  const COMMON_STORE = 'ios_common_pdd_adblock';
  const COMMON_VERSION = 'eg-native-20261105-r1';
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
  function commonRemember(route, status, removed) {
    try {
      const saved = JSON.parse($persistentStore.read(COMMON_STORE) || '{}');
      const state = saved && saved.version === COMMON_VERSION ? saved : { version: COMMON_VERSION, hits: 0, routes: {} };
      state.hits = Math.min((Number(state.hits) || 0) + 1, 999999);
      state.route = String(route); state.status = status; state.at = new Date().toISOString();
      state.removed = Math.max(0, Number(removed) || 0);
      state.routes = state.routes && typeof state.routes === 'object' ? state.routes : {};
      const row = state.routes[route] || {};
      row[status] = Math.min((Number(row[status]) || 0) + 1, 999999);
      state.routes[route] = row;
      $persistentStore.write(JSON.stringify(state), COMMON_STORE);
    } catch (_) { /* Diagnostic storage is not required for response handling. */ }
  }
  function commonDiagnostic() {
    let saved = {};
    try { saved = JSON.parse($persistentStore.read(COMMON_STORE) || '{}'); } catch (_) {}
    console.log(JSON.stringify({ version: COMMON_VERSION, hits: Number(saved.hits) || 0, route: saved.route || null, status: saved.status || 'no-record', at: saved.at || null, removed: Number(saved.removed) || 0 }));
    return {};
  }

function run(){
  if(typeof $request==='undefined'||!$request)return commonDiagnostic();
  if(typeof $response!=='object'||!$response)return {};
  let api;try{const url=new URL($request.url);if(!owned($request,url))return {};api=apiPath(url.pathname);if(!api)return {};}catch(_){return {};}
  if(Number($response.status)<200||Number($response.status)>=300){commonRemember(api,'http-error');return {};}
  if(!commonAllowed($response.headers,false)){commonRemember(api,'format');return {};}
  const bytes=commonBytes($response.body);if(!bytes)return {};
  try{const data=JSON.parse(commonDecode(bytes));if(!record(data))throw new Error('unknown');if(failed(data)){commonRemember(api,'server-error');return {};}
    const before=JSON.stringify(data),removed=clean(data,api),after=JSON.stringify(data);
    if(before===after){commonRemember(api,'unchanged');return {};}
    commonRemember(api,'changed',removed);return {body:after,headers:commonResponseHeaders($response.headers,true)};
  }catch(_){commonRemember(api,'format');return {};}
}
  if (typeof module !== 'undefined' && module.exports) module.exports = { run, commonDecode, commonResponseHeaders, commonAllowed };
  if (typeof $done === 'function') {
    let result;
    try { result = run() || {}; } catch (_) { result = {}; }
    $done(result);
  }
}());
