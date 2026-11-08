// Engine | Node.js 20+ | JavaScript ES module
// Build: node jd/build.mjs [--check]
// Run: node --input-type=module --check < jd/jd-ad-block.egern.js
// Deps: 无；策略与运行时模板均为本地文件
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const policy = fs.readFileSync(path.join(root, "jd-policy.js"), "utf8").trim();
const version = /const VERSION = "([^"]+)";/.exec(policy)[1];
const files = [
    ["jd-ad-block.egern.runtime.in", "jd-ad-block.egern.js"],
    ["jd-ad-block.runtime.in", "jd-ad-block.js"],
    ["jd-post-capture.runtime.in", "jd-post-capture.js"],
];
let stale = [];
for (const [templateName, outputName] of files) {
    const template = fs.readFileSync(path.join(root, templateName), "utf8");
    const output = template.replace("{{POLICY}}", policy).trimEnd() + "\n";
    const target = path.join(root, outputName);
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== output) stale.push(outputName);
    if (!process.argv.includes("--check")) fs.writeFileSync(target, output);
}
const yamlPath = path.join(root, "jd-adblock.egern.yaml");
const surgePath = path.join(root, "jd-adblock.sgmodule");
for (const [file, replacements] of [
    [yamlPath, [[/(jd-ad-block\.egern\.js\?v=)[^\s]+/g, "$1" + version]]],
    [surgePath, [[/(jd-ad-block\.js\?v=)[^,\s]+/g, "$1" + version], [/(jd-post-capture\.js\?v=)[^,\s]+/g, "$1" + version]]],
]) {
    const old = fs.readFileSync(file, "utf8"); let next = old;
    for (const [pattern, value] of replacements) next = next.replace(pattern, value);
    if (next !== old) stale.push(path.basename(file));
    if (!process.argv.includes("--check")) fs.writeFileSync(file, next);
}
if (process.argv.includes("--check") && stale.length) { console.error("产物需要重新构建：" + [...new Set(stale)].join(", ")); process.exit(1); }
console.log(process.argv.includes("--check") ? "京东构建检查通过" : "京东构建完成");
