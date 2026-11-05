#!/usr/bin/env python3
"""将保存的原始 Git 对象恢复到全新 bare 仓库，绝不覆盖已有目标。

Runtime: Python 3.10+ / Git / macOS or Linux
Build: 无需构建，无第三方 Python 依赖
Run: python3 recovery/restore_original_history.py --target /ABSOLUTE/NEW.git
Test: python3 -m unittest discover -s recovery/tests -v

只执行本地 Git 命令。保留记录中的原始 shallow 边界，不伪造或补造缺失父提交。
失败时保留本次新建目录供检查，不删除或覆盖任何已有目录。
"""
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys


HERE = Path(__file__).resolve().parent
GIT_TIMEOUT = 60
SHA1 = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


class RecoveryError(ValueError):
    """恢复条件或验证不成立；不包含原始凭据内容。"""


def git(*args: str, input_data: bytes | None = None) -> bytes:
    """限时执行无 hook 的本地 Git，不使用 shell 或远端。"""
    process = subprocess.Popen(
        ["git", "-c", "core.hooksPath=/dev/null", *args],
        stdin=subprocess.PIPE if input_data is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(input_data, timeout=GIT_TIMEOUT)
    except subprocess.TimeoutExpired as exc:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
        raise RecoveryError("本地 Git 操作超过 60 秒，已停止本次进程组") from exc
    if process.returncode:
        raise RecoveryError("本地 Git 操作失败：" + stderr.decode("utf-8", errors="replace").strip())
    return stdout


def file_sha256(filename: Path) -> str:
    digest = hashlib.sha256()
    with filename.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RecoveryError("元数据包含重复字段")
        result[key] = value
    return result


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RecoveryError(message)


def valid_sha1(value) -> bool:
    return isinstance(value, str) and SHA1.fullmatch(value) is not None


def valid_sha256(value) -> bool:
    return isinstance(value, str) and SHA256.fullmatch(value) is not None


def valid_ref(ref) -> bool:
    if not isinstance(ref, str) or not ref.startswith("refs/"):
        return False
    try:
        git("check-ref-format", ref)
    except RecoveryError:
        return False
    return True


def load_metadata(filename: Path) -> dict:
    try:
        metadata = json.loads(filename.read_text(encoding="utf-8"), object_pairs_hook=unique_fields)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RecoveryError("无法读取有效的 UTF-8 JSON 元数据") from exc
    require(isinstance(metadata, dict), "元数据必须是对象")
    require(type(metadata.get("schema")) is int and metadata["schema"] == 1, "不支持的元数据 schema")
    require(metadata.get("object_format") == "sha1", "本恢复包只支持记录中的 SHA-1 Git 对象")
    require(valid_sha256(metadata.get("bundle_sha256")), "bundle SHA-256 无效")
    require(valid_sha256(metadata.get("shallow_sha256")), "shallow SHA-256 无效")

    commits = metadata.get("commits")
    require(isinstance(commits, list) and 0 < len(commits) <= 100000, "原始提交列表为空或超限")
    require(type(metadata.get("expected_commit_count")) is int and metadata["expected_commit_count"] == len(commits),
            "预期提交数与元数据不一致")
    known = set()
    for row in commits:
        require(isinstance(row, dict) and valid_sha1(row.get("sha")), "原始提交 ID 无效")
        require(row["sha"] not in known, "原始提交 ID 重复")
        known.add(row["sha"])
        require(valid_sha1(row.get("tree")) and valid_sha256(row.get("object_sha256"))
                and valid_sha256(row.get("message_sha256")), "原始提交内容哈希无效")
        require(isinstance(row.get("parents"), list) and all(valid_sha1(value) for value in row["parents"]),
                "原始父提交列表无效")
        require(isinstance(row.get("author"), str) and isinstance(row.get("committer"), str),
                "原始作者或提交者元数据缺失")
        require(row.get("encoding") is None or isinstance(row.get("encoding"), str), "提交编码元数据无效")

    refs = metadata.get("refs")
    require(isinstance(refs, dict) and refs, "原始 refs 缺失")
    for ref, sha in refs.items():
        require(valid_ref(ref) and valid_sha1(sha) and sha in known, "ref 名称或目标提交无效")
    symbolic = metadata.get("symbolic_refs")
    require(isinstance(symbolic, dict), "symbolic refs 必须是对象")
    for ref, target in symbolic.items():
        require(valid_ref(ref) and valid_ref(target) and ref in refs and target in refs and refs[ref] == refs[target],
                "symbolic ref 目标无效")
        seen = {ref}
        while target in symbolic:
            require(target not in seen, "symbolic refs 存在循环")
            seen.add(target)
            target = symbolic[target]

    head = metadata.get("head")
    require(isinstance(head, dict) and valid_ref(head.get("symbolic_target")) and head.get("symbolic_target") in refs
            and head.get("sha") == refs[head["symbolic_target"]], "HEAD 元数据无效")
    bundle_refs = metadata.get("bundle_refs")
    expected_bundle_refs = dict(refs)
    expected_bundle_refs["HEAD"] = head["sha"]
    require(bundle_refs == expected_bundle_refs, "bundle refs 与原始 refs/HEAD 不一致")

    try:
        shallow_bytes = base64.b64decode(metadata.get("shallow_bytes_base64", ""), validate=True)
        shallow = shallow_bytes.decode("ascii").splitlines()
    except (binascii.Error, UnicodeError, TypeError) as exc:
        raise RecoveryError("shallow 字节编码无效") from exc
    require(shallow == metadata.get("shallow") and all(value in known for value in shallow)
            and len(set(shallow)) == len(shallow), "shallow 边界无效")
    require(hashlib.sha256(shallow_bytes).hexdigest() == metadata["shallow_sha256"], "shallow 字节哈希不一致")
    missing = [{"child": row["sha"], "parent": parent}
               for row in commits for parent in row["parents"] if parent not in known]
    require(missing == metadata.get("missing_parents"), "缺失父提交说明与原始提交不一致")
    require(all(row["child"] in shallow for row in missing), "缺失父提交未被真实 shallow 边界覆盖")
    return metadata


def commit_fields(raw: bytes) -> dict:
    header, message = raw.split(b"\n\n", 1)
    result = {"parents": [], "message_sha256": hashlib.sha256(message).hexdigest(),
              "object_sha256": hashlib.sha256(raw).hexdigest(), "encoding": None}
    for line in header.splitlines():
        if line.startswith(b"parent "):
            result["parents"].append(line[7:].decode("ascii"))
        elif not line.startswith(b" ") and b" " in line:
            key, value = line.split(b" ", 1)
            if key in (b"tree", b"author", b"committer", b"encoding"):
                result[key.decode()] = value.decode("utf-8")
    return result


def verify_original_repository(target: Path, metadata: dict) -> dict:
    rows = git("-C", str(target), "for-each-ref", "--format=%(refname) %(objectname) %(symref)").decode().splitlines()
    actual_refs = {}
    actual_symbolic = {}
    for line in rows:
        parts = line.split()
        actual_refs[parts[0]] = parts[1]
        if len(parts) == 3:
            actual_symbolic[parts[0]] = parts[2]
    require(actual_refs == metadata["refs"] and actual_symbolic == metadata["symbolic_refs"], "恢复后的 refs 不一致")
    require(git("-C", str(target), "symbolic-ref", "HEAD").decode().strip() == metadata["head"]["symbolic_target"],
            "恢复后的 HEAD 指向不一致")
    require(git("-C", str(target), "rev-parse", "HEAD").decode().strip() == metadata["head"]["sha"],
            "恢复后的 HEAD SHA 不一致")
    actual_shallow = (target / "shallow").read_bytes() if (target / "shallow").exists() else b""
    require(actual_shallow == base64.b64decode(metadata["shallow_bytes_base64"]), "恢复后的 shallow 字节不一致")
    reachable = set(git("-C", str(target), "rev-list", "--all").decode().splitlines())
    require(reachable == {row["sha"] for row in metadata["commits"]}, "恢复后的可达提交集合不一致")
    for expected in metadata["commits"]:
        actual = commit_fields(git("-C", str(target), "cat-file", "commit", expected["sha"]))
        for key in ("tree", "parents", "author", "committer", "encoding", "message_sha256", "object_sha256"):
            require(actual[key] == expected.get(key), "原始提交内容或元数据验证失败：" + expected["sha"])
    git("-C", str(target), "fsck", "--full")
    return {"target": str(target), "bare": True, "head_sha": metadata["head"]["sha"],
            "refs_verified": len(actual_refs), "commits_verified": len(reachable),
            "shallow": bool(metadata["shallow"]), "missing_parents": metadata["missing_parents"], "fsck": "passed"}


def restore(target: Path, bundle: Path, metadata_path: Path) -> dict:
    target = Path(target).expanduser().absolute()
    require(target.name not in ("", ".", ".."), "目标目录名称无效")
    require(not os.path.lexists(target), "目标已存在；拒绝写入或覆盖")
    require(target.parent.is_dir(), "目标父目录不存在；请先创建父目录")
    metadata = load_metadata(Path(metadata_path))
    bundle = Path(bundle).expanduser().resolve(strict=True)
    require(bundle.is_file() and file_sha256(bundle) == metadata["bundle_sha256"], "原对象 bundle SHA-256 不一致")
    bundle_heads = {}
    for line in git("bundle", "list-heads", str(bundle)).decode().splitlines():
        sha, ref = line.split()
        bundle_heads[ref] = sha
    require(bundle_heads == metadata["bundle_refs"], "bundle 中的 refs 与元数据不一致")

    previous_umask = os.umask(0o077)
    try:
        # mkdir(exist_ok=False) 再次检查竞争条件，只允许本次创建的新目录。
        target.mkdir(mode=0o700)
        git("init", "--bare", "--template=", "--object-format=sha1", str(target))
        shallow = base64.b64decode(metadata["shallow_bytes_base64"])
        if shallow:
            (target / "shallow").write_bytes(shallow)
        git("-C", str(target), "bundle", "unbundle", str(bundle))
        require(file_sha256(bundle) == metadata["bundle_sha256"], "读取期间 bundle 内容发生变化")
        commands = [f"create {ref} {sha}\n" for ref, sha in metadata["refs"].items()
                    if ref not in metadata["symbolic_refs"]]
        git("-C", str(target), "update-ref", "--stdin", input_data="".join(commands).encode("ascii"))
        for ref, destination in metadata["symbolic_refs"].items():
            git("-C", str(target), "symbolic-ref", ref, destination)
        git("-C", str(target), "symbolic-ref", "HEAD", metadata["head"]["symbolic_target"])
        return verify_original_repository(target, metadata)
    finally:
        os.umask(previous_umask)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, required=True, help="全新 bare 仓库路径，必须不存在")
    parser.add_argument("--bundle", type=Path, default=HERE / "source-original-history.bundle")
    parser.add_argument("--metadata", type=Path, default=HERE / "source-original-metadata.json")
    args = parser.parse_args()
    try:
        report = restore(args.target, args.bundle, args.metadata)
    except (RecoveryError, OSError, UnicodeError) as exc:
        print("恢复失败：" + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
