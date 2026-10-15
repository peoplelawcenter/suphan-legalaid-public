/* scripts/render-poster.mjs — เรนเดอร์ scripts/poster-template.html เป็น public/assets/poster-counter.png
   (1240x1754 ~A4 แนวตั้ง @150dpi) ป้ายหน้าเคาน์เตอร์ (อบจ./ศาล/สภาทนายความ) แนวคิดจากโปสเตอร์ QR ของ
   Traffy Fondue (คู่มืออบรม 2025 หน้า 38-39) — สแกนแล้วเพิ่มเพื่อน LINE OA ได้ทันที รันตอน dev เท่านั้น
   แล้ว commit ไฟล์ PNG เข้า repo (เหมือน render-richmenu.mjs — Vercel ไม่เรนเดอร์รูปนี้สดตอน deploy)

   ไม่ใส่ playwright/qrcode ใน package.json (ไม่ต้องใช้ตอน runtime บน Vercel เลย) — ครั้งแรกที่รันสคริปต์นี้
   ให้ทำ: npm install --no-save playwright qrcode && npx playwright install chromium

   แก้ QR/เนื้อหาโปสเตอร์แล้ว: npm run render-poster แล้ว commit รูปใหม่ (ไม่ต้อง deploy/ยิง API ใดๆ
   ต่างจาก richmenu — โปสเตอร์นี้เป็นไฟล์ไว้ดาวน์โหลด/พิมพ์เท่านั้น ไม่ได้เชื่อมกับ LINE) */
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, "poster-template.html");
const qrOutPath = path.join(__dirname, "..", "public", "assets", "qr-lineoa.png");
const posterOutPath = path.join(__dirname, "..", "public", "assets", "poster-counter.png");

// LINE Official Account ID ของศูนย์นี้ (ยืนยันจริงตอนสมัคร 15 ก.ย. 69 — ดู memory/project docs)
const LINE_ADD_FRIEND_URL = "https://line.me/R/ti/p/@073kbdgu";

let QRCode, chromium;
try {
  ({ default: QRCode } = await import("qrcode"));
  ({ chromium } = await import("playwright"));
} catch {
  console.error("ยังไม่มี playwright/qrcode ในเครื่อง — รัน: npm install --no-save playwright qrcode && npx playwright install chromium");
  process.exit(1);
}

await QRCode.toFile(qrOutPath, LINE_ADD_FRIEND_URL, { width: 900, margin: 1, color: { dark: "#0B2E6D", light: "#FFFFFF" } });
console.log("✅ เรนเดอร์ QR เสร็จแล้ว → " + qrOutPath);

const browser = await chromium.launch();
// height เป็นแค่ viewport เริ่มต้น (เนื้อหาจริงสูงกว่านี้เล็กน้อย) — fullPage:true จับความสูงจริงทั้งหมด
// ไม่ตัดขาดเหมือนลอง screenshot ปกติรอบแรก (พบว่าเนื้อหายาวกว่า 1754px จนฟีเจอร์/ท้ายกระดาษหายไป)
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
await page.goto("file://" + templatePath.replace(/\\/g, "/"));
await page.screenshot({ path: posterOutPath, fullPage: true });
await browser.close();

console.log("✅ เรนเดอร์ poster-counter.png เสร็จแล้ว → " + posterOutPath);
console.log("   ต่อไป: commit ไฟล์ PNG ทั้งสองเข้า repo (ไม่ต้อง deploy/ยิง API ใดๆ เพิ่ม)");
