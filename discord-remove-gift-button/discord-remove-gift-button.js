/*
 * Discord 移除礼物按钮 - Surge 脚本
 * 
 * 功能：通过修改 Discord API 响应来隐藏聊天输入框旁的 Gift/Nitro 按钮
 * 适用：Surge for iOS / macOS
 * 
 * 原理：修改 /users/@me 接口返回的用户数据，
 *       将 premium_type 设置为 2（模拟 Nitro 用户，已购买用户不会看到推广按钮），
 *       并移除相关的推广标记。
 */

const scriptName = "Discord Remove Gift Button";

// 获取响应体
let body = $response.body;

try {
    let obj = JSON.parse(body);
    
    // 设置 premium_type 为 2 (Nitro)
    // Nitro 用户不会看到礼物推广按钮（因为已经是付费用户）
    if (obj.hasOwnProperty("premium_type") || obj.hasOwnProperty("id")) {
        obj.premium_type = 2;
    }
    
    // 移除购买相关标记
    if (obj.hasOwnProperty("purchased_flags")) {
        obj.purchased_flags = 5; // 标记为已购买
    }
    
    // 移除 Nitro 推广相关字段
    if (obj.hasOwnProperty("premium_usage_flags")) {
        obj.premium_usage_flags = 0;
    }

    body = JSON.stringify(obj);
    console.log(`[${scriptName}] 成功修改用户设置响应`);
    
} catch (e) {
    console.log(`[${scriptName}] 解析响应失败: ${e.message}`);
}

$done({ body });
