/**
 * Engine | Surge (iOS/Mac) | JavaScript
 * Build: none (script, loaded by Surge)
 * Run: imported by jyjt-member.sgmodule ([Script] section)
 * Deps: none
 *
 * 戒烟军团 (com.nxnresearch.smoke) 会员标志改写。
 *
 * 机制：客户端用 SOAP POST 调 http://smoke.nxnresearch.com/webservice510.asmx，
 * 响应是 XML 包一层 JSON 字符串（无签名、无加密、明文 HTTP）。会员判定就是
 * 客户端读响应里的 member_flg / user_type / member_end_date：
 *   - process_user_online → member_flg        （登录及心跳，主开关）
 *   - get_user_info       → member_flg + user_type
 *   - get_member_item     → member_flg + member_end_date
 * 本脚本把响应里的标志位改写为会员态，其余字段原样透传。
 *
 * member_end_date 的格式抓包里为 null，这里填 "2099-12-31"（yyyy-MM-dd）。
 * 若客户端对日期解析异常，需同时移除 DATE_RULE 定义及 transform 中使用它的替换语句。
 */

var MEMBER_END_DATE = '2099-12-31';

var FLAG_RULES = [
  [/"member_flg"\s*:\s*0\b/g, '"member_flg":1'],
  [/"user_type"\s*:\s*0\b/g, '"user_type":1']
];
var DATE_RULE = [/"member_end_date"\s*:\s*null/g, '"member_end_date":"' + MEMBER_END_DATE + '"'];

// 纯函数：SOAP/XML 原文进，改写后的原文出。没有 member 字段的响应原样返回。
function transform(body) {
  if (typeof body !== 'string' || body.indexOf('member_flg') === -1) {
    return body;
  }
  var out = body;
  for (var i = 0; i < FLAG_RULES.length; i++) {
    out = out.replace(FLAG_RULES[i][0], FLAG_RULES[i][1]);
  }
  out = out.replace(DATE_RULE[0], DATE_RULE[1]);
  return out;
}

// Surge http-response 钩子
if (typeof $response !== 'undefined' && typeof $done === 'function') {
  $done({ body: transform($response.body) });
}

// 本地测试用（Surge 引擎里 module 未定义，不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { transform: transform };
}
