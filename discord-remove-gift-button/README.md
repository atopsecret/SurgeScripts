# Discord 移除礼物按钮 (Surge 模块)

移除 Discord 移动端聊天输入框旁边的 Gift/Nitro 推广按钮。

## 工作原理

通过 Surge 拦截并修改 Discord API 响应，采用多层策略：

1. **API 拦截（Rule + URL Rewrite）**：直接拒绝礼物/商店/推广相关 API 请求
2. **Map Local**：将订阅查询 API 返回空数据  
3. **脚本修改（Script）**：修改 `/users/@me` 响应中的 `premium_type` 字段，模拟 Nitro 用户状态（已付费用户不会看到推广按钮）

## 安装方法

### 方法一：本地安装

1. 将 `discord-remove-gift-button.sgmodule` 和 `discord-remove-gift-button.js` 两个文件通过 AirDrop 或其他方式传到 iPhone
2. 打开 Surge → 模块 → 从文件安装
3. 选择 `.sgmodule` 文件
4. 确保 `.js` 脚本文件放在 Surge 的工作目录中

### 方法二：远程安装（推荐）

1. 将两个文件托管到 GitHub 或其他可访问的 URL
2. 打开 Surge → 模块 → 安装新模块
3. 输入 `.sgmodule` 文件的 URL
4. 修改 `.sgmodule` 文件中 `script-path=` 为 `.js` 文件的完整 URL

## 必要设置

- 需要开启 Surge 的 **MITM（中间人解密）** 功能
- 需要安装并信任 Surge 的 CA 证书
- 确保 `discord.com` 和 `discordapp.com` 在 MITM 的 hostname 列表中

## 注意事项

- 此模块仅修改客户端显示，不会影响 Discord 账号安全
- Discord 更新 API 后可能需要更新脚本
- 如果按钮仍然显示，请尝试清除 Discord 缓存后重新打开
