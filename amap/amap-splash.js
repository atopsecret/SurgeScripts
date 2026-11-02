/*
 * AMap splash handling for Surge-compatible script runtimes.
 * Version: 20261102-r1. No notifications and no persistent personal data.
 * References: ddgksf2013/Rewrite AdBlock/AmapAds.conf;
 * ddgksf2013/Scripts amap.js (data.ad), amdc.js (AMap User-Agent guard).
 * Device-side effectiveness must be checked separately from fixture tests.
 */
(function () {
    const request = typeof $request === "object" ? $request : {};
    const url = String(request.url || "");
    const headers = request.headers || {};
    const body = typeof $response === "object" && typeof $response.body === "string" ? $response.body : "";

    // Only plain-HTTP AMap dispatch replies are replaced. Other Alibaba apps pass through.
    if (/^http:\/\/amdc\.m\.taobao\.com(?:[/?]|$)/i.test(url)) {
        let userAgent = "";
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === "user-agent") userAgent = String(headers[key]);
        }
        if (/AMap/.test(userAgent)) {
            // Upstream uses this non-JSON marker to make AMap fall back from HTTPDNS.
            $done({ body: "ddgksf2013" });
        } else {
            $done({});
        }
        return;
    }

    if (!/^https?:\/\/(?:[A-Za-z0-9-]+\.)+amap\.com\/ws\/valueadded\/alimama\/splash_screen(?:[/?]|$)/i.test(url)) {
        $done({});
        return;
    }

    try {
        const data = JSON.parse(body);
        // Only the documented splash ad list is cleared. Status and other fields survive.
        if (!data || typeof data !== "object" || Array.isArray(data) ||
            !data.data || typeof data.data !== "object" || Array.isArray(data.data) ||
            !Array.isArray(data.data.ad)) {
            $done({});
            return;
        }
        if (!data.data.ad.length) {
            $done({});
            return;
        }
        data.data.ad = [];
        $done({ body: JSON.stringify(data) });
    } catch (_) {
        // Unknown formats (including encrypted/JSONP replies) pass through untouched.
        $done({});
    }
}());
