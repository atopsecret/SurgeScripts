// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --test cainiao-widget/tests/auth.test.cjs
// 依赖：本地源码与合成夹具；不联网，不执行真实登录
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {NOW, COOKIE, CAPTURE_URL, headers, fixture} = require("./auth-fixture.cjs");
let auth, core;
before(async () => {auth = await import("../auth.mjs"); core = await import("../core.mjs");});
const capture = f => auth.captureCainiaoCredentials(f.incoming(), f.clock);
const saved = f => f.memory.get(core.CW_AUTH_STORE);
const result = f => f.memory.get(core.CW_CAPTURE_STORE)?.code;

test("捕获范围只接受两个精确 HTTPS H5 网关和数字版本", () => {
    for (const host of ["h5api.m.taobao.com", "acs.m.taobao.com"]) {
        for (const suffix of ["/1.0/", "/1.0", "/2.1.3/?x=1"]) {
            assert.equal(auth.cwCaptureURL(`https://${host}/h5/mtop.example.test${suffix}`), host);
            assert.equal(auth.cwCaptureURL(`https://${host}:443/h5/mtop.example.test${suffix}`), host);
        }
    }
    for (const url of [
        "http://h5api.m.taobao.com/h5/mtop.example/1.0/", "https://h5api.m.taobao.com.evil.invalid/h5/mtop.example/1.0/",
        "https://evil.invalid/h5api.m.taobao.com/h5/mtop.example/1.0/", "https://user@h5api.m.taobao.com/h5/mtop.example/1.0/",
        "https://h5api.m.taobao.com:444/h5/mtop.example/1.0/", "https://acs.m.taobao.com/gw/mtop.example/1.0/",
        "https://h5api.m.taobao.com/h5/mtop/1.0/", "https://h5api.m.taobao.com/h5/mtop.example/latest/",
        "https://h5api.m.taobao.com/h5/mtop.example/1.0/extra", CAPTURE_URL + "#fragment", CAPTURE_URL + "\n",
        "https://h5api.m.taobao.com/h5/mtop.example%2fother/1.0/", null,
    ]) assert.equal(auth.cwCaptureURL(url), "", String(url));
});

test("请求入口原样放行，只保存必要凭据，未查询成功时仍为待验证", () => {
    const f = fixture(), input = f.incoming(COOKIE + "; tracknick=synthetic-name; cna=synthetic-tracker; locale=zh_CN");
    const original = input.request.headers;
    assert.equal(auth.captureCainiaoCredentials(input, f.clock), undefined);
    assert.equal(input.request.headers, original); assert.equal(input.request.url, CAPTURE_URL);
    assert.equal(saved(f).status, "pending"); assert.equal(saved(f).confirmedAt, null);
    assert.equal(saved(f).sourceHost, "acs.m.taobao.com"); assert.equal(result(f), "saved");
    assert(!/tracknick|synthetic-name|cna=|locale=/.test(saved(f).cookie));
    assert.equal(f.requests.length, 0);
    assert.deepEqual(Object.keys(f.memory.get(core.CW_CAPTURE_STORE)).sort(), ["at", "code", "version"]);
});

test("访客 token、匿名会话和仅有账号标识不能冒充可用登录态", () => {
    for (const cookie of ["", "cookie2=synthetic-guest; _m_h5_tk=synthetic-guest-token_1", "sgcookie=synthetic-guest", "unb=synthetic-user-a", "unb=synthetic-user-a; munb=synthetic-munb"]) {
        const f = fixture(); auth.captureCainiaoCredentials(f.incoming(cookie), f.clock);
        assert.equal(saved(f), undefined); assert.equal(result(f), "anonymous"); assert.equal(f.requests.length, 0);
    }
    const f = fixture(); auth.captureCainiaoCredentials(f.incoming("unb=synthetic-user-a; sgcookie=synthetic-sg"), f.clock);
    assert.equal(saved(f).status, "pending");
});

test("匿名请求不覆盖已连接凭据或快照", () => {
    const f = fixture(); capture(f);
    const current = saved(f); current.status = "connected"; current.confirmedAt = NOW; f.memory.set(core.CW_AUTH_STORE, current);
    const snapshot = {owner: current.owner, snapshot: {synthetic: true}}; f.memory.set(core.CW_STORE, snapshot);
    auth.captureCainiaoCredentials(f.incoming("cookie2=synthetic-guest"), f.clock);
    assert.deepEqual(saved(f), current); assert.deepEqual(f.memory.get(core.CW_STORE), snapshot);
});

test("Cookie 多头逐项合并，大小写无关，冲突和畸形头均拒绝", () => {
    const f = fixture(), incoming = f.incoming();
    incoming.request.headers = headers([["cOoKiE", "unb=synthetic-user-a"], ["COOKIE", "cookie2=synthetic-session-a"], ["Cookie", "_m_h5_tk=synthetic-token_1"]]);
    capture(f); f.memory.clear(); auth.captureCainiaoCredentials(incoming, f.clock);
    assert.equal(saved(f).status, "pending");
    for (const entries of [
        [["Cookie", COOKIE], ["cookie", "unb=synthetic-user-b"]], [["Cookie", "unb=a; cookie2=x\r\nHost:evil.invalid"]],
        [["Cookie", "unb=a; cookie2=x; Path=/"]], [["Cookie", "unb=a; cookie2=x; cookie2=y"]],
        [["Cookie", "unb=a; cookie2=" + "x".repeat(8193)]],
    ]) {
        const g = fixture(), input = g.incoming(); input.request.headers = headers(entries);
        auth.captureCainiaoCredentials(input, g.clock); assert.equal(saved(g), undefined); assert.equal(result(g), "invalid");
    }
});

test("自身后台查询标记被忽略，不触发捕获或状态写入", () => {
    const f = fixture(); auth.captureCainiaoCredentials(f.incoming(COOKIE, CAPTURE_URL, [[core.CW_SELF_HEADER.toLowerCase(), "1"]]), f.clock);
    assert.equal(f.writes.length, 0); assert.equal(f.requests.length, 0);
});

test("相同登录态不反复重写，token 轮换保留代次、确认状态与缓存", () => {
    const f = fixture(); capture(f);
    const connected = saved(f); connected.status = "connected"; connected.confirmedAt = NOW; f.memory.set(core.CW_AUTH_STORE, connected);
    const snapshot = {owner: connected.owner, snapshot: {synthetic: true}}; f.memory.set(core.CW_STORE, snapshot);
    const count = f.writes.filter(write => write.key === core.CW_AUTH_STORE).length;
    capture(f); assert.equal(f.writes.filter(write => write.key === core.CW_AUTH_STORE).length, count);
    f.advance(1000); auth.captureCainiaoCredentials(f.incoming(COOKIE.replace("synthetic-token_1", "synthetic-token_2")), f.clock);
    assert.equal(saved(f).generation, connected.generation); assert.equal(saved(f).sessionHash, connected.sessionHash);
    assert.notEqual(saved(f).inputHash, connected.inputHash); assert.equal(saved(f).status, "connected");
    assert.equal(saved(f).confirmedAt, NOW); assert.deepEqual(f.memory.get(core.CW_STORE), snapshot);
});

test("账号切换先清旧快照再保存新候选，同账号新会话只更换代次", () => {
    const f = fixture(); capture(f);
    const before = saved(f); f.memory.set(core.CW_STORE, {owner: before.owner, snapshot: {synthetic: true}});
    auth.captureCainiaoCredentials(f.incoming(COOKIE.replace("synthetic-session-a", "synthetic-session-new")), f.clock);
    assert.notEqual(saved(f).generation, before.generation); assert.equal(saved(f).owner, before.owner);
    assert.notEqual(f.memory.get(core.CW_STORE), null);
    const start = f.writes.length;
    auth.captureCainiaoCredentials(f.incoming("unb=synthetic-user-b; cookie2=synthetic-session-b"), f.clock);
    const changes = f.writes.slice(start);
    assert.equal(changes[0].key, core.CW_STORE); assert.equal(changes[0].value.blocked, true); assert.equal(changes[0].value.snapshot, null);
    assert.equal(changes[1].key, core.CW_AUTH_STORE); assert.notEqual(saved(f).owner, before.owner);
    assert.equal(saved(f).status, "pending"); assert.equal(saved(f).confirmedAt, null);
});

test("首次自动捕获也隔离旧手动账号，损坏状态可由有效请求修复", () => {
    const f = fixture(); f.memory.set(core.CW_STORE, {owner: "other-synthetic-owner", snapshot: {synthetic: true}});
    f.memory.set(core.CW_AUTH_STORE, {broken: true}); capture(f);
    assert.equal(f.memory.get(core.CW_STORE).blocked, true); assert.equal(f.memory.get(core.CW_STORE).snapshot, null); assert.equal(saved(f).status, "pending");
    const damaged = {...saved(f), owner: "wrong"}; assert.equal(auth.cwAuthState(damaged, NOW), null);
    assert.equal(auth.cwAuthState({...saved(f), capturedAt: NOW + 120000}, NOW), null);
});

test("失效会话须有新手机捕获才恢复为待验证，不凭原值自动确认", () => {
    const f = fixture(); capture(f); const expired = {...saved(f), status: "expired"}; f.memory.set(core.CW_AUTH_STORE, expired);
    f.advance(1000); capture(f);
    assert.equal(saved(f).status, "pending"); assert.notEqual(saved(f).generation, expired.generation); assert.equal(saved(f).confirmedAt, null);
});

test("捕获写入抛错、静默失败或旧快照清除失败不报告保存成功", () => {
    for (const failure of ["throw", "noop", "clear"]) {
        const f = fixture(), original = f.ctx.storage.setJSON;
        if (failure === "clear") f.memory.set(core.CW_STORE, {owner: "other-owner"});
        f.ctx.storage.setJSON = (key, value) => {
            if (key === (failure === "clear" ? core.CW_STORE : core.CW_AUTH_STORE)) {
                if (failure === "throw") throw new Error("synthetic-secret-must-not-leak");
                return;
            }
            original(key, value);
        };
        assert.equal(capture(f), undefined); assert.equal(saved(f), undefined); assert.equal(result(f), "storage");
        assert(!JSON.stringify(f.memory.get(core.CW_CAPTURE_STORE)).includes("synthetic-secret"));
    }
});

test("读取凭据 API 失败停止捕获，不用猜测的旧值覆盖", () => {
    const f = fixture(), original = f.ctx.storage.getJSON;
    f.ctx.storage.getJSON = key => {if (key === core.CW_AUTH_STORE) throw new Error("synthetic-read-error"); return original(key);};
    capture(f); assert.equal(saved(f), undefined); assert.equal(result(f), "storage");
});

test("写后出现另一捕获代次不回写旧值，也不声称此次保存成功", () => {
    const f = fixture(), original = f.ctx.storage.setJSON;
    f.ctx.storage.setJSON = (key, value) => {
        if (key !== core.CW_AUTH_STORE) return original(key, value);
        const cookies = core.cwCookieMap("unb=synthetic-user-b; cookie2=synthetic-session-b"), cookie = core.cwCookieHeader(cookies);
        original(key, {...value, owner: core.cwOwner(cookies), sessionHash: auth.cwSessionHash(cookies), inputHash: core.md5(cookie), cookie,
            generation: core.md5("synthetic-other-generation"), capturedAt: NOW + 1});
    };
    capture(f); assert.equal(result(f), "superseded"); assert(saved(f).cookie.includes("synthetic-user-b"));
});

test("手动、关闭或无效模式不捕获，关闭操作仅清本组件三个键", () => {
    for (const mode of ["manual", "off", "invalid"]) {
        const f = fixture(); f.ctx.env.CONNECTION_MODE = mode; capture(f); assert.equal(f.writes.length, 0);
    }
    const f = fixture(); capture(f); f.memory.set(core.CW_STORE, {synthetic: true}); f.memory.set("other-module", {keep: true});
    auth.cwClearLocal(f.ctx);
    for (const key of [core.CW_STORE, core.CW_AUTH_STORE, core.CW_CAPTURE_STORE]) assert.equal(f.memory.get(key), null);
    assert.deepEqual(f.memory.get("other-module"), {keep: true});
});

test("只读诊断区分捕获与连接，不暴露 Cookie、账号摘要或异常原文", () => {
    const f = fixture(); capture(f); const before = structuredClone([...f.memory]);
    const output = auth.diagnoseCainiaoConnection(f.ctx, f.clock), text = JSON.stringify(output);
    assert.match(text, /尚未通过个人列表验证/); assert(!text.includes("synthetic-user-a"));
    for (const value of [saved(f).owner, saved(f).generation, saved(f).inputHash, saved(f).cookie]) assert(!text.includes(value));
    assert.deepEqual([...f.memory], before); assert.equal(f.requests.length, 0);
});

test("账号隔离屏障生效时诊断不把旧账号的历史确认当作当前连接", () => {
    const f = fixture(); capture(f); const connected = {...saved(f), status: "connected", confirmedAt: NOW};
    f.memory.set(core.CW_AUTH_STORE, connected); f.memory.set(core.CW_STORE, {owner: "synthetic-other-owner", blocked: true});
    const text = JSON.stringify(auth.diagnoseCainiaoConnection(f.ctx, f.clock));
    assert.match(text, /旧登录态已阻断/); assert(!text.includes("个人列表查询已确认")); assert.equal(f.requests.length, 0);
});
