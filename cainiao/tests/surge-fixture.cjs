// Engine | Node.js 20+ | JavaScript
// Build: node cainiao/build.mjs
// Run: 由 Surge 和双端一致性测试调用
// Deps: Node.js 内置模块；不联网
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'cainiao-adblock.js'), 'utf8');
const moduleText = fs.readFileSync(path.join(root, 'cainiao-adblock.sgmodule'), 'utf8');

function section(name, text = moduleText) {
    const lines = text.split('[' + name + ']')[1]?.split(/\n\[/)[0] || '';
    return lines.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
}

// 按 Surge 规则的引号与括号边界拆字段，保留正则中的反斜杠。
function fields(text) {
    const result = [];
    let start = 0, depth = 0, quoted = false;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '"') quoted = !quoted;
        if (quoted) continue;
        if (text[i] === '(') depth++;
        if (text[i] === ')') depth--;
        if (depth < 0) throw Error('Surge 逻辑规则括号不配对');
        if (text[i] === ',' && depth === 0) { result.push(text.slice(start, i)); start = i + 1; }
    }
    if (quoted || depth !== 0) throw Error('Surge 规则引号或括号不配对');
    result.push(text.slice(start));
    return result;
}

function parseCondition(text) {
    const [type, value, policy, ...extra] = fields(text);
    assert.equal(extra.length, 0);
    const types = { DOMAIN: 'domain', 'DOMAIN-SUFFIX': 'domain_suffix', 'URL-REGEX': 'url_regex', 'USER-AGENT': 'user_agent', AND: 'and', OR: 'or' };
    const kind = types[type];
    assert.ok(kind, type);
    const body = {};
    if (kind === 'and' || kind === 'or') {
        assert.ok(value.startsWith('(') && value.endsWith(')'));
        body.match = fields(value.slice(1, -1)).map(child => {
            assert.ok(child.startsWith('(') && child.endsWith(')'));
            return parseCondition(child.slice(1, -1));
        });
    } else body.match = value.startsWith('"') ? value.slice(1, -1) : value;
    if (policy !== undefined) body.policy = policy;
    return { [kind]: body };
}

function readSurgeModule(text = moduleText) {
    return { rules: section('Rule', text).map(parseCondition) };
}

function runSurge(options = {}) {
    const body = Object.prototype.hasOwnProperty.call(options, 'body') ? options.body : '{}';
    const request = { url: options.url || 'https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn/1.0/', method: 'GET' };
    const response = {
        status: options.status === undefined ? 200 : options.status,
        body,
        headers: options.headers || [{ field: 'Content-Type', value: 'application/json; charset=utf-8' }],
    };
    if (options.bodyGetter) Object.defineProperty(response, 'body', { get: options.bodyGetter });
    const done = [];
    const forbidden = () => { throw Error('测试禁止网络、通知或存储'); };
    vm.runInNewContext(source, {
        URL, Uint8Array, ArrayBuffer, TextEncoder,
        $request: options.noRequest ? undefined : request,
        $response: options.noResponse ? undefined : response,
        $done: value => done.push(value),
        $httpClient: { get: forbidden, post: forbidden },
        $notification: { post: forbidden },
        $persistentStore: { read: forbidden, write: forbidden },
        console: { log() {} },
    }, { timeout: 1000 });
    assert.equal(done.length, 1, 'Surge 必须恰好调用一次 $done');
    return done[0];
}

async function loadNative() {
    const module = new vm.SourceTextModule(fs.readFileSync(path.join(root, 'cainiao-adblock.egern.js'), 'utf8'), { context: vm.createContext({ URL, console: { log() {} } }) });
    await module.link(() => { throw Error('测试禁止远程模块'); });
    await module.evaluate({ timeout: 1000 });
    return module.namespace.default;
}

async function runNative(script, { url, body, status = 200 }) {
    let reads = 0;
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const output = await script({
        request: { url, method: 'GET' },
        response: {
            status,
            headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8' }),
            arrayBuffer: async () => {
                assert.equal(++reads, 1);
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            },
        },
        storage: { getJSON() { return null; }, setJSON() {} },
    });
    return { output, body: output && Object.prototype.hasOwnProperty.call(output, 'body') ? Buffer.from(output.body) : bytes, reads };
}

module.exports = { root, source, moduleText, section, readSurgeModule, runSurge, loadNative, runNative };
