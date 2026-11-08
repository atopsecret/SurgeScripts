// 原生脚本离线夹具：只使用内存存储和 Node.js 的一次性 Response 正文。
const fs = require('node:fs');
const path = require('node:path');

async function loadScript(directory, relative) {
    const source = fs.readFileSync(path.resolve(directory, relative), 'utf8');
    return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
}

function makeContext(options = {}) {
    const raw = options.body === undefined ? '{}' : options.body;
    const response = new Response(raw, { status: options.status || 200, headers: options.responseHeaders || { 'Content-Type': 'application/json; charset=utf-8' } });
    const stored = options.stored || new Map();
    const calls = { requestReads: 0, responseReads: 0, gets: 0, sets: 0, notifications: [], network: 0 };
    const ctx = {
        env: options.env || {},
        app: { version: 'test-only' },
        request: {
            url: options.url || 'https://api.m.jd.com/client.action?functionId=start',
            method: options.method || 'GET',
            headers: new Headers(options.headers || {}),
            async text() {
                calls.requestReads++;
                if (calls.requestReads > 1) throw new Error('request-consumed');
                if (options.requestReadError) throw new Error('mock-request-read-error');
                return options.requestBody || '';
            }
        },
        response: {
            status: response.status,
            headers: response.headers,
            body: response.body,
            async arrayBuffer() {
                calls.responseReads++;
                if (calls.responseReads > 1) throw new Error('response-consumed');
                if (options.readError) throw new Error('mock-response-read-error');
                return response.arrayBuffer();
            },
            async text() {
                calls.responseReads++;
                if (calls.responseReads > 1) throw new Error('response-consumed');
                if (options.readError) throw new Error('mock-response-read-error');
                return response.text();
            }
        },
        storage: {
            getJSON(key) {
                calls.gets++;
                if (options.storageReadError) throw new Error('mock-storage-read-error');
                return stored.has(key) ? JSON.parse(JSON.stringify(stored.get(key))) : null;
            },
            setJSON(key, value) {
                calls.sets++;
                if (options.storageWriteError) throw new Error('mock-storage-write-error');
                stored.set(key, JSON.parse(JSON.stringify(value)));
            }
        },
        notify(value) { calls.notifications.push(value); },
        http: {
            async get() { calls.network++; throw new Error('network-forbidden-in-test'); },
            async post() { calls.network++; throw new Error('network-forbidden-in-test'); }
        }
    };
    if (options.generic) { delete ctx.request; delete ctx.response; }
    return { ctx, calls, stored, response, raw };
}

function moduleText(directory, relative) {
    return fs.readFileSync(path.resolve(directory, relative), 'utf8');
}

function urlPatterns(text) {
    return [...text.matchAll(/match: '(\^[^'\n]*)'/g)].map(match => new RegExp(match[1]));
}

module.exports = { loadScript, makeContext, moduleText, urlPatterns };
