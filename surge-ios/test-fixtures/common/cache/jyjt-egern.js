// Engine | Egern 原生脚本 API | JavaScript ES module
// Build: 无需构建
// Run: 导入 jyjt-member.egern.yaml；重新产生已知 SOAP 接口请求
// Deps: Egern ctx API；测试：node --experimental-vm-modules --test jyjt/tests/egern.test.cjs
// Version: 1.0.0
// Author: Pier；原 Surge 客户端标志实现 jyjt-member.js 保留不变。

export const VERSION = "1.0.0";
export const MATCH = /^http:\/\/smoke\.nxnresearch\.com\/webservice510\.asmx(?:[/?]|$)/i;

// 只替换 JSON 中完整的值，保留 XML、空白及未知字段；不把整份 SOAP 当 JSON 重建。
export function transform(body) {
    if (typeof body !== "string" || !body.includes('"member_flg"') ||
        /<(?:[A-Za-z_][\w.-]*:)?Fault(?:\s|>)/i.test(body)) return body;
    return body
        .replace(/("member_flg"\s*:\s*)0(?=\s*[,}])/g, (_match, prefix) => prefix + "1")
        .replace(/("user_type"\s*:\s*)0(?=\s*[,}])/g, (_match, prefix) => prefix + "1")
        .replace(/("member_end_date"\s*:\s*)null(?=\s*[,}])/g, '$1"2099-12-31"');
}

// 保存原字节之后严格解码，非 UTF-8 或非目标响应原样返回，不依赖额外运行时。
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
function responseHeaders(input) {
    const stale = ["content-length", "content-encoding", "transfer-encoding", "etag", "content-md5", "cache-control", "digest", "content-digest", "repr-digest"];
    // Content-Type 保持 SOAP/XML 原值，原 Headers 上只改目标头，不枚举或重建其他头。
    const before = stale.map(name => [name, typeof input.getAll === "function" ? input.getAll(name) :
        (input.get(name) === null ? [] : [input.get(name)])]);
    try {
        for (const name of stale) input.delete(name);
        input.set("Cache-Control", "no-store");
        return input;
    } catch (error) {
        for (const [name, saved] of before) {
            try { input.delete(name); for (const value of saved) input.append(name, value); } catch (_) {}
        }
        throw error;
    }
}

export default async function(ctx) {
    if (!ctx.request || !ctx.response || !MATCH.test(String(ctx.request.url || "")) || ctx.response.status !== 200) return;
    try {
        const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(ctx.response.headers.get("Content-Type") || "");
        if (charset && !/^(?:utf-8|utf8|us-ascii)$/i.test(charset[1])) return;
    } catch (_) { return; }
    let bytes;
    try { bytes = new Uint8Array(await ctx.response.arrayBuffer()); }
    catch (_) { return; } // 流本身读取失败不能用第二次读取或空正文伪造“放行”。
    try {
        const body = decodeUTF8(bytes);
        const encoding = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(body);
        if (encoding && !/^(?:utf-8|utf8|us-ascii)$/i.test(encoding[1])) return { body: bytes };
        const output = transform(body);
        return output === body ? { body: bytes } : { body: output, headers: responseHeaders(ctx.response.headers) };
    } catch (_) { return { body: bytes }; }
}
