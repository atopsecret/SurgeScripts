// 引擎：Node.js 20+ 测试夹具 | 语言：JavaScript CommonJS
// 构建：无需编译
// 运行：由 auth.test.cjs 与 auto.test.cjs 引用
// 依赖：内置库；只有合成 Cookie、模拟存储和模拟网络
const NOW = Date.UTC(2026, 10, 8, 8, 0);
const COOKIE = "unb=synthetic-user-a; cookie2=synthetic-session-a; _m_h5_tk=synthetic-token_1";
const CAPTURE_URL = "https://acs.m.taobao.com/h5/mtop.cainiao.lpc.packageservice.querypdspackagedatalist/1.0/?data=synthetic";

function headers(entries = []) {
    const pairs = entries.map(([name, value]) => [name.toLowerCase(), value]);
    return {
        getAll: name => pairs.filter(([key]) => key === name.toLowerCase()).map(([, value]) => value),
        get: name => {
            const values = pairs.filter(([key]) => key === name.toLowerCase()).map(([, value]) => value);
            return values.length ? values.join(", ") : null;
        },
    };
}

const parcel = (id = "a", code = "8-2-2046") => ({mailNo: "SYNTHETIC0000" + id, logisticsStatus: "AGENT_SIGN", partnerName: "合成快递", packageStation: {stationId: "synthetic-station", stationName: "合成驿站", authCode: code}});
const response = (body, cookies = [], status = 200) => ({status, headers: headers(cookies.map(cookie => ["set-cookie", cookie])), text: async () => typeof body === "string" ? body : JSON.stringify(body)});
const success = (packages = [parcel()], totalPage = 1, currentPage = 1) => response({ret: ["SUCCESS::成功"], data: {packages, totalPage, currentPage}});

function fixture(replies = []) {
    const memory = new Map(), requests = [], writes = [];
    let now = NOW;
    const ctx = {
        env: {}, widgetFamily: "systemMedium",
        storage: {
            getJSON: key => structuredClone(memory.get(key) ?? null),
            setJSON: (key, value) => {writes.push({key, value: structuredClone(value)}); memory.set(key, structuredClone(value));},
        },
        http: {get: async (url, options) => {
            requests.push({url: new URL(url), options});
            const reply = replies.shift();
            if (typeof reply === "function") return reply(url, options);
            if (reply instanceof Error) throw reply;
            if (!reply) throw new Error("synthetic-offline");
            return reply;
        }},
    };
    const incoming = (cookie = COOKIE, url = CAPTURE_URL, additionalHeaders = []) => ({
        ...ctx, request: {
            url, method: "GET", headers: headers([["Cookie", cookie], ...additionalHeaders]),
            text: () => {throw new Error("捕获不得读取正文");},
            arrayBuffer: () => {throw new Error("捕获不得读取二进制正文");},
        },
    });
    return {ctx, memory, requests, writes, replies, incoming, clock: () => now, advance: milliseconds => {now += milliseconds;}};
}

module.exports = {NOW, COOKIE, CAPTURE_URL, headers, parcel, response, success, fixture};
