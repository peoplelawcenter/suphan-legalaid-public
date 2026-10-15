/* scripts/_render-lib.mjs — ตัวช่วยเรนเดอร์ HTML → JPEG ด้วย Playwright ใช้ร่วมกันระหว่าง render-richmenu.mjs
   กับ render-infographics.mjs (เพิ่ม 30 ก.ย. 69 งาน T1a) — รันตอน dev เท่านั้น ไม่ขึ้น Vercel

   ⛔ ฟอนต์ไทยต้องขึ้นจริง ไม่ใช่ฟอนต์สำรองของเครื่อง — เทมเพลตเดิม (richmenu-template.html) ใช้ local('Prompt')
      ซึ่งเครื่องที่ไม่ได้ติดตั้ง Prompt จะตกไปใช้ Tahoma/Leelawadee เงียบๆ ไม่มี error → ชุดนี้ฝังไฟล์ฟอนต์เองจาก
      scripts/fonts/ (Prompt จาก Google Fonts — SIL OFL 1.1 ดู scripts/fonts/OFL.txt) แล้วตรวจ 2 ชั้นก่อนแคปเจอร์:
      (1) FontFace ตระกูล Prompt สถานะ loaded ครบทุกน้ำหนักที่ใช้ (2) ความกว้างข้อความไทยตั้งฟอนต์ Prompt ต้องต่างจาก
      ตอนตั้งฟอนต์สำรอง — ถ้าเท่ากัน = เบราว์เซอร์ยังใช้ฟอนต์สำรองอยู่ → หยุดทันที ไม่เขียนไฟล์
   ⛔ ไฟล์ต้องไม่เกินเพดาน LINE — ลดคุณภาพ JPEG ทีละขั้นจนพอดี ถ้าต่ำสุดแล้วยังเกิน = หยุด (ไม่เขียนไฟล์ที่ใช้ไม่ได้) */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

export const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(SCRIPTS_DIR, "..", "public");

// น้ำหนักฟอนต์ที่เทมเพลตใช้ได้ — ต้องมีไฟล์ครบใน scripts/fonts/
const FONT_WEIGHTS = { 400: "Prompt-Regular.ttf", 600: "Prompt-SemiBold.ttf", 700: "Prompt-Bold.ttf", 800: "Prompt-ExtraBold.ttf" };

/* @font-face สำหรับวางใน <style> ของเทมเพลต — path สัมพัทธ์กับไฟล์ HTML ที่เขียนไว้ใน scripts/ */
export function fontFaceCss() {
  return Object.entries(FONT_WEIGHTS).map(([w, f]) =>
    `@font-face{font-family:'Prompt';font-weight:${w};font-style:normal;font-display:block;src:url('fonts/${f}') format('truetype');}`
  ).join("\n");
}

/* path รูปสำหรับอ้างในเทมเพลต (สัมพัทธ์กับ scripts/) */
export const icon3d = (name) => `../public/assets/icons3d/${name}.png`;
export const asset = (name) => `../public/assets/${name}`;

export async function launch() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("ยังไม่มี playwright ในเครื่อง — รัน: npm install --no-save playwright && npx playwright install chromium");
    process.exit(1);
  }
  return chromium.launch();
}

/* รอฟอนต์+รูปโหลดครบ แล้วยืนยันว่าเป็น Prompt จริง — throw ถ้าไม่ผ่าน */
async function assertAssetsReady(page, label) {
  const report = await page.evaluate(async (weights) => {
    await Promise.all(weights.map((w) => document.fonts.load(`${w} 40px "Prompt"`, "ศูนย์ช่วยเหลือ")));
    await document.fonts.ready;
    const loaded = [...document.fonts].filter((f) => f.family.replace(/["']/g, "") === "Prompt" && f.status === "loaded").map((f) => String(f.weight));
    const measure = (family) => {
      const s = document.createElement("span");
      s.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:700 60px ${family}`;
      s.textContent = "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย";
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    const withPrompt = measure(`"Prompt", serif`);
    const fallbackOnly = measure(`serif`);
    const imgs = [...document.images].map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0 }));
    return { loaded, withPrompt, fallbackOnly, badImgs: imgs.filter((i) => !i.ok).map((i) => i.src), imgCount: imgs.length };
  }, Object.keys(FONT_WEIGHTS));
  const missing = Object.keys(FONT_WEIGHTS).filter((w) => !report.loaded.includes(w));
  if (missing.length) throw new Error(`${label}: ฟอนต์ Prompt น้ำหนัก ${missing.join(",")} โหลดไม่ขึ้น (ตรวจ scripts/fonts/)`);
  if (Math.abs(report.withPrompt - report.fallbackOnly) < 1) throw new Error(`${label}: ข้อความไทยยังเป็นฟอนต์สำรอง (กว้างเท่ากัน ${report.withPrompt}px)`);
  if (report.badImgs.length) throw new Error(`${label}: รูปโหลดไม่ขึ้น ${report.badImgs.join(", ")}`);
  return report;
}

/* screenshot เป็น JPEG ลดคุณภาพทีละขั้นจนไฟล์ ≤ maxBytes */
async function shootJpeg(page, outPath, maxBytes, clip) {
  for (const quality of [92, 88, 84, 80, 76, 72, 68, 64, 60]) {
    const buf = await page.screenshot({ type: "jpeg", quality, ...(clip ? { clip } : {}) });
    if (buf.length <= maxBytes) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buf);
      return { bytes: buf.length, quality };
    }
  }
  throw new Error(`${path.basename(outPath)}: บีบถึงคุณภาพ 60 แล้วยังเกิน ${maxBytes} ไบต์ — ลดรายละเอียดในเทมเพลต`);
}

/* เรนเดอร์ HTML 1 หน้าเป็น JPEG
   width = ความกว้างภาพ · height = null → สูงตามเนื้อหา (document.body.scrollHeight)
   check(page) = ตรวจเพิ่มเฉพาะงาน (เช่น ขนาดป้าย/ข้อความล้นกล่อง) throw ถ้าไม่ผ่าน */
export async function renderHtmlToJpeg(browser, { name, html, width, height = null, outPath, maxBytes, check }) {
  const htmlPath = path.join(SCRIPTS_DIR, `_out-${name}.html`); // scripts/_out-* อยู่ใน .gitignore แล้ว
  fs.writeFileSync(htmlPath, html, "utf8");
  const page = await browser.newPage({ viewport: { width, height: height || 800 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(htmlPath).href);
    await assertAssetsReady(page, name);
    let h = height;
    if (!h) {
      h = await page.evaluate(() => Math.ceil(document.body.scrollHeight));
      await page.setViewportSize({ width, height: h });
    }
    if (check) await check(page);
    const r = await shootJpeg(page, outPath, maxBytes, { x: 0, y: 0, width, height: h });
    return { ...r, width, height: h };
  } finally {
    await page.close();
  }
}

/* ย่อภาพที่เรนเดอร์แล้วเป็นภาพตัวอย่าง (previewImageUrl ของ image message) */
export async function renderPreview(browser, { fullPath, outPath, width, fullWidth, fullHeight, maxBytes }) {
  const h = Math.round((fullHeight * width) / fullWidth);
  const page = await browser.newPage({ viewport: { width, height: h }, deviceScaleFactor: 1 });
  try {
    // เปิดเป็นไฟล์ (ไม่ใช่ setContent) — หน้า about:blank โหลดรูป file:// ไม่ได้
    const src = pathToFileURL(fullPath).href;
    const htmlPath = path.join(SCRIPTS_DIR, "_out-preview.html");
    fs.writeFileSync(htmlPath, `<html><body style="margin:0"><img id="i" src="${src}" style="display:block;width:${width}px;height:${h}px"></body></html>`, "utf8");
    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForFunction(() => document.getElementById("i").complete && document.getElementById("i").naturalWidth > 0);
    const r = await shootJpeg(page, outPath, maxBytes, { x: 0, y: 0, width, height: h });
    return { ...r, width, height: h };
  } finally {
    await page.close();
  }
}

export const kb = (n) => (n / 1024).toFixed(0) + "KB";
