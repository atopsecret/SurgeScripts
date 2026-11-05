#!/usr/bin/env python3
# 引擎：Egern 原生配置静态检查 | 语言：Python 3.11+
# 构建：无需编译
# 运行：python3 egern/validate.py [--rules-dir RULES_DIRECTORY]
# 依赖：PyYAML 6、Node.js 20+；不联网，不调用客户端或业务 API
"""检查七个原生模块字段、正则、脚本引用和可选公共规则目录。

范围是本项目实际使用的官方文档字段，不伪装成 Egern 官方解析器。
只读本地文件；不加载私人配置、不执行脚本业务，不证明手机运行可用。
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

import yaml

MODULES = (
    "amap/amap-adblock.egern.yaml",
    "jd/jd-adblock.egern.yaml",
    "xianyu/xianyu-adblock.egern.yaml",
    "pinduoduo/pdd-adblock.egern.yaml",
    "hongguo/hongguo-adblock.egern.yaml",
    "jyjt/jyjt-member.egern.yaml",
    "weilai/weilai-auto-checkin.egern.yaml",
)
META = {"name", "description", "author", "homepage", "manual", "icon", "open_url"}
RULE_TYPES = {"domain", "domain_suffix", "domain_keyword", "domain_regex", "domain_wildcard", "geoip", "ip_cidr", "ip_cidr6", "asn", "url_regex", "user_agent", "dest_port", "protocol", "ssid", "bssid", "cellular"}
SCRIPT_FIELDS = {"name", "match", "script_url", "env", "update_interval", "max_size", "timeout", "body_required", "binary_body", "disabled", "cron"}
SET_FIELDS = {"domain_set": "DOMAIN", "domain_suffix_set": "DOMAIN-SUFFIX", "ip_cidr_set": "IP-CIDR", "ip_cidr6_set": "IP-CIDR6"}


class StrictLoader(yaml.SafeLoader):
    pass


def unique_mapping(loader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise ValueError("YAML 含重复键")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


def load(path: Path):
    return yaml.load(path.read_text(encoding="utf-8"), Loader=StrictLoader)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def regex(value):
    require(isinstance(value, str) and bool(value), "匹配正则必须为非空字符串")
    re.compile(value)


def validate_rule(item, nested=False):
    require(isinstance(item, dict) and len(item) == 1, "规则必须只有一个类型键")
    kind, body = next(iter(item.items()))
    require(isinstance(body, dict), "规则字段必须为映射")
    require(not set(body) - {"match", "policy", "name", "no_resolve", "disabled"}, "规则含非文档字段")
    require("match" in body, "规则缺少 match")
    if nested:
        require("policy" not in body, "逻辑子条件不能携带独立策略")
    else:
        require(body.get("policy") in {"DIRECT", "REJECT"}, "公开模块不能携带私人节点或未定义策略")
    if kind in {"and", "or"}:
        require(isinstance(body["match"], list) and len(body["match"]) >= 2, "逻辑规则缺少子条件")
        for child in body["match"]:
            validate_rule(child, True)
    elif kind == "not":
        validate_rule(body["match"], True)
    else:
        require(kind in RULE_TYPES and isinstance(body["match"], str) and bool(body["match"]), "未知规则类型或无效匹配")
        if kind.endswith("regex"):
            regex(body["match"])
        if kind in {"ip_cidr", "ip_cidr6"}:
            network = ipaddress.ip_network(body["match"], strict=True)
            require(network.version == (6 if kind == "ip_cidr6" else 4), "IP 版本错误")
        if kind == "protocol":
            require(body["match"] in {"tcp", "udp", "http", "https", "quic", "stun"}, "协议值不是文档化小写枚举")
    if "no_resolve" in body:
        require(kind in {"ip_cidr", "ip_cidr6", "geoip", "asn"} and type(body["no_resolve"]) is bool, "no_resolve 类型或范围无效")


def script_path(url: str, root: Path) -> Path:
    parts = urlsplit(url)
    match = re.fullmatch(r"/atopsecret/SurgeScripts/(?:main|[0-9a-f]{40})/(.+)", parts.path)
    require(parts.scheme == "https" and parts.netloc == "raw.githubusercontent.com" and match is not None, "脚本未使用当前仓库 main 或完整提交地址")
    relative = Path(match.group(1))
    require(".." not in relative.parts and not relative.is_absolute(), "脚本路径越出仓库")
    path = root / relative
    require(path.is_file() and not path.is_symlink() and path.name.endswith(".egern.js"), "脚本文件不存在或不是自包含原生文件")
    return path


def validate_module(path: Path, root: Path) -> set[Path]:
    module = load(path)
    require(isinstance(module, dict), "模块根必须为映射")
    require(not set(module) - META - {"rules", "scriptings", "map_locals", "mitm"}, "模块根含非本项目所用官方字段")
    for key in META & set(module):
        require(isinstance(module[key], str) and bool(module[key]), "模块元数据必须为非空字符串")
    for key in ("name", "description", "author", "homepage"):
        require(key in module, "模块缺少必要说明")
    for item in module.get("rules", []):
        validate_rule(item)
    for item in module.get("map_locals", []):
        require(isinstance(item, dict) and not set(item) - {"match", "status_code", "headers", "body"}, "Map Local 含非文档字段")
        regex(item.get("match"))
        require(type(item.get("status_code")) is int and 100 <= item["status_code"] < 600, "本地响应状态码无效")
        require(isinstance(item.get("body"), str), "本地响应必须携带明确字符串正文")
        headers = item.get("headers", {})
        require(isinstance(headers, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in headers.items()), "本地响应头类型无效")
    if "mitm" in module:
        mitm = module["mitm"]
        require(isinstance(mitm, dict) and set(mitm) == {"hostnames"}, "公开模块不能含 CA、口令或伪造 enabled 字段")
        hosts = mitm["hostnames"]
        require(isinstance(hosts, dict) and not set(hosts) - {"includes", "excludes"}, "MITM 主机形状无效")
        require(all(isinstance(values, list) and all(isinstance(v, str) and v for v in values) for values in hosts.values()), "MITM 主机必须为非空字符串数组")
    paths = set()
    for item in module.get("scriptings", []):
        require(isinstance(item, dict) and len(item) == 1, "脚本条目类型无效")
        kind, body = next(iter(item.items()))
        require(kind in {"http_request", "http_response", "schedule", "generic", "network"} and isinstance(body, dict), "非原生脚本类型")
        require(not set(body) - SCRIPT_FIELDS, "脚本含 Surge 字段或其他非文档字段")
        require(isinstance(body.get("name"), str) and body["name"], "脚本缺少名称")
        paths.add(script_path(body.get("script_url", ""), root))
        if kind in {"http_request", "http_response"}:
            regex(body.get("match"))
        else:
            require("match" not in body and "body_required" not in body and "binary_body" not in body, "非 HTTP 脚本包含正文或 URL 匹配字段")
        if kind == "schedule":
            require(isinstance(body.get("cron"), str) and len(body["cron"].split()) in {5, 6}, "定时脚本缺少文档化 cron")
        else:
            require("cron" not in body, "非 schedule 脚本包含 cron")
        for key in {"body_required", "binary_body", "disabled"} & set(body):
            require(type(body[key]) is bool, "脚本布尔字段类型错误")
        for key in {"update_interval", "max_size", "timeout"} & set(body):
            require(type(body[key]) is int and body[key] > 0, "脚本数量字段类型错误")
        if "timeout" in body:
            require(body["timeout"] <= 600, "脚本超时超过官方上限")
        if "env" in body:
            require(isinstance(body["env"], dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in body["env"].items()), "env 必须为字符串映射")
    return paths


def source_conditions(path: Path) -> set:
    result = set()
    for original in path.read_text().splitlines():
        line = original.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split(",")
        require(len(fields) in {2, 3}, "原列表含未知字段")
        result.add((fields[0], fields[1], len(fields) == 3 and fields[2] == "no-resolve"))
    return result


def native_conditions(path: Path) -> set:
    data = load(path)
    require(isinstance(data, dict) and not set(data) - set(SET_FIELDS) - {"no_resolve"}, "原生集合字段无效")
    require(type(data.get("no_resolve", False)) is bool, "集合 no_resolve 必须为布尔值")
    result = set()
    for key, values in data.items():
        if key == "no_resolve":
            continue
        require(isinstance(values, list) and len(values) == len(set(values)), "集合须为不重复数组")
        for value in values:
            require(isinstance(value, str) and value, "集合值必须为非空字符串")
            no_resolve = data.get("no_resolve", False) if key.startswith("ip_cidr") else False
            if key.startswith("ip_cidr"):
                network = ipaddress.ip_network(value, strict=True)
                require(network.version == (6 if key == "ip_cidr6_set" else 4), "集合 IP 版本无效")
            result.add((SET_FIELDS[key], value, no_resolve))
    require(bool(result), "集合不能为空")
    return result


def validate_rules(root: Path) -> dict:
    output = {}
    manifest = json.loads((root / "egern/manifest.json").read_text())
    for name in ("Ads", "AI", "Binance", "Apple", "Domestic", "Proxy"):
        source = root / (name + ".list")
        target = root / "egern" / (name + ".yaml")
        expected = source_conditions(source)
        actual = native_conditions(target)
        require(actual == expected, name + " 原生集合与原列表不等价")
        metadata = manifest["files"][name]
        require(metadata["rules"] == len(actual), name + " 条数元数据不符")
        require(metadata["sha256"] == hashlib.sha256(target.read_bytes()).hexdigest(), name + " 原生哈希不符")
        require(metadata["source_sha256"] == hashlib.sha256(source.read_bytes()).hexdigest(), name + " 原列表哈希不符")
        original_comments = [line for line in source.read_text().splitlines() if line.startswith("#")]
        require(all(line in target.read_text().splitlines() for line in original_comments), name + " 来源或许可注释丢失")
        output[name] = len(actual)
    resolving = native_conditions(root / "egern/LAN.yaml")
    non_resolving = native_conditions(root / "egern/LAN-no-resolve.yaml")
    require({(kind, value) for kind, value, _ in resolving} == {(kind, value) for kind, value, _ in non_resolving} and len(resolving) == 14, "两份 LAN 集合的 14 个条件不一致")
    require(all(not value for kind, _, value in resolving if kind.startswith("IP-CIDR")), "LAN 默认解析语义不符")
    require(all(value for kind, _, value in non_resolving if kind.startswith("IP-CIDR")), "LAN 无解析语义不符")
    for name in ("LAN", "LAN-no-resolve"):
        metadata = manifest["support_files"][name]
        require(metadata["rules"] == 14, "LAN 条数元数据不符")
        require(metadata["sha256"] == hashlib.sha256((root / "egern" / (name + ".yaml")).read_bytes()).hexdigest(), "LAN 文件哈希不符")
    require(sum(output.values()) == manifest["total_rules"] == 9980, "六份规则总数不符")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--rules-dir", type=Path)
    args = parser.parse_args()
    paths = set()
    for relative in MODULES:
        paths.update(validate_module(args.root / relative, args.root))
    for path in sorted(paths):
        source = path.read_text()
        require("export default" in source and not re.search(r"\$(?:request|response|done|persistentStore|httpClient|notification)\b", source), "脚本不是独立原生入口")
        subprocess.run(["node", "--input-type=module", "--check"], input=source, text=True, check=True, timeout=15, capture_output=True)
    result = {"native_modules": len(MODULES), "native_scripts": len(paths), "static_check": "PASS", "network_requests": 0, "runtime_verified": False}
    if args.rules_dir:
        result["rules"] = validate_rules(args.rules_dir)
        result["lan_support_sets"] = 2
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
