// 引擎：Node.js 20+ | 语言：JavaScript ES module
// 构建：无需编译；HTML 与可选 PNG 都从 renderWidget 的实际 DSL 生成。
// 运行：node cainiao-widget/preview.mjs [--out 目录] [--png]
// 依赖：HTML 无额外依赖；--png 另需 Python Playwright 与本机 Chrome/Chromium
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderWidget } from './render.mjs';

const PREVIEW_SIZES = {
  systemSmall: [160, 160], systemMedium: [338, 158], systemLarge: [338, 354], systemExtraLarge: [718, 354],
  accessoryCircular: [60, 60], accessoryRectangular: [172, 76], accessoryInline: [310, 24],
};
const PREVIEW_NAMES = {
  systemSmall: '小尺寸', systemMedium: '中尺寸', systemLarge: '大尺寸', systemExtraLarge: '超大尺寸',
  accessoryCircular: '锁屏圆形', accessoryRectangular: '锁屏矩形', accessoryInline: '锁屏内联',
};
const PREVIEW_FONT_SIZES = {
  largeTitle: 34, title: 28, title2: 22, title3: 20, headline: 17, body: 17,
  callout: 16, subheadline: 15, footnote: 13, caption1: 12, caption2: 11,
};

function previewEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function previewColor(value, theme) {
  if (typeof value === 'string') return value;
  return value && typeof value === 'object' ? value[theme] || value.light || value.dark || 'transparent' : 'transparent';
}

function previewPadding(value) {
  const values = Array.isArray(value) ? value : [value || 0];
  return values.map((number) => `${number}px`).join(' ');
}

function previewFont(font = {}) {
  const size = typeof font.size === 'number' ? font.size : PREVIEW_FONT_SIZES[font.size] || 17;
  const weights = { ultraLight: 100, thin: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900 };
  return { size, weight: weights[font.weight] || 400, family: font.family === 'Menlo' ? 'Menlo,monospace' : '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif' };
}

// 预览用矢量图标只是 SF Symbol 的近似，原生输出仍使用官方 SF Symbol URI。
function previewSymbol(src) {
  const paths = {
    'shippingbox.fill': '<path d="m3 6 9-4 9 4v12l-9 4-9-4V6Zm0 0 9 4 9-4M12 10v12M8 4l9 4v4"/>',
    'exclamationmark.triangle.fill': '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v.1"/>',
    'checkmark.circle': '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
    'lock.fill': '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  };
  const name = src.replace('sf-symbol:', '');
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths['shippingbox.fill']}</svg>`;
}

function previewNode(node, theme) {
  const styles = ['box-sizing:border-box', 'min-width:0', 'min-height:0', 'max-width:100%'];
  const attributes = [`data-type="${previewEscape(node.type)}"`];
  if (node.flex) styles.push(`flex:${node.flex} 1 0%`);
  if (node.padding !== undefined) styles.push(`padding:${previewPadding(node.padding)}`);
  if (node.gap !== undefined) styles.push(`gap:${node.gap}px`);
  if (node.backgroundColor) styles.push(`background:${previewColor(node.backgroundColor, theme)}`);
  if (node.backgroundGradient) {
    const gradient = node.backgroundGradient;
    const colors = gradient.colors.map((color) => previewColor(color, theme));
    styles.push(`background:linear-gradient(135deg,${colors.join(',')})`);
  }
  if (typeof node.borderRadius === 'number') styles.push(`border-radius:${node.borderRadius}px`);
  if (node.borderWidth) styles.push(`border:${node.borderWidth}px solid ${previewColor(node.borderColor, theme)}`);
  if (node.width) styles.push(`width:${node.width}px`);
  if (node.height) styles.push(`height:${node.height}px`);
  let content = '';
  if (node.type === 'widget' || node.type === 'stack') {
    styles.push('display:flex', `flex-direction:${node.direction || 'column'}`);
    const align = { start: 'flex-start', center: 'center', end: 'flex-end' };
    styles.push(`align-items:${node.type === 'widget' ? 'stretch' : align[node.alignItems] || 'center'}`);
    // 只让带弹性子元素的容器占用可用空间，不把所有 stack 强制拉伸。
    const expands = (node.children || []).some((child) => child.flex || (child.type === 'spacer' && child.length === undefined));
    if (node.type === 'stack' && expands) styles.push('align-self:stretch');
    content = (node.children || []).map((child) => previewNode(child, theme)).join('');
  } else if (node.type === 'spacer') {
    styles.push(node.length === undefined ? 'flex:1 1 0%' : `flex:0 0 ${node.length}px`);
  } else if (node.type === 'text' || node.type === 'date') {
    const font = previewFont(node.font);
    styles.push(`font-size:${font.size}px`, `font-weight:${font.weight}`, `font-family:${font.family}`,
      'line-height:1.18', `color:${previewColor(node.textColor || { light: '#162A46', dark: '#F0F6FF' }, theme)}`,
      `text-align:${node.textAlign || 'left'}`, 'white-space:pre-wrap', 'overflow:hidden', 'flex-shrink:0',
      'display:-webkit-box', '-webkit-box-orient:vertical', `-webkit-line-clamp:${node.maxLines || 1}`,
      'overflow-wrap:anywhere', 'align-self:stretch');
    attributes.push(`data-font-size="${font.size}"`, `data-min-scale="${node.minScale ?? 1}"`, `data-lines="${node.maxLines || 1}"`);
    if (node.font?.family === 'Menlo') attributes.push('data-code="true"');
    const value = node.type === 'date' ? new Date(node.date).toLocaleString('zh-CN') : node.text;
    attributes.push(`data-content="${previewEscape(value)}"`);
    content = previewEscape(value);
  } else if (node.type === 'image') {
    styles.push(`color:${previewColor(node.color, theme)}`, 'display:flex', 'flex-shrink:0', 'align-items:center');
    if (node.src?.startsWith('sf-symbol:')) content = previewSymbol(node.src);
    else content = `<img alt="" src="${previewEscape(node.src)}" style="width:100%;height:100%;object-fit:contain">`;
  }
  if (node.opacity !== undefined) styles.push(`opacity:${node.opacity}`);
  const className = node.type === 'widget' ? 'dsl-node dsl-widget' : 'dsl-node';
  return `<div class="${className}" ${attributes.join(' ')} style="${previewEscape(styles.join(';'))}">${content}</div>`;
}

export function renderDslToHtml(dsl, { family = 'systemSmall', theme = 'light', title = '', dimensions } = {}) {
  const [width, height] = dimensions || PREVIEW_SIZES[family] || PREVIEW_SIZES.systemSmall;
  const lock = family.startsWith('accessory');
  return `<div class="sample theme-${theme}${lock ? ' lock-sample' : ''}" data-family="${previewEscape(family)}">
    <div class="sample-caption">${previewEscape(title || PREVIEW_NAMES[family])} · ${theme === 'dark' ? '深色' : '浅色'}</div>
    <div class="widget-viewport ${family === 'accessoryCircular' ? 'circular' : ''}" style="width:${width}px;height:${height}px">${previewNode(dsl, theme)}</div>
    <div class="sample-note">合成数据 · 离线预览</div>
  </div>`;
}

export function previewSamples() {
  const now = new Date(2026, 10, 8, 14, 35).getTime();
  const updatedAt = new Date(2026, 10, 8, 14, 20).getTime();
  const stations = ['合成 · 云杉路菜鸟驿站', '合成 · 南门便利店', '合成 · 学府路服务站', '合成 · 春江里邻里中心'];
  const companies = ['中通快递', '圆通速递', '韵达快递', '申通快递'];
  const model = {
    status: 'ready', total: 9, updatedAt, refreshMinutes: 15,
    items: Array.from({ length: 9 }, (_, index) => ({
      id: `synthetic-${index}`, code: ['86-2-3108', '5-18-2046', '3-9-1082', '24-6027'][index % 4],
      station: stations[index % 4], company: companies[index % 4], tail: `${8210 + index}`, requiresVerification: false,
    })),
  };
  const samples = [];
  for (const family of ['systemSmall', 'systemMedium', 'systemLarge', 'systemExtraLarge']) {
    for (const theme of ['light', 'dark']) samples.push({ id: `${family}-${theme}`, title: PREVIEW_NAMES[family], family, theme, model, now });
  }
  for (const family of ['accessoryCircular', 'accessoryRectangular', 'accessoryInline']) {
    samples.push({ id: `${family}-private`, title: `${PREVIEW_NAMES[family]} · 默认隐私`, family, theme: 'dark', model, now });
    samples.push({ id: `${family}-revealed`, title: `${PREVIEW_NAMES[family]} · 已允许显示码`, family, theme: 'dark', model: { ...model, privacy: false }, now });
  }
  const variants = [
    ['empty', '没有待取件', { status: 'ready', items: [], total: 0 }],
    ['setup', 'App 首次连接', { status: 'setup', items: [], total: 0, updatedAt: null, message: '打开淘宝或菜鸟 App 的快递列表' }],
    ['app-pending', 'App 已捕获 · 待验证', { status: 'setup', setupTitle: 'App 接入待验证', items: [], total: 0, updatedAt: null, message: '已保存 App 会话候选，等待个人列表查询确认' }],
    ['app-unsupported', 'App 独立查询未确认', { status: 'setup', setupTitle: 'App 接入未确认', items: [], total: 0, updatedAt: null, message: 'App 会话尚不能用于独立查询，请重开快递列表接入' }],
    ['app-conflict', 'App 账号字段冲突', { status: 'setup', setupTitle: '重开 App 快递列表', items: [], total: 0, updatedAt: null, message: 'App 账号字段冲突，旧登录态与快照已隔离' }],
    ['disabled', '连接已关闭', { status: 'setup', setupTitle: '连接已关闭', items: [], total: 0, updatedAt: null, message: '本机登录态已清除，切回 auto 可重新连接' }],
    ['local-storage', '本机存储异常', { status: 'setup', setupTitle: '检查 Egern 存储', items: [], total: 0, updatedAt: null, message: '本机登录态无法读取，请重开 App 快递列表' }],
    ['expired', '登录过期 · 保留缓存', { status: 'expired', message: '登录已过期，请重开 App 快递列表 · 上次结果', updatedAt: updatedAt - 86400000 }],
    ['offline', '网络失败 · 保留缓存', { status: 'offline', message: '暂时连不上，稍后再试 · 上次结果' }],
    ['cache-write', '缓存未保存 · 当前查询成功', { status: 'ready', message: '本机缓存写入失败，刷新时将重新查询' }],
    ['verify', '需要安全验证', { status: 'verify', message: '请在淘宝或菜鸟完成验证 · 上次结果' }],
    ['partial', '数据未取全', { status: 'partial', total: 3, items: model.items.slice(0, 3), message: '只查到部分包裹，数量未取全' }],
    ['no-code', '缺码与需验证', { total: 2, items: [{ ...model.items[0], code: '', requiresVerification: true }, { ...model.items[1], code: '' }] }],
    ['long', '长站名与超长码', { total: 2, items: [
      { ...model.items[0], code: 'PICKUP-20261108-00881234567890', station: '合成城市合成大学研究生公寓西门商业街菜鸟驿站二号服务点' },
      { ...model.items[1], station: '合成 · 超长超长超长超长超长超长超长超长超长超长名称便利店' },
    ] }],
  ];
  for (const [id, title, change] of variants) {
    for (const family of ['systemSmall', 'systemMedium']) samples.push({ id: `${id}-${family}`, title, family, theme: id === 'expired' || id === 'verify' ? 'dark' : 'light', model: { ...model, ...change }, now });
  }
  for (const family of ['accessoryCircular', 'accessoryRectangular', 'accessoryInline']) {
    samples.push({ id: `${family}-expired`, title: `${PREVIEW_NAMES[family]} · 登录过期`, family, theme: 'dark', model: { ...model, status: 'expired', message: '请重新登录', updatedAt: updatedAt - 86400000 }, now });
    samples.push({ id: `${family}-long`, title: `${PREVIEW_NAMES[family]} · 已允许显示超长码`, family, theme: 'dark', model: {
      ...model, privacy: false, total: 1, items: [{ ...model.items[0], code: 'PICKUP-20261108-00881234567890' }],
    }, now });
  }
  for (const [id, title, change] of variants.filter(([id]) => ['expired', 'long', 'cache-write', 'setup', 'no-code', 'app-pending', 'app-unsupported', 'app-conflict'].includes(id))) {
    samples.push({ id: `${id}-medium-minimum`, title: `${title} · 最小中号 292×141`, family: 'systemMedium', dimensions: [292, 141], theme: 'light', model: { ...model, ...change }, now });
  }
  samples.push({ id: 'long-expired-small', title: '超长码 · 登录过期', family: 'systemSmall', theme: 'dark', model: {
    ...model, status: 'expired', total: 1, items: [{ ...model.items[0], code: 'PICKUP-20261108-00881234567890', station: '合成城市合成大学研究生公寓西门商业街菜鸟驿站二号服务点' }],
  }, now });
  samples.push({ id: 'expired-systemLarge', title: '登录过期 · 实际运行时提示', family: 'systemLarge', theme: 'dark', model: {
    ...model, status: 'expired', message: '登录已过期，请重开 App 快递列表 · 上次结果', updatedAt: updatedAt - 86400000,
  }, now });
  return samples;
}

const PREVIEW_CSS = `
*{box-sizing:border-box}body{margin:0;background:#e9edf4;color:#172942;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
main{max-width:1220px;margin:auto;padding:34px}h1{font-size:25px;margin:0 0 10px;letter-spacing:.02em}p{font-size:13px;line-height:1.65;color:#64758d;margin:0 0 20px}
.badge{display:inline-block;background:#dce8ff;color:#2256b0;padding:5px 9px;border-radius:6px;font-size:11px;font-weight:600;margin-bottom:12px}
.gallery{display:flex;flex-wrap:wrap;align-items:flex-start;gap:22px}.sample{display:flex;flex-direction:column;align-items:flex-start;padding:15px;background:#f6f8fc;border:1px solid #dae2ef;border-radius:17px;gap:10px}
.sample-caption{font-size:11px;font-weight:600;color:#50627d;max-width:768px}.sample-note{font-size:10px;color:#708099}.widget-viewport{border-radius:24px;overflow:hidden;box-shadow:0 7px 18px #12274112;flex:none}.dsl-widget{width:100%;height:100%}.dsl-node svg{width:100%;height:100%}
.lock-sample{background:#1a2940;border-color:#1a2940}.lock-sample .sample-caption,.lock-sample .sample-note{color:#c5d0e2}.lock-sample .widget-viewport{border-radius:0;box-shadow:none;background:#1a2940}.lock-sample .circular{border-radius:50%;background:#293b56}
body.single{background:#e9edf4}body.single main{width:max-content;padding:22px}body.single h1{font-size:14px}body.single .sample{padding:15px}
`;

// 按 DSL 的 minScale 尽量缩放；站名仍按 maxLines 截断，码不会与站名争宽度。
const PREVIEW_FIT = `<script>
window.fitPreviewText = () => {
  document.querySelectorAll('[data-font-size]').forEach((element) => {
    const original = Number(element.dataset.fontSize);
    const minimum = original * Number(element.dataset.minScale);
    const lines = Number(element.dataset.lines);
    const text = element.dataset.content || '';
    const measure = document.createElement('canvas').getContext('2d');
    const segments = text.split('\\n');
    let size = original;
    const width = element.getBoundingClientRect().width - 1;
    while (size > minimum) {
      const style = getComputedStyle(element);
      measure.font = style.fontWeight + ' ' + size + 'px ' + style.fontFamily;
      const largest = Math.max(...segments.map((segment) => measure.measureText(segment).width));
      if (largest <= width || lines > segments.length) break;
      size = Math.max(minimum, size - 0.25);
    }
    element.style.fontSize = size + 'px';
  });
  window.previewReady = true;
};
document.fonts.ready.then(window.fitPreviewText);
</script>`;

function previewDocument(content, single = false, widgetWidth = 364) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>菜鸟取件 · 原生组件离线预览</title><style>${PREVIEW_CSS}</style></head><body${single ? ' class="single"' : ''}><main${single ? ` style="width:${Math.max(360, widgetWidth + 74)}px"` : ''}>
  <span class="badge">合成数据 · 离线预览</span><h1>菜鸟取件 · 原生组件</h1>
  <p>由实际 renderWidget DSL 生成。浅深色、锁屏隐私、缓存与边界状态均使用合成包裹；不是 Egern 真机截图。系统字体、SF Symbol 与原生排版仍需设备验收。</p>
  <div class="gallery">${content}</div></main>${PREVIEW_FIT}</body></html>`;
}

async function previewMain() {
  const arguments_ = process.argv.slice(2);
  const outIndex = arguments_.indexOf('--out');
  const directory = outIndex >= 0 ? path.resolve(arguments_[outIndex + 1] || '.')
    : fileURLToPath(new URL('../../cainiao-widget-build/preview/', import.meta.url));
  await mkdir(directory, { recursive: true });
  const manifest = [];
  const gallery = [];
  const fragments = new Map();
  for (const sample of previewSamples()) {
    const dsl = renderWidget(sample.model, sample.family, sample.now);
    const html = renderDslToHtml(dsl, sample);
    gallery.push(html);
    fragments.set(sample.id, html);
    await writeFile(path.join(directory, `${sample.id}.html`), previewDocument(html, true, (sample.dimensions || PREVIEW_SIZES[sample.family])[0]));
    await writeFile(path.join(directory, `${sample.id}.json`), JSON.stringify(dsl, null, 2) + '\n');
    manifest.push({ id: sample.id, family: sample.family, theme: sample.theme, title: sample.title, html: `${sample.id}.html`, png: `${sample.id}.png` });
  }
  await writeFile(path.join(directory, 'index.html'), previewDocument(gallery.join('\n')));
  const overviewIds = ['systemSmall-light', 'systemMedium-light', 'systemLarge-light', 'systemSmall-dark', 'systemMedium-dark', 'systemLarge-dark', 'accessoryCircular-private', 'accessoryRectangular-private', 'accessoryInline-private'];
  const stateIds = ['expired-systemSmall', 'expired-systemMedium', 'expired-systemLarge', 'partial-systemMedium', 'long-systemMedium', 'no-code-systemMedium', 'setup-systemSmall', 'app-pending-systemSmall', 'app-unsupported-systemSmall', 'app-conflict-systemMedium'];
  await writeFile(path.join(directory, 'overview.html'), previewDocument(overviewIds.map((id) => fragments.get(id)).join('\n')));
  await writeFile(path.join(directory, 'states-overview.html'), previewDocument(stateIds.map((id) => fragments.get(id)).join('\n')));
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (arguments_.includes('--png')) {
    // 使用已有 Python Playwright 和本机 Chrome，不安装包或访问外网。
    const python = String.raw`import json, pathlib, sys
from playwright.sync_api import sync_playwright
root = pathlib.Path(sys.argv[1]).resolve()
manifest = json.loads((root / 'manifest.json').read_text())
issues = []
with sync_playwright() as pw:
    chrome = pathlib.Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    browser = pw.chromium.launch(executable_path=str(chrome) if chrome.exists() else None, headless=True)
    page = browser.new_page(viewport={'width': 1240, 'height': 900}, device_scale_factor=2)
    for sample in manifest:
        page.goto((root / sample['html']).as_uri(), wait_until='load')
        page.wait_for_function('window.previewReady === true')
        page.locator('main').screenshot(path=str(root / sample['png']))
        problems = page.evaluate("""() => {
          const root = document.querySelector('.widget-viewport').getBoundingClientRect();
          return [...document.querySelectorAll('.dsl-node')].flatMap((node) => {
            const rect = node.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return [];
            const codeClipped = node.dataset.code === 'true' && (node.scrollHeight > node.clientHeight + 2 || node.scrollWidth > node.clientWidth + 2);
            const parent = node.parentElement.closest('.dsl-node')?.getBoundingClientRect();
            const outsideParent = parent && (rect.left < parent.left - 1 || rect.right > parent.right + 1 || rect.top < parent.top - 1 || rect.bottom > parent.bottom + 1);
            return codeClipped || outsideParent || rect.left < root.left - 1 || rect.right > root.right + 1 || rect.top < root.top - 1 || rect.bottom > root.bottom + 1
              ? [{type: node.dataset.type, text: node.dataset.content || '', bounds: [rect.x-root.x, rect.y-root.y, rect.width, rect.height]}] : [];
          });
        }""")
        if problems: issues.append({'id': sample['id'], 'problems': problems})
    for name in ['overview', 'states-overview']:
        page.goto((root / (name + '.html')).as_uri(), wait_until='load')
        page.wait_for_function('window.previewReady === true')
        page.screenshot(path=str(root / (name + '.png')), full_page=True)
    browser.close()
(root / 'layout-check.json').write_text(json.dumps({'samples': len(manifest), 'issues': issues}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'samples': len(manifest), 'layoutIssues': len(issues)}, ensure_ascii=False))
sys.exit(1 if issues else 0)
`;
    const result = spawnSync('python3', ['-c', python, directory], { encoding: 'utf8', timeout: 60000 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`离线 PNG 或布局检查失败，退出码 ${result.status}`);
  }
  process.stdout.write(`已生成 ${manifest.length} 个同源 DSL 离线预览：${directory}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  previewMain().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
