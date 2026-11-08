// Engine | Node.js 20+ | JavaScript
// Build: 无需构建
// Run: 由 rules.test.cjs 或离线 HAR 核对脚本调用
// Deps: Node.js 内置模块；读取 YAML 需要 Python 3 与 PyYAML
// 仅模拟本模块使用的原生条件，不能代替 Egern 客户端验收。
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function readModule(filename = path.join(__dirname, '..', 'cainiao-adblock.egern.yaml')) {
    return JSON.parse(execFileSync('python3', ['-c', 'import json,yaml,sys; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))', filename], { encoding: 'utf8' }));
}

function wildcard(pattern, text) {
    const escaped = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp('^' + escaped + '$').test(text);
}

function matches(item, request) {
    const [[kind, body]] = Object.entries(item);
    switch (kind) {
        case 'and': return body.match.every(child => matches(child, request));
        case 'or': return body.match.some(child => matches(child, request));
        case 'domain': return request.hostname === body.match;
        case 'domain_suffix': return request.hostname === body.match || request.hostname.endsWith('.' + body.match);
        case 'url_regex': return new RegExp(body.match).test(request.url);
        case 'user_agent': return wildcard(body.match, request.userAgent);
        case 'protocol': return body.match === request.protocol;
        default: throw Error('离线匹配器未支持条件：' + kind);
    }
}

function rejects(module, url, userAgent = '', protocol = new URL(url).protocol.slice(0, -1)) {
    const request = { url, hostname: new URL(url).hostname, userAgent, protocol };
    return (module.rules || []).some(item => {
        const body = item[Object.keys(item)[0]];
        return body.policy === 'REJECT' && !body.disabled && matches(item, request);
    });
}

module.exports = { readModule, rejects };
