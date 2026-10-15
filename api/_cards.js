/* api/_cards.js — การ์ด Flex ทุกใบของระบบ (สูตรเดียว ที่เดียว ห้ามสร้างการ์ดซ้ำที่จุดอื่น)
   โทนสีตามภาพต้นแบบ: น้ำเงินเข้ม(น่าเชื่อถือ) ฟ้าอ่อน(เป็นมิตร) ขาว ทอง(ทางการ)
   ทุกใบต้องผ่าน clampMessages()/shrinkFlex() ที่ผู้เรียกใช้ ก่อนส่งออกจริง (ไม่ทำในไฟล์นี้ ให้ตัวเรียกทำ
   เพื่อให้ test-cards.mjs import ฟังก์ชันจากที่นี่มาตรวจตรงๆ ได้โดยไม่ต้องยิงเน็ต)

   🎨 30 ก.ย. 69 (งาน T1a — บอสสั่ง "ทำมาให้ผมอึ้งๆ" แบบ Traffy Fondue) ทับดีไซน์ 18 ก.ย. 69 บางส่วน:
   - หัวการ์ดทุกใบไล่สีน้ำเงิน (box `background` linearGradient — ตรวจรูปแบบใน assertFlexSafe) + ไอคอน 3 มิติเป็นรูป
     (Fluent Emoji 3D — MIT ดู public/assets/icons3d/) · ท้ายการ์ดมีแถบโลโก้คู่ อบจ.+สภาทนายความ (กฎข้อ 4)
   - ช่องเลือกแบบการ์ด "แจ้งแรงงาน" ของ Traffy = กล่อง box ที่มี action กดได้ (choiceTile)
   - ปุ่มบริการ ปรึกษา/จองคิว/ร้องเรียน ตอบ [ภาพวิธีขอรับบริการ] + [การ์ดหลักเกณฑ์] แบบ ทต.หนองป่าครั่ง (serviceReply)
   - ข้อความเนื้อหา/กฎหมายเดิมไม่เปลี่ยน (เนื้อหาหมวดอยู่ใน _keywords.js — ห้ามแก้ที่นี่) ผู้ตอบใช้ responder_label เสมอ */
import { fbPost, fbUri, fbMsg, footerButtons, isWellFormedUri } from "./_lineapi.js";
import { TOPICS } from "./_keywords.js";
import { isChatCase } from "./_cases.js";
import { DEFAULTS as SETTING_DEFAULTS } from "./_settings.js";
import {
  HOTLINES, SERVICE_TITLES, HOWTO_IMAGES, ASSET_VERSION, APPOINTMENT_INFO, APPOINTMENT_FALLBACK, CATEGORY_LABELS,
  MAP_DIR_URL, MAP_PIN_URL, visitPlaceLine,
} from "./_serviceinfo.js";

const NAVY = "#0B2E6D";
const LIGHT_BG = "#EAF3FC";
const GOLD = "#D9A93B";
const WHITE = "#FFFFFF";
const GRAY = "#5A6B85";
const DANGER = "#b3261e";
const OK = "#1e7d3c";

/* สีป้ายสถานะ — ใช้ชุดสีเดียวกับ .status-pill ใน public/staff.css เป๊ะๆ (เพิ่ม 18 ก.ย. 69 ให้การ์ดฝั่ง
   ประชาชนกับหลังบ้านเจ้าหน้าที่ "อ่านสถานะเดียวกันด้วยสีเดียวกัน" ไม่ใช่แค่กะสีเอาเอง) */
const STATUS_COLORS = {
  new: { bg: "#eef1f6", fg: GRAY },
  assigned: { bg: "#dce9ff", fg: "#1a4fa0" },
  in_progress: { bg: "#fff3cd", fg: "#8a6d00" },
  need_info: { bg: "#fde2e1", fg: DANGER },
  closed: { bg: "#d8f0e0", fg: OK },
  withdrawn: { bg: "#efe6f5", fg: "#6a4c93" },
};

/* หัวการ์ดไล่สี (30 ก.ย. 69) — navy = การ์ดทั่วไป · danger = เหตุด่วน */
const HEADER_TONES = {
  navy: { type: "linearGradient", angle: "135deg", startColor: NAVY, endColor: "#2B66CC" },
  danger: { type: "linearGradient", angle: "135deg", startColor: "#9E1B14", endColor: "#D93025" },
};

/* เบอร์ติดต่อประสานงาน อบจ.สุพรรณบุรี (บอสให้มาจากภาพ ปชส. 16 ก.ย. 69 — เจ้าของสั่งให้ใส่ครบทุกเบอร์
   รวมเบอร์ส่วนตัวรองนายกทั้ง 2 ท่านด้วย ไม่ตัดออก) — ตั้งใจ hardcode ไว้ที่นี่ที่เดียว (ไม่ผูกกับ #ตั้งค่า)
   เพราะเป็นข้อมูล ปชส. เปลี่ยนไม่บ่อย ต่างจาก responder_label/office_hours ที่แก้บ่อยผ่านไลน์
   ⚠️ ระบบ "สำนักปลัด อบจ." (คนละ repo) ทำการ์ดคล้ายกันนี้ไว้ก่อนแล้ว (16 ก.ย. 69 เช้า) แต่ตัดเบอร์ส่วนตัว
   รองนายกออก — ที่นี่ตั้งใจใส่ครบตามที่เจ้าของยืนยันชัดเจนสำหรับศูนย์นี้โดยเฉพาะ ไม่ใช่เผลอไม่ตรงกัน */
const ORG_CONTACT_NUMBERS = [
  { icon: "🚒", label: "งานสาธารณภัย (อัคคีภัย/อุทกภัย/กู้ชีพ/กู้ภัย)", phone: "035-528-666" },
  { icon: "🛠️", label: "งานบำรุงรักษาซ่อมแซม (ถนน/ไฟฟ้า/ผักตบชวา)", phone: "035-431-772" },
  { icon: "📹", label: "กล้องวงจรปิด CCTV", phone: "035-431-776" },
  { icon: "🚑", label: "งานสาธารณสุข (รถสุขาเคลื่อนที่/กำจัดยุงลาย)", phone: "035-431-778" },
  { icon: "🧾", label: "ชำระภาษี (ภาษีโรงแรม/ภาษีน้ำมัน)", phone: "035-431-761" },
  { icon: "🤝", label: "งานสวัสดิการสังคม (คนพิการ/ผู้สูงอายุ)", phone: "035-431-753" },
  { icon: "🆘", label: "ศูนย์รับแจ้งเหตุฉุกเฉิน", phone: "1669" },
  { icon: "📢", label: "ร้องทุกข์ร้องเรียน", phone: "035-431-752" },
  { icon: "👤", label: "รองนายก อบจ. (นายเสน่ห์ บุญสุข)", phone: "094-663-1114" },
  { icon: "👤", label: "รองนายก อบจ. (นายนิทัศน์ ลืออารีย์กุล)", phone: "084-324-2032" },
];

// แถวเบอร์โทรแตะแล้วโทรออกได้เลย (ตามแบบที่ผ่าน assertFlexSafe/test-cards.mjs มาแล้วในระบบสำนักปลัด อบจ.)
function contactNumberRow({ icon, label, phone }) {
  return {
    type: "box", layout: "horizontal", spacing: "md", margin: "md",
    action: fbUri("โทร " + phone, "tel:" + phone.replace(/-/g, "")),
    contents: [
      { type: "text", text: icon, size: "lg", flex: 0 },
      { type: "text", text: label, size: "xs", color: "#333333", wrap: true, flex: 1 },
      { type: "text", text: phone, size: "xs", weight: "bold", color: NAVY, flex: 0, align: "end" },
    ],
  };
}

function site() {
  return process.env.SITE_URL || "https://suphan-legalaid.vercel.app";
}

/* URL รูปที่เรนเดอร์เอง (ภาพวิธีขอรับบริการ/ภาพหัวการ์ด) — ต่อ ?v= เสมอ (ไลน์แคชรูปตาม URL เรนเดอร์ใหม่แล้วต้องเปลี่ยน
   ASSET_VERSION ใน _serviceinfo.js) · ไอคอน 3 มิติ/โลโก้เป็นไฟล์นิ่งไม่เปลี่ยนเนื้อหา ไม่ต่อ ?v= (ประหยัดไบต์การ์ด) */
function assetUrl(p) {
  return `${site()}/${p}?v=${ASSET_VERSION}`;
}
function staticUrl(p) {
  return `${site()}/${p}`;
}
export function iconUrl(name) {
  return staticUrl(`assets/icons3d/${name}.png`);
}

function telUri(phone) {
  return "tel:" + String(phone || "").replace(/[\s-]/g, "");
}

function disclaimerText() {
  return "ข้อมูลเบื้องต้นเท่านั้น ไม่ใช่คำวินิจฉัยทางกฎหมายเฉพาะคดี กรณีของท่านอาจมีรายละเอียดต่างกัน";
}

function officeHoursText(settings) {
  const oh = settings.office_hours;
  return `${oh.days} ${oh.start}–${oh.end} น. (หยุดวันหยุดราชการ)`;
}

/* รูปไอคอน 3 มิติ — image ห้ามใส่ cornerRadius/backgroundColor/paddingAll (assertFlexSafe ดักไว้)
   ไม่ใส่ aspectRatio/aspectMode เพราะค่าเริ่มต้นของ LINE คือ "1:1"/"fit" อยู่แล้ว (ประหยัดไบต์ การ์ดเมนูมีรูปหลายจุด) */
function iconImage(name, size = "56px", extra = {}) {
  return { type: "image", url: iconUrl(name), size, ...extra };
}

function header(title, subtitle, { icon, tone = "navy" } = {}) {
  return {
    type: "box", layout: "horizontal", background: HEADER_TONES[tone] || HEADER_TONES.navy,
    paddingAll: "16px", spacing: "md", alignItems: "center",
    contents: [
      {
        type: "box", layout: "vertical", flex: 1, spacing: "xs",
        contents: [
          { type: "text", text: title, color: WHITE, weight: "bold", size: "lg", wrap: true },
          ...(subtitle ? [{ type: "text", text: subtitle, color: tone === "danger" ? "#FFE3A3" : GOLD, size: "xs", wrap: true }] : []),
        ],
      },
      ...(icon ? [iconImage(icon, "56px", { flex: 0 })] : []),
    ],
  };
}

/* แถบโลโก้คู่ท้ายการ์ด (แบบแถบโลโก้ท้ายการ์ด "แจ้งแรงงาน" ของ Traffy) — โลโก้คู่ อบจ.+สภาทนายความ ตามกฎข้อ 4 */
function brandStrip() {
  return {
    type: "box", layout: "horizontal", spacing: "sm", alignItems: "center", paddingTop: "10px",
    contents: [
      { type: "image", url: staticUrl("assets/logo-pao.png"), size: "28px", flex: 0 },
      { type: "image", url: staticUrl("assets/logo-lawyers-council-sm.png"), size: "28px", flex: 0 },
      { type: "text", text: "อบจ.สุพรรณบุรี · สภาทนายความจังหวัดสุพรรณบุรี", size: "xxs", color: GRAY, wrap: true, flex: 1 },
    ],
  };
}

function bubble({ heroUrl, heroRatio = "20:13", headerTitle, headerSubtitle, headerIcon, tone, bodyContents, buttons, altText, brand = true }) {
  const footerContents = [];
  if (buttons && buttons.length) footerContents.push(footerButtons(buttons));
  if (brand) footerContents.push(brandStrip());
  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      ...(heroUrl ? { hero: { type: "image", url: heroUrl, size: "full", aspectRatio: heroRatio, aspectMode: "cover" } } : {}),
      ...(headerTitle ? { header: header(headerTitle, headerSubtitle, { icon: headerIcon, tone }) } : {}),
      body: { type: "box", layout: "vertical", spacing: "md", paddingAll: "16px", backgroundColor: WHITE, contents: bodyContents },
      ...(footerContents.length ? { footer: { type: "box", layout: "vertical", paddingAll: "12px", contents: footerContents } } : {}),
    },
  };
}

function textBlock(t, opts = {}) {
  return {
    type: "text", text: t, wrap: true, color: opts.color || "#333333", size: opts.size || "sm", weight: opts.weight,
    ...(opts.margin ? { margin: opts.margin } : {}), ...(opts.align ? { align: opts.align } : {}),
  };
}

/* ป้ายสถานะทรงแคปซูล (แทนตัวหนังสือเปล่าๆ) — เพิ่ม 18 ก.ย. 69 ให้เห็นสถานะปุ๊บรู้ปั๊บเหมือนหลังบ้าน
   backgroundColor/cornerRadius ใส่ได้เฉพาะบน box (ห้ามใส่บน image) — assertFlexSafe ใน _lineapi.js
   ตรวจเรื่องนี้อยู่แล้ว ผ่านแน่นอนเพราะเป็น box ล้วน — ครอบด้วย box แนวนอน flex:0 ชั้นนอกเพื่อให้แคปซูล
   "หด" พอดีตัวอักษร ไม่ยืดเต็มความกว้างการ์ด (พฤติกรรมเริ่มต้นของ box แนวตั้งใน Flex คือยืดเต็ม parent) */
function statusBadge(status, label) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.new;
  return {
    type: "box", layout: "horizontal",
    contents: [{
      type: "box", layout: "vertical", flex: 0, backgroundColor: c.bg, cornerRadius: "20px",
      paddingAll: "4px", paddingStart: "12px", paddingEnd: "12px",
      contents: [{ type: "text", text: label, size: "xs", weight: "bold", color: c.fg, align: "center" }],
    }],
  };
}

/* กล่องเน้นข้อความ (ใช้แทน textBlock สีเทาเล็กๆ เดิม ตอนต้องการให้สะดุดตากว่าปกติ — เช่น คำปฏิเสธความรับผิด
   ทางกฎหมาย/เบอร์ฉุกเฉิน) เพิ่ม 18 ก.ย. 69 */
function highlightBox(text, { bg = LIGHT_BG, fg = NAVY, size = "sm", weight, margin, align } = {}) {
  return {
    type: "box", layout: "vertical", backgroundColor: bg, cornerRadius: "10px", paddingAll: "10px",
    ...(margin ? { margin } : {}),
    contents: [{ type: "text", text, wrap: true, size, color: fg, weight, ...(align ? { align } : {}) }],
  };
}

function bulletList(items) {
  return items.map((it) => ({
    type: "box", layout: "baseline", spacing: "sm",
    contents: [
      { type: "text", text: "•", color: GOLD, flex: 0 },
      { type: "text", text: it, wrap: true, size: "sm", color: "#333333" },
    ],
  }));
}

/* ช่องเลือกแบบการ์ด "แจ้งแรงงาน" ของ Traffy — กล่องกดได้ทั้งกล่อง (box action) ไอคอน 3 มิติ + หัวข้อ + คำอธิบาย */
function choiceTile({ icon, title, desc, action, tone = "light" }) {
  const dark = tone === "danger";
  return {
    type: "box", layout: "vertical", flex: 1, spacing: "xs", paddingAll: "10px", cornerRadius: "12px",
    backgroundColor: dark ? "#FDE2E1" : LIGHT_BG, borderWidth: "1px", borderColor: dark ? "#F2B8B5" : "#C9DAF0",
    action,
    contents: [
      iconImage(icon, "56px"),
      { type: "text", text: title, size: "sm", weight: "bold", color: dark ? DANGER : NAVY, align: "center", wrap: true },
      ...(desc ? [{ type: "text", text: desc, size: "xxs", color: GRAY, align: "center", wrap: true }] : []),
    ],
  };
}

/* จัดช่องเลือกเป็นแถวละ perRow ช่อง (ไม่ใช้ component "filler" — LINE ไม่แนะนำแล้ว ช่องเศษท้ายแถวจะกว้างเต็มแถวแทน) */
function choiceGrid(tiles, perRow = 2) {
  const rows = [];
  for (let i = 0; i < tiles.length; i += perRow) {
    rows.push({ type: "box", layout: "horizontal", spacing: "sm", contents: tiles.slice(i, i + perRow) });
  }
  return { type: "box", layout: "vertical", spacing: "sm", contents: rows };
}

/* แถวรายการกดได้ (ไอคอน 3 มิติ + หัวข้อ + คำอธิบาย) — ใช้ในเมนูหลัก (9 แถว — ไม่ใส่ลูกศร/ของตกแต่งเพิ่ม การ์ดใกล้เพดานไบต์) */
function listRow({ icon, title, desc, action, titleColor = NAVY }) {
  return {
    type: "box", layout: "horizontal", spacing: "md", alignItems: "center", paddingAll: "8px",
    cornerRadius: "10px", backgroundColor: LIGHT_BG, action,
    contents: [
      iconImage(icon, "40px", { flex: 0 }),
      {
        type: "box", layout: "vertical", flex: 1,
        contents: [
          { type: "text", text: title, size: "sm", weight: "bold", color: titleColor, wrap: true },
          ...(desc ? [{ type: "text", text: desc, size: "xxs", color: GRAY, wrap: true }] : []),
        ],
      },
    ],
  };
}

/* แถวข้อมูลสั้นมีไอคอน 3 มิติ (การ์ดหลักเกณฑ์/เกี่ยวกับศูนย์) */
function infoRow(icon, text, opts = {}) {
  return {
    type: "box", layout: "horizontal", spacing: "md", alignItems: "center",
    contents: [iconImage(icon, "24px", { flex: 0 }), { type: "text", text, size: "xs", color: opts.color || "#333333", wrap: true, flex: 1, weight: opts.weight }],
  };
}

function sectionTitle(t, margin = "md") {
  return { type: "text", text: t, size: "xs", weight: "bold", color: NAVY, margin };
}

/* ═══ 0. ข้อความต้อนรับ (follow event) — บอสสั่ง 30 ก.ย. 69 แบบ "ตัวอย่าง ข้อความต้อนรับ.jpg" (ทต.หนองป่าครั่ง)
   ทักชื่อ + เวลาทำการ + เบอร์ศูนย์ + สายด่วน 4 เบอร์ (HOTLINES ใน _serviceinfo.js ที่ Hermes ตรวจแล้ว) + ชวนเลือกเมนู
   ⛔ ห้ามเขียนทำนอง "ฝากข้อความไว้ เจ้าหน้าที่จะตอบในแชต" (ยังไม่มีคนเฝ้าแชต — กฎเดียวกับ handoffCard) ═══ */
const DISPLAY_NAME_MAX = 30;
/* ชื่อไลน์ของผู้ใช้ (ผู้ใช้ตั้งเองได้ทุกอย่าง) → ตัดอักขระควบคุม/ตัวจัดรูปแบบที่มองไม่เห็น ยุบช่องว่าง จำกัด 30 ตัว
   คืน null ถ้าไม่เหลืออะไร (ผู้เรียกใช้ "สวัสดีค่ะ" เฉยๆ) — เก็บ ZWJ (U+200D) ไว้ อีโมจิครอบครัว/อาชีพจะได้ไม่แตก */
export function cleanDisplayName(raw) {
  if (typeof raw !== "string") return null;
  const s = raw
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/[​‌‎‏‪-‮⁠-⁤⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  const chars = Array.from(s);
  return chars.length > DISPLAY_NAME_MAX ? chars.slice(0, DISPLAY_NAME_MAX).join("").trim() + "…" : s;
}

export function welcomeMessage(name, settings) {
  const who = name ? `สวัสดีค่ะ ${name.startsWith("คุณ") ? "" : "คุณ"}${name} 🙏` : "สวัสดีค่ะ 🙏";
  const hotlines = HOTLINES.map((h) => `${h.number} ${h.short}`).join("\n");
  const text = [
    who,
    "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี ยินดีต้อนรับค่ะ",
    "",
    "⚖️ ให้คำปรึกษากฎหมายเบื้องต้น ไม่มีค่าใช้จ่าย",
    `🕗 เวลาทำการ ${officeHoursText(settings)}`,
    `☎️ โทร ${settings.phone}`,
    "",
    `💬 พิมพ์เล่าเรื่องที่ต้องการปรึกษาหรือร้องเรียนในแชตนี้ได้เลยค่ะ (แนบรูปหรือเอกสารได้) แล้วกดปุ่ม "ส่งเป็นเรื่อง" ในการ์ดที่ระบบส่งให้ ${settings.responder_label}จะรับเรื่องและติดต่อกลับ`,
    "👇 หรือเลือกบริการจากเมนูด้านล่างของแชต",
    "",
    `🚨 เหตุฉุกเฉิน โทรได้ตลอด 24 ชม.\n${hotlines}`,
  ].join("\n");
  return { type: "text", text };
}

/* ═══ 0b. โปสเตอร์ศูนย์ฯ v2 — บอสสั่ง 2 ต.ค. 69 "ไม่ต้องใส่รูปใน card flex ให้ส่งเป็นรูป v2 ไปแทน ตรงๆ"
   image message เห็นเต็มใบ แตะขยายได้ · ไฟล์ public/assets/poster-v2.jpg (2000×1414 ≤10MB) + poster-v2-preview.jpg (1040px ≤1MB)
   ทำจาก "ศูนย์ช่วยเหลือประชาชนทางกฏหมาย poster pr v2.png" ที่ root (เปลี่ยนโปสเตอร์ = ทำไฟล์ใหม่ทับ + เปลี่ยน ASSET_VERSION) ═══ */
export const WELCOME_POSTER = { full: "assets/poster-v2.jpg", preview: "assets/poster-v2-preview.jpg" };
export function welcomePosterMessage() {
  return { type: "image", originalContentUrl: assetUrl(WELCOME_POSTER.full), previewImageUrl: assetUrl(WELCOME_POSTER.preview) };
}

/* ═══ 1. การ์ดต้อนรับ (follow event — ส่งต่อจาก [ข้อความทักชื่อ] + [โปสเตอร์ v2])
   2 ต.ค. 69: ไม่มีรูปใหญ่ในการ์ดแล้ว (โปสเตอร์ส่งเป็นรูปแยก) — หัวไล่สี + ช่องเลือก 2×2 + ปุ่มบริการทั้งหมด
   ช่องที่ 2 = จองคิว (ปิดสวิตช์ = ความรู้กฎหมาย) · ช่องที่ 4 = แจ้งเรื่องทางแชต (lg:chatintake)
   name ไม่ใช้ในการ์ด (ทักชื่อใน welcomeMessage) — คงพารามิเตอร์ไว้ให้ผู้เรียกเดิมไม่พัง ═══ */
export function greetingCard(name, settings = {}) {
  const apptOn = settings.appointment_enabled !== false;
  const tiles = [
    choiceTile({ icon: "balance_scale", title: "ขอรับคำปรึกษา", desc: "เจ้าหน้าที่โทรกลับ", action: fbPost("⚖️ ขอรับคำปรึกษากฎหมาย", "lg:consult") }),
    apptOn
      ? choiceTile({ icon: "spiral_calendar", title: "จองคิว", desc: "เลือกวันเวลาที่สะดวก", action: fbPost("📅 จองคิวเข้ารับคำปรึกษา", "lg:appointment") })
      : choiceTile({ icon: "books", title: "ความรู้กฎหมาย", desc: "เรื่องใกล้ตัว", action: fbPost("📚 ความรู้กฎหมายใกล้ตัว", "lg:knowledge") }),
    choiceTile({ icon: "memo", title: "ร้องเรียน / ร้องทุกข์", desc: "แนบหลักฐานได้", action: fbPost("📝 ร้องเรียน / ร้องทุกข์", "lg:complaint") }),
    choiceTile({ icon: "speech_balloon", title: "แจ้งเรื่องทางแชต", desc: "พิมพ์เล่าได้เลย", action: fbPost("💬 แจ้งเรื่องทางแชต", "lg:chatintake") }),
  ];
  return bubble({
    headerTitle: "ยินดีให้บริการค่ะ", headerSubtitle: "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี", headerIcon: "classical_building",
    altText: "ยินดีต้อนรับสู่ศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี — เลือกบริการที่ต้องการ",
    bodyContents: [
      textBlock("สภาทนายความจังหวัดสุพรรณบุรี ร่วมกับ องค์การบริหารส่วนจังหวัดสุพรรณบุรี", { size: "xs", color: GRAY }),
      textBlock("เลือกบริการที่ต้องการได้เลยค่ะ", { weight: "bold", color: NAVY, margin: "md" }),
      choiceGrid(tiles, 2),
      textBlock("(" + disclaimerText() + ")", { size: "xxs", color: GRAY, margin: "sm" }),
    ],
    buttons: [{ action: fbPost("➕ ดูบริการทั้งหมด", "lg:help"), style: "secondary" }],
  });
}

/* ═══ 2. เมนูหลัก — เปิดเมื่อผู้ใช้ขอเองเท่านั้น (พิมพ์ "เมนู" / ปุ่มกลับเมนูหลัก / postback ที่ไม่รู้จัก)
   ⛔ 28 ก.ย. 69 เลิกใช้เป็นคำตอบข้อความที่พิมพ์คุยเอง (เคยเด้งทุกประโยค) — ข้อความพวกนั้นใช้ chatReceivedCard()
   ผ่านตัวกั้นซ้ำใน _chatgate.js แทน ข้อความในการ์ดนี้จึงไม่ขึ้นต้นว่า "ขออภัย ยังไม่เข้าใจ" อีก
   30 ก.ย. 69: รายการแถวกดได้ครบทุกบริการเท่ากับริชเมนู v2 (settings ไม่บังคับ — ไม่ส่งมา = แสดงจองคิวเสมอ
   ปุ่มจองคิวตอนสวิตช์ปิดยังตอบการ์ด appointmentUnavailableCard อยู่ดี) ═══ */
export function mainMenuCard(settings = {}) {
  const rows = [
    listRow({ icon: "balance_scale", title: "ขอรับคำปรึกษากฎหมาย", desc: "กรอกแบบฟอร์ม เจ้าหน้าที่โทรกลับ", action: fbPost("⚖️ ขอรับคำปรึกษากฎหมาย", "lg:consult") }),
    ...(settings.appointment_enabled === false ? [] : [
      listRow({ icon: "spiral_calendar", title: "จองคิวเข้ารับคำปรึกษา", desc: "เลือกวันและเวลาที่สะดวก", action: fbPost("📅 จองคิวเข้ารับคำปรึกษา", "lg:appointment") }),
    ]),
    listRow({ icon: "memo", title: "ร้องเรียน / ร้องทุกข์", desc: "แนบหลักฐานได้", action: fbPost("📝 ร้องเรียน / ร้องทุกข์", "lg:complaint") }),
    listRow({ icon: "magnifying_glass_tilted_left", title: "ติดตามเรื่อง", desc: "พิมพ์เลขที่เรื่อง", action: fbPost("🔍 ติดตามเรื่อง", "lg:track", { inputOption: "openKeyboard", fillInText: "LG-" }) }),
    listRow({ icon: "books", title: "ความรู้กฎหมายใกล้ตัว", action: fbPost("📚 ความรู้กฎหมายใกล้ตัว", "lg:knowledge") }),
    listRow({ icon: "red_question_mark", title: "คำถามที่พบบ่อย", action: fbPost("❓ คำถามที่พบบ่อย", "lg:faq") }),
    listRow({ icon: "telephone", title: "ติดต่อเรา", action: fbPost("☎️ ติดต่อเรา", "lg:contact") }),
    listRow({ icon: "classical_building", title: "เกี่ยวกับศูนย์", action: fbPost("🏛️ เกี่ยวกับศูนย์", "lg:about") }),
    listRow({ icon: "police_car_light", title: "เหตุด่วน / สายด่วน", desc: "191 · 1669 · 1300 · 1441", titleColor: DANGER, action: fbPost("🚨 เหตุด่วน / สายด่วน", "lg:urgent") }),
  ];
  return bubble({
    headerTitle: "เมนูหลัก", headerSubtitle: "เลือกรายการที่ต้องการ", headerIcon: "plus",
    altText: "เมนูหลัก ศูนย์ช่วยเหลือประชาชนทางกฎหมาย",
    bodyContents: [{ type: "box", layout: "vertical", spacing: "sm", contents: rows }],
  });
}

/* ═══ 2e. ขอความช่วยเหลือ (ปุ่มหลักสีเข้มในริชเมนู v2 — 30 ก.ย. 69) แบบการ์ด "แจ้งแรงงาน" ของ Traffy:
   ช่องเลือกบริการกดได้ 2×2 + ปุ่มรอง ═══ */
export function helpCard(settings = {}) {
  const apptOn = settings.appointment_enabled !== false;
  const tiles = [
    choiceTile({ icon: "balance_scale", title: "ขอรับคำปรึกษากฎหมาย", desc: "ออนไลน์ เจ้าหน้าที่โทรกลับ", action: fbPost("⚖️ ขอรับคำปรึกษากฎหมาย", "lg:consult") }),
    apptOn
      ? choiceTile({ icon: "spiral_calendar", title: "จองคิวเข้ารับคำปรึกษา", desc: "เลือกวันและเวลาที่สะดวก", action: fbPost("📅 จองคิวเข้ารับคำปรึกษา", "lg:appointment") })
      : choiceTile({ icon: "books", title: "ความรู้กฎหมายใกล้ตัว", desc: "หนี้สิน มรดก ถูกโกง ฯลฯ", action: fbPost("📚 ความรู้กฎหมายใกล้ตัว", "lg:knowledge") }),
    choiceTile({ icon: "memo", title: "ร้องเรียน / ร้องทุกข์", desc: "แนบหลักฐานได้", action: fbPost("📝 ร้องเรียน / ร้องทุกข์", "lg:complaint") }),
    choiceTile({ icon: "police_car_light", title: "เหตุด่วน / สายด่วน", desc: "191 · 1669 · 1300 · 1441", tone: "danger", action: fbPost("🚨 เหตุด่วน / สายด่วน", "lg:urgent") }),
  ];
  return bubble({
    headerTitle: "ขอความช่วยเหลือ", headerSubtitle: "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี", headerIcon: "plus",
    altText: "ขอความช่วยเหลือ — เลือกบริการที่ต้องการ",
    bodyContents: [
      textBlock("เลือกบริการที่ต้องการ แตะที่ช่องได้เลยค่ะ", { weight: "bold", color: NAVY }),
      choiceGrid(tiles, 2),
    ],
    buttons: [
      { action: fbPost("🔍 ติดตามเรื่อง", "lg:track", { inputOption: "openKeyboard", fillInText: "LG-" }), style: "secondary" },
      { action: fbPost("☎️ ติดต่อเรา", "lg:contact"), style: "secondary" },
    ],
  });
}

/* ═══ 2b. ตอบข้อความที่พิมพ์คุยเอง/รูป-ไฟล์ที่ส่งลอยๆ (เพิ่ม 28 ก.ย. 69) — ส่งครั้งเดียวต่อ QUIET_WINDOW_MS
   ต่อคน (ตัวกั้นอยู่ใน _chatgate.js) หลังจากนั้นบอทเงียบ ปล่อยให้เจ้าหน้าที่คุยต่อใน LINE OA Manager ได้โดยไม่มี
   การ์ดแทรก — ข้อความในการ์ดต้องจริงเสมอไม่ว่าจะมีคนเฝ้าแชตหรือไม่: ไม่สัญญาว่าจะตอบในแชต แต่บอกว่าข้อความในแชต
   ยังไม่เป็นเรื่องในระบบ แล้วชี้ไปแบบฟอร์ม (ช่องทางเดียวที่มีเลขที่เรื่อง/ติดตามได้จริง)
   ⚠️ 2 ต.ค. 69: ปกติใช้ intakeOfferCard (ข้อ 2f รับเรื่องทางแชต) แทนแล้ว — การ์ดนี้เหลือเป็นทางถอยตอนยังไม่รัน migration-14/DB ร่างล่ม ═══ */
export function chatReceivedCard(responderLabel) {
  return bubble({
    headerTitle: "ได้รับข้อความของท่านแล้ว", headerSubtitle: "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี", headerIcon: "speech_balloon",
    altText: "ได้รับข้อความของท่านแล้ว",
    bodyContents: [
      textBlock(`ข้อความหรือรูปที่ส่งในแชตนี้ยังไม่ได้บันทึกเป็นเรื่องในระบบ หากต้องการให้${responderLabel}รับเรื่องและติดต่อกลับ กรุณากดปุ่มด้านล่างเพื่อกรอกแบบฟอร์ม`),
      highlightBox("ต้องการเปิดเมนูอีกครั้ง พิมพ์คำว่า \"เมนู\" หรือกดแถบเมนูด้านล่างของแชตได้ตลอดเวลา", { size: "xs" }),
    ],
    buttons: [
      { action: fbPost("⚖️ ปรึกษาข้อกฎหมาย", "lg:consult") },
      { action: fbPost("📝 ฝากเรื่องร้องเรียน", "lg:complaint"), style: "secondary" },
      { action: fbPost("📋 เมนูทั้งหมด", "lg:menu"), style: "secondary" },
    ],
  });
}

/* ═══ 2f. รับเรื่องทางแชต (2 ต.ค. 69) — บอสสั่ง "เวลาประชาชนพิมพ์ text มาให้รับเรื่องได้ด้วย ไม่จำเป็นต้องกรอกแบบฟอร์มอย่างเดียว"
   มติบอส "เล่าอิสระ แล้วกดยืนยัน": ข้อความ/รูป/PDF เก็บเป็นร่าง (api/_chatintake.js) → การ์ดนี้ให้กดส่ง → ได้เลขที่เรื่อง
   ทับ chatReceivedCard (28 ก.ย. 69) เมื่อรัน migration-14 แล้ว — chatReceivedCard เหลือไว้เป็นทางถอยตอนยังไม่มีตาราง chat_drafts
   ⛔ ห้ามสัญญาว่า "เจ้าหน้าที่จะตอบในแชตนี้" (ยังไม่มีคนเฝ้าแชต — กฎ handoffCard) · ใช้ responder_label · ลงท้าย "ค่ะ/คะ" (มติบอส 2 ต.ค. 69) ═══ */
export const INTAKE_PDPA_TEXT = "การกดส่งเรื่อง ถือว่ายินยอมให้ศูนย์ฯ ใช้ข้อมูลเพื่อติดต่อกลับและช่วยเหลือตามคำขอ";

/* ปุ่มเปิดคีย์บอร์ดให้พิมพ์ต่อ (แถบริชเมนูบังช่องพิมพ์ — กดแล้วคีย์บอร์ดขึ้นทันที) · ไม่มี displayText = ไม่มีข้อความโผล่ในแชต
   postback lg:intake:type บอทตั้งใจไม่ตอบ (SILENT_POSTBACKS ใน _chatgate.js — ไม่โชว์ "กำลังพิมพ์..." ค้างด้วย) */
function typeAction(label) {
  return { type: "postback", label, data: "lg:intake:type", inputOption: "openKeyboard" };
}

function intakeSubmitButtons(settings = {}, openCaseNo = null) {
  return [
    { action: fbPost("⚖️ ส่งเป็นเรื่องขอคำปรึกษา", "lg:intake:consult") },
    ...(settings.appointment_enabled === false ? [] : [{ action: fbPost("📅 ขอนัดพบทนายอาสา", "lg:intake:appointment"), style: "secondary" }]),
    { action: fbPost("📝 ส่งเป็นเรื่องร้องเรียน/ร้องทุกข์", "lg:intake:complaint"), style: "secondary" },
    ...(openCaseNo ? [{ action: fbPost(`➕ เพิ่มข้อมูลเข้าเรื่อง ${openCaseNo}`, `lg:intake:append:${openCaseNo}`), style: "secondary" }] : []),
  ];
}

function intakeSummaryBox(summary) {
  const s = summary || {};
  const counts = [`📝 ข้อความ ${s.texts || 0}`, `📎 ไฟล์ ${s.files || 0}`, ...(s.locations ? [`📍 พิกัด ${s.locations}`] : [])].join("  ·  ");
  return highlightBox(counts + (s.preview ? `\n“${s.preview}”` : ""), { size: "xs" });
}

const INTAKE_STEPS = [
  "พิมพ์เล่าเรื่องที่ต้องการแจ้ง พร้อมชื่อ-นามสกุล และเบอร์โทรติดต่อกลับ",
  "แนบรูปภาพหรือไฟล์ PDF ที่เกี่ยวข้อง (ถ้ามี)",
  "กดปุ่มส่งเรื่องในการ์ดที่ระบบส่งให้",
  "รับเลขที่เรื่องไว้ติดตามผลในแชตนี้",
];
function stepRows(steps) {
  return steps.map((t, i) => ({
    type: "box", layout: "baseline", spacing: "sm",
    contents: [
      { type: "text", text: `${i + 1}.`, size: "sm", weight: "bold", color: GOLD, flex: 0 },
      { type: "text", text: t, size: "sm", color: "#333333", wrap: true },
    ],
  }));
}

/* การ์ดรับเรื่อง — ตอบข้อความเล่าเรื่อง/รูป/ไฟล์ครั้งแรก (ผ่านตัวกั้น FALLBACK_KIND 12 ชม.) · openCaseNo = เรื่องเดิมที่ยังเปิดอยู่ */
export function intakeOfferCard(summary, settings = {}, { openCaseNo = null } = {}) {
  const r = settings.responder_label || "เจ้าหน้าที่";
  return bubble({
    headerTitle: "ได้รับข้อความแล้วค่ะ", headerSubtitle: "แจ้งเรื่องทางแชตได้เลย ไม่ต้องกรอกแบบฟอร์ม", headerIcon: "speech_balloon",
    altText: "ได้รับข้อความแล้วค่ะ — กดส่งเป็นเรื่องเพื่อรับเลขที่เรื่อง",
    bodyContents: [
      intakeSummaryBox(summary),
      textBlock("พิมพ์รายละเอียด ชื่อ-นามสกุล เบอร์โทร หรือแนบรูปเพิ่มได้ก่อนกดส่งค่ะ", { weight: "bold", color: NAVY }),
      textBlock(`เมื่อพร้อมแล้ว เลือกปุ่มด้านล่าง ระบบจะออกเลขที่เรื่องให้ และแจ้ง${r}ทันทีค่ะ`, { size: "xs", color: GRAY }),
      textBlock(`${INTAKE_PDPA_TEXT} · หากไม่กดส่ง ข้อความจะถูกลบอัตโนมัติภายใน 24 ชั่วโมง`, { size: "xxs", color: GRAY, margin: "md" }),
    ],
    buttons: intakeSubmitButtons(settings, openCaseNo),
  });
}

/* กดปุ่มส่ง แต่ร่างว่าง/หมดอายุ (หรือกด "เพิ่มข้อมูลเข้าเรื่อง" โดยยังไม่ได้พิมพ์อะไร) */
export function intakeEmptyCard(settings = {}, { forAppend = false } = {}) {
  return bubble({
    headerTitle: forAppend ? "พิมพ์ข้อมูลที่ต้องการเพิ่มก่อนนะคะ" : "ยังไม่มีรายละเอียดเรื่องค่ะ", headerIcon: "speech_balloon",
    altText: "กรุณาพิมพ์รายละเอียดในแชตก่อนกดส่งค่ะ",
    bodyContents: [
      textBlock(forAppend
        ? "พิมพ์ข้อความหรือแนบรูป/PDF ที่ต้องการเพิ่มในแชตนี้ แล้วกดปุ่ม \"เพิ่มข้อมูลเข้าเรื่อง\" อีกครั้งค่ะ"
        : "กรุณาพิมพ์เล่าเรื่องที่ต้องการแจ้งในแชตนี้ก่อน แล้วกดปุ่มส่งเรื่องอีกครั้งค่ะ"),
      ...(forAppend ? [] : [sectionTitle("วิธีแจ้งเรื่องทางแชต"), ...stepRows(INTAKE_STEPS)]),
    ],
    buttons: [
      { action: typeAction("✏️ เริ่มพิมพ์ในแชต") },
      ...(forAppend ? [] : [{ action: fbPost("📋 เลือกกรอกแบบฟอร์มแทน", "lg:help"), style: "secondary" }]),
    ],
  });
}

/* ขอเบอร์ติดต่อกลับ 1 ครั้งก่อนส่ง (ข้ามได้) — reminder = เตือนซ้ำระหว่างรอ (ไม่เกิน 1 ครั้ง/10 นาที) */
export function intakePhoneCard(settings = {}, { reminder = false, type = null } = {}) {
  const r = settings.responder_label || "เจ้าหน้าที่";
  const why = type === "appointment" ? `เพื่อให้${r}โทรนัดวัน-เวลาเข้าพบทนายอาสา` : `เพื่อให้${r}ติดต่อกลับได้สะดวก`;
  return bubble({
    headerTitle: reminder ? "ยังรอเบอร์โทรติดต่อกลับค่ะ" : "ขอเบอร์โทรติดต่อกลับค่ะ", headerSubtitle: "ขั้นสุดท้ายก่อนส่งเรื่อง", headerIcon: "telephone_receiver",
    altText: "กรุณาพิมพ์เบอร์โทรติดต่อกลับเพื่อส่งเรื่องค่ะ",
    bodyContents: [
      textBlock(`${why} กรุณาพิมพ์เบอร์โทรศัพท์ในแชตนี้ได้เลยค่ะ`, { weight: "bold", color: NAVY }),
      highlightBox("ตัวอย่าง 0812345678", { weight: "bold", align: "center" }),
      ...(reminder ? [textBlock("ข้อความที่พิมพ์เพิ่มระหว่างนี้ ระบบเก็บรวมไว้ในเรื่องให้แล้วค่ะ", { size: "xs" })] : []),
      textBlock("หากไม่สะดวกให้เบอร์ กด \"ข้ามขั้นตอนนี้\" ได้ค่ะ ระบบจะส่งเรื่องให้ทันที และแจ้งความคืบหน้าผ่านแชตนี้", { size: "xs", color: GRAY }),
    ],
    buttons: [
      { action: typeAction("📞 พิมพ์เบอร์โทรศัพท์") },
      { action: fbPost("⏭️ ข้ามขั้นตอนนี้", "lg:intake:skipphone"), style: "secondary" },
      { action: fbPost("✖️ ยกเลิกการส่ง", "lg:intake:cancel"), style: "secondary" },
    ],
  });
}

/* ปุ่ม "💬 พิมพ์เล่าในแชตแทน" (lg:chatintake) — วิธีแจ้งเรื่องทางแชต 4 ขั้น + ร่างปัจจุบันพร้อมปุ่มส่ง (ถ้ามีร่าง) */
export function intakeHowtoCard(settings = {}, summary = null, { openCaseNo = null } = {}) {
  const hasDraft = !!summary && (summary.texts || summary.files || summary.locations);
  return bubble({
    headerTitle: "แจ้งเรื่องทางแชต", headerSubtitle: "ไม่ต้องกรอกแบบฟอร์ม · ทำได้ใน 4 ขั้นตอน", headerIcon: "speech_balloon",
    altText: "วิธีแจ้งเรื่องทางแชต — พิมพ์เล่าเรื่องแล้วกดส่งได้เลยค่ะ",
    bodyContents: [
      ...stepRows(INTAKE_STEPS),
      ...(hasDraft ? [{ type: "separator", margin: "md" }, sectionTitle("ข้อความที่ส่งไว้แล้ว"), intakeSummaryBox(summary)] : []),
      textBlock(`${INTAKE_PDPA_TEXT} · ข้อความที่ยังไม่กดส่งจะถูกลบอัตโนมัติภายใน 24 ชั่วโมง`, { size: "xxs", color: GRAY, margin: "md" }),
    ],
    buttons: hasDraft
      ? intakeSubmitButtons(settings, openCaseNo)
      : [{ action: typeAction("✏️ เริ่มพิมพ์เล่าเรื่อง") }, { action: fbUri("📞 โทรหาเรา", telUri(settings.phone)), style: "secondary" }],
  });
}

/* เพิ่มข้อมูลเข้าเรื่องเดิมสำเร็จ (lg:intake:append:<caseNo>) */
export function intakeAppendedCard(caseNo, { texts = 0, files = 0, dropped = 0 } = {}, settings = {}) {
  const r = settings.responder_label || "เจ้าหน้าที่";
  const what = [texts ? `ข้อความ ${texts} รายการ` : null, files ? `ไฟล์ ${files} ไฟล์` : null].filter(Boolean).join(" และ ") || "ข้อมูล";
  return bubble({
    headerTitle: "เพิ่มข้อมูลเข้าเรื่องแล้วค่ะ", headerSubtitle: caseNo, headerIcon: "check_mark_button",
    altText: `เพิ่มข้อมูลเข้าเรื่อง ${caseNo} แล้วค่ะ`,
    bodyContents: [
      textBlock(`บันทึก${what} เข้าเรื่อง ${caseNo} เรียบร้อยแล้วค่ะ`),
      ...(dropped ? [textBlock(`ไฟล์อีก ${dropped} ไฟล์ยังไม่ได้บันทึก เพราะเรื่องนี้มีไฟล์ครบจำนวนที่รับได้แล้วค่ะ`, { size: "xs", color: DANGER })] : []),
      textBlock(`${r}จะเห็นข้อมูลนี้ในเรื่องของท่านทันทีค่ะ`, { size: "xs", color: GRAY }),
    ],
    buttons: [{ action: fbPost("🔍 ตรวจสอบสถานะ", `lg:status:${caseNo}`), style: "secondary" }],
  });
}

/* กดปุ่มส่งซ้ำหลังส่งไปแล้ว (ไม่มีข้อความใหม่) — ตอบเลขเดิม ไม่สร้างเรื่องซ้ำ */
export function intakeAlreadySentCard(caseNo) {
  return bubble({
    headerTitle: "ส่งเรื่องนี้แล้วค่ะ", headerSubtitle: caseNo, headerIcon: "check_mark_button",
    altText: `ส่งเรื่องแล้ว เลขที่ ${caseNo}`,
    bodyContents: [
      textBlock(`เรื่องของท่านเข้าระบบแล้ว เลขที่เรื่อง ${caseNo} ค่ะ`),
      textBlock("หากต้องการแจ้งข้อมูลเพิ่ม พิมพ์หรือส่งรูปในแชตนี้ได้เลยค่ะ", { size: "xs", color: GRAY }),
    ],
    buttons: [{ action: fbPost("🔍 ตรวจสอบสถานะ", `lg:status:${caseNo}`), style: "secondary" }],
  });
}

/* ข้อความสั้นของรับเรื่องทางแชต (ข้อความธรรมดา ไม่ใช่การ์ด) */
export const INTAKE_BUSY_TEXT = "กำลังบันทึกเรื่องของท่าน กรุณารอสักครู่ค่ะ";
export const INTAKE_CANCELLED_TEXT = "ยกเลิกการส่งเรื่องแล้วค่ะ ข้อความและไฟล์ที่ส่งไว้ถูกลบออกจากระบบเรียบร้อย หากต้องการแจ้งเรื่องใหม่ พิมพ์เล่าในแชตนี้ได้ตลอดค่ะ";
export const INTAKE_APPT_OFF_TEXT = "ขณะนี้งดรับนัดพบทนายอาสาชั่วคราวค่ะ เลือกส่งเป็นเรื่องขอคำปรึกษาแทนได้ ข้อความที่ส่งไว้ยังอยู่ครบค่ะ";
const FILE_NOTICE = {
  type: "ขออภัยค่ะ ระบบรับไฟล์ได้เฉพาะรูปภาพ (JPG/PNG) และ PDF · วิดีโอและเสียงยังไม่รองรับ กรุณาพิมพ์เล่ารายละเอียดแทนค่ะ",
  too_large: "ขออภัยค่ะ ไฟล์มีขนาดเกิน 8MB ระบบจึงยังไม่ได้บันทึก กรุณาส่งไฟล์ที่เล็กลง หรือถ่ายภาพหน้าจอแทนค่ะ",
  failed: "ขออภัยค่ะ ระบบรับไฟล์ไม่สำเร็จ กรุณาส่งใหม่อีกครั้งค่ะ",
  full: "ไฟล์ที่แนบครบ 10 ไฟล์แล้วค่ะ ไฟล์ที่ส่งเพิ่มยังไม่ได้บันทึก กดส่งเรื่องก่อน แล้วค่อยส่งไฟล์เพิ่มเข้าเรื่องภายหลังได้ค่ะ",
};
export function intakeFileNoticeText(reason) {
  return { type: "text", text: FILE_NOTICE[reason] || FILE_NOTICE.failed };
}

/* ═══ 2c. ทักทาย ("สวัสดีครับ") — เจตนา greet จาก _chatgate.js ส่งครั้งเดียวต่อ 12 ชม. (เพิ่ม 28 ก.ย. 69)
   สั้นกว่าการ์ดต้อนรับตอนแอดเพื่อน (ไม่มีรูปปก) เพราะเป็นคำตอบกลางบทสนทนา ═══ */
export function helloCard() {
  return bubble({
    headerTitle: "สวัสดีค่ะ", headerSubtitle: "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี", headerIcon: "classical_building",
    altText: "สวัสดีค่ะ ศูนย์ช่วยเหลือประชาชนทางกฎหมาย ยินดีให้บริการ",
    bodyContents: [
      textBlock("ยินดีให้บริการค่ะ กดเลือกบริการที่ต้องการด้านล่าง หรือพิมพ์เล่าเรื่องที่ต้องการปรึกษาในแชตนี้ได้เลยค่ะ"),
      textBlock("(" + disclaimerText() + ")", { size: "xs", color: GRAY }),
    ],
    buttons: [
      { action: fbPost("⚖️ ปรึกษาข้อกฎหมาย", "lg:consult") },
      { action: fbPost("📝 ฝากเรื่องร้องเรียน", "lg:complaint"), style: "secondary" },
      { action: fbPost("📖 ความรู้กฎหมาย", "lg:knowledge"), style: "secondary" },
      { action: fbPost("☎️ ติดต่อเรา", "lg:contact"), style: "secondary" },
    ],
  });
}

/* ═══ 2d. ขอคุยกับเจ้าหน้าที่ ("มีคนอยู่ไหม") — เพิ่ม 28 ก.ย. 69
   ⛔ ห้ามสัญญาว่า "เจ้าหน้าที่จะตอบในแชตนี้" — ยังไม่มีใครยืนยันว่ามีคนเฝ้าแชต OA (ผู้ตอบจริงยังไม่ฟันธง)
   ชี้ไป 2 ช่องทางที่มีคนรับแน่: แบบฟอร์ม (เข้าหลังบ้าน+แจ้งเตือนเจ้าหน้าที่) กับโทรในเวลาทำการ ═══ */
export function handoffCard(settings) {
  const oh = settings.office_hours;
  return bubble({
    headerTitle: `ติดต่อ${settings.responder_label}`, headerIcon: "telephone_receiver",
    altText: `ติดต่อ${settings.responder_label} ศูนย์ช่วยเหลือประชาชนทางกฎหมาย`,
    bodyContents: [
      textBlock(`เพื่อให้${settings.responder_label}ติดต่อกลับได้แน่นอน กรุณาฝากเรื่องผ่านแบบฟอร์ม (ได้เลขที่เรื่องไว้ติดตามผล) หรือโทรในเวลาทำการ`),
      highlightBox(`โทร ${settings.phone}\n${oh.days} ${oh.start}–${oh.end} น.`, { weight: "bold", align: "center" }),
    ],
    buttons: [
      { action: fbPost("⚖️ ฝากเรื่องปรึกษา", "lg:consult") },
      { action: fbUri("📞 โทรหาเรา", telUri(settings.phone)), style: "secondary" },
      { action: fbPost("📝 ฝากเรื่องร้องเรียน", "lg:complaint"), style: "secondary" },
    ],
  });
}

/* ═══ 3. ปุ่มบริการ ปรึกษา/จองคิว/ร้องเรียน — ตอบ 2 ข้อความแบบ ทต.หนองป่าครั่ง (บอสสั่ง 30 ก.ย. 69)
   [image message: ภาพ "วิธี…" ของบริการนั้น] + [การ์ดหลักเกณฑ์: เรื่องที่รับ · ติดต่อกลับเมื่อไร · เวลาทำการ/วันหยุด/เบอร์
   จาก settings · ฟรี · เป็นความลับ · ปุ่มหลักเปิดแบบฟอร์ม = postback lg:<kind>:open เดิม (ออกลิงก์ ?k= ตอนกดเท่านั้น)]
   ⛔ 30 ก.ย. 69 ทับ formIntroCard เดิม (17 ก.ย. 69 — การ์ดแนะนำสั้นๆ + ปุ่มเปิดแบบฟอร์ม) ทั้งทางปุ่มและทางพิมพ์
   ⚠️ จองคิว: ผู้เรียกต้องเช็คสวิตช์ appointment_enabled ก่อนเสมอ (ปิด = appointmentUnavailableCard) ═══ */
const SERVICE_INTRO = {
  consult: (r) => `กรอกรายละเอียดที่ต้องการปรึกษาผ่านแบบฟอร์ม ${r}จะติดต่อกลับตามเบอร์ที่ให้ไว้`,
  appointment: (r) => `เลือกวัน-เวลาที่สะดวกผ่านแบบฟอร์ม ${r}จะติดต่อกลับเพื่อยืนยันนัดหมายอีกครั้ง (เป็นการนัดหมายเบื้องต้น ยังไม่ใช่การยืนยันคิวที่แน่นอน)`,
  complaint: (r) => `กรอกรายละเอียดเรื่องที่ต้องการร้องเรียน แนบหลักฐานได้ (รูป/PDF) ${r}จะติดต่อกลับ`,
};
const SERVICE_OPEN_LABEL = { consult: "📝 เปิดแบบฟอร์มขอรับคำปรึกษา", appointment: "📝 เปิดแบบฟอร์มจองคิว", complaint: "📝 เปิดแบบฟอร์มร้องเรียน" };

export function howtoImageMessage(kind) {
  const img = HOWTO_IMAGES[kind] || HOWTO_IMAGES.consult;
  return { type: "image", originalContentUrl: assetUrl(img.full), previewImageUrl: assetUrl(img.preview) };
}

export function serviceGuideCard(kind, settings) {
  const k = SERVICE_TITLES[kind] ? kind : "consult";
  const r = settings.responder_label;
  const accept = k === "complaint"
    ? "เรื่องที่ท่านได้รับความเดือดร้อนและต้องการร้องเรียน/ร้องทุกข์ เช่น " + CATEGORY_LABELS.join(" · ")
    : "ปรึกษากฎหมายเบื้องต้น เช่น " + CATEGORY_LABELS.join(" · ");
  const timing = [];
  if (k === "appointment") {
    timing.push(infoRow("telephone_receiver", `${r}จะโทรยืนยันวัน-เวลานัดหมายอีกครั้งตามเบอร์ที่ให้ไว้`, { weight: "bold", color: NAVY }));
    // 30 ก.ย. 69: ข้อมูลจริงจากบอส (สถานที่ + เอกสาร + เวลาทนายอาสา) — ค่าไหนยังเป็น null แสดงข้อความสำรองแทน
    const place = visitPlaceLine();
    timing.push(sectionTitle("สถานที่เข้ารับคำปรึกษา"));
    timing.push(infoRow("round_pushpin", place || APPOINTMENT_FALLBACK, place ? { weight: "bold", color: NAVY } : {}));
    if (APPOINTMENT_INFO.lawyer_schedule) {
      timing.push(infoRow("spiral_calendar", "ทนายอาสาประจำศูนย์: " + APPOINTMENT_INFO.lawyer_schedule + (APPOINTMENT_INFO.lawyer_off ? " " + APPOINTMENT_INFO.lawyer_off : "")));
    }
    if (Array.isArray(APPOINTMENT_INFO.documents) && APPOINTMENT_INFO.documents.length) {
      // การ์ดใช้แค่หัวข้อ (ตัดตัวอย่าง "เช่น …" ออก) — ฉบับเต็มอยู่ในภาพวิธีจองคิวที่ส่งคู่กัน · การ์ดเต็มเพดาน 9,500 ไบต์
      timing.push(sectionTitle("เอกสารที่ต้องนำมาในวันนัด (รายละเอียดในภาพด้านบน)"));
      timing.push(...bulletList(APPOINTMENT_INFO.documents.map((d) => d.split(" เช่น ")[0])));
      if (APPOINTMENT_INFO.documents_note) timing.push(textBlock(APPOINTMENT_INFO.documents_note, { size: "xxs", color: GRAY }));
    }
  } else {
    timing.push(infoRow("alarm_clock", `${r}จะติดต่อกลับภายในวันทำการถัดไป`, { weight: "bold", color: NAVY }));
  }
  const buttons = [{ action: fbPost(SERVICE_OPEN_LABEL[k], `lg:${k}:open`) }];
  // 2 ต.ค. 69 รับเรื่องทางแชต (บอสสั่ง "ไม่จำเป็นต้องกรอกแบบฟอร์มอย่างเดียว") — ปรึกษา/ร้องเรียนเลือกพิมพ์เล่าในแชตแทนได้
  if (k === "consult" || k === "complaint") buttons.push({ action: fbPost("💬 พิมพ์เล่าในแชตแทน", "lg:chatintake"), style: "secondary" });
  if (k === "consult" && settings.appointment_enabled !== false) buttons.push({ action: fbPost("📅 จองคิวเข้าพบแทน", "lg:appointment"), style: "secondary" });
  if (k === "appointment") buttons.push({ action: fbPost("⚖️ ปรึกษาออนไลน์แทน", "lg:consult"), style: "secondary" });
  if (k === "complaint") buttons.push({ action: fbPost("🔍 ติดตามเรื่อง", "lg:track", { inputOption: "openKeyboard", fillInText: "LG-" }), style: "secondary" });
  buttons.push({ action: fbUri("📞 โทรหาเรา", telUri(settings.phone)), style: "secondary" });
  return bubble({
    headerTitle: SERVICE_TITLES[k].title, headerSubtitle: "หลักเกณฑ์และเงื่อนไขการให้บริการ", headerIcon: SERVICE_TITLES[k].icon,
    altText: `${SERVICE_TITLES[k].title} — หลักเกณฑ์และปุ่มเปิดแบบฟอร์ม`,
    bodyContents: [
      textBlock(SERVICE_INTRO[k](r)),
      sectionTitle("เรื่องที่รับ"),
      textBlock(accept, { size: "xs" }),
      sectionTitle("ระยะเวลาติดต่อกลับ"),
      ...timing,
      { type: "separator", margin: "md" },
      infoRow("sparkles", `เวลาทำการ ${officeHoursText(settings)}`),
      infoRow("telephone", `โทร ${settings.phone}`),
      infoRow("check_mark_button", "บริการฟรี ไม่มีค่าใช้จ่าย"),
      infoRow("locked", "ข้อมูลเก็บเป็นความลับ ใช้เพื่อติดต่อกลับเท่านั้น"),
      textBlock("นอกเวลาทำการกรอกแบบฟอร์มทิ้งไว้ได้ตลอด 24 ชม. · ลิงก์แบบฟอร์มเฉพาะท่าน ใช้ได้ภายใน 30 นาที", { size: "xxs", color: GRAY, margin: "md" }),
    ],
    buttons,
  });
}

/* หมุดแผนที่ของไลน์ (location message) — บอสสั่ง 30 ก.ย. 69 "ปักหมุด google map พิกัดให้ด้วย"
   แตะในแชตแล้วเปิดแผนที่/นำทางได้ทันที · title/address ≤ 100 ตัว (เพดาน LINE) · null = ยังไม่มีพิกัด */
export function officeLocationMessage() {
  const loc = APPOINTMENT_INFO.location;
  if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;
  return {
    type: "location",
    title: "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย (ชั้น 1)",
    address: "อบจ.สุพรรณบุรี 500 ถ.สุพรรณบุรี–บางบัวทอง ต.ท่าระหัด อ.เมืองสุพรรณบุรี จ.สุพรรณบุรี 72000",
    latitude: loc.lat,
    longitude: loc.lng,
  };
}

/* จองคิว = [ภาพวิธี] + [การ์ดหลักเกณฑ์] + [หมุดแผนที่] (3 ข้อความ — reply รับได้ 5) · ปรึกษา/ร้องเรียน = 2 ข้อความ */
export function serviceReply(kind, settings) {
  const msgs = [howtoImageMessage(kind), serviceGuideCard(kind, settings)];
  if (kind === "appointment") {
    const pin = officeLocationMessage();
    if (pin) msgs.push(pin);
  }
  return msgs;
}

/* ═══ 4. ลิงก์ฟอร์มที่ออกแล้ว (ส่งเป็นปุ่ม uri ไปหน้าเว็บจริง) ═══ */
const FORM_LINK_TITLES = { consult: "แบบฟอร์มปรึกษาข้อกฎหมาย", complaint: "แบบฟอร์มร้องเรียน", appointment: "แบบฟอร์มจองคิวทนายอาสา", addevidence: "แบบฟอร์มแนบหลักฐานเพิ่มเติม" };
export function formLinkCard(kind, url) {
  return bubble({
    headerTitle: "ลิงก์แบบฟอร์มของท่าน", headerIcon: "mobile_phone",
    altText: "ลิงก์แบบฟอร์ม",
    bodyContents: [
      textBlock(`กดปุ่มด้านล่างเพื่อกรอก${FORM_LINK_TITLES[kind] || FORM_LINK_TITLES.consult}`),
      textBlock("ลิงก์นี้ใช้ได้ 30 นาที และใช้ได้เฉพาะท่านเท่านั้น", { size: "xs", color: GRAY }),
    ],
    buttons: [{ action: fbUri("📝 เปิดแบบฟอร์ม", url) }],
  });
}

/* ═══ 5. การ์ดเนื้อหาความรู้ 1 หมวด (ใช้ทั้งตอบคำสำคัญ + ปุ่มความรู้ + FAQ) ═══
   ไอคอน 3 มิติต่อหมวด (30 ก.ย. 69) — หมวดที่ไม่มีในตารางใช้อีโมจิเดิมของ _keywords.js */
const TOPIC_ICONS = { scam: "warning", debt: "money_bag", inheritance: "scroll", labor: "briefcase", divorce: "broken_heart" };
export function topicCard(topic, responderLabel) {
  const icon = TOPIC_ICONS[topic.key];
  return bubble({
    headerTitle: icon ? topic.label : `${topic.icon} ${topic.label}`, headerSubtitle: "ความรู้กฎหมายใกล้ตัว", headerIcon: icon,
    altText: topic.label,
    bodyContents: [
      textBlock(topic.brief),
      textBlock("สิ่งที่ควรเตรียมก่อนติดต่อ:", { weight: "bold", size: "xs", color: NAVY, margin: "md" }),
      ...bulletList(topic.prepare),
      { type: "separator", margin: "md" },
      textBlock(`โปรดฝากเรื่องไว้ให้${responderLabel}ติดต่อกลับเพื่อดูรายละเอียดของท่านโดยเฉพาะ`, { size: "xs", margin: "md" }),
      highlightBox(disclaimerText(), { size: "xxs", fg: GRAY, margin: "md" }),
    ],
    buttons: [
      { action: fbPost("📝 ฝากเรื่องให้เจ้าหน้าที่", "lg:consult:open") },
      { action: fbPost("📖 ดูหมวดอื่น", "lg:knowledge"), style: "secondary" },
    ],
  });
}

/* ═══ 6. Carousel ความรู้กฎหมาย (5 ใบ) ═══
   30 ก.ย. 69: หัวไล่สี + ไอคอน 3 มิติ — ไม่ใส่แถบโลโก้ในแต่ละใบ (carousel ทั้งชุดต้องไม่เกินเพดานไบต์ใน test-cards.mjs) */
export function knowledgeCarousel() {
  const bubbles = TOPICS.map((t) => ({
    type: "bubble",
    size: "kilo",
    header: {
      type: "box", layout: "vertical", background: HEADER_TONES.navy, paddingAll: "12px", alignItems: "center",
      contents: [TOPIC_ICONS[t.key] ? iconImage(TOPIC_ICONS[t.key], "64px") : { type: "text", text: t.icon, size: "xxl", align: "center" }],
    },
    body: {
      type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
      contents: [
        textBlock(t.label, { weight: "bold", size: "md", color: NAVY }),
        textBlock(t.brief, { size: "xs", color: GRAY }),
      ],
    },
    footer: { type: "box", layout: "vertical", paddingAll: "12px", contents: [footerButtons([{ action: fbPost("ดูรายละเอียด", `lg:kw:${t.key}`) }])] },
  }));
  return { type: "flex", altText: "ความรู้กฎหมายประชาชน", contents: { type: "carousel", contents: bubbles } };
}

/* ═══ 7. FAQ — ลิงก์ไปหมวดเดียวกับความรู้ + คำถามการใช้งาน ═══ */
export function faqCard(responderLabel) {
  return bubble({
    headerTitle: "คำถามที่พบบ่อย", headerIcon: "red_question_mark",
    altText: "คำถามที่พบบ่อย",
    bodyContents: [
      textBlock("เลือกหัวข้อกฎหมายที่สงสัยได้จากปุ่ม 📖 ความรู้กฎหมาย ในเมนูหลัก", {}),
      textBlock("ตัวอย่างคำถามที่ถามบ่อย:", { weight: "bold", size: "xs", color: NAVY, margin: "md" }),
      textBlock("• โดนทวงหนี้ทำไงดี — ดูหัวข้อ 💰 หนี้สิน/ถูกทวงหนี้", { size: "xs" }),
      textBlock("• อยากหย่าต้องเตรียมอะไรบ้าง — ดูหัวข้อ 💔 หย่า/ครอบครัว", { size: "xs" }),
      { type: "separator", margin: "md" },
      textBlock("คำถามทั่วไป:", { weight: "bold", size: "xs", color: NAVY, margin: "md" }),
      textBlock(`• มีค่าใช้จ่ายไหม — ไม่มีค่าใช้จ่าย เป็นบริการของ อบจ.สุพรรณบุรี`, { size: "xs" }),
      textBlock(`• ใครเป็นผู้ตอบ — ${responderLabel}ของศูนย์จะติดต่อกลับตามเบอร์ที่ท่านให้ไว้`, { size: "xs" }),
      textBlock(`• ข้อมูลที่กรอกปลอดภัยไหม — เก็บเป็นความลับ ใช้เพื่อติดต่อกลับเท่านั้น`, { size: "xs" }),
    ],
    buttons: [{ action: fbPost("📖 ดูความรู้กฎหมาย", "lg:knowledge") }],
  });
}

/* ═══ 8. ติดต่อเรา/นัดหมาย ═══ */
export function contactCard(settings) {
  const oh = settings.office_hours;
  const buttons = [
    { action: fbUri("📞 โทรหาเรา", telUri(settings.phone)) },
    // 30 ก.ย. 69: ค่าใน DB เคยเสีย (ตัดกลาง %) จน LINE ตีกลับการ์ดทั้งใบ — เสียเมื่อไรใช้หมุดพิกัดจริงแทน การ์ดต้องไม่ตาย
    { action: fbUri("🗺️ ดูแผนที่", isWellFormedUri(settings.map_url) ? settings.map_url : (MAP_PIN_URL || "https://www.google.com/maps")), style: "secondary" },
  ];
  if (settings.appointment_enabled) {
    buttons.push({ action: fbPost("📅 จองคิวทนายอาสา", "lg:appointment"), style: "secondary" });
  }
  return bubble({
    headerTitle: "ติดต่อเรา", headerIcon: "telephone",
    altText: "ติดต่อศูนย์ช่วยเหลือประชาชนทางกฎหมาย",
    bodyContents: [
      textBlock(`เวลาทำการ: ${oh.days} ${oh.start}–${oh.end} น.`),
      textBlock(`โทร: ${settings.phone}`),
      ...(visitPlaceLine() ? [textBlock(`📍 ${visitPlaceLine()}`, { weight: "bold", color: NAVY })] : []),
      { type: "separator", margin: "md" },
      textBlock("ช่องทางติดต่อประสานงาน อบจ.สุพรรณบุรี", { weight: "bold", size: "sm", color: NAVY, margin: "md" }),
      textBlock("แตะแถวเพื่อโทรออกได้เลย", { size: "xxs", color: GRAY }),
      ...ORG_CONTACT_NUMBERS.map(contactNumberRow),
      { type: "separator", margin: "md" },
      textBlock("นอกเวลาทำการ ท่านยังฝากเรื่อง/ฟอร์มได้ตลอด 24 ชม. เจ้าหน้าที่จะติดต่อกลับในวันทำการถัดไป", { size: "xs", color: GRAY, margin: "md" }),
    ],
    buttons,
  });
}

/* ═══ 8b. เกี่ยวกับศูนย์ (ปุ่มใหม่ในริชเมนู v2 — 30 ก.ย. 69) — ข้อเท็จจริงเท่าที่มีเท่านั้น ห้ามแต่งเพิ่ม:
   งานร่วมสภาทนายความจังหวัดสุพรรณบุรี + อบจ.สุพรรณบุรี (กฎข้อ 4) · ปรึกษาเบื้องต้นฟรี · ร้องเรียน · นัดหมาย (ตามสวิตช์)
   เวลาทำการ/เบอร์จาก settings · ลิงก์หน้าแรกเว็บ (public/index.html — หน้าเดียวที่ตั้งใจเปิดให้ค้นเจอ/แชร์ได้) ═══ */
export function aboutCard(settings) {
  const services = [
    "ให้คำปรึกษากฎหมายเบื้องต้น ไม่มีค่าใช้จ่าย",
    "รับเรื่องร้องเรียน / ร้องทุกข์",
    ...(settings.appointment_enabled === false ? [] : ["นัดหมายเข้าพบเพื่อรับคำปรึกษา"]),
    "ความรู้กฎหมายใกล้ตัวสำหรับประชาชน",
  ];
  return bubble({
    heroUrl: staticUrl("assets/hero-cover.jpg"), heroRatio: "1207:413",
    headerTitle: "เกี่ยวกับศูนย์", headerSubtitle: "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย", headerIcon: "classical_building",
    altText: "เกี่ยวกับศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี",
    bodyContents: [
      textBlock("สภาทนายความจังหวัดสุพรรณบุรี ร่วมกับ องค์การบริหารส่วนจังหวัดสุพรรณบุรี", { weight: "bold", color: NAVY }),
      sectionTitle("บริการของศูนย์"),
      ...bulletList(services),
      { type: "separator", margin: "md" },
      ...(visitPlaceLine() ? [infoRow("round_pushpin", visitPlaceLine(), { weight: "bold", color: NAVY })] : []),
      infoRow("sparkles", `เวลาทำการ ${officeHoursText(settings)}`),
      infoRow("telephone", `โทร ${settings.phone}`),
      highlightBox(disclaimerText(), { size: "xxs", fg: GRAY, margin: "md" }),
    ],
    buttons: [
      { action: fbPost("➕ ขอความช่วยเหลือ", "lg:help") },
      ...(MAP_DIR_URL ? [{ action: fbUri("🗺️ นำทางมาศูนย์", MAP_DIR_URL), style: "secondary" }] : []),
      { action: fbUri("🌐 เว็บไซต์ศูนย์", site() + "/"), style: "secondary" },
    ],
  });
}

/* ═══ 9. เหตุด่วน / สายด่วน (คำเร่งด่วน + ปุ่มริชเมนู lg:urgent) ═══
   30 ก.ย. 69: สายด่วน 4 เบอร์จาก HOTLINES ใน _serviceinfo.js (Hermes ตรวจกับเว็บทางการแล้ว บอสอนุมัติแทนการให้
   นิติกรยืนยัน "สำหรับ 4 เบอร์นี้" — ที่มาอยู่ในคอมเมนต์ที่นั่น) ทับหมายเหตุเดิม 15 ก.ย. 69 "ยังไม่ตรวจ"
   แตะแถวแล้วโทรออก (tel:) ได้ทันที · เบอร์ศูนย์จาก settings (ถ้าไม่ส่ง settings มาจะไม่แสดงแถวนี้) ═══ */
function hotlineRow(h) {
  return {
    type: "box", layout: "horizontal", spacing: "md", alignItems: "center", paddingAll: "8px",
    cornerRadius: "10px", backgroundColor: "#FDECEA", action: fbUri("โทร " + h.number, "tel:" + h.number),
    contents: [
      iconImage(h.icon, "36px", { flex: 0 }),
      { type: "text", text: h.number, size: "xl", weight: "bold", color: DANGER, flex: 0 },
      { type: "text", text: h.title, size: "xs", color: "#333333", wrap: true, flex: 1 },
    ],
  };
}
export function urgentCard(settings) {
  const body = [
    textBlock("หากอยู่ในอันตราย ถูกทำร้าย หรือเจ็บป่วยฉุกเฉิน แตะเบอร์ด้านล่างเพื่อโทรออกทันที (ตลอด 24 ชม.)", { weight: "bold" }),
    { type: "box", layout: "vertical", spacing: "sm", contents: HOTLINES.map(hotlineRow) },
    { type: "separator", margin: "md" },
    textBlock("หากเพิ่งถูกหลอกโอนเงิน:", { margin: "md" }),
    textBlock("แจ้งธนาคารอายัดบัญชีทันที และแจ้งความออนไลน์ที่ thaipoliceonline.go.th หรือสายด่วน 1441", { size: "xs" }),
  ];
  if (settings && settings.phone) {
    body.push({ type: "separator", margin: "md" });
    body.push(infoRow("telephone", `ปรึกษากฎหมายกับศูนย์ โทร ${settings.phone} (${officeHoursText(settings)})`));
  }
  return bubble({
    headerTitle: "🚨 เหตุด่วน / สายด่วน", headerSubtitle: "โปรดติดต่อหน่วยงานด้านล่างก่อน", headerIcon: "police_car_light", tone: "danger",
    altText: "เบอร์ฉุกเฉิน 191 · 1669 · 1300 · 1441",
    bodyContents: body,
    buttons: [
      { action: fbUri("📞 โทร 191 ทันที", "tel:191"), color: DANGER },
      { action: fbPost("📝 ฝากเรื่องให้เจ้าหน้าที่ต่อ", "lg:consult:open"), style: "secondary" },
    ],
  });
}

/* ═══ 10. ยืนยันรับเรื่อง (หลังกรอกฟอร์มเว็บเสร็จ ส่งกลับเข้าแชตด้วย) ═══
   30 ก.ย. 69: ฟอร์มจองคิวใหม่ (สาย T1b) เก็บเวลารายชั่วโมงใน preferred_time ("HH:MM") — มีค่าให้แสดงเวลานั้น
   ไม่มี (เรื่องเก่าก่อนเปลี่ยนฟอร์ม) แสดงช่วงเช้า/บ่ายจาก preferred_time_slot แบบเดิม */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function apptDateLabel(caseRow) {
  if (caseRow.case_type !== "appointment" || !caseRow.preferred_date) return null;
  const d = new Date(caseRow.preferred_date + "T00:00:00+07:00").toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const t = String(caseRow.preferred_time || "").slice(0, 5); // Postgres time อาจคืน "09:00:00"
  const when = HHMM_RE.test(t) ? `เวลา ${t} น.` : (caseRow.preferred_time_slot === "morning" ? "ช่วงเช้า" : "ช่วงบ่าย");
  return `วันที่นัดหมายที่ท่านเลือก: ${d} (${when})`;
}
/* 2 ต.ค. 69 รับเรื่องทางแชต: เรื่องจากแชต (isChatCase) บอกตามจริงว่าจะติดต่อทางไหน — มีเบอร์ = โทรตามเบอร์นั้น (โชว์เบอร์
   ให้ผู้แจ้งเห็นว่าถูกไหม เพราะบางเบอร์ระบบอ่านจากข้อความเอง) · ไม่มีเบอร์ = ติดต่อกลับ/แจ้งความคืบหน้าผ่านแชตนี้ (หลังบ้านมีปุ่ม
   "แจ้งผลประชาชน" ส่งเข้าแชตได้จริง) · ขอนัดพบจากแชตไม่มีวัน-เวลา = เจ้าหน้าที่นัดให้ · ⛔ ไม่สัญญาว่าจะมีคนตอบในแชต */
function chatConfirmLine(caseRow, r) {
  const phone = caseRow.citizen_phone;
  if (caseRow.case_type === "appointment") {
    return phone ? `${r}จะโทรนัดวัน-เวลาเข้าพบทนายอาสากับท่านที่เบอร์ ${phone} อีกครั้งค่ะ` : `${r}จะติดต่อนัดวัน-เวลาเข้าพบทนายอาสาผ่านแชตนี้ค่ะ`;
  }
  return phone ? `${r}จะติดต่อกลับที่เบอร์ ${phone} ภายในวันทำการถัดไปค่ะ` : `${r}จะติดต่อกลับและแจ้งความคืบหน้าผ่านแชตนี้ค่ะ`;
}
export function caseConfirmCard(caseRow, responderLabel) {
  const isAppt = caseRow.case_type === "appointment";
  const apptLine = apptDateLabel(caseRow);
  const chat = isChatCase(caseRow);
  return bubble({
    headerTitle: "รับเรื่องแล้ว", headerSubtitle: caseRow.case_no, headerIcon: "check_mark_button",
    altText: `รับเรื่องแล้ว เลขที่ ${caseRow.case_no}`,
    bodyContents: [
      textBlock(`ขอบคุณที่ติดต่อศูนย์ช่วยเหลือประชาชนทางกฎหมาย เลขที่เรื่องของท่านคือ`),
      highlightBox(caseRow.case_no, { bg: LIGHT_BG, fg: NAVY, size: "xl", weight: "bold", margin: "sm", align: "center" }),
      ...(apptLine ? [textBlock(apptLine, { size: "xs", color: NAVY, weight: "bold", margin: "md" })] : []),
      textBlock(
        chat
          ? chatConfirmLine(caseRow, responderLabel)
          : isAppt
            ? `${responderLabel}จะติดต่อกลับเพื่อยืนยันวัน-เวลานัดหมายอีกครั้งตามเบอร์ที่ท่านให้ไว้`
            : `${responderLabel}จะติดต่อกลับตามเบอร์ที่ให้ไว้ภายในวันทำการถัดไป`,
        { size: "xs", color: GRAY, margin: "md" }
      ),
      ...(chat ? [textBlock("ต้องการเพิ่มข้อมูลภายหลัง พิมพ์หรือส่งรูปในแชตนี้ แล้วกดปุ่ม \"เพิ่มข้อมูลเข้าเรื่อง\" ได้เลยค่ะ", { size: "xs", margin: "sm" })] : []),
      textBlock("พิมพ์ \"ติดตามสถานะ\" เพื่อดูความคืบหน้าได้ทุกเมื่อ", { size: "xs", margin: "sm" }),
    ],
    buttons: [{ action: fbPost("🔍 ตรวจสอบสถานะ", `lg:status:${caseRow.case_no}`), style: "secondary" }],
  });
}

/* ═══ 11. การ์ดสถานะเรื่อง ═══
   ปุ่มท้ายการ์ดปรับตามสถานะ (แนวคิดจาก Traffy Fondue — การ์ดยืนยัน/ติดตามมีปุ่มยกเลิกเรื่อง/แนบเพิ่ม):
   - new: ยกเลิกเรื่องได้เอง (ยังไม่มีใครรับเรื่อง) + แนบหลักฐานเพิ่มได้
   - assigned/in_progress/need_info: แนบหลักฐานเพิ่มได้อย่างเดียว (มีคนรับเรื่องแล้ว ยกเลิกเองไม่ได้ต้องติดต่อเจ้าหน้าที่)
   - closed: ดูเอกสารผลการดำเนินการได้ถ้าเจ้าหน้าที่แนบไว้ (resolution_paths)
   - withdrawn: ไม่มีปุ่ม (จบเรื่องแล้ว) */
const STATUS_TH = { new: "รับเรื่องแล้ว รอมอบหมาย", assigned: "มอบหมายเจ้าหน้าที่แล้ว", in_progress: "กำลังดำเนินการ", need_info: "รอข้อมูลเพิ่มเติมจากท่าน", closed: "ดำเนินการเสร็จสิ้น", withdrawn: "ยกเลิกโดยผู้แจ้งเอง" };
export function statusCard(caseRow) {
  const buttons = [];
  if (caseRow.status === "new") buttons.push({ action: fbPost("❌ ยกเลิกเรื่องนี้", `lg:cancel:${caseRow.case_no}`), style: "secondary" });
  if (["new", "assigned", "in_progress", "need_info"].includes(caseRow.status)) {
    buttons.push({ action: fbPost("📎 แนบหลักฐานเพิ่มเติม", `lg:addevidence:${caseRow.case_no}`), style: "secondary" });
  }
  if (caseRow.status === "closed" && (caseRow.resolution_paths || []).length) {
    buttons.push({ action: fbPost("📄 ดูเอกสารผลการดำเนินการ", `lg:resfile:${caseRow.case_no}`) });
  }
  return bubble({
    headerTitle: "สถานะเรื่อง", headerSubtitle: caseRow.case_no, headerIcon: "magnifying_glass_tilted_left",
    altText: `สถานะเรื่อง ${caseRow.case_no}`,
    bodyContents: [
      textBlock("สถานะปัจจุบัน", { size: "xs", color: GRAY }),
      statusBadge(caseRow.status, STATUS_TH[caseRow.status] || caseRow.status),
      textBlock(`วันที่รับเรื่อง: ${new Date(caseRow.created_at).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}`, { size: "xs", color: GRAY }),
      ...(caseRow.status === "need_info" ? [textBlock("โปรดติดต่อเจ้าหน้าที่ตามเบอร์ที่ท่านให้ไว้ เพื่อให้ข้อมูลเพิ่มเติม", { size: "xs", margin: "sm" })] : []),
    ],
    buttons,
  });
}

/* ═══ 11b. ยืนยันยกเลิกเรื่อง (กันกดพลาด — แนวคิดจาก Traffy Fondue ปุ่ม "ยกเลิกเรื่อง") ═══ */
export function cancelConfirmCard(caseNo) {
  return bubble({
    headerTitle: "ยืนยันยกเลิกเรื่อง", headerSubtitle: caseNo, headerIcon: "warning",
    altText: "ยืนยันยกเลิกเรื่อง",
    bodyContents: [textBlock(`ต้องการยกเลิกเรื่อง ${caseNo} ใช่หรือไม่ (ยกเลิกแล้วเรียกคืนไม่ได้ ต้องยื่นเรื่องใหม่หากเปลี่ยนใจ)`)],
    buttons: [
      { action: fbPost("✅ ใช่ ยกเลิกเลย", `lg:cancelconfirm:${caseNo}`), style: "secondary" },
      { action: fbPost("↩️ ไม่ยกเลิก", "lg:menu") },
    ],
  });
}

export function statusNotFoundCard() {
  return bubble({
    headerTitle: "ไม่พบเรื่องนี้", headerIcon: "magnifying_glass_tilted_left",
    altText: "ไม่พบเลขที่เรื่อง",
    bodyContents: [textBlock("ไม่พบเลขที่เรื่องนี้ในระบบ กรุณาตรวจสอบเลขที่เรื่องอีกครั้ง (รูปแบบ LG-2569-000123)")],
    buttons: [{ action: fbPost("🔍 กลับเมนูหลัก", "lg:menu"), style: "secondary" }],
  });
}

/* ข้อความตอบปุ่ม/คำว่า "ติดตามสถานะ" — ใช้ร่วมกันทั้งทางพิมพ์และ postback lg:track (ปุ่มริชเมนู v2 เปิดคีย์บอร์ดให้แล้ว) */
export const TRACK_PROMPT_TEXT = "พิมพ์เลขที่เรื่องของท่าน เช่น LG-2569-000123";

/* ═══ 12. ข้อผิดพลาดทั่วไป (ห้ามให้ผู้ใช้เห็นความเงียบ) ═══ */
export function errorCard(customMsg) {
  return bubble({
    headerTitle: "ขออภัย", headerIcon: "warning",
    altText: "เกิดข้อผิดพลาด",
    bodyContents: [textBlock(customMsg || `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง หรือโทร ${SETTING_DEFAULTS.phone} ค่ะ`)],
  });
}

/* ═══ 14. จองคิวทนายอาสา — สำรองไว้เฉพาะตอนแอดมินปิดสวิตช์ appointment_enabled (แท็บตั้งค่าหลังบ้าน)
   ปกติกดปุ่มแล้วจะได้ serviceReply("appointment", ...) แทน (ดู line-webhook.js) ═══ */
export function appointmentUnavailableCard(responderLabel) {
  return bubble({
    headerTitle: "จองคิวทนายอาสา", headerIcon: "spiral_calendar",
    altText: "จองคิวทนายอาสา",
    bodyContents: [
      textBlock(`ระบบจองคิวโดยตรงยังไม่เปิดให้บริการ ระหว่างนี้ฝากเรื่องไว้ให้${responderLabel}ติดต่อกลับเพื่อนัดหมายแทนได้ค่ะ`),
    ],
    buttons: [{ action: fbPost("📝 ฝากเรื่องให้เจ้าหน้าที่", "lg:consult:open") }],
  });
}

/* ═══ 15. ขอคะแนนความพึงพอใจหลังปิดเรื่อง (แนวคิดจาก Traffy Fondue — ขอ 17 ก.ย. 69) ═══
   เลือกดาวผ่าน quick reply ไม่ใช่ปุ่ม flex footer (5 ปุ่มเรียงแนวตั้งจะยาวเกะกะ) ดู satisfactionQuickReply()
   คู่กันเสมอ ต้องรัน supabase-migration-3-satisfaction.sql ก่อนใช้งานได้จริง (ดู CLAUDE.md) */
export function satisfactionRequestCard(caseRow) {
  return bubble({
    headerTitle: "ให้คะแนนความพึงพอใจ", headerSubtitle: caseRow.case_no, headerIcon: "star",
    altText: "ให้คะแนนความพึงพอใจการให้บริการ",
    bodyContents: [
      textBlock("เรื่องของท่านปิดแล้ว รบกวนให้คะแนนความพึงพอใจต่อการให้บริการ (1-5 ดาว จากปุ่มด้านล่างแชต) เพื่อนำไปปรับปรุงบริการค่ะ"),
    ],
  });
}
export function satisfactionQuickReply(caseId) {
  return [1, 2, 3, 4, 5].map((n) => ({
    type: "action",
    action: { type: "postback", label: "⭐".repeat(n), data: `lg:rate:${caseId}:${n}`, displayText: `ให้ ${n} ดาว` },
  }));
}

/* ═══ 16. การ์ดข้อความใต้รูปประกาศ (หน้าเว็บ broadcast.html — แอดมินส่งโปสเตอร์ข่าว ปชส. ถึงเพื่อนทุกคน
   เพิ่ม 24 ก.ย. 69 แบบเดียวกับ #ประกาศรูป ของไลน์สำนักปลัด) ส่งต่อท้ายรูปในคำขอเดียวกัน = โควตาเท่ากับส่ง
   รูปอย่างเดียว (LINE นับต่อหัวผู้รับ ไม่นับจำนวนบอลลูน) — การ์ดเล็กโปร่ง ไม่มีหัวน้ำเงินใหญ่เหมือนการ์ดอื่น
   เพราะเป็นแค่คำบรรยายใต้โปสเตอร์ ไม่ใช่เนื้อหาหลัก · caption/link ผ่านการตรวจใน _broadcast.js มาแล้ว ═══ */
export const BROADCAST_ORG_LINE = "📢 ศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี";
export function broadcastCaptionCard(caption, link) {
  const cap = String(caption || "").trim();
  const body = [
    { type: "text", text: BROADCAST_ORG_LINE, size: "xs", weight: "bold", color: NAVY, wrap: true },
    { type: "separator", margin: "md", color: GOLD },
  ];
  if (cap) body.push({ type: "text", text: cap, size: "sm", color: "#1c2530", wrap: true, margin: "md" });
  else body.push({ type: "text", text: "อ่านรายละเอียดเพิ่มเติมได้จากปุ่มด้านล่าง", size: "sm", color: GRAY, wrap: true, margin: "md" });
  const contents = {
    type: "bubble",
    body: { type: "box", layout: "vertical", paddingAll: "16px", backgroundColor: WHITE, contents: body },
  };
  if (link) {
    contents.footer = { type: "box", layout: "vertical", paddingAll: "12px", paddingTop: "0px",
      contents: [footerButtons([{ color: NAVY, action: fbUri("📰 อ่านรายละเอียด", link) }])] };
  }
  return { type: "flex", altText: (cap ? "📢 " + cap : BROADCAST_ORG_LINE).slice(0, 380), contents };
}

export const _internal = { bubble, textBlock, bulletList, header, NAVY, LIGHT_BG, GOLD, WHITE, GRAY, HEADER_TONES, TOPIC_ICONS };
