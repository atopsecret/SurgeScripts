// Engine | Node.js 20+ | JavaScript
// Build: 无需构建
// Run: node --experimental-vm-modules --test jyjt/tests/egern.test.cjs
// Deps: Node.js 内置模块；Python 3 + PyYAML（只解析公开 YAML）；无网络
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'jyjt-member.egern.js'), 'utf8');
const config = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))',
    path.join(root, 'jyjt-member.egern.yaml')], { encoding: 'utf8', timeout: 5000 }));
const URL = 'http://smoke.nxnresearch.com/webservice510.asmx';
const SOAP = '<?xml version="1.0" encoding="utf-8"?><soap:Envelope><soap:Body><string>{ "member_flg" : 0 , "user_type":0,"member_end_date":null,"name":"测试😀" }</string></soap:Body></soap:Envelope>';
const plain = value => JSON.parse(JSON.stringify(value));
class Headers {
    constructor(values = {}) { Object.assign(this, values); }
    get(name) { const all = this.getAll(name); return all.length ? all.join(', ') : null; }
    getAll(name) { const key = Object.keys(this).find(key => key.toLowerCase() === name.toLowerCase()); return !key ? [] : Array.isArray(this[key]) ? [...this[key]] : [this[key]]; }
    delete(name) { for (const key of Object.keys(this)) if (key.toLowerCase() === name.toLowerCase()) delete this[key]; }
    set(name, value) { this.delete(name); this[name] = value; }
    append(name, value) { const old = this.getAll(name); this.set(name, [...old, value]); }
}
async function harness(options = {}) {
    const context = vm.createContext({ console: { log: () => { throw Error('不应输出账号响应'); } } });
    const module = new vm.SourceTextModule(source, { context });
    await module.link(() => { throw Error('禁止外部 import'); });
    await module.evaluate({ timeout: 1000 });
    let reads = 0;
    const bytes = Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body === undefined ? SOAP : options.body);
    const headers = options.headers && typeof options.headers.get === 'function' ? options.headers :
        new Headers(options.headers || { 'Content-Type': 'text/xml; charset=utf-8' });
    const ctx = {
        request: { url: options.url || URL },
        response: { status: options.status === undefined ? 200 : options.status, headers,
            arrayBuffer: async () => {
                reads++; assert.equal(reads, 1);
                if (options.bodyThrows) throw Error('SECRET_BODY_FAILURE');
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            },
            text: async () => { throw Error('不能在 arrayBuffer 后再读 text'); },
            json: async () => { throw Error('不能将 SOAP 整体 json()'); },
        },
        http: new Proxy({}, { get: () => { throw Error('禁止业务请求'); } }),
        storage: new Proxy({}, { get: () => { throw Error('本模块不应读写存储'); } }),
        notify: () => { throw Error('本模块无通知'); },
    };
    if (options.generic) { delete ctx.request; delete ctx.response; }
    if (options.requestOnly) delete ctx.response;
    const output = await module.namespace.default(ctx);
    return { output, bytes, headers, namespace: module.namespace, get reads() { return reads; } };
}
test('原生 SOAP 改三个原有值，保留 XML、空白、未知字段与 Unicode', async () => {
    const h = await harness();
    assert.equal(h.reads, 1);
    assert.equal(h.output.body, SOAP.replace('"member_flg" : 0', '"member_flg" : 1').replace('"user_type":0', '"user_type":1')
        .replace('"member_end_date":null', '"member_end_date":"2099-12-31"'));
    assert.match(h.output.body, /测试😀/);
    assert.equal(h.output.headers['Content-Type'], 'text/xml; charset=utf-8');
});
test('数字完整值匹配，不把小数、指数、负零、字符串或真假值当零', async () => {
    const h = await harness({ generic: true });
    for (const value of ['0.5', '0e0', '0E+0', '-0', '00', '"0"', 'false', 'true', 'null']) {
        const body = '<string>{"member_flg":' + value + ',"user_type":' + value + '}</string>';
        assert.equal(h.namespace.transform(body), body, value);
    }
});
test('日期只改完整 null，不误改已存在日期、nullish 或字符串', async () => {
    const h = await harness({ generic: true });
    for (const date of ['"2027-01-01"', '"null"', 'nullish', 'false', '0']) {
        const body = '<string>{"member_flg":1,"member_end_date":' + date + '}</string>';
        assert.equal(h.namespace.transform(body), body);
    }
});
test('没有 member_flg 的响应不顺手修改其他字段', async () => {
    const body = '<string>{"user_type":0,"member_end_date":null}</string>';
    const h = await harness({ body });
    assert.deepEqual(Buffer.from(h.output.body), Buffer.from(body));
});
test('已有会员状态及无变化响应按原字节放行，不重建 XML', async () => {
    const body = '<string> { "member_flg" : 1, "user_type" : 2, "member_end_date" : "2099-12-31" } </string>';
    const h = await harness({ body });
    assert.deepEqual(Buffer.from(h.output.body), Buffer.from(body)); assert.equal(h.output.headers, undefined);
});
test('HTTP 错误和重定向不读正文、不掩盖服务端失败', async () => {
    for (const status of [204, 301, 400, 401, 403, 500]) {
        const h = await harness({ status });
        assert.equal(h.output, undefined); assert.equal(h.reads, 0);
    }
});
test('SOAP Fault 无论前缀和大小写，都不改夹带的会员字段', async () => {
    for (const tag of ['Fault', 'soap:Fault', 's:Fault', 'soap:FAULT']) {
        const body = '<Envelope><' + tag + '><detail>{"member_flg":0,"user_type":0}</detail></' + tag + '></Envelope>';
        const h = await harness({ body });
        assert.deepEqual(Buffer.from(h.output.body), Buffer.from(body));
    }
});
test('路径边界、主机及协议严格：未知同前缀、伪造主机与未解密 HTTPS 不处理', async () => {
    for (const url of [URL + 'x', URL + '_extra', URL.replace('smoke.nxnresearch.com', 'smoke.nxnresearch.com.evil.test'),
        URL.replace('http:', 'https:'), 'http://evil.test/webservice510.asmx', 'http://smoke.nxnresearch.com@evil.test/webservice510.asmx']) {
        const h = await harness({ url }); assert.equal(h.output, undefined); assert.equal(h.reads, 0);
    }
    for (const ending of ['', '?op=get_user_info', '/version']) {
        const h = await harness({ url: URL + ending }); assert.equal(h.reads, 1); assert.equal(typeof h.output.body, 'string');
    }
});
test('非 UTF-8、畸形 UTF-8、空体与非目标正文按原字节返回', async () => {
    for (const body of [Buffer.from([0xff, 0xfe, 0x3c, 0]), Buffer.from([0xc0, 0x80]), Buffer.from([0xf0, 0x9f]), '', '<html>未知响应</html>']) {
        const h = await harness({ body }); assert.deepEqual(Buffer.from(h.output.body), h.bytes);
        assert.equal(h.output.headers, undefined);
    }
});
test('改写清除过时长度、编码与校验头，保留原 XML 类型和多值头', async () => {
    const headers = { 'Content-Type': 'application/soap+xml; charset=utf-8', 'content-length': '999',
        ETag: 'old', 'Content-Encoding': 'gzip', 'Transfer-Encoding': 'chunked', 'Content-MD5': 'old',
        'Content-Digest': 'old', 'Cache-Control': 'public', 'Set-Cookie': ['fixture-a=1', 'fixture-b=2'], 'X-Other': 'yes' };
    const h = await harness({ headers });
    assert.deepEqual(plain(h.output.headers), { 'Content-Type': 'application/soap+xml; charset=utf-8',
        'Set-Cookie': ['fixture-a=1', 'fixture-b=2'], 'X-Other': 'yes', 'Cache-Control': 'no-store' });
    assert.equal(headers['content-length'], '999');
    assert.equal(h.output.headers, h.headers);
});
test('真实不可枚举 Response Headers 保留 XML 类型、Cookie 与未知业务头', async () => {
    const headers = new Response('', { headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': '999', 'X-Business': 'yes' } }).headers;
    headers.append('Set-Cookie', 'fixture-a=1'); headers.append('Set-Cookie', 'fixture-b=2');
    assert.equal(Object.keys(headers).length, 0);
    const h = await harness({ headers });
    assert.equal(h.output.headers, headers); assert.equal(headers.get('Content-Type'), 'text/xml; charset=utf-8');
    assert.equal(headers.get('X-Business'), 'yes'); assert.deepEqual(headers.getSetCookie(), ['fixture-a=1', 'fixture-b=2']);
    assert.equal(headers.get('Content-Length'), null);
});
test('Headers 修改后抛错回传原正文，并恢复长度、缓存头', async () => {
    const headers = new Response('', { headers: { 'Content-Type': 'text/xml', 'Content-Length': '999', 'Cache-Control': 'public' } }).headers;
    const set = headers.set.bind(headers); let failed = false;
    headers.set = (name, value) => { set(name, value); if (!failed) { failed = true; throw Error('SECRET_HEADERS_FAILURE'); } };
    const h = await harness({ headers });
    assert.deepEqual(Buffer.from(h.output.body), Buffer.from(SOAP)); assert.equal(h.output.headers, undefined);
    assert.equal(headers.get('Content-Length'), '999'); assert.equal(headers.get('Cache-Control'), 'public');
});
test('声明非 UTF-8 charset/XML encoding 不转换为假 UTF-8', async () => {
    const header = await harness({ headers: { 'Content-Type': 'text/xml; charset=gbk' } });
    assert.equal(header.output, undefined); assert.equal(header.reads, 0);
    const xml = SOAP.replace('encoding="utf-8"', 'encoding="utf-16"');
    const body = await harness({ body: xml }); assert.deepEqual(Buffer.from(body.output.body), Buffer.from(xml));
});
test('相同响应重复执行幂等；不产生通知、存储或业务请求', async () => {
    const first = await harness(); const second = await harness({ body: first.output.body });
    assert.deepEqual(Buffer.from(second.output.body), Buffer.from(first.output.body));
});
test('流读取本身失败不二次消费或造空正文；无响应/非 HTTP 上下文不处理', async () => {
    const h = await harness({ bodyThrows: true }); assert.equal(h.output, undefined); assert.equal(h.reads, 1);
    for (const options of [{ generic: true }, { requestOnly: true }]) {
        const run = await harness(options); assert.equal(run.output, undefined); assert.equal(run.reads, 0);
    }
});
test('原生 YAML/API 正确且不含 Surge 全局、无 HTTPS/MITM 假兼容', () => {
    const response = config.scriptings[0].http_response;
    assert.equal(config.scriptings.length, 1); assert.equal(response.body_required, true);
    assert.equal(response.binary_body, true); assert.equal(response.max_size, 1048576);
    assert.equal(config.mitm, undefined);
    const pattern = new RegExp(response.match);
    assert.equal(pattern.test(URL), true); assert.equal(pattern.test(URL + 'x'), false);
    assert.equal(pattern.test(URL.replace('http:', 'https:')), false);
    const url = new globalThis.URL(response.script_url);
    assert.equal(url.pathname, '/atopsecret/SurgeScripts/main/jyjt/jyjt-member.egern.js');
    assert.equal(url.searchParams.get('v'), '1.0.0'); assert.ok(fs.existsSync(path.join(root, path.basename(url.pathname))));
    assert.doesNotMatch(source, /\$(?:done|request|response|persistentStore|httpClient|notification)\b|\bimport\s/);
});
