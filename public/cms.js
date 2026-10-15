/* public/cms.js — หน้าจัดการเว็บไซต์ (CMS) สำหรับเจ้าหน้าที่ที่ไม่ใช่สายเทค ใช้บนมือถือได้ (สเปก docs/WEBSITE-SPEC.md ข้อ 5.4 + 6)
   6 ต.ค. 69: เขียนใหม่ทั้งไฟล์แทน "รุ่นแรก ช่องกรอกดิบ" (บอสสั่ง 5 ต.ค. 69 "ขึ้นรุ่นแรกก่อน แล้วค่อยทำหน้าแอดมิน" — ถึงคิวแล้ว)
   - ฟอร์มเป็นหน้าเต็ม (ไม่ใช่ป๊อปอัป) ลิงก์ตรงด้วย #hash เช่น #news · #news/new · #news/edit/12 · #pages/edit/about
   - ไม่มีช่อง JSON ดิบอีก: แกลเลอรี/ไฟล์แนบ/ตั้งค่าเว็บไซต์ เป็นปุ่มอัปโหลด + รายการลบ/เรียงได้ · เนื้อหาใช้ Quill (cms-editor.js)
   - รูปย่อในเบราว์เซอร์ก่อนอัปโหลด (cms-media.js) · ตัวนับตัวอักษรตามเพดานจาก cms-meta · เตือนก่อนออกจากหน้าที่ยังไม่บันทึก
   - ⛔ ข้อมูลจาก API แสดงด้วย textContent เสมอ (ตัวช่วย h() ด้านล่างไม่มีทางใส่ HTML) — HTML ที่ sanitize แล้วจากเซิร์ฟเวอร์เข้า Quill เท่านั้น
   - คงพฤติกรรม 5 ต.ค. 69 (ผลตรวจ code-reviewer minor 3): แก้หน้าเนื้อหาเดิม = ช่อง slug readOnly + ส่ง originalSlug ให้เซิร์ฟเวอร์ตรวจ
     (กันเขียนทับหน้าอื่น — ดู pageSlugChangeError ใน api/_cms.js) → ดู buildSlugField() และ buildPayload() */
import {
  checkboxValue, fromThaiDatetimeLocal, toThaiDatetimeLocal, thaiDateTimeText, formatBytes, docTypeOf,
  moveInArray, previewUrl, textLength, foreignImageCount,
} from "./cms-utils.js";
import { uploadImage, uploadBlob, checkDocument } from "./cms-media.js";
import { createRichEditor, quillReady } from "./cms-editor.js";

const $ = (id) => document.getElementById(id);
/* สร้าง element — ข้อความทุกชิ้นเข้าเป็น text node (กัน XSS จากข้อมูล API) */
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k in n && typeof v !== "string") n[k] = v;
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

const S = { meta: null, me: null, dirty: false, ctx: null, postFilter: {}, lastHash: "", suppressHash: false };

/* ═══ เมนู (สเปก 5.4) — key = #hash ═══ */
const SECTIONS = {
  overview: { label: "ภาพรวม" },
  banners: { label: "แบนเนอร์", type: "banners", noun: "แบนเนอร์" },
  news: { label: "ข่าว / กิจกรรม / ประกาศ", type: "posts", cats: ["news", "activity", "announcement"], noun: "ข่าว" },
  knowledge: { label: "ความรู้กฎหมาย", type: "posts", cats: ["knowledge"], noun: "บทความ" },
  faqs: { label: "คำถามที่พบบ่อย", type: "faqs", noun: "คำถาม" },
  docs: { label: "เอกสารดาวน์โหลด", type: "docs", noun: "เอกสาร" },
  people: { label: "บุคลากร", type: "people", noun: "บุคลากร" },
  pages: { label: "หน้าเนื้อหา", type: "pages", noun: "หน้าเนื้อหา" },
  links: { label: "ลิงก์และโซเชียล", type: "links", noun: "ลิงก์" },
  config: { label: "ตั้งค่าเว็บไซต์" },
  audit: { label: "ประวัติการแก้ไข" },
};
const SECTION_HINTS = {
  banners: "รูปสไลด์ด้านบนของหน้าแรก เรียงตามลำดับในรายการนี้",
  news: "ข่าวประชาสัมพันธ์ ภาพกิจกรรม และประกาศของศูนย์",
  knowledge: "บทความความรู้กฎหมายเบื้องต้นสำหรับประชาชน",
  faqs: "คำถามและคำตอบที่แสดงในหน้า “คำถามที่พบบ่อย” เรียงตามลำดับในรายการนี้",
  docs: "แบบฟอร์มและเอกสารให้ประชาชนดาวน์โหลด (PDF / Word / Excel ไม่เกิน 10 MB)",
  people: "ผู้บริหาร ทนายอาสา และเจ้าหน้าที่ที่แสดงในหน้า “เกี่ยวกับศูนย์”",
  pages: "หน้าเนื้อหาทั่วไป เช่น เกี่ยวกับศูนย์ นโยบายคุกกี้ และหน้าที่สร้างเพิ่ม",
  links: "ช่องทางโซเชียลของศูนย์ และหน่วยงานที่เกี่ยวข้องท้ายหน้าแรก",
};
const TYPE_LABEL = { banners: "แบนเนอร์", posts: "ข่าว/บทความ", pages: "หน้าเนื้อหา", people: "บุคลากร", faqs: "คำถามที่พบบ่อย", docs: "เอกสาร", links: "ลิงก์", settings: "ตั้งค่าเว็บไซต์" };
const ACTION_LABEL = { create: "สร้าง", update: "แก้ไข", delete: "ลบ", publish: "เผยแพร่", unpublish: "เปลี่ยนเป็นร่าง", reorder: "จัดลำดับ", config: "ตั้งค่า", reset: "คืนค่าเริ่มต้น" };
const POST_STATE = { draft: ["ร่าง", "muted"], published: ["เผยแพร่แล้ว", "ok"], scheduled: ["ตั้งเวลาเผยแพร่", "warn"] };
const BANNER_STATE = { showing: ["กำลังแสดง", "ok"], scheduled: ["ตั้งเวลาแสดง", "warn"], expired: ["หมดเวลาแสดง", "muted"], off: ["ปิดอยู่", "muted"] };
const SAVED_MSG = "บันทึกแล้ว — หน้าเว็บจะแสดงผลภายในประมาณ 1 นาที";

/* ═══ เรียก API ═══ */
async function api(action, { method = "GET", body, params } = {}) {
  let r;
  try {
    r = await fetch("/api/staff?" + new URLSearchParams({ action, ...(params || {}) }), {
      method, credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, error: "เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่" };
  }
  if (r.status === 401) {
    // มีงานค้างไม่บันทึก = ไม่พาออกจากหน้า (ข้อความหาย) ให้ผู้ใช้คัดลอกเก็บก่อน
    if (S.dirty) return { ok: false, error: "หมดเวลาเข้าสู่ระบบ — กรุณาคัดลอกข้อความที่แก้ไว้เก็บก่อน แล้วเข้าสู่ระบบใหม่ในแท็บใหม่" };
    location.href = "/staff-login.html?next=/cms.html";
    return { ok: false, error: "หมดเวลาเข้าสู่ระบบ กำลังพาไปหน้าเข้าสู่ระบบ…" };
  }
  const d = await r.json().catch(() => null);
  if (!d) return { ok: false, error: `ระบบตอบกลับไม่ถูกต้อง (HTTP ${r.status}) กรุณาลองใหม่อีกครั้ง` };
  if (!d.ok && !d.error) d.error = `ทำรายการไม่สำเร็จ (HTTP ${r.status})`;
  return d;
}

/* ═══ แจ้งเตือน (มุมจอ อ่านได้แม้เลื่อนหน้าลงไปไกล) ═══ */
let toastTimer = null;
function toast(text, kind = "ok") {
  const box = $("notice");
  clearTimeout(toastTimer);
  box.replaceChildren();
  if (!text) return;
  const t = h("div", { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" },
    h("span", { text }),
    h("button", { type: "button", class: "toast-x", "aria-label": "ปิดข้อความ", onclick: () => box.replaceChildren() }, "×"));
  box.append(t);
  if (kind !== "error") toastTimer = setTimeout(() => t.remove(), 7000);
}

/* ═══ กล่องยืนยัน / กรอกข้อความ (แทน confirm/prompt ของเบราว์เซอร์ — อ่านง่ายบนมือถือ ปุ่มภาษาไทย) ═══ */
function ask({ title, message, ok = "ยืนยัน", cancel = "ยกเลิก", danger = false, input = null }) {
  const dlg = $("askDlg");
  return new Promise((resolve) => {
    const field = input ? h("input", { type: input.type || "text", class: "ask-input", placeholder: input.placeholder || "", "aria-label": title, inputmode: input.inputmode || null }) : null;
    const okBtn = h("button", { type: "submit", class: danger ? "btn danger-solid" : "btn primary", value: "ok" }, ok);
    const form = h("form", { method: "dialog", class: "ask" },
      h("h2", { id: "askTitle", text: title }),
      message ? h("p", { text: message }) : null,
      field,
      h("div", { class: "ask-actions" }, h("button", { type: "submit", class: "btn ghost", value: "cancel" }, cancel), okBtn));
    dlg.replaceChildren(form);
    dlg.setAttribute("aria-labelledby", "askTitle");
    const done = () => {
      dlg.removeEventListener("close", done);
      const yes = dlg.returnValue === "ok";
      resolve(input ? (yes ? field.value.trim() : null) : yes);
    };
    dlg.returnValue = "";
    dlg.addEventListener("close", done);
    dlg.showModal();
    (field || okBtn).focus();
  });
}

/* ═══ วันเวลาแบบไทย (พ.ศ. · 24 ชม. · เวลาไทยเสมอ) ═══ */
const DT = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const D = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });
function fmt(v, dateOnly = false) {
  const t = Date.parse(v || "");
  if (!Number.isFinite(t)) return "—";
  return dateOnly ? D.format(new Date(t)) : `${DT.format(new Date(t))} น.`;
}
const mediaUrl = (p) => (p ? S.meta.mediaBase + p : null);
const badge = (text, kind = "muted") => h("span", { class: `badge ${kind}`, text });
const limit = (k) => S.meta.limits[k];

/* ═══ เริ่มต้น ═══ */
async function init() {
  const me = await api("me");
  if (!me.ok) return showState("denied", me.error || "ตรวจสอบสิทธิ์ไม่สำเร็จ", true);
  if (!me.canEditSite) {
    return showState("denied", "บัญชีของท่านยังไม่มีสิทธิ์จัดการเว็บไซต์ — กรุณาติดต่อผู้ดูแลระบบให้เปิดสิทธิ์ “ผู้ดูแลเว็บไซต์” ที่แท็บเจ้าหน้าที่ในหน้าหลังบ้าน");
  }
  const meta = await api("cms-meta");
  if (!meta.ok) return showState("denied", meta.error || "ระบบจัดการเว็บไซต์ยังไม่พร้อมใช้งาน", true);
  S.me = me;
  S.meta = meta;
  $("who").textContent = me.displayName || (me.role === "admin" ? "ผู้ดูแลระบบ" : "เจ้าหน้าที่");
  $("loading").hidden = true;
  $("app").hidden = false;
  bindGlobal();
  route();
}
function showState(_kind, message, retry = false) {
  $("loading").hidden = true;
  $("app").hidden = true;
  $("denied").hidden = false;
  $("deniedMsg").textContent = message;
  $("retryBtn").hidden = !retry;
}

function bindGlobal() {
  window.addEventListener("hashchange", onHashChange);
  // ลิงก์ "ข้ามไปเนื้อหาหลัก" ห้ามเปลี่ยน #hash (hash ใช้เป็นเส้นทางของหน้า) → โฟกัส main ตรงๆ
  document.querySelector(".skip")?.addEventListener("click", (e) => { e.preventDefault(); $("main").focus(); });
  window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
  $("logout").addEventListener("click", async () => {
    if (S.dirty && !(await ask({ title: "ออกจากระบบ", message: "มีการแก้ไขที่ยังไม่ได้บันทึก หากออกจากระบบตอนนี้ข้อมูลที่แก้จะหายไป", ok: "ออกจากระบบ", danger: true }))) return;
    S.dirty = false;
    try { await fetch("/api/staff-auth?action=logout", { method: "POST", credentials: "same-origin" }); } catch { /* ไปหน้าเข้าสู่ระบบต่อได้เลย */ }
    location.href = "/staff-login.html";
  });
}

/* ═══ เส้นทาง #section[/new|/edit/<id>] — ออกจากหน้าที่ยังไม่บันทึก = ถามก่อน ═══ */
function parseHash() {
  const [sec, mode, ...rest] = decodeURIComponent(location.hash.slice(1)).split("/");
  const section = SECTIONS[sec] ? sec : "overview";
  return { section, mode: mode === "new" || mode === "edit" ? mode : null, id: rest.join("/") || null };
}
async function onHashChange() {
  if (S.suppressHash) { S.suppressHash = false; return; }
  if (S.dirty) {
    const target = location.hash;
    S.suppressHash = true;
    location.hash = S.lastHash; // ย้อนกลับก่อน แล้วค่อยถาม
    const go = await ask({ title: "ยังไม่ได้บันทึก", message: "มีการแก้ไขที่ยังไม่ได้บันทึก หากออกจากหน้านี้ข้อมูลที่แก้จะหายไป", ok: "ออกโดยไม่บันทึก", cancel: "อยู่หน้านี้ต่อ", danger: true });
    if (!go) return;
    setDirty(false);
    location.hash = target;
    return;
  }
  route();
}
function setDirty(on) {
  S.dirty = on;
  document.querySelectorAll(".unsaved").forEach((x) => { x.hidden = !on; });
}

async function route() {
  S.lastHash = location.hash;
  S.ctx = null;
  setDirty(false);
  const r = parseHash();
  document.querySelectorAll("#nav a").forEach((a) => {
    const on = a.dataset.sec === r.section;
    if (on) { a.setAttribute("aria-current", "page"); a.scrollIntoView({ block: "nearest", inline: "center" }); }
    else a.removeAttribute("aria-current");
  });
  const content = $("content");
  content.replaceChildren(h("div", { class: "loading-box", role: "status" }, h("span", { class: "spin" }), "กำลังโหลด…"));
  const sec = SECTIONS[r.section];
  try {
    if (r.section === "overview") await renderOverview();
    else if (r.section === "config") await renderConfig();
    else if (r.section === "audit") await renderAudit();
    else if (r.mode) await renderEditor(r.section, r.mode === "edit" ? r.id : null);
    else if (sec.type === "posts") await renderPostList(r.section);
    else await renderSortable(r.section);
  } catch (e) {
    content.replaceChildren(errorBox(e.message || "ระบบขัดข้อง"));
  }
  document.title = `${sec.label} — จัดการเว็บไซต์`;
  $("main").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
function errorBox(message) {
  return h("div", { class: "empty error-box", role: "alert" },
    h("p", { text: message }),
    h("button", { type: "button", class: "btn ghost", onclick: () => route() }, "ลองอีกครั้ง"));
}
function pageHead(title, sub, ...actions) {
  return h("div", { class: "page-head" },
    h("div", null, h("h1", { text: title }), sub ? h("p", { class: "sub", text: sub }) : null),
    actions.length ? h("div", { class: "head-actions" }, ...actions) : null);
}
async function load(action, params) {
  const d = await api(action, { params });
  if (!d.ok) throw new Error(d.error);
  return d;
}

/* ═══ ภาพรวม ═══ */
async function renderOverview() {
  const d = await load("cms-overview");
  const c = d.counts || {};
  const sum = (obj, k = "total") => Object.values(obj || {}).reduce((n, x) => n + (Number(x?.[k]) || 0), 0);
  const postSub = (keys) => {
    const pick = keys.map((k) => c.posts?.[k] || {});
    const n = (f) => pick.reduce((a, x) => a + (x[f] || 0), 0);
    return `เผยแพร่ ${n("published")} · ร่าง ${n("draft")} · ตั้งเวลา ${n("scheduled")}`;
  };
  const card = (sec, total, sub) => h("a", { class: "metric", href: `#${sec}` },
    h("span", { class: "metric-label", text: SECTIONS[sec].label }), h("b", { text: String(total) }), h("small", { text: sub }));
  const out = [
    pageHead("ภาพรวมเว็บไซต์", `${S.me.displayName ? `สวัสดี ${S.me.displayName} — ` : ""}เลือกเมนูเพื่อแก้ไขเนื้อหาบนหน้าเว็บไซต์`,
      h("a", { class: "btn primary", href: "#news/new" }, "+ เพิ่มข่าว"),
      h("a", { class: "btn ghost", href: "/", target: "_blank", rel: "noopener" }, "ดูหน้าเว็บ ↗")),
  ];
  if (S.meta.tablesReady === false) out.push(h("div", { class: "warn-box", role: "alert", text: "ยังไม่ได้สร้างตารางของเว็บไซต์ในฐานข้อมูล — กรุณาแจ้งผู้ดูแลระบบ (supabase-migration-13-website-cms.sql)" }));
  out.push(h("div", { class: "metrics" },
    card("news", sum({ a: c.posts?.news, b: c.posts?.activity, d: c.posts?.announcement }), postSub(["news", "activity", "announcement"])),
    card("knowledge", c.posts?.knowledge?.total || 0, postSub(["knowledge"])),
    card("banners", c.banners?.total || 0, `กำลังแสดง ${c.banners?.showing || 0}`),
    card("faqs", c.faqs?.total || 0, `เปิดใช้งาน ${c.faqs?.active || 0}`),
    card("docs", c.docs?.total || 0, `เปิดใช้งาน ${c.docs?.active || 0}`),
    card("people", sum(c.people), `เปิดใช้งาน ${sum(c.people, "active")}`),
    card("pages", c.pages?.total || 0, `ยังไม่เผยแพร่ ${c.pages?.unpublished || 0}`),
    card("links", sum(c.links), `เปิดใช้งาน ${sum(c.links, "active")}`)));
  const recent = h("div", { class: "list" });
  for (const p of d.recentPosts || []) {
    const sec = p.category === "knowledge" ? "knowledge" : "news";
    const [st, kind] = POST_STATE[p.state] || POST_STATE.draft;
    recent.append(h("a", { class: "item", href: `#${sec}/edit/${p.id}` },
      h("span", { class: "item-body" }, h("span", { class: "item-title", text: p.title || "(ไม่มีหัวเรื่อง)" }),
        h("span", { class: "item-meta" }, badge(st, kind), ` แก้ไข ${fmt(p.updated_at)}`))));
  }
  if (!recent.children.length) recent.append(h("p", { class: "muted", text: "ยังไม่มีข่าวหรือบทความ" }));
  const audit = h("ul", { class: "audit-list" });
  for (const a of d.audit || []) audit.append(auditRow(a));
  if (!audit.children.length) audit.append(h("li", { class: "muted", text: "ยังไม่มีประวัติการแก้ไข" }));
  out.push(h("div", { class: "two-col" },
    h("section", { class: "panel" }, h("h2", { text: "ข่าวและบทความที่แก้ไขล่าสุด" }), recent),
    h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", { text: "ประวัติการแก้ไขล่าสุด" }), h("a", { href: "#audit" }, "ดูทั้งหมด")), audit)));
  $("content").replaceChildren(...out);
}
function auditRow(a) {
  return h("li", null,
    h("div", { class: "audit-top" }, badge(ACTION_LABEL[a.action] || a.action || "—", a.action === "delete" ? "danger" : "info"),
      h("span", { class: "audit-type", text: TYPE_LABEL[a.item_type] || a.item_type || "" })),
    h("div", { class: "audit-summary", text: a.summary || "" }),
    h("div", { class: "item-meta", text: `${a.staff_name || "ระบบ"} · ${fmt(a.at)}` }));
}

/* ═══ รายการข่าว/บทความ (กรองหมวด · สถานะ · ค้นหา · โหลดเพิ่ม) ═══ */
async function renderPostList(secKey) {
  const sec = SECTIONS[secKey];
  const f = (S.postFilter[secKey] ||= { category: "", status: "", q: "" });
  const listBox = h("div", { class: "list" });
  const moreBox = h("div", { class: "more" });
  let offset = 0;
  async function fetchPage(reset) {
    if (reset) { offset = 0; listBox.replaceChildren(h("div", { class: "loading-box", role: "status" }, h("span", { class: "spin" }), "กำลังโหลด…")); }
    const d = await api("cms-list", { params: { type: "posts", category: f.category || sec.cats.join(","), status: f.status, q: f.q, limit: "30", offset: String(offset) } });
    if (reset) listBox.replaceChildren();
    moreBox.replaceChildren();
    if (!d.ok) { listBox.append(errorBox(d.error)); return; }
    for (const p of d.items || []) listBox.append(postItem(secKey, p));
    offset += (d.items || []).length;
    if (!listBox.children.length) {
      listBox.append(h("div", { class: "empty" }, (f.q || f.status || f.category) ? "ไม่พบรายการที่ตรงกับเงื่อนไข" : `ยังไม่มี${sec.noun}`,
        h("br"), h("a", { class: "btn primary", href: `#${secKey}/new` }, `+ เพิ่ม${sec.noun}`)));
    }
    if (d.total != null && offset < d.total) {
      moreBox.append(h("button", { type: "button", class: "btn ghost", onclick: (e) => { e.currentTarget.disabled = true; fetchPage(false); } }, `โหลดเพิ่ม (เหลืออีก ${d.total - offset} รายการ)`));
    }
  }
  const chips = sec.cats.length > 1 ? h("div", { class: "chips", role: "group", "aria-label": "กรองตามหมวด" },
    [["", "ทั้งหมด"], ...sec.cats.map((k) => [k, S.meta.categories.find((c) => c.key === k)?.label || k])].map(([k, label]) =>
      h("button", { type: "button", class: "chip", "aria-pressed": String(f.category === k), onclick: (e) => {
        f.category = k;
        e.currentTarget.parentElement.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
        fetchPage(true);
      } }, label))) : null;
  const status = h("select", { "aria-label": "กรองตามสถานะ", onchange: (e) => { f.status = e.target.value; fetchPage(true); } },
    ...[["", "ทุกสถานะ"], ["draft", "ร่าง"], ["published", "เผยแพร่แล้ว"], ["scheduled", "ตั้งเวลาเผยแพร่"]].map(([v, t]) => h("option", { value: v, selected: f.status === v }, t)));
  let qTimer;
  const search = h("input", { type: "search", placeholder: "ค้นหาจากหัวเรื่อง", value: f.q, "aria-label": "ค้นหาจากหัวเรื่อง", maxlength: "100",
    oninput: (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { f.q = e.target.value.trim(); fetchPage(true); }, 400); } });
  $("content").replaceChildren(
    pageHead(sec.label, SECTION_HINTS[secKey], h("a", { class: "btn primary", href: `#${secKey}/new` }, `+ เพิ่ม${sec.noun}`)),
    h("div", { class: "filters" }, chips, h("div", { class: "filter-row" }, search, status)),
    listBox, moreBox);
  await fetchPage(true);
}
function postItem(secKey, p) {
  const [st, kind] = POST_STATE[p.state] || POST_STATE.draft;
  const thumb = mediaUrl(p.cover_thumb_path || p.cover_path);
  const cat = S.meta.categories.find((c) => c.key === p.category)?.label || p.category;
  return h("a", { class: "item", href: `#${secKey}/edit/${p.id}` },
    thumb ? h("img", { class: "thumb", src: thumb, alt: "", loading: "lazy", width: "72", height: "54" }) : h("span", { class: "thumb ph", "aria-hidden": "true" }, "ไม่มีรูป"),
    h("span", { class: "item-body" },
      h("span", { class: "item-title" }, p.pinned ? h("span", { class: "pin", title: "ปักหมุด", "aria-label": "ปักหมุด" }, "📌 ") : null, p.title || "(ไม่มีหัวเรื่อง)"),
      h("span", { class: "item-meta" }, badge(st, kind), SECTIONS[secKey].cats.length > 1 ? badge(cat, "info") : null,
        ` ${p.state === "draft" ? `แก้ไข ${fmt(p.updated_at)}` : `เผยแพร่ ${fmt(p.published_at)}`}`)));
}

/* ═══ รายการที่เรียงลำดับได้ (↑↓) — บุคลากรแยกกลุ่ม · ลิงก์แยกชนิด ═══ */
function keyOfItem(type, x) { return type === "pages" ? x.slug : x.id; }
async function renderSortable(secKey) {
  const sec = SECTIONS[secKey];
  const type = sec.type;
  const d = await load("cms-list", { type });
  let items = d.items || [];
  const groupsDef = type === "people" ? S.meta.peopleGroups.map((g) => [g.key, g.label, (x) => x.group_key === g.key])
    : type === "links" ? S.meta.linkKinds.map((k) => [k.key, k.label, (x) => x.kind === k.key])
      : [["all", "", () => true]];
  const box = h("div");
  function groups() { return groupsDef.map(([k, label, f]) => ({ k, label, rows: items.filter(f) })); }
  function render(focusSel) {
    box.replaceChildren();
    if (!items.length) {
      box.append(h("div", { class: "empty" }, `ยังไม่มี${sec.noun}`, h("br"), h("a", { class: "btn primary", href: `#${secKey}/new` }, `+ เพิ่ม${sec.noun}`)));
      return;
    }
    for (const g of groups()) {
      if (groupsDef.length > 1) box.append(h("h2", { class: "group-title" }, g.label, h("small", { text: ` ${g.rows.length} รายการ` })));
      const list = h("ol", { class: "list sortable" });
      if (!g.rows.length) list.append(h("li", { class: "muted pad", text: "ยังไม่มีรายการในกลุ่มนี้" }));
      g.rows.forEach((x, i) => list.append(sortRow(secKey, type, x, i, g.rows.length, (delta) => move(g.k, i, delta))));
      box.append(list);
    }
    if (focusSel) box.querySelector(focusSel)?.focus();
  }
  async function move(gk, index, delta) {
    const gs = groups();
    const g = gs.find((x) => x.k === gk);
    const moved = moveInArray(g.rows, index, delta);
    if (!moved) return;
    const key = keyOfItem(type, g.rows[index]);
    const before = items;
    g.rows = moved;
    items = gs.flatMap((x) => x.rows).concat(items.filter((x) => !gs.some((gg) => gg.rows.includes(x))));
    const sel = `[data-move="${CSS.escape(String(key))}:${delta}"]`;
    render(sel);
    const r = await api("cms-reorder", { method: "POST", body: { type, ids: items.map((x) => keyOfItem(type, x)) } });
    if (!r.ok) { items = before; render(sel); return toast(r.error || "จัดลำดับไม่สำเร็จ", "error"); }
    toast("จัดลำดับแล้ว — หน้าเว็บจะแสดงผลภายในประมาณ 1 นาที");
  }
  $("content").replaceChildren(pageHead(sec.label, SECTION_HINTS[secKey], h("a", { class: "btn primary", href: `#${secKey}/new` }, `+ เพิ่ม${sec.noun}`)), box);
  render();
}
function sortRow(secKey, type, x, i, n, move) {
  const key = keyOfItem(type, x);
  const title = rowTitle(type, x);
  const thumbPath = type === "banners" ? x.image_path : type === "people" ? (x.photo_thumb_path || x.photo_path) : type === "links" ? x.logo_path : null;
  const showThumb = ["banners", "people", "links"].includes(type) && !(type === "links" && x.kind === "social");
  return h("li", { class: "item sort-item" },
    showThumb ? (thumbPath ? h("img", { class: `thumb ${type}`, src: mediaUrl(thumbPath), alt: "", loading: "lazy", width: "72", height: "54" }) : h("span", { class: "thumb ph", "aria-hidden": "true" }, "ไม่มีรูป")) : null,
    h("a", { class: "item-body", href: `#${secKey}/edit/${encodeURIComponent(key)}` },
      h("span", { class: "item-title", text: title }), h("span", { class: "item-meta" }, ...rowMeta(type, x))),
    h("span", { class: "row-actions" },
      h("button", { type: "button", class: "icon-btn", "data-move": `${key}:-1`, disabled: i === 0, "aria-label": `เลื่อน “${title}” ขึ้น`, title: "เลื่อนขึ้น", onclick: () => move(-1) }, "↑"),
      h("button", { type: "button", class: "icon-btn", "data-move": `${key}:1`, disabled: i === n - 1, "aria-label": `เลื่อน “${title}” ลง`, title: "เลื่อนลง", onclick: () => move(1) }, "↓"),
      h("a", { class: "btn ghost small", href: `#${secKey}/edit/${encodeURIComponent(key)}` }, "แก้ไข")));
}
function rowTitle(type, x) {
  return x.title || x.alt_text || x.name || x.question || x.label || x.slug || `รายการ #${x.id}`;
}
function rowMeta(type, x) {
  const on = (v) => (v === false ? badge("ปิดใช้งาน", "muted") : null);
  if (type === "banners") {
    const [t, k] = BANNER_STATE[x.state] || BANNER_STATE.off;
    const period = x.starts_at || x.ends_at ? ` ${x.starts_at ? fmt(x.starts_at, true) : "ตอนนี้"} – ${x.ends_at ? fmt(x.ends_at, true) : "ไม่กำหนด"}` : "";
    return [badge(t, k), period];
  }
  if (type === "faqs") return [on(x.active), x.category ? ` ${x.category}` : " ไม่ระบุหมวด"];
  if (type === "docs") {
    const ext = (S.meta.docTypes[x.file_type] || "").toUpperCase();
    return [on(x.active), ext ? badge(ext, "info") : null, ` ${x.category || "ไม่ระบุหมวด"} · ${formatBytes(x.file_size)} · ${fmt(x.published_at, true)}`];
  }
  if (type === "people") return [on(x.active), x.show_on_home ? badge("แสดงหน้าแรก", "ok") : null, x.position ? ` ${x.position}` : ""];
  if (type === "links") {
    let host = x.url || "";
    try { host = new URL(x.url).hostname; } catch { /* แสดงตามที่บันทึก */ }
    const icon = x.kind === "social" ? S.meta.socialIcons.find((s) => s.key === x.icon)?.label : null;
    return [on(x.active), icon ? badge(icon, "info") : null, ` ${host}`];
  }
  if (type === "pages") {
    return [x.isSystem ? badge("หน้าระบบ", "info") : null, x.isDefault ? badge("ใช้เนื้อหาเริ่มต้น", "muted") : null,
      x.published === false ? badge("ยังไม่เผยแพร่", "warn") : badge("เผยแพร่แล้ว", "ok"),
      x.show_in_menu ? badge("แสดงในเมนู", "muted") : null, ` ${x.slug === "about" ? "/about" : `/page/${x.slug}`}`];
  }
  return [];
}

/* ═══ ฟอร์มแก้ไข — สเปกช่องต่อชนิด ═══ */
function formSpec(type, secKey) {
  const cats = SECTIONS[secKey]?.cats;
  return {
    banners: [
      { key: "image", kind: "image", upload: "banner", path: "image_path", w: "image_w", h: "image_h", label: "รูปแบนเนอร์", required: true, ratio: "3 / 1" },
      { key: "mobile", kind: "image", upload: "banner", path: "mobile_image_path", label: "รูปสำหรับจอมือถือ (ไม่บังคับ)", ratio: "4 / 3", extraHint: "ใช้แทนรูปหลักเมื่อเปิดจากมือถือ เหมาะกับรูปที่มีตัวหนังสือเล็ก" },
      { key: "alt_text", kind: "text", label: "คำอธิบายรูป", required: true, max: "alt", hint: "อธิบายสิ่งที่อยู่ในรูปสั้นๆ (สำหรับผู้พิการทางสายตาและการค้นหาของ Google)" },
      { key: "caption", kind: "text", label: "ข้อความบนแบนเนอร์ (ไม่บังคับ)", max: "caption" },
      { key: "link_url", kind: "url", label: "ลิงก์เมื่อกดแบนเนอร์ (ไม่บังคับ)", hint: "ลิงก์เต็มที่ขึ้นต้นด้วย https:// หรือหน้าในเว็บ เช่น /news" },
      { key: "starts_at", kind: "datetime", label: "เริ่มแสดง", hint: "เว้นว่าง = แสดงทันที" },
      { key: "ends_at", kind: "datetime", label: "สิ้นสุดการแสดง", hint: "เว้นว่าง = แสดงต่อเนื่องไม่มีกำหนด" },
      { key: "active", kind: "check", label: "เปิดใช้งานแบนเนอร์นี้" },
    ],
    posts: [
      { key: "category", kind: "select", label: "หมวด", required: true, options: () => S.meta.categories.filter((c) => !cats || cats.includes(c.key)).map((c) => [c.key, c.label]) },
      { key: "title", kind: "text", label: "หัวเรื่อง", required: true, max: "title" },
      { key: "excerpt", kind: "textarea", label: "คำโปรย (ไม่บังคับ)", max: "excerpt", rows: 3, hint: "ข้อความสั้นๆ ที่แสดงในการ์ดข่าว เว้นว่างได้" },
      { key: "cover", kind: "image", upload: "cover", path: "cover_path", thumb: "cover_thumb_path", w: "cover_w", h: "cover_h", label: "รูปปก", ratio: "16 / 9" },
      { key: "cover_alt", kind: "text", label: "คำอธิบายรูปปก", max: "alt", hint: "เว้นว่าง = ใช้หัวเรื่อง", showIf: (d) => !!d.cover_path },
      { key: "body_html", kind: "rich", label: "เนื้อหา", max: "bodyHtml", upload: "inline" },
      { key: "gallery", kind: "gallery", label: "ภาพประกอบ (แกลเลอรี)", max: "gallery" },
      { key: "attachments", kind: "attachments", label: "ไฟล์แนบ PDF", max: "attachments" },
      { key: "published_at", kind: "datetime", label: "วันเวลาเผยแพร่", hint: "เว้นว่าง = เผยแพร่ทันทีเมื่อกด “เผยแพร่” · ใส่วันเวลาล่วงหน้า = ตั้งเวลาเผยแพร่อัตโนมัติ" },
      { key: "pinned", kind: "check", label: "ปักหมุดไว้บนสุดของรายการ" },
    ],
    pages: [
      { key: "slug", kind: "slug", label: "ชื่อลิงก์ของหน้า", required: true, hint: "ภาษาอังกฤษตัวเล็ก ตัวเลข และขีด (-) ยาว 2–40 ตัว เช่น service-area → หน้าเว็บอยู่ที่ /page/service-area" },
      { key: "title", kind: "text", label: "ชื่อหน้า", required: true, max: "pageTitle" },
      { key: "body_html", kind: "rich", label: "เนื้อหา", max: "bodyHtml", upload: "inline" },
      { key: "show_in_menu", kind: "check", label: "แสดงในเมนู “เกี่ยวกับศูนย์”" },
      { key: "published", kind: "check", label: "เผยแพร่หน้านี้" },
    ],
    people: [
      { key: "group_key", kind: "select", label: "กลุ่ม", required: true, options: () => S.meta.peopleGroups.map((g) => [g.key, g.label]) },
      { key: "name", kind: "text", label: "ชื่อ-นามสกุล", required: true, max: "personName" },
      { key: "position", kind: "text", label: "ตำแหน่ง", max: "position" },
      { key: "organization", kind: "text", label: "หน่วยงาน", max: "organization" },
      { key: "photo", kind: "image", upload: "person", path: "photo_path", thumb: "photo_thumb_path", label: "รูปบุคคล", ratio: "4 / 5" },
      { key: "bio", kind: "textarea", label: "ประวัติย่อ (ไม่บังคับ)", max: "bio", rows: 4 },
      { key: "show_on_home", kind: "check", label: "แสดงที่หน้าแรก (แสดงได้สูงสุด 3 คน)" },
      { key: "active", kind: "check", label: "เปิดใช้งาน (แสดงบนหน้าเว็บ)" },
    ],
    faqs: [
      { key: "question", kind: "text", label: "คำถาม", required: true, max: "question" },
      { key: "answer_html", kind: "rich", label: "คำตอบ", required: true, max: "faqAnswerHtml", upload: "inline" },
      { key: "category", kind: "text", label: "หมวดคำถาม (ไม่บังคับ)", max: "category", suggest: "category", hint: "คำถามหมวดเดียวกันจะแสดงเป็นกลุ่มเดียวกัน เลือกจากหมวดที่มีอยู่หรือพิมพ์ใหม่" },
      { key: "active", kind: "check", label: "เปิดใช้งาน (แสดงบนหน้าเว็บ)" },
    ],
    docs: [
      { key: "title", kind: "text", label: "ชื่อเอกสาร", required: true, max: "docTitle" },
      { key: "file", kind: "docfile", label: "ไฟล์เอกสาร", required: true },
      { key: "file_name", kind: "text", label: "ชื่อไฟล์ตอนดาวน์โหลด", max: "fileName", hint: "เว้นว่าง = ใช้ชื่อเอกสาร" },
      { key: "description", kind: "textarea", label: "คำอธิบาย (ไม่บังคับ)", max: "docDescription", rows: 3 },
      { key: "category", kind: "text", label: "หมวดเอกสาร (ไม่บังคับ)", max: "category", suggest: "category" },
      { key: "published_at", kind: "datetime", label: "วันที่เผยแพร่", hint: "เว้นว่าง = วันที่บันทึก · ใส่วันเวลาล่วงหน้า = แสดงเมื่อถึงเวลา" },
      { key: "active", kind: "check", label: "เปิดใช้งาน (แสดงบนหน้าเว็บ)" },
    ],
    links: [
      { key: "kind", kind: "select", label: "ชนิด", required: true, options: () => S.meta.linkKinds.map((k) => [k.key, k.label]) },
      { key: "label", kind: "text", label: "ชื่อที่แสดง", required: true, max: "linkLabel" },
      { key: "url", kind: "url", label: "ลิงก์", required: true, hint: "ลิงก์เต็มที่ขึ้นต้นด้วย https://" },
      { key: "icon", kind: "select", label: "ไอคอน", required: true, options: () => S.meta.socialIcons.map((s) => [s.key, s.label]), showIf: (d) => d.kind === "social" },
      { key: "logo", kind: "image", upload: "logo", path: "logo_path", label: "โลโก้หน่วยงาน (ไม่บังคับ)", ratio: "1 / 1", showIf: (d) => d.kind === "related" },
      { key: "active", kind: "check", label: "เปิดใช้งาน (แสดงบนหน้าเว็บ)" },
    ],
  }[type];
}

/* ═══ หน้าแก้ไข ═══ */
async function renderEditor(secKey, id, savedItem) {
  const sec = SECTIONS[secKey];
  const type = sec.type;
  const isNew = id == null;
  let item;
  if (savedItem) item = savedItem;
  else if (!isNew) item = (await load("cms-get", { type, id })).item;
  else item = {};
  let suggestions = [];
  if (type === "faqs" || type === "docs") {
    const l = await api("cms-list", { params: { type } });
    if (l.ok) suggestions = [...new Set((l.items || []).map((x) => x.category).filter(Boolean))];
  }
  const ctx = { secKey, type, item, isNew, d: {}, local: {}, fields: [], pending: 0, saving: false, suggestions };
  S.ctx = ctx;
  const spec = formSpec(type, secKey);
  // ค่าเริ่มต้นของร่าง (สำเนาของรายการ ไม่แก้ item ตรงๆ)
  ctx.d = JSON.parse(JSON.stringify(item));
  for (const f of spec) {
    if (f.kind === "check") ctx.d[f.key] = checkboxValue(item, f.key);
    if (f.kind === "select" && ctx.d[f.key] == null) ctx.d[f.key] = f.options()[0]?.[0] ?? "";
    if (f.kind === "gallery" || f.kind === "attachments") ctx.d[f.key] = Array.isArray(item[f.key]) ? ctx.d[f.key] : [];
    if (f.kind === "datetime") ctx.local[f.key] = toThaiDatetimeLocal(item[f.key]);
  }
  const form = h("form", { class: "form-card", novalidate: true, onsubmit: (e) => e.preventDefault() });
  for (const f of spec) {
    const field = buildField(f, ctx);
    ctx.fields.push(field);
    form.append(field.node);
  }
  refreshShowIf(ctx);

  const title = isNew ? `เพิ่ม${sec.noun}` : `แก้ไข${sec.noun}`;
  const statusBadges = [];
  if (type === "posts" && !isNew) { const [t, k] = POST_STATE[item.state] || POST_STATE.draft; statusBadges.push(badge(t, k)); }
  if (type === "banners" && !isNew) { const [t, k] = BANNER_STATE[item.state] || BANNER_STATE.off; statusBadges.push(badge(t, k)); }
  if (type === "pages" && item.isSystem) statusBadges.push(badge("หน้าระบบ", "info"));
  if (type === "pages" && item.isDefault) statusBadges.push(badge("ใช้เนื้อหาเริ่มต้น", "muted"));

  const actions = h("div", { class: "actionbar" });
  const left = h("div", { class: "actions-left" });
  const right = h("div", { class: "actions-right" });
  const canDelete = !isNew && !(type === "pages" && item.isSystem && item.isDefault);
  if (canDelete) {
    const resetMode = type === "pages" && item.isSystem;
    left.append(h("button", { type: "button", class: "btn danger", onclick: () => removeItem(ctx) }, resetMode ? "คืนค่าเริ่มต้น" : "ลบ"));
  }
  const pv = previewUrl(type, item);
  if (pv) {
    left.append(h("a", { class: "btn ghost", href: pv, target: "_blank", rel: "noopener", onclick: () => {
      if (S.dirty) toast("ตัวอย่างแสดงเฉพาะข้อมูลที่บันทึกแล้ว — มีการแก้ไขที่ยังไม่ได้บันทึก", "warn");
    } }, "ดูตัวอย่าง ↗"));
  }
  right.append(h("span", { class: "unsaved", hidden: true }, "ยังไม่ได้บันทึก"));
  if (type === "posts") {
    const published = item.status === "published";
    right.append(
      h("button", { type: "button", class: "btn ghost", "data-save": "draft", onclick: () => savePost(ctx, "draft") }, published ? "เปลี่ยนเป็นร่าง" : "บันทึกร่าง"),
      h("button", { type: "button", class: "btn primary", "data-save": "published", onclick: () => savePost(ctx, "published") }, published ? "บันทึกการแก้ไข" : "เผยแพร่"));
  } else {
    right.append(h("button", { type: "button", class: "btn primary", "data-save": "1", onclick: () => save(ctx) }, "บันทึก"));
  }
  actions.append(left, right);
  ctx.actions = actions;

  $("content").replaceChildren(
    h("div", { class: "editor" },
      h("a", { class: "back", href: `#${secKey}` }, `← กลับไปรายการ${sec.label}`),
      h("div", { class: "page-head" }, h("div", null, h("h1", { text: title }), statusBadges.length ? h("div", { class: "head-badges" }, ...statusBadges) : null,
        !isNew && item.updated_at ? h("p", { class: "sub", text: `แก้ไขล่าสุด ${fmt(item.updated_at)}` } ) : null)),
      form, actions));
}

function markDirty(ctx) {
  if (S.ctx !== ctx) return;
  setDirty(true);
  refreshShowIf(ctx);
}
function refreshShowIf(ctx) {
  for (const f of ctx.fields) if (f.spec.showIf) f.node.hidden = !f.spec.showIf(ctx.d);
}

/* ── สร้างช่องกรอกตามชนิด → { spec, node, validate(), collect?(), showError(), focus() } ── */
let fieldSeq = 0;
function buildField(spec, ctx) {
  const id = `f${++fieldSeq}-${spec.key}`;
  const errId = `${id}-err`;
  const err = h("div", { class: "field-error", id: errId, hidden: true });
  const max = spec.max ? limit(spec.max) : null;
  const labelEl = h("label", { class: "label", for: id }, spec.label, spec.required ? h("span", { class: "req", title: "จำเป็นต้องกรอก" }, " *") : null);
  const hint = spec.hint ? h("div", { class: "hint", text: spec.hint }) : null;
  const field = { spec, node: null, validate: () => null, focus: () => {} };
  field.showError = (msg) => {
    err.hidden = !msg;
    err.textContent = msg || "";
    field.node.classList.toggle("has-error", !!msg);
    field.node.querySelector("input,textarea,select,.ql-editor")?.setAttribute("aria-invalid", msg ? "true" : "false");
  };
  const counterFor = (input) => {
    if (!max) return null;
    const c = h("span", { class: "counter", "aria-live": "off" });
    const upd = () => { const n = textLength(input.value); c.textContent = `${n.toLocaleString("en-US")}/${max.toLocaleString("en-US")}`; c.classList.toggle("over", n > max); };
    input.addEventListener("input", upd);
    upd();
    return c;
  };
  const textValidate = (input) => () => {
    const n = textLength(input.value);
    if (spec.required && !n) return `กรุณากรอก${spec.label.replace(/ \(.*\)$/, "")}`;
    if (max && n > max) return `${spec.label.replace(/ \(.*\)$/, "")}ยาวเกิน ${max.toLocaleString("en-US")} ตัวอักษร (ตอนนี้ ${n.toLocaleString("en-US")})`;
    return null;
  };

  switch (spec.kind) {
    case "text": case "url": case "textarea": case "slug": {
      const isArea = spec.kind === "textarea";
      const input = h(isArea ? "textarea" : "input", {
        id, name: spec.key, "aria-describedby": errId,
        type: isArea ? null : spec.kind === "url" ? "url" : "text",
        rows: isArea ? String(spec.rows || 3) : null,
        inputmode: spec.kind === "url" ? "url" : null,
        autocapitalize: spec.kind === "slug" || spec.kind === "url" ? "none" : null,
        list: spec.suggest ? `${id}-list` : null,
      });
      input.value = ctx.d[spec.key] ?? "";
      if (spec.kind === "slug" && !ctx.isNew) input.readOnly = true; // แก้หน้าเดิมห้ามเปลี่ยน slug (5 ต.ค. 69 minor 3)
      input.addEventListener("input", () => {
        if (spec.kind === "slug") { const v = input.value.toLowerCase(); if (v !== input.value) input.value = v; }
        ctx.d[spec.key] = input.value;
        field.showError(null);
        markDirty(ctx);
      });
      const list = spec.suggest ? h("datalist", { id: `${id}-list` }, ...ctx.suggestions.map((s) => h("option", { value: s }))) : null;
      const counter = counterFor(input);
      const slugNote = spec.kind === "slug" && !ctx.isNew ? h("div", { class: "hint", text: "ชื่อลิงก์ของหน้าที่สร้างแล้วเปลี่ยนไม่ได้ (กันเขียนทับหน้าอื่น) หากต้องการลิงก์ใหม่ กรุณาสร้างหน้าใหม่" }) : null;
      field.node = h("div", { class: "field" }, h("div", { class: "label-row" }, labelEl, counter), input, list, slugNote || hint, err);
      field.validate = spec.kind === "slug"
        ? () => (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.value) && input.value.length >= 2 && input.value.length <= 40 ? null : "ชื่อลิงก์ใช้ได้เฉพาะ a-z 0-9 และขีด (-) ยาว 2–40 ตัว เช่น service-area")
        : textValidate(input);
      field.focus = () => input.focus();
      field.input = input;
      break;
    }
    case "select": {
      const sel = h("select", { id, name: spec.key, "aria-describedby": errId }, ...spec.options().map(([v, t]) => h("option", { value: v, text: t })));
      sel.value = ctx.d[spec.key] ?? "";
      sel.addEventListener("change", () => { ctx.d[spec.key] = sel.value; field.showError(null); markDirty(ctx); });
      const single = spec.options().length <= 1;
      field.node = h("div", { class: "field", hidden: single }, labelEl, sel, hint, err);
      if (single) field.spec = { ...spec, showIf: () => false };
      field.validate = () => (spec.required && !sel.value ? `กรุณาเลือก${spec.label}` : null);
      field.focus = () => sel.focus();
      break;
    }
    case "check": {
      const cb = h("input", { type: "checkbox", id, name: spec.key, checked: ctx.d[spec.key] === true });
      cb.addEventListener("change", () => { ctx.d[spec.key] = cb.checked; markDirty(ctx); });
      field.node = h("div", { class: "field check" }, h("label", { class: "check-label", for: id }, cb, h("span", { text: spec.label })), hint, err);
      field.focus = () => cb.focus();
      break;
    }
    case "datetime": {
      const input = h("input", { type: "datetime-local", id, name: spec.key, "aria-describedby": `${id}-th ${errId}`, step: "60" });
      input.value = ctx.local[spec.key] || "";
      const th = h("div", { class: "thai-date", id: `${id}-th`, "aria-live": "polite" });
      const upd = () => { const t = thaiDateTimeText(input.value); th.textContent = t ? `= ${t}` : input.value ? "" : "ยังไม่ได้กำหนด"; };
      input.addEventListener("input", () => { ctx.local[spec.key] = input.value; upd(); field.showError(null); markDirty(ctx); });
      const clear = h("button", { type: "button", class: "btn ghost small", onclick: () => { input.value = ""; ctx.local[spec.key] = ""; upd(); markDirty(ctx); } }, "ล้างค่า");
      upd();
      field.node = h("div", { class: "field" }, labelEl, h("div", { class: "dt-row" }, input, clear), th, hint, err);
      field.validate = () => {
        if (!input.value) return input.validity?.badInput ? "วันเวลาไม่ครบ กรุณากรอกให้ครบหรือกด “ล้างค่า”" : null;
        return thaiDateTimeText(input.value) ? null : "วันเวลาไม่ถูกต้อง";
      };
      field.focus = () => input.focus();
      break;
    }
    case "rich": {
      const host = h("div", { class: "rich-host" });
      const counter = h("span", { class: "counter" });
      field.node = h("div", { class: "field" }, h("div", { class: "label-row" }, h("span", { class: "label", id }, spec.label, spec.required ? h("span", { class: "req" }, " *") : null), counter), host, hint, err);
      if (!quillReady()) {
        host.append(h("div", { class: "warn-box", role: "alert", text: "โหลดตัวแก้ข้อความไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วโหลดหน้าใหม่ (ระบบจะไม่ให้บันทึกจนกว่าตัวแก้ข้อความจะพร้อม เพื่อไม่ให้เนื้อหาเดิมหาย)" }));
        field.validate = () => "ตัวแก้ข้อความยังไม่พร้อม กรุณาโหลดหน้าใหม่";
        break;
      }
      let cTimer;
      const updCount = () => {
        const n = editor.getHTML().length;
        counter.textContent = n > max * 0.5 ? `${n.toLocaleString("en-US")}/${max.toLocaleString("en-US")}` : "";
        counter.classList.toggle("over", n > max);
      };
      const editor = createRichEditor(host, {
        placeholder: spec.required ? "พิมพ์คำตอบที่นี่…" : "พิมพ์เนื้อหาที่นี่…",
        onChange: () => { field.showError(null); markDirty(ctx); clearTimeout(cTimer); cTimer = setTimeout(updCount, 500); },
        uploadImage: (file) => uploadImage(api, file, spec.upload, S.meta),
        askVideo: () => ask({ title: "แทรกวิดีโอ YouTube", message: "วางลิงก์วิดีโอจาก YouTube เช่น https://www.youtube.com/watch?v=… หรือ https://youtu.be/…", ok: "แทรกวิดีโอ", input: { type: "url", inputmode: "url", placeholder: "https://www.youtube.com/watch?v=…" } }),
        onError: (m) => toast(m, "error"),
        onBusy: (on, m) => {
          trackPending(ctx, on);
          if (on) markDirty(ctx);
          if (on && m) toast(m, "info");
        },
        onInserted: () => toast("แทรกรูปแล้ว — กรุณากดบันทึก"),
      });
      editor.setHTML(ctx.d[spec.key] || "");
      editor.quill.root.setAttribute("aria-labelledby", id);
      editor.quill.root.setAttribute("aria-describedby", errId);
      updCount();
      field.collect = () => { ctx.d[spec.key] = editor.getHTML(); };
      field.validate = () => {
        if (editor.isUploading()) return "กรุณารอให้อัปโหลดรูปในเนื้อหาเสร็จก่อน";
        const html = editor.getHTML();
        if (spec.required && !editor.quill.getText().trim() && !/<(img|iframe)\b/i.test(html)) return `กรุณากรอก${spec.label}`;
        if (html.length > max) return `${spec.label}ยาวเกินกำหนด (${html.length.toLocaleString("en-US")}/${max.toLocaleString("en-US")} ตัวอักษรรวมรูปแบบ) กรุณาแบ่งเป็นหลายเรื่อง`;
        const foreign = foreignImageCount(html, S.meta.mediaBase);
        if (foreign) return `พบรูปที่คัดลอกมาจากที่อื่น ${foreign} รูป ระบบจะไม่แสดงรูปเหล่านี้ — กรุณาลบรูปนั้นแล้วใช้ปุ่ม “แทรกรูป” อัปโหลดใหม่`;
        return null;
      };
      field.focus = () => editor.focus();
      break;
    }
    case "image": return buildImageField(spec, ctx, field, { err, id });
    case "docfile": return buildDocField(spec, ctx, field, { labelEl, err, id });
    case "gallery": return buildGalleryField(spec, ctx, field, { err, id, max });
    case "attachments": return buildAttachmentField(spec, ctx, field, { err, id, max });
    default: throw new Error("unknown field " + spec.kind);
  }
  return field;
}

function fileButton(label, { accept, multiple = false, onFiles, cls = "btn ghost" }) {
  const input = h("input", { type: "file", accept, multiple, class: "sr-only", tabindex: "-1", "aria-hidden": "true" });
  input.addEventListener("change", () => { const files = [...(input.files || [])]; input.value = ""; if (files.length) onFiles(files); });
  const btn = h("button", { type: "button", class: cls, onclick: () => input.click() }, label);
  return { btn, input };
}
function trackPending(ctx, on) {
  ctx.pending += on ? 1 : -1;
  ctx.actions?.querySelectorAll("[data-save]").forEach((b) => { b.disabled = ctx.pending > 0 || ctx.saving; });
}

/* รูปเดี่ยว (แบนเนอร์/ปก/บุคคล/โลโก้) */
function buildImageField(spec, ctx, field, { err, id }) {
  const info = S.meta.uploadKinds[spec.upload];
  const preview = h("div", { class: "img-preview", style: `aspect-ratio:${spec.ratio || "16 / 9"}` });
  const status = h("div", { class: "upload-status", "aria-live": "polite" });
  const actions = h("div", { class: "upload-actions" });
  function draw() {
    const p = ctx.d[spec.path];
    preview.replaceChildren(p ? h("img", { src: mediaUrl(p), alt: "ตัวอย่างรูปที่เลือก" }) : h("span", { class: "ph-text", text: "ยังไม่มีรูป" }));
    actions.replaceChildren(pick.btn, pick.input);
    pick.btn.textContent = p ? "เปลี่ยนรูป" : "เลือกรูป";
    if (p) actions.append(h("button", { type: "button", class: "btn ghost", onclick: () => {
      ctx.d[spec.path] = null;
      if (spec.thumb) ctx.d[spec.thumb] = null;
      if (spec.w) { ctx.d[spec.w] = null; ctx.d[spec.h] = null; }
      status.textContent = "นำรูปออกแล้ว — กรุณากดบันทึก";
      draw(); markDirty(ctx);
    } }, "นำรูปออก"));
  }
  const pick = fileButton("เลือกรูป", {
    accept: "image/jpeg,image/png,image/webp",
    onFiles: async ([file]) => {
      pick.btn.disabled = true;
      trackPending(ctx, true);
      field.showError(null);
      try {
        const up = await uploadImage(api, file, spec.upload, S.meta, (m) => { status.textContent = m; });
        ctx.d[spec.path] = up.path;
        if (spec.thumb) ctx.d[spec.thumb] = up.thumbPath;
        if (spec.w) { ctx.d[spec.w] = up.w; ctx.d[spec.h] = up.h; }
        status.textContent = `อัปโหลดแล้ว: ${up.summary} — กรุณากดบันทึก`;
        draw(); markDirty(ctx);
      } catch (e) {
        status.textContent = "";
        field.showError(e.message || "อัปโหลดรูปไม่สำเร็จ");
        toast(e.message || "อัปโหลดรูปไม่สำเร็จ", "error");
      } finally {
        pick.btn.disabled = false;
        trackPending(ctx, false);
      }
    },
  });
  pick.btn.id = id;
  draw();
  const hintText = [spec.extraHint, info?.hint, "ระบบย่อรูปให้อัตโนมัติก่อนอัปโหลด"].filter(Boolean).join(" · ");
  field.node = h("div", { class: "field image-field" },
    h("span", { class: "label" }, spec.label, spec.required ? h("span", { class: "req" }, " *") : null),
    h("div", { class: "image-row" }, preview, h("div", { class: "image-side" }, actions, status, h("div", { class: "hint", text: hintText }))), err);
  field.validate = () => (spec.required && !ctx.d[spec.path] ? `กรุณาอัปโหลด${spec.label}` : null);
  field.focus = () => pick.btn.focus();
  field.paths = [spec.path];
  return field;
}

/* ไฟล์เอกสารดาวน์โหลด (ไม่แปลง) */
function buildDocField(spec, ctx, field, { err, id }) {
  const info = S.meta.uploadKinds.doc;
  const box = h("div", { class: "doc-current" });
  const status = h("div", { class: "upload-status", "aria-live": "polite" });
  function draw() {
    const ext = (S.meta.docTypes[ctx.d.file_type] || "").toUpperCase();
    box.replaceChildren(ctx.d.file_path
      ? h("span", { class: "doc-chip" }, badge(ext || "ไฟล์", "info"), ` ${ctx.d.file_name || "ไฟล์ที่อัปโหลด"} · ${formatBytes(ctx.d.file_size)}`)
      : h("span", { class: "muted", text: "ยังไม่มีไฟล์" }));
    pick.btn.textContent = ctx.d.file_path ? "เปลี่ยนไฟล์" : "เลือกไฟล์";
  }
  const accept = [...info.types, ...info.exts.map((e) => "." + e)].join(",");
  const pick = fileButton("เลือกไฟล์", {
    accept,
    onFiles: async ([file]) => {
      field.showError(null);
      const ct = docTypeOf(file.name, file.type, S.meta.docTypes);
      pick.btn.disabled = true;
      trackPending(ctx, true);
      try {
        checkDocument(file, "doc", S.meta, ct);
        status.textContent = "กำลังอัปโหลด…";
        const up = await uploadBlob(api, "doc", file, ct, "main");
        const prevName = ctx.d.file_name;
        ctx.d.file_path = up.path;
        ctx.d.file_type = ct;
        ctx.d.file_size = file.size;
        const nameField = ctx.fields.find((f) => f.spec.key === "file_name");
        if (!prevName || prevName === ctx.autoFileName) {
          ctx.d.file_name = file.name.slice(0, limit("fileName"));
          ctx.autoFileName = ctx.d.file_name;
          if (nameField?.input) nameField.input.value = ctx.d.file_name;
        }
        status.textContent = `อัปโหลดแล้ว (${formatBytes(file.size)}) — กรุณากดบันทึก`;
        draw(); markDirty(ctx);
      } catch (e) {
        status.textContent = "";
        field.showError(e.message || "อัปโหลดไฟล์ไม่สำเร็จ");
        toast(e.message || "อัปโหลดไฟล์ไม่สำเร็จ", "error");
      } finally {
        pick.btn.disabled = false;
        trackPending(ctx, false);
      }
    },
  });
  pick.btn.id = id;
  draw();
  field.node = h("div", { class: "field" }, h("span", { class: "label" }, spec.label, h("span", { class: "req" }, " *")),
    box, h("div", { class: "upload-actions" }, pick.btn, pick.input), status, h("div", { class: "hint", text: info.hint }), err);
  field.validate = () => (!ctx.d.file_path ? "กรุณาอัปโหลดไฟล์เอกสาร" : null);
  field.focus = () => pick.btn.focus();
  field.paths = ["file_path"];
  return field;
}

/* แกลเลอรี: อัปโหลดหลายรูป + คำอธิบายรูป + เรียง ↑↓ + ลบ (แทนช่อง JSON ดิบของรุ่นแรก) */
function buildGalleryField(spec, ctx, field, { err, id, max }) {
  const list = h("ol", { class: "gallery" });
  const count = h("span", { class: "counter" });
  const status = h("div", { class: "upload-status", "aria-live": "polite" });
  function draw(focusSel) {
    const g = ctx.d.gallery;
    count.textContent = `${g.length}/${max} รูป`;
    list.replaceChildren(...g.map((x, i) => {
      const alt = h("input", { type: "text", value: x.alt || "", placeholder: "คำอธิบายรูป (ไม่บังคับ)", "aria-label": `คำอธิบายรูปที่ ${i + 1}` });
      alt.addEventListener("input", () => { x.alt = alt.value; markDirty(ctx); });
      return h("li", { class: "g-item" },
        h("img", { src: mediaUrl(x.thumb_path || x.path), alt: `รูปที่ ${i + 1}`, loading: "lazy" }),
        alt,
        h("div", { class: "g-actions" },
          h("button", { type: "button", class: "icon-btn", "data-g": `${i}:-1`, disabled: i === 0, "aria-label": `เลื่อนรูปที่ ${i + 1} ขึ้น`, onclick: () => mv(i, -1) }, "↑"),
          h("button", { type: "button", class: "icon-btn", "data-g": `${i}:1`, disabled: i === g.length - 1, "aria-label": `เลื่อนรูปที่ ${i + 1} ลง`, onclick: () => mv(i, 1) }, "↓"),
          h("button", { type: "button", class: "icon-btn danger", "aria-label": `ลบรูปที่ ${i + 1}`, onclick: () => { ctx.d.gallery = g.filter((_, j) => j !== i); draw(); markDirty(ctx); status.textContent = "นำรูปออกจากแกลเลอรีแล้ว — กรุณากดบันทึก"; } }, "✕")));
    }));
    if (!g.length) list.append(h("li", { class: "muted pad", text: "ยังไม่มีรูปในแกลเลอรี" }));
    if (focusSel) list.querySelector(focusSel)?.focus();
  }
  function mv(i, delta) {
    const next = moveInArray(ctx.d.gallery, i, delta);
    if (!next) return;
    ctx.d.gallery = next;
    draw(`[data-g="${i + delta}:${delta}"]`);
    markDirty(ctx);
  }
  const pick = fileButton("+ เพิ่มรูป", {
    accept: "image/jpeg,image/png,image/webp", multiple: true,
    onFiles: async (files) => {
      field.showError(null);
      const room = max - ctx.d.gallery.length;
      if (room <= 0) return field.showError(`แกลเลอรีมีได้ไม่เกิน ${max} รูป`);
      const take = files.slice(0, room);
      pick.btn.disabled = true;
      trackPending(ctx, true);
      let done = 0;
      const errors = [];
      for (const [k, file] of take.entries()) {
        try {
          const up = await uploadImage(api, file, "gallery", S.meta, (m) => { status.textContent = `รูปที่ ${k + 1}/${take.length}: ${m}`; });
          ctx.d.gallery = [...ctx.d.gallery, { path: up.path, thumb_path: up.thumbPath, alt: "", w: up.w, h: up.h }];
          done++;
          draw(); markDirty(ctx);
        } catch (e) { errors.push(e.message || `อัปโหลด “${file.name}” ไม่สำเร็จ`); }
      }
      pick.btn.disabled = false;
      trackPending(ctx, false);
      status.textContent = done ? `เพิ่มแล้ว ${done} รูป — กรุณากดบันทึก` : "";
      const skipped = files.length - take.length;
      if (skipped > 0) errors.push(`ข้าม ${skipped} รูปเพราะแกลเลอรีมีได้ไม่เกิน ${max} รูป`);
      if (errors.length) { field.showError(errors.join(" · ")); toast(errors[0], "error"); }
    },
  });
  pick.btn.id = id;
  draw();
  field.node = h("div", { class: "field" }, h("div", { class: "label-row" }, h("span", { class: "label", text: spec.label }), count),
    list, h("div", { class: "upload-actions" }, pick.btn, pick.input), status,
    h("div", { class: "hint", text: `เลือกได้หลายรูปพร้อมกัน · ${S.meta.uploadKinds.gallery.hint} · ระบบย่อรูปให้อัตโนมัติ` }), err);
  field.validate = () => {
    if (ctx.d.gallery.length > max) return `แกลเลอรีมีได้ไม่เกิน ${max} รูป`;
    const long = ctx.d.gallery.findIndex((x) => textLength(x.alt) > limit("alt"));
    return long >= 0 ? `คำอธิบายรูปที่ ${long + 1} ยาวเกิน ${limit("alt")} ตัวอักษร` : null;
  };
  field.focus = () => pick.btn.focus();
  field.paths = ["gallery"];
  return field;
}

/* ไฟล์แนบ PDF ของข่าว: อัปโหลดหลายไฟล์ + แก้ชื่อ + เรียง ↑↓ + ลบ */
function buildAttachmentField(spec, ctx, field, { err, id, max }) {
  const list = h("ol", { class: "attach-list" });
  const count = h("span", { class: "counter" });
  const status = h("div", { class: "upload-status", "aria-live": "polite" });
  function draw(focusSel) {
    const a = ctx.d.attachments;
    count.textContent = `${a.length}/${max} ไฟล์`;
    list.replaceChildren(...a.map((x, i) => {
      const name = h("input", { type: "text", value: x.name || "", "aria-label": `ชื่อไฟล์แนบที่ ${i + 1}` });
      name.addEventListener("input", () => { x.name = name.value; markDirty(ctx); });
      return h("li", { class: "a-item" }, badge("PDF", "info"), name, h("span", { class: "muted small", text: formatBytes(x.size) }),
        h("div", { class: "g-actions" },
          h("button", { type: "button", class: "icon-btn", "data-a": `${i}:-1`, disabled: i === 0, "aria-label": `เลื่อนไฟล์ที่ ${i + 1} ขึ้น`, onclick: () => mv(i, -1) }, "↑"),
          h("button", { type: "button", class: "icon-btn", "data-a": `${i}:1`, disabled: i === a.length - 1, "aria-label": `เลื่อนไฟล์ที่ ${i + 1} ลง`, onclick: () => mv(i, 1) }, "↓"),
          h("button", { type: "button", class: "icon-btn danger", "aria-label": `ลบไฟล์ที่ ${i + 1}`, onclick: () => { ctx.d.attachments = a.filter((_, j) => j !== i); draw(); markDirty(ctx); status.textContent = "นำไฟล์ออกแล้ว — กรุณากดบันทึก"; } }, "✕")));
    }));
    if (!a.length) list.append(h("li", { class: "muted pad", text: "ยังไม่มีไฟล์แนบ" }));
    if (focusSel) list.querySelector(focusSel)?.focus();
  }
  function mv(i, delta) {
    const next = moveInArray(ctx.d.attachments, i, delta);
    if (!next) return;
    ctx.d.attachments = next;
    draw(`[data-a="${i + delta}:${delta}"]`);
    markDirty(ctx);
  }
  const pick = fileButton("+ เพิ่มไฟล์ PDF", {
    accept: "application/pdf,.pdf", multiple: true,
    onFiles: async (files) => {
      field.showError(null);
      const room = max - ctx.d.attachments.length;
      if (room <= 0) return field.showError(`ไฟล์แนบมีได้ไม่เกิน ${max} ไฟล์`);
      const take = files.slice(0, room);
      pick.btn.disabled = true;
      trackPending(ctx, true);
      let done = 0;
      const errors = [];
      for (const [k, file] of take.entries()) {
        try {
          const ct = /\.pdf$/i.test(file.name) || file.type === "application/pdf" ? "application/pdf" : file.type;
          checkDocument(file, "attachment", S.meta, ct);
          status.textContent = `กำลังอัปโหลดไฟล์ ${k + 1}/${take.length}…`;
          const up = await uploadBlob(api, "attachment", file, "application/pdf", "main");
          ctx.d.attachments = [...ctx.d.attachments, { path: up.path, name: file.name.slice(0, limit("fileName")), size: file.size, type: "application/pdf" }];
          done++;
          draw(); markDirty(ctx);
        } catch (e) { errors.push(e.message || `อัปโหลด “${file.name}” ไม่สำเร็จ`); }
      }
      pick.btn.disabled = false;
      trackPending(ctx, false);
      status.textContent = done ? `เพิ่มแล้ว ${done} ไฟล์ — กรุณากดบันทึก` : "";
      const skipped = files.length - take.length;
      if (skipped > 0) errors.push(`ข้าม ${skipped} ไฟล์เพราะไฟล์แนบมีได้ไม่เกิน ${max} ไฟล์`);
      if (errors.length) { field.showError(errors.join(" · ")); toast(errors[0], "error"); }
    },
  });
  pick.btn.id = id;
  draw();
  field.node = h("div", { class: "field" }, h("div", { class: "label-row" }, h("span", { class: "label", text: spec.label }), count),
    list, h("div", { class: "upload-actions" }, pick.btn, pick.input), status, h("div", { class: "hint", text: S.meta.uploadKinds.attachment.hint }), err);
  field.validate = () => {
    if (ctx.d.attachments.length > max) return `ไฟล์แนบมีได้ไม่เกิน ${max} ไฟล์`;
    const long = ctx.d.attachments.findIndex((x) => textLength(x.name) > limit("fileName"));
    return long >= 0 ? `ชื่อไฟล์แนบที่ ${long + 1} ยาวเกิน ${limit("fileName")} ตัวอักษร` : null;
  };
  field.focus = () => pick.btn.focus();
  field.paths = ["attachments"];
  return field;
}

/* ═══ บันทึก / ลบ ═══ */
function validateAll(ctx) {
  let first = null;
  for (const f of ctx.fields) {
    if (f.node.hidden) { f.showError?.(null); continue; }
    const msg = f.validate();
    f.showError?.(msg);
    if (msg && !first) first = f;
  }
  return first;
}
function buildPayload(ctx, status) {
  for (const f of ctx.fields) if (!f.node.hidden) f.collect?.();
  const item = { ...ctx.item, ...ctx.d };
  for (const k of ["state", "path", "isSystem", "isDefault", "isNew", "originalSlug", "created_at", "updated_at", "updated_by", "created_by", "author_staff_id"]) delete item[k];
  for (const [k, v] of Object.entries(ctx.local)) item[k] = fromThaiDatetimeLocal(v);
  if (ctx.type === "posts") item.status = status;
  if (ctx.type === "pages") {
    if (ctx.isNew) item.isNew = true;
    else item.originalSlug = ctx.item.slug; // แก้หน้าเดิม = ส่ง slug เดิมให้เซิร์ฟเวอร์ตรวจ (5 ต.ค. 69 minor 3)
  }
  return item;
}
async function savePost(ctx, status) {
  if (status === "draft" && ctx.item.status === "published") {
    const ok = await ask({ title: "เปลี่ยนเป็นร่าง", message: "เรื่องนี้จะไม่แสดงบนหน้าเว็บไซต์จนกว่าจะกด “เผยแพร่” อีกครั้ง", ok: "เปลี่ยนเป็นร่าง" });
    if (!ok) return;
  }
  return save(ctx, status);
}
async function save(ctx, status) {
  if (ctx.saving) return;
  if (ctx.pending > 0) return toast("กรุณารอให้อัปโหลดไฟล์เสร็จก่อน", "warn");
  const bad = validateAll(ctx);
  if (bad) {
    toast("กรุณาตรวจช่องที่มีข้อความแจ้งเตือนสีแดง", "error");
    bad.node.scrollIntoView({ block: "center", behavior: "smooth" });
    bad.focus();
    return;
  }
  let item;
  try { item = buildPayload(ctx, status); } catch (e) { return toast(e.message, "error"); }
  ctx.saving = true;
  const btns = ctx.actions.querySelectorAll("button");
  btns.forEach((b) => { b.disabled = true; });
  const clicked = ctx.actions.querySelector(status ? `[data-save="${status}"]` : "[data-save]");
  const oldLabel = clicked?.textContent;
  if (clicked) clicked.replaceChildren(h("span", { class: "spin" }), " กำลังบันทึก…");
  const d = await api("cms-save", { method: "POST", body: { type: ctx.type, item } });
  ctx.saving = false;
  if (!d.ok) {
    btns.forEach((b) => { b.disabled = false; });
    if (clicked) clicked.textContent = oldLabel;
    toast(d.error || "บันทึกไม่สำเร็จ", "error");
    const f = d.field && ctx.fields.find((x) => x.spec.key === d.field || x.spec.path === d.field || x.spec.thumb === d.field || (x.paths || []).includes(d.field));
    if (f) { f.showError(d.error); f.node.scrollIntoView({ block: "center", behavior: "smooth" }); f.focus(); }
    return;
  }
  setDirty(false);
  const saved = d.item;
  if (ctx.type === "posts" && saved.status === "draft") toast("บันทึกร่างแล้ว — ร่างยังไม่แสดงบนหน้าเว็บ กด “ดูตัวอย่าง” เพื่อดูหน้าตาก่อนเผยแพร่");
  else if (ctx.type === "posts" && saved.state === "scheduled") toast(`บันทึกแล้ว — ตั้งเวลาเผยแพร่ ${fmt(saved.published_at)}`);
  else toast(SAVED_MSG);
  const key = ctx.type === "pages" ? saved.slug : saved.id;
  const target = `#${ctx.secKey}/edit/${encodeURIComponent(key)}`;
  if (location.hash !== target) history.replaceState(null, "", target);
  S.lastHash = location.hash;
  const y = window.scrollY;
  await renderEditor(ctx.secKey, String(key), saved);
  window.scrollTo(0, y);
}
async function removeItem(ctx) {
  const resetMode = ctx.type === "pages" && ctx.item.isSystem;
  const title = rowTitle(ctx.type, ctx.item);
  const step1 = await ask({
    title: resetMode ? "คืนค่าเริ่มต้นของหน้านี้" : "ลบรายการนี้",
    message: resetMode ? `เนื้อหาที่แก้ไว้ของหน้า “${title}” จะถูกแทนด้วยเนื้อหาเริ่มต้นของระบบ` : `ต้องการลบ “${title}” ใช่หรือไม่`,
    ok: resetMode ? "คืนค่าเริ่มต้น" : "ลบรายการ", danger: true,
  });
  if (!step1) return;
  const step2 = await ask({
    title: "ยืนยันอีกครั้ง",
    message: resetMode ? "การคืนค่าเริ่มต้นมีผลกับหน้าเว็บไซต์ และย้อนกลับไม่ได้" : "การลบมีผลกับหน้าเว็บไซต์ทันที และย้อนกลับไม่ได้ (ไฟล์รูป/เอกสารของรายการนี้จะถูกลบด้วย)",
    ok: resetMode ? "ยืนยันคืนค่าเริ่มต้น" : "ยืนยันการลบ", danger: true,
  });
  if (!step2) return;
  const d = await api("cms-delete", { method: "POST", body: { type: ctx.type, id: keyOfItem(ctx.type, ctx.item) } });
  if (!d.ok) return toast(d.error || "ลบไม่สำเร็จ", "error");
  setDirty(false);
  toast(d.reset ? "คืนค่าเริ่มต้นแล้ว — หน้าเว็บจะแสดงผลภายในประมาณ 1 นาที" : "ลบรายการแล้ว — หน้าเว็บจะแสดงผลภายในประมาณ 1 นาที");
  location.hash = `#${ctx.secKey}`;
}

/* ═══ ตั้งค่าเว็บไซต์ (แทนช่อง JSON ดิบของรุ่นแรก) ═══ */
async function renderConfig() {
  const d = await load("cms-config");
  const cfg = JSON.parse(JSON.stringify(d.config || {}));
  cfg.notice ||= { enabled: false, text: "", link: "" };
  const pages = Array.isArray(cfg.facebook_pages) ? cfg.facebook_pages.slice(0, limit("fbPages")) : [];
  while (pages.length < limit("fbPages")) pages.push({ label: "", url: "" });
  const ctx = { fields: [], cfg };
  S.ctx = ctx;
  const dirty = () => { if (S.ctx === ctx) setDirty(true); };
  const errs = {};
  const errBox = (k) => (errs[k] = h("div", { class: "field-error", hidden: true }));
  const text = (label, get, set, { max, area, type = "text", hint, inputmode } = {}) => {
    const id = `cfg-${++fieldSeq}`;
    const input = h(area ? "textarea" : "input", { id, type: area ? null : type, rows: area ? "3" : null, inputmode });
    input.value = get() || "";
    const counter = max ? h("span", { class: "counter" }) : null;
    const upd = () => { if (!counter) return; const n = textLength(input.value); counter.textContent = `${n}/${max}`; counter.classList.toggle("over", n > max); };
    input.addEventListener("input", () => { set(input.value); upd(); dirty(); });
    upd();
    return h("div", { class: "field" }, h("div", { class: "label-row" }, h("label", { class: "label", for: id, text: label }), counter), input, hint ? h("div", { class: "hint", text: hint }) : null);
  };
  const check = (label, get, set, hint) => {
    const id = `cfg-${++fieldSeq}`;
    const cb = h("input", { type: "checkbox", id, checked: get() === true });
    cb.addEventListener("change", () => { set(cb.checked); dirty(); });
    return h("div", { class: "field check" }, h("label", { class: "check-label", for: id }, cb, h("span", { text: label })), hint ? h("div", { class: "hint", text: hint }) : null);
  };
  const fb = h("div", { class: "fb-list" }, ...pages.map((p, i) => h("fieldset", { class: "fb-item" }, h("legend", { text: `เพจที่ ${i + 1}` }),
    text("ชื่อเพจ", () => p.label, (v) => { p.label = v; }, { max: limit("linkLabel") }),
    text("ลิงก์เพจ Facebook", () => p.url, (v) => { p.url = v; }, { type: "url", inputmode: "url", hint: i === 0 ? "เช่น https://www.facebook.com/ชื่อเพจ หรือ https://www.facebook.com/profile.php?id=ตัวเลข · เว้นว่าง = ไม่แสดงแท็บนี้" : null }))));
  const saveBtn = h("button", { type: "button", class: "btn primary", onclick: async () => {
    Object.values(errs).forEach((e) => { e.hidden = true; });
    const config = { ...cfg, facebook_pages: pages.filter((p) => String(p.label || "").trim() || String(p.url || "").trim()) };
    saveBtn.disabled = true;
    const r = await api("cms-config-save", { method: "POST", body: { config } });
    saveBtn.disabled = false;
    if (!r.ok) {
      toast(r.error, "error");
      const e = errs[r.field];
      if (e) { e.textContent = r.error; e.hidden = false; e.scrollIntoView({ block: "center", behavior: "smooth" }); }
      return;
    }
    setDirty(false);
    toast(SAVED_MSG);
  } }, "บันทึกตั้งค่า");
  $("content").replaceChildren(
    pageHead("ตั้งค่าเว็บไซต์", "แถบประกาศด่วน โหมดไว้ทุกข์ ข้อความแนะนำ และเพจ Facebook ที่แสดงบนหน้าเว็บ"),
    h("form", { class: "form-card", novalidate: true, onsubmit: (e) => e.preventDefault() },
      h("h2", { class: "form-section", text: "แถบประกาศด่วน (บนสุดทุกหน้า)" }),
      check("แสดงแถบประกาศด่วน", () => cfg.notice.enabled, (v) => { cfg.notice.enabled = v; }),
      text("ข้อความประกาศ", () => cfg.notice.text, (v) => { cfg.notice.text = v; }, { max: limit("noticeText") }),
      text("ลิงก์เมื่อกดประกาศ (ไม่บังคับ)", () => cfg.notice.link, (v) => { cfg.notice.link = v; }, { type: "url", inputmode: "url", hint: "ลิงก์เต็ม https://… หรือหน้าในเว็บ เช่น /news" }),
      errBox("notice"),
      h("h2", { class: "form-section", text: "โหมดไว้ทุกข์" }),
      check("เปิดโหมดไว้ทุกข์", () => cfg.mourning, (v) => { cfg.mourning = v; }, "แสดงริบบิ้นดำที่มุมจอและปรับภาพทั้งเว็บเป็นขาวดำ"),
      h("h2", { class: "form-section", text: "ข้อความบนหน้าเว็บ" }),
      text("ข้อความแนะนำศูนย์", () => cfg.intro, (v) => { cfg.intro = v; }, { max: limit("intro"), area: true }), errBox("intro"),
      text("คำอธิบายเว็บไซต์สำหรับ Google", () => cfg.seo_description, (v) => { cfg.seo_description = v; }, { max: limit("seoDescription"), area: true, hint: "ข้อความที่แสดงใต้ชื่อเว็บในผลการค้นหาและตอนแชร์ลิงก์" }), errBox("seo_description"),
      text("อีเมลติดต่อ (ไม่บังคับ)", () => cfg.contact_email, (v) => { cfg.contact_email = v; }, { type: "email", inputmode: "email", hint: "เว้นว่าง = ไม่แสดงอีเมลบนหน้าเว็บ" }), errBox("contact_email"),
      h("h2", { class: "form-section", text: `เพจ Facebook (สูงสุด ${limit("fbPages")} เพจ แสดงเป็นแท็บสลับ)` }), fb, errBox("facebook_pages")),
    h("div", { class: "actionbar" }, h("div", { class: "actions-left" }), h("div", { class: "actions-right" }, h("span", { class: "unsaved", hidden: true }, "ยังไม่ได้บันทึก"), saveBtn)));
}

/* ═══ ประวัติการแก้ไข ═══ */
async function renderAudit() {
  const d = await load("cms-audit", { limit: "200" });
  const list = h("ul", { class: "audit-list panel" });
  for (const a of d.items || []) list.append(auditRow(a));
  if (!list.children.length) list.append(h("li", { class: "muted", text: "ยังไม่มีประวัติการแก้ไข" }));
  $("content").replaceChildren(pageHead("ประวัติการแก้ไข", "200 รายการล่าสุด — ใครแก้อะไรเมื่อไร"), list);
}

$("retryBtn")?.addEventListener("click", () => location.reload());
init().catch((e) => showState("denied", e.message || "ระบบขัดข้อง กรุณาโหลดหน้าใหม่", true));
