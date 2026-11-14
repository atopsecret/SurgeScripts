// Engine | Surge iOS 6.x | JavaScript (WebView)
// Build: node --check xianyu/xianyu-ad-block.js
// Run: 导入同目录 canonical Surge 模块；响应脚本独立执行
// Deps: Surge $request/$response/$persistentStore/$done; no network requests.
// Decode only valid UTF-8 and retain unknown/error responses byte-for-byte.
// Diagnostics save only route/status/count, never URLs, headers, account tokens or body.
(function () {
  'use strict';
  const VERSION = "eg-native-20261105-r1";
const SPLASH = /^mtop\.taobao\.idlecommerce\.splash\.(?:async\.)?ads$/;
const TARGET = /^(?:mtop\.taobao\.idlecommerce\.splash\.(?:async\.)?ads|mtop\.idle\.idleadv\.(?:app\.launch\.report|scene\.restore)|mtop\.idle\.ad\.expose|mtop\.taobao\.idle\.user\.strategy\.list|mtop\.taobao\.idlehome\.home\.circle\.list)$/;
const CONTAINERS = new Set(["adMap", "ads", "splashAds", "advertising", "adList", "splashList", "dspList"]);

function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripAds(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 8) return 0;
    let removed = 0;
    for (const key of Object.keys(node)) {
        const value = node[key];
        if (key === "cacheAd" && typeof value === "string" && value.length) {
            node[key] = "";
            removed++;
        } else if (key === "cacheAdInfo" && (record(value) || Array.isArray(value) || typeof value === "string")) {
            delete node[key];
            removed++;
        } else if (CONTAINERS.has(key) && (Array.isArray(value) || record(value))) {
            if (Object.keys(value).length) {
                node[key] = Array.isArray(value) ? [] : {};
                removed++;
            }
        } else if (value && typeof value === "object") removed += stripAds(value, depth + 1);
    }
    return removed;
}

function failed(root) {
    if (root.success === false) return true;
    if (!Object.prototype.hasOwnProperty.call(root, "ret")) return false;
    // ret 的非数组、空数组和失败条目都保留，绝不伪造 SUCCESS。
    return !Array.isArray(root.ret) || !root.ret.length || root.ret.some(value => typeof value !== "string" || !value.startsWith("SUCCESS::"));
}

function clean(api, data) {
    if (SPLASH.test(api)) return stripAds(data);
    if (!record(data)) return 0;
    if (api === "mtop.taobao.idle.user.strategy.list" && Array.isArray(data.strategies)) {
        const before = data.strategies.length;
        data.strategies = data.strategies.filter(item => !record(item) || !["FLOAT_LAYER", "POPUP", "MODAL", "BANNER"].includes(item.type));
        return before - data.strategies.length;
    }
    if (api === "mtop.taobao.idlehome.home.circle.list" && Array.isArray(data.circleList)) {
        let removed = 0;
        for (const circle of data.circleList) {
            const args = record(circle) && record(circle.trackParams) && circle.trackParams.args;
            if (!record(args)) continue;
            for (const key of Object.keys(args)) {
                if (key.startsWith("idleAds")) { delete args[key]; removed++; }
            }
        }
        return removed;
    }
    // 上报和场景恢复仅清理已知容器；服务端 ret、api、v 与未知字段保留。
    return /^mtop\.idle\./.test(api) ? stripAds(data) : 0;
}


  const COMMON_STORE = 'ios_common_xianyu_adblock';
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
  let api;try{const url=new URL($request.url);if(!['http:','https:'].includes(url.protocol)||!/^(?:acs|g-acs|gw)\.m\.(?:goofish|taobao)\.com$/.test(url.hostname)||url.username||url.password)return {};const match=/^\/(?:gw|h5)\/(mtop\.[A-Za-z0-9.]+)(?:\/|$)/.exec(url.pathname);if(!match||!TARGET.test(match[1]))return {};api=match[1];}catch(_){return {};}
  if(Number($response.status)<200||Number($response.status)>=300){commonRemember(api,'http-error');return {};}
  if(!commonAllowed($response.headers,false)){commonRemember(api,'format');return {};}
  const bytes=commonBytes($response.body);if(!bytes)return {};
  try{const root=JSON.parse(commonDecode(bytes));if(!record(root))throw new Error('unknown');if(failed(root)){commonRemember(api,'server-error');return {};}
    const stringData=typeof root.data==='string';const data=stringData?JSON.parse(root.data):root.data;
    let removed=clean(api,data);if(SPLASH.test(api))removed+=stripAds(root);
    if(!removed){commonRemember(api,'unchanged');return {};}
    if(stringData)root.data=JSON.stringify(data);commonRemember(api,'changed',removed);
    return {body:JSON.stringify(root),headers:commonResponseHeaders($response.headers,true)};
  }catch(_){commonRemember(api,'format');return {};}
}
  if (typeof module !== 'undefined' && module.exports) module.exports = { run, commonDecode, commonResponseHeaders, commonAllowed };
  if (typeof $done === 'function') {
    let result;
    try { result = run() || {}; } catch (_) { result = {}; }
    $done(result);
  }
}());
