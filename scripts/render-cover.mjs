/* scripts/render-cover.mjs — เรนเดอร์ scripts/logo-cover-template.html เป็น public/assets/logo-line-cover.png
   (1080x878, รูปปกโปรไฟล์ LINE OA) รันตอน dev เท่านั้นแล้ว commit ไฟล์ PNG เข้า repo (บอสอัปโหลดเข้า
   manager.line.biz เองตามขั้นที่ 1 ใน docs/SETUP-GUIDE.md — สคริปต์นี้ไม่ได้ยิง API ขึ้น LINE ให้)

   viewport ตั้งให้เท่ากับขนาดจริงของ html/body ในเทมเพลตเป๊ะๆ (1080x878) เพื่อให้ flexbox centering
   ที่เขียนไว้ในเทมเพลต (align-items/justify-content: center) เรนเดอร์ออกมากึ่งกลางจริง — ถ้า viewport
   ใหญ่/เล็กกว่ากรอบเนื้อหา เนื้อหาจะเลื่อนไปมุมใดมุมหนึ่งแทนที่จะกึ่งกลาง (บั๊กจริงที่เจอ 18 ก.ย. 69:
   ของเดิมเนื้อหาเบียดไปมุมล่างขวา เหลือขอบซ้าย/บน 300px แต่ขอบขวา/ล่างแค่ 30-80px)

   ไม่ใส่ playwright ใน package.json (เหตุผลเดียวกับ render-richmenu.mjs) — ครั้งแรกที่รันสคริปต์นี้ให้ทำ:
     npm install --no-save playwright && npx playwright install chromium */
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, "logo-cover-template.html");
const outPath = path.join(__dirname, "..", "public", "assets", "logo-line-cover.png");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("ยังไม่มี playwright ในเครื่อง — รัน: npm install --no-save playwright && npx playwright install chromium");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 878 } });
await page.goto("file://" + templatePath.replace(/\\/g, "/"));
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(
    Array.from(document.images).map((img) =>
      img.complete ? Promise.resolve() : new Promise((res) => { img.onload = img.onerror = res; })
    )
  );
});
await page.screenshot({ path: outPath }); // ไม่ใส่ fullPage/clip — viewport เท่ากับกรอบเนื้อหาเป๊ะแล้ว
await browser.close();

console.log("✅ เรนเดอร์ logo-line-cover.png เสร็จแล้ว → " + outPath);
console.log("   ถ้าเคยอัปโหลดรูปเก่า (เบียดมุมล่างขวา) เข้า manager.line.biz ไว้แล้ว ต้องอัปโหลดรูปใหม่ทับด้วย");
