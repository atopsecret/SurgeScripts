// Engine | Node.js 20+ | JavaScript ES module
// Build: node apple-weather/build-surge.mjs
// Run: node apple-weather/build-surge.mjs --check; npm --prefix apple-weather run test:surge
// Deps: Node.js built-ins only; no npm install, network access or Egern rebuild.
// Embed the exact committed Egern 1.0.0 bundle once, omitting only its ES export directive.
// Append the maintained Surge adapter; write only apple-weather-enhancer.surge.js.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node apple-weather/build-surge.mjs [--check]');
}
const file = name => new URL(name, import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = JSON.parse(await readFile(file('tests/fixtures/surge-source.json'), 'utf8'));
const upstream = JSON.parse(await readFile(file('vendor/manifest.json'), 'utf8'));
for (const [name, expected] of Object.entries(upstream.files)) {
    if (hash(await readFile(file(name))) !== expected) throw new Error(`Source hash mismatch: ${name}`);
}
const egernBytes = await readFile(file('apple-weather-enhancer.egern.js'));
if (hash(egernBytes) !== provenance.source.scriptSHA256) {
    throw new Error('Pinned Egern 1.0.0 bundle changed; review the complete core before updating provenance.');
}
const egern = egernBytes.toString('utf8');
const directive = provenance.source.exportStatement;
if (directive !== 'export{ui as createEngine,zi as default};\n' || !egern.endsWith(directive)) {
    throw new Error('Unexpected Egern export structure');
}
const core = egern.slice(0, -directive.length);
if (Buffer.byteLength(core) !== provenance.source.embeddedCoreBytes || hash(core) !== provenance.source.embeddedCoreSHA256) {
    throw new Error('Embedded Egern / WeatherKit / FlatBuffers core bytes changed');
}
const adapter = await readFile(file('src/surge-adapter.js'), 'utf8');
const banner = `// Engine | Surge iOS 6.x WebView | JavaScript
// Build: node apple-weather/build-surge.mjs (Node built-ins; leaves Egern unchanged)
// Test: npm --prefix apple-weather run test:surge
// Run: apple-weather/apple-weather-enhancer.sgmodule; one URL for availability, data and generic diagnostics.
// Deps: runtime self-contained; Egern 1.0.0 / WeatherKit v3.1.0 / FlatBuffers 24.12.23.
// Source: atopsecret Egern wrapper, commit ${provenance.source.repositoryCommit}.
// WeatherKit: ${provenance.source.weatherKitCommit}; authors: VirgilClyne, WordlessEcho, 001.
// License: Apache-2.0; source, licenses and Surge modifications: apple-weather/NOTICE.md.
// Generated from the existing Egern bundle and src/surge-adapter.js; do not edit the embedded core.

`;
const output = banner + "(function () {\n'use strict';\n" + core + '\n' + adapter + '})();\n';
if (/\bimport\s*(?:\(|['"{*])|\bexport\s*[{*]|\brequire\s*\(|\beval\s*\(|new Function/.test(output)) {
    throw new Error('Surge output contains module loading or dynamic execution');
}
new vm.Script(output, { filename: 'apple-weather-enhancer.surge.js' });
const destination = file('apple-weather-enhancer.surge.js');
if (args[0] === '--check') {
    if (!(await readFile(destination)).equals(Buffer.from(output))) throw new Error('Surge bundle is stale; run build:surge');
} else {
    await writeFile(destination, output);
}
console.log(`Surge ${args[0] === '--check' ? 'check' : 'build'}: ${Buffer.byteLength(output)} bytes; SHA-256 ${hash(output)}; unchanged Egern core ${hash(core)}.`);
