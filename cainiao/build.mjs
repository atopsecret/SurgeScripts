// Engine | Node.js 20+ | JavaScript ES module
// Build: node cainiao/build.mjs [--check]
// Run: 生成双端独立脚本与 Surge 模块；--check 只检查，不写入
// Deps: Python 3、PyYAML；不联网
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes("--check");
const policy = fs.readFileSync(path.join(root, "cainiao-policy.js"), "utf8").trim();
const version = /const VERSION = "([^"]+)";/.exec(policy)?.[1];
if (!version) throw Error("纯策略缺少版本");
const native = JSON.parse(execFileSync("python3", ["-c", "import json,yaml,sys; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding='utf-8'))))", path.join(root, "cainiao-adblock.egern.yaml")], { encoding: "utf8" }));
if (!native.description.startsWith("eg-native-20261108-" + version + "；")) throw Error("Egern 模块版本与纯策略不一致");
for (const item of native.scriptings) {
    const entry = item[Object.keys(item)[0]];
    if (new URL(entry.script_url).searchParams.get("v") !== "eg-native-20261108-" + version) throw Error("Egern 脚本 URL 版本不一致");
}

const types = { domain: "DOMAIN", domain_suffix: "DOMAIN-SUFFIX", url_regex: "URL-REGEX", user_agent: "USER-AGENT" };
function condition(item) {
    const [[kind, body]] = Object.entries(item);
    if (body.disabled) throw Error("构建不支持禁用条件");
    if (kind === "and" || kind === "or") return kind.toUpperCase() + ",(" + body.match.map(child => "(" + condition(child) + ")").join(",") + ")";
    if (!types[kind] || /[\r\n"]/.test(body.match)) throw Error("不支持的原生规则条件");
    const value = ["url_regex", "user_agent"].includes(kind) ? '"' + body.match + '"' : body.match;
    return types[kind] + "," + value;
}

const rules = native.rules.map(row => {
    const entry = row[Object.keys(row)[0]];
    if (entry.policy !== "REJECT") throw Error("公开广告规则只接受 REJECT");
    return condition(row) + ",REJECT";
});
const locals = native.map_locals.map(row => {
    const headers = row.headers || {};
    if (row.body !== "" || row.status_code !== 404 || Object.keys(headers).some(key => !["Content-Type", "X-Cainiao-Cleaner-Version"].includes(key))) throw Error("Map Local 不是预期的四类空体 404");
    if (headers["X-Cainiao-Cleaner-Version"] !== "eg-native-20261108-" + version) throw Error("Map Local 版本不一致");
    return row.match + ' data-type=text data="" status-code=404 header="Content-Type:' + headers["Content-Type"] + '"';
});
const response = native.scriptings.find(item => item.http_response)?.http_response;
if (!response?.binary_body || !response.body_required) throw Error("缺少二进制响应配置");
const module = `#!name=菜鸟去广告
#!desc=${version}；补开屏素材 ID 和目录轮换，限定菜鸟 UA；保留广告 SDK 拦截、四类广告 404、三组页面清理，与 Egern 共用纯策略。
#!author=skernelx · Kelee / 小白脸 来源
#!homepage=https://github.com/atopsecret/SurgeScripts/tree/main/cainiao
#!category=去广告
# Engine | Surge iOS 5.9.0+ / Mac 5.5.0+
# Build: node cainiao/build.mjs
# Run: 导入本模块；URL、UA 和页面处理需要启用 MITM 并信任本人 Surge CA。
# 由 Egern 原生规则生成；广告专用域名作用于所有 App，共享 CDN 素材同时要求菜鸟 UA。

[Rule]
${rules.join("\n")}

[Map Local]
# 保留四类空体 404；客户端专用版本头不作为业务匹配条件。
${locals.join("\n")}

[Script]
菜鸟去广告 = type=http-response,pattern=${response.match},requires-body=true,max-size=${response.max_size},binary-body-mode=true,full-header-mode=true,engine=webview,script-update-interval=${response.update_interval},script-path=https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao/cainiao-adblock.js?v=${version},timeout=${response.timeout}

[MITM]
hostname = %APPEND% ${native.mitm.hostnames.includes.join(", ")}
`;
const outputs = [["cainiao-adblock.sgmodule", module]];
for (const [templateName, outputName] of [["cainiao-adblock.runtime.in", "cainiao-adblock.js"], ["cainiao-adblock.egern.runtime.in", "cainiao-adblock.egern.js"]]) {
    const template = fs.readFileSync(path.join(root, templateName), "utf8");
    if (template.split("{{POLICY}}").length !== 2) throw Error("模板纯策略标记数量不正确");
    outputs.push([outputName, template.replace("{{POLICY}}", policy)]);
}
const stale = [];
for (const [name, source] of outputs) {
    const output = source.trimEnd() + "\n";
    const target = path.join(root, name);
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== output) stale.push(name);
    if (!check) fs.writeFileSync(target, output);
}
if (check && stale.length) {
    console.error("产物需要重新构建：" + stale.join(", "));
    process.exit(1);
}
console.log(check ? "菜鸟双端构建检查通过" : "菜鸟双端构建完成");
