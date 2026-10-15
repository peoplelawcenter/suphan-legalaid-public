/* scripts/render-icon.mjs — เรนเดอร์ scripts/logo-icon-template.html เป็น public/assets/logo-line-icon.png
   (1000x1000, รูปโปรไฟล์วงกลม LINE OA) รันตอน dev เท่านั้นแล้ว commit ไฟล์ PNG เข้า repo (บอสอัปโหลดเข้า
   manager.line.biz เอง — ดู render-cover.mjs สำหรับเหตุผลที่ viewport ต้องเท่ากับขนาดเทมเพลตเป๊ะๆ
   เจอบั๊กเดียวกัน — ไฟล์เดิมเนื้อหาเบียดไปมุมล่างขวาเช่นกัน)

   ไม่ใส่ playwright ใน package.json — ครั้งแรกที่รันสคริปต์นี้ให้ทำ:
     npm install --no-save playwright && npx playwright install chromium */
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, "logo-icon-template.html");
const outPath = path.join(__dirname, "..", "public", "assets", "logo-line-icon.png");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("ยังไม่มี playwright ในเครื่อง — รัน: npm install --no-save playwright && npx playwright install chromium");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
await page.goto("file://" + templatePath.replace(/\\/g, "/"));
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(
    Array.from(document.images).map((img) =>
      img.complete ? Promise.resolve() : new Promise((res) => { img.onload = img.onerror = res; })
    )
  );
});
await page.screenshot({ path: outPath });
await browser.close();

console.log("✅ เรนเดอร์ logo-line-icon.png เสร็จแล้ว → " + outPath);
console.log("   ถ้าเคยอัปโหลดรูปเก่า (เบียดมุมล่างขวา) เข้า manager.line.biz ไว้แล้ว ต้องอัปโหลดรูปใหม่ทับด้วย");
