// Surge iOS 6 | JavaScript | ID8 request dispatcher
// Build: node output/youtube/build.mjs
// Run: invoked by ios-youtube-* http-request script lines.
// Deps: self-contained; original author gholts/Maasea, native download IBL3ND.
(function () {
  // Surge iOS 6 | JavaScript | Runtime compatibility and argument calibration.
  // Build: node output/youtube/build.mjs
  // Run: included in the two generated dispatcher scripts.
  (function installYouTubeCompat(global) {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function fromBase64(value, options) {
      let text = String(value)
        .replace(/\s/g, "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      if (/[^A-Za-z0-9+/=]/.test(text)) throw new Error("Invalid base64 input");
      text = text.replace(/=+$/, "");
      let bits = 0,
        word = 0;
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
      let result = "";
      for (let i = 0; i < bytes.length; i += 3) {
        const value =
          bytes[i] * 65536 + (bytes[i + 1] || 0) * 256 + (bytes[i + 2] || 0);
        result +=
          alphabet[value >>> 18] +
          alphabet[(value >>> 12) & 63] +
          (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : "=") +
          (i + 2 < bytes.length ? alphabet[value & 63] : "=");
      }
      if (options && options.alphabet === "base64url")
        result = result.replace(/\+/g, "-").replace(/\//g, "_");
      return options && options.omitPadding
        ? result.replace(/=+$/, "")
        : result;
    }
    if (typeof Uint8Array.fromBase64 !== "function")
      Object.defineProperty(Uint8Array, "fromBase64", {
        value: fromBase64,
        configurable: true,
      });
    if (typeof Uint8Array.prototype.toBase64 !== "function")
      Object.defineProperty(Uint8Array.prototype, "toBase64", {
        value(options) {
          return toBase64(this, options);
        },
        configurable: true,
      });
    if (typeof Object.hasOwn !== "function")
      Object.hasOwn = (object, property) =>
        Object.prototype.hasOwnProperty.call(object, property);
    if (typeof global.TextEncoder !== "function")
      global.TextEncoder = class TextEncoder {
        encode(input = "") {
          const output = [];
          for (const character of String(input)) {
            let code = character.codePointAt(0);
            if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
            if (code < 128) output.push(code);
            else if (code < 2048)
              output.push(192 | (code >>> 6), 128 | (code & 63));
            else if (code < 65536)
              output.push(
                224 | (code >>> 12),
                128 | ((code >>> 6) & 63),
                128 | (code & 63),
              );
            else
              output.push(
                240 | (code >>> 18),
                128 | ((code >>> 12) & 63),
                128 | ((code >>> 6) & 63),
                128 | (code & 63),
              );
          }
          return new Uint8Array(output);
        }
      };
    if (typeof global.TextDecoder !== "function")
      global.TextDecoder = class TextDecoder {
        constructor(label = "utf-8", options = {}) {
          if (!/^utf-?8$/i.test(label))
            throw new Error("Only UTF-8 decoding is supported");
          this.fatal = !!options.fatal;
        }
        decode(input = new Uint8Array()) {
          const bytes =
            input instanceof ArrayBuffer
              ? new Uint8Array(input)
              : new Uint8Array(
                  input.buffer,
                  input.byteOffset || 0,
                  input.byteLength,
                );
          let result = "";
          const invalid = () => {
            if (this.fatal) throw new Error("Invalid UTF-8");
            result += "\ufffd";
          };
          for (let i = 0; i < bytes.length; ) {
            const first = bytes[i++];
            if (first < 128) {
              result += String.fromCharCode(first);
              continue;
            }
            const count =
              first >= 0xc2 && first <= 0xdf
                ? 1
                : first >= 0xe0 && first <= 0xef
                  ? 2
                  : first >= 0xf0 && first <= 0xf4
                    ? 3
                    : -1;
            if (count < 0 || i + count > bytes.length) {
              invalid();
              continue;
            }
            let code = first & (127 >>> (count + 1)),
              valid = true;
            for (let j = 0; j < count; j++) {
              const next = bytes[i + j];
              if ((next & 0xc0) !== 0x80) {
                valid = false;
                break;
              }
              code = code * 64 + (next & 63);
            }
            if (
              !valid ||
              code < [0, 128, 2048, 65536][count] ||
              code > 0x10ffff ||
              (code >= 0xd800 && code <= 0xdfff)
            ) {
              invalid();
              continue;
            }
            i += count;
            result += String.fromCodePoint(code);
          }
          return result;
        }
      };
  })(typeof globalThis === "object" ? globalThis : this);

  function youtubeArguments(input) {
    const defaults = {
      blockUpload: true,
      blockShorts: true,
      autoHd: true,
      blockGames: true,
      blockVerticalLive: true,
      jumpAhead: true,
      blockStore: true,
      nativeDownload: true,
      dualSubtitles: true,
      blockAi: false,
      onTheGo: false,
      subtitleLanguage: "zh-CN",
      showOnlyAutoTranslation: false,
    };
    let supplied = {};
    if (typeof input === "string" && input.trim() && !input.includes("{{{")) {
      try {
        if (input.trim().startsWith("{")) supplied = JSON.parse(input);
        else
          for (const item of input.split("&")) {
            const index = item.indexOf("=");
            if (index >= 0)
              supplied[decodeURIComponent(item.slice(0, index))] =
                decodeURIComponent(item.slice(index + 1));
          }
      } catch (error) {
        console.log("YouTube argument parse: " + error.message);
      }
    }
    const aliases = {
      屏蔽上传按钮: "blockUpload",
      block_upload: "blockUpload",
      block_shorts: "blockShorts",
      auto_hd: "autoHd",
      block_games: "blockGames",
      block_vertical_live: "blockVerticalLive",
      jump_ahead: "jumpAhead",
      block_store: "blockStore",
      native_download: "nativeDownload",
      dual_subtitles: "dualSubtitles",
      subtitle_language: "subtitleLanguage",
      show_only_auto_translation: "showOnlyAutoTranslation",
    };
    for (const [key, value] of Object.entries(supplied)) {
      const name = aliases[key] || key;
      if (!Object.hasOwn(defaults, name)) continue;
      if (typeof defaults[name] === "boolean") {
        if (value === true || /^(true|1|on|yes)$/i.test(String(value)))
          defaults[name] = true;
        else if (value === false || /^(false|0|off|no)$/i.test(String(value)))
          defaults[name] = false;
      } else if (/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(String(value)))
        defaults[name] = String(value);
    }
    return defaults;
  }
  function youtubeBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value))
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return value;
  }
  function youtubeFinish(originalDone) {
    let completed = false;
    return function finish(result) {
      if (completed) return;
      const output = result || {};
      if (Object.hasOwn(output, "body")) {
        const bytes = youtubeBytes(output.body);
        output.body =
          typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
        if (!(output.body instanceof Uint8Array))
          throw new Error("Invalid output body type");
      }
      if (output.response && Object.hasOwn(output.response, "body")) {
        const bytes = youtubeBytes(output.response.body);
        output.response.body =
          typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
        if (!(output.response.body instanceof Uint8Array))
          throw new Error("Invalid response body type");
      }
      completed = true;
      originalDone(output);
    };
  }

  function compatibleRequest($request, $response, $argument, $done) {
    (() => {
      const e = "YouTubeConfig";
      function t(t = e, r = 1 / 0) {
        const n = $persistentStore.read(t);
        if ("string" == typeof n && n.length > r) return {};
        try {
          const e = JSON.parse(n || "{}");
          return e && "object" == typeof e && !Array.isArray(e) ? e : {};
        } catch {
          return {};
        }
      }
      function r(e) {
        const t = new Uint8Array(e.reduce((e, t) => e + t.length, 0));
        let r = 0;
        for (const n of e) t.set(n, r), (r += n.length);
        return t;
      }
      function n(e, t) {
        return (
          e === t || (e.length === t.length && e.every((e, r) => e === t[r]))
        );
      }
      function o(e) {
        const t = [];
        do {
          t.push(e % 128 | (e > 127 ? 128 : 0)), (e = Math.floor(e / 128));
        } while (e);
        return new Uint8Array(t);
      }
      function i(e) {
        const t = [];
        let r = 0;
        function n() {
          let t = 0,
            n = 1;
          for (let o = 0; o < 5; o++) {
            if (r >= e.length) throw new Error("Truncated protobuf varint");
            const o = e[r++];
            if (((t += (127 & o) * n), !(128 & o))) {
              if (t > 4294967295)
                throw new Error("Protobuf length/tag overflow");
              return t;
            }
            n *= 128;
          }
          throw new Error("Invalid protobuf varint");
        }
        for (; r < e.length; ) {
          const o = r,
            i = n(),
            s = Math.floor(i / 8),
            u = i % 8;
          if (!s) throw new Error("Invalid protobuf field");
          let a = r;
          if (2 === u) {
            const e = n();
            (a = r), (r += e);
          } else if (1 === u) r += 8;
          else if (5 === u) r += 4;
          else {
            if (0 !== u) throw new Error("Unsupported protobuf wire type " + u);
            {
              let t,
                n = 0;
              do {
                if (r >= e.length || 10 === n++)
                  throw new Error("Invalid protobuf integer");
                if (((t = e[r++]), 10 === n && t > 1))
                  throw new Error("Protobuf integer overflow");
              } while (128 & t);
            }
          }
          if (r > e.length) throw new Error("Truncated protobuf field");
          t.push({
            no: s,
            wire: u,
            data: e.subarray(a, r),
            raw: e.subarray(o, r),
          });
        }
        return t;
      }
      function s(e) {
        let t = 0,
          r = 1;
        for (const n of e) (t += (127 & n) * r), (r *= 128);
        return t;
      }
      function u(e = {}) {
        return "string" != typeof $argument || $argument.includes("{{{")
          ? e
          : { ...e, ...JSON.parse($argument) };
      }
      function a(e) {
        return Object.entries(e.headers ?? {}).some(
          ([e, t]) => "user-agent" === e.toLowerCase() && /music/i.test(t),
        )
          ? "youtubeMusic"
          : "youtube";
      }
      function f(e, t, r = !1) {
        let n;
        for (const o of i(e))
          if (o.no === t && 2 === o.wire) {
            if (!r) return o.data;
            if (n) return;
            n = o.data;
          }
        return n;
      }
      function c(e) {
        const t = e.replace(/[-_\s=]/g, (e) =>
            "-" === e ? "+" : "_" === e ? "/" : "",
          ),
          r = t.length % 4 == 1,
          n = Uint8Array.fromBase64(r ? t + "A" : t);
        return r ? n.subarray(0, -1) : n;
      }
      function h(e, t) {
        const n = new Map(
            t
              ? [
                  [13, 0],
                  [14, 2],
                  [16, t.height],
                  [21, t.height],
                  [26, 3],
                  [30, 0],
                ]
              : [
                  [16, 4320],
                  [26, 1],
                  [30, 0],
                ],
          ),
          u = new Set(),
          a = [];
        let f = !1;
        for (const t of i(e)) {
          const e = 0 === t.wire ? n.get(t.no) : void 0;
          void 0 !== e
            ? (s(t.data) === e
                ? a.push(t.raw)
                : (a.push(o(8 * t.no), o(e)), (f = !0)),
              u.add(t.no))
            : a.push(t.raw);
        }
        for (const [e, t] of n) u.has(e) || (a.push(o(8 * e), o(t)), (f = !0));
        return f ? r(a) : e;
      }
      function l(e) {
        const t = e.body;
        if (ArrayBuffer.isView(t))
          return new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
        if (t?.length)
          throw new Error(
            "YouTube requires binary-body-mode for request bodies",
          );
        const r = Object.entries(e.headers ?? {}).find(
          ([e]) => "content-length" === e.toLowerCase(),
        )?.[1];
        if (Number(r) > 0)
          throw new Error(
            "YouTube request body unavailable; requires-body must be enabled",
          );
      }
      !(function () {
        try {
          const g = $request.url.split("?")[0];
          let d;
          if (g.endsWith("/player/ad_break"))
            d = {
              response: {
                status: 200,
                headers: { "Content-Type": "application/x-protobuf" },
                body: new Uint8Array(),
              },
            };
          else if (g.endsWith("/log_event"))
            d = (function (e) {
              const r = Object.keys(e.headers ?? {}).filter(
                (e) => "x-youtube-hot-hash-data" === e.toLowerCase(),
              );
              if (!r.length || t()[a(e)]?.clientKey) return;
              const n = { ...e.headers };
              for (const e of r) delete n[e];
              return { headers: n };
            })($request);
          else if (g.endsWith("/initplayback")) {
            if ("GET" !== $request.method && "HEAD" !== $request.method) {
              const s = l($request);
              if (
                s?.length &&
                (function (r, o) {
                  const i = f(r, 3),
                    s = i && f(i, 5);
                  if (!s?.length) return !1;
                  const u = t()[o];
                  for (const e of (a = u)
                    ? [
                        a,
                        ...(Array.isArray(a.previous)
                          ? a.previous.slice(0, 3)
                          : []),
                      ].filter(
                        (e) =>
                          e &&
                          "string" == typeof e.clientKey &&
                          "string" == typeof e.encryptKey &&
                          e.clientKey.length > 0 &&
                          e.clientKey.length <= 5500 &&
                          e.encryptKey.length > 0 &&
                          e.encryptKey.length <= 5500,
                      )
                    : [])
                    try {
                      if (n(s, c(e.encryptKey))) return !0;
                    } catch {}
                  var a;
                  return (
                    (function (r, n) {
                      if (void 0 === r || void 0 === n) return;
                      const o = t();
                      if (!Object.hasOwn(o, r)) return;
                      const i = o[r],
                        s = n;
                      JSON.stringify(i) === JSON.stringify(s) &&
                        (delete o[r],
                        (function (t, r = e) {
                          $persistentStore.write(JSON.stringify(t), r);
                        })(o));
                    })(o, u),
                    !1
                  );
                })(s, a($request)) &&
                !1 !== u().autoHd
              ) {
                const e = (function (e) {
                  const t = i(e),
                    n = t.filter((e) => 2 === e.no && 2 === e.wire);
                  if (1 !== n.length) return e;
                  const s = n[0],
                    u = h(s.data, void 0);
                  return u === s.data
                    ? e
                    : r(
                        t.map((e) =>
                          e === s ? r([o(18), o(u.length), u]) : e.raw,
                        ),
                      );
                })(s);
                e !== s && (d = { body: e });
              }
            }
          } else if (g.endsWith("/videoplayback")) {
            const e = !1 === u().autoHd ? void 0 : l($request);
            if (e?.length) {
              const u = (function (e, u) {
                const a = i(e),
                  c = (function (e, r) {
                    try {
                      const n = /[?&]id=([^&]+)/.exec(r);
                      if (!n) return;
                      const o = e.find((e) => 5 === e.no && 2 === e.wire),
                        u = o && f(o.data, 1);
                      if (!u?.length) return;
                      const a = t("YouTubeQuality", 65536)?.[
                        decodeURIComponent(n[1])
                      ];
                      if (
                        !(function (e) {
                          const t = e;
                          return !!(
                            t &&
                            "object" == typeof t &&
                            !Array.isArray(t) &&
                            Number.isInteger(t.height) &&
                            t.height > 0 &&
                            t.height <= 2147483647 &&
                            Array.isArray(t.itags) &&
                            t.itags.length > 0 &&
                            t.itags.length <= 256 &&
                            t.itags.every(
                              (e) =>
                                Number.isInteger(e) && e > 0 && e <= 4294967295,
                            ) &&
                            new Set(t.itags).size === t.itags.length &&
                            (void 0 === t.premiumItags ||
                              (Array.isArray(t.premiumItags) &&
                                t.premiumItags.length <= t.itags.length &&
                                new Set(t.premiumItags).size ===
                                  t.premiumItags.length &&
                                t.premiumItags.every((e) =>
                                  t.itags.includes(e),
                                )))
                          );
                        })(a)
                      )
                        return;
                      const c = [],
                        h = [];
                      for (const e of i(u)) {
                        if (6 !== e.no || 2 !== e.wire) continue;
                        const t = i(e.data).find(
                          (e) => 1 === e.no && 0 === e.wire,
                        );
                        if (!t) continue;
                        const r = s(t.data);
                        a.itags.includes(r) &&
                          (c.push(e.data),
                          a.premiumItags?.includes(r) && h.push(e.data));
                      }
                      return c.length
                        ? { height: a.height, formats: h.length ? h : c }
                        : void 0;
                    } catch {
                      return;
                    }
                  })(a, u),
                  l = a.filter((e) => 17 === e.no && 2 === e.wire),
                  g =
                    c &&
                    (l.length !== c.formats.length ||
                      l.some((e, t) => !n(e.data, c.formats[t]))),
                  d = [];
                let y = !1,
                  p = !!g;
                for (const e of a)
                  if (1 === e.no && 2 === e.wire) {
                    const t = h(e.data, c);
                    t === e.data
                      ? d.push(e.raw)
                      : (d.push(o(10), o(t.length), t), (p = !0)),
                      (y = !0);
                  } else {
                    if (g && 17 === e.no && 2 === e.wire) continue;
                    d.push(e.raw);
                  }
                if (!y) {
                  const e = h(new Uint8Array(), c);
                  d.push(o(10), o(e.length), e), (p = !0);
                }
                if (g)
                  for (const e of c.formats) d.push(o(138), o(e.length), e);
                return p ? r(d) : e;
              })(e, $request.url);
              u !== e && (d = { body: u });
            }
          }
          $done(d);
        } catch (e) {
          console.log("YouTube request: " + e), $done();
        }
      })();
    })();
  }

  function nativeDownloadRequest($request, $response, $argument, $done) {
    const CONFIG_KEY = "YouTubeConfig";

    const QUALITY_KEY = "YouTubeQuality";

    function main() {
      const path = $request.url.split("?")[0],
        platform = platformKey($request);

      try {
        let result = {};

        if (path.endsWith("/player/ad_break")) result = emptyPlayback();
        else if (path.endsWith("/log_event"))
          result = prepareLogEvent($request.headers, platform);
        else if (path.endsWith("/initplayback"))
          result = preparePlayback($request.body, platform);
        else if (
          path.endsWith("/youtubei/v1/player") &&
          readOptions().nativeDownload === true
        )
          result = prepareOfflineDownload($request.body);
        else if (path.endsWith("/videoplayback")) {
          const options = readOptions();

          if (
            options.autoHd !== false &&
            $request.body instanceof Uint8Array &&
            $request.body.length
          )
            result = {
              body: forceHighestQuality($request.body, $request.url),
            };
        }

        $done(result);
      } catch (error) {
        console.log("YouTube request: " + error);

        $done({});
      }
    }

    function emptyPlayback() {
      return {
        response: {
          status: 200,

          headers: { "Content-Type": "application/x-protobuf" },

          body: new Uint8Array(),
        },
      };
    }

    function prepareLogEvent(requestHeaders, platform) {
      const headers = { ...requestHeaders };

      if (!readConfig()[platform]?.clientKey)
        for (const name of Object.keys(headers))
          if (name.toLowerCase() === "x-youtube-hot-hash-data")
            delete headers[name];

      return { headers };
    }

    function preparePlayback(body, platform) {
      const key = readConfig()[platform]?.encryptKey;

      const encrypted = body instanceof Uint8Array && bytesField(body, 3);

      const clientKey = encrypted && bytesField(encrypted, 5);

      if (key && clientKey && sameBytes(clientKey, decodeBase64(key)))
        return {};

      return {};
    }

    function prepareOfflineDownload(body) {
      if (!(body instanceof Uint8Array) || !body.length) return {};

      const fields = wireFields(body),
        offline = fields.filter((field) => field.no === 8),
        params = fields.filter((field) => field.no === 12);

      if (
        offline.length !== 1 ||
        offline[0].wire !== 0 ||
        offline[0].data.length !== 1 ||
        offline[0].data[0] !== 1 ||
        params.length !== 1 ||
        params[0].wire !== 2 ||
        params[0].data.length !== 0
      )
        return {};

      return {
        body: concatBytes(
          fields

            .filter((field) => field !== params[0])

            .map((field) => field.raw),
        ),
      };
    }

    function setQuality(bytes, quality) {
      const values = new Map(
          quality
            ? [
                [13, 0],

                [14, 2],

                [16, quality.height],

                [21, quality.height],

                [26, 3],

                [30, 0],
              ]
            : [
                [16, 4320],

                [26, 1],
              ],
        ),
        seen = new Set(),
        chunks = [];

      for (const field of wireFields(bytes)) {
        if (field.wire === 0 && values.has(field.no)) {
          chunks.push(varint(field.no * 8), varint(values.get(field.no)));

          seen.add(field.no);
        } else chunks.push(field.raw);
      }

      for (const [no, value] of values)
        if (!seen.has(no)) chunks.push(varint(no * 8), varint(value));

      return concatBytes(chunks);
    }

    function selectQuality(fields, url) {
      try {
        const match = /[?&]id=([^&]+)/.exec(url);

        if (!match) return;

        const quality = readConfig(QUALITY_KEY)?.[decodeURIComponent(match[1])];

        if (
          !Number.isInteger(quality?.height) ||
          quality.height <= 0 ||
          quality.height > 0x7fffffff ||
          !Array.isArray(quality.itags)
        )
          return;

        const config = fields.find(
          (field) => field.no === 5 && field.wire === 2,
        );

        const signed = config && bytesField(config.data, 1);

        if (!signed) return;

        const formats = wireFields(signed)
          .filter((field) => {
            if (field.no !== 6 || field.wire !== 2) return false;

            const itag = wireFields(field.data).find(
              (field) => field.no === 1 && field.wire === 0,
            );

            if (!itag) return false;

            let value = 0,
              scale = 1;

            for (const byte of itag.data) {
              value += (byte & 127) * scale;

              scale *= 128;
            }

            return quality.itags.includes(value);
          })

          .map((field) => field.data);

        return formats.length ? { height: quality.height, formats } : undefined;
      } catch {
        return undefined;
      }
    }

    function forceHighestQuality(bytes, url) {
      const fields = wireFields(bytes),
        quality = selectQuality(fields, url);

      const chunks = [];

      let found = false;

      for (const field of fields) {
        if (field.no === 1 && field.wire === 2) {
          const state = setQuality(field.data, quality);

          chunks.push(varint(10), varint(state.length), state);

          found = true;
        } else if (quality && field.no === 17 && field.wire === 2) {
          continue;
        } else chunks.push(field.raw);
      }

      if (!found) {
        const state = setQuality(new Uint8Array(), quality);

        chunks.push(varint(10), varint(state.length), state);
      }

      if (quality)
        for (const format of quality.formats)
          chunks.push(varint(17 * 8 + 2), varint(format.length), format);

      return concatBytes(chunks);
    }

    function readOptions(defaults = {}) {
      return typeof $argument === "string" && !$argument.includes("{{{")
        ? { ...defaults, ...JSON.parse($argument) }
        : defaults;
    }

    function platformKey(request) {
      return Object.entries(request.headers ?? {}).some(
        ([name, value]) =>
          name.toLowerCase() === "user-agent" && /music/i.test(value),
      )
        ? "youtubeMusic"
        : "youtube";
    }

    function readConfig(key = CONFIG_KEY) {
      try {
        return JSON.parse($persistentStore.read(key) || "{}");
      } catch {
        return {};
      }
    }

    function writeConfig(config) {
      $persistentStore.write(JSON.stringify(config), CONFIG_KEY);
    }

    function clearKeys(platform) {
      const config = readConfig();

      if (config[platform]) {
        delete config[platform];

        writeConfig(config);
      }
    }

    function bytesField(bytes, number) {
      return wireFields(bytes).find(
        (field) => field.no === number && field.wire === 2,
      )?.data;
    }

    function concatBytes(chunks) {
      const result = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));

      let offset = 0;

      for (const bytes of chunks) {
        result.set(bytes, offset);

        offset += bytes.length;
      }

      return result;
    }

    function sameBytes(a, b) {
      return (
        a === b ||
        (a.length === b.length && a.every((value, i) => value === b[i]))
      );
    }

    function varint(value) {
      const bytes = [];

      do {
        bytes.push(value % 128 | (value > 127 ? 128 : 0));

        value = Math.floor(value / 128);
      } while (value);

      return new Uint8Array(bytes);
    }

    function wireFields(bytes) {
      const fields = [];

      let offset = 0;

      function read() {
        let value = 0,
          scale = 1;

        for (let i = 0; i < 5; i++) {
          if (offset >= bytes.length)
            throw new Error("Truncated protobuf varint");

          const byte = bytes[offset++];

          value += (byte & 127) * scale;

          if (!(byte & 128)) {
            if (value > 0xffffffff)
              throw new Error("Protobuf length/tag overflow");

            return value;
          }

          scale *= 128;
        }

        throw new Error("Invalid protobuf varint");
      }

      while (offset < bytes.length) {
        const start = offset,
          tag = read(),
          no = Math.floor(tag / 8),
          wire = tag % 8;

        if (!no) throw new Error("Invalid protobuf field");

        let payloadStart = offset;

        if (wire === 2) {
          const length = read();

          payloadStart = offset;

          offset += length;
        } else if (wire === 1) offset += 8;
        else if (wire === 5) offset += 4;
        else if (wire === 0) {
          let count = 0,
            byte;

          do {
            if (offset >= bytes.length || count++ === 10)
              throw new Error("Invalid protobuf integer");

            byte = bytes[offset++];

            if (count === 10 && byte > 1)
              throw new Error("Protobuf integer overflow");
          } while (byte & 128);
        } else throw new Error("Unsupported protobuf wire type " + wire);

        if (offset > bytes.length) throw new Error("Truncated protobuf field");

        fields.push({
          no,

          wire,

          data: bytes.subarray(payloadStart, offset),

          raw: bytes.subarray(start, offset),
        });
      }

      return fields;
    }

    function decodeBase64(value) {
      const alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

      let buffer = 0,
        bits = 0;

      const output = [];

      for (const character of value.replace(/-/g, "+").replace(/_/g, "/")) {
        if (/\s|=/.test(character)) continue;

        const index = alphabet.indexOf(character);

        if (index < 0) throw new Error("Invalid base64 key");

        buffer = (buffer << 6) | index;

        bits += 6;

        if (bits >= 8) {
          bits -= 8;

          output.push((buffer >>> bits) & 255);
        }
      }

      return new Uint8Array(output);
    }

    main();
  }

  const finish = youtubeFinish($done);
  try {
    const request = { ...$request, body: youtubeBytes($request.body) };
    const options = youtubeArguments(
      typeof $argument === "string" ? $argument : "",
    );
    const pathname = request.url.split("?")[0];
    if (
      /^https:\/\/youtubei\.googleapis\.com\/youtubei\/v1\/player$/.test(
        pathname,
      )
    ) {
      if (!options.nativeDownload) return finish({});
      nativeDownloadRequest(
        request,
        undefined,
        JSON.stringify(options),
        finish,
      );
    } else if (
      /^https:\/\/youtubei\.googleapis\.com\/youtubei\/v1\/(?:player\/ad_break|log_event)$/.test(
        pathname,
      ) ||
      /^https?:\/\/[\w-]+\.googlevideo\.com\/(?:initplayback|videoplayback)$/.test(
        pathname,
      )
    ) {
      compatibleRequest(request, undefined, JSON.stringify(options), finish);
    } else finish({});
  } catch (error) {
    console.log("ios-youtube-request: " + error.message);
    finish({});
  }
})();
