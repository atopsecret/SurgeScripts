// 引擎：Node.js 20+ 内置测试 | 语言：JavaScript CommonJS
// Build: node cainiao-widget/build.mjs
// Run: node --experimental-vm-modules --test --test-timeout=60000 cainiao-widget/tests/count-render.test.cjs
// Deps: 内置库与合成内存夹具；实际 bundle，禁止真实网络。
const {test, before, after, mock} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {headers} = require('./auth-fixture.cjs');

const NOW = Date.UTC(2026, 10, 11, 4, 20);
const UPDATED = NOW - 5 * 60000;
const FAMILIES = ['systemSmall', 'systemMedium', 'systemLarge', 'systemExtraLarge', 'accessoryCircular', 'accessoryRectangular', 'accessoryInline'];
const SOURCE = fs.readFileSync(path.join(__dirname, '../cainiao-widget.egern.js'), 'utf8');
const STORE = 'cainiao-widget.official.v1';
const RPC = 'https://guoguouser.cainiao.com/com.cainiao.guoguo.guoguouser.widget.WidgetLogisticsService/1.0.0/queryWidgetDetailsV2';
const TOKEN = 'synthetic-count-bearer-A';
const ARG = 'com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest';
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const texts = node => walk(node).filter(part => part.type === 'text').map(part => part.text);
const joined = node => texts(node).join('|');
const model = (extra = {}) => ({status: 'ready', total: 7, updatedAt: UPDATED, refreshMinutes: 15, coverage: 'official_summary', ...extra});
let render, externalNetwork = 0;

before(async () => {
  const deny = () => {externalNetwork++; throw new Error('数量组件测试禁止真实网络');};
  for (const name of ['node:http', 'node:https']) {
    const module = require(name);
    for (const method of ['get', 'request']) mock.method(module, method, deny);
  }
  mock.method(require('node:net').Socket.prototype, 'connect', deny);
  mock.method(require('node:tls'), 'connect', deny);
  if (typeof globalThis.fetch === 'function') mock.method(globalThis, 'fetch', deny);
  render = (await import('../count-render.mjs')).renderCountWidget;
});
after(() => {mock.restoreAll(); assert.equal(externalNetwork, 0);});

test('七种尺寸仅显示权威total，不读取或泄漏任何包裹明细', () => {
  const value = model({privacy: false});
  Object.defineProperty(value, 'items', {get() {throw new Error('数量布局不得读取items');}});
  for (const family of FAMILIES) {
    const widget = render(value, family, NOW), text = joined(widget);
    assert.match(text, /7/);
    assert.doesNotMatch(text, /官方|摘要|详情|取件码|还有/);
    assert.equal(widget.refreshAfter, new Date(NOW + 15 * 60000).toISOString());
  }
});

test('只有成功且有有效更新时间的真实零值才显示暂无待取', () => {
  for (const family of FAMILIES) {
    const success = joined(render(model({total: 0}), family, NOW));
    assert.match(success, /暂无待取/);
    assert.doesNotMatch(success, /0件|待更新|上次/);
    for (const status of ['setup', 'expired', 'offline', 'verify', 'error']) {
      const failure = joined(render(model({status, total: 0, updatedAt: null}), family, NOW));
      assert.doesNotMatch(failure, /暂无待取|0件|0 件/);
      assert.match(failure, /尚未更新/);
    }
  }
});

test('失败缓存和过旧零值保留原时间与上次语义，不能呈现当前零值成功', () => {
  const old = UPDATED - 86400000;
  const stamp = new Date(old), pad = value => String(value).padStart(2, '0');
  const expected = `${pad(stamp.getMonth() + 1)}/${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
  for (const family of FAMILIES) {
    const expired = joined(render(model({status: 'expired', updatedAt: old, total: 4}), family, NOW));
    assert.match(expired, /连接已过期/); assert.match(expired, /4/);
    assert(expired.includes(expected)); assert.match(expired, /上次/);
    const stale = joined(render(model({updatedAt: old, total: 0}), family, NOW));
    assert.match(stale, /数据较旧/); assert.match(stale, /上次无待取/);
    assert.doesNotMatch(stale, /暂无待取/); assert(stale.includes(expected));
  }
});

test('未知或非法总量、无有效成功时间不能被转换为零', () => {
  for (const total of [undefined, null, '0', NaN, -1, 1.2, 1000001]) {
    for (const family of FAMILIES) {
      const text = joined(render(model({total}), family, NOW));
      assert.doesNotMatch(text, /暂无待取|0件|0 件/); assert.match(text, /等待更新/);
    }
  }
  for (const updatedAt of [null, 'bad', NOW + 60001]) {
    assert.doesNotMatch(joined(render(model({total: 0, updatedAt}), 'systemSmall', NOW)), /暂无待取/);
  }
});

test('部分结果使用至少语义且不以已到达的明细数替换total', () => {
  for (const family of FAMILIES) {
    const widget = render(model({partial: true, total: 12, items: Array.from({length: 2})}), family, NOW);
    assert.match(joined(widget), /≥12/); assert.match(joined(widget), /数量未取全/);
  }
});

test('布局仅用宿主支持的DSL，浅深颜色自适应，未知尺寸回退且不改变输入', () => {
  const allowed = {
    widget: ['type', 'refreshAfter', 'backgroundColor', 'backgroundGradient', 'padding', 'gap', 'children'],
    stack: ['type', 'direction', 'alignItems', 'children', 'padding', 'borderRadius', 'backgroundColor', 'gap', 'flex'],
    image: ['type', 'src', 'width', 'height', 'color'],
    text: ['type', 'text', 'font', 'textColor', 'maxLines', 'minScale', 'textAlign'],
    spacer: ['type'],
  };
  const value = model(), original = JSON.stringify(value);
  for (const family of FAMILIES) for (const total of [0, 1, 9999, 1000000]) {
    const tree = render({...value, total}, family, NOW);
    for (const node of walk(tree)) {
      assert(allowed[node.type]);
      for (const key of Object.keys(node)) assert(allowed[node.type].includes(key), node.type + '.' + key);
    }
    if (family.startsWith('system')) {assert(tree.backgroundColor.light); assert(tree.backgroundColor.dark);}
  }
  assert.deepEqual(render(value, 'unknown', NOW), render(value, 'systemSmall', NOW));
  assert.equal(JSON.stringify(value), original);
});

async function fixture() {
  const memory = new Map(), requests = [], replies = [];
  let now = NOW;
  const context = vm.createContext({Uint8Array, ArrayBuffer, URL, setTimeout, clearTimeout, clock: () => now, console: {log() {}}});
  vm.runInContext('Date.now = () => clock();', context);
  const module = new vm.SourceTextModule(SOURCE, {context});
  await module.link(() => {throw new Error('数量bundle不得包含外部导入');}); await module.evaluate();
  const ctx = {env: {CONNECTION_MODE: 'auto', CW_COUNT_ONLY: 'true'}, widgetFamily: 'systemSmall', storage: {
    getJSON: key => structuredClone(memory.get(key) ?? null),
    setJSON: (key, value) => memory.set(key, structuredClone(value)),
  }, http: {}};
  for (const method of ['get', 'post']) ctx.http[method] = async (url, options) => {
    requests.push({method, url, options}); const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error('synthetic-count-offline');
    return reply;
  };
  return {ctx, entry: module.namespace.default, memory, requests, replies, advance: ms => {now += ms;}};
}
function reply(total) {
  return {status: 200, headers: headers([['Content-Type', 'application/json']]), text: async () => JSON.stringify({success: true, code: 0, data: {
    packageInfo: {agentSignPackNum: total, packageItemInfoList: [{logisticsStatus: 900, logisticsStatusSimpleDesc: 'synthetic-private-code-2-91',
      stationName: 'synthetic-private-station', mailNo: 'synthetic-private-mail'}]},
  }})};
}
async function bind(f) {
  const body = {argsTypes: [ARG], argsObjs: {}};
  body.argsObjs = [{appName: 'GUOGUO_APP', source: 'synthetic-count-ios', channel: 'synthetic-count-channel',
    installStatus: JSON.stringify({isLargeInstall: false, isMediumInstall: true, isSmallInstall: false, isNewSmallInstall: false, isLargeV2Install: false}),
    version: 2, ext: '{"apiVersion":"V3"}', token: TOKEN, timestamp: NOW - 1000}];
  const raw = new TextEncoder().encode(JSON.stringify(body));
  const returned = await f.entry({...f.ctx, request: {method: 'POST', url: RPC, headers: headers([['Content-Type', 'application/json']]),
    arrayBuffer: async () => raw}});
  assert.deepEqual(Buffer.from(returned.body), Buffer.from(raw));
}

test('实际COUNT_ONLY入口无专用状态时不借手动Cookie或旧H5回退', async () => {
  const f = await fixture();
  const current = await f.entry({...f.ctx, env: {...f.ctx.env, CAINIAO_COOKIE: 'cookie2=synthetic-cookie; unb=900000001'}});
  assert.equal(f.requests.length, 0); assert.match(joined(current), /等待首次连接/); assert.doesNotMatch(joined(current), /暂无待取/);
  assert.equal(f.memory.size, 0);
});

test('实际COUNT_ONLY跨两次无hook的新POST更新总量，所有尺寸不输出摘要及私人值', async () => {
  const f = await fixture(); await bind(f);
  for (const total of [8, 3]) {
    f.replies.push(reply(total)); const widget = await f.entry(f.ctx);
    assert(texts(widget).includes(String(total))); assert.equal(f.memory.get(STORE).snapshot.total, total);
    assert.equal(f.memory.get(STORE).snapshot.items.length, 1);
    assert.doesNotMatch(JSON.stringify(widget), /synthetic-private|synthetic-count-bearer|官方|摘要|详情|取件码/);
    f.advance(60000);
  }
  assert.equal(f.requests.length, 2); assert.equal(f.memory.get(STORE).successCount, 2);
  assert(f.requests.every(row => row.method === 'post' && row.url === RPC));
  const times = f.requests.map(row => JSON.parse(row.options.body).argsObjs[0].timestamp);
  assert(times[1] > times[0]);
  for (const family of FAMILIES) {
    f.replies.push(reply(9)); const widget = await f.entry({...f.ctx, widgetFamily: family});
    assert.match(joined(widget), /9/); assert.doesNotMatch(JSON.stringify(widget), /synthetic-private|synthetic-count-bearer/);
  }
});

test('实际COUNT_ONLY新查询失败不伪造成功零值，有缓存时保留旧数量和时间', async () => {
  const f = await fixture(); await bind(f);
  const failed = await f.entry(f.ctx); assert.doesNotMatch(joined(failed), /暂无待取/); assert.match(joined(failed), /尚未更新/);
  f.replies.push(reply(8)); await f.entry(f.ctx);
  const timestamp = f.memory.get(STORE).snapshot.updatedAt;
  f.advance(60000); const cached = await f.entry(f.ctx);
  assert.match(joined(cached), /8/); assert.match(joined(cached), /上次/); assert.match(joined(cached), /暂时离线/);
  assert.equal(f.memory.get(STORE).snapshot.updatedAt, timestamp);
});

test('实际COUNT_ONLY缺省连接开关仍按auto接入并独立刷新', async () => {
  const f = await fixture(); delete f.ctx.env.CONNECTION_MODE;
  await bind(f); f.replies.push(reply(5));
  const widget = await f.entry(f.ctx);
  assert(texts(widget).includes('5'));
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].method, 'post'); assert.equal(f.requests[0].url, RPC);
  assert.equal(f.memory.get(STORE).status, 'ready'); assert.equal(f.memory.get(STORE).successCount, 1);
});

test('1.3.6已连接状态与屏障原位升级后直接新查询，不重新采集或清撤销记录', async () => {
  const f = await fixture(); await bind(f); f.replies.push(reply(5)); await f.entry(f.ctx);
  const previous = structuredClone(f.memory.get(STORE));
  previous.version = '1.3.6'; f.memory.set(STORE, previous);
  const barrier = structuredClone(f.memory.get('cainiao-widget.local.v1'));
  barrier.version = '1.3.6'; f.memory.set('cainiao-widget.local.v1', barrier);
  const revokedKey = 'cainiao-widget.official.revoked.v1.' + 'a'.repeat(32);
  f.memory.set(revokedKey, 'REVOKED_V1');
  f.advance(60000); f.replies.push(reply(2));
  const widget = await f.entry(f.ctx), current = f.memory.get(STORE);
  assert(texts(widget).includes('2')); assert.doesNotMatch(joined(widget), /尚未连接|等待首次连接/);
  assert.equal(current.version, '1.4.0'); assert.equal(current.token, previous.token);
  for (const key of ['owner', 'generation', 'tokenAt', 'templateAt']) assert.equal(current[key], previous[key], key);
  assert.equal(current.successCount, previous.successCount + 1);
  assert.equal(f.requests.length, 2); assert.equal(f.memory.get(revokedKey), 'REVOKED_V1');
  assert.notEqual(current.snapshot.updatedAt, previous.snapshot.updatedAt);
});

test('实际COUNT_ONLY尊重off，不发查询并保留永久撤销和原clear合同', async () => {
  const f = await fixture(); await bind(f); f.replies.push(reply(5)); await f.entry(f.ctx);
  const currentTokenHash = f.memory.get(STORE).tokenHash;
  f.memory.set('synthetic-other-app', {keep: true});
  const before = f.requests.length;
  const widget = await f.entry({...f.ctx, env: {...f.ctx.env, CONNECTION_MODE: 'off'}});
  assert.equal(f.requests.length, before); assert.equal(f.memory.get(STORE), null);
  assert.equal(f.memory.get('cainiao-widget.official.revoked.v1.' + currentTokenHash), 'REVOKED_V1');
  assert.deepEqual(f.memory.get('synthetic-other-app'), {keep: true});
  assert.doesNotMatch(joined(widget), /暂无待取|5/);
  await bind(f);
  assert.equal(f.memory.get(STORE), null);
  const again = await f.entry(f.ctx);
  assert.equal(f.requests.length, before); assert.doesNotMatch(joined(again), /暂无待取/);
});
