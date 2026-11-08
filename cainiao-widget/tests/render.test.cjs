const assert = require('node:assert/strict');
const { test } = require('node:test');

const NOW = new Date(2026, 10, 8, 14, 35).getTime();
const UPDATED = new Date(2026, 10, 8, 14, 20).getTime();
const FAMILIES = ['systemSmall', 'systemMedium', 'systemLarge', 'systemExtraLarge', 'accessoryCircular', 'accessoryRectangular', 'accessoryInline'];
const STATES = ['setup', 'expired', 'offline', 'verify', 'partial', 'error'];
const LABELS = ['尚未连接', '登录过期', '连接失败', '需安全验证', '数据未取全', '更新失败'];
const modulePromise = import('../render.mjs');
const sample = (extra = {}) => ({
  status: 'ready', total: 11, updatedAt: UPDATED, refreshMinutes: 15,
  items: Array.from({ length: 11 }, (_, index) => ({
    id: `synthetic-${index}`, code: `88-${index + 1}-2026`, company: '中通快递', tail: `${7800 + index}`,
    station: `合成驿站${index + 1}号`, requiresVerification: false,
  })), ...extra,
});
const walk = (node) => [node, ...(node.children || []).flatMap(walk)];
const texts = (node) => walk(node).filter((item) => item.type === 'text').map((item) => item.text);
const joined = (node) => texts(node).join('|');

test('七种尺寸仅生成官方支持的 DSL 字段，且点击统一进入官方网页', async () => {
  const { renderWidget } = await modulePromise;
  const allowed = {
    widget: ['type', 'children', 'url', 'refreshAfter', 'padding', 'gap', 'backgroundColor', 'backgroundGradient'],
    stack: ['type', 'direction', 'alignItems', 'children', 'flex', 'gap', 'padding', 'borderRadius', 'backgroundColor', 'borderWidth', 'borderColor'],
    text: ['type', 'text', 'font', 'textColor', 'maxLines', 'minScale', 'flex', 'textAlign'],
    image: ['type', 'src', 'width', 'height', 'color'],
    spacer: ['type', 'length'],
  };
  for (const family of FAMILIES) {
    const tree = renderWidget(sample(), family, NOW);
    assert.equal(tree.type, 'widget');
    assert.equal(tree.url, 'https://page.cainiao.com/guoguo/app-myexpress-taobao/');
    assert.equal(tree.refreshAfter, new Date(NOW + 15 * 60000).toISOString());
    for (const node of walk(tree)) {
      assert.ok(allowed[node.type], `不支持的元素 ${node.type}`);
      for (const key of Object.keys(node)) assert.ok(allowed[node.type].includes(key), `${node.type}.${key}`);
      if (node.type === 'stack') {
        assert.ok(['row', 'column'].includes(node.direction));
        assert.ok(['start', 'center', 'end'].includes(node.alignItems));
      }
    }
  }
});

test('桌面依次显示一、二、四、八件，并明确标出未展示数量', async () => {
  const { renderWidget } = await modulePromise;
  for (const [family, capacity] of [['systemSmall', 1], ['systemMedium', 2], ['systemLarge', 4], ['systemExtraLarge', 8]]) {
    const tree = renderWidget(sample(), family, NOW);
    const codeTexts = texts(tree).filter((value) => value.startsWith('88-'));
    assert.equal(codeTexts.length, capacity, family);
    assert.ok(joined(tree).includes(`还有${11 - capacity}件`));
    assert.ok(joined(tree).includes('11件'));
    assert.ok(!joined(tree).includes(`合成驿站${capacity + 1}号`));
  }
});

test('锁屏默认隐藏凭据，仅 privacy=false 时显示，privacy=true 对桌面也生效', async () => {
  const { renderWidget } = await modulePromise;
  const model = sample();
  for (const family of FAMILIES.filter((value) => value.startsWith('accessory'))) {
    for (const privacy of [undefined, true, 'false', 0]) {
      const text = joined(renderWidget({ ...model, privacy }, family, NOW));
      assert.ok(!text.includes(model.items[0].code), family);
      assert.match(text, /隐藏/);
    }
    assert.ok(joined(renderWidget({ ...model, privacy: false }, family, NOW)).includes(model.items[0].code));
  }
  for (const family of FAMILIES) {
    const tree = renderWidget({ ...model, privacy: true }, family, NOW);
    for (const item of model.items) assert.ok(!JSON.stringify(tree).includes(item.code), family);
  }
});

test('所有状态在七种尺寸均保留，失败缓存显示原更新时间', async () => {
  const { renderWidget } = await modulePromise;
  for (const [index, status] of STATES.entries()) {
    for (const family of FAMILIES) {
      const output = renderWidget(sample({ status, message: '合成诊断提示' }), family, NOW);
      const text = joined(output);
      assert.ok(text.includes(LABELS[index]), `${status}/${family}`);
      if (['systemLarge', 'systemExtraLarge'].includes(family)) assert.ok(text.includes('合成诊断提示'), `${status}/${family}`);
      assert.ok(text.includes('14:20'), `${status}/${family}`);
      assert.ok(!text.includes('14:35'), `${status}/${family}`);
      assert.match(text, /缓存/, `${status}/${family}`);
      assert.ok(!text.includes('没有待取包裹'));
    }
  }
});

test('失败且无缓存不会显示为零件成功态，空列表成功态明确显示无待取', async () => {
  const { renderWidget } = await modulePromise;
  for (const family of FAMILIES) {
    const ready = joined(renderWidget(sample({ items: [], total: 0 }), family, NOW));
    assert.match(ready, /没有待取|暂无待取/);
    const failed = joined(renderWidget(sample({ status: 'expired', items: [], total: 0, updatedAt: null }), family, NOW));
    assert.match(failed, /登录过期|重新登录/);
    assert.match(failed, /尚未更新/);
    assert.doesNotMatch(failed, /没有待取|暂无待取/);
  }
});

test('部分结果保持至少语义，不把未知完整数当成准确总量', async () => {
  const { renderWidget } = await modulePromise;
  for (const family of FAMILIES) {
    const output = joined(renderWidget(sample({ partial: true, total: 1, items: sample().items.slice(0, 3) }), family, NOW));
    assert.match(output, family === 'accessoryCircular' ? /≥3/ : /至少3/);
    assert.match(output, /数据未取全/);
  }
});

test('验证哨兵和缺码有独立提示，不把伪码显示成可取凭据', async () => {
  const { renderWidget } = await modulePromise;
  for (const code of ['needSms', 'NEED_SMS', '0', '-1', 'null', 'none', 'false']) {
    const output = renderWidget(sample({ total: 1, items: [{ code, station: '合成驿站' }] }), 'systemSmall', NOW);
    assert.match(joined(output), /需短信验证/);
    assert.ok(!texts(output).includes(code));
  }
  const forced = renderWidget(sample({ total: 1, items: [{ code: '99-88-77', requiresVerification: true }] }), 'systemSmall', NOW);
  assert.match(joined(forced), /需短信验证/);
  assert.ok(!JSON.stringify(forced).includes('99-88-77'));
  assert.match(joined(renderWidget(sample({ total: 1, items: [{ code: '' }] }), 'systemSmall', NOW)), /暂无取件码/);
});

test('长驿站独占可截断文本行，超长码换行但保留全部字符', async () => {
  const { renderWidget } = await modulePromise;
  const code = 'PICKUP-20261108-00881234567890';
  const station = '合成城市合成大学研究生公寓西门商业街菜鸟驿站二号服务点';
  const tree = renderWidget(sample({ total: 1, items: [{ code, station, company: '合成快递', tail: '8801' }] }), 'systemSmall', NOW);
  const nodes = walk(tree).filter((node) => node.type === 'text');
  const stationNode = nodes.find((node) => node.text === station);
  const codeNode = nodes.find((node) => node.text.replace(/\n/g, '') === code);
  assert.ok(stationNode);
  assert.equal(stationNode.maxLines, 1);
  assert.ok(codeNode);
  assert.equal(codeNode.maxLines, 2);
  assert.ok(codeNode.font.size > stationNode.font.size);
  assert.ok(codeNode.minScale < 1);
});

test('过旧快照在所有尺寸提醒，不使用当前时间冒充更新时间', async () => {
  const { renderWidget } = await modulePromise;
  for (const family of FAMILIES) {
    const text = joined(renderWidget(sample({ updatedAt: UPDATED - 86400000 }), family, NOW));
    assert.match(text, /数据较旧/);
    assert.match(text, /11\/07 14:20/);
    assert.match(text, /缓存/);
  }
});

test('浅深配色自适应，未知尺寸安全回退，不修改输入模型', async () => {
  const { renderWidget } = await modulePromise;
  const model = sample({ refreshMinutes: 'bad' });
  const original = JSON.stringify(model);
  const tree = renderWidget(model, 'unsupported', NOW);
  assert.deepEqual(tree, renderWidget(model, 'systemSmall', NOW));
  assert.equal(JSON.stringify(model), original);
  assert.ok(tree.backgroundColor.light);
  assert.ok(tree.backgroundColor.dark);
  assert.equal(tree.refreshAfter, new Date(NOW + 15 * 60000).toISOString());
});

test('当前查询成功但有非空提示时也展示，不冒充旧缓存或丢失提示', async () => {
  const { renderWidget } = await modulePromise;
  for (const family of FAMILIES) {
    const text = joined(renderWidget(sample({ message: '缓存保存失败，请稍后重试' }), family, NOW));
    assert.match(text, /缓存保存失败/);
    assert.doesNotMatch(text, /旧数据|历史数据|缓存 11/);
    assert.match(text, /更新/);
  }
});

test('离线预览接收实际 DSL，转义外来文本，保持取件码和隐私结果一致', async () => {
  const { renderWidget } = await modulePromise;
  const { renderDslToHtml } = await import('../preview.mjs');
  const model = sample({ total: 1, items: [{ code: '86-2-3108', station: '<script>合成文本</script>' }] });
  const visible = renderDslToHtml(renderWidget(model, 'systemSmall', NOW));
  assert.ok(visible.includes('86-2-3108'));
  assert.ok(visible.includes('&lt;script&gt;'));
  assert.ok(!visible.includes('<script>合成文本</script>'));
  const hidden = renderDslToHtml(renderWidget({ ...model, privacy: true }, 'systemSmall', NOW));
  assert.ok(!hidden.includes('86-2-3108'));
  assert.match(hidden, /取件码已隐藏/);
  assert.match(hidden, /合成数据 · 离线预览/);
});

test('关闭连接与本机存储异常的标题不再引导用户重新登录', async () => {
  const { renderWidget } = await modulePromise;
  for (const family of ['systemSmall', 'systemMedium', 'systemLarge', 'systemExtraLarge', 'accessoryRectangular']) {
    for (const setupTitle of ['连接已关闭', '检查 Egern 存储', '填写手动登录参数', '刷新小组件']) {
      const text = joined(renderWidget(sample({ status: 'setup', items: [], total: 0, updatedAt: null, setupTitle, message: '合成状态说明' }), family, NOW));
      assert(text.includes(setupTitle), `${family}: ${setupTitle}`);
      assert(!text.includes('先打开手机查件页'));
    }
  }
});
