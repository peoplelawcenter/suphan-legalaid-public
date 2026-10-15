/* scripts/test-staff-ui.mjs — โครงหน้า "ตั้งค่า" ของหลังบ้านเจ้าหน้าที่ (public/staff.html + public/staff-settings.js · ใหม่ 7 ต.ค. 69)
   ตรวจแบบสแตติก (ไม่เปิดเบราว์เซอร์) ว่า 2 ไฟล์ "ต่อกันสนิท": ทุก id ที่สคริปต์เรียกมีอยู่จริงในหน้า · หัวข้อเมนู=หัวข้อใน TOPICS=แผงเนื้อหา ·
   ลำดับโหลดสคริปต์ถูก · ลิงก์เด้งกลับ OAuth/ส่งประกาศชี้หัวข้อใหม่ · เมนูผู้ใช้/รูปโปรไฟล์/QR ครบ
   (เหตุผล: staff-settings.js หา element ด้วย $("id") — id ตกหล่นแล้ว null.textContent ทำทั้งหน้าตั้งค่าพังเงียบๆ ตอนรันจริง ·
   การกดใช้งานจริงตรวจด้วย scripts/dev-staff.mjs + เบราว์เซอร์ ไม่อยู่ในชุดนี้) */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");   // เครื่องที่ git แปลงเป็น CRLF (Windows autocrlf) ต้องผ่านเหมือนกัน
const html = read("public/staff.html");
const js = read("public/staff-settings.js");
const css = read("public/staff.css");

let checked = 0;
function ok(cond, msg) { assert.ok(cond, msg); checked++; }

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

// ── 1) ทุก $("id") ที่เขียนตรงๆ ใน staff-settings.js ต้องมีในหน้า (ยกเว้นตัวที่สคริปต์สร้างเองตอนรัน) ──
{
  const dynamic = new Set([
    "staffToast", "linkCodeResult", "unlinkLineBtn", "genLinkCodeBtn", "saveSettingsBtn",
    "setStart", "setEnd", "setPhone", "setResponder", "setAppt",        // ฟอร์มตั้งค่าศูนย์ (renderSettingsForm สร้าง)
    "unlink-google-btn", "unlink-facebook-btn",                         // ปุ่มยกเลิกเชื่อม (renderOauthRow สร้าง)
  ]);
  const used = new Set([...js.matchAll(/\$\("([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]));
  for (const id of ["avStage", "avZoom", "avCancel", "avSave"]) used.add(id);   // อยู่ในอาร์เรย์โฟกัส ไม่ได้เรียกตรง
  used.add("lineStatus"); used.add("googleStatus"); used.add("facebookStatus"); // เรียกผ่าน $(provider + "Status")
  for (const id of used) {
    if (dynamic.has(id)) continue;
    ok(htmlIds.has(id), `staff-settings.js ใช้ #${id} แต่ staff.html ไม่มี id นี้`);
  }
  ok(used.size > 40, "ควรตรวจ id หลายสิบตัว (ถ้าน้อยกว่านี้แปลว่า regex ตรวจพลาด)");
}

// ── 2) หัวข้อ: เมนูซ้าย = TOPICS ในสคริปต์ = แผงเนื้อหา · หัวข้อของแอดมินตรงกันทั้ง 3 ที่ ──
{
  const nav = [...html.matchAll(/<button[^>]*class="sn-item[^"]*"[^>]*data-topic="([a-z]+)"([^>]*)>/g)].map((m) => ({ topic: m[1], admin: /data-admin/.test(m[0]) }));
  const panes = [...html.matchAll(/<section[^>]*class="spane"[^>]*data-topic="([a-z]+)"[^>]*>/g)].map((m) => ({ topic: m[1], admin: /data-admin/.test(m[0]) }));
  const topicsBlock = js.slice(js.indexOf("const TOPICS = {"), js.indexOf("};", js.indexOf("const TOPICS = {")));
  const inJs = [...topicsBlock.matchAll(/^\s+([a-z]+):\s+\{ admin: (true|false)/gm)].map((m) => ({ topic: m[1], admin: m[2] === "true" }));
  const key = (xs) => xs.map((x) => `${x.topic}:${x.admin}`).join(",");
  ok(nav.length === 5, "เมนูซ้ายต้องมี 5 หัวข้อ (โปรไฟล์ · บัญชีที่เชื่อม · จัดการเจ้าหน้าที่ · ตั้งค่าศูนย์ · QR Code)");
  ok(key(nav) === key(panes), `หัวข้อเมนู ≠ แผงเนื้อหา\n  เมนู: ${key(nav)}\n  แผง: ${key(panes)}`);
  ok(key(nav) === key(inJs), `หัวข้อเมนู ≠ TOPICS ในสคริปต์\n  เมนู: ${key(nav)}\n  JS: ${key(inJs)}`);
  ok(key(nav) === "me:false,links:false,staff:true,center:true,qr:false", "หัวข้อของผู้ดูแลระบบต้องเป็น จัดการเจ้าหน้าที่ + ตั้งค่าศูนย์ เท่านั้น");
  // แผงของแอดมินต้องมีการ์ด 🔒 + ส่วนเนื้อหา (.pane-body) ให้ show() สลับได้
  for (const t of ["staff", "center"]) {
    const sec = html.slice(html.indexOf(`id="spane-${t}"`), html.indexOf("</section>", html.indexOf(`id="spane-${t}"`)));
    ok(sec.includes('class="locked-card"') && sec.includes('class="pane-body"'), `แผง ${t} ต้องมี .locked-card และ .pane-body`);
  }
  // แผงเริ่มต้น (me) เปิดอยู่ ที่เหลือซ่อน — กัน 2 หัวข้อโผล่พร้อมกันตอนโหลด (ปัญหา "ซ้อนทีละหัวข้อ" ที่บอสแจ้ง)
  const shownAtLoad = panes.filter((p) => !new RegExp(`<section[^>]*data-topic="${p.topic}"[^>]*hidden`).test(html));
  ok(shownAtLoad.length === 1 && shownAtLoad[0].topic === "me", "ตอนโหลดต้องเห็นแผงเดียวคือ โปรไฟล์ของฉัน");
}

// ── 3) ลำดับโหลดสคริปต์ + ไฟล์ที่อ้าง ──
{
  const iQr = html.indexOf('src="/assets/vendor/qrcode-generator-2.0.4.js"');
  const iSet = html.indexOf('src="/staff-settings.js"');
  const iInline = html.indexOf("<script>\nlet currentStatus");
  ok(iQr > 0 && iSet > iQr && iInline > iSet, "ต้องโหลด qrcode-generator → staff-settings.js → สคริปต์หลักตามลำดับ");
  ok(fs.existsSync(path.join(root, "public/assets/vendor/qrcode-generator-2.0.4.js")), "ไฟล์ไลบรารี QR ต้องอยู่ในโปรเจกต์ (โฮสต์เอง ไม่พึ่ง CDN)");
  ok(/MIT/.test(read("public/assets/vendor/qrcode-generator-LICENSE.txt")), "ต้องมีไฟล์สัญญาอนุญาต MIT คู่ไลบรารี");
  ok(!/cdn\.jsdelivr\.net[^"']*qrcode/i.test(html), "ห้ามโหลดไลบรารี QR จาก CDN");
  ok(/window\.StaffSettings = \{ init, show \}/.test(js) && /^\(\(\) => \{/m.test(js), "staff-settings.js ต้องห่อด้วย IIFE และเปิดแค่ StaffSettings.{init,show}");
  ok(html.includes("StaffSettings.init(") && html.includes("StaffSettings.show("), "staff.html ต้องเรียก StaffSettings.init/show");
  ok(html.indexOf("StaffSettings.init(") < html.indexOf("goSettings(wantTopic"), "ต้อง init ก่อนพาไปหัวข้อตาม ?topic=");
}

// ── 4) ของเก่าที่ย้ายไปแล้วต้องไม่ค้างในหน้า ──
{
  for (const gone of ["panel-staffmgmt", "panel-profile", "tabStaffMgmt", "settingsSection", 'data-tab="staffmgmt"', 'data-tab="profile"', "loadProfile(", "loadStaffMgmt(", "renderSettingsForm("]) {
    ok(!html.includes(gone), `staff.html ต้องไม่เหลือของเก่า: ${gone}`);
  }
  ok(!/identity-card|identity-head|identity-icon/.test(css), "CSS ของการ์ด identity เดิมต้องถูกลบ");
  ok(/\?tab=profile|tab === "profile"/.test(html), "ลิงก์เก่า ?tab=profile ต้องยังพาไปหัวข้อ บัญชีที่เชื่อม (ลิงก์ที่ส่งไปแล้ว/บุ๊กมาร์ก)");
}

// ── 5) เมนูผู้ใช้ (แบบ Traffy) + รูปโปรไฟล์ + QR ──
{
  ok(html.includes('id="pdMeta"') && /User: \$\{myStaffId/.test(js), "เมนู User ต้องมีบรรทัด User: รหัส");
  ok(html.includes("✏️ แก้ไขโปรไฟล์") && html.includes('goSettings("me")'), "ปุ่ม แก้ไขโปรไฟล์ ต้องพาไปหัวข้อ โปรไฟล์ของฉัน");
  ok(/accept="image\/jpeg,image\/png,image\/webp"/.test(html), "ช่องเลือกรูปต้องรับเฉพาะ JPG/PNG/WebP");
  ok(js.includes('"avatar-set"') && js.includes('"avatar-clear"') && js.includes('"qr-config"'), "สคริปต์ต้องเรียก avatar-set / avatar-clear / qr-config");
  ok(!/สร้างฟรี|ใช้ฟรี|ฟรี/.test(js.slice(js.indexOf("function buildQrItems"), js.indexOf("async function loadQr"))), "ข้อความบนโปสเตอร์ QR ห้ามมีคำว่า ฟรี (เอกสารทางการไม่ได้ระบุ)");
  const api = read("api/staff-auth.js");
  ok(api.includes("tab=settings&topic=links&linkerror=taken") && api.includes("tab=settings&topic=links&linked="), "OAuth เด้งกลับต้องไปที่ ตั้งค่า > บัญชีที่เชื่อม");
  ok(!/tab=profile/.test(api), "api/staff-auth.js ต้องไม่ใช้ ?tab=profile เดิมอีก");
  ok(read("public/broadcast.html").includes("tab=settings&amp;topic=links"), "หน้าส่งประกาศต้องลิงก์ไปเชื่อมบัญชีที่หัวข้อใหม่");
}

console.log(`✅ test-staff-ui.mjs ผ่านทั้งหมด (${checked} ข้อตรวจ)`);
