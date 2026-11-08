// Engine | JavaScript ES2020+ | 菜鸟双端共用纯策略
// Build: node cainiao/build.mjs
// Run: 由 Surge 和 Egern 响应脚本在构建时内联
// Deps: 无；不访问网络或存储
// 来源：固定 Kelee 菜鸟活动规则；保留未知物流结构。
const CAINIAO_POLICY = (() => {
    const VERSION = "1.2.0";
    const PAGE_API = "mtop.cainiao.app.e2e.engine.page.fetch";
    const LONGQUAN_API = "mtop.com.cainiao.longquan.place.getpageresourcecontent.cn";
    const HOSTS = new Set([
        "cn-acs.m.cainiao.com",
        "e2e-mtop.cainiao.com",
        "longquan-mtop.cainiao.com",
    ]);

    function record(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function route(urlText) {
        let url;
        try { url = new URL(urlText); } catch (_) { return null; }
        if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.username || url.password) return null;
        const path = url.pathname;
        const page = /^\/gw\/(mtop\.cainiao\.app\.e2e\.engine\.page\.fetch(?:\.cn)?)(?:\/[0-9]+(?:\.[0-9]+)*)?\/?$/.exec(path);
        if (page && (url.hostname === "cn-acs.m.cainiao.com" || url.hostname === "e2e-mtop.cainiao.com")) {
            const api = page[1];
            return { api, kind: "page", pageCn: api.endsWith(".cn"), host: url.hostname };
        }
        const longquan = /^\/gw\/(mtop\.com\.cainiao\.longquan\.place\.getpageresourcecontent\.cn)(?:\/[0-9]+(?:\.[0-9]+)*)?\/?$/.exec(path);
        if (longquan && url.hostname === "longquan-mtop.cainiao.com") {
            return { api: longquan[1], kind: "longquan", pageCn: false, host: url.hostname };
        }
        return null;
    }

    function failed(root) {
        if (root.success === false || root.isSuccess === false) return true;
        if (Object.prototype.hasOwnProperty.call(root, "code") && root.code !== null && root.code !== "" && ![0, "0", 200, "200"].includes(root.code)) return true;
        if (!Object.prototype.hasOwnProperty.call(root, "ret")) return false;
        return !Array.isArray(root.ret) || root.ret.some(value => typeof value !== "string" || !value.startsWith("SUCCESS::"));
    }

    function deleteExisting(root, path, allowed) {
        const parts = path.split(".");
        let node = root;
        for (const part of parts.slice(0, -1)) {
            if (!record(node) || !Object.prototype.hasOwnProperty.call(node, part)) return false;
            node = node[part];
        }
        const key = parts[parts.length - 1];
        if (!record(node) || !Object.prototype.hasOwnProperty.call(node, key)) return false;
        if (!allowed(node[key])) return false;
        delete node[key];
        return true;
    }

    function clean(routeInfo, root) {
        if (!record(root)) return 0;
        let removed = 0;
        const container = value => record(value) || Array.isArray(value);
        if (routeInfo.kind === "page") {
            removed += Number(deleteExisting(root, "data.data.data.mainSearch.bizData.searchContents", Array.isArray));
            removed += Number(deleteExisting(root, "data.data.data.operationList", Array.isArray));
            // 仅 e2e 的 .fetch.cn 别名额外处理三个已知运营容器。
            if (routeInfo.pageCn && routeInfo.host === "e2e-mtop.cainiao.com") {
                removed += Number(deleteExisting(root, "data.data.banner", container));
                removed += Number(deleteExisting(root, "data.data.activity", container));
                removed += Number(deleteExisting(root, "data.data.vip", container));
            }
        } else if (routeInfo.kind === "longquan") {
            removed += Number(deleteExisting(root, "data.result.placeContentMap.780001.contentList", Array.isArray));
        }
        return removed;
    }

    // 严格 UTF-8 解码；无效字节保持原响应，不替换成 U+FFFD 后改写。
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

    return { VERSION, PAGE_API, LONGQUAN_API, record, route, failed, clean, decodeUTF8 };
})();
