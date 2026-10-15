/* api/_richmenu-layout.js — "แหล่งเดียว" ของพิกัดปุ่ม + ป้าย + action ของ Rich Menu v2 (เพิ่ม 30 ก.ย. 69 งาน T1a)
   ใช้ร่วมกัน 2 ที่: scripts/render-richmenu.mjs (วาดภาพจากพิกัดนี้) และ api/richmenu-setup.js (ส่งพิกัดนี้ขึ้น LINE)
   บทเรียนเดิม (v1): พิกัดเขียนแยก 2 ไฟล์ แก้ที่หนึ่งลืมอีกที่ = ปุ่มกดแล้วสั่งผิดจากที่เห็นในรูป
   scripts/test-richmenu.mjs ล็อกว่าพื้นที่ครอบภาพพอดี ไม่ทับ ไม่เว้น ป้ายครบ และทุก postback มีคนตอบ

   เลย์เอาต์แนว Traffy Fondue (บอสส่งภาพ "ตัวอย่าง rich menu.jpg" 30 ก.ย. 69):
   ┌──────┬─────────────┬─────────────┐
   │ 🚨   │ ⚖️ ปรึกษา    │ 📅 จองคิว    │   คอลัมน์แคบซ้าย = เหตุด่วน (แบบกระดิ่งของ Traffy) โทนแดง
   │ด่วน  ├─────────────┼─────────────┤   แถบภาพใหญ่ 2×2 = บริการหลัก
   │      │ 📝 ร้องเรียน │ 📚 ความรู้    │
   ├────┬─┴──┬────┬────┴──┬──────────┤   แถวล่าง 5 ช่อง ช่องขวาสุดสีเข้ม = ปุ่มหลัก "ขอความช่วยเหลือ"
   │ ❓ │ 🔍 │ ☎️ │ 🏛️    │ ➕ (เข้ม) │
   └────┴────┴────┴───────┴──────────┘
   ⛔ ทุกปุ่มต้องเป็น postback ที่บอทตอบข้อความ (บอสสั่ง 30 ก.ย. 69) — ห้ามปุ่ม uri เปิดเว็บตรง
      และห้ามฝังลิงก์ ?k= (ลิงก์ฟอร์มออกตอนกด lg:*:open เท่านั้น — CLAUDE.md กับดักข้อ LIFF)
   ⚠️ inputOption/fillInText ใช้ได้กับ postback action เท่านั้น (ตรวจเอกสาร LINE Messaging API 30 ก.ย. 69 —
      message action ไม่มีฟิลด์นี้ ของ v1 ที่ใส่ไว้บน message action จึงไม่เคยเปิดคีย์บอร์ดจริง) */

export const RICHMENU_NAME_V1 = "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย (viewer)"; // เมนูเดิม 6 ช่อง (ยังเป็นค่าเริ่มต้นจนกว่าบอสอนุมัติ v2)
export const RICHMENU_NAME = "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย v2 (Traffy)";
export const RICHMENU_SIZE = { width: 2500, height: 1686 };
export const RICHMENU_CHAT_BAR_TEXT = "เมนูหลัก";
export const RICHMENU_IMAGE = "assets/richmenu-v2.jpg"; // path ใต้ public/ (เรนเดอร์ด้วย npm run render-richmenu)
export const RICHMENU_IMAGE_TYPE = "image/jpeg";
export const RICHMENU_MAX_BYTES = 1024 * 1024; // เพดานไฟล์ภาพ rich menu ของ LINE

// ขนาดตัวอักษรป้ายหลักในภาพ (px ในภาพจริง 2500 กว้าง) — ต้อง ≥ 64 ให้อ่านออกบนมือถือ (เกณฑ์บอส/Hermes)
export const LABEL_PX = { urgent: 72, banner: 88, tile: 64 };
export const MIN_LABEL_PX = 64;

const TOP_H = 1086; // ส่วนบน (คอลัมน์ด่วน + แถบใหญ่ 2×2)
const URGENT_W = 400;
const BANNER_W = (RICHMENU_SIZE.width - URGENT_W) / 2; // 1050
const BANNER_H = TOP_H / 2; // 543
const TILE_W = RICHMENU_SIZE.width / 5; // 500
const TILE_H = RICHMENU_SIZE.height - TOP_H; // 600

/* kind: urgent | banner | tile | primary (ช่องเข้มขวาสุด)
   lines = ป้ายหลัก (แยกบรรทัดเอง ไม่ปล่อยให้เบราว์เซอร์ตัดคำไทยมั่ว) · sub = คำอธิบายย่อยตัวเล็ก
   icon = ไฟล์ใน public/assets/icons3d/<icon>.png (Fluent Emoji 3D — MIT)
   label = ป้าย a11y ของ LINE (≤ 20 ตัว) · displayText = ฟองข้อความของผู้ใช้ที่เห็นในแชตตอนกด */
export const RICHMENU_AREAS = [
  { key: "urgent", kind: "urgent", x: 0, y: 0, w: URGENT_W, h: TOP_H, icon: "police_car_light",
    lines: ["เหตุด่วน", "สายด่วน"], sub: "191 · 1669\n1300 · 1441",
    label: "เหตุด่วน สายด่วน", data: "lg:urgent", displayText: "เหตุด่วน / สายด่วน" },
  { key: "consult", kind: "banner", x: URGENT_W, y: 0, w: BANNER_W, h: BANNER_H, icon: "balance_scale",
    lines: ["ขอรับคำปรึกษา", "กฎหมาย"], sub: "ปรึกษาออนไลน์ เจ้าหน้าที่โทรกลับ",
    label: "ขอรับคำปรึกษากฎหมาย", data: "lg:consult", displayText: "ขอรับคำปรึกษากฎหมาย" },
  { key: "appointment", kind: "banner", x: URGENT_W + BANNER_W, y: 0, w: BANNER_W, h: BANNER_H, icon: "spiral_calendar",
    lines: ["จองคิว", "เข้ารับคำปรึกษา"], sub: "เลือกวันและเวลาที่สะดวก",
    // label (a11y) เพดาน LINE 20 ตัว — "จองคิวเข้ารับคำปรึกษา" 21 ตัว LINE ตีกลับทั้งเมนู (test-richmenu.mjs จับได้ 30 ก.ย. 69)
    label: "จองคิวรับคำปรึกษา", data: "lg:appointment", displayText: "จองคิวเข้ารับคำปรึกษา" },
  { key: "complaint", kind: "banner", x: URGENT_W, y: BANNER_H, w: BANNER_W, h: BANNER_H, icon: "memo",
    lines: ["ร้องเรียน /", "ร้องทุกข์"], sub: "แนบหลักฐานได้ ติดตามผลในแชต",
    label: "ร้องเรียน ร้องทุกข์", data: "lg:complaint", displayText: "ร้องเรียน / ร้องทุกข์" },
  { key: "knowledge", kind: "banner", x: URGENT_W + BANNER_W, y: BANNER_H, w: BANNER_W, h: BANNER_H, icon: "books",
    lines: ["ความรู้กฎหมาย", "ใกล้ตัว"], sub: "หนี้สิน มรดก ถูกโกง แรงงาน ครอบครัว",
    label: "ความรู้กฎหมายใกล้ตัว", data: "lg:knowledge", displayText: "ความรู้กฎหมายใกล้ตัว" },
  { key: "faq", kind: "tile", x: 0, y: TOP_H, w: TILE_W, h: TILE_H, icon: "red_question_mark",
    lines: ["คำถาม", "ที่พบบ่อย"], sub: "ฟรีไหม · ใครตอบ",
    label: "คำถามที่พบบ่อย", data: "lg:faq", displayText: "คำถามที่พบบ่อย" },
  // ติดตามเรื่อง: เปิดคีย์บอร์ดให้พิมพ์เลขที่เรื่องต่อทันที (กันแถบเมนูบังช่องพิมพ์) + เติม "LG-" ไว้ให้
  { key: "track", kind: "tile", x: TILE_W, y: TOP_H, w: TILE_W, h: TILE_H, icon: "magnifying_glass_tilted_left",
    lines: ["ติดตามเรื่อง"], sub: "พิมพ์เลขที่เรื่อง",
    label: "ติดตามเรื่อง", data: "lg:track", displayText: "ติดตามเรื่อง", inputOption: "openKeyboard", fillInText: "LG-" },
  { key: "contact", kind: "tile", x: TILE_W * 2, y: TOP_H, w: TILE_W, h: TILE_H, icon: "telephone",
    lines: ["ติดต่อเรา"], sub: "เบอร์โทร · เวลาทำการ",
    label: "ติดต่อเรา", data: "lg:contact", displayText: "ติดต่อเรา" },
  { key: "about", kind: "tile", x: TILE_W * 3, y: TOP_H, w: TILE_W, h: TILE_H, icon: "classical_building",
    lines: ["เกี่ยวกับศูนย์"], sub: "อบจ. · สภาทนายความ",
    label: "เกี่ยวกับศูนย์", data: "lg:about", displayText: "เกี่ยวกับศูนย์" },
  { key: "help", kind: "primary", x: TILE_W * 4, y: TOP_H, w: TILE_W, h: TILE_H, icon: "plus",
    lines: ["ขอความ", "ช่วยเหลือ"], sub: "เลือกบริการทั้งหมด",
    label: "ขอความช่วยเหลือ", data: "lg:help", displayText: "ขอความช่วยเหลือ" },
];

/* action ของแต่ละช่อง (postback ล้วน) — แยกเป็นฟังก์ชันให้เทสต์ตรวจได้ตรงๆ */
export function areaAction(a) {
  return {
    type: "postback", label: a.label, data: a.data, displayText: a.displayText,
    ...(a.inputOption ? { inputOption: a.inputOption } : {}),
    ...(a.fillInText ? { fillInText: a.fillInText } : {}),
  };
}

/* object ที่ส่งขึ้น LINE (POST /v2/bot/richmenu) — richmenu-setup.js ใช้ตัวนี้ตัวเดียว */
export function richMenuDefinition() {
  return {
    size: { ...RICHMENU_SIZE },
    selected: true,
    name: RICHMENU_NAME,
    chatBarText: RICHMENU_CHAT_BAR_TEXT,
    areas: RICHMENU_AREAS.map((a) => ({ bounds: { x: a.x, y: a.y, width: a.w, height: a.h }, action: areaAction(a) })),
  };
}
