/* scripts/dev-cms.mjs — หน้าจัดการเว็บไซต์ (CMS) จำลองในเครื่อง ไม่ต่อฐานจริง ไม่ต่อ Storage จริง (สเปก docs/WEBSITE-SPEC.md ข้อ 7)
   เพิ่ม 6 ต.ค. 69 (developer ตามโจทย์ Hermes — ทำหน้า CMS ให้เจ้าหน้าที่ใช้เองได้บนมือถือ)
   - เสิร์ฟ public/ + จำลอง /api/staff?action=me|cms-* ด้วยข้อมูลตัวอย่างในหน่วยความจำ (ขึ้นต้น "[ตัวอย่าง]" จาก scripts/fixtures/site-fixtures.mjs)
   - ตรวจข้อมูลด้วย "ฟังก์ชันจริง" จาก api/_cms.js (normalizeBanner…normalizeLinkItem · normalizeReorder · validateSiteConfigInput · buildMediaPath · checkMediaHead)
     → ข้อความ error ภาษาไทยที่เห็นในฮาร์เนส = ข้อความเดียวกับของจริง · ส่วน DB/RPC/Storage เป็นของจำลองอย่างง่าย
   - จำลอง signed upload ของ Supabase: PUT /storage/v1/object/upload/sign/site-media/<path>?token= (supabase-js ส่ง multipart) →
     เก็บไฟล์ในหน่วยความจำ แล้วเสิร์ฟคืนที่ /storage/v1/object/public/site-media/<path>
   - ตัวกรอง HTML จริง (_sanitize.js) ยอมรับรูปจาก https เท่านั้น → ฮาร์เนสสลับฐาน URL รูป http://localhost ↔ https://dev-cms.invalid
     เฉพาะตอนตรวจก่อนบันทึก (ของจริงฐาน URL เป็น https ของ Supabase อยู่แล้ว ไม่ต้องสลับ)

   ใช้: node scripts/dev-cms.mjs [--port=4320] [--as=admin|editor|denied|anon]
     admin = แอดมิน · editor = ผู้ดูแลเว็บ (can_edit_site) · denied = เจ้าหน้าที่ไม่มีสิทธิ์ · anon = ยังไม่เข้าสู่ระบบ (401)
   ⛔ ใช้ในเครื่องเท่านั้น (อยู่ใน scripts/ ไม่ขึ้น deploy) · ไม่มีการเขียนข้อมูลจริงที่ใด */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const PORT = Number(arg("port", "4320"));
const AS = arg("as", "admin");
const ORIGIN = `http://localhost:${PORT}`;
const LOCAL_BASE = `${ORIGIN}/storage/v1/object/public/site-media/`;
const HTTPS_BASE = "https://dev-cms.invalid/storage/v1/object/public/site-media/";

// env ต้องตั้งก่อน import โมดูลที่อ่าน env ตอนเรียก (mediaPublicBase/siteUrl/sanitize)
process.env.SUPABASE_URL = "https://dev-cms.invalid";
process.env.SITE_URL = ORIGIN;
const cms = await import("../api/_cms.js");
const shared = await import("../api/_site-shared.js");
const { makeFixtures, MEDIA_FILES } = await import("./fixtures/site-fixtures.mjs");

const T = makeFixtures(new Date());
const TABLE = { banners: "site_banners", posts: "site_posts", pages: "site_pages", people: "site_people", faqs: "site_faqs", docs: "site_documents", links: "site_links" };
const audit = [
  { id: 2, staff_id: 1, action: "update", item_type: "posts", item_id: "1", summary: "[ตัวอย่าง] แก้ไขข่าว/บทความ \"ข่าวตัวอย่าง\"", at: new Date(Date.now() - 3600e3).toISOString() },
  { id: 1, staff_id: 1, action: "create", item_type: "banners", item_id: "1", summary: "[ตัวอย่าง] สร้างแบนเนอร์ \"แบนเนอร์ที่ 1\"", at: new Date(Date.now() - 86400e3).toISOString() },
];
const STAFF = { id: 1, display_name: "[ตัวอย่าง] ผู้ดูแลเว็บไซต์" };
const files = new Map(); // path → { buf, type }
const tokens = new Map(); // token → path
const nowIso = () => new Date().toISOString();
const clone = (x) => JSON.parse(JSON.stringify(x));
const ok = (body) => ({ status: 200, body: { ok: true, ...body } });
const fail = (status, error, extra) => ({ status, body: { ok: false, error, ...(extra || {}) } });

function who() {
  return { ok: true, staffId: STAFF.id, role: AS === "admin" ? "admin" : "staff", displayName: STAFF.display_name };
}
function addAudit(action, type, id, summary) {
  audit.unshift({ id: (audit[0]?.id || 0) + 1, staff_id: STAFF.id, action, item_type: type, item_id: id == null ? null : String(id), summary, at: nowIso() });
}
const toHttps = (s) => (typeof s === "string" ? s.split(LOCAL_BASE).join(HTTPS_BASE) : s);
const toLocal = (s) => (typeof s === "string" ? s.split(HTTPS_BASE).join(LOCAL_BASE) : s);
function decorate(type, r) {
  if (type === "posts") return { ...r, state: cms.postState(r), path: shared.postPath(r) };
  if (type === "banners") return { ...r, state: cms.bannerState(r) };
  if (type === "pages") return { ...r, isSystem: shared.SYSTEM_PAGE_SLUGS.includes(r.slug), isDefault: false };
  return r;
}
function defaultPage(slug) {
  const d = shared.DEFAULT_PAGES[slug];
  return d ? { ...clone(d), updated_at: null, isSystem: true, isDefault: true } : null;
}
function headOf(p) {
  if (files.has(p)) { const f = files.get(p); return { head: [...f.buf.subarray(0, 16)], size: f.buf.length }; }
  if (MEDIA_FILES[p]) { const b = fs.readFileSync(path.join(ROOT, "public", MEDIA_FILES[p])); return { head: [...b.subarray(0, 16)], size: b.length }; }
  return null;
}
function verifyNew(type, row, old) {
  const before = new Set(old ? cms.mediaPathsOf(type, old) : []);
  const sizes = {};
  for (const p of cms.mediaPathsOf(type, row).filter((x) => !before.has(x))) {
    const h = headOf(p);
    if (!h) return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลดไว้ (HTTP 404) กรุณาอัปโหลดใหม่" };
    const r = cms.checkMediaHead(p, h.head, h.size);
    if (!r.ok) return r;
    sizes[p] = r.size;
  }
  return { ok: true, sizes };
}
const sortRows = (rows) => rows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id ?? a.slug).localeCompare(String(b.id ?? b.slug), "en", { numeric: true }));

async function action(name, method, q, body) {
  const b = body || {};
  const type = String((method === "GET" ? q.get("type") : b.type) || "");
  const rows = TABLE[type] ? T[TABLE[type]] : null;
  const needType = () => (rows ? null : fail(400, "ไม่รู้จักชนิดเนื้อหานี้"));

  if (name === "cms-meta") return ok({ ...cms.cmsMeta(who()), mediaBase: LOCAL_BASE, siteUrl: ORIGIN, tablesReady: true });

  if (name === "cms-overview") {
    const now = Date.now();
    const postCounts = Object.fromEntries(shared.POST_CATEGORIES.map((c) => [c.key, { total: 0, published: 0, draft: 0, scheduled: 0 }]));
    for (const p of T.site_posts) { const c = postCounts[p.category]; if (c) { c.total++; c[cms.postState(p, now)]++; } }
    const cnt = (list, f) => list.filter(f).length;
    const slugs = new Set(T.site_pages.map((p) => p.slug));
    const missing = shared.SYSTEM_PAGE_SLUGS.filter((s) => !slugs.has(s));
    return ok({
      counts: {
        banners: { total: T.site_banners.length, showing: cnt(T.site_banners, (x) => cms.bannerState(x, now) === "showing") },
        posts: postCounts,
        pages: { total: T.site_pages.length + missing.length, unpublished: cnt(T.site_pages, (p) => !p.published) + missing.filter((s) => !shared.DEFAULT_PAGES[s].published).length },
        people: Object.fromEntries(shared.PEOPLE_GROUPS.map((g) => [g.key, { total: cnt(T.site_people, (x) => x.group_key === g.key), active: cnt(T.site_people, (x) => x.group_key === g.key && x.active) }])),
        faqs: { total: T.site_faqs.length, active: cnt(T.site_faqs, (x) => x.active) },
        docs: { total: T.site_documents.length, active: cnt(T.site_documents, (x) => x.active) },
        links: Object.fromEntries(shared.LINK_KINDS.map((k) => [k.key, { total: cnt(T.site_links, (x) => x.kind === k.key), active: cnt(T.site_links, (x) => x.kind === k.key && x.active) }])),
      },
      recentPosts: T.site_posts.slice().sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).slice(0, 5).map((p) => decorate("posts", p)),
      audit: audit.slice(0, 10).map((a) => ({ ...a, staff_name: STAFF.display_name })),
    });
  }

  if (name === "cms-list") {
    const e = needType(); if (e) return e;
    if (type === "posts") {
      const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 30));
      const offset = Math.max(0, Number(q.get("offset")) || 0);
      const cats = String(q.get("category") || "").split(",").filter(Boolean);
      const st = q.get("status");
      const qq = String(q.get("q") || "").trim().toLowerCase();
      let list = rows.map((p) => decorate("posts", p)).filter((p) => (!cats.length || cats.includes(p.category)) && (!st || p.state === st) && (!qq || p.title.toLowerCase().includes(qq)));
      list.sort((a, b) => (a.published_at == null) !== (b.published_at == null) ? (a.published_at == null ? -1 : 1) : String(b.published_at || "").localeCompare(String(a.published_at || "")) || b.id - a.id); // ตามของจริง: published_at desc nulls first, id desc
      const total = list.length;
      list = list.slice(offset, offset + limit).map(({ body_html, gallery, attachments, ...rest }) => rest);
      return ok({ items: list, total, limit, offset });
    }
    if (type === "pages") {
      const list = rows.map((r) => { const { body_html, ...rest } = decorate("pages", r); return rest; });
      for (const s of shared.SYSTEM_PAGE_SLUGS) if (!list.some((r) => r.slug === s)) { const d = defaultPage(s); delete d.body_html; list.push(d); }
      return ok({ items: sortRows(list) });
    }
    return ok({ items: sortRows(rows).map((r) => decorate(type, r)) });
  }

  if (name === "cms-get") {
    const e = needType(); if (e) return e;
    const id = q.get("id");
    if (type === "pages") {
      const r = rows.find((x) => x.slug === id);
      return r ? ok({ item: decorate("pages", clone(r)) }) : defaultPage(id) ? ok({ item: defaultPage(id) }) : fail(404, "ไม่พบหน้านี้");
    }
    const r = rows.find((x) => String(x.id) === String(id));
    return r ? ok({ item: decorate(type, clone(r)) }) : fail(404, "ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)");
  }

  if (name === "cms-save") {
    const e = needType(); if (e) return e;
    const it = clone(b.item || {});
    for (const k of ["body_html", "answer_html"]) if (k in it) it[k] = toHttps(it[k]);
    const norm = cms.NORMALIZERS[type](it);
    if (!norm.ok) return fail(400, norm.error, { field: norm.field });
    const row = norm.row;
    if (type === "pages") {
      const slugErr = cms.pageSlugChangeError({ isNew: it.isNew === true, slug: row.slug, originalSlug: it.originalSlug });
      if (slugErr) return fail(400, slugErr, { field: "slug" });
      const isSystem = shared.SYSTEM_PAGE_SLUGS.includes(row.slug);
      const old = rows.find((x) => x.slug === row.slug);
      if (it.isNew === true && (old || isSystem)) return fail(409, `มีหน้าที่ใช้ชื่อลิงก์ "${row.slug}" อยู่แล้ว กรุณาใช้ชื่ออื่น`, { field: "slug" });
      const v = verifyNew(type, row, old ? { ...old, body_html: toHttps(old.body_html) } : null);
      if (!v.ok) return fail(400, v.error, { field: "body_html" });
      row.body_html = toLocal(row.body_html);
      const saved = Object.assign(old || { sort_order: isSystem ? shared.DEFAULT_PAGES[row.slug].sort_order : (Math.max(0, ...rows.map((x) => x.sort_order || 0)) + 10) }, row, { updated_at: nowIso() });
      if (!old) rows.push(saved);
      addAudit(old ? "update" : "create", type, row.slug, `${old ? "แก้ไข" : "สร้าง"}หน้า "${row.title}"`);
      return ok({ item: decorate("pages", clone(saved)), created: !old });
    }
    const id = it.id != null && it.id !== "" ? cms.parseId(it.id) : null;
    const old = id ? rows.find((x) => x.id === id) : null;
    if (id && !old) return fail(404, "ไม่พบรายการนี้ (อาจถูกลบไปแล้ว) — คัดลอกข้อความเก็บไว้ก่อน แล้วสร้างใหม่");
    if (type === "docs" && !row.published_at) { if (old) delete row.published_at; else row.published_at = nowIso(); }
    const oldHttps = old ? { ...old, body_html: toHttps(old.body_html), answer_html: toHttps(old.answer_html) } : null;
    const v = verifyNew(type, row, oldHttps);
    if (!v.ok) return fail(400, v.error);
    if (type === "docs" && v.sizes[row.file_path] != null) row.file_size = v.sizes[row.file_path];
    if (type === "posts") row.attachments = row.attachments.map((a) => (v.sizes[a.path] != null ? { ...a, size: v.sizes[a.path] } : a));
    for (const k of ["body_html", "answer_html"]) if (k in row) row[k] = toLocal(row[k]);
    const auditAction = !old ? "create" : type === "posts" && old.status !== row.status ? (row.status === "published" ? "publish" : "unpublish") : "update";
    let saved;
    if (old) saved = Object.assign(old, row, { updated_at: nowIso() });
    else {
      saved = { id: Math.max(0, ...rows.map((x) => x.id)) + 1, ...row, created_at: nowIso(), updated_at: nowIso() };
      if (cms.CMS_TYPES[type].sortable) saved.sort_order = Math.max(0, ...rows.map((x) => x.sort_order || 0)) + 10;
      rows.push(saved);
    }
    addAudit(auditAction, type, saved.id, `${ { create: "สร้าง", publish: "เผยแพร่", unpublish: "เปลี่ยนเป็นร่าง", update: "แก้ไข" }[auditAction]}${cms.CMS_TYPES[type].label} "${cms.titleOf(type, saved)}"`);
    return ok({ item: decorate(type, clone(saved)), created: !old });
  }

  if (name === "cms-delete") {
    const e = needType(); if (e) return e;
    const key = type === "pages" ? String(b.id ?? "") : cms.parseId(b.id);
    const i = rows.findIndex((x) => (type === "pages" ? x.slug === key : x.id === key));
    const isSystem = type === "pages" && shared.SYSTEM_PAGE_SLUGS.includes(key);
    if (i < 0) return isSystem ? ok({ reset: true, already: true }) : fail(404, "ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)");
    const [old] = rows.splice(i, 1);
    addAudit(isSystem ? "reset" : "delete", type, key, `${isSystem ? "คืนค่าเริ่มต้นของ" : "ลบ"}${cms.CMS_TYPES[type].label} "${cms.titleOf(type, old)}"`);
    return ok({ reset: isSystem, files: { removed: 0, kept: 0 } });
  }

  if (name === "cms-reorder") {
    const e = needType(); if (e) return e;
    const r = cms.normalizeReorder(type, b.ids);
    if (!r.ok) return fail(400, r.error);
    for (const o of r.orders) {
      let row = rows.find((x) => (type === "pages" ? x.slug === o.key : x.id === o.key));
      if (!row && type === "pages" && shared.DEFAULT_PAGES[o.key]) { row = { ...clone(shared.DEFAULT_PAGES[o.key]), updated_at: nowIso() }; rows.push(row); }
      if (row) row.sort_order = o.sort_order;
    }
    addAudit("reorder", type, null, `จัดลำดับ${cms.CMS_TYPES[type].label} ${r.orders.length} รายการ`);
    return ok({ updated: r.orders.length });
  }

  if (name === "cms-config") {
    const row = T.settings.find((s) => s.key === shared.SITE_CONFIG_KEY);
    return ok({ config: shared.mergeSiteConfig(row?.value), saved: !!row, defaults: shared.SITE_CONFIG_DEFAULTS });
  }
  if (name === "cms-config-save") {
    const v = cms.validateSiteConfigInput(b.config);
    if (!v.ok) return fail(400, v.error, { field: v.field });
    const row = T.settings.find((s) => s.key === shared.SITE_CONFIG_KEY);
    if (row) row.value = v.config; else T.settings.push({ key: shared.SITE_CONFIG_KEY, value: v.config });
    audit.unshift({ id: (audit[0]?.id || 0) + 1, staff_id: STAFF.id, action: "config", item_type: "settings", item_id: "site_config", summary: "แก้ไขตั้งค่าเว็บไซต์", at: nowIso() });
    return ok({ config: v.config });
  }

  if (name === "cms-upload-url") {
    const p = cms.buildMediaPath(String(b.kind || ""), b.contentType, b.variant || "main");
    if (!p.ok) return fail(400, p.error);
    const token = crypto.randomBytes(12).toString("hex");
    tokens.set(token, p.path);
    return ok({ path: p.path, token, publicUrl: LOCAL_BASE + p.path });
  }

  if (name === "cms-audit") return ok({ items: audit.slice(0, Number(q.get("limit")) || 100).map((a) => ({ ...a, staff_name: STAFF.display_name })) });

  return fail(400, "ไม่รู้จัก action นี้");
}

/* multipart ของ supabase-js (FormData: cacheControl + ไฟล์ชื่อ "") → ไบต์ของไฟล์ */
function parseUpload(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!m) return { buf, type: contentType };
  const boundary = Buffer.from("--" + (m[1] || m[2]));
  let pos = buf.indexOf(boundary);
  while (pos >= 0) {
    const next = buf.indexOf(boundary, pos + boundary.length);
    if (next < 0) break;
    const part = buf.subarray(pos + boundary.length + 2, next - 2);
    const sep = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, sep).toString("utf8");
    if (/filename=/i.test(head) || /content-type:/i.test(head)) {
      const type = (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1] || "application/octet-stream";
      return { buf: part.subarray(sep + 4), type };
    }
    pos = next;
  }
  return null;
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".json": "application/json" };
const json = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, ORIGIN);
  try {
    if (u.pathname === "/api/staff") {
      const name = u.searchParams.get("action");
      if (AS === "anon") return json(res, 401, { ok: false, error: "กรุณาเข้าสู่ระบบ" });
      if (name === "me") return json(res, 200, { ok: true, staffId: STAFF.id, role: AS === "admin" ? "admin" : "staff", displayName: STAFF.display_name, canEditSite: AS !== "denied" });
      if (!String(name).startsWith("cms-")) return json(res, 400, { ok: false, error: "ฮาร์เนสจำลองเฉพาะ me และ cms-*" });
      if (AS === "denied") return json(res, 403, cms.NEED_SITE_EDITOR);
      const raw = req.method === "POST" ? await readBody(req) : null;
      let body = null;
      if (raw) { try { body = JSON.parse(raw.toString("utf8") || "{}"); } catch { return json(res, 400, { ok: false, error: "รูปแบบข้อมูลไม่ถูกต้อง" }); } }
      const r = await action(name, req.method, u.searchParams, body);
      return json(res, r.status, r.body);
    }
    if (u.pathname === "/api/form" && u.searchParams.get("action") === "config") {
      return json(res, 200, { ok: true, supabaseUrl: ORIGIN, supabaseAnonKey: "dev-anon-key-not-secret" });
    }
    if (u.pathname === "/api/staff-auth") return json(res, 200, { ok: true });
    const up = /^\/storage\/v1\/object\/upload\/sign\/site-media\/(.+)$/.exec(u.pathname);
    if (up && (req.method === "PUT" || req.method === "POST")) {
      const p = decodeURIComponent(up[1]);
      if (tokens.get(u.searchParams.get("token")) !== p) return json(res, 400, { statusCode: "403", error: "Unauthorized", message: "invalid signature" });
      const file = parseUpload(await readBody(req), req.headers["content-type"]);
      if (!file || !file.buf.length) return json(res, 400, { statusCode: "400", error: "Bad Request", message: "empty file" });
      files.set(p, file);
      tokens.delete(u.searchParams.get("token"));
      return json(res, 200, { Key: `site-media/${p}`, Id: crypto.randomUUID() });
    }
    const pub = /^\/storage\/v1\/object\/public\/site-media\/(.+)$/.exec(u.pathname);
    if (pub) {
      const p = decodeURIComponent(pub[1]);
      if (files.has(p)) { const f = files.get(p); res.writeHead(200, { "Content-Type": f.type, "Content-Length": f.buf.length }); return res.end(f.buf); }
      if (MEDIA_FILES[p]) { res.writeHead(200, { "Content-Type": MIME[path.extname(MEDIA_FILES[p])] || "application/octet-stream" }); return fs.createReadStream(path.join(ROOT, "public", MEDIA_FILES[p])).pipe(res); }
      res.writeHead(404); return res.end();
    }
    if (u.pathname === "/" || /^\/(news|knowledge)\/\d+$/.test(u.pathname) || u.pathname === "/about" || u.pathname.startsWith("/page/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><meta charset="utf-8"><title>[ตัวอย่าง] หน้าเว็บ</title><p>[ตัวอย่าง] ฮาร์เนส CMS ไม่ได้เรนเดอร์หน้าเว็บจริง — ใช้ node scripts/dev-site.mjs ดูหน้าเว็บ (${u.pathname}${u.search})</p>`);
    }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    const file = path.join(ROOT, "public", rel);
    if (file.startsWith(path.join(ROOT, "public") + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404");
  } catch (e) {
    console.error(e);
    json(res, 500, { ok: false, error: "dev error: " + e.message });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`dev-cms (${AS}) → ${ORIGIN}/cms.html`));
