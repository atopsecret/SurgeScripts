// Surge iOS | 6.0+ | Standalone JavaScript
// Build: node --check output/camscanner-nio/scripts/camscanner-expiry-ios.js
// Run: companion http-response module, requires-body=true, engine=jsc.
// Deps: Surge $request, $response, $done; no network or storage access.
// Change only data.psnl_vip_property.expiry to the string "4102415999".
// Lexical replacement retains all other JSON bytes, including large integer literals.
(function () {
    "use strict";
    const match = /^https:\/\/api(?:-cs)?\.intsig\.net(?::443)?\/purchase\/cs\/query_property(?:\?[^#\s]*)?(?![\s\S])/;
    const expiry = '"4102415999"';
    function done(value) { $done(value || {}); }
    if (typeof $request !== "object" || !match.test(String($request.url || "")) ||
        typeof $response !== "object" || typeof $response.body !== "string") { done(); return; }
    const source = $response.body;
    let position = source.charCodeAt(0) === 0xfeff ? 1 : 0;
    const beginning = position;
    function whitespace() { while (/^[\x20\t\r\n]$/.test(source.charAt(position))) position++; }
    function quoted() {
        const start = position++;
        while (position < source.length) {
            const character = source.charAt(position++);
            if (character === '"') return { start, end: position };
            if (character === "\\") position++;
        }
        throw new Error("unterminated-string");
    }
    function value(depth) {
        if (depth > 256) throw new Error("json-depth");
        whitespace();
        const start = position, character = source.charAt(position);
        if (character === "{") {
            position++;
            const members = [];
            whitespace();
            if (source.charAt(position) !== "}") {
                while (true) {
                    whitespace();
                    if (source.charAt(position) !== '"') throw new Error("object-key");
                    const key = quoted();
                    const name = JSON.parse(source.slice(key.start, key.end));
                    whitespace();
                    if (source.charAt(position++) !== ":") throw new Error("object-colon");
                    members.push({ name, node: value(depth + 1) });
                    whitespace();
                    const separator = source.charAt(position);
                    if (separator === "}") break;
                    if (separator !== ",") throw new Error("object-separator");
                    position++;
                }
            }
            const close = position++;
            return { kind: "object", start, end: position, close, members };
        }
        if (character === "[") {
            position++;
            whitespace();
            if (source.charAt(position) !== "]") {
                while (true) {
                    value(depth + 1);
                    whitespace();
                    const separator = source.charAt(position);
                    if (separator === "]") break;
                    if (separator !== ",") throw new Error("array-separator");
                    position++;
                }
            }
            position++;
            return { kind: "array", start, end: position };
        }
        if (character === '"') {
            const token = quoted();
            return { kind: "string", start, end: token.end };
        }
        while (position < source.length && !/[\x20\t\r\n,\]}]/.test(source.charAt(position))) position++;
        if (position === start) throw new Error("empty-token");
        return { kind: source.slice(start, position) === "null" ? "null" : "scalar", start, end: position };
    }
    function member(object, name) {
        for (let i = object.members.length - 1; i >= 0; i--) if (object.members[i].name === name) return object.members[i].node;
        return undefined;
    }
    function replace(node, text) { return source.slice(0, node.start) + text + source.slice(node.end); }
    function add(object, name, text) {
        const property = (object.members.length ? "," : "") + JSON.stringify(name) + ":" + text;
        return source.slice(0, object.close) + property + source.slice(object.close);
    }
    try {
        // Validation never serializes the object, so unknown fields and number spellings stay intact.
        JSON.parse(source.slice(beginning));
        const root = value(0);
        whitespace();
        if (position !== source.length || root.kind !== "object") { done(); return; }
        const data = member(root, "data");
        if (!data || data.kind !== "object") { done(); return; }
        const property = member(data, "psnl_vip_property");
        let body;
        if (!property) body = add(data, "psnl_vip_property", '{"expiry":' + expiry + "}");
        else if (property.kind === "null") body = replace(property, '{"expiry":' + expiry + "}");
        else if (property.kind !== "object") { done(); return; }
        else {
            const oldExpiry = member(property, "expiry");
            if (oldExpiry && source.slice(oldExpiry.start, oldExpiry.end) === expiry) { done(); return; }
            body = oldExpiry ? replace(oldExpiry, expiry) : add(property, "expiry", expiry);
        }
        done({ body });
    } catch (_) { done(); }
})();
