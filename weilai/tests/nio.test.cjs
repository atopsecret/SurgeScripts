// Engine | Node.js 20+ | CommonJS
// Build: node --check weilai/tests/nio.test.cjs
// Run: node --test weilai/tests/nio.test.cjs
// Deps: local isolated runtime; no real login, account, capture, or check-in calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const { nio, clock, savedState, storeFor, bodySuccess, TOKEN, TOKEN_B, UA, URL, KEYS } = require('./runtime-mock.cjs');
function captureOptions(overrides = {}) { return { type: 'http-request', request: { url: URL, method: 'POST', headers: { Authorization: TOKEN, 'User-Agent': UA } }, ...overrides }; }
function json(store, key) { return store.has(key) ? JSON.parse(store.get(key)) : null; }
function combined(run) { return run.logs.join('\n') + run.notices.map(n => [n.title, n.subtitle, n.body].join('\n')).join('\n'); }
function noSecrets(run) { assert.equal(combined(run).includes(TOKEN), false); assert.equal(combined(run).includes(TOKEN_B), false); }
function confirmed(store) { return json(store, KEYS.journal)?.confirmed; }
function fieldTypes() {
    return Object.fromEntries(['stats.continuous_checkin_days', 'stats.continuous_days', 'continuous_checkin_days', 'continuous_days',
        'stats.accumulate_days', 'accumulate_days', 'stats.accumulateDays', 'accumulateDays', 'stats.total_days', 'total_days',
        'award_info.accumulate_days', 'award_info.total_days'].map(name => [name, 'missing']));
}
function observation(c, overrides = {}) { return { version: 1, generation: 'fixture-generation', day: '2026-11-14', observedAt: c.now, stats: { consecutive: 3, total: 12 }, fields: fieldTypes(), ...overrides }; }
function responseOptions(c, store, data = bodySuccess(), overrides = {}) {
    return { type: 'http-response', clock: c, store, request: { url: URL, method: 'POST', headers: { authorization: TOKEN } },
        response: { status: 200, headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: new Uint8Array(Buffer.from(data)) }, ...overrides };
}
for (const [name, url] of [
    ['award', URL], ['legacy-award', 'https://gateway-front-external.nio.com/moat/10086//n/c/award/checkin'],
    ['app-user', 'https://app.nio.com/account/user/profile'], ['api-user', 'https://api.nio.com/n/c/user/profile'],
    ['app-api', 'https://app.nio.com/app/api/profile'], ['api-prefix', 'https://api.nio.com/api/account']
]) test('NIO capture path ' + name, async () => {
    const run = await nio(captureOptions({ request: { url, method: 'GET', headers: { aUtHoRiZaTiOn: TOKEN, 'USER-AGENT': UA } } }));
    const state = json(run.store, KEYS.state);
    assert.equal(state.token, TOKEN); assert.equal(state.userAgent, UA); assert.equal(state.invalid, false);
    assert.match(state.generation, /^[A-Za-z0-9_-]+$/);
    assert.equal(run.calls.length, 0); assert.deepEqual(run.plainResult, {}); noSecrets(run);
});
for (const [name, url] of [
    ['http', URL.replace('https:', 'http:')], ['unknown-host', URL.replace('gateway-front-external.nio.com', 'evil.nio.com')],
    ['host-suffix', URL.replace('gateway-front-external.nio.com', 'gateway-front-external.nio.com.fixture.org')],
    ['unknown-path', 'https://api.nio.com/unrelated/data']
]) test('NIO rejects nontarget capture ' + name, async () => {
    const run = await nio(captureOptions({ request: { url, headers: { authorization: TOKEN, 'user-agent': UA } } }));
    assert.equal(run.store.size, 0); assert.equal(run.calls.length, 0);
});
for (const [name, token] of [['short', 'Bearer tiny'], ['basic', 'Basic fixture'], ['newline', TOKEN + '\n'], ['missing', undefined]])
    test('NIO ignores invalid capture token ' + name, async () => {
        const run = await nio(captureOptions({ request: { url: URL, headers: { authorization: token } } }));
        assert.equal(run.store.size, 0); assert.equal(run.calls.length, 0);
    });
test('NIO capture supports full-header array without reading request body', async () => {
    const request = { url: URL, method: 'POST', headers: [{ field: 'Authorization', value: TOKEN }, { field: 'User-Agent', value: UA }] };
    Object.defineProperty(request, 'body', { get() { throw new Error('Request body must remain unread'); } });
    const run = await nio(captureOptions({ request }));
    assert.equal(json(run.store, KEYS.state).token, TOKEN); assert.equal(run.calls.length, 0);
});
test('NIO unchanged capture does not rewrite credential state', async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio(captureOptions({ clock: c, store }));
    assert.equal(run.writes.filter(item => item.key === KEYS.state).length, 0);
    assert.equal(json(store, KEYS.capture).code, 'C-UNCHANGED');
});
test('NIO capture retains valid previous UA and invalid mark for same token', async () => {
    const c = clock(), store = storeFor(c, { invalid: true });
    const run = await nio(captureOptions({ clock: c, store, request: { url: URL, headers: { authorization: TOKEN, 'user-agent': 'Browser' } } }));
    const state = json(store, KEYS.state);
    assert.equal(state.userAgent, UA); assert.equal(state.invalid, true); assert.equal(run.calls.length, 0);
});
test('NIO new token receives a new generation and repairs invalid state', async () => {
    const c = clock(), store = storeFor(c, { invalid: true });
    const run = await nio(captureOptions({ clock: c, store, request: { url: URL, headers: { authorization: TOKEN_B, 'user-agent': UA } } }));
    const state = json(store, KEYS.state);
    assert.equal(state.token, TOKEN_B); assert.equal(state.invalid, false); assert.notEqual(state.generation, 'fixture-generation'); noSecrets(run);
});
test('NIO capture can repair corrupt new-namespace JSON from a real request', async () => {
    const store = new Map([[KEYS.state, '{corrupt']]);
    const run = await nio(captureOptions({ store }));
    assert.equal(json(store, KEYS.state).token, TOKEN); assert.equal(json(store, KEYS.capture).code, 'C-SAVED');
});
for (const [name, hooks, code] of [
    ['read API throws', { onRead(key) { if (key === KEYS.state) throw new Error('fixture read failure'); } }, 'E-READ'],
    ['write returns false', { onWrite(data, key) { if (key === KEYS.state) return false; } }, 'E-WRITE'],
    ['readback throws', { onRead(key, env) { if (key === KEYS.state && env.writes.some(x => x.key === KEYS.state)) throw new Error('fixture readback failure'); } }, 'E-READBACK'],
    ['readback empty', { onRead(key, env) { if (key === KEYS.state && env.writes.some(x => x.key === KEYS.state)) return null; } }, 'E-EMPTY'],
    ['readback malformed', { onRead(key, env) { if (key === KEYS.state && env.writes.some(x => x.key === KEYS.state)) return '{}'; } }, 'E-FORMAT'],
]) test('NIO capture error ' + name, async () => {
    const run = await nio(captureOptions(hooks));
    assert.equal(json(run.store, KEYS.capture).code, code); assert.equal(run.calls.length, 0); noSecrets(run);
});
test('NIO capture detects stale write/readback mismatch', async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio(captureOptions({ clock: c, store, request: { url: URL, headers: { authorization: TOKEN_B, 'user-agent': UA } },
        onWrite(data, key) { if (key === KEYS.state) return true; } }));
    assert.equal(json(store, KEYS.capture).code, 'E-MISMATCH'); assert.equal(json(store, KEYS.state).token, TOKEN);
});
test('NIO capture coalesces a concurrently stored same token', async () => {
    const run = await nio(captureOptions({ onWrite(data, key, env) {
        if (key !== KEYS.state) return;
        const state = JSON.parse(data); state.generation = 'parallel-generation'; state.observedAt += 1;
        env.store.set(key, JSON.stringify(state)); return true;
    } }));
    assert.equal(json(run.store, KEYS.capture).code, 'C-COALESCED');
});
test('NIO capture does not roll back a newer different token', async () => {
    const run = await nio(captureOptions({ onWrite(data, key, env) {
        if (key !== KEYS.state) return;
        const state = JSON.parse(data); state.token = TOKEN_B; state.generation = 'newer-generation'; state.observedAt += 1;
        env.store.set(key, JSON.stringify(state)); return true;
    } }));
    assert.equal(json(run.store, KEYS.capture).code, 'C-SUPERSEDED'); assert.equal(json(run.store, KEYS.state).token, TOKEN_B); assert.equal(run.notices.length, 0);
});
test('NIO capture reminder failure does not lose persisted auth', async () => {
    const run = await nio(captureOptions({ notificationThrows: true }));
    assert.equal(json(run.store, KEYS.state).token, TOKEN); assert.equal(run.calls.length, 0);
});
test('NIO binary observation preserves exact response and writes only stats', async () => {
    const c = clock(), store = storeFor(c);
    const raw = '\uFEFF' + bodySuccess({ continuous_checkin_days: '3', accumulate_days: '12' });
    const bytes = new Uint8Array(Buffer.from(raw));
    const run = await nio(responseOptions(c, store, raw));
    assert.deepEqual(Array.from(run.result.body), Array.from(bytes));
    const stats = json(store, KEYS.stats);
    assert.deepEqual(stats.stats, { consecutive: 3, total: 12 }); assert.equal(stats.generation, 'fixture-generation');
    assert.equal(run.writes.every(item => item.key === KEYS.stats), true); assert.equal(run.calls.length, 0); noSecrets(run);
});
for (const [name, options] of [
    ['other URL', { request: { url: 'https://api.nio.com/api/other', method: 'POST', headers: { authorization: TOKEN } } }],
    ['other token', { request: { url: URL, method: 'POST', headers: { authorization: TOKEN_B } } }],
    ['wrong method', { request: { url: URL, method: 'PUT', headers: { authorization: TOKEN } } }],
    ['non200', { response: { status: 403, headers: {}, body: new Uint8Array(Buffer.from(bodySuccess())) } }],
    ['unsupported charset', { response: { status: 200, headers: { 'Content-Type': 'application/json; charset=gbk' }, body: new Uint8Array(Buffer.from(bodySuccess())) } }],
]) test('NIO observation rejects ' + name, async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio(responseOptions(c, store, bodySuccess(), options));
    assert.equal(store.has(KEYS.stats), false); assert.equal(run.calls.length, 0);
});
for (const [name, raw] of [
    ['invalid JSON', new Uint8Array(Buffer.from('{bad'))],
    ['invalid UTF8', new Uint8Array([0xe0, 0x80, 0x80])],
    ['unknown result', new Uint8Array(Buffer.from('{"result_code":"failure","data":{"checked_in":true}}'))],
    ['not checked in', new Uint8Array(Buffer.from('{"result_code":"success","data":{"checked_in":false}}'))],
    ['oversize', new Uint8Array(262145)],
]) test('NIO observation passthrough ' + name, async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio(responseOptions(c, store, '', { response: { status: 200, headers: {}, body: raw } }));
    assert.deepEqual(Array.from(run.result.body), Array.from(raw)); assert.equal(store.has(KEYS.stats), false); assert.equal(run.calls.length, 0);
});
test('NIO observation storage failure still returns original bytes', async () => {
    const c = clock(), store = storeFor(c), raw = bodySuccess();
    const run = await nio(responseOptions(c, store, raw, { onWrite(data, key) { if (key === KEYS.stats) return false; } }));
    assert.deepEqual(Array.from(run.result.body), Array.from(Buffer.from(raw))); assert.equal(run.calls.length, 0);
});
test('NIO capture → persistent state → observed stats → cron request → success', async () => {
    const c = clock(), store = new Map();
    await nio(captureOptions({ clock: c, store }));
    const generation = json(store, KEYS.state).generation;
    await nio(responseOptions(c, store, bodySuccess({ continuous_checkin_days: 4, accumulate_days: 30 })));
    const run = await nio({ type: 'cron', clock: c, store, responses: [{ data: bodySuccess({ continuous_checkin_days: 4 }) }] });
    assert.equal(run.calls.length, 1); assert.deepEqual(confirmed(store).stats, { consecutive: 4, total: 30 });
    assert.equal(confirmed(store).generation, generation); assert.equal(json(store, KEYS.journal).lock, null);
    assert.match(run.notices[0].body, /30 天/); noSecrets(run);
});
test('NIO native request options convert milliseconds to seconds exactly', async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio({ type: 'cron', clock: c, store, responses: [{}] });
    const request = run.calls[0];
    assert.equal(request.timeout, 5); assert.equal(request['auto-redirect'], false); assert.equal(request['auto-cookie'], false); assert.equal(request.insecure, false);
    assert.equal(request.body, 'event=checkin'); assert.equal(request.headers.authorization, TOKEN); assert.equal(request.headers['user-agent'], UA);
    assert.match(request.url, /^https:\/\/gateway-front-external\.nio\.com\/moat\/10086\/c\/award_cn\/checkin\?app_id=10086&timestamp=\d+$/);
    assert.equal(Object.hasOwn(request, 'credentials'), false); assert.equal(Object.hasOwn(request, 'insecureTls'), false); noSecrets(run);
});
test('NIO fallback UA is used only when captured UA is not native NIO', async () => {
    const c = clock(), store = storeFor(c, { userAgent: '' });
    const run = await nio({ type: 'cron', clock: c, store, responses: [{}] });
    assert.match(run.calls[0].headers['user-agent'], /NIOAppCN\/6\.10\.0/); assert.match(run.calls[0].headers['user-agent'], /iPhone OS 18_7/);
});
test('NIO successful daily journal avoids another request', async () => {
    const c = clock(), store = storeFor(c);
    await nio({ type: 'cron', clock: c, store, responses: [{}] });
    const run = await nio({ type: 'cron', clock: c, store });
    assert.equal(run.calls.length, 0); assert.match(combined(run), /本地记录/); noSecrets(run);
});
test('NIO missing total is supplemented only after success is saved', async () => {
    const c = clock(), store = storeFor(c); let verifiedSaved = false;
    const run = await nio({ type: 'cron', clock: c, store, responses: [
        { data: bodySuccess({ continuous_checkin_days: 5 }) },
        (_request, callback) => { verifiedSaved = confirmed(store)?.stats.consecutive === 5; callback(null, { status: 200, headers: {} }, bodySuccess({ continuous_checkin_days: 5, total_days: 40 })); }
    ] });
    assert.equal(verifiedSaved, true); assert.equal(run.calls.length, 2); assert.deepEqual(confirmed(store).stats, { consecutive: 5, total: 40 }); assert.equal(run.notices.length, 1);
});
test('NIO supplement failure never invalidates saved check-in', async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio({ type: 'cron', clock: c, store, responses: [{ data: bodySuccess({ continuous_days: 4 }) }, { status: 401 }] });
    assert.equal(run.calls.length, 2); assert.equal(confirmed(store).stats.consecutive, 4); assert.equal(json(store, KEYS.state).invalid, false); assert.match(combined(run), /签到已确认/);
});
test('NIO recent observation suppresses unnecessary supplement', async () => {
    const c = clock(), store = storeFor(c); store.set(KEYS.stats, JSON.stringify(observation(c)));
    const run = await nio({ type: 'cron', clock: c, store, responses: [{ data: bodySuccess({ continuous_days: 3 }) }] });
    assert.equal(run.calls.length, 1); assert.equal(confirmed(store).stats.total, 12);
});
test('NIO old-day and other-generation observations do not fill totals', async () => {
    for (const override of [{ generation: 'other' }, { day: '2026-11-13', observedAt: clock().now - 86400000 }]) {
        const c = clock(), store = storeFor(c); store.set(KEYS.stats, JSON.stringify(observation(c, override)));
        const run = await nio({ type: 'cron', clock: c, store, responses: [{ data: bodySuccess({ continuous_days: 3 }) }, { status: 500 }] });
        assert.equal(run.calls.length, 2); assert.equal(confirmed(store).stats.total, undefined);
    }
});
for (const [name, reply, invalid, retained] of [
    ['401', { status: 401 }, true, false],
    ['expired code', { status: 200, data: '{"result_code":"token_expired"}' }, true, false],
    ['generic403', { status: 403, data: '{"result_code":"risk"}' }, false, false],
    ['500', { status: 500 }, false, true],
    ['bad JSON', { status: 200, data: '{broken' }, false, true],
    ['checked-in false', { status: 200, data: '{"result_code":"success","data":{"checked_in":false}}' }, false, true],
    ['transport failure', { error: 'fixture error containing ' + TOKEN }, false, true],
    ['hanging request', { never: true }, false, true],
]) test('NIO request failure handling ' + name, async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio({ type: 'cron', clock: c, store, responses: [reply] });
    assert.equal(run.calls.length, 1); assert.equal(json(store, KEYS.state).invalid, invalid); assert.equal(Boolean(json(store, KEYS.journal).lock), retained);
    assert.equal(confirmed(store), null); noSecrets(run);
});
test('NIO Retry-After seconds allows one bounded retry', async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio({ type: 'cron', clock: c, store, responses: [{ status: 429, headers: { 'Retry-After': '1' } }, {}] });
    assert.equal(run.calls.length, 2); assert.equal(Boolean(confirmed(store)), true); noSecrets(run);
});
test('NIO repeated rate-limit never exceeds three attempts', async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio({ type: 'cron', clock: c, store, responses: Array.from({ length: 3 }, () => ({ status: 429, headers: { 'Retry-After': '1' } })) });
    assert.equal(run.calls.length, 3); assert.equal(confirmed(store), null);
});
for (const [name, value] of [['bad header', 'later'], ['too long', '60'], ['wrong weekday date', 'Sun, 14 Nov 2026 01:00:01 GMT']])
    test('NIO unfit Retry-After does not retry ' + name, async () => {
        const c = clock(), store = storeFor(c);
        const run = await nio({ type: 'cron', clock: c, store, responses: [{ status: 429, headers: { 'Retry-After': value } }] });
        assert.equal(run.calls.length, 1); assert.equal(confirmed(store), null);
    });
test('NIO active lease stops reentrant task before HTTP', async () => {
    const c = clock(), store = storeFor(c);
    store.set(KEYS.journal, JSON.stringify({ version: 1, lock: { id: 'existing-lease', generation: 'fixture-generation', acquiredAt: c.now, expiresAt: c.now + 30000 }, confirmed: null }));
    const run = await nio({ type: 'cron', clock: c, store });
    assert.equal(run.calls.length, 0); assert.match(combined(run), /已有签到任务/);
});
test('NIO token change during request stops stale journal writes', async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio({ type: 'cron', clock: c, store, responses: [{ before() { store.set(KEYS.state, JSON.stringify(savedState(c, { token: TOKEN_B, generation: 'replacement' }))); } }] });
    assert.equal(run.calls.length, 1); assert.equal(confirmed(store), null); assert.equal(json(store, KEYS.state).token, TOKEN_B); assert.match(combined(run), /凭据状态已变化/);
});
test('NIO corrupt journal stops task instead of guessing defaults', async () => {
    const c = clock(), store = storeFor(c); store.set(KEYS.journal, 'null');
    const run = await nio({ type: 'cron', clock: c, store });
    assert.equal(run.calls.length, 0); assert.match(combined(run), /任务状态损坏/);
});
test('NIO successful HTTP with confirmation write failure never retries', async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio({ type: 'cron', clock: c, store, responses: [{}], onWrite(data, key) {
        if (key === KEYS.journal && JSON.parse(data).confirmed) return false;
    } });
    assert.equal(run.calls.length, 1); assert.equal(confirmed(store), null); assert.match(combined(run), /防重复记录未确认保存/);
});
test('NIO generic diagnostics is read-only even with request/cron globals', async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio({ type: 'generic', clock: c, store, request: { url: URL, headers: { authorization: TOKEN } }, cronexp: '0 9 * * *' });
    assert.equal(run.calls.length, 0); assert.equal(run.writes.length, 0); assert.equal(run.plainResult.title, '蔚来本地诊断');
    assert.match(run.plainResult.content, /只读本地状态/); noSecrets(run);
});
test('NIO diagnostic corruption report remains local and contains no secrets', async () => {
    const store = new Map([[KEYS.state, '{corrupt']]);
    const run = await nio({ type: 'generic', store });
    assert.equal(run.calls.length, 0); assert.equal(run.writes.length, 0); assert.match(run.plainResult.content, /无法读取/); noSecrets(run);
});
test('NIO new installation does not read old source or legacy Surge credentials', async () => {
    const store = new Map([['weilai_egern_auth_state_v1', JSON.stringify({ token: TOKEN })], ['weilai_access_token', TOKEN_B]]);
    const run = await nio({ type: 'cron', store });
    assert.equal(run.calls.length, 0); assert.equal(run.reads.every(key => key.startsWith('ios_nio_v3_')), true); assert.equal(store.size, 2); noSecrets(run);
});
test('NIO source UTC+8 day boundary is retained', async () => {
    const c = clock('2026-11-13T16:00:00.000Z'), store = storeFor(c);
    await nio({ type: 'cron', clock: c, store, responses: [{}] });
    assert.equal(confirmed(store).day, '2026-11-14');
});
test('NIO statistics preserve legacy camelCase total and numeric zero', async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio({ type: 'cron', clock: c, store, responses: [{ data: JSON.stringify({ result_code: 'success', data: { checked_in: true, continuous_days: 0, accumulateDays: '0' } }) }] });
    assert.deepEqual(confirmed(store).stats, { consecutive: 0, total: 0 }); assert.equal(run.calls.length, 1);
});
test('NIO all four routes finish exactly once under a runtime without clearTimeout', async () => {
    const c = clock();
    for (const type of ['http-request', 'http-response', 'cron', 'generic']) {
        const store = storeFor(c);
        const options = type === 'http-response' ? responseOptions(c, store) : type === 'http-request' ? captureOptions({ clock: c, store }) : { type, clock: c, store, responses: type === 'cron' ? [{}] : [] };
        const run = await nio({ ...options, withoutClearTimeout: true });
        assert.equal(run.doneCount, 1);
    }
});
function partialStore(c, fields = { ...fieldTypes(), 'stats.continuous_checkin_days': 'number' }) {
    const store = storeFor(c);
    const item = { generation: 'fixture-generation', day: '2026-11-14', confirmedAt: c.now - 1000, stats: { consecutive: 3 } };
    if (fields !== undefined) item.fields = fields;
    store.set(KEYS.journal, JSON.stringify({ version: 1, lock: null, confirmed: item }));
    return store;
}
function identity(item) { return { generation: item.generation, day: item.day, confirmedAt: item.confirmedAt, stats: item.stats }; }
test('NIO metadata-only regression: first confirmation keeps recheck field types without guessing total', async () => {
    const c = clock(), store = storeFor(c);
    const run = await nio({ type: 'cron', clock: c, store, responses: [
        { data: bodySuccess({ continuous_checkin_days: 3 }) },
        { data: bodySuccess({ continuous_checkin_days: 3, accumulate_days: 'PRIVATE_INVALID_TOTAL_TEXT' }) }
    ] });
    assert.equal(confirmed(store).fields['stats.accumulate_days'], 'string');
    assert.deepEqual(confirmed(store).stats, { consecutive: 3 }); assert.equal(run.calls.length, 2);
    assert.equal(run.notices.length, 1); assert.match(run.notices[0].body, /累计签到：未知/);
    assert.equal(json(store, KEYS.state).invalid, false); assert.equal(json(store, KEYS.journal).lock, null);
    assert.doesNotMatch(combined(run) + store.get(KEYS.journal), /PRIVATE_INVALID_TOTAL_TEXT/); noSecrets(run);
});
test('NIO metadata-only regression: existing confirmation updates diagnostics with unchanged identity and lease', async () => {
    const c = clock(), store = partialStore(c), original = identity(confirmed(store)); let postedLease, checkedWrite = false;
    const run = await nio({ type: 'cron', clock: c, store,
        onPost() { postedLease = json(store, KEYS.journal).lock; },
        onWrite(data, key) {
            if (key !== KEYS.journal) return;
            const item = JSON.parse(data);
            if (item.lock && item.confirmed?.fields?.['stats.total_days'] === 'object') {
                checkedWrite = true; assert.deepEqual(item.lock, postedLease); assert.deepEqual(identity(item.confirmed), original);
            }
        },
        responses: [{ data: bodySuccess({ continuous_checkin_days: 3, total_days: { private: 'PRIVATE_RESPONSE_VALUE' } }) }]
    });
    assert.equal(confirmed(store).fields['stats.total_days'], 'object'); assert.equal(checkedWrite, true);
    assert.deepEqual(identity(confirmed(store)), original); assert.equal(run.calls.length, 1); assert.equal(run.notices.length, 1);
    assert.equal(json(store, KEYS.journal).lock, null); assert.doesNotMatch(combined(run) + store.get(KEYS.journal), /PRIVATE_RESPONSE_VALUE/);
    const diagnostic = await nio({ type: 'generic', clock: c, store });
    assert.match(diagnostic.plainResult.content, /stats\.total_days=object/);
    assert.equal(diagnostic.calls.length, 0); assert.equal(diagnostic.writes.length, 0); noSecrets(diagnostic);
});
test('NIO metadata-only regression: old confirmation without fields gains fixed diagnostics only', async () => {
    const c = clock(), store = partialStore(c); const item = confirmed(store); delete item.fields;
    store.set(KEYS.journal, JSON.stringify({ version: 1, lock: null, confirmed: item }));
    const original = identity(item);
    const run = await nio({ type: 'cron', clock: c, store, responses: [{ data: bodySuccess({ continuous_checkin_days: 3, total_days: null }) }] });
    assert.equal(confirmed(store).fields?.['stats.total_days'], 'null');
    assert.deepEqual(identity(confirmed(store)), original); assert.equal(run.calls.length, 1); assert.equal(run.notices.length, 1);
    assert.deepEqual(Object.keys(confirmed(store).fields).sort(), Object.keys(fieldTypes()).sort()); noSecrets(run);
});
test('NIO metadata-only regression: corrupt optional fields are replaced without discarding success', async () => {
    const c = clock(), store = partialStore(c, { ...fieldTypes(), extra: 'PRIVATE_METADATA_VALUE' });
    const original = identity(confirmed(store));
    const run = await nio({ type: 'cron', clock: c, store, responses: [{ data: bodySuccess({ continuous_checkin_days: 3, total_days: false }) }] });
    assert.equal(confirmed(store).fields['stats.total_days'], 'boolean');
    assert.equal(Object.hasOwn(confirmed(store).fields, 'extra'), false); assert.deepEqual(identity(confirmed(store)), original);
    assert.equal(run.calls.length, 1); assert.equal(json(store, KEYS.state).invalid, false);
    assert.doesNotMatch(combined(run) + store.get(KEYS.journal), /PRIVATE_METADATA_VALUE/); noSecrets(run);
});
test('NIO metadata-only regression: unconfirmed metadata write preserves existing confirmation and never retries', async () => {
    const c = clock(), store = partialStore(c), original = confirmed(store); let failedWrite = false;
    const run = await nio({ type: 'cron', clock: c, store,
        onWrite(data, key) {
            if (key === KEYS.journal && JSON.parse(data).confirmed?.fields?.['stats.accumulate_days'] === 'string') {
                failedWrite = true; return false;
            }
        }, responses: [{ data: bodySuccess({ continuous_checkin_days: 3, accumulate_days: 'PRIVATE_INVALID_TOTAL_TEXT' }) }]
    });
    assert.equal(failedWrite, true); assert.deepEqual(confirmed(store), original);
    assert.equal(run.calls.length, 1); assert.equal(run.notices.length, 1); assert.equal(json(store, KEYS.state).invalid, false);
    assert.match(combined(run), /补充统计未确认保存/); assert.equal(json(store, KEYS.journal).lock, null);
    assert.doesNotMatch(combined(run), /PRIVATE_INVALID_TOTAL_TEXT/); noSecrets(run);
});
test('NIO metadata control: unchanged fixed field types do not rewrite confirmation', async () => {
    const c = clock(), store = partialStore(c, { ...fieldTypes(), 'stats.continuous_checkin_days': 'number', 'stats.total_days': 'string' });
    const original = confirmed(store);
    const run = await nio({ type: 'cron', clock: c, store, responses: [{ data: bodySuccess({ continuous_checkin_days: 3, total_days: 'PRIVATE_INVALID_TOTAL_TEXT' }) }] });
    assert.deepEqual(confirmed(store), original); assert.equal(run.writes.filter(write => write.key === KEYS.journal).length, 2);
    assert.equal(run.calls.length, 1); assert.equal(run.notices.length, 1); noSecrets(run);
});
test('NIO metadata control: failed recheck does not invent field metadata or change saved success', async () => {
    const c = clock(), store = partialStore(c), original = confirmed(store);
    const run = await nio({ type: 'cron', clock: c, store, responses: [{ status: 500, data: 'PRIVATE_SERVER_FAILURE' }] });
    assert.deepEqual(confirmed(store), original); assert.equal(run.calls.length, 1);
    assert.equal(run.writes.filter(write => write.key === KEYS.journal).length, 2); assert.equal(run.notices.length, 1);
    assert.equal(json(store, KEYS.state).invalid, false); assert.doesNotMatch(combined(run), /PRIVATE_SERVER_FAILURE/); noSecrets(run);
});
test('NIO metadata control: missing recheck fields never erase saved nonmissing diagnostics', async () => {
    const c = clock(), store = partialStore(c, { ...fieldTypes(), 'stats.continuous_checkin_days': 'number', 'stats.accumulate_days': 'array' });
    const original = confirmed(store);
    const run = await nio({ type: 'cron', clock: c, store, responses: [{ data: bodySuccess({ continuous_checkin_days: 3 }) }] });
    assert.deepEqual(confirmed(store), original); assert.equal(confirmed(store).fields['stats.accumulate_days'], 'array');
    assert.equal(run.calls.length, 1); assert.equal(run.writes.filter(write => write.key === KEYS.journal).length, 2); noSecrets(run);
});
