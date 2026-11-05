// Engine | Node.js 20+ | JavaScript
// Build: 无需构建
// Run: node --test tests/link-validation.test.cjs
// Deps: Node.js 内置模块；只读本地文件，不下载脚本、不发网络请求
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = fs.realpathSync(path.resolve(__dirname, '..'));
const OWNER = 'atopsecret';
const REPOSITORY = 'SurgeScripts';
const BRANCH = 'main';
const TEXT_SUFFIXES = new Set(['.md', '.sgmodule', '.conf', '.yaml', '.yml', '.js', '.list']);

function publicFiles(directory) {
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        // 测试样例可以包含故意无效的链接，不把它们当作实际安装入口。
        if (entry.name === '.git' || entry.name === 'tests') continue;
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...publicFiles(filename));
        else if (entry.isFile() && TEXT_SUFFIXES.has(path.extname(entry.name))) result.push(filename);
    }
    return result.sort();
}

function checkedReference(url, branch, segments, kind) {
    assert.equal(url.protocol, 'https:', `本仓库链接必须使用 HTTPS：${url.href}`);
    assert.equal(url.username + url.password, '', '公开链接不能包含凭据');
    assert.equal(branch, BRANCH, `本仓库文件必须使用 ${BRANCH} 分支：${url.href}`);
    assert.ok(segments.length, `文件链接缺少路径：${url.href}`);
    for (const segment of segments) {
        assert.ok(segment && segment !== '.' && segment !== '..' && !/[\\/\0]/.test(segment),
            `文件链接含无效路径：${url.href}`);
    }
    return { url: url.href, kind, relative: segments.join('/') };
}

function repositoryReference(input) {
    // 生产匹配正则也可能含有 https:// 字样，不把它们误当文件链接。
    if (!URL.canParse(input)) {
        assert.ok(!input.includes(`${OWNER}/${REPOSITORY}`), `本仓库链接不是有效 URL：${input}`);
        return null;
    }
    const url = new URL(input);
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (url.hostname === 'raw.githubusercontent.com') {
        if (segments[0] !== OWNER || segments[1] !== REPOSITORY) return null;
        return checkedReference(url, segments[2], segments.slice(3), 'file');
    }
    if (url.hostname === 'github.com') {
        if (segments[0] !== OWNER || segments[1] !== REPOSITORY) return null;
        if (segments[2] === 'blob' || segments[2] === 'tree') {
            return checkedReference(url, segments[3], segments.slice(4),
                segments[2] === 'tree' ? 'directory' : 'file');
        }
        // 仓库首页、Issues 等是 GitHub 页面，不对应源码中的普通文件。
        assert.equal(url.protocol, 'https:');
        assert.equal(url.username + url.password, '');
        return { url: url.href, kind: 'page' };
    }
    if (url.hostname.endsWith('.jsdelivr.net') && segments[0] === 'gh') {
        const [repository, branch] = (segments[2] || '').split('@');
        if (segments[1] !== OWNER || repository !== REPOSITORY) return null;
        return checkedReference(url, branch, segments.slice(3), 'file');
    }
    return null;
}

function existingTarget(reference) {
    const target = path.resolve(ROOT, reference.relative);
    assert.ok(target.startsWith(ROOT + path.sep), `路径离开仓库：${reference.relative}`);
    assert.ok(fs.existsSync(target), `链接目标不存在：${reference.relative}`);
    const real = fs.realpathSync(target);
    assert.ok(real.startsWith(ROOT + path.sep), `链接目标指向仓库外：${reference.relative}`);
    const status = fs.statSync(real);
    assert.ok(reference.kind === 'directory' ? status.isDirectory() : status.isFile(),
        `链接目标类型不正确：${reference.relative}`);
    return real;
}

function urls(text) {
    return [...text.matchAll(/\bhttps?:\/\/[^\s<>"'`)\]},]+/g)]
        .map(match => match[0].replace(/[,.;]+$/, ''));
}

const files = publicFiles(ROOT);
const texts = new Map(files.map(filename => [filename, fs.readFileSync(filename, 'utf8')]));

test('raw 链接查询参数、片段和 URL 编码不改变本地目标', () => {
    const ref = repositoryReference('https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/%61map/amap-cleaner.js?v=2.0.0#source');
    assert.equal(ref.relative, 'amap/amap-cleaner.js');
    assert.equal(existingTarget(ref), path.join(ROOT, 'amap/amap-cleaner.js'));
    assert.deepEqual(urls('RULE-SET,https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/AI.list,AI'),
        ['https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/AI.list']);
});

test('jsDelivr 固定 main 分支的链接能够解析到同一脚本', () => {
    const ref = repositoryReference('https://cdn.jsdelivr.net/gh/atopsecret/SurgeScripts@main/amap/amap-cleaner.js?v=2.0.0');
    assert.equal(ref.relative, 'amap/amap-cleaner.js');
    existingTarget(ref);
});

test('GitHub blob 和 tree 分别检查文件及目录', () => {
    const file = repositoryReference('https://github.com/atopsecret/SurgeScripts/blob/main/README.md');
    const folder = repositoryReference('https://github.com/atopsecret/SurgeScripts/tree/main/amap');
    assert.equal(file.kind, 'file');
    assert.equal(folder.kind, 'directory');
    existingTarget(file);
    existingTarget(folder);
});

test('本仓库链接拒绝旧分支、缺少路径、编码分隔符和明文 HTTP', () => {
    for (const url of [
        'https://raw.githubusercontent.com/atopsecret/SurgeScripts/master/README.md',
        'https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/',
        'https://cdn.jsdelivr.net/gh/atopsecret/SurgeScripts@master/README.md',
        'https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/amap%2Famap-cleaner.js',
        'http://raw.githubusercontent.com/atopsecret/SurgeScripts/main/README.md',
    ]) assert.throws(() => repositoryReference(url));
});

test('第三方上游链接不被当成本仓库文件，也不访问网络', () => {
    for (const url of [
        'https://github.com/Thelongdarkorg/loon-plugins',
        'https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Heart.png',
        'https://cdn.jsdelivr.net/gh/ddgksf2013/Scripts@master/amap.js',
        'https://[^/',
    ]) assert.equal(repositoryReference(url), null);
});

test('公开安装说明和生产配置不残留旧账号的仓库链接', () => {
    const oldAccount = /https?:\/\/(?:github\.com|raw\.githubusercontent\.com)\/skernelx\/SurgeScripts(?:[/?#]|$)|https?:\/\/[^/\s]+\.jsdelivr\.net\/gh\/skernelx\/SurgeScripts(?:[@/]|$)/;
    for (const [filename, text] of texts) {
        assert.doesNotMatch(text, oldAccount, path.relative(ROOT, filename));
    }
});

test('所有新账号 raw、GitHub 文件和 CDN 链接都有真实本地目标', t => {
    let count = 0;
    const targets = new Set();
    for (const [filename, text] of texts) {
        for (const url of urls(text)) {
            const reference = repositoryReference(url);
            if (!reference || reference.kind === 'page') continue;
            assert.doesNotThrow(() => existingTarget(reference), `${path.relative(ROOT, filename)}：${url}`);
            count++;
            targets.add(reference.relative);
        }
    }
    assert.ok(count, '未发现任何新账号文件链接，拒绝空检查');
    t.diagnostic(`检查 ${files.length} 个公开文本文件、${count} 处文件链接、${targets.size} 个不同目标；未发网络请求。`);
});

test('Surge 与 Egern 实际脚本入口对应存在的本地文件', t => {
    let count = 0;
    for (const [filename, text] of texts) {
        if (!/\.(?:sgmodule|conf|ya?ml)$/.test(filename)) continue;
        for (const line of text.split(/\r?\n/)) {
            if (line.trimStart().startsWith('#')) continue;
            const match = line.match(/(?:script-path=|script_url:\s*)([^\s,]+)/);
            if (!match) continue;
            const value = match[1];
            if (/^https?:\/\//.test(value)) {
                const reference = repositoryReference(value);
                assert.ok(reference && reference.kind === 'file', `运行脚本不属于本仓库：${filename}`);
                existingTarget(reference);
            } else {
                const target = path.resolve(path.dirname(filename), value);
                assert.ok(target.startsWith(ROOT + path.sep) && fs.existsSync(target) && fs.statSync(target).isFile(),
                    `本地脚本不存在：${path.relative(ROOT, filename)} → ${value}`);
            }
            count++;
        }
    }
    assert.ok(count, '未发现实际脚本入口，拒绝空检查');
    t.diagnostic(`检查 ${count} 个运行脚本入口；只验证路径，不执行脚本。`);
});

test('根模块索引覆盖全部 Surge 模块和 Egern 原生 YAML', t => {
    const readmeTargets = new Set(urls(texts.get(path.join(ROOT, 'README.md')))
        .map(repositoryReference).filter(ref => ref && ref.kind === 'file').map(ref => ref.relative));
    const modules = files.filter(filename => filename.endsWith('.sgmodule'));
    const native = files.filter(filename => filename.endsWith('.egern.yaml'));
    assert.ok(modules.length, '模块库为空');
    for (const filename of [...modules, ...native]) {
        const relative = path.relative(ROOT, filename).split(path.sep).join('/');
        assert.ok(readmeTargets.has(relative), `根索引缺少安装链接：${relative}`);
    }
    t.diagnostic(`根索引覆盖 ${modules.length} 个 Surge 模块、${native.length} 个 Egern 原生模块。`);
});

test('Markdown 的相对文件链接指向仓库内现存文件或目录', () => {
    for (const [filename, text] of texts) {
        if (!filename.endsWith('.md')) continue;
        for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
            const href = match[1];
            if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href) || href.startsWith('#')) continue;
            const relative = decodeURIComponent(href.split(/[?#]/)[0]);
            const target = path.resolve(path.dirname(filename), relative);
            assert.ok(target.startsWith(ROOT + path.sep) && fs.existsSync(target),
                `相对链接不存在：${path.relative(ROOT, filename)} → ${href}`);
            const real = fs.realpathSync(target);
            assert.ok(real.startsWith(ROOT + path.sep), `相对链接指向仓库外：${href}`);
        }
    }
});
