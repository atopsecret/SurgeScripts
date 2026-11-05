# 蔚来自动签到

Surge 脚本 2.1.2。请求钩子保存已知蔚来业务接口中的 Bearer 凭据，定时任务每天 09:00 使用它签到。手动运行任务仅用于立即验证，不是每日操作要求；旧的网页触发入口已移除。

另提供独立 [Egern 原生模块](weilai-auto-checkin.egern.yaml)与[脚本](weilai-auto-checkin.egern.js) 3.0.0。它不使用 Surge 全局，也不自动搬运 Surge 凭据。下节先说明 Surge；Egern 入口与新增的防重复边界见后文。

## 安装与依赖

- [模块](weilai-auto-checkin.sgmodule)和[手动配置](weilai-surge-config.conf)二选一，不重复启用。
- 使用 Surge iOS 5.9.0 / Mac 5.5.0 或更高版本；关闭请求跳转和自动 Cookie 等选项依赖该版本起提供的接口。Egern 使用独立 YAML，不能套用这些 Surge 版本要求。
- 从本仓库更新模块后，也要刷新远程脚本缓存。任务日志首行应显示 `脚本版本 2.1.2`。本地测试时，可将两处 `script-path` 都改为客户端内的新版脚本文件。
- 开启 MITM，并安装、信任 Surge 当前 CA。抓取范围仅限配置中的三个主机和已知业务路径。
- 打开已登录的蔚来 App 的签到或个人页面，看到凭据更新通知后运行任务。没有通知也可能只是凭据未变化。

## 日志与通知

成功日志和通知都显示连续签到及累计天数；字段缺失时显示“未知”。失败的本地诊断说明也同步写入日志，即使通知不可用，仍能看到原因。日志首行标明实际执行版本，方便识别缓存中的旧脚本。

## 行为与边界

签到使用抓包验证过的 POST 路径、`event=checkin` 表单和秒级时间戳。返回正常 HTTP、业务成功和 `checked_in=true` 时，报告“今日签到已确认”。该响应无法区分本次首次签到和此前已签到，不宣称本次获得奖励。

统计采用响应中的实际数字，缺失项显示“未知”，不为补统计再次签到。每次请求超时 5 秒，任务预算 24 秒；只有明确的 HTTP 429 限流响应才会按重试时间有限重试，最多提交三次。网络异常、超时、5xx、解析错误或业务失败不盲目重发 POST，因为服务端可能已经完成签到。

凭据保存在客户端本地 `weilai_auth_state_v1`，兼容读取旧的 `weilai_auth_token` 和 `weilai_token_last_update`。不删除旧数据，不按保存满 30 天推断服务端过期。新格式一次写入完整状态并检查写入结果。

HTTP 401，或 HTTP 200/403 携带明确认证错误码时，会标记当前凭据不可用。普通 403 只报告访问被拒绝，不作废凭据，避免临时风控导致以后每天都无法签到。重新观察同一失效凭据不会解除标记，需要重新登录并抓取新凭据。其他尚未验证的错误码统一报告未确认，不猜测含义。

限流等待或请求在途期间，若抓到了不同 Token、凭据被标记失效或存储不可用，旧任务停止，不自动切换账号继续提交，也不将旧账号的响应作为新账号结果。

日志不打印完整 URL、Token、服务端错误原文或完整响应；本地存储仍包含登录凭据，请勿分享。脚本不会读取或改写车辆控制、订单、消息数据。

## 离线验证

当前 40 项离线测试全部通过，包括首次抓取到定时执行的流程、日志与通知、凭据轮换、失败处理、版本和配置一致性。

```sh
node --check weilai/weilai-auto-checkin.js
node --test weilai/tests/checkin.test.cjs
```

测试使用虚拟时钟、模拟客户端和虚构凭据，不发送真实请求。依据 2026-11-03 抓包整理了成功响应的非敏感字段；未把 HAR 或登录凭据放入仓库。认证失败、限流等样例是构造测试，尚需真机验证接口和客户端运行环境。

运行时接口依据 [Surge 官方脚本接口文档](https://manual.nssurge.com/scripting/api.html)。兼容 JSC 没有 `clearTimeout` 的环境；迟到回调由结束标记忽略。

## Egern 原生版 3.0.0

公开本次变更后，安装地址为：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/weilai/weilai-auto-checkin.egern.yaml
```

1. 导入原生 YAML，并安装、信任 Egern 当前 CA。解密只追加三个既有蔚来主机与已知业务路径，不扩到车辆控制域名。
2. 在 Egern 下重新打开已登录的蔚来 App 的签到或个人页面。请求脚本只读取 Authorization 与 UA，不读 body、不签到；新凭据保存后发一条无声通知，同凭据静默。
3. `蔚来自动签到 · Egern` 是 `schedule`，cron 为 `0 9 * * *`。需要立即执行时手动运行这条定时任务；不是运行 generic，也不使用伪造域名。
4. `蔚来本地诊断 · Egern` 是 generic，只读本地状态，返回合法 widget 并写日志；不发通知、不发送签到、不显示 Token。

定时采用 Egern 的设备时区。官方文档没有 Surge `wake-system` 的等价字段，本模块不写该字段，也不承诺锁屏调度完全相同。

### 凭据、幂等与任务锁

凭据只在 `weilai_egern_auth_state_v1` 保存，包含 Token、观察时间、失效标记、合法 UA 和 `generation`。新 Token 换一代，同 Token 保留失效标记与代号；A→B→A 也不会误认成原来的在途任务。不读 `weilai_auth_state_v1` 或其他旧 Surge 键。

任务记录 `weilai_egern_checkin_v1` 只存任务 ID、代号、锁时间及已确认日期/有限统计，不重复存 Token。所有必要存储写入都回读确认；存储不可读、结构不符或加锁未确认时不发 POST。真实目标请求可修复损坏的凭据状态；损坏任务记录不自动删掉或当作空记录。

**每日成功去重与到期锁是 Egern 3.0.0 新增，不是旧 Surge 2.1.2 已有能力。** 仅 HTTP 200、`result_code: success`、data 对象且 `checked_in === true` 才记成功。同代凭据在 UTC+8 当日已确认后，不再发送 POST，也不为缺统计重复提交。新代凭据不沿用旧代标记；没有可靠账号 ID，因此不声称同一服务端账号更换 Token 后仍严格按账号去重。

任务锁 30 秒到期。进入任务、真正调用 POST 前、响应与 body 返回后以及 429 等待后都重新校验凭据代号、失效标记和锁归属；变化后停止，不改用新账号继续旧任务。只释放自己持有的锁。网络、超时或解析结果未知时不标成功，保留短租约以防马上重复执行；到期不代表服务器没有处理过请求。

Egern `ctx.storage` 没有文档化的 CAS、事务或跨进程互斥保证。短同步读写与回读能防常见重入，不能证明跨执行器同时启动时绝对只提交一次。测试覆盖同上下文的重入和可观察的状态变化，不能替代实际客户端的存储作用域、持久化与并发验证。

### 请求和失败处理

- 原生 `ctx.http.post` 使用原有固定端点、`event=checkin` 表单与秒级时间戳；`timeout: 5000` 为毫秒，`redirect: manual`、`credentials: omit`、`insecureTls: false`。不自动带 Cookie 或沿跳转把 Authorization 发给其他主机。
- 每次请求与响应 body 读取共用 5 秒，整个任务预算 24 秒，YAML 上限 30 秒。Promise 兜底限制异常挂起；没有文档化 AbortSignal，不能说兜底超时已经取消服务端收到的 POST。
- 只有明确 429 按严格整数秒或标准 HTTP 日期等待，至少 1 秒、最多 3 次，并受同一总预算限制。网络失败、5xx、跳转、未知 JSON/业务状态不自动重发。
- 401 或 200/403 的明确认证码才标记失效。普通 403 不作废；5xx 即使夹带认证字样也不作废。迟到旧响应不写新代凭据或新代今日记录。
- 确认成功但每日记录未确认保存时，仍如实报告服务器确认结果，并明示本地防重复未保存，不把失败记录当成功缓存。统计只接受非负安全整数，缺失显示“未知”。
- 日志和通知仅本地固定文案及校验后的数字，不输出 URL、Token、任意异常或服务端原文；不宣称本次获得了新奖励。

### Egern 离线验证

39 项原生上下文测试使用内存存储、虚拟时钟、虚构响应和凭据，另保留原有 40 项 Surge 回归：

```sh
node --input-type=module --check < weilai/weilai-auto-checkin.egern.js
node --experimental-vm-modules --test weilai/tests/egern.test.cjs
node --test weilai/tests/checkin.test.cjs
```

测试依赖 Node.js 20+、Python 3 与 PyYAML（只解析公开 YAML）。依据 [Egern 原生 API](https://egernapp.com/zh-CN/docs/javascript-api/)与[定时脚本配置](https://egernapp.com/docs/configuration/scriptings/)。尚未执行真实签到、手机导入、CA 信任、锁屏定时或跨脚本存储共享验收；不会把模拟通过写成真实账号成功。
