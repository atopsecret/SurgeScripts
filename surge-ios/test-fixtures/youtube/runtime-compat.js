// Surge iOS 6 | JavaScript | Runtime compatibility and argument calibration.
// Build: node output/youtube/build.mjs
// Run: included in the two generated dispatcher scripts.
(function installYouTubeCompat(global) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function fromBase64(value, options) {
    let text = String(value).replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (/[^A-Za-z0-9+/=]/.test(text)) throw new Error('Invalid base64 input');
    text = text.replace(/=+$/, '');
    let bits = 0, word = 0;
    const output = [];
    for (const character of text) {
      word = (word << 6) | alphabet.indexOf(character);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        output.push((word >>> bits) & 255);
        word &= (1 << bits) - 1;
      }
    }
    return new Uint8Array(output);
  }
  function toBase64(bytes, options) {
    let result = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const value = bytes[i] * 65536 + (bytes[i + 1] || 0) * 256 + (bytes[i + 2] || 0);
      result += alphabet[value >>> 18] + alphabet[(value >>> 12) & 63]
        + (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=')
        + (i + 2 < bytes.length ? alphabet[value & 63] : '=');
    }
    if (options && options.alphabet === 'base64url') result = result.replace(/\+/g, '-').replace(/\//g, '_');
    return options && options.omitPadding ? result.replace(/=+$/, '') : result;
  }
  if (typeof Uint8Array.fromBase64 !== 'function') Object.defineProperty(Uint8Array, 'fromBase64', { value: fromBase64, configurable: true });
  if (typeof Uint8Array.prototype.toBase64 !== 'function') Object.defineProperty(Uint8Array.prototype, 'toBase64', { value(options) { return toBase64(this, options); }, configurable: true });
  if (typeof Object.hasOwn !== 'function') Object.hasOwn = (object, property) => Object.prototype.hasOwnProperty.call(object, property);
  if (typeof global.TextEncoder !== 'function') global.TextEncoder = class TextEncoder {
    encode(input = '') {
      const output = [];
      for (const character of String(input)) {
        let code = character.codePointAt(0);
        if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
        if (code < 128) output.push(code);
        else if (code < 2048) output.push(192 | (code >>> 6), 128 | (code & 63));
        else if (code < 65536) output.push(224 | (code >>> 12), 128 | ((code >>> 6) & 63), 128 | (code & 63));
        else output.push(240 | (code >>> 18), 128 | ((code >>> 12) & 63), 128 | ((code >>> 6) & 63), 128 | (code & 63));
      }
      return new Uint8Array(output);
    }
  };
  if (typeof global.TextDecoder !== 'function') global.TextDecoder = class TextDecoder {
    constructor(label = 'utf-8', options = {}) {
      if (!/^utf-?8$/i.test(label)) throw new Error('Only UTF-8 decoding is supported');
      this.fatal = !!options.fatal;
    }
    decode(input = new Uint8Array()) {
      const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
      let result = '';
      const invalid = () => { if (this.fatal) throw new Error('Invalid UTF-8'); result += '\ufffd'; };
      for (let i = 0; i < bytes.length;) {
        const first = bytes[i++];
        if (first < 128) { result += String.fromCharCode(first); continue; }
        const count = first >= 0xc2 && first <= 0xdf ? 1 : first >= 0xe0 && first <= 0xef ? 2 : first >= 0xf0 && first <= 0xf4 ? 3 : -1;
        if (count < 0 || i + count > bytes.length) { invalid(); continue; }
        let code = first & (127 >>> count + 1), valid = true;
        for (let j = 0; j < count; j++) {
          const next = bytes[i + j];
          if ((next & 0xc0) !== 0x80) { valid = false; break; }
          code = code * 64 + (next & 63);
        }
        if (!valid || code < [0, 128, 2048, 65536][count] || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) { invalid(); continue; }
        i += count;
        result += String.fromCodePoint(code);
      }
      return result;
    }
  };
})(typeof globalThis === 'object' ? globalThis : this);

function youtubeArguments(input) {
  const defaults = {
    blockUpload: true, blockShorts: true, autoHd: true, blockGames: true,
    blockVerticalLive: true, jumpAhead: true, blockStore: true,
    nativeDownload: true, dualSubtitles: true,
    blockAi: false, onTheGo: false, subtitleLanguage: 'zh-CN', showOnlyAutoTranslation: false,
  };
  let supplied = {};
  if (typeof input === 'string' && input.trim() && !input.includes('{{{')) {
    try {
      if (input.trim().startsWith('{')) supplied = JSON.parse(input);
      else for (const item of input.split('&')) {
        const index = item.indexOf('=');
        if (index >= 0) supplied[decodeURIComponent(item.slice(0, index))] = decodeURIComponent(item.slice(index + 1));
      }
    } catch (error) { console.log('YouTube argument parse: ' + error.message); }
  }
  const aliases = {
    '屏蔽上传按钮': 'blockUpload', block_upload: 'blockUpload', block_shorts: 'blockShorts',
    auto_hd: 'autoHd', block_games: 'blockGames', block_vertical_live: 'blockVerticalLive',
    jump_ahead: 'jumpAhead', block_store: 'blockStore', native_download: 'nativeDownload',
    dual_subtitles: 'dualSubtitles', subtitle_language: 'subtitleLanguage',
    show_only_auto_translation: 'showOnlyAutoTranslation',
  };
  for (const [key, value] of Object.entries(supplied)) {
    const name = aliases[key] || key;
    if (!Object.hasOwn(defaults, name)) continue;
    if (typeof defaults[name] === 'boolean') {
      if (value === true || /^(true|1|on|yes)$/i.test(String(value))) defaults[name] = true;
      else if (value === false || /^(false|0|off|no)$/i.test(String(value))) defaults[name] = false;
    } else if (/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(String(value))) defaults[name] = String(value);
  }
  return defaults;
}
function youtubeBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return value;
}
function youtubeFinish(originalDone) {
  let completed = false;
  return function finish(result) {
    if (completed) return;
    const output = result || {};
    if (Object.hasOwn(output, 'body')) {
      const bytes = youtubeBytes(output.body);
      output.body = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
      if (!(output.body instanceof Uint8Array)) throw new Error('Invalid output body type');
    }
    if (output.response && Object.hasOwn(output.response, 'body')) {
      const bytes = youtubeBytes(output.response.body);
      output.response.body = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
      if (!(output.response.body instanceof Uint8Array)) throw new Error('Invalid response body type');
    }
    completed = true;
    originalDone(output);
  };
}
