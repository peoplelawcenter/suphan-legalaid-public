/* SSR entry point ของเว็บไซต์สาธารณะ — หน้า public ห้ามขึ้นกับ session ยกเว้น ?preview=1 */
import { db } from "./_db.js";
import { getSettings } from "./_settings.js";
import { loadView, VIEWS, canPreviewFromSession } from "./_site-data.js";
import { renderView, renderNotFound, renderUnavailable, renderSitemap, fallbackChrome } from "./_site-render.js";

const HTML_CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=600";
// 5 ต.ค. 69 (บอสอนุมัติ — minor 4): ฟอนต์โฮสต์เอง → style-src/font-src เหลือ 'self' (เอาโดเมน Google Fonts ออก · test-site.mjs ล็อกไว้)
export function csp() {
  let mediaOrigin = "";
  try { mediaOrigin = new URL(process.env.SUPABASE_URL || "").origin; } catch {}
  return [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "font-src 'self'", `img-src 'self' data:${mediaOrigin ? ` ${mediaOrigin}` : ""}`,
  "frame-src https://www.facebook.com https://www.google.com https://maps.google.com https://www.youtube-nocookie.com",
  "connect-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", "object-src 'none'", "upgrade-insecure-requests",
  ].join("; ");
}

function one(v) { return Array.isArray(v) ? v[0] : v; }
function paramsOf(q) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q || {})) if (k !== "view" && v != null) p.set(k, one(v));
  return p;
}
function pathOf(view, p) {
  if (view === "home") return "/";
  if (view === "post") return `/${p.get("section") === "knowledge" ? "knowledge" : "news"}/${p.get("id") || ""}`;
  if (view === "page") return `/page/${p.get("slug") || ""}`;
  if (view === "sitemap") return "/sitemap.xml";
  return `/${view}`;
}
function common(res) {
  res.setHeader("Content-Security-Policy", csp());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

export default async function handler(req, res) {
  common(res);
  if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("Allow", "GET, HEAD"); return res.status(405).end(); }
  const view = String(one(req.query?.view) || "home");
  const params = paramsOf(req.query);
  const path = pathOf(view, params);
  const wantsPreview = params.get("preview") === "1";
  // ไม่มีสิทธิ์ต้องเห็นเหมือนผู้ชมทั่วไป ห้ามตอบต่างจนบอกได้ว่ามีร่างอยู่ (WEBSITE-SPEC 4.4)
  const preview = wantsPreview && await canPreviewFromSession(req);
  if (preview) res.setHeader("X-Robots-Tag", "noindex, nofollow");
  // 5 ต.ค. 69 (ผลตรวจ code-reviewer minor 2): ขอ ?preview=1 = ห้าม CDN แคชเสมอ ไม่ว่ามีสิทธิ์หรือไม่ — เดิมคนไม่มีสิทธิ์ได้ public/s-maxage
  // แล้ว CDN (ไม่สนคุกกี้) เก็บหน้าสาธารณะ/404 ไว้ที่ URL นี้ → ผู้ดูแลเว็บที่ล็อกอินแล้วกด "ดูตัวอย่าง" ได้หน้าในแคชแทนร่าง
  // เนื้อหาที่คนไม่มีสิทธิ์เห็นยังเหมือนผู้ชมทั่วไปทุกอย่าง (ต่างแค่ header แคช ไม่บอกว่ามีร่างอยู่)
  const cacheOr = (publicValue) => (wantsPreview ? "private, no-store" : publicValue);
  try {
    const known = VIEWS.includes(view) ? view : "_404";
    const ctx = { client: db, getSettings, preview, now: new Date() };
    const model = known === "_404" ? { kind: "notfound", chrome: fallbackChrome() } : await loadView(known, params, ctx);
    if (model.kind === "redirect") {
      res.setHeader("Cache-Control", cacheOr(HTML_CACHE));
      return res.redirect(301, model.location);
    }
    if (model.kind === "sitemap") {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
      return res.status(200).send(renderSitemap(model));
    }
    const rctx = { preview, now: ctx.now, path };
    if (model.kind === "unavailable") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(503).send(renderUnavailable(model, rctx).toString());
    }
    if (model.kind === "notfound") {
      res.setHeader("Cache-Control", cacheOr("public, max-age=0, s-maxage=30"));
      return res.status(404).send(renderNotFound(model, rctx).toString());
    }
    res.setHeader("Cache-Control", cacheOr(HTML_CACHE));
    return res.status(200).send(renderView(model, rctx));
  } catch (e) {
    console.error("[site] render failed", e?.message || e);
    res.setHeader("Cache-Control", "no-store");
    const model = { chrome: fallbackChrome() };
    return res.status(503).send(renderUnavailable(model, { preview: false, now: new Date(), path }).toString());
  }
}
