/* api/_site-html.js — ตัวช่วยสร้าง HTML ของเว็บไซต์หน้าบ้าน (สาย A · เว็บไซต์ไดนามิก 1 ต.ค. 69 — สเปก docs/WEBSITE-SPEC.md)
   ฟังก์ชันบริสุทธิ์ทั้งไฟล์ (ไม่แตะ DB/เน็ต) — ใช้โดย api/_site-render.js

   ⛔ กติกาเหล็กกัน XSS: สร้าง HTML ด้วย html`...` เท่านั้น — ค่าที่แทรกทุกตัว escape อัตโนมัติ
      ยกเว้นค่าที่ห่อด้วย raw() ซึ่งต้องเป็น (1) HTML ที่เราสร้างเองจาก html`` หรือ (2) ผลของ sanitizeRichHtml()
      ห้ามห่อ raw() กับข้อความจาก DB/ผู้ใช้ตรงๆ เด็ดขาด */
import { escapeHtml } from "./_sanitize.js";

class Raw {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
}
export function raw(s) {
  return s instanceof Raw ? s : new Raw(s ?? "");
}
export function isRaw(v) {
  return v instanceof Raw;
}
function fmt(v) {
  if (v === null || v === undefined || v === false || v === true) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join("");
  return escapeHtml(v);
}
/* html`<p>${ข้อความ}</p>` → Raw (ข้อความถูก escape) · แทรก array ได้ (ต่อกันเป็นสตริงเดียว) */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += fmt(vals[i]) + strings[i + 1];
  return new Raw(out);
}
export function join(list, sep = "") {
  return new Raw((list || []).map(fmt).join(fmt(sep)));
}

/* ═══ วันที่ไทย (พ.ศ. · เวลาไทยเสมอ ไม่ว่า function รันที่ region ไหน) ═══ */
const DATE_LONG = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" });
const DATE_SHORT = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });
const TIME_24 = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}
export function thaiDate(v, { short = false } = {}) {
  const d = toDate(v);
  return d ? (short ? DATE_SHORT : DATE_LONG).format(d) : "";
}
export function thaiDateTime(v) {
  const d = toDate(v);
  return d ? `${DATE_LONG.format(d)} เวลา ${TIME_24.format(d).replace(":", ".")} น.` : "";
}
/* <time datetime="ISO">1 ตุลาคม 2569</time> */
export function timeTag(v, opts) {
  const d = toDate(v);
  return d ? html`<time datetime="${d.toISOString()}">${thaiDate(d, opts)}</time>` : raw("");
}

/* ขนาดไฟล์อ่านง่าย (1.2 MB) */
export function fileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
}

/* เบอร์โทรที่แสดง → href tel: (ตัวเลขล้วน 3–10 หลัก) · ค่าเสีย = null (แสดงเป็นข้อความเฉยๆ) */
export function telHref(phone) {
  const digits = String(phone ?? "").replace(/[\s\-().]/g, "");
  return /^\+?\d{3,12}$/.test(digits) ? `tel:${digits}` : null;
}

/* JSON-LD แบบปลอดภัย: escape < > & และตัวคั่นบรรทัด U+2028/2029 กันหลุดออกจากแท็ก <script> */
export function jsonLd(obj) {
  const s = JSON.stringify(obj)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return raw(`<script type="application/ld+json">${s}</script>`);
}

/* ═══ ไอคอนเส้น (inline SVG · สีตาม currentColor) — วาดเองแบบเรียบ ไม่ใช้ไลบรารี/ฟอนต์ไอคอนภายนอก ═══ */
const ICON_PATHS = {
  phone: '<path d="M6.6 3.5 9 3l1.6 4-2 1.3a11 11 0 0 0 5.1 5.1l1.3-2 4 1.6-.5 2.4a2 2 0 0 1-2 1.6A15.5 15.5 0 0 1 5 5.5a2 2 0 0 1 1.6-2Z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14"/>',
  file: '<path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8Z"/><path d="M14 3.5V8h4.5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  play: '<path d="M8 5.5v13l10.5-6.5Z"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>',
  share: '<circle cx="17.5" cy="6" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="m8.7 10.8 6.6-3.6M8.7 13.2l6.6 3.6"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  map: '<path d="m3.5 6.5 5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2Z"/><path d="M9 4.5v13M15 6.5v13"/>',
  directions: '<path d="M12 2.8 21.2 12 12 21.2 2.8 12Z"/><path d="M9.5 13.5V11h4.5m-1.5-2 2 2-2 2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h13m-5-5.5L18.5 12 13 17.5"/>',
  free: '<path d="M12 3.5 14.4 8.6l5.6.6-4.2 3.8 1.2 5.5L12 15.7l-5 2.8 1.2-5.5L4 9.2l5.6-.6Z"/>',
  person: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  // โลโก้โซเชียล (รูปทรงเรียบ ทึบ) — ใช้ fill ไม่ใช้ stroke
  facebook: '<path fill="currentColor" stroke="none" d="M13.4 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.7v3h2.6V21Z"/>',
  line: '<path fill="currentColor" stroke="none" d="M12 3.5c-5 0-9 3.2-9 7.2 0 3.6 3.2 6.6 7.5 7.1.3.1.7.2.8.5.1.2.1.6 0 .9l-.1.8c0 .2-.2.9.8.5s5.4-3.2 7.4-5.5c1.4-1.5 2-3 2-4.3 0-4-4-7.2-9-7.2Zm-3.7 9.6H6.5a.5.5 0 0 1-.5-.5V9a.5.5 0 0 1 1 0v3.1h1.3a.5.5 0 0 1 0 1Zm1.9-.5a.5.5 0 0 1-1 0V9a.5.5 0 0 1 1 0Zm4.4 0a.5.5 0 0 1-.9.3l-1.9-2.5v2.2a.5.5 0 0 1-1 0V9a.5.5 0 0 1 .9-.3l1.9 2.5V9a.5.5 0 0 1 1 0Zm2.9-2.3a.5.5 0 0 1 0 1h-1.3v.8h1.3a.5.5 0 0 1 0 1h-1.8a.5.5 0 0 1-.5-.5V9a.5.5 0 0 1 .5-.5h1.8a.5.5 0 0 1 0 1h-1.3v.8Z"/>',
  youtube: '<path fill="currentColor" stroke="none" d="M21.2 8.1a2.6 2.6 0 0 0-1.8-1.8C17.8 5.9 12 5.9 12 5.9s-5.8 0-7.4.4a2.6 2.6 0 0 0-1.8 1.8C2.4 9.7 2.4 12 2.4 12s0 2.3.4 3.9a2.6 2.6 0 0 0 1.8 1.8c1.6.4 7.4.4 7.4.4s5.8 0 7.4-.4a2.6 2.6 0 0 0 1.8-1.8c.4-1.6.4-3.9.4-3.9s0-2.3-.4-3.9ZM10.1 14.9V9.1l4.9 2.9Z"/>',
  tiktok: '<path fill="currentColor" stroke="none" d="M16.6 3.5h-3v11.6a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.5a5.7 5.7 0 1 0 4.8 5.6V9.2a7 7 0 0 0 3.9 1.2V7.4a4 4 0 0 1-3.9-3.9Z"/>',
  x: '<path fill="currentColor" stroke="none" d="M17.3 3.8h2.9l-6.3 7.2 7.4 9.2h-5.8l-4.5-5.6-5.2 5.6H2.9l6.7-7.6-7-8.8h5.9l4.1 5.1Zm-1 14.7h1.6L7.6 5.4H5.9Z"/>',
  instagram: '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4.6"/><circle cx="12" cy="12" r="3.9"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/>',
  website: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.6 5.3 3.6 8.5s-1.2 6-3.6 8.5c-2.4-2.5-3.6-5.3-3.6-8.5S9.6 6 12 3.5Z"/>',
  email: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
};
export function icon(name, { size = 20, cls = "", label = "" } = {}) {
  const p = ICON_PATHS[name] || ICON_PATHS.link;
  const a11y = label ? `role="img" aria-label="${escapeHtml(label)}"` : 'aria-hidden="true" focusable="false"';
  return raw(`<svg class="ic${cls ? " " + escapeHtml(cls) : ""}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${p}</svg>`);
}
export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, name);
}

/* ไอคอนชนิดไฟล์เอกสาร (ป้ายตัวอักษร PDF/DOC/XLS) */
export function fileKind(typeOrName) {
  const s = String(typeOrName || "").toLowerCase();
  if (s.includes("pdf")) return { key: "pdf", label: "PDF" };
  if (s.includes("word") || /\.docx?$/.test(s) || s.includes("msword")) return { key: "doc", label: "DOC" };
  if (s.includes("excel") || s.includes("spreadsheet") || /\.xlsx?$/.test(s)) return { key: "xls", label: "XLS" };
  return { key: "file", label: "ไฟล์" };
}
