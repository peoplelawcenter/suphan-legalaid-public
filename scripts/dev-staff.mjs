/* scripts/dev-staff.mjs — หลังบ้านเจ้าหน้าที่ (public/staff.html) จำลองในเครื่อง ไม่ต่อฐานจริง ไม่ส่ง LINE/อีเมลจริง
   เพิ่ม 7 ต.ค. 69 (ตอนทำหน้า "ตั้งค่า" เมนูซ้าย + รูปโปรไฟล์ + หน้า QR) เพื่อกดลองจริงในเบราว์เซอร์ + ตรวจ api/staff.js "ตัวจริง" ทั้งเส้นทาง
   - เสิร์ฟ public/ + รันตัวจัดการ api/staff.js จริง (session cookie จริง, whoFromSession จริง, _avatar.js จริง) บน "ฐานจำลอง" ในหน่วยความจำ:
     ตัวจำลอง PostgREST อย่างง่ายรองรับเฉพาะ query ที่หลังบ้านใช้กับตาราง staff / settings / staff_link_codes (ตารางอื่น = ว่างเปล่า)
   - action ที่เกี่ยวกับ "เรื่อง" (stats/list/dashboard/case) ตอบข้อมูลตัวอย่างที่ฮาร์เนสเอง — ไม่ใช่ส่วนที่ทดสอบ
   - GET /staff.html จะตั้งคุกกี้เซสชันให้อัตโนมัติ (ตาม --as) เพราะหน้าจริงต้องล็อกอินก่อน

   ใช้: node scripts/dev-staff.mjs [--port=4330] [--as=admin|staff] [--no-avatar-col]
     admin = แอดมิน (id 1) · staff = เจ้าหน้าที่ทั่วไป (id 2) · --no-avatar-col = จำลอง "ยังไม่รัน migration-16" (คอลัมน์ avatar_data ไม่มีในฐาน)
   ⛔ ใช้ในเครื่องเท่านั้น (อยู่ใน scripts/ — .vercelignore กันไม่ให้ขึ้น deploy) · ไม่มีการเขียนข้อมูลจริงที่ใด */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const PORT = Number(arg("port", "4330"));
const AS = arg("as", "admin");
const NO_AVATAR_COL = process.argv.includes("--no-avatar-col");
const ORIGIN = `http://localhost:${PORT}`;

// env ต้องตั้งก่อน import โมดูลที่อ่าน env (api/_db.js สร้าง client ครั้งแรกตอนเรียกใช้)
process.env.SUPABASE_URL = `${ORIGIN}/fake-supabase`;
process.env.SUPABASE_SERVICE_KEY = "dev-service-key";
process.env.STAFF_SECRET = "dev-staff-secret-local-only";
process.env.SITE_URL = ORIGIN;
const { default: staffHandler } = await import("../api/staff.js");
const { makeSessionToken, COOKIE_NAME } = await import("../api/_staffauth.js");

// ───────── ฐานจำลอง ─────────
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const DB = {
  staff: [
    { id: 1, display_name: "สมชาย ใจดี", role: "admin", active: true, email: "somchai@example.invalid", email_verified_at: iso(9e9), approved_at: iso(9e9), position: "นิติกร", phone: "081-111-1111", line_uid: null, google_sub: null, facebook_id: null, notify_line: true, notify_email: true, notify_categories: null, can_edit_site: true, added_at: iso(9e9), avatar_data: null, password_hash: "x", otp_hash: "secret-hash" },
    { id: 2, display_name: "เสน่ห์ ทดสอบ", role: "staff", active: true, email: "sane@example.invalid", email_verified_at: iso(8e9), approved_at: iso(8e9), position: null, phone: null, line_uid: "Uxxxxxxxx", google_sub: "g-1", facebook_id: null, notify_line: true, notify_email: false, notify_categories: ["debt", "land"], can_edit_site: false, added_at: iso(8e9), avatar_data: null, password_hash: "x", otp_hash: null },
    { id: 3, display_name: "มานี ตัวอย่าง", role: "staff", active: false, email: "manee@example.invalid", email_verified_at: iso(3600e3), approved_at: null, position: null, phone: null, line_uid: null, google_sub: null, facebook_id: null, notify_line: true, notify_email: true, notify_categories: null, can_edit_site: false, added_at: iso(3600e3), avatar_data: null, password_hash: "x", otp_hash: null },
  ],
  settings: [
    { key: "office_hours", value: { days: "จันทร์–ศุกร์", start: "08:30", end: "16:30" } },
    { key: "phone", value: "035-431-751" },
    { key: "responder_label", value: "เจ้าหน้าที่" },
    { key: "appointment_enabled", value: true },
  ],
  staff_link_codes: [],
};
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const matches = (row, [k, v]) => {
  if (RESERVED.has(k)) return true;
  const val = row[k];
  if (v === "is.null") return val == null;
  if (v === "not.is.null") return val != null;
  if (v.startsWith("eq.")) return String(val) === v.slice(3);
  if (v.startsWith("in.(")) return v.slice(4, -1).split(",").includes(String(val));
  return true;
};
const pgError = (code, message) => ({ status: 400, body: { code, message, details: null, hint: null } });
const colsOf = (select, row) => (select === "*" || !select ? Object.keys(row) : select.split(","));
function fakeRest(method, table, url, body, accept) {
  const sp = url.searchParams, rows = DB[table] || [];
  const select = sp.get("select");
  const touchesAvatar = (s) => s && s !== "*" && s.split(",").includes("avatar_data");
  if (NO_AVATAR_COL && table === "staff") {
    if (touchesAvatar(select)) return pgError("42703", 'column staff.avatar_data does not exist');
    if (body && (Array.isArray(body) ? body : [body]).some((b) => "avatar_data" in b)) return pgError("PGRST204", "Could not find the 'avatar_data' column of 'staff' in the schema cache");
  }
  const view = (r) => {
    const copy = { ...r };
    if (NO_AVATAR_COL) delete copy.avatar_data;
    return Object.fromEntries(colsOf(select, copy).map((c) => [c, copy[c]]));
  };
  const filtered = rows.filter((r) => [...sp.entries()].every((e) => matches(r, e)));
  if (method === "GET") {
    const out = filtered.map(view);
    if (accept.includes("vnd.pgrst.object+json")) return out.length === 1 ? { status: 200, body: out[0] } : { status: 406, body: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    return { status: 200, body: out };
  }
  if (method === "PATCH") {
    for (const r of filtered) Object.assign(r, body);
    return { status: 200, body: filtered.map(view) };
  }
  if (method === "POST") {
    const items = Array.isArray(body) ? body : [body];
    for (const it of items) {
      const existing = table === "settings" ? rows.find((r) => r.key === it.key) : null;
      if (existing) Object.assign(existing, it); else (DB[table] = DB[table] || []).push({ id: (rows.length || 0) + 1, ...it });
    }
    return { status: 201, body: items };
  }
  if (method === "DELETE") { DB[table] = rows.filter((r) => !filtered.includes(r)); return { status: 204, body: null }; }
  return { status: 405, body: { message: "method not supported by fake" } };
}

// ───────── ข้อมูลเรื่องตัวอย่าง (ส่วนนี้ฮาร์เนสตอบเอง) ─────────
const CASES = [
  { id: 1, case_no: "LA-690001", case_type: "consult", category: "debt", status: "new", detail: "[ตัวอย่าง] ปรึกษาเรื่องหนี้สิน", citizen_name: "ผู้ใช้ตัวอย่าง", citizen_phone: "081-000-0001", citizen_line_uid: "Utest", created_at: iso(5 * 86400e3), updated_at: iso(5 * 86400e3), assigned_staff_id: null, evidence_paths: [], assignee_name: null },
  { id: 2, case_no: "LA-690002", case_type: "appointment", category: "land", status: "assigned", detail: "[ตัวอย่าง] จองคิวปรึกษาเรื่องที่ดิน", citizen_name: "ผู้ใช้ตัวอย่าง 2", citizen_phone: "081-000-0002", citizen_line_uid: null, created_at: iso(86400e3), updated_at: iso(86400e3), assigned_staff_id: 2, evidence_paths: [], assignee_name: "เสน่ห์ ทดสอบ", preferred_date: "2026-10-12", preferred_time: "10:00" },
];
const HARNESS_ACTIONS = {
  stats: () => ({ ok: true, role: AS === "admin" ? "admin" : "staff", counts: { new: 1, assigned: 1 } }),
  list: () => ({ ok: true, rows: CASES, total: CASES.length }),
  dashboard: () => ({ ok: true, total: 2, byCategory: { debt: 1, land: 1 }, trendDaily: [], trendWeekly: [], quota: null }),
};

// ───────── เซิร์ฟเวอร์ ─────────
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  try {
    if (url.pathname.startsWith("/fake-supabase/rest/v1/")) {
      const table = url.pathname.split("/").pop();
      const raw = await readBody(req);
      const r = fakeRest(req.method, table, url, raw.length ? JSON.parse(raw.toString("utf8")) : null, String(req.headers.accept || ""));
      res.writeHead(r.status, { "Content-Type": "application/json" });
      return res.end(r.body === null ? "" : JSON.stringify(r.body));
    }
    if (url.pathname === "/api/form" && url.searchParams.get("action") === "config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ supabaseUrl: "https://dev.invalid", supabaseAnonKey: "dev-anon-key" }));
    }
    if (url.pathname === "/api/staff") {
      const action = url.searchParams.get("action");
      if (HARNESS_ACTIONS[action]) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(HARNESS_ACTIONS[action]())); }
      req.query = Object.fromEntries(url.searchParams);
      res.status = (c) => { res.statusCode = c; return res; };
      res.send = (b) => res.end(b);
      return await staffHandler(req, res);
    }
    if (url.pathname === "/api/staff-auth") {   // ปุ่มออกจากระบบ/เชื่อมบัญชี — ไม่ใช่ส่วนที่ทดสอบ
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
    // ไฟล์นิ่งจาก public/
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/staff.html";
    const file = path.join(ROOT, "public", rel);
    if (!file.startsWith(path.join(ROOT, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    const headers = { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" };
    if (rel === "/staff.html") headers["Set-Cookie"] = `${COOKIE_NAME}=${encodeURIComponent(makeSessionToken(AS === "admin" ? 1 : 2))}; Path=/; HttpOnly; SameSite=Lax`;
    res.writeHead(200, headers);
    res.end(fs.readFileSync(file));
  } catch (e) {
    console.error("dev-staff error", e);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(e && e.message || e));
  }
}).listen(PORT, () => console.log(`dev-staff: ${ORIGIN}/staff.html  (as=${AS}${NO_AVATAR_COL ? ", ไม่มีคอลัมน์ avatar_data" : ""})`));
