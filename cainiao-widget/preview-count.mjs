// 引擎：Node.js 20+ | 语言：JavaScript ES module
// Build: node cainiao-widget/build.mjs
// Run: node cainiao-widget/preview-count.mjs
// Deps: 本地实际DSL渲染器；仅合成总量和状态，无网络。
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {renderCountWidget} from './count-render.mjs';
import {renderDslToHtml} from './preview.mjs';

const now = new Date(2026, 10, 11, 12, 30).getTime();
const model = {status: 'ready', total: 6, updatedAt: now - 5 * 60000, refreshMinutes: 15, coverage: 'official_summary'};
const families = ['systemSmall', 'systemMedium', 'systemLarge', 'systemExtraLarge', 'accessoryCircular', 'accessoryRectangular', 'accessoryInline'];
const samples = [];
for (const family of families) for (const theme of ['light', 'dark']) {
  samples.push(renderDslToHtml(renderCountWidget(model, family, now), {family, theme, title: '待取数量'}));
}
for (const [title, change] of [['暂无待取', {total: 0}], ['首次连接', {status: 'setup', total: 0, updatedAt: null}],
  ['离线旧数量', {status: 'offline'}], ['过旧零值', {total: 0, updatedAt: now - 86400000}]]) {
  for (const family of ['systemSmall', 'systemMedium']) samples.push(renderDslToHtml(renderCountWidget({...model, ...change}, family, now),
    {family, theme: 'light', title}));
}
for (const total of [0, 6, 1000000]) samples.push(renderDslToHtml(renderCountWidget({...model, total}, 'systemMedium', now),
  {family: 'systemMedium', theme: 'light', title: '最小中号 292×141', dimensions: [292, 141]}));
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>菜鸟待取数量 · 实际DSL预览</title><style>
*{box-sizing:border-box}body{margin:0;background:#e6e1da;color:#34271d;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
main{max-width:1320px;margin:auto;padding:28px}h1{font-size:22px;margin:0 0 8px}p{font-size:12px;margin:0 0 22px;color:#756657}.gallery{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.sample{padding:14px;border-radius:18px;background:#f4f0eb;display:flex;flex-direction:column;gap:9px}.sample-caption{font-size:11px;color:#756657}.sample-note{font-size:9px;color:#998674}.widget-viewport{border-radius:23px;overflow:hidden;box-shadow:0 8px 20px #402b1710;flex:none}.dsl-widget{width:100%;height:100%}.dsl-node svg{width:100%;height:100%}.lock-sample .widget-viewport{background:#282019}.circular{border-radius:50%}
</style><main><h1>菜鸟取件 · 待取数量</h1><p>实际组件DSL生成。仅合成数量与状态；图标使用预览近似，手机使用原生SF Symbols。模块保留连接开关：默认auto；off清除本机连接，之后需重新接入。</p><div class="gallery">${samples.join('\n')}</div></main></html>`;
await writeFile(fileURLToPath(new URL('./preview-count.html', import.meta.url)), html);
console.log('数量组件预览已生成：preview-count.html');
