/* ตรวจภาพเว็บไซต์จำลองทุก view ที่มือถือ/เดสก์ท็อป และเก็บภาพไว้นอก repo
   ใช้: node scripts/check-site-visual.mjs --base=http://localhost:4310 --label=fixtures */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const arg = (name, fallback) => (process.argv.find((v) => v.startsWith(`--${name}=`)) || "").slice(name.length + 3) || fallback;
const base = arg("base", "http://localhost:4310").replace(/\/$/, "");
const label = arg("label", "fixtures").replace(/[^a-z0-9_-]/gi, "-");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = arg("out", path.join(os.tmpdir(), `suphan-legalaid-visual-${stamp}`));
fs.mkdirSync(out, { recursive: true });

const views = [
  ["home", "/"], ["news", "/news"], ["news-post", "/news/1"],
  ["knowledge", "/knowledge"], ["knowledge-post", "/knowledge/16"],
  ["faq", "/faq"], ["documents", "/documents"], ["about", "/about"],
  ["services", "/services"], ["contact", "/contact"], ["page", "/page/history"], ["404", "/nope"],
];
const sizes = [["mobile", 390, 844], ["desktop", 1440, 900]];
const blockedHosts = /(^|\.)(facebook\.com|google\.com|youtube\.com|youtube-nocookie\.com)$/i;
const results = [];
const browser = await chromium.launch({ headless: true });

try {
  for (const [size, width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: "light", locale: "th-TH" });
    await context.addInitScript(() => localStorage.clear());
    for (const [name, urlPath] of views) {
      const page = await context.newPage();
      const errors = [];
      const forbidden = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
      page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
      page.on("request", (req) => {
        try { if (blockedHosts.test(new URL(req.url()).hostname)) forbidden.push(req.url()); } catch {}
      });
      const response = await page.goto(`${base}${urlPath}`, { waitUntil: "networkidle", timeout: 20000 });
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
          window.scrollTo(0, y);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
        window.scrollTo(0, 0);
      });
      await page.mouse.move(1, 1);
      const metrics = await page.evaluate(() => ({
        title: document.title,
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        brokenImages: [...document.images].filter((img) => img.complete && img.currentSrc && img.naturalWidth === 0).map((img) => img.currentSrc),
      }));
      const file = path.join(out, `${label}-${size}-${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      results.push({ label, size, name, path: urlPath, status: response?.status(), file, ...metrics, errors, forbidden });
      await page.close();
    }
    await context.close();
  }

  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await reduced.newPage();
  await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 20000 });
  const pauseState = await page.locator("[data-pause]").getAttribute("aria-pressed").catch(() => null);
  results.push({ label, size: "reduced-motion", name: "home", pauseState });
  await reduced.close();
} finally {
  await browser.close();
}

const failures = results.flatMap((r) => {
  const found = [];
  if (r.scrollWidth > r.innerWidth + 1) found.push(`${r.size}/${r.name}: horizontal overflow ${r.scrollWidth}>${r.innerWidth}`);
  const unexpectedErrors = (r.errors || []).filter((error) => {
    const expectedDocumentError = r.status >= 400 && error.includes(`status of ${r.status}`);
    return !expectedDocumentError;
  });
  if (unexpectedErrors.length) found.push(`${r.size}/${r.name}: ${unexpectedErrors.join(" | ")}`);
  if (r.forbidden?.length) found.push(`${r.size}/${r.name}: โหลด third-party ก่อนยินยอม ${r.forbidden.join(", ")}`);
  if (r.brokenImages?.length) found.push(`${r.size}/${r.name}: รูปเสีย ${r.brokenImages.join(", ")}`);
  if (r.size === "reduced-motion" && r.pauseState !== null && r.pauseState !== "true") found.push("reduced-motion: สไลด์ไม่ได้เริ่มในสถานะหยุด");
  return found;
});
fs.writeFileSync(path.join(out, `${label}-summary.json`), JSON.stringify({ base, results, failures }, null, 2));
console.log(`ภาพและผลตรวจ: ${out}`);
console.log(`ตรวจ ${results.length} สถานะ · ปัญหา ${failures.length}`);
for (const failure of failures) console.error(`- ${failure}`);
if (failures.length) process.exitCode = 1;
