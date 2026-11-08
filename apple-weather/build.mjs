// Engine | Node.js 20+ | JavaScript ES module
// Build: npm ci --ignore-scripts && npm run build
// Run: npm test；产物供 Egern 远程模块加载
// Deps: package-lock.json 固定的 esbuild、flatbuffers
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('vendor/manifest.json', import.meta.url), 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = await readFile(new URL(name, import.meta.url));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`来源文件哈希不符：${name}`);
}

// 旧工具库不进入产物。每次调用的 HTTP、设置、缓存绑定在工厂参数上。
const nativeUtilities = {
    name: 'native-utilities',
    setup(b) {
        b.onResolve({ filter: /^@nsnanocat\/util(?:\/getStorage\.mjs)?$/ }, args => ({ path: args.path, namespace: 'native' }));
        b.onLoad({ filter: /.*/, namespace: 'native' }, args => ({
            contents: args.path.endsWith('/getStorage.mjs')
                ? 'export default (...args) => nativeRuntime.getStorage(...args);'
                : 'export const { Console, Lodash, Storage, fetch } = nativeRuntime; export const time = undefined;',
            loader: 'js',
        }));
        b.onLoad({ filter: /parseWeatherKitURL\.mjs$/ }, async args => {
            const source = await readFile(args.path, 'utf8');
            const expected = 'url = new URL($request.url)';
            if (!source.includes(expected)) throw new Error('上游 URL 解析器结构改变');
            return { contents: source.replace(expected, 'url'), loader: 'js' };
        });
    },
};

const core = await build({
    stdin: {
        contents: `
            export { Response } from './vendor/weatherkit/src/process/Response.mjs';
            export { default as WeatherKit2 } from './vendor/weatherkit/src/class/WeatherKit2.mjs';
            export { default as database } from './vendor/weatherkit/src/function/database.mjs';
            export { Builder, ByteBuffer } from 'flatbuffers';
        `,
        resolveDir: root,
    },
    bundle: true, write: false, format: 'iife', globalName: 'WeatherKitCore',
    platform: 'neutral', mainFields: ['module', 'main'], target: 'es2022', minify: true, legalComments: 'none',
    plugins: [nativeUtilities],
});

const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/main.mjs'],
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
    minify: true, legalComments: 'none',
    plugins: [{ name: 'isolated-weather-core', setup(b) {
        b.onResolve({ filter: /^weatherkit-core$/ }, () => ({ path: 'weatherkit-core', namespace: 'core' }));
        b.onLoad({ filter: /.*/, namespace: 'core' }, () => ({
            contents: `export function createEngine(nativeRuntime) { ${core.outputFiles[0].text}\nreturn WeatherKitCore; }`, loader: 'js',
        }));
    } }],
    banner: { js: `// Engine | Egern 原生 API | JavaScript ES module
// Build: cd apple-weather && npm ci --ignore-scripts && npm run build
// Run: Egern 导入 apple-weather-enhancer.egern.yaml；离线 npm test
// Deps: 运行时无依赖；WeatherKit v3.1.0 / FlatBuffers 24.12.23，Apache-2.0
// 原作者：VirgilClyne、WordlessEcho、001；Egern 适配：atopsecret
// 许可与修改说明见 apple-weather/NOTICE.md 和 vendor/weatherkit/LICENSE
// 自动生成；请修改 src/，不要直接编辑此文件。` },
});
const output = result.outputFiles[0].text;
if (/\$(?:request|response|done|httpClient|persistentStore|notification)\b|\beval\s*\(|new Function\b/.test(output)) {
    throw new Error('产物残留旧全局 API 或动态执行');
}
await writeFile(new URL('apple-weather-enhancer.egern.js', import.meta.url), output);
console.log(`Egern 原生脚本：${Buffer.byteLength(output)} 字节；来源哈希检查通过。`);
