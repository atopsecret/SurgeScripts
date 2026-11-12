# 引擎：Egern 原生 jq 离线回归 | 语言：Python 3.11+
# 构建：无需编译
# 运行：python3 -m unittest discover -s egern -p test_camscanner.py -v
# 依赖：PyYAML 6、jq 1.6+；仅使用本地合成 JSON，不发送业务请求
"""执行模块里的真实 jq 表达式，不用 Python 实现冒充 Egern 重写。"""

import copy
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import unittest
from urllib.parse import parse_qs, urlsplit

VALIDATOR_FILE = Path(__file__).with_name("validate.py")
SPEC = importlib.util.spec_from_file_location("camscanner_validator", VALIDATOR_FILE)
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)
ROOT = VALIDATOR_FILE.resolve().parents[1]
MODULE_PATH = ROOT / "egern/camscanner.egern.yaml"
MODULE_URL = "https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/egern/camscanner.egern.yaml"
EXPIRY = "2013017600"


class CamScannerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = validator.load(MODULE_PATH)
        cls.rule = cls.module["body_rewrites"][0]["response_jq"]
        cls.pattern = re.compile(cls.rule["match"])
        cls.jq = shutil.which("jq")
        if cls.jq is None:
            raise RuntimeError("运行真实 jq 回归前，请安装 jq 1.6+。")

    def rewrite(self, payload):
        result = subprocess.run(
            [self.jq, "-c", self.rule["filter"]],
            input=json.dumps(payload, ensure_ascii=False),
            text=True, capture_output=True, check=True, timeout=5,
        )
        lines = result.stdout.splitlines()
        self.assertEqual(len(lines), 1, "每个输入必须恰好输出一个 JSON 值")
        self.assertEqual(result.stderr, "")
        return json.loads(lines[0])

    def test_module_is_native_and_self_contained(self):
        self.assertEqual(validator.validate_module(MODULE_PATH, ROOT), set())
        self.assertEqual(len(self.module["body_rewrites"]), 1)
        self.assertEqual(set(self.module["body_rewrites"][0]), {"response_jq"})
        for key in ["scriptings", "map_locals", "rules", "compat_arguments", "env_schema"]:
            self.assertNotIn(key, self.module)
        self.assertEqual(set(self.rule), {"match", "filter"})

    def test_metadata_and_source_attribution(self):
        self.assertIn("1.0.0", self.module["description"])
        self.assertIn("保留响应结构", self.module["description"])
        self.assertIn("NobyDa", self.module["author"])
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn("https://yfamilys.com/module/camscanner.sgmodule", source)
        self.assertIn("https://raw.githubusercontent.com/NobyDa/Script/master/Surge/JS/CamScanner.js", source)
        self.assertEqual(self.module["manual"], "https://github.com/atopsecret/SurgeScripts/blob/main/egern/camscanner.md")
        self.assertTrue((ROOT / "egern/camscanner.md").is_file())

    def test_mitm_is_limited_to_the_two_target_hosts(self):
        self.assertEqual(self.module["mitm"], {"hostnames": {"includes": [
            "api.intsig.net", "api-cs.intsig.net",
        ]}})
        self.assertNotIn("ap*.intsig.net", self.module["mitm"]["hostnames"]["includes"])

    def test_both_hosts_query_variants_and_default_https_port(self):
        for host in ["api.intsig.net", "api-cs.intsig.net"]:
            for port in ["", ":443"]:
                for query in ["", "?", "?uid=fixture", "?x=1&uid=fixture", "?x=%E6%B5%8B%E8%AF%95"]:
                    url = f"https://{host}{port}/purchase/cs/query_property{query}"
                    with self.subTest(url=url):
                        self.assertRegex(url, self.pattern)

    def test_unrelated_hosts_protocols_ports_and_userinfo_do_not_match(self):
        path = "/purchase/cs/query_property?uid=fixture"
        for prefix in [
            "http://api.intsig.net", "https://api-test.intsig.net",
            "https://api-cs.intsig.net.evil.invalid", "https://api.intsig.net@evil.invalid",
            "https://user@api.intsig.net", "https://api.intsig.net:444",
            "https://api.intsig.net:8443", "https://intsig.net", "https://example.invalid",
        ]:
            with self.subTest(prefix=prefix):
                self.assertNotRegex(prefix + path, self.pattern)

    def test_endpoint_suffixes_fragments_and_whitespace_do_not_match(self):
        base = "https://api.intsig.net/purchase/cs/query_property"
        for suffix in ["_v2?x=1", "Extra", "/", "/extra?x=1", ";x=1",
                       "#fragment", "?x=1#fragment", "?bad value", "?x=1\n", "\n", "\r\n"]:
            with self.subTest(suffix=suffix):
                self.assertNotRegex(base + suffix, self.pattern)
        self.assertNotRegex("prefix " + base, self.pattern)
        self.assertNotRegex("https://api.intsig.net/other/purchase/cs/query_property", self.pattern)

    def test_minimal_original_response_keeps_the_original_string_value(self):
        payload = {"data": {"psnl_vip_property": {"expiry": "0"}}}
        output = self.rewrite(payload)
        self.assertEqual(output, {"data": {"psnl_vip_property": {"expiry": EXPIRY}}})
        self.assertIsInstance(output["data"]["psnl_vip_property"]["expiry"], str)

    def test_unrelated_top_level_data_and_vip_fields_are_preserved(self):
        payload = {
            "code": 0, "request_id": "synthetic-request", "message": "原有消息",
            "data": {
                "psnl_vip_property": {"expiry": 0, "plan": "fixture", "future": {"flags": [1, 2]}},
                "account": {"id": "fixture-account"}, "quota": {"used": 3, "limit": 10},
                "future": [None, False, {"保留": True}],
            },
        }
        expected = copy.deepcopy(payload)
        expected["data"]["psnl_vip_property"]["expiry"] = EXPIRY
        self.assertEqual(self.rewrite(payload), expected)

    def test_missing_vip_object_is_created_under_existing_data(self):
        for payload in [{"data": {}}, {"data": {"quota": {"used": 3}}}]:
            with self.subTest(payload=payload):
                expected = copy.deepcopy(payload)
                expected["data"]["psnl_vip_property"] = {"expiry": EXPIRY}
                self.assertEqual(self.rewrite(payload), expected)

    def test_null_vip_object_is_created_without_losing_other_fields(self):
        payload = {"data": {"psnl_vip_property": None, "other": "keep"}}
        self.assertEqual(self.rewrite(payload), {"data": {
            "psnl_vip_property": {"expiry": EXPIRY}, "other": "keep",
        }})

    def test_missing_or_null_expiry_is_written_as_a_string(self):
        for vip in [{}, {"expiry": None}, {"expiry": 0}, {"expiry": False}]:
            with self.subTest(vip=vip):
                output = self.rewrite({"data": {"psnl_vip_property": vip}})
                self.assertEqual(output["data"]["psnl_vip_property"]["expiry"], EXPIRY)

    def test_non_object_top_level_values_are_unchanged(self):
        for payload in [None, True, False, 0, 42, "fixture", [], [{"data": {}}]]:
            with self.subTest(payload=payload):
                self.assertEqual(self.rewrite(payload), payload)

    def test_missing_null_or_unknown_data_does_not_create_a_success_body(self):
        for payload in [{}, {"error": "synthetic-error"}, {"data": None}, {"data": []},
                        {"data": "fixture"}, {"data": 0}, {"data": False}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.rewrite(payload), payload)

    def test_unknown_vip_scalar_and_array_shapes_are_unchanged(self):
        for vip in [False, True, 0, 42, "fixture", [], [{"expiry": "0"}]]:
            payload = {"data": {"psnl_vip_property": vip, "other": "keep"}}
            with self.subTest(vip=vip):
                self.assertEqual(self.rewrite(payload), payload)

    def test_server_result_flags_are_never_fabricated_or_overwritten(self):
        payload = {"code": 403, "success": False, "error": "synthetic-error", "data": {
            "psnl_vip_property": {"expiry": "0"}, "server_flag": False,
        }}
        expected = copy.deepcopy(payload)
        expected["data"]["psnl_vip_property"]["expiry"] = EXPIRY
        self.assertEqual(self.rewrite(payload), expected)

    def test_rewrite_is_idempotent(self):
        payload = {"data": {"psnl_vip_property": {"expiry": "0"}, "other": "keep"}}
        once = self.rewrite(payload)
        self.assertEqual(self.rewrite(once), once)

    def test_unicode_and_ordinary_numbers_survive_the_native_filter(self):
        payload = {"标题": "扫描件 📄", "data": {"psnl_vip_property": {},
                   "count": 123456789, "ratio": 1.25, "text": "中英文\n正文"}}
        expected = copy.deepcopy(payload)
        expected["data"]["psnl_vip_property"]["expiry"] = EXPIRY
        self.assertEqual(self.rewrite(payload), expected)

    def test_invalid_or_empty_json_does_not_produce_a_synthetic_body(self):
        for body in ["{broken", "<html>fixture</html>", "callback({})", "", "  "]:
            with self.subTest(body=body):
                result = subprocess.run([self.jq, "-c", self.rule["filter"]], input=body,
                                        text=True, capture_output=True, timeout=5)
                self.assertEqual(result.stdout, "")
                if body.strip():
                    self.assertNotEqual(result.returncode, 0)

    def test_one_click_import_link_points_to_the_published_module(self):
        guide = (ROOT / "egern/camscanner.md").read_text(encoding="utf-8")
        match = re.search(r"\]\((egern:/modules/new\?[^\s)]+)\)", guide)
        self.assertIsNotNone(match)
        parsed = urlsplit(match.group(1))
        self.assertEqual((parsed.scheme, parsed.netloc, parsed.path), ("egern", "", "/modules/new"))
        self.assertEqual(parse_qs(parsed.query, strict_parsing=True), {
            "name": [self.module["name"]], "url": [MODULE_URL],
        })
        self.assertIn(MODULE_URL, guide)


if __name__ == "__main__":
    unittest.main()
