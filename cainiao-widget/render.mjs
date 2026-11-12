// 引擎：Egern 原生小组件 DSL | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：由 runtime.mjs 调用 renderWidget；离线 node --test cainiao-widget/tests/render.test.cjs
// 依赖：无；不依赖浏览器或第三方运行库，不伪造 App 点击链接

const CNW_COLORS = {
  background: { light: '#F4F7FE', dark: '#0C1527' },
  backgroundEnd: { light: '#EAF1FF', dark: '#13233C' },
  card: { light: '#FFFFFF', dark: '#17253D' },
  border: { light: '#DDE7F8', dark: '#2A3C58' },
  primary: { light: '#162A46', dark: '#F0F6FF' },
  secondary: { light: '#64758D', dark: '#A6B7D0' },
  accent: { light: '#2364E6', dark: '#86B2FF' },
  accentBackground: { light: '#E2EDFF', dark: '#243D65' },
  warning: { light: '#92530A', dark: '#FFD191' },
  warningBackground: { light: '#FFF0D6', dark: '#3A2C1D' },
};
const CNW_FAMILIES = {
  systemSmall: { capacity: 1, columns: 1, padding: 14, codeSize: 33 },
  systemMedium: { capacity: 2, columns: 2, padding: 14, codeSize: 25 },
  systemLarge: { capacity: 4, columns: 2, padding: 16, codeSize: 29 },
  systemExtraLarge: { capacity: 8, columns: 4, padding: 16, codeSize: 30 },
};
const CNW_STATES = {
  ready: { label: '待取包裹', title: '暂无待取' },
  setup: { label: '尚未连接', title: '先打开淘宝或菜鸟', detail: '刷新 App 快递列表后回到组件' },
  expired: { label: '会话失效', title: '重开 App 快递列表', detail: '重新接入后回到 Egern 刷新' },
  offline: { label: '连接失败', title: '暂时无法连接', detail: '稍后会自动重试' },
  verify: { label: '需安全验证', title: '请先完成验证', detail: '在淘宝或菜鸟完成验证后重试' },
  partial: { label: '数据未取全', title: '暂未取得完整列表', detail: '仅显示已确认的待取件' },
  error: { label: '更新失败', title: '更新没有完成', detail: '稍后会自动重试' },
};
const CNW_MISSING_DETAILS = '暂无包裹详情';

function cnwString(value) {
  return typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim() : '';
}

function cnwText(text, size, color = CNW_COLORS.primary, extra = {}) {
  return {
    type: 'text', text: String(text), font: { size, weight: 'regular' },
    textColor: color, maxLines: 1, minScale: 1, ...extra,
  };
}

function cnwStack(direction, children, extra = {}) {
  return { type: 'stack', direction, alignItems: 'start', children, ...extra };
}

function cnwIcon(name, size, color = CNW_COLORS.accent) {
  return { type: 'image', src: `sf-symbol:${name}`, width: size, height: size, color };
}

function cnwTimestamp(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cnwClock(timestamp, includeDate = true) {
  if (timestamp === null) return '尚未更新';
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return includeDate ? `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}` : time;
}

function cnwContext(model, family, now) {
  const input = model && typeof model === 'object' ? model : {};
  const status = Object.hasOwn(CNW_STATES, input.status) ? input.status : 'error';
  const items = Array.isArray(input.items) ? input.items.filter((item) => item && typeof item === 'object') : [];
  const requestedTotal = Number(input.total);
  const total = Math.max(items.length, Number.isFinite(requestedTotal) ? Math.max(0, Math.floor(requestedTotal)) : 0);
  const updatedAt = cnwTimestamp(input.updatedAt);
  const requestedRefresh = Number(input.refreshMinutes);
  const refreshMinutes = Number.isFinite(requestedRefresh) && requestedRefresh > 0
    ? Math.min(360, Math.max(5, requestedRefresh)) : 15;
  const time = Number.isFinite(now) ? now : Date.now();
  const stale = status === 'ready' && updatedAt !== null && time - updatedAt > Math.max(60, refreshMinutes * 3) * 60000;
  const partial = status === 'partial' || input.partial === true;
  const officialSummary = input.coverage === 'official_summary';
  const warning = status !== 'ready' || partial || stale;
  const state = partial && status === 'ready' ? CNW_STATES.partial : CNW_STATES[status];
  const label = stale ? '数据较旧' : state.label;
  const lock = family.startsWith('accessory');
  const hideCode = input.privacy === true || (lock && input.privacy !== false);
  return {
    status, items, total, updatedAt, refreshMinutes, time, stale, partial, officialSummary, warning, state, label,
    hideCode, message: cnwString(input.message), setupTitle: cnwString(input.setupTitle).slice(0, 32),
    cached: warning && (items.length > 0 || officialSummary && updatedAt !== null),
    count: `${partial ? '至少' : ''}${total}`,
    refreshAfter: new Date(time + refreshMinutes * 60000).toISOString(),
  };
}

function cnwCode(item, hideCode, officialSummary = false) {
  // 官方返回的是描述，不从数字猜码；锁屏默认连描述一起隐藏。
  if (officialSummary) return {
    text: hideCode ? '取件信息已隐藏' : (cnwString(item.summary) || '暂无取件信息'),
    usable: false, summary: true, private: hideCode,
  };
  if (hideCode) return { text: '取件码已隐藏', usable: false, private: true };
  const code = cnwString(item.code);
  const placeholder = /^(?:needsms|need_sms|-1|0|null|none|true|false)$/i.test(code);
  if (item.requiresVerification === true || placeholder) return { text: '需短信验证', usable: false, verification: true };
  return code ? { text: code, usable: true } : { text: '暂无取件码', usable: false };
}

// 超长码显式分两行，保留所有字符，不用省略号截掉凭据。
function cnwWrapCode(code) {
  if (code.length <= 18) return code;
  const middle = Math.ceil(code.length / 2);
  const cuts = [...code.matchAll(/-/g)].map((match) => match.index + 1);
  const nearby = cuts.filter((cut) => Math.abs(cut - middle) <= 3);
  const cut = nearby.length ? nearby.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0] : middle;
  return `${code.slice(0, cut)}\n${code.slice(cut)}`;
}

function cnwCodeNode(item, context, size, compact = false) {
  const code = cnwCode(item, context.hideCode, context.officialSummary);
  if (code.summary) return cnwText(code.text, compact ? 13 : 15, code.private ? CNW_COLORS.secondary : CNW_COLORS.primary, {
    font: { size: compact ? 13 : 15, weight: 'medium' }, maxLines: compact ? 2 : 3, minScale: 0.8,
  });
  const wrapped = code.usable ? cnwWrapCode(code.text) : code.text;
  const long = wrapped.includes('\n');
  const longest = Math.max(...wrapped.split('\n').map((part) => part.length));
  const fontSize = code.usable
    ? (long ? Math.max(12, Math.min(compact ? (context.warning ? 16 : 18) : 22, 320 / longest)) : size)
    : Math.min(size, compact ? 14 : 17);
  return cnwText(wrapped, fontSize, code.verification ? CNW_COLORS.warning : (code.usable ? CNW_COLORS.accent : CNW_COLORS.secondary), {
    font: { size: fontSize, weight: code.usable ? 'bold' : 'medium', ...(code.usable ? { family: 'Menlo' } : {}) },
    maxLines: long ? 2 : 1, minScale: code.usable ? 0.45 : 0.85,
  });
}

function cnwHeader(context, small, inlineNotice = false) {
  const count = context.warning && context.items.length === 0 && !context.cached ? '待更新' : `${context.count}${small ? '件' : '件待取'}`;
  const notice = inlineNotice && (context.warning || context.message);
  const title = notice ? (context.warning ? `${context.label}${context.cached ? ' · 旧数据' : ''}` : context.message) : '菜鸟取件';
  return cnwStack('row', [
    cnwIcon(notice ? 'exclamationmark.triangle.fill' : 'shippingbox.fill', small ? 14 : 16, notice ? CNW_COLORS.warning : CNW_COLORS.accent),
    cnwText(title, small || notice ? 11 : 13, notice ? CNW_COLORS.warning : CNW_COLORS.primary, {
      font: { size: small || notice ? 11 : 13, weight: 'semibold' }, ...(notice ? { flex: 1, minScale: 0.85 } : {}),
    }),
    ...(!notice ? [{ type: 'spacer' }] : []),
    cnwStack('row', [cnwText(count, small ? 10 : 11, CNW_COLORS.accent, {
      font: { size: small ? 10 : 11, weight: 'bold' }, minScale: 0.75,
    })], { padding: [3, 7, 3, 7], borderRadius: 8, backgroundColor: CNW_COLORS.accentBackground }),
  ], { alignItems: 'center', gap: small ? 4 : 6 });
}

function cnwBanner(context, small) {
  const cached = context.cached && context.status !== 'partial' && !context.partial;
  let detail = context.message.replace(/\s*·\s*上次结果\s*$/, '');
  if (context.status === 'expired') detail = detail.replace(/^(?:登录(?:已)?过期|小组件会话失效)[，,：:\s]*/, '');
  const text = !context.warning ? context.message
    : `${context.label}${cached ? (small ? ' · 旧数据' : ' · 历史数据') : ''}${detail && !small ? ` · ${detail}` : ''}`;
  return cnwStack('row', [
    cnwIcon('exclamationmark.triangle.fill', small ? 9 : 11, CNW_COLORS.warning),
    cnwText(text, small ? 9 : 10, CNW_COLORS.warning, { flex: 1, minScale: 0.8, font: { size: small ? 9 : 10, weight: 'semibold' } }),
  ], { alignItems: 'center', gap: 4, padding: [4, 6, 4, 6], borderRadius: 7, backgroundColor: CNW_COLORS.warningBackground });
}

function cnwItemCard(item, context, options, small) {
  const company = cnwString(item.company) || '快递';
  const tail = cnwString(item.tail);
  const station = cnwString(item.station) || '驿站待确认';
  const compact = options.capacity === 2;
  const detailSize = compact ? 9 : 10;
  const stationSize = compact ? 10 : 11;
  const details = [
    cnwCodeNode(item, context, options.codeSize, small || compact),
    cnwText(`${company}${tail ? ` · 尾号 ${tail}` : ''}`, detailSize, CNW_COLORS.secondary, { minScale: 0.85 }),
    cnwText(station, stationSize, CNW_COLORS.primary),
  ];
  const children = small ? [{ type: 'spacer' }, cnwStack('column', details, { gap: 3 }), { type: 'spacer' }]
    : [...details, { type: 'spacer' }];
  return cnwStack('column', children, {
    flex: 1, gap: small ? 0 : (compact ? 2 : 4),
    ...(small ? {} : {
      padding: compact ? [6, 9, 6, 9] : [13, 12, 13, 12],
      borderRadius: 13, backgroundColor: CNW_COLORS.card, borderWidth: 0.7, borderColor: CNW_COLORS.border,
    }),
  });
}

function cnwEmpty(context, small, tight = false) {
  const ready = context.status === 'ready' && !context.partial;
  const compact = tight || (small && context.warning);
  const hasCount = context.total > 0;
  const title = ready ? (hasCount ? `${context.total}件待取` : (context.stale ? '上次无待取' : CNW_STATES.ready.title))
    : (context.status === 'setup' && context.setupTitle ? context.setupTitle : context.state.title);
  const detail = ready ? (hasCount ? CNW_MISSING_DETAILS : '') : (context.message || context.state.detail);
  return cnwStack('column', [
    { type: 'spacer' },
    cnwIcon(ready ? (hasCount ? 'shippingbox.fill' : 'checkmark.circle')
      : (context.status === 'setup' ? 'lock.fill' : 'exclamationmark.triangle.fill'), compact ? 18 : (small ? 23 : 28),
      ready || context.status === 'setup' ? CNW_COLORS.accent : CNW_COLORS.warning),
    cnwText(title, compact ? 14 : (small ? 15 : 18), CNW_COLORS.primary, { font: { size: compact ? 14 : (small ? 15 : 18), weight: 'semibold' }, minScale: 0.8 }),
    ...(detail ? [cnwText(detail, compact ? 9 : (small ? 10 : 12), CNW_COLORS.secondary, { maxLines: compact ? 1 : 2, minScale: 0.85 })] : []),
    { type: 'spacer' },
  ], { flex: 1, gap: compact ? 4 : (small ? 5 : 7) });
}

function cnwFooter(context, visible, small) {
  const prefix = context.cached ? '缓存 ' : (context.warning && context.updatedAt !== null ? '上次 ' : '更新 ');
  const timestamp = context.updatedAt === null ? '尚未更新' : `${prefix}${cnwClock(context.updatedAt)}`;
  const remaining = Math.max(0, context.total - visible);
  return cnwStack('row', [
    cnwText(timestamp, small ? 8 : 9, context.cached ? CNW_COLORS.warning : CNW_COLORS.secondary, { flex: 1, minScale: 0.8 }),
    ...(remaining ? [cnwText(`还有${remaining}件`, small ? 8 : 9, CNW_COLORS.accent, {
      font: { size: small ? 8 : 9, weight: 'semibold' }, minScale: 0.75,
    })] : []),
  ], { gap: 4, alignItems: 'center' });
}

function cnwDesktop(context, family) {
  const options = CNW_FAMILIES[family];
  const small = family === 'systemSmall';
  const shown = context.items.slice(0, options.capacity);
  let body;
  if (!shown.length) body = cnwEmpty(context, small, family === 'systemMedium');
  else if (small) body = cnwItemCard(shown[0], context, options, true);
  else {
    const rows = [];
    for (let index = 0; index < shown.length; index += options.columns) {
      const cards = shown.slice(index, index + options.columns).map((item) => cnwItemCard(item, context, options, false));
      while (cards.length < options.columns) cards.push(cnwStack('column', [], { flex: 1 }));
      rows.push(cnwStack('row', cards, { flex: 1, gap: 8, alignItems: 'start' }));
    }
    body = cnwStack('column', rows, { flex: 1, gap: 8 });
  }
  return {
    type: 'widget', refreshAfter: context.refreshAfter,
    backgroundColor: CNW_COLORS.background,
    backgroundGradient: {
      type: 'linear', colors: [CNW_COLORS.background, CNW_COLORS.backgroundEnd],
      startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 },
    },
    padding: options.padding, gap: small ? 6 : 8,
    children: [
      cnwHeader(context, small, family === 'systemMedium'),
      ...((context.warning || context.message) && family !== 'systemMedium' ? [cnwBanner(context, small)] : []),
      body,
      cnwFooter(context, shown.length, small),
    ],
  };
}

function cnwLockStatus(context) {
  return context.warning ? context.label : (context.message || '菜鸟取件');
}

function cnwLockTimestamp(context, compact = false) {
  if (context.updatedAt === null) return '尚未更新';
  return `${context.cached ? '缓存' : '更新'}${cnwClock(context.updatedAt, !compact || context.cached)}`;
}

function cnwLock(context, family) {
  const hasItems = context.items.length > 0;
  const first = hasItems ? cnwCode(context.items[0], context.hideCode, context.officialSummary) : null;
  const count = context.warning && !hasItems && !context.cached ? '—' : context.count;
  const status = cnwLockStatus(context);
  const ready = context.status === 'ready' && !context.partial;
  const empty = ready ? (context.total > 0 ? CNW_MISSING_DETAILS : (context.stale ? '上次无待取' : CNW_STATES.ready.title)) : '待更新';
  const hidden = context.officialSummary ? '信息已隐藏' : '码已隐藏';
  let children;
  if (family === 'accessoryInline') {
    const code = first ? (context.hideCode ? hidden : first.text) : empty;
    children = [cnwText(`${context.warning || context.message ? status : '菜鸟'} · ${count}件 · ${code} · ${cnwLockTimestamp(context, true)}`,
      12, CNW_COLORS.primary, { minScale: 0.45, font: { size: 12, weight: 'medium', ...(first?.usable && !context.hideCode ? { family: 'Menlo' } : {}) } })];
  } else if (family === 'accessoryCircular') {
    const codeText = first ? (context.hideCode ? hidden : (first.usable ? cnwWrapCode(first.text) : first.text)) : empty;
    children = [
      cnwText(status, 8, CNW_COLORS.primary, { textAlign: 'center', minScale: 0.7, font: { size: 8, weight: 'semibold' } }),
      cnwText(context.partial && hasItems ? `≥${context.total}` : count, first && !context.hideCode ? 18 : 22, CNW_COLORS.primary, {
        textAlign: 'center', minScale: 0.65, font: { size: first && !context.hideCode ? 18 : 22, weight: 'bold' },
      }),
      cnwText(codeText,
        8, CNW_COLORS.primary, { textAlign: 'center', maxLines: codeText.includes('\n') ? 2 : 1, minScale: 0.45,
          font: { size: 8, weight: 'medium', ...(first?.usable && !context.hideCode ? { family: 'Menlo' } : {}) } }),
      cnwText(cnwLockTimestamp(context, true), 7, CNW_COLORS.secondary, { textAlign: 'center', minScale: 0.7 }),
    ];
  } else {
    children = [
      cnwStack('row', [
        cnwText('菜鸟取件', 11, CNW_COLORS.primary, { font: { size: 11, weight: 'semibold' } }),
        { type: 'spacer' },
        cnwText(`${count}件待取`, 11, CNW_COLORS.primary, { font: { size: 11, weight: 'bold' }, minScale: 0.75 }),
      ], { alignItems: 'center', gap: 4 }),
      ...(context.warning || context.message ? [cnwText(status, 9, CNW_COLORS.primary, { minScale: 0.75, font: { size: 9, weight: 'semibold' } })] : []),
      ...(first ? [cnwText(context.hideCode ? (context.officialSummary ? '取件信息已隐藏' : '取件码已隐藏') : first.text, context.hideCode || !first.usable ? 12 : 18, CNW_COLORS.primary, {
        font: { size: context.hideCode || !first.usable ? 12 : 18, weight: first.usable && !context.hideCode ? 'bold' : 'medium', ...(first.usable && !context.hideCode ? { family: 'Menlo' } : {}) }, minScale: 0.45,
        ...(context.officialSummary ? { maxLines: 2 } : {}),
      })] : [cnwText(ready ? empty : (context.setupTitle || context.state.title), 12, CNW_COLORS.primary, { minScale: 0.8 })]),
      cnwText(cnwLockTimestamp(context), 8, CNW_COLORS.secondary, { minScale: 0.75 }),
    ];
  }
  return {
    type: 'widget', refreshAfter: context.refreshAfter,
    padding: family === 'accessoryCircular' ? 1 : 0, gap: family === 'accessoryCircular' ? 0 : 3,
    children,
  };
}

/** 将规范化的展示模型转换为 Egern 官方原生 DSL。 */
export function renderWidget(model, family, now = Date.now()) {
  const requested = typeof family === 'string' ? family : 'systemSmall';
  const supported = Object.hasOwn(CNW_FAMILIES, requested)
    || ['accessoryCircular', 'accessoryRectangular', 'accessoryInline'].includes(requested);
  const resolved = supported ? requested : 'systemSmall';
  const context = cnwContext(model, resolved, now);
  return resolved.startsWith('accessory') ? cnwLock(context, resolved) : cnwDesktop(context, resolved);
}
