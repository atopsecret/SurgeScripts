// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --experimental-vm-modules --test cainiao-widget/tests/auto.test.cjs
// 依赖：本地自动捕获与模拟 API；不联网，不执行真实登录
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {NOW, COOKIE, parcel, response, success, fixture} = require("./auth-fixture.cjs");
let auth, core, runtime;
before(async () => {auth = await import("../auth.mjs"); core = await import("../core.mjs"); runtime = await import("../runtime.mjs");});
const capture = (f, cookie = COOKIE) => auth.captureCainiaoCredentials(f.incoming(cookie), f.clock);
const load = f => runtime.loadCainiaoModel(f.ctx, f.clock);
const saved = f => f.memory.get(core.CW_AUTH_STORE);

test("默认未捕获只显示手机接入提示，无参数、无扫码、无个人请求", async () => {
    const f = fixture(), model = await load(f);
    assert.equal(model.status, "setup"); assert.equal(model.total, 0); assert.equal(model.updatedAt, null);
    assert.match(model.message, /淘宝或菜鸟 App/); assert(!/扫码|电脑|查件页|HAR/.test(model.message)); assert.equal(f.requests.length, 0);
});

test("自动凭据优先手动参数，完整个人列表成功才确认连接", async () => {
    for (const packages of [[parcel()], []]) {
        const f = fixture([success(packages)]); capture(f);
        f.ctx.env.CAINIAO_COOKIE = "unb=synthetic-manual-user; cookie2=synthetic-manual-session";
        assert.equal(saved(f).status, "pending");
        const model = await load(f); assert.equal(model.status, "ready"); assert.equal(model.total, packages.length);
        assert.equal(saved(f).status, "connected"); assert.equal(saved(f).confirmedAt, NOW);
        const request = f.requests[0]; assert(request.options.headers.Cookie.includes("synthetic-user-a"));
        assert(!request.options.headers.Cookie.includes("synthetic-manual-user")); assert.equal(request.options.headers[core.CW_SELF_HEADER], "1");
        assert.equal(request.url.hostname, "h5api.m.taobao.com"); assert.equal(model.message, "");
    }
});

test("自动模式无捕获时兼容手动备用，明确手动模式则忽略自动凭据", async () => {
    const f = fixture([success([])]); f.ctx.env.CAINIAO_COOKIE = COOKIE;
    assert.equal((await load(f)).status, "ready"); assert.equal(saved(f), undefined);
    assert.equal(f.memory.get(core.CW_STORE).source, "manual");
    const g = fixture([success([])]); capture(g); g.ctx.env.CONNECTION_MODE = "manual";
    g.ctx.env.CAINIAO_COOKIE = "unb=synthetic-manual-user; cookie2=synthetic-manual-session";
    assert.equal((await load(g)).status, "ready"); assert(g.requests[0].options.headers.Cookie.includes("synthetic-manual-user"));
    assert.equal(saved(g).status, "pending");
});

test("自动 token 引导更新缓存，新手机 token 优先旧网关值且保留同账号快照", async () => {
    const f = fixture([response({ret: ["FAIL_SYS_TOKEN_EMPTY::空"]}, ["_m_h5_tk=synthetic-server-token_2; Domain=.taobao.com; Path=/"]), success(), success([]), new Error("offline")]);
    capture(f, "unb=synthetic-user-a; cookie2=synthetic-session-a");
    assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, 2);
    assert(f.requests[1].options.headers.Cookie.includes("synthetic-server-token_2"));
    await load(f); assert(f.requests[2].options.headers.Cookie.includes("synthetic-server-token_2"));
    const before = f.memory.get(core.CW_STORE).snapshot, generation = saved(f).generation;
    capture(f, "unb=synthetic-user-a; cookie2=synthetic-session-a; _m_h5_tk=synthetic-phone-token_9");
    assert.equal(saved(f).generation, generation); assert.deepEqual(f.memory.get(core.CW_STORE).snapshot, before);
    const model = await load(f); assert.equal(model.status, "offline");
    assert(f.requests[3].options.headers.Cookie.includes("synthetic-phone-token_9")); assert.deepEqual(model.items, before.items);
});

test("过期后不反复请求，重新打开 App 捕获后才重试", async () => {
    const f = fixture([success(), response({ret: ["FAIL_SYS_SESSION_EXPIRED::过期"]}), success([])]); capture(f);
    const first = await load(f); f.advance(60000);
    const expired = await load(f); assert.equal(expired.status, "expired"); assert.deepEqual(expired.items, first.items);
    assert.equal(expired.updatedAt, first.updatedAt); assert.match(expired.message, /重开 App 快递列表/); assert.equal(saved(f).status, "expired");
    const again = await load(f); assert.equal(again.status, "expired"); assert.equal(f.requests.length, 2);
    capture(f); assert.equal(saved(f).status, "pending"); assert.equal((await load(f)).status, "ready"); assert.equal(f.requests.length, 3);
});

test("风控提示保留同账号缓存，未连接的访客候选不能写成功状态", async () => {
    const f = fixture([success(), response("<html>synthetic-verification</html>")]); capture(f);
    const first = await load(f), verify = await load(f);
    assert.equal(verify.status, "verify"); assert.deepEqual(verify.items, first.items); assert.equal(saved(f).status, "verify");
    await load(f); assert.equal(f.requests.length, 2);
    const g = fixture([response({ret: ["FAIL_SYS_USER_NOT_LOGIN::未登录"]})]); capture(g);
    const model = await load(g); assert.equal(model.status, "setup"); assert.equal(model.setupTitle, "App 接入未确认"); assert.equal(model.items.length, 0);
    assert.equal(saved(g).status, "expired");
    assert.equal(saved(g).confirmedAt, null); assert.notEqual(saved(g).status, "connected");
});

test("未完整取数不保存完整快照，也不把新候选宣布为已连接", async () => {
    const f = fixture([success([parcel("a")], 2, 1), new Error("offline")]); capture(f);
    const model = await load(f); assert.equal(model.status, "partial"); assert.equal(model.partial, true);
    assert.equal(saved(f).status, "pending"); assert.equal(saved(f).confirmedAt, null);
    assert.equal(f.memory.get(core.CW_STORE).snapshot, null);
});

test("捕获新账号立即隔离旧快照，查询失败不回显旧取件码", async () => {
    const f = fixture([success([parcel("a", "8-1-1111")]), new Error("offline")]); capture(f);
    await load(f); capture(f, "unb=synthetic-user-b; cookie2=synthetic-session-b");
    assert.equal(f.memory.get(core.CW_STORE).blocked, true); assert.equal(f.memory.get(core.CW_STORE).snapshot, null);
    const next = await load(f); assert.equal(next.items.length, 0); assert.equal(next.updatedAt, null);
    assert(!JSON.stringify(next).includes("8-1-1111")); assert.equal(saved(f).status, "pending");
});

test("服务器改变或删除账号时清除所有旧码并阻止继续复用", async () => {
    for (const cookie of ["unb=synthetic-user-b; Path=/", "unb=; Max-Age=0; Path=/"]) {
        const f = fixture([success(), response({ret: ["FAIL_SYS_TOKEN_EXPIRED::过期"]}, [cookie])]); capture(f);
        await load(f); const bad = await load(f); assert.equal(bad.items.length, 0); assert.equal(bad.updatedAt, null);
        assert.equal(saved(f).status, "invalid"); assert.equal(f.memory.get(core.CW_STORE).snapshot, null); assert.equal(f.memory.get(core.CW_STORE).cookie, "");
        await load(f); assert.equal(f.requests.length, 2);
        capture(f); f.replies.push(success([])); assert.equal((await load(f)).status, "ready");
    }
});

test("网络等待期间切换账号停止旧任务，不覆盖新捕获或回显旧结果", async () => {
    const f = fixture([() => {capture(f, "unb=synthetic-user-b; cookie2=synthetic-session-b"); return success([parcel("a", "8-1-1111")]);}]); capture(f);
    const model = await load(f); assert.equal(model.status, "setup"); assert.equal(model.items.length, 0); assert.match(model.message, /登录态已更新/);
    assert(saved(f).cookie.includes("synthetic-user-b")); assert.equal(saved(f).status, "pending");
    assert.equal(f.memory.get(core.CW_STORE).blocked, true); assert.equal(f.memory.get(core.CW_STORE).snapshot, null); assert.equal(f.requests.length, 1);
});

test("翻页和读体期间的新账号不会泄漏部分结果或覆盖其缓存", async () => {
    for (const stage of ["page", "body"]) {
        const f = fixture(); capture(f);
        const change = () => {capture(f, "unb=synthetic-user-b; cookie2=synthetic-session-b"); return success([parcel("b")], 2, 2);};
        f.replies.push(success([parcel("a", "8-1-1111")], 2, 1), stage === "page" ? change : {
            status: 200, headers: response({}).headers, text: async () => {change(); return JSON.stringify({ret: ["SUCCESS::成功"], data: {packages: [parcel("b")], totalPage: 2, currentPage: 2}});},
        });
        const model = await load(f); assert.equal(model.items.length, 0); assert.equal(model.updatedAt, null);
        assert.equal(f.memory.get(core.CW_STORE).blocked, true); assert.equal(f.memory.get(core.CW_STORE).snapshot, null); assert(saved(f).cookie.includes("synthetic-user-b"));
    }
});

test("同账号 token 在途更新不被旧请求覆盖，下次可复用原快照", async () => {
    const f = fixture([success([parcel("a", "8-1-1111")])]); capture(f); const first = await load(f);
    f.replies.push(() => {capture(f, COOKIE.replace("synthetic-token_1", "synthetic-phone-token_9")); return success([parcel("b", "8-2-2222")]);});
    const model = await load(f); assert.equal(model.items.length, 0); assert.equal(model.status, "setup");
    assert(saved(f).cookie.includes("synthetic-phone-token_9")); assert.deepEqual(f.memory.get(core.CW_STORE).snapshot.items, first.items);
    f.replies.push(new Error("offline")); const again = await load(f); assert.deepEqual(again.items, first.items);
    assert(f.requests[2].options.headers.Cookie.includes("synthetic-phone-token_9"));
});

test("手动备用查询途中出现自动捕获时停止，不再写回手动账号", async () => {
    const f = fixture([() => {capture(f, "unb=synthetic-user-b; cookie2=synthetic-session-b"); return success();}]); f.ctx.env.CAINIAO_COOKIE = COOKIE;
    const model = await load(f); assert.equal(model.items.length, 0); assert.equal(model.status, "setup");
    assert.equal(f.memory.get(core.CW_STORE).blocked, true); assert.equal(f.memory.get(core.CW_STORE).snapshot, null); assert(saved(f).cookie.includes("synthetic-user-b"));
});

test("自动和手动任务在途关闭连接后都不能恢复已清除状态", async () => {
    for (const manual of [false, true]) {
        const f = fixture([() => {auth.cwClearLocal(f.ctx); return success();}]);
        if (manual) {f.ctx.env.CONNECTION_MODE = "manual"; f.ctx.env.CAINIAO_COOKIE = COOKIE;} else capture(f);
        const model = await load(f); assert.equal(model.items.length, 0); assert.equal(model.status, "setup");
        assert.equal(f.memory.get(core.CW_STORE), null); assert.equal(f.memory.get(core.CW_AUTH_STORE), null);
    }
});

test("关闭及错误模式不访问网络，off 清本组件状态不影响其他模块", async () => {
    const f = fixture(); capture(f); f.memory.set("other-module", "keep"); f.ctx.env.CONNECTION_MODE = "off";
    const off = await load(f); assert.equal(off.status, "setup"); assert.match(off.message, /已清除/);
    assert.equal(f.memory.get("other-module"), "keep"); assert.equal(f.requests.length, 0);
    f.ctx.env.CONNECTION_MODE = "typo"; assert.match((await load(f)).message, /连接方式无效/); assert.equal(f.requests.length, 0);
});

test("损坏自动凭据或读取失败不猜登录成功，也不回退另一手动账号", async () => {
    const f = fixture(); capture(f); f.ctx.env.CAINIAO_COOKIE = "unb=synthetic-manual-user; cookie2=synthetic-manual-session";
    f.memory.set(core.CW_AUTH_STORE, {...saved(f), owner: "broken"});
    assert.equal((await load(f)).status, "setup"); assert.equal(f.requests.length, 0);
    f.ctx.storage.getJSON = () => {throw new Error("synthetic-secret-storage-error");};
    assert(!JSON.stringify(await load(f)).includes("synthetic-secret-storage-error")); assert.equal(f.requests.length, 0);
});

test("自动快照或连接标志静默写入失败必须提示，不能虚构持久化成功", async () => {
    for (const key of ["snapshot", "auth"]) {
        const f = fixture([success()]); capture(f); const original = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (name, value) => {if (name === (key === "snapshot" ? core.CW_STORE : core.CW_AUTH_STORE)) return; original(name, value);};
        const model = await load(f); assert.equal(model.status, "ready"); assert.match(model.message, /缓存写入失败/);
        if (key === "auth") assert.equal(saved(f).status, "pending");
        if (key === "snapshot") assert.equal(f.memory.get(core.CW_STORE), undefined);
    }
});

test("同一自包含脚本在无 Node 全局环境跨入口捕获、渲染和只读诊断", async () => {
    const source = fs.readFileSync(require.resolve("../cainiao-widget.egern.js"), "utf8");
    const mod = new vm.SourceTextModule(source, {context: vm.createContext({})});
    await mod.link(() => {throw new Error("不允许外部依赖");}); await mod.evaluate();
    const f = fixture([success([parcel("a", "8-1-1111")])]);
    assert.equal(await mod.namespace.default(f.incoming()), undefined);
    assert.equal(saved(f).status, "pending");
    const output = await mod.namespace.default(f.ctx); assert.equal(output.type, "widget");
    assert.equal(Object.hasOwn(output, "url"), false); assert(JSON.stringify(output).includes("8-1-1111")); assert.equal(saved(f).status, "connected");
    const before = f.requests.length;
    const diagnostic = await mod.namespace.default({...f.ctx, env: {CAINIAO_DIAGNOSTIC: "true"}});
    assert.match(JSON.stringify(diagnostic), /查询已确认/); assert.equal(f.requests.length, before);
    assert(!JSON.stringify(diagnostic).includes("synthetic-user-a"));
});

test("新账号凭据写入失败仍持久阻断旧账号，存储恢复不能继续回显旧码", async () => {
    for (const failure of ["throw", "noop"]) {
        const f = fixture([success([parcel("a", "8-1-1111")])]); capture(f); await load(f);
        const original = f.ctx.storage.setJSON;
        f.ctx.storage.setJSON = (key, value) => {
            if (key === core.CW_AUTH_STORE) {if (failure === "throw") throw new Error("synthetic-write-error"); return;}
            original(key, value);
        };
        capture(f, "unb=synthetic-user-b; cookie2=synthetic-session-b");
        assert(saved(f).cookie.includes("synthetic-user-a")); assert.equal(f.memory.get(core.CW_STORE).blocked, true);
        f.ctx.storage.setJSON = original;
        f.replies.push(success([parcel("a", "8-1-1111")]));
        const model = await load(f); assert.equal(model.status, "setup"); assert.equal(model.items.length, 0);
        assert.equal(f.requests.length, 1); assert.match(model.message, /新账号/);
        capture(f, "unb=synthetic-user-b; cookie2=synthetic-session-b");
        f.replies.splice(0); f.replies.push(success([parcel("b", "8-2-2222")]));
        const next = await load(f); assert.equal(next.status, "ready"); assert(JSON.stringify(next).includes("8-2-2222"));
        assert(!JSON.stringify(next).includes("8-1-1111"));
    }
});

test("同账号并发刷新不会让迟到失败回滚较新的完整结果", async () => {
    for (const late of ["failure", "success"]) {
        const f = fixture([success([parcel("a", "8-1-1111")])]); capture(f); await load(f);
        let finish;
        f.replies.push(() => new Promise(resolve => {finish = resolve;}));
        const first = load(f);
        while (!finish) await Promise.resolve();
        f.advance(1000); f.replies.push(success([parcel("b", "8-2-2222")]));
        const latest = await load(f); assert.equal(latest.status, "ready");
        finish(late === "failure" ? response({}, [], 503) : success([parcel("a", "8-1-1111")]));
        const stale = await first; assert.equal(stale.status, "setup"); assert.equal(stale.items.length, 0);
        assert.deepEqual(f.memory.get(core.CW_STORE).snapshot.items, latest.items);
        assert.equal(f.memory.get(core.CW_STORE).snapshot.updatedAt, latest.updatedAt);
    }
});

test("自动网关响应仍过滤昵称和追踪 Cookie，只缓存必要登录态", async () => {
    const f = fixture([response({ret: ["SUCCESS::成功"], data: {packages: [parcel()], totalPage: 1}}, [
        "_nk_=synthetic-name; Domain=.taobao.com; Path=/", "cna=synthetic-tracker; Domain=.taobao.com; Path=/",
        "_m_h5_tk=synthetic-new-token_9; Domain=.taobao.com; Path=/",
    ])]); capture(f);
    assert.equal((await load(f)).status, "ready");
    assert(!/synthetic-name|synthetic-tracker|_nk_=|cna=/.test(f.memory.get(core.CW_STORE).cookie));
    assert(f.memory.get(core.CW_STORE).cookie.includes("synthetic-new-token_9"));
});

test("空手动参数和临时读错误不能绕过新账号隔离屏障", async () => {
    const f = fixture([success()]); capture(f); await load(f);
    const write = f.ctx.storage.setJSON, read = f.ctx.storage.getJSON;
    f.ctx.storage.setJSON = (key, value) => {if (key !== core.CW_AUTH_STORE) write(key, value);};
    capture(f, "unb=synthetic-user-b; cookie2=synthetic-session-b"); f.ctx.storage.setJSON = write;
    const barrier = structuredClone(f.memory.get(core.CW_STORE)); assert.equal(barrier.blocked, true);
    f.ctx.env.CONNECTION_MODE = "manual"; assert.equal((await load(f)).status, "setup");
    assert.deepEqual(f.memory.get(core.CW_STORE), barrier);
    f.ctx.env.CONNECTION_MODE = "auto";
    assert.equal((await load(f)).status, "setup"); assert.equal(f.requests.length, 1);
    f.ctx.storage.getJSON = key => {if (key === core.CW_STORE) throw new Error("synthetic-read-failure"); return read(key);};
    const unreadable = await load(f); assert.equal(unreadable.status, "setup"); assert.equal(unreadable.items.length, 0);
    assert.equal(f.requests.length, 1); assert.deepEqual(f.memory.get(core.CW_STORE), barrier);
});
