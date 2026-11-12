// 引擎：Node.js 20+ | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs [--check]
// 运行：node --input-type=module --check < cainiao-widget/cainiao-widget.egern.js
// 依赖：仅本地源码；不下载构建依赖
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import vm from "node:vm";

const cwBuildRoot = path.dirname(fileURLToPath(import.meta.url));
const cwBuildParts = ["core.mjs", "app.mjs", "auth.mjs", "transport.mjs", "response.mjs", "official.mjs", "render.mjs", "count-render.mjs", "runtime.mjs"].map(name => {
    const source = fs.readFileSync(path.join(cwBuildRoot, name), "utf8");
    return "// 来源：" + name + "\n" + source.replace(/^import .* from ["']\.\/(?:core|app|auth|transport|response|official|render|count-render)\.mjs["'];\r?\n/gm, "").replace(/^export (?=(?:const|function|async function|class)\b)/gm, "").trim();
});
const cwBuildVersion = /export const CW_VERSION = "([0-9.]+)";/.exec(fs.readFileSync(path.join(cwBuildRoot, "core.mjs"), "utf8"))?.[1];
if (!cwBuildVersion) throw new Error("源码缺少版本号");
const cwBuildOutput = "// Egern 原生菜鸟取件小组件 " + cwBuildVersion + " · 自动构建，请编辑本目录源文件。\n// 构建：node cainiao-widget/build.mjs；来源与许可见 THIRD_PARTY_NOTICES.md。\n" + cwBuildParts.join("\n\n") + "\n";
if (/^import\s/m.test(cwBuildOutput)) throw new Error("产物仍含外部依赖");
// 与 Egern 相同的 ES module 语法由 node --input-type=module --check 在验证时检查。
new vm.Script(cwBuildOutput.replace(/export default /, "const cwBuildEntry = "), {filename: "cainiao-widget.egern.js"});
const cwBuildTarget = path.join(cwBuildRoot, "cainiao-widget.egern.js");
if (process.argv.includes("--check")) {
    if (!fs.existsSync(cwBuildTarget) || fs.readFileSync(cwBuildTarget, "utf8") !== cwBuildOutput) throw new Error("产物需要重新构建");
    console.log("菜鸟小组件构建检查通过");
} else {
    fs.writeFileSync(cwBuildTarget, cwBuildOutput);
    console.log("菜鸟小组件构建完成");
}
