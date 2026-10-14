import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "@playwright/test";
import assert from "node:assert/strict";

// Production assets, deterministic offline API fixtures, cold browser contexts.
// Measures browser work and requests; does not claim live API/provider latency.
const frontend = fileURLToPath(new URL("..", import.meta.url));
const dist = resolve(frontend, process.env.BENCHMARK_DIST || "dist");
const label = process.argv[2] || "baseline";
const runs = Number(process.env.BENCHMARK_RUNS || 7);
const output = resolve(frontend, "../qa-out/performance", `${label}.json`);
const user = {
  id: "admin-1", email: "alex@example.com", display_name: "Alex Morgan",
  is_active: true, is_admin: true, role: "admin", status: "active",
  effective_permissions: [], managed_company_ids: [], created_at: "2026-01-01T00:00:00Z",
};
const status = {
  enabled: true, configured: true, missing: [], connected: true,
  microsoft_sign_in_required: false, can_review: true, user_id: user.id,
  openai_configured: false, active_run: false, polling_enabled: true,
  sync_interval_seconds: 60, last_sync: null, run: null, languages: ["ar", "en"],
};
const organization = [{
  id: "person-1", name: "Alex Morgan", job_title: "Chief Executive Officer",
  department_name: "Leadership", avatar_url: null, report_count: 0, reports: [],
}];
const scenarios = [
  { path: "/security", text: "Two-factor authentication" },
  { path: "/sharepoint", text: "No documents available yet." },
  { path: "/sharepoint/documents", text: "No documents found" },
  { path: "/sharepoint/assistant", selector: 'input[placeholder="Ask about your documents…"]' },
  { path: "/sharepoint/admin", text: "No document sources" },
  { path: "/org-chart", text: "Chief Executive Officer" },
];
const types = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const candidate = resolve(dist, `.${path}`);
    if (candidate !== dist && !candidate.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
    const file = extname(path) ? candidate : resolve(dist, "index.html");
    response.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
let browserVersion;
const results = [];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  for (const viewport of ["desktop", "mobile"]) {
    for (const scenario of scenarios.filter((scenario) => !process.env.BENCHMARK_PATHS || process.env.BENCHMARK_PATHS.split(",").includes(scenario.path))) {
      const samples = [];
      for (let run = 0; run < runs; run += 1) {
        const watchdog = setTimeout(() => {
          console.error(`Benchmark exceeded 60 seconds: ${viewport} ${scenario.path} run ${run + 1}`);
          process.exit(1);
        }, 60_000);
        watchdog.unref();
        if (process.env.BENCHMARK_DEBUG) console.log(`Starting ${viewport} ${scenario.path} run ${run + 1}`);
        browser = await chromium.launch();
        browserVersion = browser.version();
        const context = await browser.newContext(viewport === "mobile" ? devices["Pixel 5"] : devices["Desktop Chrome"]);
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        // Ignore third-party fonts/telemetry: all benchmark inputs stay local.
        await page.route((url) => url.origin !== baseURL, (route) => route.abort());
        const session = await context.newCDPSession(page);
        await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await session.send("Performance.enable");
        const apiRequests = {};
        const errors = [];
        const externalRequests = [];
        const pendingRequests = new Set();
        page.on("request", (request) => {
          pendingRequests.add(request);
          if (new URL(request.url()).origin !== baseURL) externalRequests.push(request.url());
        });
        page.on("requestfinished", (request) => pendingRequests.delete(request));
        page.on("requestfailed", (request) => pendingRequests.delete(request));
        page.on("pageerror", (error) => { errors.push(error.message); console.error("Page error", error.message); });
        await page.route("**/api/**", async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (!path.startsWith("/api/")) return route.continue();
          apiRequests[path] = (apiRequests[path] || 0) + 1;
          const bodies = {
            "/api/auth/me": user,
            "/api/auth/mfa/status": { enabled: false },
            "/api/companies": [],
            "/api/notifications": [],
            "/api/notifications/unread-count": { count: 0 },
            "/api/sharepoint/status": status,
            "/api/sharepoint/search": { items: [], next_cursor: null },
            "/api/sharepoint/reminders": [],
            "/api/sharepoint/source-options": [],
            "/api/sharepoint/sources": [],
            "/api/people/org-chart": organization,
          };
          await route.fulfill({ json: bodies[path] ?? {} });
        });
        await page.addInitScript((scenario) => {
          window.__benchmarkReady = null;
          window.__benchmarkLcp = null;
          new PerformanceObserver((list) => {
            window.__benchmarkLcp = list.getEntries().at(-1)?.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
          const observer = new MutationObserver(() => {
            const main = document.querySelector("main");
            if (!main) return;
            const ready = scenario.selector ? main.querySelector(scenario.selector) : main.textContent.includes(scenario.text);
            if (ready) { window.__benchmarkReady = performance.now(); observer.disconnect(); }
          });
          observer.observe(document, { childList: true, subtree: true, characterData: true });
        }, scenario);
        await page.goto(baseURL + scenario.path);
        if (process.env.BENCHMARK_DEBUG) console.log("Navigated");
        try {
          await page.waitForFunction(() => window.__benchmarkReady !== null, undefined, { timeout: 15_000, polling: 100 });
        } catch (error) {
          console.error({ path: scenario.path, errors, apiRequests, body: await page.locator("body").innerText({ timeout: 1000 }).catch(() => "no body") });
          throw error;
        }
        // Check actual startup requests instead of navigation's networkidle
        // bookkeeping, which can time out after fulfilled Playwright routes.
        let idleSince = null;
        const settleDeadline = Date.now() + 15_000;
        while (idleSince === null || Date.now() - idleSince < 500) {
          if (Date.now() > settleDeadline) {
            throw new Error("Startup requests did not settle: " + [...pendingRequests].map((request) => request.url()).join(", "));
          }
          idleSince = pendingRequests.size === 0 ? (idleSince ?? Date.now()) : null;
          await new Promise((done) => setTimeout(done, 50));
        }
        if (process.env.BENCHMARK_DEBUG) console.log("Settled");
        const sample = await page.evaluate(() => {
          const resources = performance.getEntriesByType("resource");
          const js = resources.filter((entry) => /\.m?js(?:$|\?)/.test(entry.name));
          const css = resources.filter((entry) => /\.css(?:$|\?)/.test(entry.name));
          return {
            readyMs: Math.round(window.__benchmarkReady), lcpMs: Math.round(window.__benchmarkLcp || 0),
            jsBytes: js.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
            cssBytes: css.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
            jsRequests: js.length,
            assets: js.map((entry) => new URL(entry.name).pathname),
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        const { metrics } = await session.send("Performance.getMetrics");
        const cpu = Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
        assert.deepEqual(errors, [], "Browser errors invalidate the measurement");
        assert.equal(sample.overflow, false, "Horizontal overflow invalidates the measurement");
        samples.push({ ...sample, scriptMs: Math.round(cpu.ScriptDuration * 1000), apiRequests, externalRequests, errors });
        if (process.env.BENCHMARK_SCREENSHOTS && run === runs - 1) {
          await mkdir(resolve(output, ".."), { recursive: true });
          await page.screenshot({ path: resolve(output, "..", `${label}-${viewport}-${scenario.path.replaceAll("/", "_")}.png`), fullPage: true });
        }
        await context.close();
        await browser.close();
        clearTimeout(watchdog);
        if (process.env.BENCHMARK_DEBUG) console.log("Closed context");
      }
      const result = {
        path: scenario.path, viewport, runs,
        medianReadyMs: median(samples.map((s) => s.readyMs)),
        readyRangeMs: [Math.min(...samples.map((s) => s.readyMs)), Math.max(...samples.map((s) => s.readyMs))],
        medianLcpMs: median(samples.map((s) => s.lcpMs)),
        medianScriptMs: median(samples.map((s) => s.scriptMs)),
        jsBytes: samples[0].jsBytes, cssBytes: samples[0].cssBytes,
        apiRequests: samples[0].apiRequests, externalRequests: samples[0].externalRequests, samples,
      };
      results.push(result);
      await mkdir(resolve(output, ".."), { recursive: true });
      await writeFile(output, JSON.stringify({ label, complete: false, cpuThrottle: 4, network: "local, uncompressed", api: "offline fixtures", browser: browserVersion, results }, null, 2) + "\n");
      console.log(JSON.stringify({ ...result, samples: undefined }));
    }
  }
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify({ label, complete: true, cpuThrottle: 4, network: "local, uncompressed", api: "offline fixtures", browser: browserVersion, results }, null, 2) + "\n");
  console.log(`Saved ${output}`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
