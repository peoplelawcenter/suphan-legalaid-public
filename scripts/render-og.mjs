/* scripts/render-og.mjs — เรนเดอร์ scripts/og-image-template.html เป็น public/assets/og-legal-aid-v2.png
   (1200x630 — ขนาดมาตรฐาน Open Graph) รันตอน dev เท่านั้นแล้ว commit ไฟล์ PNG เข้า repo (ภาพนิ่ง ไม่ใช้
   Chromium เรนเดอร์สดตอน deploy — แนวทางเดียวกับ render-cover.mjs/render-richmenu.mjs ในโปรเจกต์นี้)

   ใช้รูปเดียวกันทุกหน้า (index.html + ฟอร์มประชาชนทั้ง 4 หน้า) — แต่ละหน้าตั้ง og:title/og:description
   ของตัวเองต่างกันได้ ใช้แค่รูปนี้ร่วมกัน ไม่ต้องเรนเดอร์แยกทุกหน้า

   ไม่ใส่ playwright ใน package.json — ครั้งแรกที่รันสคริปต์นี้ให้ทำ:
     npm install --no-save playwright && npx playwright install chromium */
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, "og-image-template.html");
const outPath = path.join(__dirname, "..", "public", "assets", "og-legal-aid-v2.png");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("ยังไม่มี playwright ในเครื่อง — รัน: npm install --no-save playwright && npx playwright install chromium");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
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

console.log("✅ เรนเดอร์ og-legal-aid-v2.png เสร็จแล้ว → " + outPath);
