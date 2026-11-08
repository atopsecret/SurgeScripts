# 引擎：Egern 本地静态回归 | 语言：Python 3.11+
# 构建：无需编译
# 运行：python3 -m unittest discover -s egern -p test_validate.py -v
# 依赖：PyYAML；不联网、不读取私人配置
import base64
import importlib.util
import json
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
    def test_all_native_modules(self):
        self.assertEqual(len(validator.MODULES), 9)
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

    def test_jd_unique_static_identity_and_recommend_variants(self):
        data = validator.load(ROOT / "jd/jd-adblock.egern.yaml")
        patterns = [re.compile(row["match"]) for row in data["map_locals"]]
        patterns += [re.compile(row["url_regex"]["match"]) for row in data["rules"]]
        def matches(tail):
            return any(pattern.search("https://api.m.jd.com/client.action?" + tail) for pattern in patterns)
        for tail in ["functionId=uniformRecommend0", "client=ios&functionId=uniformRecommend6&v=1", "body=%7B%22x%22%3A%22a=b%22%7D&functionId=queryMaterialAdverts"]:
            self.assertTrue(matches(tail), tail)
        for tail in ["functionId=uniformRecommendation", "functionId=uniformRecommend99", "functionId=queryPagePopWindow_extra", "functionId=queryMaterialAdverts&functionId=search", "functionId=queryMaterialAdverts&functionId", "functionId&functionId=queryMaterialAdverts", "%66unctionId=search&functionId=queryMaterialAdverts", "functionId=queryMaterialAdverts&%66unctionId=search"]:
            self.assertFalse(matches(tail), tail)
        login = next(pattern for pattern in patterns if "loginType" in pattern.pattern)
        self.assertRegex("https://api.m.jd.com/?client=ios&loginType=11&v=1", login)
        for tail in ["loginType=110", "loginType=11&loginType=0", "loginType=11&loginType", "%6CoginType=0&loginType=11"]:
            self.assertNotRegex("https://api.m.jd.com/?" + tail, login)

    def test_jd_static_rules_equivalent_between_clients(self):
        data = validator.load(ROOT / "jd/jd-adblock.egern.yaml")
        text = (ROOT / "jd/jd-adblock.sgmodule").read_text()
        local = text.split("[Map Local]", 1)[1].split("[MITM]", 1)[0]
        surge = [line.split(" data-type=", 1)[0].replace(r"\/", "/") for line in local.splitlines() if line.startswith("^")]
        self.assertEqual(surge, [row["match"] for row in data["map_locals"]])

    def test_jd_binary_response_and_mitm_contract(self):
        data = validator.load(ROOT / "jd/jd-adblock.egern.yaml")
        self.assertTrue(data["scriptings"][0]["http_response"]["binary_body"])
        self.assertEqual(set(data["mitm"]["hostnames"]["includes"]), {"api.m.jd.com", "m.360buyimg.com", "apk.360buyimg.com", "bdsp-x.jd.com", "dsp-x.jd.com"})
        self.assertTrue(all(row[next(iter(row))]["script_url"].endswith("?v=2.0.0") for row in data["scriptings"]))

    def test_cainiao_known_local_responses_and_scope(self):
        data = validator.load(ROOT / "cainiao/cainiao-adblock.egern.yaml")
        self.assertEqual(set(data["mitm"]["hostnames"]["includes"]), {"netflow-mtop.cainiao.com", "nbcps-mtop.cainiao.com", "cn-acs.m.cainiao.com", "e2e-mtop.cainiao.com", "longquan-mtop.cainiao.com"})
        self.assertNotIn("rules", data)
        self.assertEqual(len(data["map_locals"]), 4)
        for row in data["map_locals"]:
            self.assertEqual(row["status_code"], 404)
            self.assertEqual(row["body"], "")
            self.assertEqual(row["headers"]["X-Cainiao-Cleaner-Version"], "eg-native-20261108-1.0.0")
        patterns = [re.compile(row["match"]) for row in data["map_locals"]]
        self.assertTrue(any(p.search("https://nbcps-mtop.cainiao.com/gw/mtop.cainiao.nbcps.presentation.fetch.cn/1.0/?x=1") for p in patterns))
        for url in ["https://nbcps-mtop.cainiao.com.evil.test/gw/mtop.cainiao.nbcps.presentation.fetch.cn", "https://cn-acs.m.cainiao.com/gw/mtop.cainiao.adkeyword.get.cnx", "https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.future/1.0/"]:
            self.assertFalse(any(p.search(url) for p in patterns), url)

    def test_cainiao_native_body_and_fixed_sources(self):
        data = validator.load(ROOT / "cainiao/cainiao-adblock.egern.yaml")
        response = data["scriptings"][0]["http_response"]
        self.assertTrue(response["body_required"])
        self.assertTrue(response["binary_body"])
        pattern = re.compile(response["match"])
        self.assertRegex("https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn/1.0/", pattern)
        self.assertNotRegex("https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cnx", pattern)
        sources = json.loads((ROOT / "cainiao/sources.json").read_text())
        self.assertEqual(sources["original_http_status"], 403)
        self.assertEqual(sources["migrated_response_jq_rules"], 3)
        self.assertFalse(sources["inactive_script_observation"]["referenced_by_active_plugin"])
        for source in sources["mirrors"]:
            self.assertRegex(source["commit"], r"^[0-9a-f]{40}$")
            self.assertRegex(source["sha256"], r"^[0-9a-f]{64}$")

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

    def test_weather_rule_scope_and_binary_mode(self):
        module = validator.load(ROOT / "apple-weather/apple-weather-enhancer.egern.yaml")
        self.assertEqual(len(module["rules"]), 4)
        quic = module["rules"][-1]["and"]
        self.assertEqual(quic["match"][0]["or"]["match"], [
            {"asn": {"match": "714", "no_resolve": True}},
            {"asn": {"match": "6185", "no_resolve": True}},
        ])
        self.assertEqual(quic["match"][1], {"protocol": {"match": "quic"}})
        self.assertEqual(module["mitm"]["hostnames"]["includes"], ["weatherkit.apple.com"])
        self.assertTrue(module["scriptings"][1]["http_response"]["binary_body"])
        self.assertEqual(len(module["env_schema"]), 8)

    def test_weather_url_boundaries(self):
        module = validator.load(ROOT / "apple-weather/apple-weather-enhancer.egern.yaml")
        pattern = re.compile(module["scriptings"][1]["http_response"]["match"])
        self.assertRegex("https://weatherkit.apple.com/api/v2/weather/zh-CN/31/121", pattern)
        self.assertNotRegex("https://weatherkit.apple.com.evil.invalid/api/v2/weather/x", pattern)
        self.assertNotRegex("https://weatherkit.apple.com/api/v2/weather_other/x", pattern)

    def test_native_bundler_default_export(self):
        self.assertTrue(validator.is_native_source("async function a(ctx){}export{a as default};"))
        self.assertTrue(validator.is_native_source("export default async function(ctx){}"))
        self.assertFalse(validator.is_native_source("export const foo = 1;"))
        self.assertFalse(validator.is_native_source("export default async function(ctx){ $done({}); }"))

    def test_env_schema_invalid_fields_rejected(self):
        original = validator.load(ROOT / "apple-weather/apple-weather-enhancer.egern.yaml")
        for descriptor in [
            {"default_value": True}, {"options": [True, False]},
            {"options": ["a", "a"]}, {"secret": True},
            {"default_value": "bad", "options": ["a"]},
        ]:
            with self.subTest(descriptor=descriptor), tempfile.TemporaryDirectory() as directory:
                module = dict(original, env_schema={"FIXTURE": descriptor})
                path = Path(directory) / "invalid.yaml"
                path.write_text(validator.yaml.safe_dump(module))
                with self.assertRaises(ValueError):
                    validator.validate_module(path, ROOT)

    def test_weather_ui_defaults_match_native_runtime(self):
        schema = validator.load(ROOT / "apple-weather/apple-weather-enhancer.egern.yaml")["env_schema"]
        self.assertEqual(schema["Weather.Provider"]["default_value"], "ColorfulClouds")
        self.assertEqual(schema["AirQuality.Calculate.Algorithm"]["default_value"], "EU_EAQI")
        for key in ["API.ColorfulClouds.Token", "API.QWeather.Token", "API.WAQI.Token"]:
            self.assertEqual(schema[key]["default_value"], "")
        self.assertNotIn("Storage", schema)


if __name__ == "__main__":
    unittest.main()
