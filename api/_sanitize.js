/* api/_sanitize.js — กรอง HTML จากตัวแก้ข้อความ (Quill ในหลังบ้าน CMS) ให้เหลือเฉพาะแท็ก/แอตทริบิวต์ที่ปลอดภัย
   (เว็บไซต์ไดนามิก 30 ก.ย. 69 — สเปก docs/WEBSITE-SPEC.md หัวข้อ "ความปลอดภัย")

   ⛔ กติกาเหล็ก: HTML ที่ผู้ใช้พิมพ์ (body_html / answer_html) ต้องผ่าน sanitizeRichHtml() "ทั้งตอนบันทึก (api/_cms.js)
      และตอนแสดงผล (api/_site-render.js)" — กรอง 2 ชั้นกันกรณีกติกาเปลี่ยนภายหลังแล้วของเก่าใน DB ไม่ถูกกรองซ้ำ
   - ห้ามแท็ก script/style · แอตทริบิวต์ onXxx= · style="..." · ลิงก์ javascript:/data: ทุกรูปแบบ (ใช้ไลบรารี sanitize-html — ไม่เขียน regex กรองเอง)
   - รูปในเนื้อหาต้องมาจาก bucket site-media ของเราเอง หรือ /assets/ ของเว็บเท่านั้น (รูปจากเว็บอื่น = รั่ว IP ผู้ชม/ติดตามได้)
   - iframe ได้เฉพาะ YouTube แบบ embed และถูกบังคับเป็นโดเมน youtube-nocookie.com เสมอ
     (หน้าเว็บสาธารณะแปลง iframe นี้เป็นปุ่ม "กดเพื่อเล่นวิดีโอ" อีกชั้น — ไม่โหลดอะไรจาก YouTube ก่อนผู้ชมกดเอง ตาม PDPA)
   - ลิงก์ออกนอกเว็บได้ target=_blank + rel="noopener noreferrer nofollow" อัตโนมัติ */
import sanitizeHtml from "sanitize-html";
import { mediaPublicBase, siteUrl } from "./_site-shared.js";

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const YT_EMBED_RE = /^https:\/\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com)\/embed\/([A-Za-z0-9_-]{11})(?:[?#].*)?$/;
export function youtubeEmbedId(src) {
  const m = YT_EMBED_RE.exec(String(src || "").trim());
  return m ? m[1] : null;
}

export function isAllowedImageSrc(src) {
  const s = String(src || "").trim();
  if (!s) return false;
  if (/^\/assets\/[\w\-./]+$/.test(s) && !s.includes("..")) return true;
  if (!process.env.SUPABASE_URL) return false;
  const base = mediaPublicBase();
  return s.startsWith(base) && /^[\w\-./]+$/.test(s.slice(base.length)) && !s.includes("..");
}

const ALIGN = ["ql-align-center", "ql-align-right", "ql-align-justify"];
const INDENT = ["ql-indent-1", "ql-indent-2", "ql-indent-3", "ql-indent-4", "ql-indent-5", "ql-indent-6", "ql-indent-7", "ql-indent-8"];

function numAttr(v, max = 4000) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 && n <= max ? String(n) : null;
}

const RICH_OPTIONS = {
  allowedTags: [
    "p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "sub", "sup",
    "blockquote", "ul", "ol", "li", "a", "img", "figure", "figcaption", "hr", "span",
    "pre", "code", "iframe", "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "width", "height", "loading", "decoding"],
    iframe: ["src", "title", "allow", "allowfullscreen", "loading", "referrerpolicy", "frameborder"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
    ol: ["start"],
  },
  allowedClasses: {
    p: [...ALIGN, ...INDENT],
    h2: ALIGN, h3: ALIGN, h4: ALIGN,
    li: [...ALIGN, ...INDENT],
    blockquote: ALIGN,
    iframe: ["ql-video"],
  },
  allowedSchemes: ["https", "http", "mailto", "tel"],
  allowedSchemesByTag: { img: ["https"], iframe: ["https"] },
  allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
  allowProtocolRelative: false,
  allowedIframeHostnames: ["www.youtube-nocookie.com"],
  allowIframeRelativeUrls: false,
  transformTags: {
    h1: "h2",
    div: "p",
    a: (tagName, attribs) => {
      const href = String(attribs.href || "").trim();
      const out = {};
      if (href) out.href = href;
      if (attribs.title) out.title = attribs.title;
      const site = siteUrl();
      if (/^https?:\/\//i.test(href) && !(href === site || href.startsWith(site + "/"))) {
        out.target = "_blank";
        out.rel = "noopener noreferrer nofollow";
      }
      return { tagName: "a", attribs: out };
    },
    img: (tagName, attribs) => {
      const out = { src: String(attribs.src || "").trim(), alt: String(attribs.alt || ""), loading: "lazy", decoding: "async" };
      const w = numAttr(attribs.width); const h = numAttr(attribs.height);
      if (w) out.width = w;
      if (h) out.height = h;
      return { tagName: "img", attribs: out };
    },
    iframe: (tagName, attribs) => {
      const id = youtubeEmbedId(attribs.src);
      if (!id) return { tagName: "iframe", attribs: {} }; // ไม่มี src = ถูก exclusiveFilter ลบทิ้งทั้งแท็ก
      return {
        tagName: "iframe",
        attribs: {
          src: `https://www.youtube-nocookie.com/embed/${id}`,
          class: "ql-video",
          title: "วิดีโอ YouTube",
          allow: "accelerometer; encrypted-media; gyroscope; picture-in-picture",
          allowfullscreen: "",
          loading: "lazy",
          referrerpolicy: "strict-origin-when-cross-origin",
        },
      };
    },
  },
  exclusiveFilter: (frame) =>
    (frame.tag === "img" && !isAllowedImageSrc(frame.attribs.src)) ||
    (frame.tag === "iframe" && !youtubeEmbedId(frame.attribs.src)),
};

/* กรอง HTML เนื้อหา (ข่าว/บทความ/หน้าเนื้อหา/คำตอบ FAQ) — คืน string ที่ปลอดภัยต่อการแสดงผลตรงๆ */
export function sanitizeRichHtml(html) {
  return sanitizeHtml(String(html ?? ""), RICH_OPTIONS).trim();
}

/* เนื้อหาว่างจริงไหม (Quill ว่าง = "<p><br></p>") — ใช้ตรวจตอนบันทึก/ตัดสินใจแสดงส่วนนั้นหรือไม่ */
export function isBlankHtml(html) {
  const s = String(html ?? "");
  if (/<(img|iframe|table|hr)\b/i.test(s)) return false;
  return toPlainText(s) === "";
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k in NAMED) return NAMED[k];
    if (k.startsWith("#x")) { const n = parseInt(k.slice(2), 16); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    if (k.startsWith("#")) { const n = parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return m;
  });
}

/* HTML → ข้อความล้วน (ใช้ทำคำโปรย/คำอธิบาย SEO/og:description) — ผลลัพธ์ยังต้อง escapeHtml() ก่อนใส่ลง HTML เสมอ
   maxLen > 0 = ตัดให้ไม่เกินความยาวนี้ (รวม "…") */
export function toPlainText(html, maxLen = 0) {
  const spaced = String(html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|blockquote|div|tr|td|th|figcaption|pre)>/gi, "$& ");
  const text = decodeEntities(sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} }))
    .replace(/\s+/g, " ")
    .trim();
  if (maxLen > 0 && text.length > maxLen) return text.slice(0, Math.max(1, maxLen - 1)).trimEnd() + "…";
  return text;
}
