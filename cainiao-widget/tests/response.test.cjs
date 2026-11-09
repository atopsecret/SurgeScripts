// 引擎：Node.js 20+ 内置测试 | 版本：1.2.4 | 语言：JavaScript CommonJS
// 构建：node cainiao-widget/build.mjs
// 运行：node --experimental-vm-modules --test cainiao-widget/tests/response.test.cjs
// 依赖：内置库；仅合成头、原始字节、内存存储与 mock auth helper，禁止真实网络
const {test, before, after, mock} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const NOW = Date.UTC(2026, 10, 9, 8, 0);
const DAY = 86400000;
const WINDOW = 7 * DAY;
const MAX_BODY = 256 * 1024;
const UID = "900000000000000001";
const OTHER_UID = "900000000000000002";
const SESSION = "synthetic-response-session-not-native-sid";
const SG = "synthetic-response-sgcookie";
const TOKEN = "synthetic-response-token_1700000000000";
const PRIVATE = "synthetic-response-private-value-never-in-metadata";
const PDS_API = "mtop.cainiao.lpc.packageservice.queryPdsPackageDataList";
const COUNT_API = "mtop.cainiao.lpc.packageservice.user.package.count.query";
const TIME_API = "mtop.common.getTimestamp";
const LOGIN_API = "com.taobao.mtop.mLoginUnitService.login";
const REFRESH_API = "com.taobao.mtop.mLoginUnitService.autoLogin";
const LOGOUT_API = "com.taobao.mtop.mLoginUnitService.logout";
const NAMES = ["unb", "cookie2", "sgcookie", "munb", "_m_h5_tk", "_m_h5_tk_enc", "_tb_token_"];
const ROW_KEYS = ["host", "channel", "apiKind", "mode", "count", "at", "result", "httpClass", "cookies",
    "usable", "headerCount", "scopeCount", "deletedCount", "schema"];
const HOSTS = ["h5api.m.taobao.com", "acs.m.taobao.com", "cn-acs.m.cainiao.com", "e2e-mtop.cainiao.com"];
let response, core, source, logs = [], networkAttempts = 0;

const plain = value => JSON.parse(JSON.stringify(value));
const bytes = value => new Uint8Array(Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8"));

function headers(entries = [], getOnly = false) {
    const rows = entries.map(([name, value]) => [name.toLowerCase(), value]);
    const result = {get(name) {
        const selected = rows.filter(([key]) => key === name.toLowerCase()).map(([, value]) => value);
        return selected.length ? selected.join(", ") : null;
    }};
    if (!getOnly) result.getAll = name => rows.filter(([key]) => key === name.toLowerCase()).map(([, value]) => value);
    return Object.freeze(result);
}

function routeURL({host = "acs.m.taobao.com", channel = "gw", api = PDS_API} = {}) {
    return "https://" + host + "/" + channel + "/" + api + "/" + (channel === "h5" ? "1.0" : "*")
        + "/?synthetic=private-url-sentinel";
}

function setCookie(name, value, {domain = ".taobao.com", cookiePath = "/", extra = ""} = {}) {
    return name + "=" + value + (domain === null ? "" : "; Domain=" + domain)
        + (cookiePath === null ? "" : "; Path=" + cookiePath) + "; Secure; HttpOnly" + extra;
}

function fullCookies(options = {}) {
    return Object.entries({unb: UID, cookie2: SESSION, sgcookie: SG, munb: "synthetic-response-munb",
        _m_h5_tk: TOKEN, _m_h5_tk_enc: "synthetic-response-enc", _tb_token_: "synthetic-response-tb"})
        .map(([name, value]) => setCookie(name, value, options));
}

function fixture(options = {}) {
    const memory = new Map(), writes = [], candidates = [];
    const calls = {storageRead: 0, storageWrite: 0, requestBody: 0, responseText: 0, responseBody: 0, helper: 0};
    let now = NOW;
    const originalBytes = options.raw === undefined ? bytes(options.body ?? {ret: ["SUCCESS::" + PRIVATE], data: {}})
        : new Uint8Array(options.raw);
    const ctx = {
        env: {CONNECTION_MODE: "auto", ...options.env},
        request: {
            url: options.url || routeURL(options),
            headers: options.requestHeaders || headers(options.requestEntries || []),
            text: () => {calls.requestBody++; throw new Error(PRIVATE);},
            arrayBuffer: () => {calls.requestBody++; throw new Error(PRIVATE);},
        },
        response: {
            status: options.status ?? 200,
            headers: options.responseHeaders || headers((options.cookies || []).map(value => ["Set-Cookie", value])
                .concat(options.responseEntries || [])),
            text: async () => {calls.responseText++; throw new Error(PRIVATE);},
            arrayBuffer: async () => {calls.responseBody++; return originalBytes.slice().buffer;},
        },
        storage: {
            getJSON(key) {calls.storageRead++; return structuredClone(memory.get(key) ?? null);},
            setJSON(key, value) {
                calls.storageWrite++;
                const copy = structuredClone(value);
                writes.push({key, value: copy}); memory.set(key, copy);
            },
        },
        http: {get() {networkAttempts++; throw new Error("禁止真实网络");}},
        __calls: calls, __candidates: candidates,
    };
    const logStart = logs.length;
    return {ctx, memory, writes, candidates, calls, originalBytes, clock: () => now,
        setNow: value => {now = value;}, log: () => logs.slice(logStart)};
}

before(async () => {
    const denyNetwork = () => {networkAttempts++; throw new Error("响应单测禁止真实网络");};
    for (const name of ["node:http", "node:https"]) for (const method of ["get", "request"])
        mock.method(require(name), method, denyNetwork);
    for (const method of ["connect", "createConnection"]) mock.method(require("node:net"), method, denyNetwork);
    mock.method(require("node:net").Socket.prototype, "connect", denyNetwork);
    mock.method(require("node:tls"), "connect", denyNetwork);
    if (typeof globalThis.fetch === "function") mock.method(globalThis, "fetch", denyNetwork);
    const context = vm.createContext({URL, console: {log: (...values) => logs.push(values.join(" "))}, fetch: denyNetwork});
    const root = path.resolve(__dirname, "..");
    const modules = new Map();
    const authMock = new vm.SyntheticModule(["cwConnectionMode", "captureCainiaoResponseCandidate"], function() {
        this.setExport("cwConnectionMode", (env = {}) => {
            const mode = env.CONNECTION_MODE || "auto";
            return ["auto", "manual", "off"].includes(mode) ? mode : "invalid";
        });
        this.setExport("captureCainiaoResponseCandidate", (ctx, candidate, clock) => {
            ctx.__calls.helper++;
            ctx.__candidates.push({route: plain(candidate.route), cookies: Array.from(candidate.cookies)});
            return ctx.__helper ? ctx.__helper(candidate, clock) : "saved";
        });
    }, {context, identifier: "synthetic-auth"});
    async function load(name) {
        if (name === "auth.mjs") return authMock;
        if (modules.has(name)) return modules.get(name);
        assert(["core.mjs", "app.mjs", "response.mjs"].includes(name), "只允许已有本地模块，不允许外部导入");
        const text = fs.readFileSync(path.join(root, name), "utf8");
        const module = new vm.SourceTextModule(text, {context, identifier: name});
        modules.set(name, module);
        await module.link(specifier => {
            assert(/^\.\/(?:core|app|auth)\.mjs$/.test(specifier), "响应模块必须自包含构建");
            return load(specifier.slice(2));
        });
        return module;
    }
    const module = await load("response.mjs");
    await module.evaluate();
    response = module.namespace; core = modules.get("core.mjs").namespace;
    source = fs.readFileSync(path.join(root, "response.mjs"), "utf8");
});

after(() => {
    mock.restoreAll();
    assert.equal(networkAttempts, 0, "全部请求与响应只存在于合成内存夹具");
    assert(!logs.some(line => line.includes(PRIVATE) || line.includes(UID) || line.includes(SESSION)), "异常或凭据不进入日志");
});

const metadata = f => f.memory.get(core.CW_RESPONSE_STORE);
const row = (f, mode = "headers") => metadata(f)?.rows.find(item => item.mode === mode);
const summary = f => plain(response.cwResponseLines(f.ctx, f.clock()));
const parse = (cookies, options = {}) => response.cwResponseCookies(options.headers || headers(cookies.map(value => ["Set-Cookie", value])),
    {host: options.host || "acs.m.taobao.com", channel: "gw", apiKind: "personal_list"}, options.pathname || "/gw/mtop.example/*/", options.now ?? NOW);

async function capture(f, clock = f.clock) {
    const request = f.ctx.request, originalResponse = f.ctx.response;
    const requestHeaders = request?.headers, responseHeaders = originalResponse?.headers;
    const result = await response.captureCainiaoResponse(f.ctx, clock);
    assert.equal(f.ctx.request, request);
    assert.equal(f.ctx.response, originalResponse);
    if (request) assert.equal(f.ctx.request.headers, requestHeaders);
    if (originalResponse) assert.equal(f.ctx.response.headers, responseHeaders);
    assert.equal(f.calls.requestBody, 0);
    assert.equal(f.calls.responseText, 0);
    return result;
}

function noBody(f) {
    assert.equal(f.calls.requestBody + f.calls.responseText + f.calls.responseBody, 0);
}

function assertBytes(result, expected) {
    assert(result && Object.prototype.toString.call(result.body) === "[object Uint8Array]");
    assert.deepEqual(Object.keys(result), ["body"], "不替换响应头、状态或其它字段");
    assert.deepEqual(Array.from(result.body), Array.from(expected), "正文按原始字节返回，不重编码");
}

function safeRecord(f) {
    const report = JSON.stringify({state: metadata(f), lines: summary(f), logs: f.log()});
    for (const secret of [PRIVATE, UID, OTHER_UID, SESSION, SG, TOKEN, "private-url-sentinel", "synthetic-native-sid",
        "synthetic-request-session", "synthetic-request-token"]) assert(!report.includes(secret), secret + " 不得进入取证输出");
    if (metadata(f)) {
        assert.deepEqual(Object.keys(metadata(f)).sort(), ["version", "startedAt", "rows"].sort());
        for (const item of metadata(f).rows) assert.deepEqual(Object.keys(item).sort(), ROW_KEYS.slice().sort());
    }
}

function seedRow(overrides = {}) {
    return {host: "acs.m.taobao.com", channel: "gw", apiKind: "personal_list", mode: "headers", count: 1, at: NOW,
        result: "none", httpClass: "HTTP_200", cookies: [], usable: 0, headerCount: 0, scopeCount: 0, deletedCount: 0, schema: null,
        ...overrides};
}

function seed(f, rows, startedAt = NOW) {
    f.memory.set(core.CW_RESPONSE_STORE, {version: core.CW_VERSION, startedAt, rows: structuredClone(rows)});
}

test("响应模块仅导入已有本地 helper，版本和取证键独立", () => {
    assert.equal(core.CW_VERSION, "1.3.0");
    assert.equal(core.CW_RESPONSE_STORE, "cainiao-widget.response.v1");
    for (const name of ["captureCainiaoResponse", "cwResponseLines", "cwResponseCookies", "cwResponseSchema"])
        assert.equal(typeof response[name], "function");
    assert(!/^import.*(?:https?:|node:|npm:)/m.test(source));
    assert(!/\b(?:TextDecoder|Buffer)\s*[.(]/.test(source), "手机模块不依赖 Node Buffer 或未保证的 TextDecoder");
    for (const match of source.matchAll(/^(?:export )?(?:async )?function (\w+)/gm))
        assert(match[1] === "captureCainiaoResponse" || match[1].startsWith("cwResponse"), "避免 bundle 全局函数冲突");
});

test("manual、off、未知模式只透传，不读存储、正文或提交候选", async () => {
    for (const mode of ["manual", "off", "unexpected"]) {
        const f = fixture({env: {CONNECTION_MODE: mode, CW_LOGIN_SCHEMA: "true"}, api: LOGIN_API, cookies: fullCookies()});
        assert.equal(await capture(f), undefined);
        assert.equal(f.calls.storageRead + f.calls.storageWrite + f.calls.helper, 0);
        noBody(f);
    }
});

test("缺少 request 或 response 的 generic 入口不启动响应采集", async () => {
    for (const missing of ["request", "response"]) {
        const f = fixture(); delete f.ctx[missing];
        assert.equal(await capture(f), undefined);
        assert.equal(f.calls.storageRead + f.calls.storageWrite + f.calls.helper, 0);
        noBody(f);
    }
});

test("四个精确主机均能记录 H5/GW 响应，菜鸟域 Cookie 不被摊平到淘宝", async () => {
    for (const host of HOSTS) for (const channel of ["h5", "gw"]) {
        const domain = host.endsWith("cainiao.com") ? ".cainiao.com" : ".taobao.com";
        const f = fixture({host, channel, cookies: fullCookies({domain})});
        assert.equal(await capture(f), undefined);
        assert.equal(row(f).host, host); assert.equal(row(f).channel, channel);
        assert.equal(f.calls.helper, host.endsWith("cainiao.com") ? 0 : 1);
        if (host.endsWith("cainiao.com")) assert.equal(row(f).result, "scope");
        noBody(f); safeRecord(f);
    }
});

test("非 HTTPS、伪域、非443端口、userinfo、片段和非法尾路径完全忽略", async () => {
    const invalid = [
        "http://acs.m.taobao.com/gw/mtop.example/*/", "https://acs.m.taobao.com:80/gw/mtop.example/*/",
        "https://acs.m.taobao.com:444/gw/mtop.example/*/", "https://acs.m.taobao.com.evil.invalid/gw/mtop.example/*/",
        "https://user@acs.m.taobao.com/gw/mtop.example/*/", "https://@acs.m.taobao.com/gw/mtop.example/*/",
        "https://acs.m.taobao.com/gw/mtop.example/*/#secret", "https://acs.m.taobao.com/gw/mtop.example/1.0/extra",
        "https://acs.m.taobao.com/h5/mtop.example/", "https://acs.m.taobao.com/h5/mtop.example/*/",
        "https://acs.m.taobao.com/gw/com.taobao.mtop.mLoginUnitService.login.evil/*/",
    ];
    for (const url of invalid) {
        const f = fixture({url, cookies: fullCookies()});
        assert.equal(await capture(f), undefined); noBody(f);
        assert.equal(f.calls.storageRead + f.calls.storageWrite + f.calls.helper, 0);
    }
});

test("Host 必须与 URL 的 HTTPS authority 一致，普通对象也不能绕过", async () => {
    for (const requestHeaders of [headers([["Host", "evil.invalid"]]), headers([["Host", "acs.m.taobao.com:80"]]),
        headers([["Host", "acs.m.taobao.com"], ["Host", "h5api.m.taobao.com"]]), {Host: "evil.invalid"}, {HOST: null}]) {
        const f = fixture({requestHeaders, cookies: fullCookies()});
        assert.equal(await capture(f), undefined); noBody(f);
        assert.equal(f.calls.storageRead + f.calls.storageWrite + f.calls.helper, 0);
    }
    const f = fixture({url: "https://ACS.M.TAOBAO.COM:443/gw/mtop.example/*/",
        requestEntries: [["Host", "ACS.M.TAOBAO.COM:443"]], cookies: fullCookies()});
    await capture(f); assert.equal(f.calls.helper, 1);
});

test("请求或响应 self 标记按存在性跳过，包括空值及大小写", async () => {
    for (const side of ["request", "response"]) for (const getOnly of [false, true]) {
        const f = fixture({cookies: fullCookies(), api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}});
        f.ctx[side].headers = headers([[core.CW_SELF_HEADER.toLowerCase(), ""]], getOnly);
        assert.equal(await capture(f), undefined); noBody(f);
        assert.equal(f.calls.storageRead + f.calls.storageWrite + f.calls.helper, 0);
    }
    const f = fixture({responseHeaders: {"x-cainiao-widget-request": "synthetic"}, cookies: fullCookies()});
    await capture(f); assert.equal(f.calls.storageWrite, 0);
});

test("普通响应只读实际 Set-Cookie，不能借请求 Cookie、Cookie响应头或 SID", async () => {
    const f = fixture({requestEntries: [["Cookie", "unb=" + UID + "; cookie2=synthetic-request-session; _m_h5_tk=synthetic-request-token"],
        ["x-uid", UID], ["x-sid", "synthetic-native-sid"]], responseEntries: [["Cookie", "unb=" + UID + "; cookie2=" + SESSION]]});
    assert.equal(await capture(f), undefined); noBody(f);
    assert.equal(f.calls.helper, 0); assert.equal(row(f).result, "none");
    safeRecord(f);
});

test("七项白名单原值仅传给候选 helper，未知字段不出现在元数据", async () => {
    const values = fullCookies().concat(setCookie("unknown-account-field", PRIVATE));
    const f = fixture({cookies: values});
    await capture(f); noBody(f);
    assert.equal(f.calls.helper, 1);
    assert.deepEqual(Object.fromEntries(f.candidates[0].cookies), {unb: UID, cookie2: SESSION, sgcookie: SG,
        munb: "synthetic-response-munb", _m_h5_tk: TOKEN, _m_h5_tk_enc: "synthetic-response-enc", _tb_token_: "synthetic-response-tb"});
    assert.deepEqual(row(f).cookies, NAMES);
    assert.equal(row(f).headerCount, 8); assert.equal(row(f).usable, 7);
    safeRecord(f);
});

test("host-only Cookie 只可用于 h5api 且 Path 覆盖全部三项业务", () => {
    for (const host of HOSTS) {
        const parsed = parse(fullCookies({domain: null, cookiePath: "/h5/"}), {host});
        assert.equal(parsed.cookies.size, host === "h5api.m.taobao.com" ? 7 : 0);
        assert.equal(parsed.scopeCount, host === "h5api.m.taobao.com" ? 0 : 7);
    }
});

test("Domain 同时匹配响应来源和固定 H5主机，拒绝跨菜鸟域及伪域", () => {
    for (const domain of [".taobao.com", "TAOBAO.COM", ".m.taobao.com"]) assert.equal(parse(fullCookies({domain})).cookies.size, 7);
    for (const domain of [".cainiao.com", "h5api.m.taobao.com", "taobao.com.evil.invalid", "evil.invalid"])
        assert.equal(parse(fullCookies({domain})).result, "scope");
    assert.equal(parse(fullCookies({domain: ".taobao.com"}), {host: "cn-acs.m.cainiao.com"}).result, "scope");
    for (const domain of [".com", "..taobao.com", "taobao.com.", "-taobao.com", "taobao-.com", "localhost"])
        assert.equal(parse(fullCookies({domain})).result, "invalid");
});

test("Path 使用路径边界且同时覆盖 identity、COUNT、PDS，默认业务窄路径拒绝", () => {
    for (const cookiePath of ["/", "/h5", "/h5/"]) assert.equal(parse(fullCookies({cookiePath})).cookies.size, 7);
    for (const cookiePath of [core.CW_PATH, core.CW_COUNT_PATH, core.CW_IDENTITY_PATH, "/gw/", "/h5x", "/h5//"])
        assert.equal(parse(fullCookies({cookiePath})).result, "scope");
    assert.equal(parse(fullCookies({cookiePath: null})).result, "scope");
    assert.equal(parse(fullCookies({cookiePath: null}), {host: "h5api.m.taobao.com", pathname: core.CW_PATH}).result, "scope");
});

test("合并 Set-Cookie 不把 Expires 的逗号切成新 Cookie", () => {
    const future = new Date(NOW + DAY).toUTCString();
    const combined = setCookie("cookie2", SESSION, {extra: "; Expires=" + future}) + ", " + setCookie("unb", UID);
    const parsed = parse([combined]);
    assert.equal(parsed.result, "usable"); assert.equal(parsed.headerCount, 2);
    assert.equal(parsed.cookies.get("cookie2"), SESSION); assert.equal(parsed.cookies.get("unb"), UID);
});

test("完全相同的重复 Cookie 或属性幂等，属性顺序和规范化大小写不制造冲突", () => {
    const first = "cookie2=" + SESSION + "; Path=/; Domain=.TAOBAO.COM; Secure; HttpOnly; Path=/";
    const second = "cookie2=" + SESSION + "; HttpOnly; Domain=taobao.com; Path=/; Secure";
    const parsed = parse([first, second]);
    assert.equal(parsed.result, "usable"); assert.equal(parsed.headerCount, 2); assert.equal(parsed.cookies.size, 1);
});

test("同名 Cookie 值或重复 Domain/Path/Max-Age 属性冲突均 fail closed", () => {
    const base = setCookie("cookie2", SESSION);
    for (const values of [[base, setCookie("cookie2", "synthetic-other-session")],
        [base, setCookie("cookie2", SESSION, {cookiePath: "/h5/"})], [base + "; Domain=evil.invalid"],
        [base + "; Path=/h5/"], [base + "; Max-Age=1; Max-Age=0"],
        [setCookie("unknown", "one"), setCookie("unknown", "two")]]) {
        const parsed = parse(values);
        assert.equal(parsed.result, "conflict"); assert.equal(parsed.cookies.size, 0); assert.deepEqual(plain(parsed.names), []);
    }
});

test("ASCII、Cookie 语法、单值长度和属性格式异常不留下局部可信值", () => {
    const bad = ["cookie2=" + PRIVATE + "\r\n", "cookie2=非ASCII", "cookie2=has space", "cookie2=has,comma",
        "cookie2=has\\slash", "cookie2=\"unclosed", "=missing-name", "cookie2=" + "x".repeat(8193),
        setCookie("cookie2", SESSION, {extra: "; Secure=1"}), setCookie("cookie2", SESSION, {extra: "; Max-Age=not-a-number"}),
        setCookie("cookie2", SESSION, {extra: "; Expires=not-a-date"}), setCookie("cookie2", SESSION, {extra: "; SameSite=unknown"}),
        setCookie("cookie2", SESSION, {cookiePath: "no-leading-slash"}), setCookie("cookie2", SESSION, {cookiePath: "/bad path"})];
    for (const invalid of bad) {
        const parsed = parse([setCookie("unb", UID), invalid]);
        assert.equal(parsed.result, "invalid"); assert.equal(parsed.cookies.size, 0);
    }
});

test("到期、空值与 Max-Age 删除生效，正 Max-Age 优先于旧 Expires", () => {
    const expired = new Date(NOW).toUTCString();
    for (const extra of ["; Max-Age=0", "; Max-Age=-1", "; Expires=" + expired]) {
        const parsed = parse([setCookie("cookie2", SESSION, {extra})]);
        assert.equal(parsed.result, "deleted"); assert.deepEqual(plain(parsed.deleted), ["cookie2"]);
        assert.equal(parsed.cookies.size, 0);
    }
    assert.equal(parse([setCookie("cookie2", "")]).result, "deleted");
    assert.equal(parse([setCookie("cookie2", '""')]).result, "deleted");
    assert.equal(parse([setCookie("cookie2", SESSION, {extra: "; Max-Age=1; Expires=" + expired})]).cookies.get("cookie2"), SESSION);
});

test("Set-Cookie 数量64条与64KiB边界有界，超限固定分类且不采纳前缀", () => {
    const sixtyFour = Array.from({length: 62}, (_, index) => setCookie("unknown" + index, "x")).concat(fullCookies().slice(0, 2));
    assert.equal(parse(sixtyFour).headerCount, 64); assert.equal(parse(sixtyFour).cookies.size, 2);
    assert.equal(parse(sixtyFour.concat(setCookie("extra", "x"))).result, "limit");
    assert.equal(parse([sixtyFour.concat(setCookie("extra", "x")).join(", ")]).result, "limit");
    const prefix = setCookie("cookie2", SESSION) + "; extension=";
    const exact = prefix + "x".repeat(65536 - prefix.length);
    assert.equal(parse([exact]).cookies.get("cookie2"), SESSION);
    const over = parse([exact + "x"]);
    assert.equal(over.result, "limit"); assert.equal(over.cookies.size, 0);
});

test("get-only 与对象多 Set-Cookie 保留实际字段，getter异常只给固定分类", () => {
    const cookies = fullCookies();
    for (const container of [headers(cookies.map(value => ["SET-COOKIE", value]), true),
        {"Set-Cookie": cookies.slice(0, 3), "set-cookie": cookies.slice(3)}]) {
        assert.equal(parse([], {headers: container}).cookies.size, 7);
    }
    for (const container of [{getAll: () => {throw new Error(PRIVATE);}}, {getAll: () => null}, {"set-cookie": [null]}]) {
        const parsed = parse([], {headers: container});
        assert.equal(parsed.result, "invalid"); assert.equal(parsed.cookies.size, 0);
        assert(!JSON.stringify(plain(parsed)).includes(PRIVATE));
    }
});

test("同次请求 unb、x-uid 或一致组合可以只补 unb，绝不借请求 session/token/SID", async () => {
    for (const uidEntries of [[["Cookie", "unb=" + UID]], [["x-uid", UID]], [["Cookie", "unb=" + UID], ["x-uid", UID]]]) {
        const f = fixture({cookies: [setCookie("cookie2", SESSION)], requestEntries: uidEntries.concat([
            ["Cookie", "cookie2=synthetic-request-session; _m_h5_tk=synthetic-request-token"], ["x-sid", PRIVATE]])});
        await capture(f);
        assert.equal(f.calls.helper, 1);
        assert.deepEqual(Object.fromEntries(f.candidates[0].cookies), {cookie2: SESSION, unb: UID});
        assert.deepEqual(row(f).cookies, ["cookie2"], "推导 unb 不是实际 Set-Cookie 字段证据");
        noBody(f); safeRecord(f);
    }
});

test("有效 server unb 可独立约束候选，缺全部同次 UID 仍匿名", async () => {
    const server = fixture({cookies: [setCookie("cookie2", SESSION), setCookie("unb", UID)]});
    await capture(server); assert.equal(server.calls.helper, 1); assert.equal(row(server).result, "saved");
    const anonymous = fixture({cookies: [setCookie("cookie2", SESSION)]});
    await capture(anonymous); assert.equal(anonymous.calls.helper, 0); assert.equal(row(anonymous).result, "anonymous");
});

test("合法但冲突的 response/request UID 必须进入 helper 的账号屏障分支", async () => {
    for (const requestEntries of [[["x-uid", OTHER_UID]], [["Cookie", "unb=" + OTHER_UID]],
        [["Cookie", "unb=" + UID], ["x-uid", OTHER_UID]]]) {
        const f = fixture({cookies: [setCookie("cookie2", SESSION), setCookie("unb", UID)], requestEntries});
        f.ctx.__helper = () => {f.memory.set("synthetic-barrier", {blocked: true}); return "conflict";};
        await capture(f);
        assert.equal(f.calls.helper, 1, "不能提前 throw 后只记录分类，遗漏真实 auth helper 隔离");
        assert.deepEqual(f.memory.get("synthetic-barrier"), {blocked: true});
        assert.equal(row(f).result, "conflict"); safeRecord(f);
    }
});

test("仅请求 Cookie.unb 与 x-uid 冲突仍交 helper，helper异常不会误报保存", async () => {
    for (const outcome of ["saved", "conflict", "storage"]) {
        const f = fixture({cookies: [setCookie("cookie2", SESSION)], requestEntries: [["Cookie", "unb=" + UID], ["x-uid", OTHER_UID]]});
        f.ctx.__helper = () => outcome;
        await capture(f); assert.equal(f.calls.helper, 1);
        assert.equal(row(f).result, outcome === "storage" ? "storage" : "conflict");
    }
});

test("所有出现的 UID 必须1至20位正十进制，空值和非法值不会被另一身份补救", async () => {
    for (const invalid of ["", "0", "01", "-1", "1.5", "1e3", "1 2", "a123", "1".repeat(21)]) {
        for (const field of ["server", "native", "cookie"]) {
            const f = fixture({cookies: [setCookie("cookie2", SESSION), setCookie("unb", field === "server" ? invalid : UID)],
                requestEntries: field === "native" ? [["x-uid", invalid]] : field === "cookie" ? [["Cookie", "unb=" + invalid]] : []});
            await capture(f);
            assert.equal(f.calls.helper, 0, field + "=" + invalid);
            assert.notEqual(row(f).result, "saved");
        }
    }
});

test("重名歧义Cookie请求头fail closed，完全相同的重复Cookie或x-uid可用", async () => {
    const cases = [[[["Cookie", "unb=" + UID + "; unb=" + OTHER_UID]], "invalid"],
        [[["Cookie", "unb=" + UID], ["Cookie", "unb=" + OTHER_UID]], "conflict"]];
    for (const [requestEntries, result] of cases) {
        const f = fixture({cookies: fullCookies(), requestEntries});
        await capture(f); assert.equal(f.calls.helper, 0); assert.equal(row(f).result, result);
    }
    const f = fixture({cookies: fullCookies(), requestEntries: [["x-uid", UID], ["x-uid", UID], ["Cookie", "unb=" + UID], ["Cookie", "unb=" + UID]]});
    await capture(f); assert.equal(f.calls.helper, 1);
});

test("多x-uid均合法但值冲突时保留全部请求证据进入helper，不能提前throw漏账号屏障", async () => {
    for (const cookies of [fullCookies(), [setCookie("cookie2", SESSION)]]) {
        const f = fixture({cookies, requestEntries: [["x-uid", UID], ["x-uid", OTHER_UID]]});
        f.ctx.__helper = () => {f.memory.set("synthetic-barrier", {blocked: true}); return "conflict";};
        await capture(f);
        assert.equal(f.calls.helper, 1); assert.equal(row(f).result, "conflict");
        assert.deepEqual(f.memory.get("synthetic-barrier"), {blocked: true});
        safeRecord(f);
    }
});

test("普通对象的同次UID不因accessor差异绕过冲突，Host仍严格检查", async () => {
    const f = fixture({cookies: fullCookies(), requestHeaders: {Host: "acs.m.taobao.com", Cookie: "unb=" + UID,
        "X-Uid": [UID, OTHER_UID]}});
    f.ctx.__helper = () => "conflict";
    await capture(f); assert.equal(f.calls.helper, 1); assert.equal(row(f).result, "conflict");
    assert.equal(f.candidates[0].route.host, "acs.m.taobao.com"); safeRecord(f);
});

test("候选不足时不借旧session或UID制造新凭据，也不调用需要完整候选的helper", async () => {
    const f = fixture({cookies: [setCookie("unb", UID), setCookie("_m_h5_tk", TOKEN)],
        requestEntries: [["x-uid", UID], ["x-uid", OTHER_UID]]});
    f.memory.set("synthetic-existing-cache", {blocked: false});
    await capture(f); assert.equal(f.calls.helper, 0); assert.equal(row(f).result, "anonymous");
    assert.deepEqual(f.memory.get("synthetic-existing-cache"), {blocked: false}); safeRecord(f);
});

test("响应 unb 已删除、到期或作用域不适用时不借请求 UID 补回", async () => {
    for (const invalidUnb of [setCookie("unb", ""), setCookie("unb", UID, {extra: "; Max-Age=0"}),
        setCookie("unb", UID, {extra: "; Expires=" + new Date(NOW).toUTCString()}),
        setCookie("unb", OTHER_UID, {domain: ".cainiao.com"}), setCookie("unb", OTHER_UID, {cookiePath: "/gw/"})]) {
        const f = fixture({cookies: [setCookie("cookie2", SESSION), invalidUnb], requestEntries: [["x-uid", UID]]});
        await capture(f); assert.equal(f.calls.helper, 0); assert.notEqual(row(f).result, "saved");
    }
});

test("多响应不能拼 UID/session/token，元数据只保留最近响应字段而非并集", async () => {
    const f = fixture({cookies: [setCookie("unb", UID), setCookie("_m_h5_tk", TOKEN)]});
    f.ctx.env.CAINIAO_COOKIE = "unb=" + UID + "; cookie2=synthetic-request-session";
    await capture(f); assert.equal(f.calls.helper, 0);
    f.setNow(NOW + 1000); f.ctx.response.headers = headers([["Set-Cookie", setCookie("cookie2", SESSION)]]);
    await capture(f);
    assert.equal(f.calls.helper, 0); assert.equal(row(f).count, 2); assert.deepEqual(row(f).cookies, ["cookie2"]);
    assert.equal(row(f).result, "anonymous"); safeRecord(f);
});

test("公共时间和退出响应即使完整 Cookie/SUCCESS 也不会形成新候选", async () => {
    for (const api of [TIME_API, LOGOUT_API]) {
        const f = fixture({api, cookies: fullCookies(), requestEntries: [["x-uid", UID]]});
        await capture(f); noBody(f); assert.equal(f.calls.helper, 0);
        assert.equal(row(f).result, api === TIME_API ? "public_time" : "logout");
        safeRecord(f);
    }
});

test("非200响应仍记录固定 HTTP分类，但不提交认证候选", async () => {
    const expected = new Map([[201, "HTTP_2XX"], [302, "HTTP_3XX"], [401, "HTTP_401"], [403, "HTTP_403"],
        [429, "HTTP_429"], [404, "HTTP_4XX"], [503, "HTTP_5XX"], [0, "HTTP_OTHER"], [200.5, "NONE"]]);
    for (const [status, classification] of expected) {
        const f = fixture({status, cookies: fullCookies()}); await capture(f);
        assert.equal(f.calls.helper, 0); assert.equal(row(f).result, "invalid"); assert.equal(row(f).httpClass, classification);
        noBody(f);
    }
});

test("helper固定结果可读，未知结果与异常原文不进入存储或日志", async () => {
    const fixedResults = ["saved", "unchanged", "anonymous", "conflict", "storage", "invalid", "superseded"];
    for (const outcome of [...fixedResults, "public_time", "schema", "scope", PRIVATE, new Error(PRIVATE)]) {
        const f = fixture({cookies: fullCookies()});
        f.ctx.__helper = () => {if (outcome instanceof Error) throw outcome; return outcome;};
        await capture(f);
        assert.equal(row(f).result, fixedResults.includes(outcome) ? outcome : "invalid");
        noBody(f); safeRecord(f);
    }
});

test("已知登录/续登 schema 入口各只做一次头采集和一次原字节读取，退出不采候选", async () => {
    for (const api of [LOGIN_API, REFRESH_API, LOGOUT_API]) {
        const original = bytes("\ufeff" + JSON.stringify({ret: ["SUCCESS::" + PRIVATE], data: {userId: UID, cookies: [PRIVATE],
            sid: "synthetic-native-sid", autoLoginToken: TOKEN, nick: "合成昵称😀"}}));
        const f = fixture({api, env: {CW_LOGIN_SCHEMA: "true"}, cookies: fullCookies(), raw: original});
        assertBytes(await capture(f), original);
        assert.equal(f.calls.responseBody, 1); assert.equal(f.calls.helper, api === LOGOUT_API ? 0 : 1);
        assert.equal(metadata(f).rows.length, 2); assert.equal(row(f).count, 1); assert.equal(row(f, "schema").count, 1);
        assert.equal(row(f, "schema").schema.format, "JSON"); assert.equal(row(f, "schema").schema.ret, "SUCCESS");
        assert.equal(f.log().length, 0, "规范化回读不因属性顺序制造存储失败"); safeRecord(f);
    }
});

test("schema只读三个精确登录API，普通MTOP/公共时间/伪com API均不读正文", async () => {
    for (const api of [PDS_API, TIME_API, "mtop.user.getUserSimple", LOGIN_API + ".extra", "com.taobao.private.login"]) {
        const f = fixture({api, cookies: fullCookies(), env: {CW_LOGIN_SCHEMA: "true"}});
        assert.equal(await capture(f), undefined); noBody(f);
        assert.equal(f.calls.helper + f.calls.storageWrite, 0);
    }
});

test("CW_LOGIN_SCHEMA 仅字符串true启用正文，其他值仍不读body", async () => {
    for (const value of [true, false, "TRUE", "false", "1", undefined]) {
        const f = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: value}});
        assert.equal(await capture(f), undefined); noBody(f);
        assert.equal(metadata(f).rows.length, 1); assert.equal(row(f).mode, "headers");
    }
});

test("正文userId/cookies/sid/token只保留类型和数量，不能单独形成候选", async () => {
    const body = {ret: ["SUCCESS::" + PRIVATE], data: {userId: UID, cookies: [SESSION, PRIVATE], sid: PRIVATE,
        autoLoginToken: TOKEN, success: true, loginSuccess: false, resultCode: 123,
        unknown: {unb: OTHER_UID, cookie2: PRIVATE, returnValue: {cookies: [PRIVATE]}}}};
    const f = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}, body});
    assertBytes(await capture(f), bytes(body));
    assert.equal(f.calls.helper, 0); assert.equal(metadata(f).rows.length, 2);
    const fields = row(f, "schema").schema.paths[0].fields;
    assert.deepEqual(fields, [{name: "userId", type: "string", count: null}, {name: "cookies", type: "array", count: 2},
        {name: "sid", type: "string", count: null}, {name: "autoLoginToken", type: "string", count: null},
        {name: "success", type: "boolean", count: null}, {name: "loginSuccess", type: "boolean", count: null},
        {name: "resultCode", type: "number", count: null}]);
    assert(!JSON.stringify(metadata(f)).includes("unknown")); safeRecord(f);
});

test("仅data/returnValue/data三个静态路径，缺失/null/数组准确分类而非递归取证", () => {
    const body = {ret: ["SUCCESS::" + PRIVATE], data: {returnValue: {data: {userId: UID, cookies: [PRIVATE]},
        arbitrary: {cookies: [PRIVATE]}}, unknown: {returnValue: {userId: OTHER_UID}}}};
    const schema = plain(response.cwResponseSchema(bytes(body)));
    assert.deepEqual(schema.paths.map(item => item.path), ["$.data", "$.data.returnValue", "$.data.returnValue.data"]);
    assert.equal(schema.paths[2].fields[0].name, "userId");
    for (const data of [null, [], "not-json-string", 1, true]) {
        const parsed = plain(response.cwResponseSchema(bytes({data})));
        assert.equal(parsed.paths[1].type, "missing"); assert.equal(parsed.paths[2].type, "missing");
        assert.equal(parsed.paths[0].fields.length, 0);
    }
    assert(!JSON.stringify(schema).includes(PRIVATE));
});

test("JSON字符串wrapper最多累计两层，第三层不被递归解包", () => {
    const payload = {data: {userId: UID}};
    // 外层 JSON.parse 是读取 App 响应 JSON；之后才计两层字符串封装。
    const twice = JSON.stringify(JSON.stringify(JSON.stringify(payload)));
    const allowed = plain(response.cwResponseSchema(bytes(twice)));
    assert.equal(allowed.paths[0].decodedType, "object");
    const three = plain(response.cwResponseSchema(bytes(JSON.stringify(twice))));
    assert.deepEqual(three.paths, []);
    const pathWrapped = {data: JSON.stringify({returnValue: JSON.stringify({data: JSON.stringify({userId: UID})})})};
    const parsed = plain(response.cwResponseSchema(bytes(pathWrapped)));
    assert.equal(parsed.paths[0].type, "string"); assert.equal(parsed.paths[0].decodedType, "object");
    assert.equal(parsed.paths[1].decodedType, "object"); assert.equal(parsed.paths[2].decodedType, "string");
    assert.equal(parsed.paths[2].fields.length, 0);
});

test("JSON/HTML/损坏JSON/二进制/压缩/未知/空正文均给固定分类，不重编码", async () => {
    const samples = [[bytes({data: {}}), "JSON"], [bytes("<html>" + PRIVATE + "</html>"), "HTML"],
        [bytes('{"data":'), "JSON_INVALID"], [new Uint8Array([255, 0, 13, 10]), "BINARY"],
        [new Uint8Array([31, 139, 8, 0]), "GZIP"], [new Uint8Array([120, 156, 1, 2]), "ZLIB"],
        [bytes("unknown-" + PRIVATE), "UNKNOWN"], [bytes(" \r\n\t"), "EMPTY"]];
    for (const [raw, classification] of samples) {
        const f = fixture({api: REFRESH_API, env: {CW_LOGIN_SCHEMA: "true"}, raw});
        assertBytes(await capture(f), raw); assert.equal(row(f, "schema").schema.format, classification);
        assert.equal(f.calls.helper, 0); safeRecord(f);
    }
});

test("gzip/deflate/br Content-Encoding如实分类，不调用解压器或把压缩token当登录", () => {
    for (const [encoding, classification] of [["gzip", "GZIP"], ["deflate", "ZLIB"], ["zlib", "ZLIB"], ["br", "BINARY"], ["identity", "JSON"]]) {
        const parsed = response.cwResponseSchema(bytes({data: {userId: UID}}), headers([["Content-Encoding", encoding]]));
        assert.equal(parsed.format, classification);
    }
    assert.equal(response.cwResponseSchema(bytes("{}"), headers([["Content-Encoding", null]])).format, "HEADER_INVALID");
});

test("UTF-8过长、截断、代理码点和非法范围不被误读成JSON，BOM保留在返回体", () => {
    for (const raw of [[194], [192, 175], [224, 128, 128], [237, 160, 128], [244, 144, 128, 128], [245, 128, 128, 128]])
        assert.equal(response.cwResponseSchema(new Uint8Array(raw)).format, "BINARY");
    assert.equal(response.cwResponseSchema(bytes("\ufeff" + JSON.stringify({data: {userId: "合成😀"}}))).format, "JSON");
});

test("ret只输出NONE/SUCCESS/FAILURE/UNKNOWN，不保留固定或未知服务端代码文本", () => {
    const samples = [[undefined, "NONE"], [["SUCCESS::" + PRIVATE], "SUCCESS"], [["FAIL_SYS_SESSION_EXPIRED::" + PRIVATE], "FAILURE"],
        [["SUCCESS::ok", "FAIL_SYS_X::" + PRIVATE], "FAILURE"], [[PRIVATE], "UNKNOWN"], [[123], "UNKNOWN"],
        [[], "UNKNOWN"], [["fail_sys_x::" + PRIVATE], "UNKNOWN"], [Array(65).fill("SUCCESS::" + PRIVATE), "UNKNOWN"]];
    for (const [ret, classification] of samples) {
        const schema = plain(response.cwResponseSchema(bytes({...(ret === undefined ? {} : {ret}), data: {}})));
        assert.equal(schema.ret, classification); assert(!JSON.stringify(schema).includes(PRIVATE));
        assert(!JSON.stringify(schema).includes("FAIL_SYS_SESSION_EXPIRED"));
    }
});

test("正文读取抛错或返回非bytes时不伪造空正文，保留原响应与固定READ_ERROR", async () => {
    for (const read of [async () => {throw new Error(PRIVATE);}, async () => "not-bytes"]) {
        const f = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}});
        f.ctx.response.arrayBuffer = async () => {f.calls.responseBody++; return read();};
        assert.equal(await capture(f), undefined); assert.equal(f.calls.responseBody, 1);
        assert.equal(row(f, "schema").schema.format, "READ_ERROR"); assert.equal(row(f, "schema").result, "read_error");
        safeRecord(f);
    }
});

test("Content-Length损坏/冲突/超限时不读取body，不泄露header原文", async () => {
    for (const entries of [[["Content-Length", PRIVATE]], [["Content-Length", "1"], ["Content-Length", "2"]],
        [["Content-Length", null]], [["Content-Length", "1\r\n"]], Array(9).fill(["Content-Length", "1"])]) {
        const f = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}, responseEntries: entries});
        assert.equal(await capture(f), undefined); noBody(f);
        assert.equal(row(f, "schema").schema.format, "HEADER_INVALID"); safeRecord(f);
    }
    const f = fixture({api: REFRESH_API, env: {CW_LOGIN_SCHEMA: "true"}, cookies: fullCookies(), responseEntries: [["Content-Length", String(MAX_BODY + 1)]]});
    assert.equal(await capture(f), undefined); noBody(f);
    assert.equal(f.calls.helper, 1, "已知登录独占入口仍先处理实际响应头");
    assert.equal(row(f, "schema").schema.format, "TOO_LARGE"); safeRecord(f);
});

test("256KiB正文边界可读，未知长度超限读后只分类并仍返回全部原字节", async () => {
    for (const size of [MAX_BODY, MAX_BODY + 1]) {
        const raw = new Uint8Array(size).fill(32);
        const f = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}, raw});
        assertBytes(await capture(f), raw); assert.equal(f.calls.responseBody, 1);
        assert.equal(row(f, "schema").schema.format, size === MAX_BODY ? "EMPTY" : "TOO_LARGE");
        safeRecord(f);
    }
    assert.equal(response.cwResponseSchema(new Uint8Array(MAX_BODY + 1)).format, "TOO_LARGE");
});

test("ArrayBuffer view保留byteOffset/byteLength，不把周围字节也返回", async () => {
    const raw = bytes("{}"), backing = new Uint8Array([255, ...raw, 254]);
    const f = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}, raw});
    f.ctx.response.arrayBuffer = async () => {f.calls.responseBody++; return new DataView(backing.buffer, 1, raw.length);};
    assertBytes(await capture(f), raw); assert.equal(row(f, "schema").schema.format, "JSON");
});

test("成功读body后clock抛错/倒退/非法值仍透传原字节，不回写伪时序结构", async () => {
    for (const next of [new Error(PRIVATE), NOW - 1, NaN, Infinity, 8640000000000001]) {
        const f = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}});
        let calls = 0;
        const clock = () => {if (++calls === 1) return NOW; if (next instanceof Error) throw next; return next;};
        assertBytes(await capture(f, clock), f.originalBytes);
        assert.equal(metadata(f).rows.length, 1); assert.equal(row(f, "schema"), undefined);
        safeRecord(f);
    }
});

test("首次clock无效或抛错时不读取任何正文或写入取证", async () => {
    for (const first of [0, -1, NaN, Infinity, 8640000000000001, new Error(PRIVATE)]) {
        const f = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}, cookies: fullCookies()});
        assert.equal(await capture(f, () => {if (first instanceof Error) throw first; return first;}), undefined);
        noBody(f); assert.equal(f.calls.helper + f.calls.storageWrite + f.calls.storageRead, 0);
    }
});

test("正文等待期间mode/schema或request归属变化不回写结构，但必须返回已读字节", async () => {
    for (const change of [f => {f.ctx.env.CONNECTION_MODE = "off";}, f => {f.ctx.env.CW_LOGIN_SCHEMA = "false";},
        f => {f.ctx.request = {...f.ctx.request};}, f => {f.ctx.response = {...f.ctx.response};}]) {
        const f = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}});
        f.ctx.response.arrayBuffer = async () => {f.calls.responseBody++; change(f); return f.originalBytes.slice().buffer;};
        assertBytes(await response.captureCainiaoResponse(f.ctx, f.clock), f.originalBytes);
        assert.equal(metadata(f).rows.length, 1); assert.equal(row(f, "schema"), undefined);
    }
});

test("存储读取/写入异常不丢原字节，固定日志不泄露异常值", async () => {
    for (const fail of ["getJSON", "setJSON"]) {
        const f = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}});
        f.ctx.storage[fail] = () => {throw new Error(PRIVATE);};
        assertBytes(await capture(f), f.originalBytes);
        assert(f.log().length >= 1); assert(!f.log().join(" ").includes(PRIVATE));
    }
});

test("规范化写后回读不因schema/header字段键序误报，真实静默丢写仍报未确认", async () => {
    const valid = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}, cookies: fullCookies(), body: {data: {userId: UID}}});
    assertBytes(await capture(valid), valid.originalBytes); assert.equal(valid.log().length, 0);
    assert.equal(metadata(valid).rows.length, 2);
    const lost = fixture(); lost.ctx.storage.setJSON = () => {};
    await capture(lost); assert.equal(lost.log().length, 1); assert.equal(metadata(lost), undefined);
});

test("元数据按host/channel/apiKind/mode聚合，未知API和完整URL永不保存", async () => {
    const f = fixture({api: "mtop.synthetic." + PRIVATE});
    await capture(f); assert.equal(row(f).apiKind, "other");
    f.ctx.request.url = routeURL({api: "mtop.different." + PRIVATE}); f.setNow(NOW + 1);
    await capture(f); assert.equal(metadata(f).rows.length, 1); assert.equal(row(f).count, 2);
    f.ctx.request.url = routeURL({host: "h5api.m.taobao.com", channel: "h5", api: "mtop.unknown"}); f.setNow(NOW + 2);
    await capture(f); assert.equal(metadata(f).rows.length, 2); safeRecord(f);
});

test("固定七天窗口不因匿名响应续期，过期后count=1且不继承旧字段", async () => {
    const f = fixture({cookies: fullCookies()}); await capture(f);
    const startedAt = metadata(f).startedAt;
    f.ctx.response.headers = headers();
    for (let day = 1; day < 7; day++) {
        f.setNow(NOW + day * DAY); await capture(f);
        assert.equal(metadata(f).startedAt, startedAt); assert.equal(row(f).count, day + 1); assert.deepEqual(row(f).cookies, []);
    }
    f.setNow(NOW + WINDOW); await capture(f);
    assert.equal(metadata(f).startedAt, NOW + WINDOW); assert.equal(row(f).count, 1); assert.deepEqual(row(f).cookies, []);
    assert.equal(row(f).usable, 0); assert.equal(row(f).result, "none"); safeRecord(f);
});

test("七天前1ms可读，整七天已过期；generic只读不删或续期旧窗口", async () => {
    const f = fixture({cookies: fullCookies()}); await capture(f);
    const initial = structuredClone(metadata(f)), writes = f.calls.storageWrite;
    f.setNow(NOW + WINDOW - 1); assert(summary(f).some(line => line.includes("acs.m.taobao.com")));
    f.setNow(NOW + WINDOW); const expired = summary(f);
    assert(!expired.some(line => line.includes("acs.m.taobao.com")));
    assert.equal(f.calls.storageWrite, writes); assert.deepEqual(metadata(f), initial);
    f.setNow(NOW + WINDOW + DAY); assert.deepEqual(summary(f), expired); assert.equal(f.calls.storageWrite, writes);
});

test("startedAt损坏/未来/版本未知与未来row.at均不制造已观察证据", () => {
    for (const startedAt of [0, -1, NOW + 1, NaN, Infinity, "synthetic-time"]) {
        const f = fixture(); seed(f, [seedRow()], startedAt);
        const before = f.calls.storageWrite; assert(!summary(f).some(line => line.includes("acs.m.taobao.com")));
        assert.equal(f.calls.storageWrite, before);
    }
    for (const overrides of [{version: "unknown-version"}, {rows: [seedRow({at: NOW + 1})]}, {rows: [seedRow({at: NOW - 1})]}]) {
        const f = fixture(); seed(f, [seedRow()]); Object.assign(metadata(f), overrides);
        assert(!summary(f).some(line => line.includes("acs.m.taobao.com"))); assert.equal(f.calls.storageWrite, 0);
    }
});

test("schema未来记录跨七天界或超时钟有效范围不能借容差变成当前证据", () => {
    const f = fixture();
    seed(f, [seedRow({at: NOW + WINDOW + 1000})]);
    f.setNow(NOW + WINDOW - 1);
    assert(!summary(f).some(line => line.includes("acs.m.taobao.com"))); assert.equal(f.calls.storageWrite, 0);
    f.setNow(8640000000000001);
    assert.doesNotThrow(() => summary(f)); assert.equal(f.calls.storageWrite, 0);
});

test("计数封顶且重复聚合键去重，32行封顶时只替换最旧行", async () => {
    const f = fixture(); seed(f, [seedRow({count: 999999}), seedRow({count: 7})]);
    await capture(f); assert.equal(row(f).count, 999999); assert.equal(metadata(f).rows.length, 1);
    const kinds = ["other", "personal_list", "personal_count", "public_time"];
    const rows = HOSTS.flatMap(host => ["h5", "gw"].flatMap(channel => kinds.map(apiKind => seedRow({host, channel, apiKind,
        at: NOW - 1000, result: apiKind === "public_time" ? "public_time" : "none"}))));
    rows[0].at = NOW - 2000;
    const many = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}}); seed(many, rows, NOW - 3000);
    await capture(many); assert.equal(metadata(many).rows.length, 32);
    assert(!metadata(many).rows.some(item => item.host === rows[0].host && item.channel === rows[0].channel && item.apiKind === rows[0].apiKind));
    assert.equal(metadata(many).startedAt, NOW - 3000);
    assert.equal(metadata(many).rows.filter(item => item.apiKind === "login").length, 2);
});

test("超过32行根状态fail closed，坏计数/字段/计数不一致逐行忽略且读零写入", () => {
    const over = fixture(); seed(over, Array(33).fill(seedRow()));
    assert(!summary(over).some(line => line.includes("acs.m.taobao.com")));
    for (const overrides of [{count: 0}, {count: NaN}, {at: Infinity}, {host: "evil.invalid"}, {channel: "other"},
        {apiKind: PRIVATE}, {result: PRIVATE}, {cookies: ["cookie2", "cookie2"], usable: 2, headerCount: 2},
        {cookies: ["unknown"], usable: 1, headerCount: 1}, {cookies: ["cookie2"], usable: 0, headerCount: 1},
        {headerCount: 65}, {usable: 64}, {schema: {format: "JSON"}}, {result: "saved"}]) {
        const f = fixture(); seed(f, [seedRow(overrides)]);
        assert(!summary(f).some(line => line.includes("acs.m.taobao.com")));
        assert.equal(f.calls.storageWrite, 0); assert(!JSON.stringify(summary(f)).includes(PRIVATE));
    }
    assert.equal(over.calls.storageWrite, 0);
});

test("污染schema不能伪装header保存、凭据组合或非登录接口结构，输出固定字段", () => {
    const schema = plain(response.cwResponseSchema(bytes({data: {returnValue: {data: {userId: UID}}}})));
    const valid = seedRow({mode: "schema", apiKind: "login", result: "schema", schema});
    for (const overrides of [{result: "saved"}, {apiKind: "personal_list"}, {cookies: ["cookie2"], usable: 1, headerCount: 1},
        {schema: {...schema, format: "GZIP"}}, {schema: {...schema, paths: schema.paths.slice(0, 2)}},
        {schema: {...schema, ret: PRIVATE}}]) {
        const f = fixture(); seed(f, [{...valid, ...overrides}]);
        assert(!summary(f).some(line => line.includes("acs.m.taobao.com"))); assert.equal(f.calls.storageWrite, 0);
    }
    const clean = fixture(); seed(clean, [{...valid, raw: PRIVATE, uid: UID, hash: PRIVATE}], NOW - 1);
    assert(summary(clean).some(line => line.includes("$.data")));
    assert(!summary(clean).join(" ").includes(PRIVATE));
});

test("schema路径/type/decodedType/fields要自洽，坏父子链和重复字段不成为证据", () => {
    const original = plain(response.cwResponseSchema(bytes({data: {returnValue: {data: {cookies: [PRIVATE]}}}})));
    const mutations = [schema => {schema.paths[0].path = PRIVATE;}, schema => {schema.paths[0].type = "missing";},
        schema => {schema.paths[0].decodedType = "array";}, schema => {schema.paths[1].fields = [];},
        schema => {schema.paths[2].fields[0].count = -1;}, schema => {schema.paths[2].fields[0].count = null;},
        schema => {schema.paths[2].fields.push({...schema.paths[2].fields[0]});},
        schema => {schema.paths[2].fields[0].name = PRIVATE;}];
    for (const mutate of mutations) {
        const schema = structuredClone(original); mutate(schema);
        const f = fixture(); seed(f, [seedRow({mode: "schema", apiKind: "login", result: "schema", schema})]);
        assert(!summary(f).some(line => line.includes("acs.m.taobao.com"))); assert.equal(f.calls.storageWrite, 0);
    }
});

test("生产parser输出的所有合法有限schema都能规范化读回而不触发假存储失败", async () => {
    const bodies = [null, [], "not-object", {}, {data: null}, {data: []}, {data: {userId: UID}},
        {data: {returnValue: {data: {cookies: [PRIVATE], sid: null}}}}, {data: JSON.stringify({returnValue: {data: {autoLoginToken: PRIVATE}}})},
        JSON.stringify(JSON.stringify({data: {success: true}}))];
    for (const body of bodies) {
        const f = fixture({api: LOGIN_API, env: {CW_LOGIN_SCHEMA: "true"}, raw: bytes(JSON.stringify(body))});
        assertBytes(await capture(f), f.originalBytes);
        assert.equal(metadata(f).rows.length, 2); assert.equal(row(f, "schema").schema.format, "JSON");
        assert.equal(f.log().length, 0); safeRecord(f);
    }
});

test("只读摘要存储异常与污染字段不泄露异常/未知值，也不修改现有状态", () => {
    const f = fixture(); f.ctx.storage.getJSON = () => {throw new Error(PRIVATE);};
    const lines = summary(f); assert(lines.length > 0); assert(!lines.join(" ").includes(PRIVATE));
    assert.equal(f.calls.storageWrite, 0);
    const poisoned = fixture(); seed(poisoned, [{...seedRow(), extra: PRIVATE}], NOW - 1);
    const before = structuredClone(metadata(poisoned));
    assert(summary(poisoned).some(line => line.includes("acs.m.taobao.com")));
    assert(!summary(poisoned).join(" ").includes(PRIVATE));
    assert.deepEqual(metadata(poisoned), before); assert.equal(poisoned.calls.storageWrite, 0);
});
