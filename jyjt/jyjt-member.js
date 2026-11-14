// Engine | Surge iOS 6.x | JavaScript (WebView)
// Build: node --check jyjt/jyjt-member.js
// Run: 导入同目录 canonical Surge 模块；响应脚本独立执行
// Deps: Surge $request/$response/$done; no network or storage access.
// Decode only valid UTF-8 and retain unknown/error responses byte-for-byte.
// Preserve SOAP/XML whitespace; only complete zero/null values are replaced.
(function () {
  'use strict';
  const VERSION = "1.0.0";
const MATCH = /^http:\/\/smoke\.nxnresearch\.com\/webservice510\.asmx(?:[/?]|$)/i;

// 只替换 JSON 中完整的值，保留 XML、空白及未知字段；不把整份 SOAP 当 JSON 重建。
function transform(body) {
    if (typeof body !== "string" || !body.includes('"member_flg"') ||
        /<(?:[A-Za-z_][\w.-]*:)?Fault(?:\s|>)/i.test(body)) return body;
    return body
        .replace(/("member_flg"\s*:\s*)0(?=\s*[,}])/g, (_match, prefix) => prefix + "1")
        .replace(/("user_type"\s*:\s*)0(?=\s*[,}])/g, (_match, prefix) => prefix + "1")
        .replace(/("member_end_date"\s*:\s*)null(?=\s*[,}])/g, '$1"2099-12-31"');
}


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
function run(){
  if(typeof $request==='undefined'||!$request)return {};
  if(typeof $response!=='object'||!$response||!MATCH.test(String($request.url||''))||Number($response.status)!==200)return {};
  if(!commonAllowed($response.headers,false))return {};
  const bytes=commonBytes($response.body);if(!bytes)return {};
  try{const body=commonDecode(bytes);const encoding=/^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(body);if(encoding&&!/^(?:utf-8|utf8|us-ascii)$/i.test(encoding[1]))return {};
    const output=transform(body);return output===body?{}:{body:new TextEncoder().encode(output),headers:commonResponseHeaders($response.headers,false)};
  }catch(_){return {};}
}
  if (typeof module !== 'undefined' && module.exports) module.exports = { VERSION, transform, run, commonDecode, commonResponseHeaders, commonAllowed };
  if (typeof $done === 'function') {
    let result;
    try { result = run() || {}; } catch (_) { result = {}; }
    $done(result);
  }
}());
