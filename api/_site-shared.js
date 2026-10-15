/* api/_site-shared.js — สัญญากลาง (contract) ของ "เว็บไซต์ไดนามิก + หลังบ้านจัดการเนื้อหา (CMS)"
   บอสสั่ง 30 ก.ย. 69: "รื้อหน้า web ใหม่ ทำแบบ dynamic website มี banner มี social มีระบบ backend admin
   ตัวอย่าง https://www.lawyerscouncil.or.th/" — สเปกเต็ม docs/WEBSITE-SPEC.md · ตาราง supabase-migration-13-website-cms.sql

   ใช้ร่วมกันทั้งฝั่งหน้าบ้าน (api/site.js · _site-data.js · _site-render.js) และหลังบ้าน (api/_cms.js · public/cms.*)
   ⛔ ไฟล์นี้ต้อง "บริสุทธิ์": ไม่แตะ DB/เน็ต — อ่าน env แค่ SITE_URL/SUPABASE_URL ตอนเรียกฟังก์ชัน (เทสต์ import ตรงได้)
   ⛔ ห้ามแต่งข้อมูลจริงเอง: ค่าเริ่มต้นทุกตัวมาจากข้อมูลที่มีอยู่แล้วใน repo หรือมติบอส (อ้างที่มาไว้ทุกจุด)
   ⚠️ แก้ของเดิมในไฟล์นี้ = กระทบทั้ง 2 ฝั่ง → เพิ่ม export ใหม่ได้ แต่แก้/ลบของเดิมต้องให้ Hermes ตัดสิน */

import { APPOINTMENT_INFO } from "./_serviceinfo.js";

/* ═══ ตัวตนเว็บ ═══ (ข้อความเดิมจาก public/index.html ที่ใช้งานจริงมาตั้งแต่ 18 ก.ย. 69) */
export const SITE_NAME = "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี";
export const SITE_NAME_FULL = "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย องค์การบริหารส่วนจังหวัดสุพรรณบุรี";
export const SITE_PARTNERS = "สภาทนายความจังหวัดสุพรรณบุรี ร่วมกับ องค์การบริหารส่วนจังหวัดสุพรรณบุรี";
export const LINE_OA_ID = "@073kbdgu";
export const LINE_OA_URL = "https://line.me/R/ti/p/@073kbdgu";
export const DEFAULT_OG_IMAGE = { path: "/assets/og-legal-aid-v2.png", width: 1200, height: 630, type: "image/png" };

/* ═══ เอกสารทางการของศูนย์ (ฉบับสแกนที่ลงนามแล้ว 15 ก.ย. 69 — บอสสั่งลงเว็บ 6 ต.ค. 69)
   เสิร์ฟจากไฟล์นิ่ง public/assets/official/ ไม่ผ่านฐาน/CMS: เอกสารจัดตั้งต้องไม่หายถ้า DB ล่ม และแอดมินเผลอลบไม่ได้
   ⛔ bytes ต้องตรงไฟล์จริง (scripts/test-site.mjs เทียบให้) · เป็นภาพสแกน ไม่มีชั้นตัวอักษร — ห้ามเขียนว่า "คัดลอกข้อความได้"
   ⛔ คำบรรยายสรุปจากตัวเอกสารเท่านั้น ห้ามเติมเงื่อนไขที่เอกสารไม่ได้เขียน (เช่น "ฟรี") */
export const OFFICIAL_DOCS = Object.freeze([
  {
    key: "announcement",
    title: "ประกาศองค์การบริหารส่วนจังหวัดสุพรรณบุรี เรื่อง จัดตั้งศูนย์ช่วยเหลือประชาชนทางกฎหมาย",
    description: "กำหนดวัตถุประสงค์ ขอบเขตการดำเนินงาน หน้าที่ของแต่ละฝ่าย และกระบวนการรับเรื่องและส่งต่อของศูนย์ฯ ประกาศ ณ วันที่ 15 กันยายน พ.ศ. 2569 มีผลตั้งแต่วันที่ 15 กันยายน 2569 เป็นต้นไป",
    path: "/assets/official/announcement-pao-legal-aid-center-2569-09-15.pdf",
    pages: 3,
    bytes: 1425028,
    date: "2026-09-15T00:00:00+07:00",
  },
  {
    key: "mou",
    title: "บันทึกข้อตกลงความร่วมมือทางกฎหมาย ระหว่างสภาทนายความจังหวัดสุพรรณบุรี ร่วมกับ องค์การบริหารส่วนจังหวัดสุพรรณบุรี",
    description: "ลงนามเมื่อวันที่ 15 กันยายน พ.ศ. 2569 ระหว่างประธานสภาทนายความจังหวัดสุพรรณบุรีกับนายกองค์การบริหารส่วนจังหวัดสุพรรณบุรี กำหนดหน้าที่ของแต่ละฝ่าย การรักษาความลับ และการคุ้มครองข้อมูลส่วนบุคคล มีกำหนด 2 ปี",
    path: "/assets/official/mou-lawyers-council-pao-2569-09-15.pdf",
    pages: 5,
    bytes: 864437,
    date: "2026-09-15T00:00:00+07:00",
  },
]);

/* ═══ "ข้อควรทราบ" — ยกถ้อยคำจากเอกสารทางการข้างบน (บอสสั่งทำ 6 ต.ค. 69 หลังเทียบระบบกับประกาศ/MOU)
   ⛔ แก้ได้เฉพาะเมื่อเอกสารต้นฉบับเปลี่ยน — ห้ามเติมเงื่อนไข/คำสัญญาที่เอกสารไม่ได้เขียน (เช่น "ฟรี") ห้ามย่อจนความหมายเปลี่ยน
   ⛔ อยู่ในโค้ด ไม่ผ่าน CMS: แอดมินแก้เนื้อหาเว็บแล้วข้อความนี้ต้องไม่หาย (ใช้ทั้งหน้า /about, footer ทุกหน้า, ฟอร์ม 3 แบบ)
   ข้อกำกับ "ข้อ N" = ประกาศ อบจ. จัดตั้งศูนย์ฯ · "MOU ข้อ N" = บันทึกข้อตกลงความร่วมมือทางกฎหมาย */
export const LEGAL_NOTICE = Object.freeze({
  title: "ข้อควรทราบ",
  items: Object.freeze([
    "ศูนย์ช่วยเหลือประชาชนทางกฎหมายเป็นกลไกรับเรื่อง คัดกรองข้อเท็จจริงและประเด็นปัญหาทางกฎหมาย และประสานการให้ความช่วยเหลือหรือส่งต่อไปยังสภาทนายความหรือหน่วยงานที่มีอำนาจหน้าที่โดยตรง (ประกาศ ข้อ 1)",
    "การรับเรื่องของศูนย์ฯ ไม่ถือเป็นการรับว่าความ การรับดำเนินคดีแทนผู้ร้อง หรือการวินิจฉัยชี้ขาดข้อพิพาท (ประกาศ ข้อ 6)",
    "การรับเรื่องไว้พิจารณาไม่เป็นการรับรองว่าผู้ร้องจะได้รับความช่วยเหลือหรือได้รับการจัดหาทนายความในทุกกรณี (ประกาศ ข้อ 7)",
    "การให้ความช่วยเหลือทางกฎหมาย การจัดหาทนายความ และการดำเนินคดี เป็นไปตามกฎหมาย ระเบียบ ข้อบังคับ หลักเกณฑ์ คุณสมบัติ และเงื่อนไขของหน่วยงานหรือองค์กรผู้รับผิดชอบ (ประกาศ ข้อ 7)",
    "องค์การบริหารส่วนจังหวัดสุพรรณบุรีจัดสถานที่และประสานงานการรับเรื่อง ไม่ได้เป็นผู้ให้คำปรึกษาทางกฎหมายหรือรับรองความเห็นหรือผลการดำเนินคดีของทนายความ (MOU ข้อ 8)",
  ]),
  short: "การรับเรื่องของศูนย์ฯ ไม่ถือเป็นการรับว่าความ รับดำเนินคดีแทน หรือวินิจฉัยชี้ขาดข้อพิพาท และไม่รับรองว่าจะได้รับความช่วยเหลือหรือการจัดหาทนายความในทุกกรณี (ประกาศ ข้อ 6–7)",
  linkLabel: "อ่านข้อควรทราบฉบับเต็ม",
  linkHref: "/about#notice",
});

export function siteUrl() {
  return String(process.env.SITE_URL || "https://suphan-legalaid.vercel.app").replace(/\/+$/, "");
}
/* path ภายในเว็บ ("/news/12") → URL เต็ม · รับ URL เต็มอยู่แล้วก็คืนตามเดิม */
export function absUrl(pathOrUrl) {
  const s = String(pathOrUrl || "/");
  if (/^https?:\/\//i.test(s)) return s;
  return siteUrl() + (s.startsWith("/") ? s : "/" + s);
}

/* ═══ ที่เก็บไฟล์เว็บ (Supabase Storage bucket "site-media" แบบ public) ═══ */
export const MEDIA_BUCKET = "site-media";
export function mediaPublicBase() {
  return `${String(process.env.SUPABASE_URL || "").replace(/\/+$/, "")}/storage/v1/object/public/${MEDIA_BUCKET}/`;
}
export function mediaPublicUrl(path) {
  return path ? mediaPublicBase() + path : null;
}

export const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const PDF_TYPES = { "application/pdf": "pdf" };
export const DOC_TYPES = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const MB = 1048576;
/* ชนิดไฟล์ที่อัปโหลดได้ต่อ "ช่อง" — รูปย่อขนาดในเบราว์เซอร์ก่อนอัปโหลดเสมอ (canvas) เพดานนี้คือด่านสุดท้ายกันไฟล์หลุด
   variant "thumb" = รูปย่อสำหรับการ์ด/ตาราง (ประหยัดเน็ตผู้ชม + โควตา egress ฟรี 5GB/เดือนของ Supabase) */
export const UPLOAD_KINDS = {
  banner:     { types: IMAGE_TYPES, maxBytes: 5 * MB, label: "แบนเนอร์", hint: "แนะนำ 1920×640 พิกเซล (3:1)" },
  cover:      { types: IMAGE_TYPES, maxBytes: 5 * MB, label: "รูปปก", hint: "แนะนำ 1600×900 พิกเซล (16:9)" },
  gallery:    { types: IMAGE_TYPES, maxBytes: 5 * MB, label: "รูปในแกลเลอรี", hint: "ด้านยาวไม่เกิน 1600 พิกเซล" },
  inline:     { types: IMAGE_TYPES, maxBytes: 5 * MB, label: "รูปในเนื้อหา", hint: "ด้านยาวไม่เกิน 1600 พิกเซล" },
  person:     { types: IMAGE_TYPES, maxBytes: 5 * MB, label: "รูปบุคคล", hint: "แนะนำแนวตั้ง 600×750 พิกเซล (4:5)" },
  logo:       { types: IMAGE_TYPES, maxBytes: 2 * MB, label: "โลโก้หน่วยงาน", hint: "แนะนำ 300×300 พิกเซล พื้นหลังโปร่งใส (PNG)" },
  attachment: { types: PDF_TYPES, maxBytes: 10 * MB, label: "ไฟล์แนบ PDF", hint: "PDF ไม่เกิน 10MB" },
  doc:        { types: DOC_TYPES, maxBytes: 10 * MB, label: "เอกสารดาวน์โหลด", hint: "PDF / Word / Excel ไม่เกิน 10MB" },
};
const KIND_KEYS = Object.keys(UPLOAD_KINDS).join("|");
const ALL_EXT = [...new Set([...Object.values(IMAGE_TYPES), ...Object.values(DOC_TYPES)])].join("|");
/* path ออกจากเซิร์ฟเวอร์เท่านั้น: site/<kind>/<ปีเดือน 6 หลัก>/<เวลา ms 13 หลัก>-<hex 16>[-t].<ext>  (-t = รูปย่อ)
   ใช้ตรวจทุกครั้งก่อนบันทึก path ลง DB (กัน path traversal / ชี้ไฟล์มั่วใน bucket) */
export const MEDIA_PATH_RE = new RegExp(`^site\\/(${KIND_KEYS})\\/\\d{6}\\/\\d{13}-[0-9a-f]{16}(-t)?\\.(${ALL_EXT})$`);
export function isMediaPath(path, kinds) {
  const m = MEDIA_PATH_RE.exec(String(path || ""));
  if (!m) return false;
  if (kinds && !(Array.isArray(kinds) ? kinds : [kinds]).includes(m[1])) return false;
  const ext = m[3];
  return Object.values(UPLOAD_KINDS[m[1]].types).includes(ext);
}
export function mediaKindOf(path) {
  const m = MEDIA_PATH_RE.exec(String(path || ""));
  return m ? m[1] : null;
}

/* ═══ หมวดเนื้อหา ═══ section = ส่วนของ URL (/news/<id> หรือ /knowledge/<id>) */
export const POST_CATEGORIES = [
  { key: "news", label: "ข่าวประชาสัมพันธ์", section: "news", icon: "megaphone" },
  { key: "activity", label: "ภาพกิจกรรม", section: "news", icon: "sparkles" },
  { key: "announcement", label: "ประกาศ", section: "news", icon: "scroll" },
  { key: "knowledge", label: "ความรู้กฎหมาย", section: "knowledge", icon: "books" },
];
export const NEWS_CATEGORY_KEYS = ["news", "activity", "announcement"];
export function categoryInfo(key) {
  return POST_CATEGORIES.find((c) => c.key === key) || null;
}
export function postPath(post) {
  const c = categoryInfo(post?.category);
  return `/${c ? c.section : "news"}/${Number(post?.id) || 0}`;
}

export const PEOPLE_GROUPS = [
  { key: "executive", label: "ผู้บริหาร" },
  { key: "lawyer", label: "ทนายอาสา" },
  { key: "staff", label: "เจ้าหน้าที่ศูนย์" },
];
export const LINK_KINDS = [
  { key: "social", label: "ช่องทางโซเชียล" },
  { key: "related", label: "หน่วยงานที่เกี่ยวข้อง" },
];
export const SOCIAL_ICONS = [
  { key: "facebook", label: "Facebook" },
  { key: "line", label: "LINE" },
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "x", label: "X (Twitter)" },
  { key: "instagram", label: "Instagram" },
  { key: "website", label: "เว็บไซต์" },
  { key: "email", label: "อีเมล" },
];

/* ═══ เพดานจำนวน/ความยาว (ตรงกับ check ใน migration-13 — หน้าเว็บ CMS แสดงตัวนับจากค่าชุดนี้) ═══ */
export const LIMITS = {
  title: 300, excerpt: 500, alt: 200, caption: 200, bodyHtml: 200000, faqAnswerHtml: 50000,
  gallery: 30, attachments: 10, pageTitle: 200, personName: 150, position: 200, organization: 200, bio: 1000,
  question: 300, category: 80, docTitle: 300, docDescription: 1000, fileName: 200, linkLabel: 120, url: 1000,
  noticeText: 200, intro: 300, seoDescription: 300, fbPages: 3,
};

/* ═══ ลิงก์ปลอดภัย ═══ ใช้กับทุกช่องลิงก์ที่แอดมินกรอก (แบนเนอร์/ลิงก์หน่วยงาน/แถบประกาศ/โซเชียล)
   รับ: https:// · http:// · mailto: · tel: · path ภายในเว็บที่ขึ้นต้นด้วย "/" (ไม่ใช่ "//")
   ปฏิเสธ: javascript:/data:/vbscript: ฯลฯ · มีช่องว่าง/อักขระควบคุม · ยาวเกิน LIMITS.url → คืน null */
export function safeHref(raw, { allowRelative = true } = {}) {
  let s = String(raw ?? "").trim();
  if (!s || s.length > LIMITS.url) return null;
  if (/[\u0000-\u001f\u007f\s\\]/.test(s)) return null;
  if (s.startsWith("/")) {
    if (!allowRelative || s.startsWith("//")) return null;
    return s;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[\w-]+(\.[\w-]+)+(\/|\?|#|$)/.test(s)) s = "https://" + s; // พิมพ์แค่ www.xxx.go.th
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!["https:", "http:", "mailto:", "tel:"].includes(u.protocol)) return null;
  if ((u.protocol === "https:" || u.protocol === "http:") && !u.hostname) return null;
  const href = u.href;
  return href.length <= LIMITS.url ? href : null;
}
/* เฉพาะเพจ Facebook จริง (ใช้กับ Page Plugin) — รับ facebook.com/<ชื่อเพจ> และ facebook.com/profile.php?id=<ตัวเลข> */
export function isFacebookPageUrl(raw) {
  const s = safeHref(raw, { allowRelative: false });
  if (!s) return false;
  const u = new URL(s);
  if (u.protocol !== "https:" || !/^(www\.|m\.)?facebook\.com$/i.test(u.hostname)) return false;
  if (u.pathname === "/profile.php") return /^\d{5,20}$/.test(u.searchParams.get("id") || "");
  return /^\/[\w.\-%]{2,100}\/?$/.test(u.pathname);
}

/* ข้อความล้วนจากฟอร์ม: ตัดอักขระควบคุม + ตัดช่องว่างหัวท้าย + ไม่เกิน max ตัว (ยังต้อง escape ก่อนใส่ HTML เสมอ) */
export function cleanText(v, max) {
  return String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

/* ═══ ตั้งค่าเว็บ (เก็บในตาราง settings เดิม key = SITE_CONFIG_KEY ค่าเป็น jsonb ก้อนเดียว — ไม่ต้องรัน SQL) ═══ */
export const SITE_CONFIG_KEY = "site_config";
export const SITE_CONFIG_DEFAULTS = Object.freeze({
  // มติบอส 30 ก.ย. 69 "ฝัง 2 เพจ (สภาทนายความ + อบจ.)" — เพจแรกจาก facebook.txt ที่บอสวางไว้ (Hermes ทดสอบ Page Plugin
  // ฝังได้จริง 30 ก.ย. 69 = เพจ "สภาทนายความ จังหวัดสุพรรณบุรี") · เพจ อบจ. บอสให้แอดมินใส่ลิงก์เองในหลังบ้าน (url ว่าง = ไม่แสดงแท็บ)
  facebook_pages: [
    { label: "สภาทนายความจังหวัดสุพรรณบุรี", url: "https://www.facebook.com/profile.php?id=61585714474321" },
    { label: "องค์การบริหารส่วนจังหวัดสุพรรณบุรี", url: "" },
  ],
  notice: { enabled: false, text: "", link: "" },   // แถบประกาศด่วนบนสุดทุกหน้า
  mourning: false,                                   // โหมดไว้ทุกข์ (ริบบิ้นดำ + ภาพขาวดำ) แบบเว็บหน่วยงานรัฐ
  // ข้อความแนะนำ/คำอธิบาย SEO = ข้อความเดิมของหน้าแรก (public/index.html 18 ก.ย. 69)
  intro: "ให้บริการปรึกษาข้อกฎหมาย รับเรื่องร้องเรียน และจองคิวเข้ารับคำปรึกษากับทนายอาสา ฟรี ไม่มีค่าใช้จ่าย",
  seo_description: "ปรึกษาข้อกฎหมาย ร้องเรียน และจองคิวทนายอาสา ฟรี ไม่มีค่าใช้จ่าย — สภาทนายความจังหวัดสุพรรณบุรี ร่วมกับ องค์การบริหารส่วนจังหวัดสุพรรณบุรี",
  contact_email: "",                                 // ว่าง = ไม่แสดง (ยังไม่มีมติว่าจะเปิดอีเมลไหนเป็นช่องทางสาธารณะ)
});

/* รวมค่าที่เก็บใน DB กับค่าเริ่มต้น + ตรวจ/ตัดทุกช่อง (ใช้ทั้งตอนบันทึกฝั่ง CMS และตอนอ่านฝั่งหน้าเว็บ — ค่าเสียใน DB ไม่ทำเว็บพัง)
   facebook_pages: url ว่างได้ (= ไม่แสดง) แต่ถ้ามีต้องเป็นเพจ Facebook จริง ไม่งั้นทิ้งเป็น "" */
export function mergeSiteConfig(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const d = SITE_CONFIG_DEFAULTS;
  const pagesIn = Array.isArray(r.facebook_pages) ? r.facebook_pages : d.facebook_pages;
  const facebook_pages = pagesIn.slice(0, LIMITS.fbPages).map((p) => {
    const url = isFacebookPageUrl(p?.url) ? safeHref(p.url, { allowRelative: false }) : "";
    return { label: cleanText(p?.label, LIMITS.linkLabel) || "Facebook", url };
  });
  const n = r.notice && typeof r.notice === "object" ? r.notice : {};
  const notice = {
    enabled: n.enabled === true,
    text: cleanText(n.text, LIMITS.noticeText),
    link: safeHref(n.link) || "",
  };
  if (!notice.text) notice.enabled = false;
  const email = cleanText(r.contact_email, 120);
  return {
    facebook_pages,
    notice,
    mourning: r.mourning === true,
    intro: cleanText(r.intro ?? d.intro, LIMITS.intro) || d.intro,
    seo_description: cleanText(r.seo_description ?? d.seo_description, LIMITS.seoDescription) || d.seo_description,
    contact_email: /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email) ? email : "",
  };
}

/* ═══ หน้าเนื้อหาระบบ (ลบไม่ได้ แก้ได้) — เนื้อหาเริ่มต้นใช้ตอน DB ยังไม่มีแถวของ slug นั้น
   เมื่อแอดมินกดบันทึกครั้งแรก CMS จะสร้างแถวจริงใน site_pages แล้วค่าเริ่มต้นนี้ไม่ถูกใช้อีก
   ⛔ ทุกข้อความต้องเป็นข้อเท็จจริงที่มีอยู่แล้ว: บริการ/หมวดเรื่อง = index.html เดิม · สถานที่/เวลาทนายอาสา = _serviceinfo.js (บอสให้ 30 ก.ย. 69)
   ⚠️ privacy = ร่างเริ่มต้น ปิดไว้ (published:false) จนกว่าผู้มีอำนาจตรวจแล้วกดเผยแพร่เอง — เป็นเอกสารทางกฎหมาย ระบบไม่เผยแพร่ให้เอง */
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const LOC = APPOINTMENT_INFO.location;
export const SYSTEM_PAGE_SLUGS = ["about", "privacy", "cookies"];
export const DEFAULT_PAGES = Object.freeze({
  about: {
    slug: "about", title: "เกี่ยวกับศูนย์", show_in_menu: true, sort_order: 0, published: true,
    body_html: [
      `<p>${esc(SITE_NAME_FULL)} เป็นความร่วมมือระหว่าง <strong>สภาทนายความจังหวัดสุพรรณบุรี</strong> และ <strong>องค์การบริหารส่วนจังหวัดสุพรรณบุรี</strong> ให้บริการประชาชน <strong>ฟรี ไม่มีค่าใช้จ่าย</strong></p>`,
      `<h2>บริการของศูนย์</h2>`,
      `<ul><li>ปรึกษาข้อกฎหมาย เช่น ถูกโกง หนี้สิน มรดก การจ้างงาน ครอบครัว/การหย่า และเรื่องกฎหมายอื่นๆ</li>`,
      `<li>รับเรื่องร้องเรียน/ร้องทุกข์ พร้อมแนบหลักฐาน และติดตามสถานะเรื่องได้ทาง LINE</li>`,
      `<li>จองคิวเข้ารับคำปรึกษากับทนายอาสา ผ่านเว็บไซต์หรือ LINE</li></ul>`,
      `<h2>สถานที่ให้บริการ</h2>`,
      `<p>${esc(LOC.room)} ${esc(LOC.place)}<br />${esc(LOC.address)}</p>`,
      `<p>ทนายอาสาให้คำปรึกษา ${esc(APPOINTMENT_INFO.lawyer_schedule)} ${esc(APPOINTMENT_INFO.lawyer_off)}</p>`,
    ].join(""),
  },
  cookies: {
    slug: "cookies", title: "นโยบายคุกกี้", show_in_menu: false, sort_order: 90, published: true,
    body_html: [
      `<p>เว็บไซต์นี้ใช้คุกกี้และพื้นที่จัดเก็บข้อมูลในเบราว์เซอร์ (localStorage) เท่าที่จำเป็น เพื่อให้เว็บไซต์ทำงานตามที่ท่านเลือก</p>`,
      `<h2>ประเภทที่ใช้</h2>`,
      `<ul><li><strong>ที่จำเป็น</strong> — จดจำขนาดตัวอักษร โหมดสี และการเลือกของท่านเรื่องคุกกี้ เก็บไว้ในเบราว์เซอร์ของท่านเท่านั้น ไม่ได้ส่งมายังศูนย์ฯ</li>`,
      `<li><strong>เนื้อหาจากผู้ให้บริการภายนอก</strong> — ฟีดเพจ Facebook แผนที่ Google Maps และวิดีโอ YouTube จะโหลดเมื่อท่านกดยอมรับหรือกดเปิดดูเท่านั้น ผู้ให้บริการเหล่านั้นอาจตั้งคุกกี้ของตนเองตามนโยบายของผู้ให้บริการ</li>`,
      `<li><strong>สถิติผู้เข้าชมไม่ซ้ำ</strong> — เมื่อท่านอนุญาตสถิติ เว็บไซต์จดจำรหัสสุ่มในเบราว์เซอร์และส่งให้ระบบแฮชเพื่อนับเบราว์เซอร์ที่ไม่ซ้ำ ไม่มีการใช้ชื่อ เบอร์โทร รหัส LINE ข้อมูลคดี หรือลายนิ้วมืออุปกรณ์ ตัวเลขจำนวนครั้งที่เปิดหน้าเว็บนับแยกโดยไม่ต้องใช้รหัสเบราว์เซอร์ เลือก "ใช้เฉพาะที่จำเป็น" เพื่อหยุดส่งรหัสและลบรหัสที่จดจำในเบราว์เซอร์ ตัวเลขสถิติที่ผ่านมาไม่ถูกหักย้อนหลัง</li>`,
      `<li><strong>ระบบเจ้าหน้าที่</strong> — คุกกี้สำหรับเข้าสู่ระบบ ใช้เฉพาะเจ้าหน้าที่ที่เข้าสู่ระบบหลังบ้านเท่านั้น</li></ul>`,
      `<h2>การเปลี่ยนการตั้งค่า</h2>`,
      `<p>ท่านเปลี่ยนการตั้งค่าได้ทุกเมื่อจากลิงก์ "ตั้งค่าคุกกี้" ที่ส่วนท้ายของทุกหน้า</p>`,
    ].join(""),
  },
  privacy: {
    slug: "privacy", title: "นโยบายคุ้มครองข้อมูลส่วนบุคคล", show_in_menu: false, sort_order: 91, published: false,
    body_html: [
      `<p><em>ร่างเริ่มต้นจากระบบ — กรุณาให้ผู้มีอำนาจตรวจทานและแก้ไขให้ตรงกับการปฏิบัติจริงก่อนกดเผยแพร่</em></p>`,
      `<h2>ข้อมูลที่เก็บ</h2>`,
      `<p>เมื่อท่านใช้แบบฟอร์มขอรับคำปรึกษา ร้องเรียน หรือจองคิว ศูนย์ฯ เก็บข้อมูลเท่าที่จำเป็นต่อการให้บริการ เช่น ชื่อ-นามสกุล เบอร์โทรศัพท์ อำเภอที่อยู่ รายละเอียดเรื่อง และไฟล์หลักฐานที่ท่านแนบ หากท่านติดต่อผ่าน LINE ระบบจะได้รับรหัสผู้ใช้ LINE ของท่านเพื่อใช้ตอบกลับและแจ้งสถานะเรื่อง</p>`,
      `<h2>วัตถุประสงค์</h2>`,
      `<p>เพื่อพิจารณาและให้ความช่วยเหลือทางกฎหมาย ติดต่อกลับ นัดหมาย และแจ้งความคืบหน้าของเรื่องที่ท่านยื่น รวมทั้งจัดทำสถิติและติดตามประเมินผลการดำเนินงานของศูนย์ฯ โดยไม่เปิดเผยข้อมูลส่วนบุคคลหรือรายละเอียดเกี่ยวกับคดีเกินกว่าที่จำเป็น</p>`,
      `<h2>การเข้าถึงและการส่งต่อข้อมูล</h2>`,
      `<p>เฉพาะเจ้าหน้าที่ที่ได้รับอนุญาตและผู้ที่เกี่ยวข้องกับการให้ความช่วยเหลือในเรื่องของท่านเท่านั้น ศูนย์ฯ อาจส่งต่อข้อมูลให้สภาทนายความจังหวัดสุพรรณบุรี ทนายความผู้ให้คำปรึกษา หรือหน่วยงานที่มีอำนาจหน้าที่โดยตรง เท่าที่จำเป็นต่อการให้ความช่วยเหลือ และมีมาตรการรักษาความมั่นคงปลอดภัยที่เหมาะสม</p>`,
      `<h2>ข้อความที่พิมพ์ในแชต LINE</h2>`,
      `<p>ข้อความที่ท่านพิมพ์ในแชตไว้แต่ยังไม่กดส่งเป็นเรื่อง ระบบจะลบทิ้งพร้อมไฟล์ที่แนบเมื่อพ้น 24 ชั่วโมงนับจากการแก้ไขล่าสุด และข้อความในแชตไม่ถูกส่งไปยังระบบปัญญาประดิษฐ์ (AI)</p>`,
      `<h2>สิทธิของเจ้าของข้อมูล</h2>`,
      `<p>ท่านมีสิทธิขอเข้าถึง แก้ไข หรือขอให้ลบข้อมูลของท่านตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 โดยติดต่อศูนย์ฯ ตามช่องทางในหน้าติดต่อเรา</p>`,
    ].join(""),
  },
});
