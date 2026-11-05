# 引擎：Egern 本地静态回归 | 语言：Python 3.11+
# 构建：无需编译
# 运行：python3 -m unittest discover -s egern -p test_validate.py -v
# 依赖：PyYAML；不联网、不读取私人配置
import base64
import importlib.util
from pathlib import Path
import re
import tempfile
import unittest

file = Path(__file__).with_name("validate.py")
spec = importlib.util.spec_from_file_location("egern_validator", file)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
ROOT = file.resolve().parents[1]


class ValidationTests(unittest.TestCase):
    def test_seven_modules(self):
        for path in validator.MODULES:
            with self.subTest(path=path):
                validator.validate_module(ROOT / path, ROOT)

    def test_surgescript_field_rejected(self):
        with self.assertRaises(ValueError):
            validator.validate_rule({"url_regex": {"match": "^http", "policy": "REJECT", "extended-matching": True}})

    def test_private_policy_rejected(self):
        with self.assertRaises(ValueError):
            validator.validate_rule({"domain": {"match": "example.invalid", "policy": "PrivateNode"}})

    def test_logic_shape_and_ua_scope(self):
        pdd = validator.load(ROOT / "pinduoduo/pdd-adblock.egern.yaml")
        ands = [item["and"] for item in pdd["rules"] if "and" in item]
        self.assertEqual(len(ands), 4)
        for body in ands:
            self.assertEqual(len(body["match"]), 2)
        quic = next(body for body in ands if any("protocol" in x for x in body["match"]))
        self.assertEqual(quic["match"], [{"domain": {"match": "api.pinduoduo.com"}}, {"protocol": {"match": "quic"}}])

    def test_logic_child_policy_rejected(self):
        with self.assertRaises(ValueError):
            validator.validate_rule({"and": {"match": [{"domain": {"match": "example.invalid", "policy": "DIRECT"}}, {"protocol": {"match": "quic"}}], "policy": "REJECT"}})

    def test_a_map_local_original_bytes(self):
        source = (ROOT / "amap/amap-adblock.sgmodule").read_text()
        lines = [line for line in source.splitlines() if line.startswith("^https") and 'data-type=base64 data="' in line]
        native = validator.load(ROOT / "amap/amap-adblock.egern.yaml")["map_locals"]
        self.assertEqual(len(lines), 2)
        for index, line in enumerate(lines):
            expected = base64.b64decode(re.search(r'data="([A-Za-z0-9+/=]+)"', line)[1])
            self.assertEqual(native[index]["body"].encode(), expected)
        self.assertIn("boundary=amap-cleaner-2-0-0", native[0]["headers"]["Content-Type"])

    def test_amap_rt_boundary(self):
        data = validator.load(ROOT / "amap/amap-adblock.egern.yaml")["map_locals"][0]
        regex = re.compile(data["match"])
        self.assertRegex("https://aos.amap.com/ws/aos/alimama/splash_screen_rt?x=1", regex)
        self.assertNotRegex("https://aos.amap.com/ws/aos/alimama/splash_screen_rt_other", regex)
        self.assertNotRegex("https://aos.amap.com.evil.invalid/ws/aos/alimama/splash_screen_rt", regex)

    def test_hongguo_exact_original_subset(self):
        mapping = {"domain": "DOMAIN", "domain_suffix": "DOMAIN-SUFFIX", "domain_keyword": "DOMAIN-KEYWORD"}
        source = (ROOT / "hongguo/hongguo-adblock.sgmodule").read_text()
        expected = {tuple(line.split(",")) for line in source.splitlines() if line.startswith(tuple(mapping.values())) and not line.startswith(("DOMAIN-SUFFIX,dns.alidns.com,", "DOMAIN-SUFFIX,doh.pub,"))}
        native = validator.load(ROOT / "hongguo/hongguo-adblock.egern.yaml")
        actual = {(mapping[kind], body["match"], body["policy"]) for item in native["rules"] for kind, body in item.items()}
        self.assertEqual(len(actual), 78)
        self.assertEqual(expected, actual)

    def test_hongguo_ad_not_content_video(self):
        native = validator.load(ROOT / "hongguo/hongguo-adblock.egern.yaml")
        suffixes = [item["domain_suffix"]["match"] for item in native["rules"] if "domain_suffix" in item]
        self.assertTrue(any("v5-reading-ad.qznovelvod.com" == suffix for suffix in suffixes))
        self.assertFalse(any("v5-reading-video.qznovelvod.com" == suffix or suffix == "qznovelvod.com" for suffix in suffixes))
        self.assertNotIn("*.snssdk.com", native["mitm"]["hostnames"]["includes"])

    def test_hongguo_local_match_strict(self):
        regex = re.compile(validator.load(ROOT / "hongguo/hongguo-adblock.egern.yaml")["map_locals"][0]["match"])
        for host in ["api.pangolin-sdk-toutiao.com", "api.pangolin-sdk-toutiao-b.com", "api.pangolin-sdk-toutiao1.com"]:
            self.assertRegex("https://" + host + "/api/ad/union/sdk/get_ads/", regex)
        self.assertNotRegex("https://pangolin-sdk-toutiao.com.evil.invalid/api/ad/union/sdk/", regex)

    def test_jd_splash_not_product_image(self):
        maps = validator.load(ROOT / "jd/jd-adblock.egern.yaml")["map_locals"]
        splash = re.compile(next(x["match"] for x in maps if "s1125x2436_jfs" in x["match"]))
        self.assertRegex("https://m.360buyimg.com/mobilecms/s1125x2436_jfs/fixture.jpg", splash)
        self.assertNotRegex("https://m.360buyimg.com/mobilecms/s400x400_jfs/fixture.jpg", splash)

    def test_no_public_ca(self):
        for path in validator.MODULES:
            data = validator.load(ROOT / path)
            if "mitm" in data:
                self.assertEqual(set(data["mitm"]), {"hostnames"})

    def test_duplicate_yaml_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.yaml"
            path.write_text("name: first\nname: second\n")
            with self.assertRaises(ValueError):
                validator.load(path)

    def test_script_traversal_rejected(self):
        for ref in ("main", "39fe49916d989493e16695b4e0c706a9d4a27f2c"):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                validator.script_path(f"https://raw.githubusercontent.com/atopsecret/SurgeScripts/{ref}/../outside.egern.js", ROOT)

    def test_pinned_commit_script_allowed(self):
        url = "https://raw.githubusercontent.com/atopsecret/SurgeScripts/39fe49916d989493e16695b4e0c706a9d4a27f2c/weilai/weilai-auto-checkin.egern.js?v=3.0.1"
        self.assertEqual(validator.script_path(url, ROOT), ROOT / "weilai/weilai-auto-checkin.egern.js")

    def test_short_or_unknown_script_ref_rejected(self):
        for ref in ("dev", "39fe499", "g" * 40, "a" * 41):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                validator.script_path(f"https://raw.githubusercontent.com/atopsecret/SurgeScripts/{ref}/weilai/weilai-auto-checkin.egern.js", ROOT)

    def test_old_account_script_rejected(self):
        with self.assertRaises(ValueError):
            validator.script_path("https://raw.githubusercontent.com/skernelx/SurgeScripts/master/jd/jd-ad-block.egern.js", ROOT)


if __name__ == "__main__":
    unittest.main()
