// Node.js | 24+ | CommonJS preload
// Build: none.
// Run: node --require ./egern/tests/offline-guard.cjs <offline test command>
// Deps: built-ins only; attempts to use real networking fail the process.
'use strict';
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
let attempts = 0;
function blocked(api) {
    return function blockNetwork() {
        attempts++;
        throw new Error(`Offline tests attempted real networking through ${api}`);
    };
}
for (const [name, methods] of [
    ['node:http', ['get', 'request']],
    ['node:https', ['get', 'request']],
    ['node:net', ['connect', 'createConnection']],
    ['node:tls', ['connect']],
    ['node:dgram', ['createSocket']],
    ['node:dns', ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']],
]) {
    const api = require(name);
    for (const method of methods) api[method] = blocked(`${name}.${method}`);
}
require('node:net').Socket.prototype.connect = blocked('node:net.Socket.connect');
for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) {
    require('node:dns').promises[method] = blocked(`node:dns.promises.${method}`);
}
globalThis.fetch = blocked('fetch');
globalThis.WebSocket = blocked('WebSocket');
syncBuiltinESMExports();
process.once('exit', () => {
    if (attempts) process.exitCode = 1;
    fs.writeSync(1, `OFFLINE_GUARD ${JSON.stringify({ networkAttempts: attempts })}\n`);
});
