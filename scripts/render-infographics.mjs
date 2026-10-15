/* scripts/render-infographics.mjs — เรนเดอร์ภาพที่บอทส่งในแชต (30 ก.ย. 69 งาน T1a) รันตอน dev แล้ว commit ภาพเข้า repo
   - ภาพ "วิธีขอรับบริการ" 3 บริการ (กว้าง 1040 แนวตั้ง ≤ 1MB) + ภาพตัวอย่าง preview (≤ 240KB) — image message ที่ตอบ
     ปุ่มปรึกษา/จองคิว/ร้องเรียน แบบ ทต.หนองป่าครั่ง
   - ภาพหัวการ์ดต้อนรับ welcome-hero.jpg (1040x676 = 20:13)
   ข้อมูลทั้งหมดมาจาก api/_serviceinfo.js + DEFAULTS ใน api/_settings.js (เวลาทำการ/เบอร์)
   ⚠️ แก้เวลาทำการ/เบอร์ใน settings (หลังบ้าน) แล้ว → แก้ DEFAULTS ให้ตรง แล้วรันสคริปต์นี้ใหม่ + เปลี่ยน ASSET_VERSION ใน
      _serviceinfo.js (ไลน์แคชรูปตาม URL) + deploy — ภาพนิ่งดึงค่าจาก DB ตอนรันไม่ได้

   ครั้งแรก: npm install --no-save playwright && npx playwright install chromium
   รัน: npm run render-infographics */
import path from "node:path";
import { launch, renderHtmlToJpeg, renderPreview, PUBLIC_DIR, kb } from "./_render-lib.mjs";
import { buildHowtoHtml, buildWelcomeHeroHtml } from "./howto-template.mjs";
import { HOWTO_IMAGES, WELCOME_HERO } from "../api/_serviceinfo.js";
import { DEFAULTS } from "../api/_settings.js";

export const FULL_MAX_BYTES = 1024 * 1024; // originalContentUrl — ตั้งเพดานเอง 1MB (ไลน์รับถึง 10MB แต่คนเปิดบนเน็ตมือถือ)
export const PREVIEW_MAX_BYTES = 240 * 1024; // previewImageUrl
const WIDTH = 1040;
const PREVIEW_WIDTH = 520;

const browser = await launch();
try {
  for (const kind of Object.keys(HOWTO_IMAGES)) {
    const fullPath = path.join(PUBLIC_DIR, HOWTO_IMAGES[kind].full);
    const full = await renderHtmlToJpeg(browser, {
      name: "howto-" + kind, html: buildHowtoHtml(kind, DEFAULTS), width: WIDTH, outPath: fullPath, maxBytes: FULL_MAX_BYTES,
    });
    const prev = await renderPreview(browser, {
      fullPath, outPath: path.join(PUBLIC_DIR, HOWTO_IMAGES[kind].preview), width: PREVIEW_WIDTH,
      fullWidth: full.width, fullHeight: full.height, maxBytes: PREVIEW_MAX_BYTES,
    });
    console.log(`✅ ${HOWTO_IMAGES[kind].full} ${full.width}x${full.height} ${kb(full.bytes)} (q${full.quality}) · preview ${prev.width}x${prev.height} ${kb(prev.bytes)}`);
  }
  const hero = await renderHtmlToJpeg(browser, {
    name: "welcome-hero", html: buildWelcomeHeroHtml(), width: 1040, height: 676,
    outPath: path.join(PUBLIC_DIR, WELCOME_HERO), maxBytes: FULL_MAX_BYTES,
  });
  console.log(`✅ ${WELCOME_HERO} ${hero.width}x${hero.height} ${kb(hero.bytes)} (q${hero.quality})`);
  console.log("   ฟอนต์ Prompt ขึ้นจริงทุกภาพ · ต่อไป: เปลี่ยน ASSET_VERSION ใน api/_serviceinfo.js ถ้าเนื้อหาภาพเปลี่ยน → npm test → deploy");
} finally {
  await browser.close();
}
