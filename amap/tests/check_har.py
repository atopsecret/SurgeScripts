#!/usr/bin/env python3
"""离线检查高德 HAR 的 RT 响应契约；只输出计数，不重放网络或输出请求值。"""
import argparse
import base64
import email
from email import policy
import json
from pathlib import Path
import re
from urllib.parse import urlsplit


def multipart(content_type, payload):
    prefix = ('Content-Type: ' + content_type + '\r\nMIME-Version: 1.0\r\n\r\n').encode()
    message = email.message_from_bytes(prefix + payload, policy=policy.default)
    if not message.is_multipart():
        raise ValueError('预期 multipart 响应，实际结构不符')
    parts = [part for part in message.walk() if not part.is_multipart()]
    metadata = [part for part in parts if part.get_param('name', header='content-disposition') == 'jsonData']
    if len(metadata) != 1:
        raise ValueError('预期唯一 jsonData 部分')
    root = json.loads(metadata[0].get_payload(decode=True))
    images = sum(1 for part in parts if (part.get_payload(decode=True) or b'').startswith((b'\x89PNG', b'\xff\xd8')))
    return root, images


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('har', type=Path)
    args = parser.parse_args()
    module = (Path(__file__).resolve().parents[1] / 'amap-adblock.sgmodule').read_text()
    line = next(line for line in module.splitlines() if 'splash_screen_rt' in line and 'data-type=' in line)
    pattern = re.compile(line.split(' data-type=')[0])
    payload = base64.b64decode(re.search(r' data="([^"]+)"', line).group(1), validate=True)
    content_type = re.search(r'Content-Type:([^|]+)', line).group(1)
    replacement, replacement_images = multipart(content_type, payload)
    assert replacement['data']['custom_list'] == []
    assert replacement['data']['ad'] == []
    assert replacement_images == 0
    entries = json.loads(args.har.read_text())['log']['entries']
    checked = images = ads = 0
    for entry in entries:
        url = entry.get('request', {}).get('url', '')
        parsed = urlsplit(url)
        if not parsed.hostname or not parsed.hostname.endswith('.amap.com'):
            continue
        if parsed.path != '/ws/aos/alimama/splash_screen_rt':
            continue
        assert pattern.search(url), '新规则未匹配实际 RT 开屏请求'
        response = entry.get('response', {})
        content = response.get('content', {})
        if response.get('status') != 200 or not content.get('text'):
            continue
        headers = {h['name'].lower(): h.get('value', '') for h in response.get('headers', [])}
        body = base64.b64decode(content['text']) if content.get('encoding') == 'base64' else content['text'].encode()
        original, count = multipart(headers.get('content-type', ''), body)
        assert original['result'] == replacement['result']
        assert original['code'] == replacement['code']
        assert original['version'] == replacement['version']
        for key in ('status', 'errcode'):
            assert original['data'][key] == replacement['data'][key]
        checked += 1
        images += count
        ads += len(original['data'].get('custom_list', []))
    if not checked:
        raise SystemExit('没有可验证的 RT multipart 响应，未得出契约验证结论')
    print(json.dumps({'rt_responses_checked': checked, 'original_inline_images': images,
                      'original_ad_entries': ads, 'replacement_inline_images': replacement_images,
                      'replacement_ad_entries': len(replacement['data']['custom_list']),
                      'live_requests': 0}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
