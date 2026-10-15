/* scripts/dev-site.mjs — เว็บไซต์หน้าบ้านจำลองในเครื่อง (สเปก docs/WEBSITE-SPEC.md ข้อ 7) ไม่ต่อฐานจริง ไม่ต่อไลน์
   เพิ่ม 5 ต.ค. 69 (developer ตามโจทย์ Hermes): เรียก handler จริง api/site.js + supabase-js จริง แต่ชี้ SUPABASE_URL ไปที่
   "Supabase ปลอม" ในเครื่อง (PostgREST + Storage อย่างง่าย จากข้อมูลใน scripts/fixtures/site-fixtures.mjs) → ถ่ายจอด้วย Playwright ได้ทุก view

   ใช้: node scripts/dev-site.mjs [--mode=fixtures|empty|down|hang] [--port=4310] [--mourning]
     fixtures = มีข่าว/แบนเนอร์/บุคลากร/FAQ/เอกสาร/ลิงก์ตัวอย่าง · empty = ฐานว่าง (ตารางมีแต่ไม่มีแถว)
     down = ฐานตอบ error ทุกคำขอ · hang = รับสายแต่ไม่ตอบเลย (หน้าแรกต้องขึ้นภายใน ~4 วิ ด้วยข้อมูลสำรอง)
   ⛔ ใช้ในเครื่องเท่านั้น (อยู่ใน scripts/ ไม่ขึ้น deploy) */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtures, applyQuery, MEDIA_FILES } from "./fixtures/site-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const MODE = arg("mode", "fixtures");
const PORT = Number(arg("port", "4310"));
const FAKE_PORT = PORT + 1;

/* ═══ Supabase ปลอม: GET /rest/v1/<table> (ตัวกรองแบบ PostgREST ที่ _site-data.js ใช้) + /storage/v1/object/public/site-media/<path> ═══ */
const tables = MODE === "empty"
  ? { settings: [], site_banners: [], site_posts: [], site_pages: [], site_people: [], site_faqs: [], site_documents: [], site_links: [] }
  : makeFixtures(new Date(), { mourning: process.argv.includes("--mourning") });

function parseOps(sp) {
  const ops = { filters: [], order: [], offset: 0, limit: undefined };
  for (const [k, v] of sp) {
    if (k === "select") continue;
    if (k === "order") {
      for (const part of v.split(",")) {
        const [col, ...mods] = part.split(".");
        ops.order.push({ col, asc: !mods.includes("desc"), nullsFirst: mods.includes("nullsfirst") ? true : mods.includes("nullslast") ? false : undefined });
      }
    } else if (k === "limit") ops.limit = Number(v);
    else if (k === "offset") ops.offset = Number(v);
    else {
      const i = v.indexOf(".");
      const op = v.slice(0, i);
      let val = v.slice(i + 1);
      if (op === "in") val = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      ops.filters.push({ col: k, op, val });
    }
  }
  return ops;
}
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".webp": "image/webp", ".ico": "image/x-icon", ".xml": "application/xml" };
const statsDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const statEvents = new Map(), statVisitors = new Set();

const fake = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${FAKE_PORT}`);
  if (u.pathname.startsWith("/storage/v1/object/public/site-media/")) {
    const p = decodeURIComponent(u.pathname.slice("/storage/v1/object/public/site-media/".length));
    const file = MEDIA_FILES[p];
    if (!file) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    return fs.createReadStream(path.join(ROOT, "public", file)).pipe(res);
  }
  if (MODE === "hang") return; // รับสายแต่ไม่ตอบ (ห้ามปิด socket)
  if (MODE === "down") { res.writeHead(503, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ message: "fake: database down" })); }
  if (/^\/rest\/v1\/rpc\/(get_site_stats|record_site_view)$/.test(u.pathname)) {
    let input = "";
    req.on("data", (chunk) => { input += chunk; });
    req.on("end", () => {
      const body = JSON.parse(input || "{}");
      if (u.pathname.endsWith("/record_site_view")) {
        if (!statEvents.has(body.p_view_id)) statEvents.set(body.p_view_id, null);
        if (body.p_visitor_hash && !statEvents.get(body.p_view_id)) {
          statEvents.set(body.p_view_id, body.p_visitor_hash); statVisitors.add(body.p_visitor_hash);
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ today: statEvents.size, month: statEvents.size, total: statEvents.size,
        visitors_today: statVisitors.size, visitors_month: statVisitors.size, visitors_total: statVisitors.size, date: statsDay, since: statsDay }));
    });
    return;
  }
  const m = /^\/rest\/v1\/([a-z_]+)$/.exec(u.pathname);
  if (!m || !(m[1] in tables)) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ code: "42P01", message: "relation does not exist" })); }
  const ops = parseOps(u.searchParams);
  const { data, count } = applyQuery(tables[m[1]], ops);
  const headers = { "Content-Type": "application/json" };
  if (/count=exact/.test(req.headers.prefer || "")) headers["Content-Range"] = `${ops.offset}-${ops.offset + Math.max(data.length - 1, 0)}/${count}`;
  if (/vnd\.pgrst\.object/.test(req.headers.accept || "")) {
    if (data.length !== 1) { res.writeHead(406, headers); return res.end(JSON.stringify({ code: "PGRST116", message: "not one row" })); }
    res.writeHead(200, headers); return res.end(JSON.stringify(data[0]));
  }
  res.writeHead(200, headers);
  res.end(JSON.stringify(data));
});
await new Promise((r) => fake.listen(FAKE_PORT, "127.0.0.1", r));

/* env ต้องตั้งก่อน import handler (db()/mediaPublicUrl()/siteUrl() อ่าน env ตอนเรียก) */
process.env.SUPABASE_URL = `http://127.0.0.1:${FAKE_PORT}`;
process.env.SUPABASE_SERVICE_KEY = "dev-fake-service-key";
process.env.SITE_URL = `http://localhost:${PORT}`;
const { default: handler } = await import("../api/site.js");
const { default: statsHandler } = await import("../api/site-stats.js");

/* ═══ rewrites ตาม vercel.json (แหล่งเดียว — ไม่พิมพ์เส้นทางซ้ำ) ═══ */
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const rewrites = (vercel.rewrites || []).map((r) => {
  const names = [];
  const re = r.source.replace(/:([a-z]+)(\(([^)]+)\))?/gi, (_, name, __, pat) => { names.push(name); return `(${pat || "[^/]+"})`; });
  return { re: new RegExp(`^${re}$`), names, destination: r.destination };
});

function shimRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.send = (body) => { if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(body); return res; };
  res.redirect = (c, loc) => { res.statusCode = c; res.setHeader("Location", loc); res.end(); return res; };
  return res;
}

const redirects = vercel.redirects || []; // 5 ต.ค. 69: จำลอง redirects ของ vercel.json แบบ source ตรงตัว (ตอนนี้มีแค่ /index.html → /)
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname === "/api/site-stats") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 512) { res.writeHead(413); return res.end(); }
    }
    req.body = body;
    return statsHandler(req, shimRes(res));
  }
  const rd = redirects.find((r) => r.source === u.pathname);
  if (rd) { res.writeHead(rd.permanent ? 308 : 307, { Location: rd.destination }); return res.end(); }
  for (const r of rewrites) {
    const m = r.re.exec(u.pathname);
    if (!m) continue;
    let dest = r.destination;
    r.names.forEach((n, i) => { dest = dest.replace(`:${n}`, encodeURIComponent(m[i + 1])); });
    const du = new URL(dest, `http://localhost:${PORT}`);
    const query = Object.fromEntries(u.searchParams);
    for (const [k, v] of du.searchParams) query[k] = v;
    req.query = query;
    try { await handler(req, shimRes(res)); } catch (e) { console.error(e); res.statusCode = 500; res.end("dev error"); }
    return;
  }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
  const file = path.join(ROOT, "public", rel);
  if (file.startsWith(path.join(ROOT, "public")) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  fs.createReadStream(path.join(ROOT, "public", "404.html")).pipe(res);
});
server.listen(PORT, () => console.log(`dev-site (${MODE}) → http://localhost:${PORT}/  · Supabase ปลอม :${FAKE_PORT}`));
