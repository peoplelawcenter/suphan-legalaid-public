/* scripts/check-site-interactive.mjs — ตรวจการทำงานจริงของ public/site.js บนเบราว์เซอร์ (เพิ่ม 5 ต.ค. 69 ตามผลตรวจ code-reviewer)
   ครอบ: lightbox แกลเลอรี (เปิด/เลื่อนด้วยปุ่ม-ลูกศร-ปัดนิ้ว/ปิดด้วย Esc-ปุ่ม-พื้นหลัง/คืนโฟกัส) · ปุ่มคัดลอกลิงก์ · ปุ่ม ก-/ก/ก+ (16/18/20px)
         · ฟอนต์โฮสต์เองโหลดจริง (Prompt/Sarabun ไม่ตกเป็นฟอนต์ระบบ) · ไม่มีคำขอออกนอกโดเมนก่อนยินยอม · ไม่มีเลื่อนแนวนอน · ไม่มี console error
         · /index.html → / · หน้าฟอร์มใช้ฟอนต์โฮสต์เอง
   ใช้: (หน้าต่าง 1) node scripts/dev-site.mjs   (หน้าต่าง 2) node scripts/check-site-interactive.mjs --base=http://localhost:4310
   ต้องมี Playwright ในเครื่อง (ไม่อยู่ใน package.json เหมือน render-*.mjs) — ติดตั้งไว้ที่อื่นได้ด้วย env PLAYWRIGHT_MODULE=<path ไปยัง playwright/index.js>
   ⛔ ใช้ในเครื่องเท่านั้น (scripts/ ไม่ขึ้น deploy) · ไม่แตะฐานจริง (dev-site ใช้ Supabase ปลอม) */
import { pathToFileURL } from "node:url";

const { chromium } = await import("playwright").catch(async () => {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error("ไม่พบ playwright — ติดตั้งเอง หรือตั้ง env PLAYWRIGHT_MODULE");
  const m = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  return m.default || m;
});

const arg = (name, fallback) => (process.argv.find((v) => v.startsWith(`--${name}=`)) || "").slice(name.length + 3) || fallback;
const base = arg("base", "http://localhost:4310").replace(/\/$/, "");
const baseHost = new URL(base).hostname;
const LOCAL = new Set([baseHost, "localhost", "127.0.0.1"]);
let passed = 0;
const failures = [];
const check = (cond, msg) => { if (cond) passed++; else failures.push(msg); };

const browser = await chromium.launch({ headless: true });
try {
  for (const [label, width, height, touch] of [["390px", 390, 844, true], ["1440px", 1440, 900, false]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, locale: "th-TH", colorScheme: "light" });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const page = await ctx.newPage();
    const errors = [], external = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => { try { const h = new URL(r.url()).hostname; if (!LOCAL.has(h)) external.push(r.url()); } catch {} });
    const T = (m) => `[${label}] ${m}`;

    /* ── หน้าข่าวที่มีแกลเลอรี ── */
    await page.goto(`${base}/news/1`, { waitUntil: "networkidle" });
    await page.evaluate(() => { try { localStorage.clear(); } catch {} });
    await page.reload({ waitUntil: "networkidle" });
    const items = await page.$$eval(".gal-item", (as) => as.map((a) => a.href));
    check(items.length >= 2, T(`แกลเลอรีมีภาพ ≥ 2 (ได้ ${items.length})`));
    const lbState = () => page.evaluate(() => {
      const d = document.querySelector("#lightbox"), img = d?.querySelector(".lb-img");
      return { open: !!d?.open, src: img?.src || "", cap: d?.querySelector(".lb-cap")?.textContent || "", locked: document.documentElement.classList.contains("lb-open"),
        active: document.activeElement?.className || "", activeHref: document.activeElement?.href || "", natural: img?.naturalWidth || 0 };
    });
    await page.locator(".gal-item").first().scrollIntoViewIfNeeded();
    await page.locator(".gal-item").first().click();
    let s = await lbState();
    check(s.open && s.src === items[0], T("กดรูปแรกแล้ว lightbox เปิดภาพที่ 1"));
    check(s.cap.includes(`ภาพที่ 1 จาก ${items.length}`), T(`คำบรรยายบอกลำดับภาพ (ได้ "${s.cap}")`));
    check(s.locked && /lb-close/.test(s.active), T("ล็อกเลื่อนหน้าหลัง + โฟกัสอยู่ที่ปุ่มปิด"));
    await page.waitForFunction(() => document.querySelector(".lb-img")?.complete);
    s = await lbState();
    check(s.natural > 0, T("ภาพใน lightbox โหลดได้จริง"));
    await page.keyboard.press("ArrowRight");
    s = await lbState();
    check(s.src === items[1], T("ลูกศรขวา = ภาพถัดไป"));
    await page.locator("[data-lb-next]").click();
    s = await lbState();
    check(s.src === items[2 % items.length], T("ปุ่มถัดไป = เลื่อนต่อ"));
    await page.locator("[data-lb-prev]").click();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    s = await lbState();
    check(s.src === items[items.length - 1], T("ย้อนจากภาพแรก = วนไปภาพสุดท้าย"));
    const btnBox = await page.locator("[data-lb-next]").boundingBox();
    check(btnBox && btnBox.width >= 44 && btnBox.height >= 44 && btnBox.x + btnBox.width <= width, T("ปุ่มเลื่อนภาพ ≥ 44px และอยู่ในจอ"));
    if (touch) {
      await page.evaluate(() => {
        const d = document.querySelector("#lightbox");
        const mk = (x) => new Touch({ identifier: 1, target: d, clientX: x, clientY: 400 });
        d.dispatchEvent(new TouchEvent("touchstart", { touches: [mk(300)], changedTouches: [mk(300)], bubbles: true }));
        d.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [mk(120)], bubbles: true }));
      });
      s = await lbState();
      check(s.src === items[0], T("ปัดนิ้วซ้าย = ภาพถัดไป (วนกลับภาพแรก)"));
    }
    const settle = () => page.evaluate(() => new Promise((r) => setTimeout(r, 50))); // event "close" ของ dialog มาเป็น task ถัดไปหลัง open=false
    await page.keyboard.press("Escape");
    await settle();
    s = await lbState();
    check(!s.open && !s.locked && s.activeHref === items[0], T(`Esc ปิด + ปลดล็อกเลื่อน + คืนโฟกัสไปรูปที่กด (open=${s.open} locked=${s.locked} focus=${s.active || s.activeHref})`));
    await page.locator(".gal-item").nth(1).click();
    await page.locator("[data-lb-close]").click();
    await settle();
    s = await lbState();
    check(!s.open && s.activeHref === items[1], T("ปุ่มปิดใช้ได้ + คืนโฟกัสรูปที่ 2"));
    await page.locator(".gal-item").first().click();
    await page.mouse.click(3, 3); // พื้นหลังมืด (::backdrop)
    await settle();
    s = await lbState();
    check(!s.open && !s.locked, T("แตะพื้นหลัง = ปิด + ปลดล็อกเลื่อน"));

    /* ── ปุ่มคัดลอกลิงก์ ── */
    const copy = page.locator("[data-copy]");
    check(await copy.isVisible(), T("ปุ่มคัดลอกลิงก์แสดง (มี Clipboard API)"));
    const want = await copy.getAttribute("data-copy");
    await copy.scrollIntoViewIfNeeded();
    await copy.click();
    const copied = await page.waitForFunction(() => document.querySelector("[data-copy-label]")?.textContent === "คัดลอกแล้ว", null, { timeout: 1500 }).then(() => true, () => false);
    check(copied, T("กดแล้วป้ายเป็น 'คัดลอกแล้ว'"));
    check((await page.evaluate(() => navigator.clipboard.readText())) === want, T("คลิปบอร์ดได้ลิงก์บทความ"));
    await page.waitForTimeout(2300);
    check((await page.locator("[data-copy-label]").textContent()) === "คัดลอกลิงก์", T("ป้ายกลับเป็นเดิมใน ~2 วิ"));

    /* ── ปุ่ม ก-/ก/ก+ ── */
    await page.evaluate(() => window.scrollTo(0, 0));
    const fs = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    const press = async (v) => { await page.locator(`[data-fs="${v}"]`).click(); return fs(); };
    check(await fs() === "16px", T("ค่าเริ่มต้น 16px"));
    const seq = [["1", "18px"], ["1", "20px"], ["1", "20px"], ["-1", "18px"], ["0", "16px"], ["-1", "16px"], ["1", "18px"]];
    for (const [v, px] of seq) { const got = await press(v); check(got === px, T(`กด data-fs=${v} → ${px} (ได้ ${got})`)); }
    await page.reload({ waitUntil: "networkidle" });
    check(await fs() === "18px", T("จำขนาดหลังโหลดหน้าใหม่ (localStorage)"));
    await press("0");
    await page.evaluate(() => { try { localStorage.setItem("site_font_size", "9"); } catch {} });
    await page.reload({ waitUntil: "networkidle" });
    check(await fs() === "16px", T("ค่าเสียใน localStorage = ขนาดปกติ ไม่พัง"));

    /* ── ฟอนต์โฮสต์เอง + เลื่อนแนวนอน ── */
    const fontInfo = await page.evaluate(async () => {
      await document.fonts.ready;
      const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family.replace(/"/g, "")} ${f.weight} ${f.style}`);
      return { loaded, sarabun: document.fonts.check("16px Sarabun", "ก"), prompt: document.fonts.check("700 16px Prompt", "ก"),
        scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
    });
    check(fontInfo.loaded.some((f) => f.startsWith("Sarabun")) && fontInfo.loaded.some((f) => f.startsWith("Prompt")), T(`ฟอนต์ Prompt+Sarabun โหลดสำเร็จ (${fontInfo.loaded.join(", ")})`));
    check(fontInfo.sarabun && fontInfo.prompt, T("document.fonts.check ภาษาไทย Prompt/Sarabun = true"));
    check(fontInfo.scrollW <= fontInfo.innerW, T(`ไม่มีเลื่อนแนวนอน (${fontInfo.scrollW}/${fontInfo.innerW})`));

    /* ── หน้าแรก + /index.html ── */
    const r = await page.goto(`${base}/index.html`, { waitUntil: "networkidle" });
    check(new URL(page.url()).pathname === "/" && r.status() === 200, T("/index.html พาไปหน้าแรก"));
    const homeW = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(homeW[0] <= homeW[1], T("หน้าแรกไม่มีเลื่อนแนวนอน"));

    check(external.length === 0, T(`ไม่มีคำขอออกนอกโดเมนก่อนยินยอม (${external.slice(0, 3).join(" ")})`));
    check(errors.length === 0, T(`ไม่มี console error (${errors.slice(0, 3).join(" | ")})`));

    /* ── หน้าฟอร์ม: ฟอนต์โฮสต์เองขึ้นจริง ── */
    const fpage = await ctx.newPage();
    const fExternal = [];
    fpage.on("request", (q) => { try { const h = new URL(q.url()).hostname; if (/fonts\.(googleapis|gstatic)\.com/.test(h)) fExternal.push(q.url()); } catch {} });
    await fpage.goto(`${base}/appointment.html`, { waitUntil: "networkidle" });
    const fInfo = await fpage.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")); });
    check(fInfo.includes("Prompt") || fInfo.includes("Sarabun"), T(`หน้าฟอร์มโหลดฟอนต์โฮสต์เอง (${[...new Set(fInfo)].join(",")})`));
    check(fExternal.length === 0, T("หน้าฟอร์มไม่เรียก Google Fonts"));
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`❌ check-site-interactive: ผ่าน ${passed} · ไม่ผ่าน ${failures.length}\n - ${failures.join("\n - ")}`);
  process.exit(1);
}
console.log(`✅ check-site-interactive.mjs ผ่านทั้งหมด (${passed} ข้อตรวจ · 390px + 1440px)`);
