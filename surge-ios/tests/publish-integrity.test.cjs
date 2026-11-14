// Node.js | 24+ | CommonJS
// Build: none; verifies the committed release without regenerating it.
// Run: node --test surge-ios/tests/publish-integrity.test.cjs
// Deps: Node.js built-ins only; static checks, no remote URL requests.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { publishRoot, fixtureRoot, remoteScriptPrefix, remoteModulePrefix, fixtureJSON, scriptEntries, sections } = require('./layout.cjs');
const expected = fixtureJSON('release-layout.json');
const provenance = fixtureJSON('provenance.json');
const manifestText = fs.readFileSync(path.join(publishRoot, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const modules = expected.modules.map(entry => {
    const text = fs.readFileSync(path.join(publishRoot, 'modules', entry.name), 'utf8');
    return { ...entry, text, actualEntries: scriptEntries(text, { includeCommented: true }) };
});
const scripts = expected.scripts.map(name => ({ name, source: fs.readFileSync(path.join(publishRoot, 'scripts', name), 'utf8') }));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sortedUnique = values => [...new Set(values)].sort();
function filesBelow(root) {
    return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
        const filename = path.join(root, entry.name);
        assert.equal(entry.isSymbolicLink(), false, `Unexpected symlink: ${path.relative(publishRoot, filename)}`);
        return entry.isDirectory() ? filesBelow(filename) : [filename];
    });
}
const privateMaterial = /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|-----BEGIN CERTIFICATE-----|(?:ca-p12|ca-passphrase)\s*[=:]/i;
const subscriberUUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const mobileNumber = /(?<![\w\d])(?:\+?86[- ]?)?1[3-9]\d{9}(?![\w\d])/;
const providerCredential = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{24,})\b/;
function credentialLiterals(text) {
    return [...text.matchAll(/\b(?:subscriber[_-]?uuid|api[_-]?key|access[_-]?token|authorization|password|token)["']?\s*[:=]\s*(["'])([^"'\r\n]*)\1/gi)]
        .map(match => match[2]).filter(Boolean);
}
const publicConstants = new Set(expected.documentedPublicConstants.map(entry => entry.value));

test('Release includes exactly the fourteen named scripts and eleven named modules', () => {
    assert.deepEqual(fs.readdirSync(path.join(publishRoot, 'scripts')).sort(), expected.scripts);
    assert.deepEqual(fs.readdirSync(path.join(publishRoot, 'modules')).sort(), expected.modules.map(entry => entry.name).sort());
    assert.equal(expected.scripts.length, 14);
    assert.equal(expected.modules.length, 11);
    assert.deepEqual(manifest.scripts.map(entry => entry.name).sort(), expected.scripts);
    assert.deepEqual(manifest.modules.map(entry => entry.name).sort(), expected.modules.map(entry => entry.name).sort());
});
test('Manifest paths and GitHub raw URLs refer to the actual public release', () => {
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.repository, 'atopsecret/SurgeScripts');
    for (const entry of manifest.scripts) {
        assert.equal(entry.path, 'scripts/' + entry.name);
        assert.equal(entry.url, remoteScriptPrefix + entry.name);
    }
    for (const entry of manifest.modules) {
        assert.equal(entry.path, 'modules/' + entry.name);
        assert.equal(entry.url, remoteModulePrefix + entry.name);
    }
});
test('All fourteen script byte lengths and SHA-256 values match the public manifest', () => {
    for (const entry of manifest.scripts) {
        const bytes = fs.readFileSync(path.join(publishRoot, entry.path));
        assert.match(entry.sha256, /^[0-9a-f]{64}$/);
        assert.equal(entry.bytes, bytes.length, entry.name);
        assert.equal(entry.sha256, hash(bytes), entry.name);
    }
});
test('All twenty-eight active and one optional entry preserve their source parameters', () => {
    for (const module of modules) {
        const normalized = module.actualEntries.map(entry => {
            assert.equal(entry['script-path'], remoteScriptPrefix + path.basename(entry['script-path']), `${module.name}: ${entry.name}`);
            assert.ok(expected.scripts.includes(path.basename(entry['script-path'])), entry.name);
            return { ...entry, 'script-path': path.basename(entry['script-path']) };
        });
        assert.deepEqual(normalized, module.entries, module.name);
    }
    assert.equal(modules.flatMap(module => module.actualEntries).filter(entry => !entry.commented).length, 28);
    assert.equal(modules.flatMap(module => module.actualEntries).filter(entry => entry.commented).length, 1);
});
test('Manifest maps all eleven modules to every textual reference with zero omissions', () => {
    for (const module of modules) {
        const references = sortedUnique(module.actualEntries.map(entry => path.basename(entry['script-path'])));
        const declared = manifest.modules.find(entry => entry.name === module.name).scriptReferences;
        assert.deepEqual(declared, references, module.name);
        const textualReferences = [...module.text.matchAll(/script-path=([^,\s]+)/g)].map(match => match[1]);
        assert.equal(textualReferences.length, module.actualEntries.length, module.name);
        for (const url of textualReferences) assert.equal(url, remoteScriptPrefix + path.basename(url));
    }
    assert.deepEqual(sortedUnique(modules.flatMap(module => module.actualEntries.map(entry => path.basename(entry['script-path'])))), expected.scripts);
});
test('Thirteen scripts are active by default and JD POST capture stays opt-in', () => {
    const active = sortedUnique(modules.flatMap(module => module.actualEntries.filter(entry => !entry.commented).map(entry => path.basename(entry['script-path']))));
    assert.deepEqual(active, expected.defaultReferencedScripts);
    assert.equal(active.length, 13);
    for (const entry of manifest.scripts) assert.equal(entry.defaultReferenced, active.includes(entry.name), entry.name);
    const optional = modules.flatMap(module => module.actualEntries).filter(entry => entry.commented);
    assert.deepEqual(optional.map(entry => entry.name), ['ios-jd-adblock-post-association']);
    assert.equal(path.basename(optional[0]['script-path']), 'common-jd-post-capture.js');
});
test('Active body readers retain finite caps no larger than four MiB', () => {
    for (const entry of modules.flatMap(module => module.actualEntries).filter(entry => !entry.commented && entry['requires-body'] === 'true')) {
        assert.match(entry['max-size'], /^\d+$/, entry.name);
        assert.ok(Number(entry['max-size']) > 0 && Number(entry['max-size']) <= 4194304, entry.name);
    }
});
test('Modules add only functional sections and appended MITM hostnames, never CA or proxy settings', () => {
    const allowed = new Set(['Rule', 'URL Rewrite', 'Map Local', 'Script', 'MITM']);
    for (const module of modules) {
        for (const name of Object.keys(sections(module.text))) assert.ok(allowed.has(name), `${module.name}: ${name}`);
        for (const line of sections(module.text).MITM || []) assert.match(line, /^hostname\s*=\s*%APPEND% /);
        assert.doesNotMatch(module.text, privateMaterial, module.name);
        assert.doesNotMatch(module.text, /^\s*(?:enabled|block-quic|dns-server|encrypted-dns-server|proxy|http-listen|socks5-listen)\s*=/im, module.name);
    }
});
test('All published JavaScript is standalone and syntactically valid without runtime imports', () => {
    for (const entry of scripts) {
        new vm.Script(entry.source, { filename: entry.name });
        assert.doesNotMatch(entry.source, /^\s*(?:import|export)\s|\brequire\s*\(|\bimport\s*\(/m, entry.name);
    }
});
test('Published scripts and modules contain no detected subscriber credentials, phone numbers or private material', () => {
    for (const [name, text] of [...scripts.map(entry => [entry.name, entry.source]), ...modules.map(entry => [entry.name, entry.text]), ['manifest', manifestText]]) {
        assert.equal(privateMaterial.test(text), false, name + ': detected privateMaterial signature');
        assert.equal(subscriberUUID.test(text), false, name + ': detected subscriberUUID signature');
        assert.equal(mobileNumber.test(text), false, name + ': detected mobileNumber signature');
        assert.equal(providerCredential.test(text), false, name + ': detected providerCredential signature');
        assert.doesNotMatch(text, /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{8,}/, name);
        assert.equal(credentialLiterals(text).filter(value => !publicConstants.has(value)).length, 0, name + ': unexpected credential literal');
    }
    const weather = modules.find(entry => entry.name === 'ios-weather.sgmodule');
    for (const entry of weather.actualEntries) {
        const args = new URLSearchParams(entry.argument);
        for (const name of ['API.ColorfulClouds.Token', 'API.QWeather.Token', 'API.WAQI.Token']) assert.equal(args.get(name), '');
    }
});
test('Required upstream baseline copies retain their recorded exact bytes and hashes', () => {
    const originals = provenance.files.filter(entry => entry.sha256);
    assert.equal(originals.length, 12);
    for (const entry of originals) {
        const bytes = fs.readFileSync(path.join(fixtureRoot, entry.path));
        assert.equal(bytes.length, entry.bytes, entry.path);
        assert.equal(hash(bytes), entry.sha256, entry.path);
    }
    const source = fixtureJSON('weather/source.json').source;
    assert.equal(source.scriptSHA256, hash(fs.readFileSync(path.join(fixtureRoot, 'weather/apple-weather-enhancer.egern.js'))));
    for (const entry of expected.documentedPublicConstants) {
        assert.ok(fs.readFileSync(path.join(fixtureRoot, entry.path), 'utf8').includes(entry.value));
    }
});
test('Committed test dependencies exclude personal paths, CA files and nonfixture credentials', () => {
    const dependencyFiles = [...filesBelow(fixtureRoot), ...filesBelow(__dirname)];
    for (const filename of dependencyFiles) {
        const name = path.relative(publishRoot, filename);
        assert.doesNotMatch(name, /\.(?:p12|pfx|pem|cer|mobileconfig)$/i);
        const text = fs.readFileSync(filename, 'utf8');
        assert.doesNotMatch(text, /\/(?:Users|home)\/[A-Za-z0-9._-]+/);
        assert.equal(subscriberUUID.test(text), false, name + ': detected subscriberUUID signature');
        assert.equal(providerCredential.test(text), false, name + ': detected providerCredential signature');
        assert.equal(mobileNumber.test(text), false, name + ': detected mobileNumber signature');
        if (filename.startsWith(fixtureRoot + path.sep)) {
            assert.equal(privateMaterial.test(text), false, name + ': detected privateMaterial signature');
            const unexpected = credentialLiterals(text).filter(value => !publicConstants.has(value) && !/^(?:Bearer )?fixture(?:[-_]|$)|^PRIVATE_FIXTURE$/.test(value));
            assert.equal(unexpected.length, 0, name + ': unexpected nonfixture credential literal');
        }
    }
});
