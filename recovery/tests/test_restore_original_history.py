# Engine | Python 3.10+ / Git | Python
# Build: 无需构建
# Run: python3 -m unittest discover -s recovery/tests -v
# Deps: Python 标准库与 Git；只操作新临时目录，不发网络请求
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


RECOVERY = Path(__file__).resolve().parents[1]
HELPER = RECOVERY / "restore_original_history.py"
BUNDLE = RECOVERY / "source-original-history.bundle"
METADATA = RECOVERY / "source-original-metadata.json"
SPEC = importlib.util.spec_from_file_location("restore_original_history", HELPER)
restore_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(restore_module)


class RestoreOriginalHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle_hash = restore_module.file_sha256(BUNDLE)
        cls.metadata_hash = restore_module.file_sha256(METADATA)
        cls.original = json.loads(METADATA.read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        # 测试不改恢复包和原始元数据。
        assert restore_module.file_sha256(BUNDLE) == cls.bundle_hash
        assert restore_module.file_sha256(METADATA) == cls.metadata_hash

    def setUp(self):
        parent = os.environ.get("HISTORY_RECOVERY_TEST_DIR")
        if parent:
            Path(parent).mkdir(mode=0o700, parents=True, exist_ok=True)
        self.directory = Path(tempfile.mkdtemp(prefix="original-history-test-", dir=parent))
        self.target = self.directory / "restored.git"
        self.metadata = json.loads(json.dumps(self.original))
        self.fixture = self.directory / "metadata.json"

    def metadata_path(self):
        self.fixture.write_text(json.dumps(self.metadata), encoding="utf-8")
        return self.fixture

    def restore(self):
        return restore_module.restore(self.target, BUNDLE, self.metadata_path())

    def test_success_restores_exact_original_objects_refs_and_shallow(self):
        report = self.restore()
        self.assertTrue(report["bare"])
        self.assertEqual(report["head_sha"], self.original["head"]["sha"])
        self.assertEqual(report["refs_verified"], 4)
        self.assertEqual(report["commits_verified"], 22)
        self.assertTrue(report["shallow"])
        self.assertEqual(report["fsck"], "passed")
        self.assertEqual((self.target / "shallow").read_bytes(),
                         base64.b64decode(self.original["shallow_bytes_base64"]))
        self.assertEqual(restore_module.git("-C", str(self.target), "symbolic-ref", "refs/remotes/recovery/HEAD").decode().strip(),
                         "refs/remotes/recovery/master")
        self.assertEqual(restore_module.git("-C", str(self.target), "rev-parse", "--is-bare-repository").strip(), b"true")

    def test_cli_succeeds_from_a_non_repository_directory(self):
        result = subprocess.run(
            [sys.executable, str(HELPER), "--target", str(self.target), "--bundle", str(BUNDLE), "--metadata", str(METADATA)],
            cwd=self.directory, capture_output=True, text=True, timeout=60,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["commits_verified"], 22)

    def test_existing_nonempty_directory_is_never_modified(self):
        self.target.mkdir()
        marker = self.target / "keep.txt"
        marker.write_text("keep-existing-data", encoding="utf-8")
        with self.assertRaisesRegex(restore_module.RecoveryError, "目标已存在"):
            self.restore()
        self.assertEqual(marker.read_text(), "keep-existing-data")
        self.assertEqual(sorted(path.name for path in self.target.iterdir()), ["keep.txt"])

    def test_existing_empty_directory_is_rejected(self):
        self.target.mkdir()
        with self.assertRaisesRegex(restore_module.RecoveryError, "目标已存在"):
            self.restore()
        self.assertEqual(list(self.target.iterdir()), [])

    def test_dangling_symlink_is_rejected_without_following_or_replacing_it(self):
        destination = self.directory / "does-not-exist"
        self.target.symlink_to(destination)
        with self.assertRaisesRegex(restore_module.RecoveryError, "目标已存在"):
            self.restore()
        self.assertTrue(self.target.is_symlink())
        self.assertFalse(destination.exists())

    def test_bundle_sha256_mismatch_fails_before_target_creation(self):
        self.metadata["bundle_sha256"] = "0" * 64
        with self.assertRaisesRegex(restore_module.RecoveryError, "bundle SHA-256"):
            self.restore()
        self.assertFalse(self.target.exists())

    def test_duplicate_json_fields_are_rejected(self):
        self.fixture.write_text('{"schema":1,"schema":1}', encoding="utf-8")
        with self.assertRaisesRegex(restore_module.RecoveryError, "重复字段"):
            restore_module.restore(self.target, BUNDLE, self.fixture)
        self.assertFalse(self.target.exists())

    def test_invalid_ref_names_and_non_string_targets_are_rejected(self):
        for change in ("name", "value"):
            with self.subTest(change=change):
                self.metadata = json.loads(json.dumps(self.original))
                if change == "name":
                    self.metadata["refs"]["refs/heads/../bad"] = self.original["head"]["sha"]
                else:
                    self.metadata["refs"]["refs/heads/main"] = []
                with self.assertRaises(restore_module.RecoveryError):
                    self.restore()
                self.assertFalse(self.target.exists())

    def test_unknown_shallow_boundary_and_bad_shallow_hash_are_rejected(self):
        for change in ("boundary", "hash"):
            with self.subTest(change=change):
                self.metadata = json.loads(json.dumps(self.original))
                if change == "boundary":
                    raw = ("0" * 40 + "\n").encode()
                    self.metadata["shallow"] = ["0" * 40]
                    self.metadata["shallow_bytes_base64"] = base64.b64encode(raw).decode()
                    self.metadata["shallow_sha256"] = hashlib.sha256(raw).hexdigest()
                else:
                    self.metadata["shallow_sha256"] = "0" * 64
                with self.assertRaises(restore_module.RecoveryError):
                    self.restore()
                self.assertFalse(self.target.exists())

    def test_cyclic_symbolic_ref_and_unknown_head_are_rejected(self):
        for change in ("cycle", "head"):
            with self.subTest(change=change):
                self.metadata = json.loads(json.dumps(self.original))
                if change == "cycle":
                    self.metadata["symbolic_refs"]["refs/remotes/recovery/HEAD"] = "refs/remotes/recovery/HEAD"
                else:
                    self.metadata["head"]["symbolic_target"] = "refs/heads/not-recorded"
                with self.assertRaises(restore_module.RecoveryError):
                    self.restore()
                self.assertFalse(self.target.exists())

    def test_false_missing_parent_narrative_is_rejected(self):
        self.metadata["missing_parents"] = []
        with self.assertRaisesRegex(restore_module.RecoveryError, "缺失父提交说明"):
            self.restore()
        self.assertFalse(self.target.exists())

    def test_original_commit_content_mismatch_fails_verification_and_keeps_new_directory(self):
        self.metadata["commits"][0]["object_sha256"] = "0" * 64
        with self.assertRaisesRegex(restore_module.RecoveryError, "原始提交内容或元数据验证失败"):
            self.restore()
        self.assertTrue(self.target.is_dir())
        self.assertTrue((self.target / "objects").is_dir())

    def test_missing_target_parent_is_not_created_implicitly(self):
        self.target = self.directory / "missing-parent" / "restored.git"
        with self.assertRaisesRegex(restore_module.RecoveryError, "目标父目录不存在"):
            self.restore()
        self.assertFalse(self.target.parent.exists())


if __name__ == "__main__":
    unittest.main()
