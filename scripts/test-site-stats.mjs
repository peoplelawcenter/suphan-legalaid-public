/* Offline: real API guards/normalization with synthetic RPC; no real DB. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStatsHandler } from "../api/site-stats.js";
import { visitorHash, isPublicStatsPath, normalizeStats, loadStats } from "../api/_site-stats.js";
import { renderNotFound, renderUnavailable, fallbackChrome } from "../api/_site-render.js";
const sample = { today: 3, month: 30, total: 100, visitors_today: 2, visitors_month: 15, visitors_total: 60, date: "2026-10-07", since: "2026-10-01" };
let calls = [];
const handler = createStatsHandler(async (...args) => { calls.push(args); return sample; });
const request = (extra = {}) => ({ method: "POST", headers: { host: "example.test", origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json", "user-agent": "Mozilla/5.0" }, body: { path: "/", viewId: randomUUID(), visitorId: null }, ...extra });
async function run(req, fn = handler) {
  const res = { headers: {}, statusCode: 200, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, send(v) { this.body = JSON.parse(v); return this; }, end() { return this; } };
  await fn(req, res); return res;
}
for (const path of ["/", "/news", "/knowledge/123", "/page/cookies", "/contact", "/about"]) assert.equal(isPublicStatsPath(path), true);
for (const path of ["/staff.html", "/appointment.html", "/api/site", "/news/0", "/news/01", "/news/3?q=case", "/page/x", "/sitemap.xml", null]) assert.equal(isPublicStatsPath(path), false);
const visitorId = randomUUID(), hash = visitorHash(visitorId);
assert.match(hash, /^[a-f0-9]{64}$/); assert.notEqual(hash, visitorId); assert.equal(visitorHash(visitorId.toUpperCase()), hash); assert.equal(visitorHash(null), null);
for (const bad of ["staff-id", "a".repeat(1000), 123, {}, "00000000-0000-0000-0000-000000000000"]) assert.throws(() => visitorHash(bad));
assert.deepEqual(normalizeStats([sample]), sample);
assert.equal(normalizeStats({ ...sample, today: "3" }).today, 3);
for (const bad of [null, {}, { ...sample, today: -1 }, { ...sample, today: 31 }, { ...sample, total: "9007199254740993" }, { ...sample, today: null }, { ...sample, since: "2026-02-30" }, { ...sample, visitors_total: 101 }]) assert.throws(() => normalizeStats(bad));
let r = await run(request({ body: { path: "/news/1", viewId: randomUUID(), visitorId } }));
assert.equal(r.statusCode, 200); assert.equal(r.headers["Cache-Control"], "no-store"); assert.equal(calls.at(-1)[1], hash); assert.equal(r.body.stats.total, 100);
assert.equal(JSON.stringify(r.body).includes(visitorId), false); assert.equal(JSON.stringify(r.body).includes(hash), false);
const before = calls.length;
for (const [patch, code] of [
  [{ method: "DELETE" }, 405],
  [{ headers: { ...request().headers, origin: "https://attacker.test" } }, 403],
  [{ headers: { ...request().headers, "sec-fetch-site": "cross-site" } }, 403],
  [{ headers: { ...request().headers, origin: undefined } }, 403],
  [{ headers: { ...request().headers, "content-type": "text/plain" } }, 415],
  [{ body: "{" }, 400], [{ body: "x".repeat(257) }, 413],
  [{ body: { path: "/staff.html", viewId: randomUUID() } }, 400],
  [{ body: { path: "/", viewId: randomUUID(), visitorId: "invalid" } }, 400],
  [{ body: { path: "/", viewId: randomUUID(), caseNo: "private" } }, 400],
  [{ body: { path: "/" } }, 400],
  [{ headers: { ...request().headers, "user-agent": "Googlebot" } }, 204],
  [{ headers: { ...request().headers, "sec-purpose": "prefetch" } }, 204],
]) { r = await run(request(patch)); assert.equal(r.statusCode, code); }
assert.equal(calls.length, before, "rejected/bot requests never touch DB");
r = await run(request({ method: "GET", headers: {}, body: null }));
assert.equal(r.statusCode, 200); assert.equal(calls.at(-1)[0], false); assert.match(r.headers["Cache-Control"], /s-maxage=30/);
r = await run(request({ method: "HEAD", headers: {} })); assert.equal(r.statusCode, 200); assert.equal(r.body, null);
r = await run(request(), createStatsHandler(async () => { throw new Error("sensitive db error"); }));
assert.equal(r.statusCode, 503); assert.equal(r.headers["Cache-Control"], "no-store"); assert.equal(JSON.stringify(r.body).includes("sensitive"), false);
let rpc;
const client = () => ({ rpc(name, args) { rpc = { name, args }; return { abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return Promise.resolve({ data: sample, error: null }); } }; } });
const viewId = randomUUID();
assert.deepEqual(await loadStats(true, hash, viewId, client), sample); assert.deepEqual(rpc, { name: "record_site_view", args: { p_view_id: viewId, p_visitor_hash: hash } });
await loadStats(false, null, null, client); assert.deepEqual(rpc, { name: "get_site_stats", args: {} });
const ctx = { now: new Date(), preview: false, path: "/missing" }, model = { chrome: fallbackChrome() };
assert.match(renderNotFound(model, ctx).toString(), /data-track="false"/);
assert.match(renderUnavailable(model, ctx).toString(), /data-track="false"/);
console.log("✅ test-site-stats: API guards, privacy, failure handling, RPC contract and error-page exclusions passed");
