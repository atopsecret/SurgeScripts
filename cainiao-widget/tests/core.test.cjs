// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// 构建：无需编译
// 运行：node --test cainiao-widget/tests/core.test.cjs
// 依赖：本地 core.mjs；不联网，全部使用虚构凭据与包裹
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
let core;
before(async () => { core = await import("../core.mjs"); });
const parcel = (fields = {}) => ({mailNo: "DEMO00001234", logisticsStatus: "AGENT_SIGN", partnerName: "示例快递", packageStation: {stationId: "demo-station", stationName: "示例驿站", authCode: "8-1-2345"}, ...fields});

test("MD5 与独立实现一致，覆盖中文、非 BMP、边界长度和孤立代理项", () => {
    for (const text of ["", "a", "abc", "message digest", "菜鸟取件", "📦🔑", "a".repeat(55), "b".repeat(56), "x".repeat(64), "z".repeat(1000), "\ud800"]) {
        assert.equal(core.md5(text), createHash("md5").update(text).digest("hex"), text.length);
    }
});

test("MTOP 签名使用原始紧凑 data，路径小写、api 保留大小写", () => {
    const cookies = core.cwCookieMap("unb=demo; _m_h5_tk=demo-token_99999999; cookie2=demo-session");
    const url = new URL(core.cwRequestURL(cookies, 2, 1794100000000));
    const data = '{"pageSize":50,"currentPage":2,"needTemporality":false,"needDynInfo":"{\'needFindTemporality\':true,\'needAppointment\':true}"}';
    assert.equal(url.hostname, "h5api.m.taobao.com");
    assert.equal(url.pathname, "/h5/mtop.cainiao.lpc.packageservice.querypdspackagedatalist/1.0/");
    assert.equal(url.searchParams.get("api"), core.CW_API);
    assert.equal(url.searchParams.get("data"), data);
    assert.equal(url.searchParams.get("sign"), createHash("md5").update("demo-token&1794100000000&12574478&" + data).digest("hex"));
    assert.equal(url.searchParams.get("type"), "originaljson");
});

test("Cookie 输入不能夹带请求头、Set-Cookie 属性或冲突重名", () => {
    for (const value of ["cookie2=demo\r\nHost: other.invalid", "cookie2=x; Path=/", "cookie2=x; cookie2=y", "cookie2=中文", "naked"]) assert.throws(() => core.cwCookieMap(value));
    assert.equal(core.cwCookieMap("Cookie: cookie2=demo==; unb=fixture").get("cookie2"), "demo==");
    assert.equal(core.cwCookieMap("empty=; cookie2=demo").has("empty"), false);
});

test("Cookie 更新按固定域、路径、有效期约束，保留独立和合并头", () => {
    const cookies = core.cwCookieMap("cookie2=demo; _m_h5_tk=old_1; gone=x");
    const now = Date.UTC(2026, 10, 8);
    core.cwUpdateCookies(cookies, {getAll: () => [
        "_m_h5_tk=fresh_2; Domain=.taobao.com; Path=/; Secure; HttpOnly",
        "cookie2=bad; Domain=taobao.com.evil.invalid; Path=/",
        "cookie2=bad; Domain=.com; Path=/",
        "cookie2=bad; Domain=.taobao.com; Path=/not-h5",
        "old=expired; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/, alive=ok; Expires=Wed, 01 Jan 2042 00:00:00 GMT; Path=/",
        "gone=gone; Max-Age=0; Path=/", "positive=ok; Max-Age=90; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
    ]}, now);
    assert.equal(cookies.get("_m_h5_tk"), "fresh_2");
    assert.equal(cookies.get("cookie2"), "demo");
    assert.equal(cookies.get("alive"), "ok");
    assert.equal(cookies.get("positive"), "ok");
    assert.equal(cookies.has("old"), false);
    assert.equal(cookies.has("gone"), false);
});

test("无 token 也生成自洽的引导请求，而非使用过期签名", () => {
    const url = new URL(core.cwRequestURL(new Map(), 1, 100));
    assert.equal(url.searchParams.get("sign"), createHash("md5").update("&100&12574478&" + url.searchParams.get("data")).digest("hex"));
});

test("MTOP 返回码区分 token、登录、验证、失败与未知结构", () => {
    for (const [ret, expected] of [["SUCCESS::成功", "success"], ["FAIL_SYS_TOKEN_EXOIRED::过期", "token"], ["FAIL_SYS_SESSION_EXPIRED::过期", "expired"], ["FAIL_SYS_USER_VALIDATE::验证", "verify"], ["FAIL_SYS_TRAFFIC_LIMIT::限流", "verify"], ["FAIL_SYS_OTHER::失败", "error"]]) assert.equal(core.cwReturnKind({ret: [ret]}), expected);
    for (const ret of [undefined, [], [true], "SUCCESS"]) assert.equal(core.cwReturnKind({ret}), "schema");
    assert.notEqual(core.cwReturnKind({ret: ["SUCCESS::成功", "FAIL_SYS_OTHER::失败"]}), "success");
});

test("直接和嵌套 data 可分页，缺元数据必须继续取下一页", () => {
    assert.deepEqual(core.cwReadPage({data: {data: {packages: [parcel()], currentPage: "1", totalPage: "2"}}}, 1).complete, false);
    assert.equal(core.cwReadPage({data: {packages: [parcel()], currentPage: 2, totalPage: 2}}, 2).complete, true);
    assert.equal(core.cwReadPage({data: {packages: [parcel()] }}, 1).complete, false);
    assert.equal(core.cwReadPage({data: {packages: []}}, 2).complete, true);
    assert.equal(core.cwReadPage({data: {packages: [], totalPage: 0}}, 1).complete, true);
});

test("结构漂移、忽略页码、畸形元数据和超限列表不得当作空包裹", () => {
    for (const data of [{}, {packages: null}, {packages: [null]}, {packages: [], currentPage: 3}, {packages: [], totalPage: 3}, {packages: [], totalPage: "bad"}, {packages: [parcel()], totalPage: 0}, {packages: Array(51).fill(parcel())}]) assert.throws(() => core.cwReadPage({data}, 1));
    assert.throws(() => core.cwNormalizePackage({unrecognized: true}));
});

test("驿站代收 SIGN 携带真码仍列待取，硬终态优先排除", () => {
    assert.equal(core.cwNormalizePackage(parcel({logisticsStatus: "SIGN"})).code, "8-1-2345");
    for (const logisticsStatus of ["CANCEL", "REJECT", "RETURN", "LOST", "PICKED_UP"]) assert.equal(core.cwNormalizePackage(parcel({logisticsStatus})), null);
    assert.equal(core.cwNormalizePackage(parcel({logisticsStatus: "SIGN", packageStation: {stationId: "s"}})), null);
});

test("所有哨兵码都不显示，feature 真码和备用字段正确兜底", () => {
    for (const authCode of ["NEEDSMS", "need_sms", "0", "-1", "null", "none", "true", "false", 0, false, true, null]) {
        const raw = parcel({packageStation: {authCode, stationId: "s"}, feature: {stationOrderPickUpCode: "6-2-1357"}});
        const item = core.cwNormalizePackage(raw);
        assert.equal(item.code, "6-2-1357");
        assert.equal(item.requiresVerification, false);
    }
    for (const field of ["showPickupCode", "pickUpCode", "pickupCode"]) assert.equal(core.cwNormalizePackage(parcel({packageStation: {authCode: "needSms", [field]: "7-9-0001"}})).code, "7-9-0001");
    assert.equal(core.cwNormalizePackage(parcel({feature: {stationOrderPickUpCode: "other"}})).code, "8-1-2345");
});

test("需短信验证保留待取，但不会展示哨兵为码", () => {
    const item = core.cwNormalizePackage(parcel({logisticsStatus: "SIGN", packageStation: {authCode: "needSms", stationName: "示例"}}));
    assert.equal(item.code, ""); assert.equal(item.requiresVerification, true);
});

test("缓存仅含摘要和尾号，去重会保留有真实码的版本", () => {
    const raw = parcel({receiverTel: "13800000000", receiverName: "不可保存姓名", receiverAddress: "不可保存地址"});
    const noCode = {...raw, packageStation: {...raw.packageStation, authCode: "needSms"}};
    const items = core.cwItems([noCode, raw, {...raw}]);
    assert.equal(items.length, 1); assert.equal(items[0].tail, "1234"); assert.equal(items[0].code, "8-1-2345");
    for (const text of [raw.mailNo, raw.receiverName, raw.receiverAddress, raw.receiverTel]) assert.equal(JSON.stringify(items).includes(text), false);
});

test("账号摘要隔离，token 更新不改变可靠账号", () => {
    const a = core.cwCookieMap("unb=demo-a; cookie2=session-a; _m_h5_tk=old_1");
    const b = core.cwCookieMap("unb=demo-a; cookie2=session-b; _m_h5_tk=new_2");
    assert.equal(core.cwOwner(a), core.cwOwner(b));
    b.set("unb", "demo-b"); assert.notEqual(core.cwOwner(a), core.cwOwner(b));
    assert.notEqual(core.cwOwner(core.cwCookieMap("cookie2=demo-a")), core.cwOwner(core.cwCookieMap("cookie2=demo-b")));
});

test("无可靠包裹标识时拒绝更新，不把同站多个缺码件静默合并", () => {
    const raw = {logisticsStatus: "AGENT_SIGN", packageStation: {stationId: "same-station", stationName: "合成驿站", authCode: "needSms"}};
    assert.throws(() => core.cwItems([{...raw, packageItem: [{itemTitle: "甲"}]}, {...raw, packageItem: [{itemTitle: "乙"}]}]), /schema/);
    assert.equal(core.cwItems([{...raw, packageId: "synthetic-a"}, {...raw, packageId: "synthetic-b"}]).length, 2);
});
