/* ฟังก์ชันบริสุทธิ์ที่ใช้ร่วมกับหน้า CMS และชุดทดสอบ (scripts/test-cms.mjs เรียกตรง — ห้ามแตะ DOM/window ในไฟล์นี้)
   วันเวลาในช่อง datetime-local ถือเป็นเวลาไทยเสมอ ไม่ขึ้นกับ timezone ของเครื่องหรือ Vercel
   6 ต.ค. 69: เพิ่มตัวช่วยของหน้า CMS รุ่นใช้งานจริง (docs/WEBSITE-SPEC.md ข้อ 5.4) — ข้อความวันที่ พ.ศ. ใต้ช่อง · ลิงก์ YouTube → embed ·
   แก้ช่องว่างจาก getSemanticHTML ของ Quill 2.0.3 · ขนาดย่อรูป · จัดลำดับ · ลิงก์ดูตัวอย่าง */
export const THAI_OFFSET = "+07:00";

export function toThaiDatetimeLocal(value) {
  if (!value) return "";
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) return "";
  return new Date(time + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function fromThaiDatetimeLocal(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(raw)) {
    throw new Error("วันเวลาไม่ถูกต้อง");
  }
  return `${raw.length === 16 ? `${raw}:00` : raw}${THAI_OFFSET}`;
}

export function checkboxValue(item, name) {
  if (Object.prototype.hasOwnProperty.call(item || {}, name)) return item[name] === true;
  return name === "active" || name === "published";
}

/* ═══ ข้อความวันที่ภาษาไทยใต้ช่อง datetime-local (สเปก 5.4: "= วันพุธที่ 1 ตุลาคม 2569 เวลา 09.00 น.")
   ช่อง datetime-local ของเบราว์เซอร์แสดงปี ค.ศ. เสมอ → เจ้าหน้าที่ต้องเห็นปี พ.ศ. ยืนยันใต้ช่อง · คำนวณจากตัวเลขในช่องตรงๆ (ไม่ผ่าน timezone เครื่อง) */
export const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
export const THAI_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
export function thaiDateTimeText(localValue) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(localValue ?? "").trim());
  if (!m) return "";
  const [y, mo, d, hh, mm] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d);
  const check = new Date(t);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || hh > 23 || mm > 59) return "";
  return `วัน${THAI_DAYS[check.getUTCDay()]}ที่ ${d} ${THAI_MONTHS[mo - 1]} ${y + 543} เวลา ${String(hh).padStart(2, "0")}.${String(mm).padStart(2, "0")} น.`;
}

/* ═══ ลิงก์ YouTube ที่เจ้าหน้าที่วาง → ลิงก์ฝัง (youtube-nocookie) · รับ watch?v= / youtu.be / shorts / live / embed · อื่น = null
   เซิร์ฟเวอร์บังคับเป็น youtube-nocookie อีกชั้นใน _sanitize.js (youtubeEmbedId) — ตรงนี้ทำให้ตัวแก้แสดงวิดีโอได้ทันทีก่อนบันทึก */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
export function youtubeEmbedUrl(raw) {
  let s = String(raw ?? "").trim();
  if (!s || s.length > 500) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(parts[0])) id = parts[1];
  }
  return id && YT_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

/* ═══ Quill 2.0.3 getSemanticHTML() แปลง "ทุกช่องว่าง" เป็น &nbsp; (ตรวจจากซอร์ส dist/quill.js: replaceAll(" ","&nbsp;"))
   → ข้อความไทยที่เว้นวรรคจะไม่ตัดบรรทัดตรงช่องว่างบนมือถือ · คืนช่องว่างปกติ คงไว้เฉพาะช่องว่างที่ติดกันหลายตัว (เจตนาเว้นหลายช่อง)
   ทำเฉพาะส่วนข้อความนอกแท็ก (ไม่แตะแอตทริบิวต์) */
export function fixQuillSpaces(html) {
  return String(html ?? "").split(/(<[^>]*>)/).map((part) => {
    if (part.startsWith("<")) return part;
    return part.replace(/(?:&nbsp;| )+/g, (run) => {
      const n = (run.match(/&nbsp;| /g) || []).length;
      return n === 1 ? " " : " " + "&nbsp;".repeat(n - 1);
    });
  }).join("");
}

/* รูปในเนื้อหาที่ไม่ได้มาจากที่เก็บไฟล์ของเรา (วางจากเว็บอื่น / data:) — เซิร์ฟเวอร์จะตัดทิ้งตอนบันทึก (_sanitize.js isAllowedImageSrc)
   หน้า CMS ต้องบอกผู้ใช้ก่อนบันทึก ไม่ปล่อยให้รูปหายเงียบๆ */
export function foreignImageCount(html, mediaBase) {
  const re = /<img\b[^>]*?\ssrc\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m, n = 0;
  while ((m = re.exec(String(html ?? "")))) {
    const src = (m[2] ?? m[3] ?? "").replace(/&amp;/g, "&").trim();
    const ok = (mediaBase && src.startsWith(mediaBase)) || /^\/assets\//.test(src);
    if (!ok) n++;
  }
  return n;
}

/* ═══ ขนาดย่อรูปในเบราว์เซอร์ (สเปก 5.4) — ไม่ขยายรูปเล็กให้ใหญ่ขึ้น
   maxWidth = จำกัดด้านกว้าง (แบนเนอร์ 1920w · บุคคล 600w) · maxSide = จำกัดด้านยาว (ปก/แกลเลอรี/ในเนื้อหา 1600 · โลโก้ 400) */
export const IMAGE_RULES = {
  banner: { maxWidth: 1920 },
  cover: { maxSide: 1600, thumb: { maxSide: 640 } },
  gallery: { maxSide: 1600, thumb: { maxSide: 480 } },
  inline: { maxSide: 1600 },
  person: { maxWidth: 600, thumb: { maxWidth: 240 } },
  logo: { maxSide: 400, png: true }, // โลโก้คงพื้นโปร่งใส (PNG)
};
export function fitWithin(w, h, rule = {}) {
  const W = Number(w), H = Number(h);
  if (!(W > 0 && H > 0)) return { w: 0, h: 0 };
  let s = 1;
  if (rule.maxWidth) s = Math.min(s, rule.maxWidth / W);
  if (rule.maxSide) s = Math.min(s, rule.maxSide / Math.max(W, H));
  return { w: Math.max(1, Math.round(W * s)), h: Math.max(1, Math.round(H * s)) };
}

export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "—";
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${Math.round(v / 1024)} KB`;
  return `${(v / 1048576).toFixed(v < 10485760 ? 1 : 0)} MB`;
}

/* ชนิดเอกสารจากไฟล์ที่เลือก — มือถือบางรุ่นส่ง file.type ว่างสำหรับ .docx/.xlsx → ดูนามสกุลแทน (docTypes = cms-meta.docTypes: mime → ext) */
export function docTypeOf(fileName, fileType, docTypes) {
  const types = docTypes || {};
  if (fileType && fileType in types) return fileType;
  const ext = String(fileName || "").toLowerCase().split(".").pop();
  return Object.keys(types).find((t) => types[t] === ext) || null;
}

/* ย้ายรายการในอาร์เรย์ (ปุ่ม ↑↓) — คืนอาร์เรย์ใหม่ หรือ null ถ้าย้ายไม่ได้ (บนสุด/ล่างสุดแล้ว) */
export function moveInArray(arr, index, delta) {
  const list = Array.isArray(arr) ? arr.slice() : [];
  const j = index + delta;
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) return null;
  [list[index], list[j]] = [list[j], list[index]];
  return list;
}

/* ลิงก์ "ดูตัวอย่าง" (โหมด ?preview=1 ของหน้าบ้าน — สเปก 4.4) · ยังไม่บันทึก = null */
export function previewUrl(type, item) {
  const it = item || {};
  if (type === "posts") {
    const id = Number(it.id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return `/${it.category === "knowledge" ? "knowledge" : "news"}/${id}?preview=1`;
  }
  if (type === "pages") {
    if (!it.slug || it.isNew) return null;
    return it.slug === "about" ? "/about?preview=1" : `/page/${encodeURIComponent(it.slug)}?preview=1`;
  }
  if (type === "banners") return "/?preview=1";
  return null;
}

/* ความยาวสำหรับตัวนับ — นับแบบเดียวกับเซิร์ฟเวอร์ (String.length หลัง trim) */
export function textLength(v) {
  return String(v ?? "").trim().length;
}
