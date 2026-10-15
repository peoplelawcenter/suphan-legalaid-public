/* api/_cms.js — หลังบ้านจัดการเนื้อหาเว็บไซต์ (CMS) ทุก action "cms-*" ของ /api/staff (หน้า public/cms.html)
   บอสสั่ง 30 ก.ย. 69: "รื้อหน้า web ใหม่ ทำแบบ dynamic website มี banner มี social มีระบบ backend admin
   ตัวอย่าง https://www.lawyerscouncil.or.th/" — สเปกเต็ม docs/WEBSITE-SPEC.md ข้อ 5–6 · ตาราง supabase-migration-13-website-cms.sql
   เขียน 1 ต.ค. 69 (สาย B)

   มติบอส (AskUserQuestion 30 ก.ย. 69): คนแก้เว็บได้ = แอดมิน + คนที่แอดมินให้สิทธิ์ "ผู้ดูแลเว็บไซต์" (staff.can_edit_site)
   → staff.js เช็คสิทธิ์ด้วย canEditSiteNow() ก่อนส่งต่อมาที่ cmsAction() เสมอ (แบบเดียวกับ bc-* → broadcastAction)

   ⛔ กติกาเหล็กของไฟล์นี้
   - ทุกค่าที่หน้าเว็บส่งมาผ่าน normalize<Type>() (ฟังก์ชันบริสุทธิ์ — scripts/test-cms.mjs เรียกตรง) ก่อนแตะ DB
     ข้อความ = cleanText · HTML = sanitizeRichHtml (หน้าบ้านกรองซ้ำอีกชั้นตอนแสดง) · ลิงก์ = safeHref · ไฟล์ = isMediaPath
   - ค่าเกินเพดาน = 400 พร้อมบอกช่องที่ผิด (ไม่ตัดทิ้งเงียบๆ — ผู้ใช้จะงงว่าทำไมข้อความหาย)
   - path ไฟล์ออกจากเซิร์ฟเวอร์เท่านั้น (cms-upload-url) และ "ไฟล์ที่เพิ่งผูกใหม่" ต้องตรวจของจริงก่อนบันทึก:
     หัวไฟล์ 16 ไบต์ (magic bytes) ตรงนามสกุล + ขนาดจริง ≤ เพดานของช่อง — ไม่เชื่อ contentType จากเบราว์เซอร์ (แบบ inspectPoster)
   - ลบรายการ = ลบไฟล์ใน storage ของรายการนั้นแบบ best-effort โดย "ไม่ลบไฟล์ที่รายการอื่นยังใช้อยู่"
     (เจ้าหน้าที่คัดลอกเนื้อหาจากหน้าเว็บไปวางในข่าวใหม่ได้ → รูปเดียวกันถูกอ้างหลายที่ ลบตามตรงจะทำให้รูปข่าวอื่นหาย)
   - บันทึก site_audit ทุกครั้งที่แก้ข้อมูล (ใครแก้อะไรเมื่อไร — ความรับผิดชอบของเว็บหน่วยงานรัฐ)
   - ค้นหาใช้ escapeLikePattern() ก่อน ILIKE เสมอ (บทเรียน 18 ก.ย. 69 ใน _staffauth.js)
   - bucket "evidence" (หลักฐานร้องเรียน private) ห้ามเกี่ยวข้องกับไฟล์นี้เด็ดขาด — ใช้ MEDIA_BUCKET เท่านั้น */
import crypto from "node:crypto";
import { db } from "./_db.js";
import { escapeLikePattern } from "./_staffauth.js";
import { totalSizeFrom } from "./_broadcast.js";
import { sanitizeRichHtml, isBlankHtml } from "./_sanitize.js";
import {
  UPLOAD_KINDS, IMAGE_TYPES, DOC_TYPES, MEDIA_BUCKET, isMediaPath, mediaKindOf, mediaPublicBase, mediaPublicUrl,
  POST_CATEGORIES, PEOPLE_GROUPS, LINK_KINDS, SOCIAL_ICONS, LIMITS, safeHref, cleanText, isFacebookPageUrl,
  mergeSiteConfig, SITE_CONFIG_KEY, SITE_CONFIG_DEFAULTS, DEFAULT_PAGES, SYSTEM_PAGE_SLUGS, siteUrl, postPath,
} from "./_site-shared.js";

/* ═══ ชนิดเนื้อหา → ตาราง (type ที่หน้าเว็บส่งมาต้องอยู่ในชุดนี้เท่านั้น — กันยิงชื่อตารางอื่นเข้ามา) ═══ */
export const CMS_TYPES = {
  banners: { table: "site_banners", label: "แบนเนอร์", sortable: true },
  posts: { table: "site_posts", label: "ข่าว/บทความ", sortable: false },
  pages: { table: "site_pages", label: "หน้าเนื้อหา", sortable: true, key: "slug" },
  people: { table: "site_people", label: "บุคลากร", sortable: true },
  faqs: { table: "site_faqs", label: "คำถามที่พบบ่อย", sortable: true },
  docs: { table: "site_documents", label: "เอกสารดาวน์โหลด", sortable: true },
  links: { table: "site_links", label: "ลิงก์", sortable: true },
};
const keyOf = (type) => CMS_TYPES[type].key || "id";
export function titleOf(type, row) {
  const r = row || {};
  const t = { banners: r.alt_text, posts: r.title, pages: r.title, people: r.name, faqs: r.question, docs: r.title, links: r.label }[type];
  return cleanText(t, 120);
}

/* ═══ สิทธิ์ "ผู้ดูแลเว็บไซต์" (มติบอส 30 ก.ย. 69) — อ่านสดจาก DB ทุกคำขอ · ไม่มีคอลัมน์ (ยังไม่รัน migration-13) = ไม่มีสิทธิ์ ═══ */
export function canEditSiteFrom(role, flag) {
  return role === "admin" || flag === true;
}
export async function loadCanEditSiteFlag(staffId) {
  try {
    const { data, error } = await db().from("staff").select("can_edit_site").eq("id", staffId).maybeSingle();
    if (error) return false;
    return data?.can_edit_site === true;
  } catch {
    return false;
  }
}
export async function canEditSiteNow(who) {
  if (!who || !who.ok) return false;
  if (who.role === "admin") return true; // แอดมินมีสิทธิ์เสมอ ไม่ต้องอ่านคอลัมน์ (ยังใช้ได้แม้ migration-13 ยังไม่รัน)
  return canEditSiteFrom(who.role, await loadCanEditSiteFlag(who.staffId));
}
/* ช่องที่ action=staff-update (api/staff.js) ยอมให้แก้ — ชุดเดิม 6 ช่องคงพฤติกรรมเดิมทุกตัวอักษร + can_edit_site (1 ต.ค. 69)
   ⛔ ไม่ใช่แอดมิน = แก้อะไรไม่ได้เลย (ผู้ดูแลเว็บให้สิทธิ์ตัวเอง/คนอื่นไม่ได้ — มติบอส 30 ก.ย. 69 ข้อ 3) · can_edit_site รับเฉพาะ boolean */
export const STAFF_PATCH_KEYS = ["role", "active", "notify_line", "notify_email", "email", "notify_categories"];
export function pickStaffPatch(patchIn, { isAdmin = false } = {}) {
  const p = patchIn && typeof patchIn === "object" && !Array.isArray(patchIn) ? patchIn : {};
  const out = {};
  if (!isAdmin) return out;
  for (const key of STAFF_PATCH_KEYS) if (key in p) out[key] = p[key];
  if ("can_edit_site" in p) out.can_edit_site = p.can_edit_site === true;
  return out;
}
export const NEED_SITE_EDITOR = {
  ok: false, code: "need_site_editor",
  error: "บัญชีของท่านยังไม่มีสิทธิ์จัดการเว็บไซต์",
  hint: "ติดต่อผู้ดูแลระบบให้เปิดสิทธิ์ \"ผู้ดูแลเว็บไซต์\" ที่แท็บเจ้าหน้าที่ในหน้าหลังบ้าน",
};

/* ═══ ตัวช่วยตรวจข้อมูล (บริสุทธิ์) — คืน { ok, value } หรือ { ok:false, error, field } ═══ */
const bad = (field, error) => ({ ok: false, field, error });
function oneLine(v) {
  return String(v ?? "").replace(/[\r\n\t]+/g, " ");
}
function multiLine(v) {
  return String(v ?? "").replace(/\r\n?/g, "\n");
}
/* ข้อความ: ตัดอักขระควบคุมด้วย cleanText แต่ "ไม่ตัดความยาวเงียบๆ" — เกินเพดาน = แจ้งช่องที่ผิด */
function textField(v, max, field, label, { required = false, multiline = false } = {}) {
  const s = cleanText(multiline ? multiLine(v) : oneLine(v), max + 1);
  if (!s) return required ? bad(field, `กรุณากรอก${label}`) : { ok: true, value: null };
  if (s.length > max) return bad(field, `${label}ยาวเกิน ${max.toLocaleString("en-US")} ตัวอักษร`);
  return { ok: true, value: s };
}
function htmlField(v, max, field, label, { required = false } = {}) {
  const raw = String(v ?? "");
  if (raw.length > max * 2) return bad(field, `${label}ยาวเกินกำหนด`); // กันส่งก้อนใหญ่มากเข้าตัวกรอง
  const html = sanitizeRichHtml(raw);
  if (isBlankHtml(html)) return required ? bad(field, `กรุณากรอก${label}`) : { ok: true, value: "" };
  if (html.length > max) return bad(field, `${label}ยาวเกินกำหนด (${html.length.toLocaleString("en-US")}/${max.toLocaleString("en-US")} ตัวอักษรรวมรูปแบบ)`);
  return { ok: true, value: html };
}
function urlField(v, field, label, { required = false, absolute = false } = {}) {
  const raw = String(v ?? "").trim();
  if (!raw) return required ? bad(field, `กรุณากรอก${label}`) : { ok: true, value: null };
  const href = safeHref(raw, { allowRelative: !absolute });
  if (!href) {
    return bad(field, absolute
      ? `${label}ไม่ถูกต้อง — ใส่ลิงก์เต็มที่ขึ้นต้นด้วย https://`
      : `${label}ไม่ถูกต้อง — ใส่ลิงก์เต็มที่ขึ้นต้นด้วย https:// หรือหน้าในเว็บที่ขึ้นต้นด้วย /`);
  }
  return { ok: true, value: href };
}
export function dateField(v, field, label) {
  const raw = String(v ?? "").trim();
  if (!raw) return { ok: true, value: null };
  const explicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  let normalized = raw;
  if (!explicitZone && /^\d{4}-\d{2}-\d{2}$/.test(raw)) normalized = `${raw}T00:00:00+07:00`;
  else if (!explicitZone && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(raw)) {
    normalized = `${raw.length === 16 ? `${raw}:00` : raw}+07:00`;
  }
  const t = Date.parse(normalized);
  if (!Number.isFinite(t)) return bad(field, `${label}ไม่ถูกต้อง`);
  // Validate the calendar year entered by the editor. Thailand midnight can
  // fall on the previous UTC date after conversion.
  const inputYear = /^(\d{4})-/.exec(raw)?.[1];
  const y = inputYear ? Number(inputYear) : new Date(t).getUTCFullYear();
  if (y < 2000 || y > 2100) return bad(field, `${label}ไม่ถูกต้อง (ปี ค.ศ. ${y})`);
  return { ok: true, value: new Date(t).toISOString() };
}
function boolField(v, def) {
  return typeof v === "boolean" ? v : def;
}
function dimField(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : null;
}
function pathField(v, kinds, field, label, { required = false } = {}) {
  const p = String(v ?? "").trim();
  if (!p) return required ? bad(field, `กรุณาอัปโหลด${label}`) : { ok: true, value: null };
  if (!isMediaPath(p, kinds)) return bad(field, `ไฟล์${label}ไม่ถูกต้อง กรุณาอัปโหลดใหม่`);
  return { ok: true, value: p };
}
export function parseId(v) {
  const n = typeof v === "number" ? v : /^\d{1,15}$/.test(String(v ?? "").trim()) ? Number(String(v).trim()) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export function isValidSlug(s) {
  const v = String(s ?? "");
  return v.length >= 2 && v.length <= 40 && SLUG_RE.test(v);
}

/* รวมผลตรวจหลายช่อง: ช่องแรกที่ผิดหยุดทันที (ข้อความเดียว ชัดเจน) */
function collect(spec) {
  const row = {};
  for (const [key, res] of Object.entries(spec)) {
    if (!res.ok) return res;
    row[key] = res.value;
  }
  return { ok: true, row };
}
function obj(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

/* ═══ normalizer ต่อชนิด (export ให้ test-cms.mjs) — คืน { ok:true, row } เฉพาะคอลัมน์ที่หน้าเว็บแก้ได้
   (id / sort_order / created_by / updated_by / เวลา เซิร์ฟเวอร์เป็นคนใส่เอง ไม่รับจากหน้าเว็บ) ═══ */
export function normalizeBanner(input) {
  const it = obj(input);
  const r = collect({
    alt_text: textField(it.alt_text, LIMITS.alt, "alt_text", "คำอธิบายรูป", { required: true }),
    caption: textField(it.caption, LIMITS.caption, "caption", "ข้อความบนแบนเนอร์"),
    image_path: pathField(it.image_path, "banner", "image_path", "รูปแบนเนอร์", { required: true }),
    mobile_image_path: pathField(it.mobile_image_path, "banner", "mobile_image_path", "รูปสำหรับมือถือ"),
    link_url: urlField(it.link_url, "link_url", "ลิงก์เมื่อกดแบนเนอร์"),
    starts_at: dateField(it.starts_at, "starts_at", "วันเวลาเริ่มแสดง"),
    ends_at: dateField(it.ends_at, "ends_at", "วันเวลาสิ้นสุด"),
  });
  if (!r.ok) return r;
  if (r.row.starts_at && r.row.ends_at && Date.parse(r.row.ends_at) <= Date.parse(r.row.starts_at)) {
    return bad("ends_at", "วันเวลาสิ้นสุดต้องหลังวันเวลาเริ่มแสดง");
  }
  r.row.image_w = dimField(it.image_w);
  r.row.image_h = dimField(it.image_h);
  r.row.active = boolField(it.active, true);
  return r;
}

function normalizeGallery(list) {
  if (list == null) return { ok: true, value: [] };
  if (!Array.isArray(list)) return bad("gallery", "ข้อมูลแกลเลอรีไม่ถูกต้อง");
  if (list.length > LIMITS.gallery) return bad("gallery", `แกลเลอรีมีได้ไม่เกิน ${LIMITS.gallery} รูป`);
  const out = [];
  const seen = new Set();
  for (const [i, g0] of list.entries()) {
    const g = obj(g0);
    const n = ` (รูปที่ ${i + 1})`;
    const p = pathField(g.path, "gallery", "gallery", "รูปในแกลเลอรี" + n, { required: true });
    if (!p.ok) return p;
    if (seen.has(p.value)) continue;
    seen.add(p.value);
    const t = pathField(g.thumb_path, "gallery", "gallery", "รูปย่อในแกลเลอรี" + n);
    if (!t.ok) return t;
    const alt = textField(g.alt, LIMITS.alt, "gallery", "คำอธิบายรูป" + n);
    if (!alt.ok) return alt;
    out.push({ path: p.value, thumb_path: t.value, alt: alt.value || "", w: dimField(g.w), h: dimField(g.h) });
  }
  return { ok: true, value: out };
}
function normalizeAttachments(list) {
  if (list == null) return { ok: true, value: [] };
  if (!Array.isArray(list)) return bad("attachments", "ข้อมูลไฟล์แนบไม่ถูกต้อง");
  if (list.length > LIMITS.attachments) return bad("attachments", `ไฟล์แนบมีได้ไม่เกิน ${LIMITS.attachments} ไฟล์`);
  const out = [];
  const seen = new Set();
  for (const [i, a0] of list.entries()) {
    const a = obj(a0);
    const n = ` (ไฟล์ที่ ${i + 1})`;
    const p = pathField(a.path, "attachment", "attachments", "ไฟล์แนบ" + n, { required: true });
    if (!p.ok) return p;
    if (seen.has(p.value)) continue;
    seen.add(p.value);
    const name = textField(a.name, LIMITS.fileName, "attachments", "ชื่อไฟล์แนบ" + n);
    if (!name.ok) return name;
    const size = Number(a.size);
    out.push({
      path: p.value, name: name.value || `เอกสารแนบ ${i + 1}.pdf`,
      size: Number.isSafeInteger(size) && size >= 0 ? size : null, type: "application/pdf",
    });
  }
  return { ok: true, value: out };
}

export function normalizePost(input, { now = new Date() } = {}) {
  const it = obj(input);
  const category = String(it.category ?? "");
  if (!POST_CATEGORIES.some((c) => c.key === category)) return bad("category", "กรุณาเลือกหมวดหมู่");
  const status = it.status === "published" ? "published" : it.status === "draft" || it.status == null ? "draft" : null;
  if (!status) return bad("status", "สถานะไม่ถูกต้อง");
  const r = collect({
    title: textField(it.title, LIMITS.title, "title", "หัวเรื่อง", { required: true }),
    excerpt: textField(it.excerpt, LIMITS.excerpt, "excerpt", "คำโปรย", { multiline: true }),
    body_html: htmlField(it.body_html, LIMITS.bodyHtml, "body_html", "เนื้อหา"),
    cover_path: pathField(it.cover_path, "cover", "cover_path", "รูปปก"),
    cover_thumb_path: pathField(it.cover_thumb_path, "cover", "cover_path", "รูปย่อของรูปปก"),
    cover_alt: textField(it.cover_alt, LIMITS.alt, "cover_alt", "คำอธิบายรูปปก"),
    gallery: normalizeGallery(it.gallery),
    attachments: normalizeAttachments(it.attachments),
    published_at: dateField(it.published_at, "published_at", "วันเวลาเผยแพร่"),
  });
  if (!r.ok) return r;
  const row = r.row;
  row.category = category;
  row.status = status;
  row.pinned = boolField(it.pinned, false);
  if (row.cover_path) {
    row.cover_w = dimField(it.cover_w);
    row.cover_h = dimField(it.cover_h);
    row.cover_alt = row.cover_alt || cleanText(row.title, LIMITS.alt); // สเปก 5.3: คำอธิบายรูปปกว่าง = ใช้หัวเรื่อง
  } else {
    Object.assign(row, { cover_thumb_path: null, cover_w: null, cover_h: null, cover_alt: null });
  }
  // เผยแพร่ครั้งแรกโดยไม่ระบุเวลา = เผยแพร่ทันที (ระบุเวลาอนาคต = ตั้งเวลาเผยแพร่)
  if (status === "published" && !row.published_at) row.published_at = now.toISOString();
  return { ok: true, row };
}

export function normalizePage(input) {
  const it = obj(input);
  const slug = String(it.slug ?? "").trim().toLowerCase();
  if (!isValidSlug(slug)) return bad("slug", "ชื่อลิงก์ของหน้าใช้ได้เฉพาะ a-z 0-9 และขีด (-) ยาว 2–40 ตัว เช่น service-area");
  const r = collect({
    title: textField(it.title, LIMITS.pageTitle, "title", "ชื่อหน้า", { required: true }),
    body_html: htmlField(it.body_html, LIMITS.bodyHtml, "body_html", "เนื้อหา"),
  });
  if (!r.ok) return r;
  r.row.slug = slug;
  r.row.show_in_menu = boolField(it.show_in_menu, false);
  r.row.published = boolField(it.published, true);
  return r;
}

/* แก้หน้าเดิมห้ามเปลี่ยน slug (5 ต.ค. 69 — กันเขียนทับหน้าอื่น) · คืนข้อความ error ภาษาไทย หรือ null ถ้าผ่าน
   สร้างใหม่ไม่ต้องมี originalSlug (slug ซ้ำของเดิม → 409 ด้านล่างหลังอ่านฐานข้อมูล) */
export function pageSlugChangeError({ isNew, slug, originalSlug }) {
  if (isNew) return null;
  const orig = String(originalSlug ?? "").trim().toLowerCase();
  if (!orig) return "ไม่สามารถบันทึกได้ กรุณาโหลดหน้าจัดการเว็บไซต์ใหม่แล้วลองอีกครั้ง";
  if (orig !== slug) return "ไม่สามารถเปลี่ยนชื่อลิงก์ของหน้าที่สร้างแล้วได้ หากต้องการลิงก์ใหม่ กรุณาสร้างหน้าใหม่";
  return null;
}

export function normalizePerson(input) {
  const it = obj(input);
  const group = String(it.group_key ?? "");
  if (!PEOPLE_GROUPS.some((g) => g.key === group)) return bad("group_key", "กรุณาเลือกกลุ่มบุคลากร");
  const r = collect({
    name: textField(it.name, LIMITS.personName, "name", "ชื่อ-นามสกุล", { required: true }),
    position: textField(it.position, LIMITS.position, "position", "ตำแหน่ง"),
    organization: textField(it.organization, LIMITS.organization, "organization", "หน่วยงาน"),
    photo_path: pathField(it.photo_path, "person", "photo_path", "รูปบุคคล"),
    photo_thumb_path: pathField(it.photo_thumb_path, "person", "photo_path", "รูปย่อของรูปบุคคล"),
    bio: textField(it.bio, LIMITS.bio, "bio", "ประวัติย่อ", { multiline: true }),
  });
  if (!r.ok) return r;
  if (!r.row.photo_path) r.row.photo_thumb_path = null;
  r.row.group_key = group;
  r.row.show_on_home = boolField(it.show_on_home, false);
  r.row.active = boolField(it.active, true);
  return r;
}

export function normalizeFaq(input) {
  const it = obj(input);
  const r = collect({
    question: textField(it.question, LIMITS.question, "question", "คำถาม", { required: true }),
    answer_html: htmlField(it.answer_html, LIMITS.faqAnswerHtml, "answer_html", "คำตอบ", { required: true }),
    category: textField(it.category, LIMITS.category, "category", "หมวดคำถาม"),
  });
  if (!r.ok) return r;
  r.row.active = boolField(it.active, true);
  return r;
}

export function normalizeDoc(input) {
  const it = obj(input);
  const r = collect({
    title: textField(it.title, LIMITS.docTitle, "title", "ชื่อเอกสาร", { required: true }),
    description: textField(it.description, LIMITS.docDescription, "description", "คำอธิบาย", { multiline: true }),
    category: textField(it.category, LIMITS.category, "category", "หมวดเอกสาร"),
    file_path: pathField(it.file_path, "doc", "file_path", "ไฟล์เอกสาร", { required: true }),
    file_name: textField(it.file_name, LIMITS.fileName, "file_name", "ชื่อไฟล์"),
    published_at: dateField(it.published_at, "published_at", "วันที่เผยแพร่"),
  });
  if (!r.ok) return r;
  const type = String(it.file_type ?? "");
  const ext = r.row.file_path.split(".").pop();
  if (!(type in DOC_TYPES)) return bad("file_path", "ชนิดไฟล์ไม่รองรับ — ใช้ได้เฉพาะ PDF / Word / Excel");
  if (DOC_TYPES[type] !== ext) return bad("file_path", "ชนิดไฟล์ไม่ตรงกับไฟล์ที่อัปโหลด กรุณาอัปโหลดใหม่");
  r.row.file_type = type;
  const size = Number(it.file_size);
  r.row.file_size = Number.isSafeInteger(size) && size >= 0 ? size : null;
  r.row.file_name = r.row.file_name || `${cleanText(r.row.title, 150)}.${ext}`;
  r.row.active = boolField(it.active, true);
  return r;
}

export function normalizeLinkItem(input) {
  const it = obj(input);
  const kind = String(it.kind ?? "");
  if (!LINK_KINDS.some((k) => k.key === kind)) return bad("kind", "กรุณาเลือกชนิดลิงก์");
  const r = collect({
    label: textField(it.label, LIMITS.linkLabel, "label", "ชื่อที่แสดง", { required: true }),
    url: urlField(it.url, "url", "ลิงก์", { required: true, absolute: true }),
  });
  if (!r.ok) return r;
  r.row.kind = kind;
  if (kind === "social") {
    const icon = String(it.icon ?? "");
    if (!SOCIAL_ICONS.some((s) => s.key === icon)) return bad("icon", "กรุณาเลือกไอคอนโซเชียล");
    r.row.icon = icon;
    r.row.logo_path = null;
  } else {
    const logo = pathField(it.logo_path, "logo", "logo_path", "โลโก้");
    if (!logo.ok) return logo;
    r.row.icon = null;
    r.row.logo_path = logo.value;
  }
  r.row.active = boolField(it.active, true);
  return r;
}

export const NORMALIZERS = {
  banners: normalizeBanner, posts: normalizePost, pages: normalizePage, people: normalizePerson,
  faqs: normalizeFaq, docs: normalizeDoc, links: normalizeLinkItem,
};

/* ═══ ตั้งค่าเว็บไซต์ — mergeSiteConfig() ทิ้งค่าเสียเงียบๆ (ถูกสำหรับฝั่งแสดงผล) แต่ตอนบันทึกต้องบอกผู้ใช้ว่าช่องไหนผิด ═══ */
export function validateSiteConfigInput(raw) {
  const r = obj(raw);
  const pages = Array.isArray(r.facebook_pages) ? r.facebook_pages : [];
  if (pages.length > LIMITS.fbPages) return bad("facebook_pages", `เพจ Facebook ใส่ได้ไม่เกิน ${LIMITS.fbPages} เพจ`);
  for (const [i, p] of pages.entries()) {
    const url = String(obj(p).url ?? "").trim();
    const label = textField(obj(p).label, LIMITS.linkLabel, "facebook_pages", `ชื่อเพจ Facebook ช่องที่ ${i + 1}`);
    if (!label.ok) return label;
    if (url && !isFacebookPageUrl(url)) {
      return bad("facebook_pages", `ลิงก์เพจ Facebook ช่องที่ ${i + 1} ไม่ถูกต้อง — ใช้ลิงก์เพจ เช่น https://www.facebook.com/ชื่อเพจ หรือ https://www.facebook.com/profile.php?id=ตัวเลข`);
    }
  }
  const n = obj(r.notice);
  const text = textField(n.text, LIMITS.noticeText, "notice", "ข้อความแถบประกาศด่วน");
  if (!text.ok) return text;
  if (n.enabled === true && !text.value) return bad("notice", "เปิดแถบประกาศด่วนแล้ว กรุณากรอกข้อความประกาศ");
  const link = urlField(n.link, "notice", "ลิงก์ของแถบประกาศด่วน");
  if (!link.ok) return link;
  const intro = textField(r.intro, LIMITS.intro, "intro", "ข้อความแนะนำศูนย์");
  if (!intro.ok) return intro;
  const seo = textField(r.seo_description, LIMITS.seoDescription, "seo_description", "คำอธิบายเว็บไซต์สำหรับ Google");
  if (!seo.ok) return seo;
  const email = String(r.contact_email ?? "").trim();
  if (email && email.length > 120) return bad("contact_email", "อีเมลยาวเกิน 120 ตัวอักษร");
  const merged = mergeSiteConfig(r);
  if (email && merged.contact_email !== email) return bad("contact_email", "อีเมลติดต่อไม่ถูกต้อง");
  return { ok: true, config: merged };
}

/* ═══ ไฟล์: path ใหม่ · ตรวจหัวไฟล์ · หา path ที่รายการอ้างถึง ═══ */
export function bkkYearMonth(ms) {
  const d = new Date(ms + 7 * 3600 * 1000); // เวลาไทย (ไม่มี DST) — โฟลเดอร์รายเดือนตามปฏิทินไทย ไม่ใช่ UTC
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function buildMediaPath(kind, contentType, variant = "main", { now = Date.now(), rand } = {}) {
  const k = UPLOAD_KINDS[kind];
  if (!k) return bad("kind", "ชนิดไฟล์ไม่ถูกต้อง");
  const ext = k.types[String(contentType || "").toLowerCase()];
  if (!ext) return bad("contentType", `${k.label}รองรับเฉพาะ ${[...new Set(Object.values(k.types))].map((e) => e.toUpperCase()).join(" / ")}`);
  if (variant !== "main" && variant !== "thumb") return bad("variant", "ชนิดไฟล์ไม่ถูกต้อง");
  if (variant === "thumb" && !(contentType in IMAGE_TYPES)) return bad("variant", "รูปย่อใช้ได้กับรูปภาพเท่านั้น");
  const hex = rand || crypto.randomBytes(8).toString("hex");
  const path = `site/${kind}/${bkkYearMonth(now)}/${now}-${hex}${variant === "thumb" ? "-t" : ""}.${ext}`;
  if (!isMediaPath(path, kind)) return bad("kind", "สร้างชื่อไฟล์ไม่สำเร็จ");
  return { ok: true, path };
}

/* หัวไฟล์จริง → ชนิด (ไม่เชื่อ contentType/นามสกุลจากเบราว์เซอร์) */
export function sniffMedia(bytes) {
  const b = bytes || [];
  const at = (i, arr) => arr.every((v, j) => b[i + j] === v);
  if (b.length >= 3 && at(0, [0xff, 0xd8, 0xff])) return "jpg";
  if (b.length >= 8 && at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (b.length >= 12 && at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "webp";
  if (b.length >= 5 && at(0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (b.length >= 4 && at(0, [0x50, 0x4b, 0x03, 0x04])) return "zip";   // docx / xlsx (Office Open XML = zip)
  if (b.length >= 8 && at(0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole"; // doc / xls รุ่นเก่า
  return null;
}
const EXT_SIG = { jpg: "jpg", png: "png", webp: "webp", pdf: "pdf", docx: "zip", xlsx: "zip", doc: "ole", xls: "ole" };
/* ตัดสินจากหัวไฟล์ + ขนาดจริง (บริสุทธิ์ — เทสต์ได้) */
export function checkMediaHead(path, head, size) {
  const kind = mediaKindOf(path);
  if (!kind || !isMediaPath(path)) return { ok: false, error: "ไฟล์ไม่ถูกต้อง กรุณาอัปโหลดใหม่" };
  const ext = String(path).split(".").pop();
  const label = UPLOAD_KINDS[kind].label;
  const sig = sniffMedia(head);
  if (!sig || sig !== EXT_SIG[ext]) return { ok: false, error: `${label}ที่อัปโหลดไม่ใช่ไฟล์ ${ext.toUpperCase()} จริง กรุณาเลือกไฟล์ใหม่` };
  if (size != null) {
    if (!(size > 0)) return { ok: false, error: `${label}ที่อัปโหลดเป็นไฟล์ว่าง กรุณาเลือกไฟล์ใหม่` };
    const max = UPLOAD_KINDS[kind].maxBytes;
    if (size > max) return { ok: false, error: `${label}ใหญ่เกิน ${Math.round(max / 1048576)} MB` };
  }
  return { ok: true, size: size ?? null, ext };
}
async function readHead16(res) {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, 16);
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  while (got < 16) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    got += value.length;
  }
  reader.cancel().catch(() => {}); // เซิร์ฟเวอร์ไม่สน Range แล้วส่งมาทั้งไฟล์ = ตัดทิ้งหลังได้ 16 ไบต์แรก
  const out = new Uint8Array(Math.min(16, got));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - off);
    out.set(c.subarray(0, take), off);
    off += take;
    if (off >= out.length) break;
  }
  return out;
}
/* ขอแค่ 16 ไบต์แรกจาก public URL (ไม่โหลดทั้งไฟล์ 10MB เข้า function) ขนาดรวมอ่านจาก Content-Range — แบบ inspectPoster() */
export async function inspectMedia(path) {
  if (!isMediaPath(path)) return { ok: false, error: "ไฟล์ไม่ถูกต้อง กรุณาอัปโหลดใหม่" };
  let res;
  try {
    res = await fetch(mediaPublicUrl(path), { headers: { Range: "bytes=0-15" }, signal: AbortSignal.timeout(8000) });
  } catch {
    return { ok: false, error: "ตรวจไฟล์ที่อัปโหลดไม่สำเร็จ กรุณาลองบันทึกอีกครั้ง" };
  }
  if (res.status !== 206 && res.status !== 200) {
    res.body?.cancel().catch(() => {});
    return { ok: false, error: `ไม่พบไฟล์ที่อัปโหลดไว้ (HTTP ${res.status}) กรุณาอัปโหลดใหม่` };
  }
  const size = totalSizeFrom(res.status, res.headers.get("content-range"), res.headers.get("content-length"));
  return checkMediaHead(path, await readHead16(res), size);
}

/* รูปในเนื้อหา HTML ที่ชี้มาที่ bucket ของเรา → path (ใช้ตรวจของใหม่ + หาไฟล์ที่ต้องลบ) */
export function inlineMediaPaths(html) {
  const base = mediaPublicBase();
  const out = new Set();
  const re = /<img\b[^>]*?\ssrc\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const src = (m[2] ?? m[3] ?? "").replace(/&amp;/g, "&").trim();
    if (base && src.startsWith(base)) out.add(src.slice(base.length).split(/[?#]/)[0]);
  }
  return [...out];
}
/* ทุก path ไฟล์ที่แถวนี้อ้างถึง (คอลัมน์ไฟล์ + รูปในเนื้อหา) */
export function mediaPathsOf(type, row) {
  const r = row || {};
  const list = [];
  const add = (p) => { if (p) list.push(String(p)); };
  if (type === "banners") { add(r.image_path); add(r.mobile_image_path); }
  if (type === "posts") {
    add(r.cover_path); add(r.cover_thumb_path);
    for (const g of Array.isArray(r.gallery) ? r.gallery : []) { add(g?.path); add(g?.thumb_path); }
    for (const a of Array.isArray(r.attachments) ? r.attachments : []) add(a?.path);
    inlineMediaPaths(r.body_html).forEach(add);
  }
  if (type === "pages") inlineMediaPaths(r.body_html).forEach(add);
  if (type === "faqs") inlineMediaPaths(r.answer_html).forEach(add);
  if (type === "people") { add(r.photo_path); add(r.photo_thumb_path); }
  if (type === "docs") add(r.file_path);
  if (type === "links") add(r.logo_path);
  return [...new Set(list)];
}
const IMAGE_KINDS = Object.keys(UPLOAD_KINDS).filter((k) => Object.keys(UPLOAD_KINDS[k].types).every((t) => t in IMAGE_TYPES));

/* ═══ ตัวช่วย DB ═══ */
function dbFail(e, what) {
  const code = String(e?.code || "");
  const msg = String(e?.message || e || "");
  if (code === "42P01" || code === "PGRST205" || /relation .* does not exist|Could not find the table/i.test(msg)) {
    return new Error("ยังไม่ได้สร้างตารางของเว็บไซต์ในฐานข้อมูล (supabase-migration-13-website-cms.sql)");
  }
  if (code === "23514" || code === "23502") return new Error(`${what}ไม่สำเร็จ: ข้อมูลบางช่องไม่ผ่านเงื่อนไขของฐานข้อมูล กรุณาตรวจแล้วลองใหม่`);
  return new Error(`${what}ไม่สำเร็จ: ${msg || "ระบบขัดข้องชั่วคราว"}`);
}
async function run(builder, what) {
  const { data, error, count } = await builder;
  if (error) throw dbFail(error, what);
  return { data, count };
}
async function staffNames(ids) {
  const uniq = [...new Set(ids.filter((x) => x != null))];
  if (!uniq.length) return {};
  const { data } = await db().from("staff").select("id,display_name").in("id", uniq);
  return Object.fromEntries((data || []).map((s) => [s.id, s.display_name || `เจ้าหน้าที่ #${s.id}`]));
}
async function atomicRpc(name, args, what) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw dbFail(error, `${what} (ต้องรัน supabase-migration-15-idempotency-and-cms-transactions.sql)`);
  return data;
}
const ok = (body, status = 200) => ({ status, body: { ok: true, ...body } });
const fail = (status, error, extra) => ({ status, body: { ok: false, error, ...(extra || {}) } });
function qget(query, k) {
  if (!query) return null;
  if (typeof query.get === "function") return query.get(k);
  return query[k] ?? null;
}

let bucketChecked = false;
async function ensureMediaBucket() {
  if (bucketChecked) return;
  const { data, error } = await db().storage.getBucket(MEDIA_BUCKET);
  if (error || !data) throw new Error(`ยังไม่มีที่เก็บไฟล์ "${MEDIA_BUCKET}" (supabase-migration-13-website-cms.sql)`);
  // ⛔ ไม่แก้เป็น public ให้เอง (แบบ ensurePosterBucket) — ให้คนตัดสินที่ Supabase
  if (!data.public) throw new Error(`ที่เก็บไฟล์ "${MEDIA_BUCKET}" ตั้งเป็น private อยู่ รูปบนเว็บจะไม่แสดง — เปลี่ยนเป็น public ที่ Supabase > Storage ก่อน`);
  bucketChecked = true;
}

/* ตรวจไฟล์ที่ "เพิ่งผูกใหม่" ทุกไฟล์ (ไม่ตรวจซ้ำไฟล์เดิมของแถว) — คืนขนาดจริงไว้ใช้แทนค่าที่หน้าเว็บส่งมา */
async function verifyNewMedia(type, row, oldRow) {
  const before = new Set(oldRow ? mediaPathsOf(type, oldRow) : []);
  const fresh = mediaPathsOf(type, row).filter((p) => !before.has(p));
  const inline = new Set(inlineMediaPaths(type === "faqs" ? row.answer_html : row.body_html));
  for (const p of fresh) {
    if (inline.has(p) && !isMediaPath(p, IMAGE_KINDS)) return { ok: false, error: "รูปในเนื้อหามีรูปที่ไม่ได้อัปโหลดผ่านระบบ กรุณาลบแล้วใช้ปุ่มแทรกรูปของตัวแก้ข้อความ" };
  }
  if (fresh.length > 80) return { ok: false, error: "แนบไฟล์ใหม่มากเกินไปในครั้งเดียว กรุณาบันทึกเป็นช่วงๆ" };
  const sizes = {};
  for (let i = 0; i < fresh.length; i += 8) {
    const part = fresh.slice(i, i + 8);
    const res = await Promise.all(part.map((p) => inspectMedia(p)));
    for (const [j, r] of res.entries()) {
      if (!r.ok) return r;
      sizes[part[j]] = r.size;
    }
  }
  return { ok: true, sizes };
}

/* ไฟล์ที่ยังถูกอ้างจากรายการอื่น (ห้ามลบ) — คอลัมน์ไฟล์ตรวจในหน่วยความจำ · เนื้อหา HTML ตรวจด้วย LIKE ชื่อไฟล์
   (ชื่อไฟล์มีแค่ตัวเลข/a-f/ขีด/จุด ตามรูปแบบ isMediaPath จึงไม่มีอักขระพิเศษของ LIKE/ตัวคั่นของ PostgREST) */
const PATH_COLS = {
  banners: "id,image_path,mobile_image_path", posts: "id,cover_path,cover_thumb_path,gallery,attachments",
  people: "id,photo_path,photo_thumb_path", docs: "id,file_path", links: "id,logo_path",
};
const HTML_COLS = { posts: "body_html", pages: "body_html", faqs: "answer_html" };
async function referencedElsewhere(paths, exclType, exclKey) {
  const want = new Set(paths);
  const used = new Set();
  const isSelf = (type, row) => type === exclType && String(row[keyOf(type)]) === String(exclKey);
  for (const [type, cols] of Object.entries(PATH_COLS)) {
    const { data, error } = await db().from(CMS_TYPES[type].table).select(cols).limit(20000);
    if (error) throw error;
    for (const row of data || []) {
      if (isSelf(type, row)) continue;
      for (const p of mediaPathsOf(type, row)) if (want.has(p)) used.add(p);
    }
  }
  const names = paths.map((p) => [p, p.split("/").pop()]);
  for (const [type, col] of Object.entries(HTML_COLS)) {
    const key = keyOf(type);
    for (let i = 0; i < names.length; i += 20) {
      const part = names.slice(i, i + 20);
      const { data, error } = await db().from(CMS_TYPES[type].table).select(`${key},${col}`)
        .or(part.map(([, n]) => `${col}.like.*${n}*`).join(","));
      if (error) throw error;
      for (const row of data || []) {
        if (isSelf(type, row)) continue;
        for (const [p, n] of part) if (String(row[col] || "").includes(n)) used.add(p);
      }
    }
  }
  return used;
}
async function removeMediaOf(type, row) {
  try {
    const paths = mediaPathsOf(type, row).filter((p) => isMediaPath(p));
    if (!paths.length) return { removed: 0, kept: 0 };
    const used = await referencedElsewhere(paths, type, row[keyOf(type)]);
    const del = paths.filter((p) => !used.has(p));
    if (del.length) {
      const { error } = await db().storage.from(MEDIA_BUCKET).remove(del);
      if (error) throw error;
    }
    return { removed: del.length, kept: used.size };
  } catch (e) {
    console.error("ลบไฟล์ของรายการที่ลบไม่สำเร็จ (ไม่กระทบการลบรายการ)", e?.message || e);
    return { removed: 0, kept: 0, failed: true };
  }
}

async function nextSortOrder(type, extraFilter) {
  let qb = db().from(CMS_TYPES[type].table).select("sort_order").order("sort_order", { ascending: false }).limit(1);
  if (extraFilter) qb = extraFilter(qb);
  const { data } = await qb;
  const max = Number(data?.[0]?.sort_order);
  return (Number.isFinite(max) ? max : 0) + 10;
}

/* ═══ เผยแพร่อยู่จริงไหม (ภาพรวม) — กติกาเดียวกับหน้าบ้านข้อ 4.2 ═══ */
export function postState(p, now = Date.now()) {
  if (p.status !== "published") return "draft";
  if (!p.published_at) return "draft";
  return Date.parse(p.published_at) > now ? "scheduled" : "published";
}
export function bannerState(b, now = Date.now()) {
  if (!b.active) return "off";
  if (b.starts_at && Date.parse(b.starts_at) > now) return "scheduled";
  if (b.ends_at && Date.parse(b.ends_at) <= now) return "expired";
  return "showing";
}

/* ═══ เรียงลำดับ — ตรวจรายการ id (บริสุทธิ์) ═══ */
export function normalizeReorder(type, ids) {
  if (!CMS_TYPES[type]?.sortable) return bad("type", "เนื้อหาชนิดนี้จัดลำดับไม่ได้");
  if (!Array.isArray(ids) || !ids.length) return bad("ids", "ไม่มีรายการที่จะจัดลำดับ");
  if (ids.length > 500) return bad("ids", "รายการมากเกินไป");
  const out = [];
  for (const v of ids) {
    const k = type === "pages" ? (isValidSlug(v) ? String(v) : null) : parseId(v);
    if (k == null) return bad("ids", "รายการที่จะจัดลำดับไม่ถูกต้อง");
    out.push(k);
  }
  if (new Set(out.map(String)).size !== out.length) return bad("ids", "รายการซ้ำกัน");
  return { ok: true, ids: out, orders: out.map((k, i) => ({ key: k, sort_order: (i + 1) * 10 })) };
}

/* ═══ meta (ข้อมูลประกอบฟอร์ม) — ไม่แตะข้อมูลส่วนบุคคล ═══ */
export function cmsMeta(who) {
  const uploadKinds = Object.fromEntries(Object.entries(UPLOAD_KINDS).map(([k, v]) => [k, {
    label: v.label, hint: v.hint, maxBytes: v.maxBytes, types: Object.keys(v.types), exts: [...new Set(Object.values(v.types))],
  }]));
  return {
    categories: POST_CATEGORIES, peopleGroups: PEOPLE_GROUPS, linkKinds: LINK_KINDS, socialIcons: SOCIAL_ICONS,
    limits: LIMITS, uploadKinds, docTypes: DOC_TYPES,
    systemPages: SYSTEM_PAGE_SLUGS.map((s) => ({ slug: s, title: DEFAULT_PAGES[s].title })),
    siteConfigDefaults: SITE_CONFIG_DEFAULTS, mediaBase: mediaPublicBase(), siteUrl: siteUrl(),
    me: { canEditSite: true, role: who.role, displayName: who.displayName || null },
  };
}

const POST_LIST_COLS = "id,category,title,excerpt,cover_path,cover_thumb_path,status,pinned,published_at,created_at,updated_at,author_staff_id,updated_by";
const PAGE_LIST_COLS = "slug,title,show_in_menu,sort_order,published,updated_at,updated_by";

function pageView(row, isDefault) {
  return { ...row, isSystem: SYSTEM_PAGE_SLUGS.includes(row.slug), isDefault: !!isDefault };
}
function defaultPage(slug) {
  const d = DEFAULT_PAGES[slug];
  return d ? pageView({ ...d, updated_at: null, updated_by: null }, true) : null;
}

/* ═══ action ทั้งหมด (staff.js ส่งต่อมาหลังเช็ค canEditSiteNow แล้ว) — คืน { status, body } ไม่แตะ req/res ═══ */
export async function cmsAction(action, method, body, who, query) {
  const b = obj(body);
  const type = String((method === "GET" ? qget(query, "type") : b.type) || "");
  const needType = () => (CMS_TYPES[type] ? null : fail(400, "ไม่รู้จักชนิดเนื้อหานี้"));

  if (action === "cms-meta" && method === "GET") {
    let tablesReady = true;
    try {
      const { error } = await db().from("site_posts").select("id").limit(1);
      if (error) tablesReady = false;
    } catch { tablesReady = false; }
    return ok({ ...cmsMeta(who), tablesReady });
  }

  if (action === "cms-overview" && method === "GET") {
    const now = Date.now();
    const T = (t) => db().from(CMS_TYPES[t].table);
    const [banners, posts, pages, people, faqs, docs, links, recent, audit] = await Promise.all([
      run(T("banners").select("id,active,starts_at,ends_at").limit(5000), "อ่านแบนเนอร์"),
      run(T("posts").select("id,category,status,published_at").limit(20000), "อ่านข่าว"),
      run(T("pages").select("slug,published").limit(500), "อ่านหน้าเนื้อหา"),
      run(T("people").select("id,group_key,active").limit(5000), "อ่านบุคลากร"),
      run(T("faqs").select("id,active").limit(5000), "อ่านคำถามที่พบบ่อย"),
      run(T("docs").select("id,active").limit(5000), "อ่านเอกสาร"),
      run(T("links").select("id,kind,active").limit(5000), "อ่านลิงก์"),
      run(T("posts").select("id,category,title,status,published_at,updated_at").order("updated_at", { ascending: false }).limit(5), "อ่านข่าวล่าสุด"),
      run(db().from("site_audit").select("id,staff_id,action,item_type,item_id,summary,at").order("at", { ascending: false }).limit(10), "อ่านประวัติ"),
    ]);
    const postCounts = Object.fromEntries(POST_CATEGORIES.map((c) => [c.key, { total: 0, published: 0, draft: 0, scheduled: 0 }]));
    for (const p of posts.data || []) {
      const c = postCounts[p.category];
      if (!c) continue;
      c.total++;
      c[postState(p, now)]++;
    }
    const pageRows = pages.data || [];
    const pageSlugs = new Set(pageRows.map((p) => p.slug));
    const defaultsMissing = SYSTEM_PAGE_SLUGS.filter((s) => !pageSlugs.has(s));
    const names = await staffNames((audit.data || []).map((a) => a.staff_id));
    const cnt = (rows, f) => (rows || []).filter(f).length;
    return ok({
      counts: {
        banners: { total: (banners.data || []).length, showing: cnt(banners.data, (x) => bannerState(x, now) === "showing") },
        posts: postCounts,
        pages: { total: pageRows.length + defaultsMissing.length, unpublished: cnt(pageRows, (p) => !p.published) + defaultsMissing.filter((s) => !DEFAULT_PAGES[s].published).length },
        people: Object.fromEntries(PEOPLE_GROUPS.map((g) => [g.key, { total: cnt(people.data, (x) => x.group_key === g.key), active: cnt(people.data, (x) => x.group_key === g.key && x.active) }])),
        faqs: { total: (faqs.data || []).length, active: cnt(faqs.data, (x) => x.active) },
        docs: { total: (docs.data || []).length, active: cnt(docs.data, (x) => x.active) },
        links: Object.fromEntries(LINK_KINDS.map((k) => [k.key, { total: cnt(links.data, (x) => x.kind === k.key), active: cnt(links.data, (x) => x.kind === k.key && x.active) }])),
      },
      recentPosts: (recent.data || []).map((p) => ({ ...p, state: postState(p, now), path: postPath(p) })),
      audit: (audit.data || []).map((a) => ({ ...a, staff_name: a.staff_id ? names[a.staff_id] || null : null })),
    });
  }

  if (action === "cms-list" && method === "GET") {
    const e = needType(); if (e) return e;
    const tbl = db().from(CMS_TYPES[type].table);
    if (type === "posts") {
      const limit = Math.min(100, Math.max(1, parseId(qget(query, "limit")) || 30));
      const offset = Math.min(100000, Math.max(0, Number.parseInt(qget(query, "offset") || "0", 10) || 0));
      let qb = tbl.select(POST_LIST_COLS, { count: "exact" });
      const cats = String(qget(query, "category") || "").split(",").filter((c) => POST_CATEGORIES.some((x) => x.key === c));
      if (cats.length === 1) qb = qb.eq("category", cats[0]);
      else if (cats.length > 1) qb = qb.in("category", cats);
      const nowIso = new Date().toISOString();
      const st = qget(query, "status");
      if (st === "draft") qb = qb.or(`status.eq.draft,published_at.is.null`);
      else if (st === "published") qb = qb.eq("status", "published").lte("published_at", nowIso);
      else if (st === "scheduled") qb = qb.eq("status", "published").gt("published_at", nowIso);
      const q = cleanText(oneLine(qget(query, "q")), 100);
      if (q) qb = qb.ilike("title", `%${escapeLikePattern(q)}%`);
      qb = qb.order("published_at", { ascending: false, nullsFirst: true }).order("id", { ascending: false }).range(offset, offset + limit - 1);
      const { data, count } = await run(qb, "อ่านรายการข่าว");
      const now = Date.now();
      return ok({ items: (data || []).map((p) => ({ ...p, state: postState(p, now), path: postPath(p) })), total: count ?? null, limit, offset });
    }
    if (type === "pages") {
      const { data } = await run(tbl.select(PAGE_LIST_COLS).order("sort_order").order("slug").limit(500), "อ่านหน้าเนื้อหา");
      const rows = (data || []).map((r) => pageView(r, false));
      const have = new Set(rows.map((r) => r.slug));
      for (const s of SYSTEM_PAGE_SLUGS) if (!have.has(s)) { const d = defaultPage(s); delete d.body_html; rows.push(d); }
      rows.sort((a, b) => (a.sort_order - b.sort_order) || a.slug.localeCompare(b.slug));
      return ok({ items: rows });
    }
    const { data } = await run(tbl.select("*").order("sort_order").order("id").limit(2000), "อ่านรายการ");
    const now = Date.now();
    const items = (data || []).map((r) => (type === "banners" ? { ...r, state: bannerState(r, now) } : r));
    return ok({ items });
  }

  if (action === "cms-get" && method === "GET") {
    const e = needType(); if (e) return e;
    if (type === "pages") {
      const slug = String(qget(query, "id") || "");
      if (!isValidSlug(slug)) return fail(400, "ไม่พบหน้านี้");
      const { data } = await run(db().from("site_pages").select("*").eq("slug", slug).maybeSingle(), "อ่านหน้าเนื้อหา");
      if (data) return ok({ item: pageView(data, false) });
      const d = defaultPage(slug);
      return d ? ok({ item: d }) : fail(404, "ไม่พบหน้านี้");
    }
    const id = parseId(qget(query, "id"));
    if (!id) return fail(400, "ไม่พบรายการนี้");
    const { data } = await run(db().from(CMS_TYPES[type].table).select("*").eq("id", id).maybeSingle(), "อ่านรายการ");
    if (!data) return fail(404, "ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)");
    const item = type === "posts" ? { ...data, state: postState(data), path: postPath(data) } : type === "banners" ? { ...data, state: bannerState(data) } : data;
    return ok({ item });
  }

  if (action === "cms-save" && method === "POST") {
    const e = needType(); if (e) return e;
    const it = obj(b.item);
    const norm = type === "posts" ? normalizePost(it) : NORMALIZERS[type](it);
    if (!norm.ok) return fail(400, norm.error, { field: norm.field });
    const row = norm.row;
    const table = CMS_TYPES[type].table;

    // ── หน้าเนื้อหา: upsert ตาม slug (slug แก้ไม่ได้หลังสร้าง · หน้าระบบลบไม่ได้แต่คืนค่าเริ่มต้นได้)
    if (type === "pages") {
      const isNew = it.isNew === true;
      // 5 ต.ค. 69 (ผลตรวจ code-reviewer minor 3): เดิมแก้หน้า A แล้วพิมพ์ slug เป็น B ที่มีอยู่ = หาแถวด้วย slug ใหม่ → เขียนทับหน้า B เงียบๆ
      // ตอนนี้แก้ของเดิมต้องส่ง originalSlug มาและต้องตรง slug ที่บันทึก (ตรวจก่อนแตะฐานข้อมูล) · cms.js ล็อกช่อง slug เป็น readOnly อีกชั้น
      const slugErr = pageSlugChangeError({ isNew, slug: row.slug, originalSlug: it.originalSlug });
      if (slugErr) return fail(400, slugErr, { field: "slug" });
      const isSystem = SYSTEM_PAGE_SLUGS.includes(row.slug);
      const { data: old } = await run(db().from(table).select("*").eq("slug", row.slug).maybeSingle(), "อ่านหน้าเนื้อหา");
      if (isNew && (old || isSystem)) return fail(409, `มีหน้าที่ใช้ชื่อลิงก์ "${row.slug}" อยู่แล้ว กรุณาใช้ชื่ออื่น`, { field: "slug" });
      if (!isNew && !old && !isSystem) return fail(404, "ไม่พบหน้านี้ (อาจถูกลบไปแล้ว)");
      const v = await verifyNewMedia(type, row, old || (isSystem ? DEFAULT_PAGES[row.slug] : null));
      if (!v.ok) return fail(400, v.error, { field: "body_html" });
      const payload = { ...row, sort_order: old?.sort_order ?? (isSystem ? DEFAULT_PAGES[row.slug].sort_order : await nextSortOrder(type)) };
      const saved = await atomicRpc("site_cms_save_atomic", {
        p_type: type, p_id: old ? row.slug : null, p_item: payload, p_staff_id: who.staffId,
        p_action: old ? "update" : "create", p_summary: `${old ? "แก้ไข" : "สร้าง"}หน้า "${row.title}"`,
      }, "บันทึกหน้าเนื้อหา");
      return ok({ item: pageView(saved, false), created: !old });
    }

    const hasId = it.id != null && it.id !== "";
    const id = hasId ? parseId(it.id) : null;
    if (hasId && !id) return fail(400, "ไม่พบรายการนี้");
    let old = null;
    if (id) {
      ({ data: old } = await run(db().from(table).select("*").eq("id", id).maybeSingle(), "อ่านรายการ"));
      if (!old) return fail(404, "ไม่พบรายการนี้ (อาจถูกลบไปแล้ว) — คัดลอกข้อความเก็บไว้ก่อน แล้วสร้างใหม่");
    }
    // เอกสารที่ไม่ได้ระบุวันเผยแพร่: สร้างใหม่ = ตอนนี้ (ค่าเริ่มต้นของตาราง) · แก้ไข = คงวันเดิม
    if (type === "docs" && !row.published_at) delete row.published_at;
    const v = await verifyNewMedia(type, row, old);
    if (!v.ok) return fail(400, v.error);
    // ขนาดไฟล์ใช้ค่าจริงจากที่เก็บไฟล์ (ไม่เชื่อตัวเลขจากเบราว์เซอร์) สำหรับไฟล์ที่เพิ่งอัปโหลด
    if (type === "docs" && v.sizes[row.file_path] != null) row.file_size = v.sizes[row.file_path];
    if (type === "posts") {
      row.attachments = row.attachments.map((a) => (v.sizes[a.path] != null ? { ...a, size: v.sizes[a.path] } : a));
    }

    const payload = { ...row };
    if (!old && CMS_TYPES[type].sortable) {
      payload.sort_order = await nextSortOrder(type, type === "people" ? (qb) => qb.eq("group_key", row.group_key)
        : type === "links" ? (qb) => qb.eq("kind", row.kind) : null);
    }
    const auditAction = !old ? "create" : type === "posts" && old.status !== row.status ? (row.status === "published" ? "publish" : "unpublish") : "update";
    const verb = !old ? "สร้าง" : auditAction === "publish" ? "เผยแพร่" : auditAction === "unpublish" ? "เปลี่ยนเป็นร่าง" : "แก้ไข";
    const saved = await atomicRpc("site_cms_save_atomic", {
      p_type: type, p_id: old ? String(id) : null, p_item: payload, p_staff_id: who.staffId,
      p_action: auditAction, p_summary: `${verb}${CMS_TYPES[type].label} "${titleOf(type, row)}"`,
    }, "บันทึก");
    const item = type === "posts" ? { ...saved, state: postState(saved), path: postPath(saved) } : type === "banners" ? { ...saved, state: bannerState(saved) } : saved;
    return ok({ item, created: !old });
  }

  if (action === "cms-delete" && method === "POST") {
    const e = needType(); if (e) return e;
    const table = CMS_TYPES[type].table;
    if (type === "pages") {
      const slug = String(b.id ?? "");
      if (!isValidSlug(slug)) return fail(400, "ไม่พบหน้านี้");
      const isSystem = SYSTEM_PAGE_SLUGS.includes(slug);
      const { data: old } = await run(db().from(table).select("*").eq("slug", slug).maybeSingle(), "อ่านหน้าเนื้อหา");
      if (!old) return isSystem ? ok({ reset: true, already: true }) : fail(404, "ไม่พบหน้านี้ (อาจถูกลบไปแล้ว)");
      await atomicRpc("site_cms_delete_atomic", {
        p_type: type, p_id: slug, p_staff_id: who.staffId, p_action: isSystem ? "reset" : "delete",
        p_summary: `${isSystem ? "คืนค่าเริ่มต้นของ" : "ลบ"}หน้า "${old.title}"`,
      }, "ลบหน้าเนื้อหา");
      const files = await removeMediaOf(type, old);
      return ok({ reset: isSystem, files });
    }
    const id = parseId(b.id);
    if (!id) return fail(400, "ไม่พบรายการนี้");
    const { data: old } = await run(db().from(table).select("*").eq("id", id).maybeSingle(), "อ่านรายการ");
    if (!old) return fail(404, "ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)");
    await atomicRpc("site_cms_delete_atomic", {
      p_type: type, p_id: String(id), p_staff_id: who.staffId, p_action: "delete",
      p_summary: `ลบ${CMS_TYPES[type].label} "${titleOf(type, old)}"`,
    }, "ลบ");
    const files = await removeMediaOf(type, old);
    return ok({ files });
  }

  if (action === "cms-reorder" && method === "POST") {
    const e = needType(); if (e) return e;
    const r = normalizeReorder(type, b.ids);
    if (!r.ok) return fail(400, r.error);
    const orders = r.orders.map((o) => type === "pages" && SYSTEM_PAGE_SLUGS.includes(o.key)
      ? { ...o, default: DEFAULT_PAGES[o.key] } : o);
    const updated = await atomicRpc("site_cms_reorder_atomic", {
      p_type: type, p_orders: orders, p_staff_id: who.staffId,
      p_summary: `จัดลำดับ${CMS_TYPES[type].label} ${orders.length} รายการ`,
    }, "จัดลำดับ");
    return ok({ updated });
  }

  if (action === "cms-config" && method === "GET") {
    const { data } = await run(db().from("settings").select("value").eq("key", SITE_CONFIG_KEY).maybeSingle(), "อ่านตั้งค่าเว็บไซต์");
    return ok({ config: mergeSiteConfig(data?.value), saved: !!data, defaults: SITE_CONFIG_DEFAULTS });
  }

  if (action === "cms-config-save" && method === "POST") {
    const v = validateSiteConfigInput(b.config);
    if (!v.ok) return fail(400, v.error, { field: v.field });
    await atomicRpc("site_cms_config_save_atomic", { p_value: v.config, p_staff_id: who.staffId }, "บันทึกตั้งค่าเว็บไซต์");
    return ok({ config: v.config });
  }

  if (action === "cms-upload-url" && method === "POST") {
    const p = buildMediaPath(String(b.kind || ""), b.contentType, b.variant || "main");
    if (!p.ok) return fail(400, p.error);
    await ensureMediaBucket();
    const { data, error } = await db().storage.from(MEDIA_BUCKET).createSignedUploadUrl(p.path);
    if (error) return fail(502, "สร้างลิงก์อัปโหลดไม่สำเร็จ: " + error.message);
    return ok({ path: p.path, token: data.token, publicUrl: mediaPublicUrl(p.path) });
  }

  if (action === "cms-audit" && method === "GET") {
    const limit = Math.min(200, Math.max(1, parseId(qget(query, "limit")) || 100));
    const { data } = await run(db().from("site_audit").select("id,staff_id,action,item_type,item_id,summary,at").order("at", { ascending: false }).order("id", { ascending: false }).limit(limit), "อ่านประวัติการแก้ไข");
    const names = await staffNames((data || []).map((a) => a.staff_id));
    return ok({ items: (data || []).map((a) => ({ ...a, staff_name: a.staff_id ? names[a.staff_id] || null : null })) });
  }

  return fail(400, "ไม่รู้จัก action นี้");
}
