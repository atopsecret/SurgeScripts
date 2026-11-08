// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --experimental-vm-modules --test cainiao-widget/tests/runtime.test.cjs
// 依赖：本地运行时；只使用模拟 HTTP/存储，无真实业务请求
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
let runtime, core;
before(async () => { runtime = await import("../runtime.mjs"); core = await import("../core.mjs"); });
const NOW = Date.UTC(2026, 10, 8, 9, 41);
const makePackage = (id, code = "3-1-2468") => ({mailNo: "DEMO0000" + id, logisticsStatus: "SIGN", partnerName: "示例速递", packageStation: {stationId: "s", stationName: "示例驿站", authCode: code}});
const response = (body, cookies = [], status = 200) => ({status, headers: {getAll: () => cookies}, text: async () => typeof body === "string" ? body : JSON.stringify(body)});
const success = (packages, totalPage = 1, currentPage = 1) => response({ret: ["SUCCESS::成功"], data: {packages, ...(totalPage === null ? {} : {totalPage}), currentPage}});
function fixture(replies = []) {
    const memory = new Map(), requests = [];
    let time = NOW;
    const ctx = {
        env: {CONNECTION_MODE: "manual", CAINIAO_COOKIE: "cookie2=demo-session; unb=demo-user; _m_h5_tk=demo-token_1"}, widgetFamily: "systemMedium",
        storage: {getJSON: key => structuredClone(memory.get(key) ?? null), setJSON: (key, value) => memory.set(key, structuredClone(value))},
        http: {get: async (url, options) => { requests.push({url: new URL(url), options}); const item = replies.shift(); if (item instanceof Error) throw item; if (typeof item === "function") return item(); if (!item) throw new Error("synthetic-network-error"); return item; }},
    };
    return {ctx, memory, requests, clock: () => time, advance: ms => {time += ms;}, replies};
}

test("首次未登录或畸形参数只显示接入说明，不请求网络", async () => {
    for (const cookie of ["", "bad", "cookie2=x\nHost:evil.invalid"]) {
        const f = fixture(); f.ctx.env.CAINIAO_COOKIE = cookie;
        const model = await runtime.loadCainiaoModel(f.ctx, f.clock);
        assert.equal(model.status, "setup"); assert.equal(model.updatedAt, null); assert.equal(f.requests.length, 0);
    }
});

test("完整列表和空列表只有接口成功才保存为新结果", async () => {
    for (const packages of [[makePackage("1234")], []]) {
        const f = fixture([success(packages)]), model = await runtime.loadCainiaoModel(f.ctx, f.clock);
        assert.equal(model.status, "ready"); assert.equal(model.total, packages.length); assert.equal(model.updatedAt, new Date(NOW).toISOString());
        const stored = f.memory.get(core.CW_STORE); assert.equal(stored.snapshot.items.length, packages.length);
        const req = f.requests[0]; assert.equal(req.options.redirect, "manual"); assert.equal(req.options.credentials, "omit"); assert.equal(req.options.insecureTls, false); assert(req.options.timeout <= 7000);
        assert.equal(req.url.hostname, "h5api.m.taobao.com");
    }
});

test("无 token 引导收取 Cookie 后重新签名，下一次刷新使用本地新值", async () => {
    const f = fixture([response({ret: ["FAIL_SYS_TOKEN_EMPTY::空"]}, ["_m_h5_tk=new-demo-token_2; Domain=.taobao.com; Path=/"]), success([makePackage("1234")]), success([])]);
    f.ctx.env.CAINIAO_COOKIE = "cookie2=demo-session; unb=demo-user";
    assert.equal((await runtime.loadCainiaoModel(f.ctx, f.clock)).status, "ready");
    assert.equal(f.requests.length, 2); assert(f.requests[1].options.headers.Cookie.includes("_m_h5_tk=new-demo-token_2"));
    assert.notEqual(f.requests[0].url.searchParams.get("sign"), f.requests[1].url.searchParams.get("sign"));
    await runtime.loadCainiaoModel(f.ctx, f.clock);
    assert(f.requests[2].options.headers.Cookie.includes("_m_h5_tk=new-demo-token_2"));
});

test("token 不更新立即终止，新 token 也最多重试两次", async () => {
    const unchanged = fixture([response({ret: ["FAIL_SYS_TOKEN_EXPIRED::过期"]})]);
    assert.equal((await runtime.loadCainiaoModel(unchanged.ctx, unchanged.clock)).status, "expired"); assert.equal(unchanged.requests.length, 1);
    const changed = fixture(Array.from({length: 5}, (_, i) => response({ret: ["FAIL_SYS_TOKEN_EXOIRED::过期"]}, ["_m_h5_tk=demo" + i + "_2; Path=/"])));
    assert.equal((await runtime.loadCainiaoModel(changed.ctx, changed.clock)).status, "expired"); assert.equal(changed.requests.length, 3);
});

test("跨页读取全部数据并去重，不因短页或四十条截断", async () => {
    const f = fixture([success([makePackage("1234")], 2, 1), success([makePackage("1234"), makePackage("5678")], 2, 2)]);
    const model = await runtime.loadCainiaoModel(f.ctx, f.clock);
    assert.equal(model.status, "ready"); assert.equal(model.total, 2); assert.equal(f.requests.length, 2);
    assert.equal(JSON.parse(f.requests[1].url.searchParams.get("data")).currentPage, 2);
    const noMeta = fixture([success([makePackage("0001")], null, 1), success([], null, 2)]);
    assert.equal((await runtime.loadCainiaoModel(noMeta.ctx, noMeta.clock)).status, "ready"); assert.equal(noMeta.requests.length, 2);
});

test("二十页上限或重复页只能返回部分数量，不写入完整快照", async () => {
    for (const repeated of [true, false]) {
        const replies = repeated ? [success([makePackage("1234")], 3, 1), success([makePackage("1234")], 3, 2)] : Array.from({length: 20}, (_, i) => success([makePackage(String(i).padStart(4, "0"))], 21, i + 1));
        const f = fixture(replies), model = await runtime.loadCainiaoModel(f.ctx, f.clock);
        assert.equal(model.status, "partial"); assert.equal(model.partial, true); assert.equal(f.memory.get(core.CW_STORE).snapshot, null);
        assert.equal(model.total, repeated ? 1 : 20);
    }
});

test("总时间预算耗尽保留已获取部分，无额外网络重试", async () => {
    const f = fixture(); f.replies.push(() => {f.advance(17500); return success([makePackage("1234")], 2, 1);});
    const model = await runtime.loadCainiaoModel(f.ctx, f.clock);
    assert.equal(model.status, "partial"); assert.equal(model.total, 1); assert.equal(f.requests.length, 1);
});

test("登录失效、风控、网络、结构变更均保留旧码及原更新时间", async () => {
    const failures = [
        [new Error("synthetic-failure-cookie2=DO_NOT_LOG"), "offline"],
        [response({ret: ["FAIL_SYS_SESSION_EXPIRED::过期"]}), "expired"],
        [response({ret: ["FAIL_SYS_USER_VALIDATE::验证"]}), "verify"],
        [response({ret: ["SUCCESS::成功"], data: {futurePackages: []}}), "error"],
        [response("<html>captcha</html>"), "verify"],
    ];
    for (const [failure, status] of failures) {
        const f = fixture([success([makePackage("1234")]), failure]);
        const first = await runtime.loadCainiaoModel(f.ctx, f.clock); f.advance(60000);
        const model = await runtime.loadCainiaoModel(f.ctx, f.clock);
        assert.equal(model.status, status); assert.equal(model.items[0].code, first.items[0].code); assert.equal(model.updatedAt, first.updatedAt); assert.match(model.message, /上次/); assert(!JSON.stringify(model).includes("DO_NOT_LOG"));
    }
});

test("部分失败优先保留旧完整快照，不能拼接为当前下限", async () => {
    const f = fixture([success([makePackage("1111")]), success([makePackage("2222")], 2, 1), new Error("offline")]);
    const before = await runtime.loadCainiaoModel(f.ctx, f.clock); f.advance(60000);
    const after = await runtime.loadCainiaoModel(f.ctx, f.clock);
    assert.equal(after.status, "offline"); assert.deepEqual(after.items, before.items); assert.equal(after.partial, undefined); assert.equal(after.updatedAt, before.updatedAt);
});

test("不同账号、未知身份会话和服务端身份变化均不能复用旧包裹", async () => {
    for (const nextCookie of ["cookie2=demo-other; unb=other-user", "cookie2=unknown-user-session"]) {
        const f = fixture([success([makePackage("1234")]), new Error("offline")]);
        await runtime.loadCainiaoModel(f.ctx, f.clock); f.ctx.env.CAINIAO_COOKIE = nextCookie;
        const model = await runtime.loadCainiaoModel(f.ctx, f.clock);
        assert.equal(model.total, 0); assert.equal(model.updatedAt, null); assert.equal(f.memory.get(core.CW_STORE).snapshot, null);
    }
    const f = fixture([success([makePackage("1234")]), response({ret: ["SUCCESS::成功"], data: {packages: [], totalPage: 1}}, ["unb=other-user; Path=/"])]);
    await runtime.loadCainiaoModel(f.ctx, f.clock);
    const model = await runtime.loadCainiaoModel(f.ctx, f.clock); assert.equal(model.items.length, 0); assert.match(model.message, /账号/);
});

test("同账号新导入凭据优先旧 Cookie，清空参数退出并覆盖存储", async () => {
    const f = fixture([success([makePackage("1234")]), success([])]);
    await runtime.loadCainiaoModel(f.ctx, f.clock);
    f.ctx.env.CAINIAO_COOKIE = "cookie2=demo-new; unb=demo-user; _m_h5_tk=new-token_9";
    await runtime.loadCainiaoModel(f.ctx, f.clock);
    assert(f.requests[1].options.headers.Cookie.includes("cookie2=demo-new"));
    f.ctx.env.CAINIAO_COOKIE = "";
    assert.equal((await runtime.loadCainiaoModel(f.ctx, f.clock)).status, "setup"); assert.equal(f.memory.get(core.CW_STORE), null);
});

test("旧缓存超过七天不再公开取件码，损坏缓存不导致崩溃", async () => {
    const f = fixture([success([makePackage("1234")]), new Error("offline"), new Error("offline")]);
    await runtime.loadCainiaoModel(f.ctx, f.clock); f.advance(8 * 86400000);
    assert.equal((await runtime.loadCainiaoModel(f.ctx, f.clock)).items.length, 0);
    const state = f.memory.get(core.CW_STORE); state.snapshot = {items: [{future: true}], updatedAt: new Date(NOW).toISOString()}; f.memory.set(core.CW_STORE, state);
    assert.equal((await runtime.loadCainiaoModel(f.ctx, f.clock)).items.length, 0);
});

test("存储失败仍可显示在线结果，给出缓存失效提示", async () => {
    const f = fixture([success([makePackage("1234")])]);
    f.ctx.storage = {getJSON: () => {throw new Error("locked");}, setJSON: () => {throw new Error("locked");}};
    const model = await runtime.loadCainiaoModel(f.ctx, f.clock);
    assert.equal(model.status, "ready"); assert.equal(model.total, 1); assert.match(model.message, /缓存/);
});

test("刷新间隔被限制，锁屏默认隐藏码且只接受明确开启", async () => {
    for (const [interval, expected] of [["0", 5], ["9999", 120], ["bad", 15], ["20", 20]]) {
        const f = fixture([success([])]); f.ctx.env.REFRESH_MINUTES = interval; f.ctx.widgetFamily = "accessoryRectangular";
        const model = await runtime.loadCainiaoModel(f.ctx, f.clock); assert.equal(model.refreshMinutes, expected); assert.equal(model.privacy, true);
    }
    const f = fixture([success([makePackage("1234")])]); f.ctx.widgetFamily = "accessoryInline"; f.ctx.env.LOCKSCREEN_SHOW_CODE = "true";
    assert.equal((await runtime.loadCainiaoModel(f.ctx, f.clock)).privacy, false);
});

test("自包含产物可在没有 Node、fetch 或 TextEncoder 的环境返回原生 DSL", async () => {
    const source = fs.readFileSync(require.resolve("../cainiao-widget.egern.js"), "utf8");
    const mod = new vm.SourceTextModule(source, {context: vm.createContext({})});
    await mod.link(() => {throw new Error("不允许远程依赖");}); await mod.evaluate();
    const f = fixture([success([makePackage("1234")])]);
    const output = await mod.namespace.default(f.ctx);
    assert.equal(output.type, "widget"); assert.equal(typeof output.refreshAfter, "string"); assert(!source.includes("$done"));
    assert(JSON.stringify(output).includes("3-1-2468"));
});

test("无导入 unb 时仍跟踪服务器已观察账号，后续变更或删除清除旧码并阻止复用", async () => {
    for (const changed of ["unb=synthetic-account-b; Path=/", "unb=; Max-Age=0; Path=/"]) {
        const f = fixture([
            response({ret: ["SUCCESS::成功"], data: {packages: [makePackage("1234")], totalPage: 1}}, ["unb=synthetic-account-a; Path=/"]),
            response({ret: ["FAIL_SYS_TOKEN_EXPIRED::过期"]}, [changed]),
        ]);
        f.ctx.env.CAINIAO_COOKIE = "cookie2=demo-session-without-account";
        const first = await runtime.loadCainiaoModel(f.ctx, f.clock); assert.equal(first.total, 1);
        const after = await runtime.loadCainiaoModel(f.ctx, f.clock);
        assert.equal(after.items.length, 0); assert.match(after.message, /账号/);
        const stored = f.memory.get(core.CW_STORE); assert.equal(stored.snapshot, null); assert.equal(stored.cookie, "");
        const next = await runtime.loadCainiaoModel(f.ctx, f.clock);
        assert.equal(next.items.length, 0); assert.equal(f.requests.length, 2); assert.match(next.message, /重新导入/);
    }
});

test("最后一页读体超预算不能保存为当前完整结果", async () => {
    const f = fixture([success([makePackage("1111")])]);
    const before = await runtime.loadCainiaoModel(f.ctx, f.clock);
    f.replies.push({status: 200, headers: {getAll: () => []}, text: async () => {f.advance(20000); return JSON.stringify({ret: ["SUCCESS::成功"], data: {packages: [makePackage("2222")], totalPage: 1}});}});
    const after = await runtime.loadCainiaoModel(f.ctx, f.clock);
    assert.equal(after.status, "error"); assert.deepEqual(after.items, before.items); assert.equal(after.updatedAt, before.updatedAt);
    assert.deepEqual(f.memory.get(core.CW_STORE).snapshot.items, before.items);
});

test("计时器可用时挂起 Promise 按剩余预算回退，并消费晚到的拒绝", async () => {
    const start = Date.now();
    await assert.rejects(runtime.cwBounded(() => new Promise(() => {}), start + 15, Date.now), /partial/);
    assert(Date.now() - start < 1000);
    assert.equal(await runtime.cwBounded(() => Promise.resolve("synthetic-ok"), Date.now() + 1000, Date.now), "synthetic-ok");
});
