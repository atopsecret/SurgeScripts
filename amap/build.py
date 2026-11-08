#!/usr/bin/env python3
# Engine | Python 3.9+ 标准库 | Python
# Build: 无需构建
# Run: python3 amap/build.py [--check]
# Deps: 无；生成本目录独立脚本与模块页面匹配式，不增加客户端依赖
"""将共用策略内联到 Surge/Egern；检查模式不写文件。"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace_once(pattern, replacement, text):
    result, count = re.subn(pattern, lambda _: replacement, text, flags=re.MULTILINE)
    if count != 1:
        raise ValueError(f"生成目标不唯一：{pattern!r}，命中 {count} 次")
    return result


def render():
    policy = (ROOT / "amap-policy.js").read_text(encoding="utf-8")
    version = re.search(r'^export const VERSION = "([\d.]+)";', policy, re.MULTILINE).group(1)
    paths = json.loads(re.search(r'export const PATHS = (\[.*?\]);', policy, re.DOTALL).group(1))
    match = r"^https?://(?:[A-Za-z0-9-]+\.)+amap\.com(?::[0-9]+)?/ws/(?:" + "|".join(item[1] for item in paths) + r")(?:[/?]|$)"
    output = {}
    for name, native in [("amap-cleaner.js", False), ("amap-cleaner.egern.js", True)]:
        template = (ROOT / ("egern-runtime.js.in" if native else "surge-runtime.js.in")).read_text(encoding="utf-8")
        core = policy if native else re.sub(r"^export ", "", policy, flags=re.MULTILINE)
        if not native:
            core = "\n".join("    " + line if line else "" for line in core.rstrip().splitlines()) + "\n"
        output[name] = template.replace("{{VERSION}}", version).replace("{{POLICY}}", core.rstrip())
    for name in ["amap-adblock.sgmodule", "amap-adblock.egern.yaml"]:
        text = (ROOT / name).read_text(encoding="utf-8")
        if name.endswith("sgmodule"):
            text = replace_once(r"(?<=pattern=).*?(?=,requires-body=)", match.replace("/", r"\/"), text)
            text = re.sub(r"(?<=#!desc=)[\d.]+", version, text)
            text = re.sub(r"(?<=X-AMap-Cleaner-Version:)[\d.]+", version, text)
        else:
            before, scriptings = text.split("scriptings:\n", 1)
            text = before + "scriptings:\n" + replace_once(r"^      match: '.+'$", "      match: '" + match + "'", scriptings)
            text = re.sub(r"(?<=description: )[\d.]+", version, text)
            text = re.sub(r"(X-AMap-Cleaner-Version: ')[\d.]+(')", lambda m: m[1] + version + m[2], text)
        output[name] = re.sub(r"(?<=\?v=)[\d.]+", version, text)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="只检查产物，不写文件")
    args = parser.parse_args()
    stale = []
    for name, expected in render().items():
        target = ROOT / name
        if target.read_text(encoding="utf-8") != expected:
            stale.append(name)
            if not args.check:
                target.write_text(expected, encoding="utf-8")
    if args.check and stale:
        parser.exit(1, "产物需要重新构建：" + ", ".join(stale) + "\n")
    print("检查通过：4 个独立产物" if args.check else "生成完成：" + (", ".join(stale) or "无变化"))


if __name__ == "__main__":
    main()
