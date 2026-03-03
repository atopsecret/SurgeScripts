/*
 * Discord 移除礼物按钮 - Surge 脚本
 * 
 * 功能：修改 /users/@me API 响应，伪装为 Nitro 用户
 *       Nitro 用户不会看到礼物推广按钮
 */

const scriptName = "Discord Remove Gift Button";
let body = $response.body;

$notification.post("Discord 脚本触发 ✅", $request.url, "脚本已运行");

try {
    let obj = JSON.parse(body);
    
    if (obj.id) {
        // 伪装为 Nitro 用户（premium_type=2 为 Nitro）
        obj.premium_type = 2;
        
        // 标记为已购买状态
        obj.purchased_flags = 5;
        
        // 清除推广使用标记
        obj.premium_usage_flags = 0;
        
        $notification.post("Discord 修改成功 ✅", `premium_type: ${obj.premium_type}`, `原始keys: ${Object.keys(obj).join(", ").substring(0, 200)}`);
    }
    
    body = JSON.stringify(obj);
} catch (e) {
    $notification.post("Discord 脚本错误 ❌", e.message, body ? body.substring(0, 200) : "empty body");
}

$done({ body });
