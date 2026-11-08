#!/usr/bin/env python3
# Python | 3.10+ | Python
# Build: python3 -m py_compile cainiao-widget/login.py
# Run: python3 cainiao-widget/login.py --no-open
# Deps: qrcode[pil]，见 requirements-login.txt
"""在本机完成用户主动确认的淘宝扫码登录，生成 Egern 私有参数。

HTTP、Cookie、TLS 和签名只用 Python 标准库。二维码在本机编码；
导入本模块、运行 --help 或离线测试均不会发出请求。
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
from http.client import HTTPException
from http.cookiejar import CookieJar, DefaultCookiePolicy
import importlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import ssl
import subprocess
import sys
import time
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, HTTPSHandler, Request


UA = (
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
)
LOGIN_REFERER = "https://login.taobao.com/member/login.jhtml"
MTOP_REFERER = "https://h5.m.taobao.com/"
QR_BASE = "https://login.taobao.com/havanaone/loginLegacy/qrCode/"
QR_BIZ = "bizEntrance=taobao_h5&bizName=taobao"
COUNT_API = "mtop.cainiao.lpc.packageservice.user.package.count.query"
COUNT_URL = "https://h5api.m.taobao.com/h5/" + COUNT_API.lower() + "/1.0/"
PDS_URL = (
    "https://h5api.m.taobao.com/h5/"
    "mtop.cainiao.lpc.packageservice.querypdspackagedatalist/1.0/"
)
ALLOWED_DOMAINS = ("taobao.com", "tmall.com", "cainiao.com")
MAX_REDIRECTS = 6
MAX_COMPLETION_URLS = 12
MAX_RESPONSE_BYTES = 1024 * 1024
PRIVATE_PREFIX = "cainiao.private."
COOKIE_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")


class LoginError(Exception):
    """仅包含可以直接向用户显示的固定错误说明。"""


class LoginTimeout(LoginError):
    def __init__(self):
        super().__init__("登录等待超时。请重新运行助手并扫描新二维码。")


class NetworkError(LoginError):
    pass


class Deadline:
    def __init__(self, seconds: float, clock=None, sleeper=None):
        self.clock = clock or time.monotonic
        self.sleeper = sleeper or time.sleep
        self.end = self.clock() + seconds

    def remaining(self) -> float:
        value = self.end - self.clock()
        if value <= 0:
            raise LoginTimeout()
        return value

    def pause(self, seconds: float) -> None:
        self.sleeper(min(seconds, self.remaining()))
        self.remaining()


@contextmanager
def hard_deadline(seconds: float):
    """macOS/Linux CLI 的总时限；也覆盖响应缓慢持续传输的情况。"""
    supported = hasattr(signal, "setitimer") and hasattr(signal, "SIGALRM")
    if not supported:
        yield
        return
    previous_handler = signal.getsignal(signal.SIGALRM)
    started = time.monotonic()

    def expired(_signum, _frame):
        raise LoginTimeout()

    signal.signal(signal.SIGALRM, expired)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0] > 0:
            remaining = max(0.001, previous_timer[0] - (time.monotonic() - started))
            signal.setitimer(signal.ITIMER_REAL, remaining, previous_timer[1])


def allowed_host(host: str) -> bool:
    host = host.lower()
    return any(host == domain or host.endswith("." + domain) for domain in ALLOWED_DOMAINS)


def validate_url(url: str) -> str:
    """初始 URL 和每次重定向均必须独立经过此检查。"""
    if not isinstance(url, str) or any(ord(ch) <= 32 or ord(ch) == 127 for ch in url):
        raise LoginError("登录地址格式异常，已停止请求。")
    if "\\" in url:
        raise LoginError("登录地址格式异常，已停止请求。")
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
        port = parts.port
    except ValueError:
        raise LoginError("登录地址格式异常，已停止请求。") from None
    if (
        parts.scheme != "https"
        or not host.isascii()
        or not allowed_host(host)
        or port not in (None, 443)
        or parts.username is not None
        or parts.password is not None
        or parts.fragment
    ):
        raise LoginError("登录收尾地址不在允许的 HTTPS 域名范围，已停止请求。")
    return url


class LoginCookiePolicy(DefaultCookiePolicy):
    def __init__(self):
        # 保持 host-only 隔离；不启用 DomainStrictNoDots，合法的
        # h5api.m.taobao.com 必须能接收服务端设置的 .taobao.com Cookie。
        super().__init__(strict_ns_domain=DefaultCookiePolicy.DomainStrictNonDomain)

    def set_ok(self, cookie, request):
        return allowed_host(cookie.domain.lstrip(".")) and super().set_ok(cookie, request)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass
class HttpResult:
    status: int
    headers: object
    body: bytes


class Session:
    def __init__(self, deadline: Deadline, opener=None, jar=None):
        self.deadline = deadline
        self.jar = jar if jar is not None else CookieJar(LoginCookiePolicy())
        # 不安装自动重定向或全局 Cookie handler；Cookie 提取与跳转逐跳执行。
        self.opener = opener or build_opener(
            HTTPSHandler(context=ssl.create_default_context()), NoRedirect()
        )

    def cookie_header(self, url: str) -> str:
        request = Request(validate_url(url))
        self.jar.add_cookie_header(request)
        header = request.get_header("Cookie", "")
        selected = {}
        # CookieJar 按最长 path 在前排序。同名 Cookie 只保留当前目标最具体的一项。
        for part in header.split(";"):
            name, sep, value = part.strip().partition("=")
            if not sep:
                continue
            if (
                not COOKIE_NAME.fullmatch(name)
                or any(ord(ch) < 32 or ord(ch) == 127 for ch in value)
            ):
                raise LoginError("服务器返回了无效 Cookie，已停止导出。")
            if name not in selected:
                selected[name] = value
        return "; ".join(name + "=" + value for name, value in selected.items())

    def request(self, url: str, *, form=None, referer=LOGIN_REFERER) -> HttpResult:
        validate_url(url)
        timeout = min(15.0, self.deadline.remaining())
        body = None if form is None else urlencode(form).encode("utf-8")
        headers = {
            "User-Agent": UA,
            "Referer": referer,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
        }
        cookie = self.cookie_header(url)
        if cookie:
            headers["Cookie"] = cookie
        if form is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
        request = Request(url, data=body, headers=headers, method="GET" if form is None else "POST")
        response = None
        try:
            try:
                response = self.opener.open(request, timeout=timeout)
            except HTTPError as error:
                response = error
            self.jar.extract_cookies(response, request)
            status = response.getcode()
            # 跳转响应只需要头部，避免为收尾图片/HTML 读取不必要的内容。
            if 300 <= status < 400:
                return HttpResult(status, response.headers, b"")
            payload = response.read(MAX_RESPONSE_BYTES + 1)
            self.deadline.remaining()
            if len(payload) > MAX_RESPONSE_BYTES:
                raise LoginError("登录响应超过大小限制，已停止请求。")
            return HttpResult(status, response.headers, payload)
        except LoginError:
            raise
        except (URLError, OSError, ValueError, HTTPException):
            # urllib 异常经常内含带登录票据的 URL，不把异常原文带到终端。
            self.deadline.remaining()
            raise NetworkError("网络连接失败或 TLS 校验未通过。") from None
        finally:
            if response is not None:
                response.close()

    def json(self, url: str, *, form=None, referer=LOGIN_REFERER) -> dict:
        result = self.request(url, form=form, referer=referer)
        if not 200 <= result.status < 300:
            raise LoginError("登录接口返回 HTTP 错误（" + str(result.status) + "）。")
        try:
            data = json.loads(result.body)
        except (ValueError, UnicodeError):
            raise LoginError("登录接口未返回有效 JSON，可能需要网页验证。") from None
        if not isinstance(data, dict):
            raise LoginError("登录响应结构无法识别，已停止登录。")
        return data

    def follow(self, url: str) -> None:
        current = validate_url(url)
        for _ in range(MAX_REDIRECTS):
            result = self.request(current)
            if result.status in (301, 302, 303, 307, 308):
                location = result.headers.get("Location")
                if not location:
                    raise LoginError("登录跳转缺少目标地址。")
                current = validate_url(urljoin(current, location))
                continue
            if not 200 <= result.status < 300:
                raise LoginError("登录收尾请求失败，请重新扫码。")
            return
        raise LoginError("登录跳转次数超过限制，已停止请求。")


def content_data(response: dict) -> dict:
    content = response.get("content")
    data = content.get("data") if isinstance(content, dict) else None
    if not isinstance(data, dict):
        raise LoginError("登录响应缺少状态信息，已停止登录。")
    return data


def _url_values(value) -> list[str]:
    if isinstance(value, dict):
        values = value.values()
    elif isinstance(value, list):
        values = value
    elif isinstance(value, str):
        values = [value]
    else:
        values = []
    return [item.strip() for item in values if isinstance(item, str) and item.strip()]


def completion_urls(data: dict) -> list[str]:
    # 对齐官方分支：有 asyncUrls 时不再执行 miniLogouts / miniVsts 分支。
    urls = _url_values(data.get("asyncUrls"))
    if not urls:
        urls = _url_values(data.get("miniLogouts")) + _url_values(data.get("miniVsts"))
    for flag, field in (
        ("redirect", "redirectUrl"),
        ("parentRedirect", "parentRedirectUrl"),
        ("iframeRedirect", "iframeRedirectUrl"),
        ("replace", "replaceUrl"),
    ):
        if data.get(flag) in (True, 1, "true", "1") and data.get(field):
            value = data[field]
            if not isinstance(value, str):
                raise LoginError("登录跳转响应结构无法识别。")
            urls.append(value.strip())
            break
    unique = list(dict.fromkeys(urls or [LOGIN_REFERER]))
    if len(unique) > MAX_COMPLETION_URLS:
        raise LoginError("登录收尾请求数量超过限制，已停止请求。")
    # 整批预检，避免执行到一半才发现不受信任的域名。
    return [validate_url(url) for url in unique]


class LoginClient:
    def __init__(self, session: Session, *, emit=print):
        self.session = session
        self.emit = emit

    def generate(self) -> dict:
        data = content_data(self.session.json(QR_BASE + "generate.do?" + QR_BIZ))
        qr_time, ck, content = data.get("t"), data.get("ck"), data.get("codeContent")
        if (
            isinstance(qr_time, bool)
            or not str(qr_time).isdigit()
            or len(str(qr_time)) > 32
            or not isinstance(ck, str)
            or not ck
            or len(ck) > 8192
            or not isinstance(content, str)
            or not content
            or len(content.encode("utf-8")) > 8192
        ):
            raise LoginError("无法生成有效二维码，请稍后重试。")
        return {"t": str(qr_time), "ck": ck, "codeContent": content}

    def poll(self, qr: dict) -> dict:
        previous = None
        failures = 0
        messages = {
            "NEW": "等待手机淘宝扫码。",
            "SCANED": "已扫码，请在手机淘宝上确认登录。",
            "UNKNOWN": "状态尚未识别，继续等待手机确认。",
        }
        while True:
            self.session.deadline.remaining()
            try:
                data = content_data(self.session.json(
                    QR_BASE + "query.do?" + QR_BIZ,
                    form={
                        "t": qr["t"], "ck": qr["ck"], "ua": "",
                        "navlanguage": "zh-CN", "navUserAgent": UA,
                        "navPlatform": "Linux armv8l",
                    },
                ))
                failures = 0
            except NetworkError:
                failures += 1
                if failures >= 3:
                    raise NetworkError("连续三次连接失败，请检查网络后重新运行。") from None
                self.emit("连接暂时失败，正在重试。")
                self.session.deadline.pause(2)
                continue
            raw = data.get("qrCodeStatus")
            status = raw.strip().upper() if isinstance(raw, str) else "UNKNOWN"
            if status == "CONFIRMED":
                self.emit("手机已确认，正在完成登录并检查账号接口。")
                return data
            if status in ("EXPIRED", "CANCELED", "ERROR"):
                message = {
                    "EXPIRED": "二维码已过期，请重新运行助手生成新码。",
                    "CANCELED": "手机端已取消登录。未生成 Cookie 文件。",
                    "ERROR": "登录被服务端拒绝，可能需要在官方页面完成验证。",
                }[status]
                raise LoginError(message)
            status = status if status in messages else "UNKNOWN"
            if status != previous:
                self.emit(messages[status])
                previous = status
            self.session.deadline.pause(2)

    def complete(self, data: dict) -> None:
        for url in completion_urls(data):
            self.session.follow(url)

    def verify(self) -> None:
        payload = json.dumps({"appName": "GUOGUO"}, separators=(",", ":"))
        for _ in range(3):
            self.session.deadline.remaining()
            header = self.session.cookie_header(COUNT_URL)
            cookies = dict(part.strip().split("=", 1) for part in header.split(";") if "=" in part)
            token = cookies.get("_m_h5_tk", "").split("_", 1)[0]
            stamp = str(int(time.time() * 1000))
            sign = hashlib.md5((token + "&" + stamp + "&12574478&" + payload).encode()).hexdigest()
            query = urlencode({
                "jsv": "2.7.4", "appKey": "12574478", "t": stamp, "sign": sign,
                "api": COUNT_API, "v": "1.0", "type": "originaljson",
                "dataType": "json", "data": payload,
            })
            response = self.session.json(COUNT_URL + "?" + query, referer=MTOP_REFERER)
            values = response.get("ret")
            valid = isinstance(values, list) and values and all(
                isinstance(value, str) and value for value in values
            )
            codes = [value.split("::", 1)[0].upper() for value in values] if valid else []
            if codes and all(code == "SUCCESS" for code in codes):
                return
            if any("SESSION" in code for code in codes):
                raise LoginError("账号接口未通过登录检查，未生成 Cookie 文件。请重新扫码。")
            if any(marker in code for code in codes for marker in (
                "TRAFFIC_LIMIT", "USER_VALIDATE", "RGV"
            )):
                raise LoginError("账号接口需要验证或受到访问限制，请稍后在官方页面重试。")
            retryable = [any(marker in code for marker in (
                "TOKEN_EMPTY", "TOKEN_EXPIRED", "TOKEN_EXOIRED", "ILLEGAL_ACCESS"
            )) for code in codes]
            if any(retryable) and all(
                code == "SUCCESS" or retry for code, retry in zip(codes, retryable)
            ):
                self.session.deadline.pause(0.5)
                continue
            raise LoginError("账号接口未通过登录检查，未生成 Cookie 文件。请重新扫码。")
        raise LoginError("网关凭据刷新失败，未生成 Cookie 文件。请重新扫码。")


@dataclass(frozen=True)
class OutputPaths:
    qr: Path
    cookies: Path
    parameters: Path


def prepare_outputs(directory: Path) -> OutputPaths:
    directory = directory.expanduser().absolute()
    if directory.is_symlink():
        raise LoginError("输出目录不能是符号链接。")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not directory.is_dir():
        raise LoginError("输出路径不是目录。")
    paths = OutputPaths(
        directory / (PRIVATE_PREFIX + "qr.png"),
        directory / (PRIVATE_PREFIX + "cookies.txt"),
        directory / (PRIVATE_PREFIX + "parameters.yaml"),
    )
    for path in (paths.qr, paths.cookies, paths.parameters):
        if path.exists() or path.is_symlink():
            raise LoginError("输出文件已存在。请使用新的 --output-dir；助手不会覆盖已有文件。")
    return paths


def private_open(path: Path):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        return os.fdopen(descriptor, "wb")
    except BaseException:
        os.close(descriptor)
        raise


def write_credentials(paths: OutputPaths, cookie_header: str) -> None:
    if not cookie_header:
        raise LoginError("未取得匹配菜鸟包裹接口的 Cookie，未生成参数。")
    # 先检查全部目标，再以 O_EXCL 创建；即使竞争条件发生，也不会截断既有文件。
    if any(path.exists() or path.is_symlink() for path in (paths.cookies, paths.parameters)):
        raise LoginError("私有参数文件已存在；助手不会覆盖已有文件。")
    yaml = (
        "# 私有登录参数，请勿上传或分享。\n"
        "env:\n  CAINIAO_COOKIE: " + json.dumps(cookie_header, ensure_ascii=True) + "\n"
    )
    with private_open(paths.cookies) as output:
        output.write((cookie_header + "\n").encode("utf-8"))
    with private_open(paths.parameters) as output:
        output.write(yaml.encode("utf-8"))


def load_qrcode():
    try:
        module = importlib.import_module("qrcode")
        importlib.import_module("PIL.Image")
        return module
    except ImportError:
        script = Path(__file__).resolve()
        requirements = script.with_name("requirements-login.txt")
        raise LoginError(
            "缺少本机二维码依赖。请先切换到仓库根目录，再运行：\n"
            "cd " + shlex.quote(str(script.parent.parent)) + "\n"
            "python3 -m venv work/cainiao-login-venv\n"
            "work/cainiao-login-venv/bin/python -m pip install -r " + shlex.quote(str(requirements)) + "\n"
            "work/cainiao-login-venv/bin/python " + shlex.quote(str(script)) + " --no-open"
        ) from None


def render_qr(module, content: str, path: Path, *, stream=None) -> None:
    try:
        qr = module.QRCode(border=2)
        qr.add_data(content)
        qr.make(fit=True)
        image = qr.make_image(fill_color="black", back_color="white")
        with private_open(path) as output:
            image.save(output, format="PNG")
        qr.print_ascii(out=stream or sys.stdout, tty=False)
    except FileExistsError:
        raise LoginError("二维码文件已存在；助手不会覆盖已有文件。") from None
    except Exception as error:
        if isinstance(error, LoginError):
            raise
        raise LoginError("本机二维码生成失败，请检查 qrcode[pil] 虚拟环境。") from None


def open_qr(path: Path, deadline: Deadline) -> None:
    if sys.platform != "darwin":
        return
    try:
        subprocess.run(
            ["open", str(path)], check=False, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=min(5.0, deadline.remaining()),
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def run_login(client: LoginClient, paths: OutputPaths, *, render, no_open=False) -> None:
    qr = client.generate()
    render(qr["codeContent"], paths.qr)
    client.emit("请用手机淘宝扫描本机二维码，并在手机上确认登录。")
    client.emit("本机二维码：" + str(paths.qr))
    if not no_open:
        open_qr(paths.qr, client.session.deadline)
    confirmed = client.poll(qr)
    client.complete(confirmed)
    client.verify()
    client.session.deadline.remaining()
    write_credentials(paths, client.session.cookie_header(PDS_URL))
    client.emit("登录检查通过。私有 Cookie 与 Egern 参数已保存；终端不会打印凭据。")
    client.emit("Cookie 文件：" + str(paths.cookies))
    client.emit("Egern 参数：" + str(paths.parameters))


def timeout_value(value: str) -> float:
    try:
        seconds = float(value)
    except ValueError:
        raise argparse.ArgumentTypeError("超时必须是 1 到 180 之间的秒数。") from None
    if not 1 <= seconds <= 180:
        raise argparse.ArgumentTypeError("超时必须是 1 到 180 之间的秒数。")
    return seconds


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="在本机扫码登录，生成菜鸟 Egern 私有 Cookie 参数。")
    parser.add_argument("--output-dir", type=Path, help="私有输出目录；默认使用仓库根 work 下的新目录")
    parser.add_argument("--no-open", action="store_true", help="不调用 macOS open；仍生成 PNG 和终端二维码")
    parser.add_argument("--timeout", type=timeout_value, default=180.0, help="总时限（1–180 秒，默认 180）")
    args = parser.parse_args(argv)
    try:
        module = load_qrcode()
        directory = args.output_dir or (
            Path(__file__).resolve().parent.parent / "work" /
            ("cainiao-login-" + time.strftime("%Y%m%d-%H%M%S") + "-" + str(os.getpid()))
        )
        paths = prepare_outputs(directory)
        with hard_deadline(args.timeout):
            deadline = Deadline(args.timeout)
            client = LoginClient(Session(deadline))
            run_login(
                client, paths, render=lambda content, path: render_qr(module, content, path),
                no_open=args.no_open,
            )
        return 0
    except KeyboardInterrupt:
        print("登录已取消。", file=sys.stderr)
        return 130
    except LoginError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError:
        print("私有输出文件无法创建或写入。请检查目录权限，并使用新的 --output-dir。", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
