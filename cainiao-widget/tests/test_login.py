"""扫码助手离线测试；所有 HTTP 响应为合成数据，不执行真实登录。"""
import contextlib
from email.message import Message
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import signal
import ssl
import stat
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit

SPEC = importlib.util.spec_from_file_location("cainiao_login", Path(__file__).parents[1] / "login.py")
login = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = login
SPEC.loader.exec_module(login)


class FakeClock:
    def __init__(self):
        self.value = 0.0

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class FakeResponse(io.BytesIO):
    def __init__(self, body=b"", status=200, headers=()):
        if isinstance(body, dict):
            body = json.dumps(body).encode()
        super().__init__(body)
        self.status = status
        self.headers = Message()
        for name, value in headers:
            self.headers.add_header(name, value)

    def info(self):
        return self.headers

    def getcode(self):
        return self.status


class FakeOpener:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        if not self.responses:
            raise AssertionError("离线响应已用尽，不应发出额外请求")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def session_for(responses, seconds=180):
    clock = FakeClock()
    opener = FakeOpener(responses)
    return login.Session(login.Deadline(seconds, clock.now, clock.sleep), opener=opener), opener, clock


def qr_data(status, **extra):
    return FakeResponse({"content": {"data": {"qrCodeStatus": status, **extra}}})


def set_cookies(*values):
    return [("Set-Cookie", value) for value in values]


class UrlAndCompletionTests(unittest.TestCase):
    def test_https_boundary_and_ports(self):
        for url in ("https://taobao.com/", "https://login.taobao.com/x", "https://TMALL.COM:443/x",
                    "https://sub.cainiao.com/"):
            self.assertEqual(login.validate_url(url), url)
        for url in ("http://login.taobao.com/", "https://taobao.com.evil.test/", "https://evil-taobao.com/",
                    "https://passport.alibaba.com/", "https://user:secret@taobao.com/",
                    "https://taobao.com:8443/", "https://taobao.com/x#fragment",
                    "https://taobao.com\\@evil.test/", "https://taobao.com/\r\nInjected: secret",
                    "https://taobao.com./", "https://taobao.com:bad/", "/relative"):
            with self.subTest(url=url), self.assertRaises(login.LoginError):
                login.validate_url(url)

    def test_untrusted_initial_url_never_reaches_opener(self):
        session, opener, _ = session_for([])
        with self.assertRaises(login.LoginError):
            session.request("https://evil.test/?credential=synthetic-secret")
        self.assertEqual(opener.requests, [])

    def test_async_deduplication_and_only_one_main_redirect(self):
        urls = login.completion_urls({
            "asyncUrls": ["https://login.taobao.com/a", "https://login.taobao.com/a"],
            "miniLogouts": ["https://login.taobao.com/logout"],
            "redirect": True, "redirectUrl": "https://www.taobao.com/",
            "parentRedirect": True, "parentRedirectUrl": "https://i.taobao.com/",
            "replace": True, "replaceUrl": "https://tmall.com/",
        })
        self.assertEqual(urls, ["https://login.taobao.com/a", "https://www.taobao.com/"])

    def test_mini_fallback_and_redirect_priority(self):
        urls = login.completion_urls({
            "miniLogouts": {"one": "https://login.taobao.com/first"},
            "miniVsts": "https://login.tmall.com/second",
            "redirect": False, "redirectUrl": "https://taobao.com/ignored",
            "parentRedirect": True, "parentRedirectUrl": "https://taobao.com/parent",
            "iframeRedirect": True, "iframeRedirectUrl": "https://taobao.com/iframe",
        })
        self.assertEqual(urls, ["https://login.taobao.com/first", "https://login.tmall.com/second",
                               "https://taobao.com/parent"])
        self.assertEqual(login.completion_urls({}), [login.LOGIN_REFERER])

    def test_completion_batch_is_validated_and_bounded(self):
        with self.assertRaises(login.LoginError):
            login.completion_urls({"asyncUrls": ["https://taobao.com/ok", "https://evil.test/"]})
        with self.assertRaises(login.LoginError):
            login.completion_urls({"asyncUrls": ["https://taobao.com/" + str(i)
                                                for i in range(login.MAX_COMPLETION_URLS + 1)]})


class SessionTests(unittest.TestCase):
    def test_default_tls_verifies_hostname_and_certificate(self):
        session = login.Session(login.Deadline(5))
        handler = next(item for item in session.opener.handlers if isinstance(item, login.HTTPSHandler))
        self.assertTrue(handler._context.check_hostname)
        self.assertEqual(handler._context.verify_mode, ssl.CERT_REQUIRED)
        redirect = next(item for item in session.opener.handlers if isinstance(item, login.NoRedirect))
        self.assertIsNone(redirect.redirect_request(None, None, 302, "", {}, "https://evil.test/"))

    def test_each_hop_collects_cookie_and_scopes_next_request(self):
        session, opener, _ = session_for([
            FakeResponse(status=302, headers=set_cookies(
                "taobao_secret=one; Domain=.taobao.com; Path=/; Secure",
                "foreign=reject; Domain=.cainiao.com; Path=/",
            ) + [("Location", "https://login.tmall.com/next")]),
            FakeResponse(status=302, headers=set_cookies(
                "tmall_secret=two; Domain=.tmall.com; Path=/; Secure",
            ) + [("Location", "/finish")]),
            FakeResponse(b"ok"),
        ])
        session.follow("https://login.taobao.com/start")
        requests = [request for request, _ in opener.requests]
        self.assertIsNone(requests[1].get_header("Cookie"))
        self.assertEqual(requests[2].get_header("Cookie"), "tmall_secret=two")
        self.assertEqual(requests[2].full_url, "https://login.tmall.com/finish")
        self.assertEqual(session.cookie_header(login.PDS_URL), "taobao_secret=one")

    def test_untrusted_redirect_stops_before_sending_cookie(self):
        session, opener, _ = session_for([
            FakeResponse(status=302, headers=set_cookies(
                "sensitive=synthetic-secret; Domain=.taobao.com; Path=/",
            ) + [("Location", "https://evil.test/?ticket=synthetic-secret")]),
        ])
        with self.assertRaises(login.LoginError) as raised:
            session.follow("https://login.taobao.com/start")
        self.assertEqual(len(opener.requests), 1)
        self.assertNotIn("synthetic-secret", str(raised.exception))
        self.assertNotIn("evil.test", str(raised.exception))

    def test_redirect_limit(self):
        session, opener, _ = session_for([
            FakeResponse(status=302, headers=[("Location", "/again")])
            for _ in range(login.MAX_REDIRECTS)
        ])
        with self.assertRaises(login.LoginError):
            session.follow("https://login.taobao.com/start")
        self.assertEqual(len(opener.requests), login.MAX_REDIRECTS)

    def test_cookie_path_host_only_expiration_and_deletion(self):
        session, _, _ = session_for([
            FakeResponse(b"ok", headers=set_cookies(
                "same=wide; Domain=.taobao.com; Path=/",
                "same=specific; Domain=.taobao.com; Path=/h5/",
                "host_only=local; Path=/",
                "expired=old; Domain=.taobao.com; Path=/; Max-Age=-1",
                "removed=first; Domain=.taobao.com; Path=/",
            )),
            FakeResponse(b"ok", headers=set_cookies(
                "removed=; Domain=.taobao.com; Path=/; Max-Age=0",
            )),
        ])
        session.request("https://login.taobao.com/start")
        session.request("https://login.taobao.com/end")
        self.assertEqual(session.cookie_header(login.PDS_URL), "same=specific")
        self.assertNotIn("host_only", session.cookie_header("https://sub.login.taobao.com/"))
        self.assertEqual(session.cookie_header("https://taobao.com/"), "same=wide")

    def test_errors_do_not_reveal_url_or_response_body(self):
        session, _, _ = session_for([URLError("https://taobao.com/?secret=synthetic-secret")])
        with self.assertRaises(login.NetworkError) as raised:
            session.request(login.LOGIN_REFERER)
        self.assertNotIn("synthetic-secret", str(raised.exception))
        for response in (FakeResponse(b"synthetic-secret", status=500),
                         FakeResponse(b"<html>synthetic-secret</html>")):
            session, _, _ = session_for([response])
            with self.assertRaises(login.LoginError) as raised:
                session.json(login.LOGIN_REFERER)
            self.assertNotIn("synthetic-secret", str(raised.exception))

    def test_response_limit_and_socket_timeout(self):
        session, opener, _ = session_for([FakeResponse(b"x" * (login.MAX_RESPONSE_BYTES + 1))], seconds=4)
        with self.assertRaises(login.LoginError):
            session.request(login.LOGIN_REFERER)
        self.assertEqual(opener.requests[0][1], 4)

    def test_broken_http_stream_is_reported_without_raw_exception(self):
        class BrokenResponse(FakeResponse):
            def read(self, *_args):
                raise login.HTTPException("synthetic-secret")
        session, _, _ = session_for([BrokenResponse()])
        with self.assertRaises(login.NetworkError) as raised:
            session.request(login.LOGIN_REFERER)
        self.assertNotIn("synthetic-secret", str(raised.exception))


class LoginProtocolTests(unittest.TestCase):
    def test_generate_query_form_cookie_and_states(self):
        session, opener, _ = session_for([
            FakeResponse({"content": {"data": {"t": 123, "ck": "synthetic-ck", "codeContent": "qr"}}},
                         headers=set_cookies("cookie2=qr-session; Domain=.taobao.com; Path=/; Secure")),
            qr_data("NEW"), qr_data("SCANED"), qr_data("CONFIRMED"),
        ])
        messages = []
        client = login.LoginClient(session, emit=messages.append)
        self.assertEqual(client.poll(client.generate())["qrCodeStatus"], "CONFIRMED")
        generated, query = opener.requests[0][0], opener.requests[1][0]
        self.assertEqual(generated.get_method(), "GET")
        self.assertIn("generate.do?bizEntrance=taobao_h5&bizName=taobao", generated.full_url)
        self.assertEqual(query.get_method(), "POST")
        self.assertEqual(query.get_header("Cookie"), "cookie2=qr-session")
        self.assertEqual(query.get_header("Referer"), login.LOGIN_REFERER)
        self.assertEqual(query.get_header("User-agent"), login.UA)
        self.assertEqual(parse_qs(query.data.decode(), keep_blank_values=True), {
            "t": ["123"], "ck": ["synthetic-ck"], "ua": [""], "navlanguage": ["zh-CN"],
            "navUserAgent": [login.UA], "navPlatform": ["Linux armv8l"],
        })
        self.assertEqual(len(messages), 3)
        self.assertNotIn("synthetic-ck", "\n".join(messages))

    def test_unknown_status_timeout_and_terminal_states(self):
        session, opener, clock = session_for([qr_data("FUTURE_STATUS") for _ in range(3)], seconds=5)
        with self.assertRaises(login.LoginTimeout):
            login.LoginClient(session, emit=lambda _: None).poll({"t": "1", "ck": "synthetic"})
        self.assertEqual(len(opener.requests), 3)
        self.assertEqual(clock.value, 5)
        for status in ("EXPIRED", "CANCELED", "ERROR"):
            session, opener, _ = session_for([qr_data(status, message="synthetic-secret")])
            with self.assertRaises(login.LoginError) as raised:
                login.LoginClient(session).poll({"t": "1", "ck": "synthetic"})
            self.assertNotIn("synthetic-secret", str(raised.exception))
            self.assertEqual(len(opener.requests), 1)

    def test_network_retries_are_bounded_and_sanitized(self):
        session, opener, _ = session_for([URLError("synthetic-secret") for _ in range(3)])
        messages = []
        with self.assertRaises(login.NetworkError):
            login.LoginClient(session, emit=messages.append).poll({"t": "1", "ck": "synthetic"})
        self.assertEqual(len(opener.requests), 3)
        self.assertNotIn("synthetic-secret", str(messages))

    def test_count_refreshes_token_and_signs_original_json(self):
        session, opener, _ = session_for([
            FakeResponse({"ret": ["FAIL_SYS_TOKEN_EMPTY::empty"]}, headers=set_cookies(
                "_m_h5_tk=fresh_9999999999999; Domain=.taobao.com; Path=/; Secure",
                "_m_h5_tk_enc=paired; Domain=.taobao.com; Path=/; Secure",
            )),
            FakeResponse({"ret": ["SUCCESS::ok"]}),
        ])
        with patch.object(login.time, "time", return_value=1700000000):
            login.LoginClient(session).verify()
        request = opener.requests[1][0]
        query = parse_qs(urlsplit(request.full_url).query)
        payload = '{"appName":"GUOGUO"}'
        expected = hashlib.md5(("fresh&1700000000000&12574478&" + payload).encode()).hexdigest()
        self.assertEqual(query["data"], [payload])
        self.assertEqual(query["sign"], [expected])
        self.assertIn("_m_h5_tk=fresh_9999999999999", request.get_header("Cookie"))
        self.assertEqual(query["api"], [login.COUNT_API])
        self.assertEqual(request.get_header("Referer"), login.MTOP_REFERER)

    def test_count_signature_and_pds_export_match_cookie_paths(self):
        session, opener, _ = session_for([
            FakeResponse(b"ok", headers=set_cookies(
                "_m_h5_tk=wide_999; Domain=.taobao.com; Path=/",
                "_m_h5_tk=count_999; Domain=.taobao.com; Path=" + urlsplit(login.COUNT_URL).path,
                "_m_h5_tk=pds_999; Domain=.taobao.com; Path=" + urlsplit(login.PDS_URL).path,
            )),
            FakeResponse({"ret": ["SUCCESS::ok"]}),
        ])
        session.request("https://h5api.m.taobao.com/bootstrap")
        with patch.object(login.time, "time", return_value=1700000000):
            login.LoginClient(session).verify()
        query = parse_qs(urlsplit(opener.requests[1][0].full_url).query)
        expected = hashlib.md5(b'count&1700000000000&12574478&{"appName":"GUOGUO"}').hexdigest()
        self.assertEqual(query["sign"], [expected])
        self.assertEqual(session.cookie_header(login.PDS_URL), "_m_h5_tk=pds_999")

    def test_count_requires_success_and_retry_is_bounded(self):
        for marker in ("FAIL_SYS_SESSION_EXPIRED", "FAIL_SYS_TRAFFIC_LIMIT", "FAIL_SYS_USER_VALIDATE", ""):
            session, _, _ = session_for([FakeResponse({"ret": [marker]})])
            with self.subTest(marker=marker), self.assertRaises(login.LoginError):
                login.LoginClient(session).verify()
        session, opener, _ = session_for([
            FakeResponse({"ret": ["FAIL_SYS_TOKEN_EXOIRED"]}) for _ in range(3)
        ])
        with self.assertRaises(login.LoginError):
            login.LoginClient(session).verify()
        self.assertEqual(len(opener.requests), 3)

    def test_count_rejects_pseudo_success_mixed_failure_and_malformed_ret(self):
        for values in (
            ["SUCCESS_NOT_REALLY::synthetic"],
            ["SUCCESS::ok", "FAIL_SYS_SESSION_EXPIRED::synthetic"],
            ["FAIL_OTHER::synthetic", "SUCCESS::ok"],
            ["SUCCESS::ok", ""], ["SUCCESS::ok", 1], ["SUCCESS::ok", None],
            "SUCCESS::ok", [], None, ["FAIL_OTHER::TOKEN_EMPTY"],
        ):
            session, opener, _ = session_for([FakeResponse({"ret": values})])
            with self.subTest(values=values), self.assertRaises(login.LoginError):
                login.LoginClient(session).verify()
            self.assertEqual(len(opener.requests), 1)

    def test_count_accepts_only_exact_success_codes_for_every_entry(self):
        session, opener, _ = session_for([FakeResponse({"ret": ["success::ok", "SUCCESS"]})])
        login.LoginClient(session).verify()
        self.assertEqual(len(opener.requests), 1)

    def test_count_classifies_every_code_before_retrying_token(self):
        for failure in ("FAIL_SYS_SESSION_EXPIRED", "FAIL_SYS_TRAFFIC_LIMIT", "FAIL_SYS_USER_VALIDATE"):
            session, opener, _ = session_for([FakeResponse({
                "ret": ["SUCCESS::ok", "FAIL_SYS_TOKEN_EMPTY::refresh", failure + "::synthetic"]
            })])
            with self.subTest(failure=failure), self.assertRaises(login.LoginError) as raised:
                login.LoginClient(session).verify()
            self.assertEqual(len(opener.requests), 1)
            if "SESSION" not in failure:
                self.assertIn("需要验证或受到访问限制", str(raised.exception))

    def test_success_exports_only_after_count_without_printing_credentials(self):
        session, opener, _ = session_for([
            FakeResponse({"content": {"data": {"t": 1, "ck": "secret-ck", "codeContent": "secret-qr"}}}),
            qr_data("CONFIRMED", asyncUrls=["https://login.taobao.com/complete"]),
            FakeResponse(b"ok", headers=set_cookies("cookie2=secret-cookie; Domain=.taobao.com; Path=/; Secure")),
            FakeResponse({"ret": ["SUCCESS::ok"]}, headers=set_cookies(
                "_m_h5_tk=secret-token_999; Domain=.taobao.com; Path=/; Secure",
            )),
        ])
        messages = []
        with tempfile.TemporaryDirectory() as directory:
            paths = login.prepare_outputs(Path(directory))
            def render(_content, path):
                with login.private_open(path) as output:
                    output.write(b"synthetic-qr")
            login.run_login(login.LoginClient(session, emit=messages.append), paths, render=render, no_open=True)
            self.assertIn("cookie2=secret-cookie", paths.cookies.read_text())
            self.assertIn("CAINIAO_COOKIE:", paths.parameters.read_text())
            self.assertEqual(stat.S_IMODE(paths.cookies.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(paths.parameters.stat().st_mode), 0o600)
            self.assertEqual(len(opener.requests), 4)
        text = "\n".join(messages)
        for credential in ("secret-cookie", "secret-token", "secret-qr", "secret-ck"):
            self.assertNotIn(credential, text)
        self.assertNotIn("https://", text)

    def test_confirmed_without_count_success_never_exports(self):
        session, _, _ = session_for([
            FakeResponse({"content": {"data": {"t": 1, "ck": "synthetic", "codeContent": "synthetic"}}}),
            qr_data("CONFIRMED"), FakeResponse(b"ok"),
            FakeResponse({"ret": ["FAIL_SYS_SESSION_EXPIRED"]}),
        ])
        with tempfile.TemporaryDirectory() as directory:
            paths = login.prepare_outputs(Path(directory))
            with self.assertRaises(login.LoginError):
                login.run_login(login.LoginClient(session, emit=lambda _: None), paths,
                                render=lambda _content, _path: None, no_open=True)
            self.assertFalse(paths.cookies.exists())
            self.assertFalse(paths.parameters.exists())


class PrivateFileAndCliTests(unittest.TestCase):
    def test_private_permissions_and_yaml_quoting(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = login.prepare_outputs(Path(directory) / "fresh")
            header = 'cookie2=synthetic\\value"quoted; _m_h5_tk=synthetic_999'
            login.write_credentials(paths, header)
            self.assertEqual(stat.S_IMODE(paths.cookies.parent.stat().st_mode), 0o700)
            for path in (paths.cookies, paths.parameters):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            value = paths.parameters.read_text().split("CAINIAO_COOKIE: ", 1)[1].strip()
            self.assertEqual(json.loads(value), header)
            self.assertEqual(paths.cookies.read_text(), header + "\n")

    def test_existing_files_and_symlinks_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            existing = base / (login.PRIVATE_PREFIX + "parameters.yaml")
            existing.write_text("user-content")
            with self.assertRaises(login.LoginError):
                login.prepare_outputs(base)
            self.assertEqual(existing.read_text(), "user-content")
            target = base / "target"
            target.write_text("keep")
            link = base / "symbolic"
            link.symlink_to(target)
            with self.assertRaises(FileExistsError):
                login.private_open(link)
            self.assertEqual(target.read_text(), "keep")

    def test_existing_second_file_prevents_partial_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = login.prepare_outputs(Path(directory))
            paths.parameters.write_text("keep")
            with self.assertRaises(login.LoginError):
                login.write_credentials(paths, "cookie2=synthetic")
            self.assertFalse(paths.cookies.exists())
            self.assertEqual(paths.parameters.read_text(), "keep")

    def test_help_requires_neither_qrcode_nor_network(self):
        with patch.object(login, "load_qrcode", side_effect=AssertionError("must not import")), \
             patch.object(login, "Session", side_effect=AssertionError("must not connect")), \
             contextlib.redirect_stdout(io.StringIO()) as output, self.assertRaises(SystemExit) as raised:
            login.main(["--help"])
        self.assertEqual(raised.exception.code, 0)
        for flag in ("--output-dir", "--no-open", "--timeout"):
            self.assertIn(flag, output.getvalue())

    def test_missing_dependency_gives_venv_command_before_network(self):
        with patch.object(login.importlib, "import_module", side_effect=ImportError), \
             patch.object(login, "Session", side_effect=AssertionError("must not connect")), \
             contextlib.redirect_stderr(io.StringIO()) as output:
            self.assertEqual(login.main(["--no-open"]), 1)
        self.assertIn("先切换到仓库根目录", output.getvalue())
        self.assertIn("python3 -m venv work/cainiao-login-venv", output.getvalue())
        self.assertIn("work/cainiao-login-venv/bin/python -m pip install", output.getvalue())
        self.assertNotIn(".venv/bin", output.getvalue())
        self.assertIn("requirements-login.txt", output.getvalue())

    def test_existing_output_is_rejected_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / (login.PRIVATE_PREFIX + "qr.png")).write_text("keep")
            with patch.object(login, "load_qrcode", return_value=object()), \
                 patch.object(login, "Session", side_effect=AssertionError("must not connect")), \
                 contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(login.main(["--no-open", "--output-dir", directory]), 1)

    def test_timeout_argument_rejects_invalid_or_unbounded_values(self):
        for value in ("nan", "inf", "0", "181", "not-a-number"):
            with self.subTest(value=value), self.assertRaises(Exception):
                login.timeout_value(value)

    @unittest.skipUnless(hasattr(signal, "setitimer"), "POSIX timer unavailable")
    def test_total_deadline_interrupts_blocking_work(self):
        started = time.monotonic()
        with self.assertRaises(login.LoginTimeout):
            with login.hard_deadline(0.03):
                time.sleep(0.5)
        self.assertLess(time.monotonic() - started, 0.4)


if __name__ == "__main__":
    unittest.main()
