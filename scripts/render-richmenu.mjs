/* scripts/render-richmenu.mjs — เรนเดอร์ Rich Menu v2 (แนว Traffy) เป็น public/assets/richmenu-v2.jpg (2500x1686 ≤ 1MB)
   รันตอน dev เท่านั้นเมื่อแก้ป้าย/เลย์เอาต์ แล้ว commit ไฟล์ภาพเข้า repo (Vercel ไม่เรนเดอร์สด — ดูเหตุผลที่ api/richmenu-setup.js)

   ⛔ 30 ก.ย. 69 (งาน T1a) ทับของเดิม 15 ก.ย. 69: เดิมแคปเจอร์ scripts/richmenu-template.html (ตาราง 6 ช่องอีโมจิ →
      public/assets/richmenu.png) ตอนนี้วาดจาก api/_richmenu-layout.js (แหล่งเดียวกับ richmenu-setup.js) ผ่าน
      scripts/richmenu-v2-template.mjs · ไฟล์ v1 ยังเก็บไว้เผื่อย้อนกลับ แต่ richmenu-setup ไม่ได้ใช้แล้ว

   ไม่ใส่ playwright ใน package.json (ไม่ต้องใช้ตอน runtime บน Vercel) — ครั้งแรกให้รัน:
     npm install --no-save playwright && npx playwright install chromium
   หลังเรนเดอร์: npm test → deploy → ทดลองกับตัวเองก่อน /api/richmenu-setup?token=<SETUP_TOKEN>&action=preview&uid=<LINE uid>
   บอสอนุมัติแล้วค่อย action=set (ตั้งเป็นค่าเริ่มต้นของทุกคน) */
import path from "node:path";
import { launch, renderHtmlToJpeg, PUBLIC_DIR, kb } from "./_render-lib.mjs";
import { buildRichMenuHtml } from "./richmenu-v2-template.mjs";
import { RICHMENU_AREAS, RICHMENU_SIZE, RICHMENU_IMAGE, RICHMENU_MAX_BYTES, MIN_LABEL_PX } from "../api/_richmenu-layout.js";

const outPath = path.join(PUBLIC_DIR, RICHMENU_IMAGE);

/* ตรวจหลังฟอนต์ขึ้นแล้ว ก่อนแคปเจอร์: ป้ายหลักใหญ่พอ ไม่ล้นกล่อง ช่องในภาพตรงพิกัด layout */
async function check(page) {
  const r = await page.evaluate(() => {
    const out = [];
    for (const area of document.querySelectorAll(".area")) {
      const box = area.getBoundingClientRect();
      const card = area.querySelector(".card").getBoundingClientRect();
      const label = area.querySelector(".label");
      const lines = [...area.querySelectorAll(".line")].map((l) => {
        const lr = l.getBoundingClientRect();
        return { text: l.textContent, left: lr.left, right: lr.right, top: lr.top, bottom: lr.bottom };
      });
      out.push({
        key: area.dataset.key, x: box.left, y: box.top, w: box.width, h: box.height,
        card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
        labelPx: parseFloat(getComputedStyle(label).fontSize), lines,
      });
    }
    return out;
  });
  if (r.length !== RICHMENU_AREAS.length) throw new Error(`จำนวนช่องในภาพ ${r.length} ไม่เท่ากับ layout ${RICHMENU_AREAS.length}`);
  for (const a of RICHMENU_AREAS) {
    const d = r.find((x) => x.key === a.key);
    if (!d) throw new Error(`ไม่พบช่อง ${a.key} ในภาพ`);
    if ([d.x - a.x, d.y - a.y, d.w - a.w, d.h - a.h].some((v) => Math.abs(v) > 0.5)) throw new Error(`ช่อง ${a.key} ในภาพไม่ตรงพิกัด layout`);
    if (d.labelPx < MIN_LABEL_PX) throw new Error(`ป้าย ${a.key} ${d.labelPx}px เล็กกว่า ${MIN_LABEL_PX}px`);
    for (const l of d.lines) {
      if (l.left < d.card.left || l.right > d.card.right || l.top < d.card.top || l.bottom > d.card.bottom) {
        throw new Error(`ป้าย "${l.text}" (${a.key}) ล้นกรอบช่อง`);
      }
    }
  }
}

const browser = await launch();
try {
  const r = await renderHtmlToJpeg(browser, {
    name: "richmenu-v2", html: buildRichMenuHtml(), width: RICHMENU_SIZE.width, height: RICHMENU_SIZE.height,
    outPath, maxBytes: RICHMENU_MAX_BYTES, check,
  });
  console.log(`✅ ${RICHMENU_IMAGE} ${r.width}x${r.height} ${kb(r.bytes)} (JPEG q${r.quality}) — ฟอนต์ Prompt ขึ้นจริง ป้ายไม่ล้น ช่องตรงพิกัด`);
  console.log("   ต่อไป: npm test → deploy → /api/richmenu-setup?token=<SETUP_TOKEN>&action=preview&uid=<LINE uid>");
} finally {
  await browser.close();
}
