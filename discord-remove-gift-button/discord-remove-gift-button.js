/*
 * Discord 移除礼物按钮 - Surge 脚本
 * 
 * 功能：修改 /users/@me API 响应，伪装为 Nitro 用户
 *       Nitro 用户不会看到礼物推广按钮
 */

const scriptName = "Discord Remove Gift Button";
let body = $response.body;

try {
    let obj = JSON.parse(body);
    
    if (obj.id) {
        // 伪装为 Nitro 用户（premium_type=2 为 Nitro）
        obj.premium_type = 2;
        
        // 标记为已购买状态
        if ("purchased_flags" in obj) {
            obj.purchased_flags = 5;
        } else {
            obj.purchased_flags = 5;
        }
        
        // 清除推广使用标记
        obj.premium_usage_flags = 0;
        
        // 添加 Nitro 订阅相关 flags
        // 用户 flags 中启用 HAS_UNREAD_URGENT_MESSAGES 以外的高级功能位
        if (obj.flags !== undefined) {
            obj.flags = obj.flags | (1 << 1); // PARTNER - 不太重要但标记为高级用户
        }
        
        console.log(`[${scriptName}] 已修改 premium_type=2, purchased_flags=5`);
    }
    
    body = JSON.stringify(obj);
} catch (e) {
    console.log(`[${scriptName}] 解析失败: ${e.message}`);
}

$done({ body });
