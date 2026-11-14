// Node.js | 24+ | ES modules
// Build: none; no npm install or product build is required.
// Run: node surge-ios/tests/run.mjs [--verbose]
// Deps: built-ins only. Original mocks run in network-blocked child processes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { publishRoot, fixtureJSON } = require('./layout.cjs');
const testsRoot = path.join(publishRoot, 'tests');
const repoRoot = path.dirname(publishRoot);
const guard = path.join(testsRoot, 'offline-guard.cjs');
const expectedCounts = fixtureJSON('release-layout.json').originalSuiteCounts;
const verbose = process.argv.includes('--verbose');
const suites = [
    ['common', 'common.test.cjs'],
    ['weather', 'weather.test.cjs'],
    ['camscanner', 'camscanner.test.cjs'],
    ['nio', 'nio.test.cjs'],
    ['module-structure', 'module-structure.test.cjs'],
    ['youtube', 'youtube.mock-tests.mjs'],
    ['publish-integrity', 'publish-integrity.test.cjs'],
];
function snapshotRelease() {
    const files = ['manifest.json', ...['scripts', 'modules'].flatMap(directory =>
        fs.readdirSync(path.join(publishRoot, directory)).sort().map(name => directory + '/' + name))];
    return Object.fromEntries(files.map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(publishRoot, name))).digest('hex')]));
}
function guardCounts(output) {
    const records = [...output.matchAll(/^(?:#\s*)?OFFLINE_GUARD (\{[^\r\n]+\})$/gm)].map(match => JSON.parse(match[1]));
    assert.ok(records.length > 0, 'Offline guard summary is missing');
    for (const record of records) assert.ok(Number.isSafeInteger(record.networkAttempts) && record.networkAttempts >= 0);
    return records.reduce((total, record) => total + record.networkAttempts, 0);
}
function tapSummary(output) {
    const counters = Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
    for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) assert.ok(Number.isSafeInteger(counters[key]), `TAP ${key} count is missing`);
    assert.equal(counters.tests, counters.pass + counters.fail + counters.cancelled + counters.skipped + counters.todo, 'TAP count mismatch');
    return { total: counters.tests, passed: counters.pass, failed: counters.fail, cancelled: counters.cancelled, skipped: counters.skipped, todo: counters.todo };
}
function youtubeSummary(output) {
    const lines = [...output.matchAll(/^MOCK_SUMMARY (\{[^\r\n]+\})$/gm)];
    assert.equal(lines.length, 1, 'YouTube must emit exactly one original mock summary');
    const report = JSON.parse(lines[0][1]);
    assert.ok(Number.isSafeInteger(report.total) && report.total > 0);
    assert.equal(report.tests.length, report.total);
    assert.equal(report.tests.filter(test => test.status === 'passed').length, report.passed);
    assert.equal(report.tests.filter(test => test.status === 'failed').length, report.failed);
    assert.equal(report.passed + report.failed, report.total);
    return { total: report.total, passed: report.passed, failed: report.failed, cancelled: 0, skipped: 0, todo: 0, mockedNetworkCalls: report.mockedNetworkCalls };
}
let before;
try { before = snapshotRelease(); }
catch (error) { console.error('Release snapshot failed: ' + error.message); process.exitCode = 1; }
const rows = [];
if (before) for (const [name, filename] of suites) {
    const args = ['--require', guard];
    if (filename.endsWith('.test.cjs')) args.push('--test', '--test-reporter=tap');
    args.push(path.join(testsRoot, filename));
    const child = spawnSync(process.execPath, args, {
        cwd: repoRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: '' },
    });
    const output = child.stdout || '';
    const row = { name, filename: 'surge-ios/tests/' + filename, expected: expectedCounts[name] ?? null, exitCode: child.status, signal: child.signal || null };
    let failure;
    try {
        Object.assign(row, name === 'youtube' ? youtubeSummary(output) : tapSummary(output));
        row.networkAttempts = guardCounts(output);
        assert.equal(row.networkAttempts, 0, 'Real network API attempts were observed');
        assert.equal(child.status, 0, child.error?.message || 'Suite exited nonzero');
        assert.equal(row.failed + row.cancelled + row.skipped + row.todo, 0, 'Failed/cancelled/skipped/todo tests are not accepted');
        if (row.expected !== null) assert.equal(row.total, row.expected, 'Original suite count changed');
    } catch (error) { failure = error.message; row.error = failure; process.exitCode = 1; }
    rows.push(row);
    console.log(`${failure ? 'FAIL' : 'PASS'} ${name}: ${row.passed ?? '?'} / ${row.total ?? '?'}; failed=${row.failed ?? '?'}; skipped=${row.skipped ?? '?'}; networkAttempts=${row.networkAttempts ?? '?'}`);
    if (verbose || failure) {
        process.stdout.write(output);
        process.stderr.write(child.stderr || '');
        if (failure) console.error(`${name}: ${failure}`);
    }
}
let publicArtifactsUnchanged = false;
if (before) try {
    assert.deepEqual(snapshotRelease(), before, 'Tests changed protected release scripts/modules/manifest');
    publicArtifactsUnchanged = true;
} catch (error) { console.error(error.message); process.exitCode = 1; }
const original = rows.filter(row => row.name !== 'publish-integrity');
const totals = group => ({
    total: group.reduce((sum, row) => sum + (row.total ?? 0), 0),
    passed: group.reduce((sum, row) => sum + (row.passed ?? 0), 0),
    failed: group.reduce((sum, row) => sum + (row.failed ?? 0), 0),
    skipped: group.reduce((sum, row) => sum + (row.skipped ?? 0), 0),
    cancelled: group.reduce((sum, row) => sum + (row.cancelled ?? 0), 0),
    todo: group.reduce((sum, row) => sum + (row.todo ?? 0), 0),
});
const summary = {
    command: 'node surge-ios/tests/run.mjs', node: process.version,
    status: process.exitCode ? 'failed' : 'passed', original: totals(original),
    addedStatic: totals(rows.filter(row => row.name === 'publish-integrity')), total: totals(rows),
    realNetworkAttempts: rows.reduce((sum, row) => sum + (row.networkAttempts ?? 0), 0),
    publicArtifactsUnchanged, suites: rows,
};
console.log('SURGE_IOS_TEST_SUMMARY ' + JSON.stringify(summary));
console.log(`Original mocks: ${summary.original.passed}/${summary.original.total}; added static: ${summary.addedStatic.passed}/${summary.addedStatic.total}; protected release unchanged: ${publicArtifactsUnchanged}`);
