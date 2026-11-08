// Engine | Egern 原生 API | JavaScript ES module
// Build: cd apple-weather && npm run build
// Run: Egern 导入 apple-weather-enhancer.egern.yaml；离线 npm test
// Deps: 构建时固定 WeatherKit 核心；运行时无外部模块
import { createEngine } from 'weatherkit-core';
import { LIMIT, createRuntime, diagnostics, readOptions, saveDiagnostic } from './runtime.mjs';
export { createEngine };

function validRoot(bytes) {
    if (bytes.length < 12 || bytes.length > LIMIT) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const root = view.getUint32(0, true);
    if (root < 4 || root % 4 || root + 4 > bytes.length) return false;
    const table = root - view.getInt32(root, true);
    if (table < 4 || table + 4 > bytes.length) return false;
    const vlen = view.getUint16(table, true);
    const tlen = view.getUint16(table + 2, true);
    if (vlen < 4 || vlen % 2 || table + vlen > bytes.length || tlen < 4 || root + tlen > bytes.length) return false;
    for (let offset = table + 4; offset < table + vlen; offset += 2) {
        const field = view.getUint16(offset, true);
        if (field && (field < 4 || field + 4 > tlen)) return false;
    }
    return true;
}

function changed(first, second) {
    if (typeof first === 'string') return first !== second;
    return first.length !== second.length || first.some((byte, index) => byte !== second[index]);
}

export default async function(ctx) {
    if (!ctx.request) return diagnostics(ctx);
    if (!ctx.response || ctx.request.method === 'HEAD') return;
    let url;
    try {
        url = new URL(ctx.request.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'weatherkit.apple.com' || url.username || url.password || url.port) return;
    } catch (_) { return; }
    const kind = url.pathname.startsWith('/api/v1/availability/') ? 'availability'
        : url.pathname.startsWith('/api/v2/weather/') ? 'weather' : '';
    if (!kind) return;
    if (ctx.response.status < 200 || ctx.response.status >= 300 || ctx.response.status === 204) {
        saveDiagnostic(ctx, kind, 'HTTP 非成功或空响应，未读取');
        return;
    }
    const type = (ctx.response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (kind === 'availability' ? !['application/json', 'text/json'].includes(type) : type !== 'application/vnd.apple.flatbuffer') {
        saveDiagnostic(ctx, kind, '未知媒体类型，未读取');
        return;
    }
    if (kind === 'weather') {
        const match = url.pathname.match(/^\/api\/v2\/weather\/\w+(?:-\w+)?(?:-[A-Z]{2})?\/(-?\d+\.?\d*)\/(-?\d+\.?\d*)$/i);
        if (!match || Math.abs(Number(match[1])) > 90 || Math.abs(Number(match[2])) > 180) return;
    }
    let original;
    try {
        original = kind === 'availability' ? await ctx.response.text() : new Uint8Array(await ctx.response.arrayBuffer());
    } catch (_) {
        saveDiagnostic(ctx, kind, '正文读取失败，无法重建未读部分');
        return;
    }
    const restore = status => {
        saveDiagnostic(ctx, kind, status);
        return { body: original };
    };
    try {
        if (original.length > LIMIT) return restore('正文过大，保留原文');
        if (kind === 'availability') {
            const data = JSON.parse(original);
            if (!Array.isArray(data) || !data.every(value => typeof value === 'string')) return restore('未知 JSON 结构，保留原文');
        } else if (!validRoot(original)) return restore('无效 FlatBuffers 根表，保留原字节');
        const options = readOptions(ctx.env);
        const runtime = createRuntime(ctx, options);
        const core = createEngine(runtime);
        const response = await core.Response({ url: url.toString() }, {
            headers: { 'content-type': type },
            body: original,
        });
        if (runtime.failed) return restore('数据源或上游处理失败，保留原文');
        const output = response.body;
        if (kind === 'weather' && (!(output instanceof Uint8Array) || !validRoot(output))) return restore('编码结果无效，保留原字节');
        if (!changed(original, output)) return restore('无需改写，保留原文');
        // Egern 的 Headers 对象本身可返回；不依赖文档未保证的可迭代接口。
        for (const header of ['content-length', 'content-encoding', 'transfer-encoding', 'etag', 'content-md5', 'digest']) ctx.response.headers.delete(header);
        saveDiagnostic(ctx, kind, '已改写', { externalRequests: runtime.calls });
        return { headers: ctx.response.headers, body: output };
    } catch (_) {
        // 不打印异常详情：上游异常可能包含定位 URL 或 API 令牌。
        return restore('参数、解析或处理失败，保留原文');
    }
}
