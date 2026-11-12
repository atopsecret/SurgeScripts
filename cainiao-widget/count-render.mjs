// 引擎：Egern 原生小组件 DSL | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：模块主脚本设置 CW_COUNT_ONLY=true；离线 node --test cainiao-widget/tests/count-render.test.cjs
// 依赖：无；只读已校验总数、状态和更新时间，不读取包裹明细。

const CWC_COLORS = {
  background: {light: '#FFF9F1', dark: '#201A15'},
  end: {light: '#FFF1E0', dark: '#2B2119'},
  text: {light: '#34271D', dark: '#FFF4E8'},
  muted: {light: '#957E69', dark: '#C4AC96'},
  accent: {light: '#D66C25', dark: '#FFB575'},
  tile: {light: '#FFE8D0', dark: '#47301E'},
  warning: {light: '#A56425', dark: '#F2C18A'},
  warningTile: {light: '#F6E7D3', dark: '#423426'},
};
const CWC_DESKTOP = {
  systemSmall: {padding: 14, size: 65, icon: 25},
  systemMedium: {padding: 13, size: 52, icon: 30},
  systemLarge: {padding: 21, size: 106, icon: 49},
  systemExtraLarge: {padding: 23, size: 112, icon: 58},
};
const CWC_LABELS = {
  setup: '尚未连接', expired: '连接已过期', offline: '暂时离线',
  verify: '需要验证', partial: '数量未取全', error: '更新失败',
};

function cwcText(text, size, color = CWC_COLORS.text, extra = {}) {
  return {type: 'text', text: String(text), font: {size, weight: 'regular'}, textColor: color,
    maxLines: 1, minScale: 0.8, ...extra};
}
function cwcStack(direction, children, extra = {}) {
  return {type: 'stack', direction, alignItems: 'start', children, ...extra};
}
function cwcIcon(symbol, size, color = CWC_COLORS.accent) {
  return {type: 'image', src: 'sf-symbol:' + symbol, width: size, height: size, color};
}
function cwcTime(value) {
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 ? time : null;
}
function cwcClock(time, now, forceDate = false) {
  if (time === null) return '尚未更新';
  const date = new Date(time), today = new Date(now), pad = value => String(value).padStart(2, '0');
  const clock = pad(date.getHours()) + ':' + pad(date.getMinutes());
  return forceDate || date.toDateString() !== today.toDateString()
    ? pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + clock : clock;
}
function cwcContext(model, now) {
  const input = model && typeof model === 'object' ? model : {};
  const current = Number.isFinite(now) ? now : Date.now();
  const status = input.status === 'ready' || Object.hasOwn(CWC_LABELS, input.status) ? input.status : 'error';
  const refresh = Number(input.refreshMinutes);
  const minutes = Number.isFinite(refresh) && refresh >= 5 ? Math.min(120, refresh) : 15;
  const suppliedTime = cwcTime(input.updatedAt);
  const updatedAt = suppliedTime !== null && suppliedTime <= current + 60000 ? suppliedTime : null;
  const total = Number.isSafeInteger(input.total) && input.total >= 0 && input.total <= 1000000 ? input.total : null;
  const partial = status === 'partial' || input.partial === true;
  const known = status !== 'setup' && updatedAt !== null && total !== null;
  const stale = status === 'ready' && updatedAt !== null && current - updatedAt > Math.max(60, minutes * 3) * 60000;
  const warning = status !== 'ready' || partial || stale || !known;
  const cached = known && (status !== 'ready' && !partial || stale);
  const label = stale ? '数据较旧' : partial ? CWC_LABELS.partial : status === 'ready' && !known ? '等待更新' : CWC_LABELS[status] || '';
  const number = known ? (partial ? '≥' : '') + total : '—';
  const empty = known && total === 0 && !partial;
  const caption = !known ? (status === 'setup' ? '等待首次连接' : '等待更新')
    : empty ? (cached ? '上次无待取' : '暂无待取') : cached ? '上次待取' : partial ? '至少待取' : '待取包裹';
  return {now: current, status, updatedAt, total, known, partial, stale, warning, cached, label, number, empty, caption,
    stamp: updatedAt === null ? '尚未更新' : (cached ? '上次 ' : '更新 ') + cwcClock(updatedAt, current, cached),
    refreshAfter: new Date(current + minutes * 60000).toISOString()};
}
function cwcHeader(context, small) {
  return cwcStack('row', [
    cwcIcon('shippingbox.fill', small ? 13 : 15),
    cwcText('菜鸟取件', small ? 10 : 12, CWC_COLORS.text, {font: {size: small ? 10 : 12, weight: 'semibold'}}),
    {type: 'spacer'},
    ...(context.warning ? [cwcText(context.label, small ? 9 : 10, CWC_COLORS.warning,
      {font: {size: small ? 9 : 10, weight: 'medium'}, minScale: 0.65})] : []),
  ], {alignItems: 'center', gap: 5});
}
function cwcFooter(context, small) {
  return cwcStack('row', [
    cwcIcon('clock', small ? 8 : 9, CWC_COLORS.muted),
    cwcText(context.stamp, small ? 8 : 9, CWC_COLORS.muted, {minScale: 0.75}),
  ], {alignItems: 'center', gap: 4});
}
function cwcEmpty(context, options, small, medium) {
  if (medium) return cwcStack('column', [
    {type: 'spacer'},
    cwcStack('row', [
      cwcStack('row', [cwcIcon(context.cached ? 'shippingbox' : 'checkmark', 26)], {
        padding: 10, borderRadius: 17, backgroundColor: CWC_COLORS.tile,
      }),
      cwcText(context.caption, 21, CWC_COLORS.text, {font: {size: 21, weight: 'semibold'}}),
    ], {gap: 13, alignItems: 'center'}),
    {type: 'spacer'},
  ], {flex: 1});
  return cwcStack('column', [
    {type: 'spacer'},
    cwcStack('row', [cwcIcon(context.cached ? 'shippingbox' : 'checkmark', options.icon)], {
      padding: small ? 8 : 12, borderRadius: small ? 14 : 20, backgroundColor: CWC_COLORS.tile,
    }),
    cwcText(context.caption, small ? 16 : 22, CWC_COLORS.text, {
      font: {size: small ? 16 : 22, weight: 'semibold'}, minScale: 0.8,
    }),
    {type: 'spacer'},
  ], {flex: 1, gap: small ? 8 : 12});
}
function cwcNumber(context, options, small, medium) {
  const color = context.warning ? CWC_COLORS.warning : CWC_COLORS.accent;
  const size = context.number.length > 4 ? Math.floor(options.size * 0.75) : options.size;
  const number = cwcText(context.number, size, color, {font: {size, weight: 'bold'}, minScale: 0.42});
  if (small) return cwcStack('column', [
    {type: 'spacer'}, number,
    cwcText(context.caption, 10, CWC_COLORS.muted, {font: {size: 10, weight: 'medium'}}),
    {type: 'spacer'},
  ], {flex: 1, gap: 1});
  const labelSize = medium ? 12 : 16;
  const count = cwcStack('column', [number, cwcText(context.caption, labelSize, CWC_COLORS.muted,
    {font: {size: labelSize, weight: 'medium'}})], {flex: 1, gap: medium ? 0 : 4});
  const tile = cwcStack('column', [cwcIcon(context.known ? 'shippingbox.fill' : 'arrow.clockwise', options.icon, color)], {
    padding: medium ? 14 : 22, borderRadius: medium ? 20 : 29,
    backgroundColor: context.warning ? CWC_COLORS.warningTile : CWC_COLORS.tile,
  });
  return cwcStack('column', [{type: 'spacer'}, cwcStack('row', [count, tile], {
    alignItems: 'center', gap: medium ? 16 : 24,
  }), {type: 'spacer'}], {flex: 1});
}
function cwcDesktop(context, family) {
  const options = CWC_DESKTOP[family], small = family === 'systemSmall', medium = family === 'systemMedium';
  return {type: 'widget', refreshAfter: context.refreshAfter, backgroundColor: CWC_COLORS.background,
    backgroundGradient: {type: 'linear', colors: [CWC_COLORS.background, CWC_COLORS.end],
      startPoint: {x: 0, y: 0}, endPoint: {x: 1, y: 1}},
    padding: options.padding, gap: small ? 5 : medium ? 6 : 8,
    children: [cwcHeader(context, small),
      context.empty ? cwcEmpty(context, options, small, medium) : cwcNumber(context, options, small, medium),
      cwcFooter(context, small)]};
}
function cwcLock(context, family) {
  const color = context.warning ? CWC_COLORS.warning : CWC_COLORS.accent;
  if (family === 'accessoryInline') {
    const value = context.empty ? context.caption : context.known ? context.number + '件待取' : '待更新';
    const warning = context.warning ? ' · ' + context.label : '';
    return {type: 'widget', refreshAfter: context.refreshAfter, padding: 0, children: [
      cwcText('菜鸟 · ' + value + warning + ' · ' + context.stamp, 11, color, {minScale: 0.5}),
    ]};
  }
  if (family === 'accessoryCircular') {
    return {type: 'widget', refreshAfter: context.refreshAfter, padding: 3, gap: 1, children: [
      cwcText(context.warning ? context.label : '菜鸟待取', 8, color, {textAlign: 'center', minScale: 0.6}),
      cwcText(context.empty ? context.caption : context.number, context.empty ? 11 : 23, color, {
        textAlign: 'center', font: {size: context.empty ? 11 : 23, weight: 'bold'}, minScale: 0.4,
      }),
      cwcText(context.stamp, 6.5, CWC_COLORS.muted, {textAlign: 'center', minScale: 0.4}),
    ]};
  }
  return {type: 'widget', refreshAfter: context.refreshAfter, padding: 3, gap: 2, children: [
    cwcStack('row', [cwcIcon('shippingbox.fill', 10, color),
      cwcText(context.warning ? context.label : '菜鸟取件', 10, color, {font: {size: 10, weight: 'semibold'}})], {gap: 4, alignItems: 'center'}),
    cwcText(context.empty ? context.caption : context.known ? context.number + ' 件待取' : '等待更新', 20, color,
      {font: {size: 20, weight: 'bold'}, minScale: 0.6}),
    cwcText(context.stamp, 8, CWC_COLORS.muted, {minScale: 0.7}),
  ]};
}

export function renderCountWidget(model, family = 'systemSmall', now = Date.now()) {
  const chosen = Object.hasOwn(CWC_DESKTOP, family) || ['accessoryCircular', 'accessoryRectangular', 'accessoryInline'].includes(family)
    ? family : 'systemSmall';
  const context = cwcContext(model, now);
  return chosen.startsWith('accessory') ? cwcLock(context, chosen) : cwcDesktop(context, chosen);
}
