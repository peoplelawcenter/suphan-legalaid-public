/* ตรวจ Open Graph ของหน้าที่ส่งให้ประชาชนผ่าน LINE แบบออฟไลน์
   หน้าหลังบ้านไม่อยู่ในรายการนี้โดยตั้งใจ เพราะไม่ควรถูกนำไปแชร์เป็นการ์ดสาธารณะ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderView, fallbackChrome } from "../api/_site-render.js";
import { NEWS_CATEGORY_KEYS, categoryInfo, SITE_CONFIG_DEFAULTS } from "../api/_site-shared.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = "https://suphan-legalaid.vercel.app";
const imageUrl = `${baseUrl}/assets/og-legal-aid-v2.png`;
process.env.SITE_URL = baseUrl;
const homeChrome = fallbackChrome(); homeChrome.config = { ...SITE_CONFIG_DEFAULTS };
const homeHtml = renderView({
  kind: "page", view: "home", chrome: homeChrome, banners: [], people: [], knowledge: [], faqs: [], docs: [],
  newsTabs: NEWS_CATEGORY_KEYS.map((key) => ({ key, info: categoryInfo(key), items: [] })),
}, { preview: false, now: new Date("2026-10-02T00:00:00Z"), path: "/" });
const pages = [
  ["หน้าแรก SSR", `${baseUrl}/`, homeHtml],
  ["consult.html", `${baseUrl}/consult.html`],
  ["complaint.html", `${baseUrl}/complaint.html`],
  ["appointment.html", `${baseUrl}/appointment.html`],
  ["add-evidence.html", `${baseUrl}/add-evidence.html`],
];
const requiredOg = [
  "og:type", "og:site_name", "og:title", "og:description", "og:image",
  "og:image:secure_url", "og:image:type", "og:image:width", "og:image:height",
  "og:image:alt", "og:url", "og:locale",
];

function attributes(tag) {
  return Object.fromEntries(
    Array.from(tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g), (match) => [match[1].toLowerCase(), match[2]])
  );
}

function metadata(html) {
  const result = new Map();
  for (const match of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = attrs.property || attrs.name;
    if (key) result.set(key.toLowerCase(), attrs.content || "");
  }
  return result;
}

function canonical(html) {
  for (const match of html.matchAll(/<link\s+[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if ((attrs.rel || "").toLowerCase() === "canonical") return attrs.href || "";
  }
  return "";
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [file, expectedUrl, rendered] of pages) {
  const html = rendered || fs.readFileSync(path.join(root, "public", file), "utf8");
  const meta = metadata(html);
  for (const name of requiredOg) check(meta.get(name), `${file}: ขาด ${name}`);
  check(meta.get("og:type") === "website", `${file}: og:type ต้องเป็น website`);
  check(meta.get("og:image") === imageUrl, `${file}: og:image ไม่ใช่ภาพเวอร์ชันล่าสุด`);
  check(meta.get("og:image:secure_url") === imageUrl, `${file}: og:image:secure_url ไม่ตรงกับ og:image`);
  check(meta.get("og:image:type") === "image/png", `${file}: og:image:type ต้องเป็น image/png`);
  check(meta.get("og:image:width") === "1200" && meta.get("og:image:height") === "630", `${file}: ขนาด OG ต้องเป็น 1200x630`);
  check(meta.get("og:url") === expectedUrl, `${file}: og:url ไม่ตรง URL หลักของหน้า`);
  check(canonical(html) === expectedUrl, `${file}: canonical ไม่ตรง URL หลักของหน้า`);
  check(meta.get("twitter:card") === "summary_large_image", `${file}: ขาด twitter:card`);
  check(meta.get("twitter:image") === imageUrl, `${file}: twitter:image ไม่ตรงกับ og:image`);
  check(meta.get("twitter:image:alt"), `${file}: ขาด twitter:image:alt`);
  check(!/[?&](?:k|case|token)=/i.test(meta.get("og:url")), `${file}: og:url ต้องไม่มี token/query ส่วนบุคคล`);
}

const png = fs.readFileSync(path.join(root, "public", "assets", "og-legal-aid-v2.png"));
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
check(png.subarray(0, 8).equals(pngSignature), "ไฟล์ OG ไม่ใช่ PNG");
check(png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, "ขนาดไฟล์ OG จริงต้องเป็น 1200x630");

console.log(`✅ OG ครบ ${pages.length} หน้าสาธารณะ ภาพ PNG 1200x630 และไม่มี token ใน URL`);
