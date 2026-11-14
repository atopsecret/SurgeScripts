# Required offline test fixtures

These files are the smallest dependency set needed by the existing migration mocks. They are committed test inputs, not production imports. Nothing here is fetched or invoked against a live service by the test command.

- `common/cache/`: six exact public Egern baselines used for JSON and SOAP parity. Shared policy code is already inlined in those originals. No native-script cache or build tools are needed.
- [common/parsed-sources.json](<./common/parsed-sources.json>): only the original seven modules' `rules`, `map_locals` and `mitm` objects. This retains exact status codes, headers, multipart CRLF bytes, source matchers and the nine Cainiao hosts; script/widget/account parameters are excluded.
- [common/modules.json](<./common/modules.json>): source IDs and current relative artifact paths only.
- [weather/apple-weather-enhancer.egern.js](<./weather/apple-weather-enhancer.egern.js>): unchanged public Egern bundle containing WeatherKit v3.1.0 and FlatBuffers 24.12.23. The existing test exposes its original engine/codec in an isolated VM. Separate schema/vendor sources and build dependencies are unnecessary at runtime.
- [weather/source.json](<./weather/source.json>): fixed version, source URL, commits and the bundle's original SHA-256. Private audit/deployment metadata is excluded.
- [youtube/youtube-response.js](<./youtube/youtube-response.js>): unchanged public original response source. The existing mock exports its real protobuf codec, wire-field functions and UMP reader/writer instead of implementing substitutes.
- [youtube/runtime-compat.js](<./youtube/runtime-compat.js>): exact existing UTF-8 compatibility fixture; original Build comments are provenance, not runnable build instructions for this release.
- [youtube/reference.json](<./youtube/reference.json>): original nine matcher entries only. Current published module entries are checked against this snapshot.
- [camscanner-nio/02.matchers.yaml](<./camscanner-nio/02.matchers.yaml>) and [16.matchers.yaml](<./camscanner-nio/16.matchers.yaml>): one and two exact public matcher excerpts respectively, not complete device configurations.
- [camscanner-nio/modules.json](<./camscanner-nio/modules.json>): source IDs, entry names and relative/public artifact destinations only. NIO's synthetic tokens and memory store remain in the original [runtime-mock.cjs](<../tests/runtime-mock.cjs>); the unused NIO upstream reference script is not copied.
- [release-layout.json](<./release-layout.json>): actual original module parameter snapshots, basename inventory, original suite counts and the evidenced public WeatherKit fallback constant. Active caps remain unchanged. The disabled JD request-body example has its original larger cap, but is not an active body reader.
- [provenance.json](<./provenance.json>): hashes and sizes of all 12 unchanged copied files (nine JS baselines and three license files), plus original hashes for the seven reused test/helper files. All recorded paths are repository-relative; no original local audit or device paths are retained.

WeatherKit/Egern and FlatBuffers licensing is preserved in [weather/LICENSE-APACHE-2.0.txt](<./weather/LICENSE-APACHE-2.0.txt>) and [weather/FLATBUFFERS-LICENSE.txt](<./weather/FLATBUFFERS-LICENSE.txt>). YouTube's existing Apache license is copied in [youtube/LICENSE-APACHE-2.0.txt](<./youtube/LICENSE-APACHE-2.0.txt>). Original author/source comments remain unchanged.

`Y2FpeXVuX25vdGlmeQ==` is the fixed v3.1.0 public ColorfulClouds fallback found in the verified upstream bundle, not a user subscriber credential. The fixture-only keys named `fixture-*` and `PRIVATE_FIXTURE` are intentionally synthetic assertions. No real subscriber UUID, account token, API key, CA/private key or device profile is required for these tests.

From the repository root:

```sh
node surge-ios/tests/run.mjs
```
