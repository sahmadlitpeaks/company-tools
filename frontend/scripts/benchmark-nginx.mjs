import { spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";

// Run the real nginx server configuration with only local paths/upstreams changed.
// Requires a local nginx executable; never downloads one or contacts the backend.
const frontend = fileURLToPath(new URL("..", import.meta.url));
const binary = process.env.NGINX_BINARY;
if (!binary) throw new Error("Set NGINX_BINARY to a local nginx executable.");
const label = process.argv[2] || "baseline";
const folder = resolve(frontend, "../qa-out/nginx", label);
await mkdir(resolve(folder, "logs"), { recursive: true });
await mkdir(resolve(folder, "temp"), { recursive: true });
const probe = createServer();
await new Promise((done) => probe.listen(0, "127.0.0.1", done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const config = (await readFile(resolve(frontend, process.env.BENCHMARK_NGINX_CONFIG || "nginx.conf"), "utf8"))
  .replace("listen 80;", `listen 127.0.0.1:${port};`)
  .replace("root /usr/share/nginx/html;", `root "${resolve(frontend, "dist").replaceAll("\\", "/")}";`)
  .replaceAll("http://backend:8000", "http://127.0.0.1:9");
const mimeTypes = resolve(dirname(binary), "conf/mime.types").replaceAll("\\", "/");
const file = resolve(folder, "nginx.conf");
await writeFile(file, `daemon off;\npid logs/nginx.pid;\nerror_log logs/error.log;\nevents {}\nhttp { include "${mimeTypes}"; access_log off; ${config}\n}\n`);
const prefix = folder.replaceAll("\\", "/") + "/";
const server = spawn(binary, ["-p", prefix, "-c", file], { windowsHide: true });
const stderr = [];
server.stderr.on("data", (data) => stderr.push(String(data)));
function get(path) {
  return new Promise((done, reject) => {
    const start = performance.now();
    const req = request({ hostname: "127.0.0.1", port, path, headers: { "Accept-Encoding": "gzip" }, timeout: 5000 }, (response) => {
      let bytes = 0;
      response.on("data", (chunk) => { bytes += chunk.length; });
      response.on("end", () => done({ status: response.statusCode, headers: response.headers, bytes, ms: Math.round((performance.now() - start) * 100) / 100 }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("nginx request timed out")));
    req.end();
  });
}
try {
  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    try { await get("/index.html"); ready = true; break; } catch {}
    if (server.exitCode !== null) throw new Error(stderr.join(""));
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!ready) throw new Error("nginx did not start: " + stderr.join(""));
  const html = await readFile(resolve(frontend, "dist/index.html"), "utf8");
  const assets = await readdir(resolve(frontend, "dist/assets"));
  const paths = [
    html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1],
    html.match(/href="(\/assets\/index-[^"]+\.css)"/)[1],
    "/assets/" + assets.find((name) => name.startsWith("pdf.worker.min-") && name.endsWith(".mjs")),
    "/assets/" + assets.find((name) => name.startsWith("dm-sans-latin-wght") && name.endsWith(".woff2")),
  ];
  const results = [];
  for (const path of paths) {
    const samples = [];
    for (let run = 0; run < 7; run += 1) samples.push(await get(path));
    const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
    results.push({ path, bytes: samples[0].bytes, medianMs: sorted[3], headers: samples[0].headers, status: samples[0].status, samples });
  }
  const result = { label, runs: 7, nginx: "local executable", results, html: await get("/index.html"), missingAsset: await get("/assets/missing-file.js") };
  if (process.env.BENCHMARK_EXPECT_OPTIMIZED) {
    for (const asset of results) {
      assert.equal(asset.status, 200);
      assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable");
      if (!asset.path.endsWith(".woff2")) {
        assert.equal(asset.headers["content-encoding"], "gzip");
        assert.match(asset.headers.vary, /Accept-Encoding/);
      }
    }
    assert.equal(results.find((asset) => asset.path.endsWith(".mjs")).headers["content-type"], "application/javascript");
    assert.equal(result.html.headers["cache-control"], "no-cache");
    assert.equal(result.missingAsset.status, 404);
  }
  const destination = resolve(frontend, "../qa-out/performance", `nginx-${label}.json`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, results: results.map(({ samples, ...result }) => result) }));
} finally {
  if (server.exitCode === null) {
    const stopped = new Promise((done) => server.once("exit", done));
    const quit = spawn(binary, ["-p", prefix, "-c", file, "-s", "quit"], { windowsHide: true });
    await new Promise((done) => quit.once("exit", done));
    await stopped;
  }
}
