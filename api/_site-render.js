/* api/_site-render.js — model → HTML ของเว็บไซต์หน้าบ้าน (สาย A · เว็บไซต์ไดนามิก 1 ต.ค. 69 — สเปก docs/WEBSITE-SPEC.md ข้อ 4)
   บอสสั่ง 30 ก.ย. 69: "รื้อหน้า web ใหม่ ทำแบบ dynamic website มี banner มี social มีระบบ backend admin
   ตัวอย่าง https://www.lawyerscouncil.or.th/" + "ทำให้เทพๆ เนียนๆ"

   ฟังก์ชันบริสุทธิ์ทั้งไฟล์ (ไม่แตะ DB/เน็ต · ไม่อ่าน cookie) — เทสต์ได้ด้วย fixture (scripts/test-site.mjs)
   ⛔ XSS: ข้อความทุกตัวผ่าน html`` (escape อัตโนมัติ) · HTML เนื้อหา (body_html/answer_html) ผ่าน sanitizeRichHtml() ซ้ำ "ตอนแสดง"
      ทุกครั้ง (กรอง 2 ชั้น) · ลิงก์ทุกช่องผ่าน safeHref() · รูป/ไฟล์ต้องผ่าน isMediaPath() ก่อนสร้าง URL
   ⛔ PDPA (ข้อ 4.7): ไม่มี iframe/รูป/สคริปต์จาก facebook/google/youtube ใน HTML ที่ส่งออก — มีแค่กล่องรอยินยอม (data-embed)
      ที่ public/site.js สร้าง iframe ให้หลังผู้ชมกดยอมรับเท่านั้น
   ⛔ ห้ามแต่งข้อมูลจริง: ที่อยู่/สายด่วน/ขั้นตอน/เอกสาร มาจาก api/_serviceinfo.js · เบอร์/เวลาทำการ จาก settings · ข้อความแนะนำจาก site_config */
import {
  SITE_NAME, SITE_NAME_FULL, SITE_PARTNERS, LINE_OA_ID, LINE_OA_URL, DEFAULT_OG_IMAGE, absUrl, siteUrl,
  isMediaPath, mediaPublicUrl, categoryInfo, postPath, NEWS_CATEGORY_KEYS, PEOPLE_GROUPS, SOCIAL_ICONS,
  safeHref, isFacebookPageUrl, SITE_CONFIG_DEFAULTS, OFFICIAL_DOCS, LEGAL_NOTICE,
} from "./_site-shared.js";
import { sanitizeRichHtml, toPlainText, isBlankHtml } from "./_sanitize.js";
import {
  HOTLINES, APPOINTMENT_INFO, serviceSteps, SERVICE_TITLES, HOWTO_IMAGES, MAP_DIR_URL, MAP_PIN_URL,
} from "./_serviceinfo.js";
import { DEFAULTS as SETTINGS_DEFAULTS } from "./_settings.js";
import { html, raw, join, icon, hasIcon, thaiDate, timeTag, toDate, fileSize, telHref, jsonLd, fileKind } from "./_site-html.js";

const LOC = APPOINTMENT_INFO.location;

/* ═══ ตัวช่วยทั่วไป ═══ */
/* rctx = { preview, mediaUrl(path), now, path } — mediaUrl ฉีดได้ (dev/test ใช้รูปใน /assets/) แต่ต้องผ่าน isMediaPath ก่อนเสมอ */
function media(rctx, path, kinds) {
  if (!path || !isMediaPath(path, kinds)) return null;
  const u = (rctx.mediaUrl || mediaPublicUrl)(path);
  return u ? String(u) : null;
}
function isExternal(href) {
  if (!/^https?:\/\//i.test(href)) return false;
  const site = siteUrl();
  return !(href === site || href.startsWith(site + "/"));
}
/* ลิงก์จากข้อมูลแอดมิน: ผ่าน safeHref · ออกนอกเว็บ = แท็บใหม่ + noopener noreferrer */
function linkAttrs(href) {
  if (!href) return raw("");
  return isExternal(href)
    ? html` href="${href}" target="_blank" rel="noopener noreferrer"`
    : html` href="${href}"`;
}
function plain(v, max) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return max && s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
function officeHoursText(settings) {
  const oh = settings?.office_hours && typeof settings.office_hours === "object" ? settings.office_hours : SETTINGS_DEFAULTS.office_hours;
  const ok = (t) => typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t);
  const d = SETTINGS_DEFAULTS.office_hours;
  const days = plain(typeof oh.days === "string" && oh.days ? oh.days : d.days, 60);
  const start = (ok(oh.start) ? oh.start : d.start).replace(":", ".");
  const end = (ok(oh.end) ? oh.end : d.end).replace(":", ".");
  return `${days} ${start}–${end} น.`;
}
function phoneText(settings) {
  const p = typeof settings?.phone === "string" && settings.phone.trim() ? settings.phone : SETTINGS_DEFAULTS.phone;
  return plain(p, 40);
}
function phoneLink(settings, cls = "") {
  const text = phoneText(settings);
  const href = telHref(text);
  return href ? html`<a class="${cls}" href="${href}">${text}</a>` : html`<span class="${cls}">${text}</span>`;
}
function buddhistYear(now) {
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { timeZone: "Asia/Bangkok", year: "numeric" }).format(now).replace(/[^\d]/g, "");
}
function imageType(url) {
  const m = /\.(jpe?g|png|webp)(?:$|\?)/i.exec(String(url || ""));
  if (!m) return null;
  const e = m[1].toLowerCase();
  return e === "png" ? "image/png" : e === "webp" ? "image/webp" : "image/jpeg";
}
function dim(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 10000 ? n : fallback;
}

/* ═══ เนื้อหา HTML จาก CMS: sanitize ซ้ำ + iframe YouTube → ปุ่ม "กดเพื่อเล่นวิดีโอ" (ไม่โหลดอะไรจาก YouTube ก่อนกด) ═══ */
const YT_IFRAME_RE = /<iframe\b[^>]*?\bsrc="https:\/\/www\.youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})"[^>]*>\s*<\/iframe>/g;
export function renderRichHtml(htmlIn) {
  const clean = sanitizeRichHtml(htmlIn);
  const out = clean.replace(YT_IFRAME_RE, (_, id) => videoPlaceholder(id).toString());
  // กันเหนียว: iframe อื่นที่หลุดรูปแบบข้างบน (ไม่ควรมี) ตัดทิ้งทั้งหมด — หน้า public ห้ามมี iframe ก่อนยินยอม
  return raw(out.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "").replace(/<iframe\b[^>]*>/gi, ""));
}
function videoPlaceholder(id) {
  return html`<div class="embed embed-video" data-embed="youtube" data-id="${id}">
<div class="embed-ph">${icon("youtube", { size: 40 })}<p class="embed-title">วิดีโอจาก YouTube</p>
<p class="embed-note">วิดีโอจะโหลดเมื่อท่านกดเล่นเท่านั้น (YouTube อาจตั้งคุกกี้ของตนเอง)</p>
<button type="button" class="btn btn-primary embed-load" data-embed-load hidden>${icon("play", { size: 18 })}กดเพื่อเล่นวิดีโอ</button>
<a class="embed-direct" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">เปิดดูบน YouTube ${icon("external", { size: 16 })}</a></div></div>`;
}

/* ═══ <head> + โครงหน้า ═══ */
function ogBlock(seo) {
  const img = seo.image || { url: absUrl(DEFAULT_OG_IMAGE.path), width: DEFAULT_OG_IMAGE.width, height: DEFAULT_OG_IMAGE.height, type: DEFAULT_OG_IMAGE.type, alt: `${SITE_NAME} บริการฟรี ไม่มีค่าใช้จ่าย` };
  return html`
<meta property="og:type" content="${seo.ogType || "website"}" />
<meta property="og:site_name" content="${SITE_NAME}" />
<meta property="og:title" content="${seo.title}" />
<meta property="og:description" content="${seo.description}" />
<meta property="og:image" content="${img.url}" />
<meta property="og:image:secure_url" content="${img.url}" />
${img.type ? html`<meta property="og:image:type" content="${img.type}" />` : ""}
${img.width ? html`<meta property="og:image:width" content="${String(img.width)}" />` : ""}
${img.height ? html`<meta property="og:image:height" content="${String(img.height)}" />` : ""}
<meta property="og:image:alt" content="${img.alt || seo.title}" />
<meta property="og:url" content="${seo.canonical}" />
<meta property="og:locale" content="th_TH" />
${seo.publishedTime ? html`<meta property="article:published_time" content="${seo.publishedTime}" />` : ""}
${seo.modifiedTime ? html`<meta property="article:modified_time" content="${seo.modifiedTime}" />` : ""}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${seo.title}" />
<meta name="twitter:description" content="${seo.description}" />
<meta name="twitter:image" content="${img.url}" />
<meta name="twitter:image:alt" content="${img.alt || seo.title}" />`;
}

// 5 ต.ค. 69 (บอสอนุมัติ — minor 4): ฟอนต์โฮสต์เองที่ /assets/fonts/fonts.css แทน Google Fonts (PDPA: ไม่ส่ง IP ผู้ชมไป Google ก่อนยินยอม)
//   preload เฉพาะ Sarabun ไทย 400 (ตัวเนื้อหาทุกหน้า) ไฟล์เดียว · ⛔ ห้ามเอาลิงก์ Google Fonts กลับมา (test-site.mjs สแกนโดเมน)
// 5 ต.ค. 69 (nit จาก code-reviewer): noindex = หน้า 404/503 ใส่ <meta name="robots" content="noindex"> (เดิมไม่มี — Google อาจเก็บหน้า error)
function layout(model, rctx, { title, description, path, current = "", image, ogType, publishedTime, modifiedTime, ld = [], main, bodyClass = "", noindex = false }) {
  const chrome = model.chrome;
  const cfg = chrome.config;
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  const desc = plain(description || cfg.seo_description, 300);
  const canonical = absUrl(path || "/");
  const htmlClass = ["no-js", cfg.mourning ? "is-mourning" : "", rctx.preview ? "is-preview" : ""].filter(Boolean).join(" ");
  return html`<!doctype html>
<html lang="th" class="${htmlClass}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${fullTitle}</title>
<meta name="description" content="${desc}" />
${rctx.preview ? raw('<meta name="robots" content="noindex, nofollow" />\n') : noindex ? raw('<meta name="robots" content="noindex" />\n') : ""}<link rel="canonical" href="${canonical}" />
<meta name="theme-color" content="#0B2E6D" />
${ogBlock({ title: title || SITE_NAME, description: desc, canonical, image, ogType, publishedTime, modifiedTime })}
<link rel="icon" href="/assets/logo-pao.png" />
<link rel="preload" href="/assets/fonts/sarabun-thai-400-normal.v530.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="/assets/fonts/fonts.css" />
<link rel="stylesheet" href="/site.css" />
<script src="/site.js" defer></script>
${ld.map((o) => jsonLd(o))}
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#main">ข้ามไปเนื้อหาหลัก</a>
${rctx.preview ? html`<div class="preview-bar" role="status">${icon("search", { size: 18 })}โหมดดูตัวอย่าง — เห็นรายการที่ยังไม่เผยแพร่ด้วย หน้านี้ผู้ชมทั่วไปจะไม่เห็นแบบนี้</div>` : ""}
${cfg.mourning ? raw('<div class="mourning-ribbon" aria-hidden="true"></div>') : ""}
${utilityBar(chrome)}
${noticeBar(cfg)}
${masthead(chrome, current)}
<main id="main" tabindex="-1">
${main}
</main>
${footer(chrome, rctx)}
${floatingActions()}
${consentBar(chrome)}
</body>
</html>
`;
}

function socialLinks(socials, cls = "socials") {
  const items = socials.map((s) => {
    const href = safeHref(s.url, { allowRelative: false });
    if (!href) return null;
    const known = SOCIAL_ICONS.find((x) => x.key === s.icon);
    const name = hasIcon(s.icon) ? s.icon : "website";
    const label = plain(s.label, 120) || (known ? known.label : "ช่องทางติดตาม");
    return html`<li><a${linkAttrs(href)} class="social" title="${label}">${icon(name, { size: 20 })}<span class="sr-only">${label}</span></a></li>`;
  }).filter(Boolean);
  return items.length ? html`<ul class="${cls}">${items}</ul>` : raw("");
}

function utilityBar(chrome) {
  return html`<div class="utility"><div class="wrap utility-in">
<p class="utility-contact">${icon("phone", { size: 16 })}${phoneLink(chrome.settings, "utility-phone")}<span class="utility-hours">${icon("clock", { size: 16 })}${officeHoursText(chrome.settings)}</span></p>
<div class="utility-tools">
<div class="a11y-tools" data-a11y hidden role="group" aria-label="ปรับการแสดงผล">
<button type="button" class="a11y-btn" data-fs="-1" aria-label="ลดขนาดตัวอักษร">ก-</button>
<button type="button" class="a11y-btn" data-fs="0" aria-label="ขนาดตัวอักษรปกติ">ก</button>
<button type="button" class="a11y-btn" data-fs="1" aria-label="เพิ่มขนาดตัวอักษร">ก+</button>
<button type="button" class="a11y-btn" data-contrast aria-pressed="false" aria-label="โหมดคอนทราสต์สูง">${icon("contrast", { size: 18 })}</button>
</div>
${socialLinks(chrome.socials, "socials utility-socials")}
</div>
</div></div>`;
}

function noticeBar(cfg) {
  const n = cfg.notice;
  if (!n?.enabled || !n.text) return raw("");
  const href = safeHref(n.link);
  return html`<div class="notice" role="region" aria-label="ประกาศด่วน"><div class="wrap notice-in">
<span class="notice-tag">ประกาศ</span>
${href ? html`<a class="notice-text"${linkAttrs(href)}>${n.text}</a>` : html`<p class="notice-text">${n.text}</p>`}
</div></div>`;
}

function navModel(chrome) {
  const extraPages = chrome.pages.filter((p) => p.show_in_menu && p.slug !== "about" && p.slug !== "privacy" && p.slug !== "cookies");
  return [
    { key: "home", label: "หน้าแรก", href: "/" },
    { key: "about", label: "เกี่ยวกับศูนย์", href: "/about", sub: [
      { label: "ข้อมูลศูนย์", href: "/about" },
      { label: "ผู้บริหารและทนายอาสา", href: "/about#people" },
      ...extraPages.map((p) => ({ label: plain(p.title, 80), href: `/page/${p.slug}` })),
    ] },
    { key: "news", label: "ข่าวสาร", href: "/news", sub: NEWS_CATEGORY_KEYS.map((k) => ({ label: categoryInfo(k).label, href: `/news?cat=${k}` })) },
    { key: "knowledge", label: "ความรู้กฎหมาย", href: "/knowledge", sub: [
      { label: "บทความความรู้กฎหมาย", href: "/knowledge" },
      { label: "คำถามที่พบบ่อย", href: "/faq" },
      { label: "เอกสารดาวน์โหลด", href: "/documents" },
    ] },
    { key: "services", label: "บริการ", href: "/services", sub: [
      { label: "จองคิวขอเข้ารับคำปรึกษา", href: "/appointment.html" },
      { label: "ขั้นตอนการขอรับบริการ", href: "/services" },
      { label: "ปรึกษา / ร้องเรียนผ่าน LINE", href: LINE_OA_URL },
    ] },
    { key: "contact", label: "ติดต่อเรา", href: "/contact" },
  ];
}

function masthead(chrome, current) {
  const items = navModel(chrome).map((it, i) => {
    const cur = it.key === current ? raw(' aria-current="page"') : raw("");
    if (!it.sub) return html`<li class="nav-item"><a class="nav-link" href="${it.href}"${cur}>${it.label}</a></li>`;
    const subId = `sub-${i}`;
    return html`<li class="nav-item has-sub">
<a class="nav-link" href="${it.href}"${cur}>${it.label}${icon("chevron", { size: 16, cls: "nav-caret" })}</a>
<ul class="nav-sub" id="${subId}">${it.sub.map((s) => html`<li><a${linkAttrs(s.href)}>${s.label}${isExternal(s.href) ? html`<span class="sr-only"> (เปิดในแท็บใหม่)</span>` : ""}</a></li>`)}</ul>
</li>`;
  });
  return html`<header class="masthead" id="top"><div class="wrap masthead-in">
<a class="brand" href="/" aria-label="${SITE_NAME} — หน้าแรก">
<span class="brand-logos"><img src="/assets/logo-pao.png" width="300" height="300" alt="" /><img src="/assets/logo-lawyers-council-sm.png" width="300" height="300" alt="" /></span>
<span class="brand-name"><span class="brand-l1">ศูนย์ช่วยเหลือประชาชนทางกฎหมาย</span><span class="brand-l2">องค์การบริหารส่วนจังหวัดสุพรรณบุรี</span></span>
</a>
<button type="button" class="nav-toggle" aria-controls="site-nav" aria-expanded="false" hidden>${icon("menu", { size: 24 })}<span class="nav-toggle-text">เมนู</span></button>
<nav class="nav" id="site-nav" aria-label="เมนูหลัก">
<div class="nav-head"><span class="nav-head-title">เมนู</span><button type="button" class="nav-close" aria-label="ปิดเมนู" hidden>${icon("close", { size: 24 })}</button></div>
<ul class="nav-list">${items}</ul>
</nav>
</div></header>`;
}

function footer(chrome, rctx) {
  const cfg = chrome.config;
  const live = new Set(chrome.pages.map((p) => p.slug));
  const email = cfg.contact_email;
  return html`<footer class="footer">
<div class="wrap footer-grid">
<div class="footer-brand">
<div class="footer-logos"><img src="/assets/logo-pao.png" width="300" height="300" alt="ตราองค์การบริหารส่วนจังหวัดสุพรรณบุรี" loading="lazy" /><img src="/assets/logo-lawyers-council-sm.png" width="300" height="300" alt="ตราสภาทนายความจังหวัดสุพรรณบุรี" loading="lazy" /></div>
<p class="footer-name">${SITE_NAME_FULL}</p>
<p class="footer-partners">${SITE_PARTNERS}</p>
<p class="footer-addr">${icon("pin", { size: 18 })}<span>${LOC.room}<br />${LOC.place}<br />${LOC.address}</span></p>
</div>
<div class="footer-col">
<h2 class="footer-h">ติดต่อ</h2>
<ul class="footer-list">
<li>${icon("phone", { size: 18 })}${phoneLink(chrome.settings)}</li>
<li>${icon("clock", { size: 18 })}<span>${officeHoursText(chrome.settings)}</span></li>
<li>${icon("line", { size: 18 })}<a href="${LINE_OA_URL}" target="_blank" rel="noopener noreferrer">LINE ${LINE_OA_ID}</a></li>
${email ? html`<li>${icon("mail", { size: 18 })}<a href="mailto:${email}">${email}</a></li>` : ""}
</ul>
${socialLinks(chrome.socials, "socials footer-socials")}
</div>
<div class="footer-col">
<h2 class="footer-h">ลิงก์ด่วน</h2>
<ul class="footer-links">
<li><a href="/appointment.html">จองคิวขอเข้ารับคำปรึกษา</a></li>
<li><a href="/services">ขั้นตอนการขอรับบริการ</a></li>
<li><a href="/news">ข่าวสารและกิจกรรม</a></li>
<li><a href="/knowledge">ความรู้กฎหมาย</a></li>
<li><a href="/faq">คำถามที่พบบ่อย</a></li>
<li><a href="/documents">เอกสารดาวน์โหลด</a></li>
<li><a href="/#hotlines">สายด่วนฉุกเฉิน</a></li>
<li><a href="/contact">ติดต่อเรา</a></li>
</ul>
</div>
</div>
<div class="wrap footer-meta">
<p class="footer-notice">${LEGAL_NOTICE.short} <a href="${LEGAL_NOTICE.linkHref}">${LEGAL_NOTICE.linkLabel}</a></p>
<section class="site-stats" aria-labelledby="site-stats-title" data-site-stats data-track="${String(!rctx.preview && !rctx.statsDisabled)}">
<h2 id="site-stats-title" class="stats-title">${icon("website", { size: 17 })}สถิติการเข้าชมเว็บไซต์</h2>
<table class="stats-table">
<caption class="sr-only">สถิติการเข้าชมวันนี้ เดือนนี้ และสะสม</caption>
<thead><tr><th scope="col">การเข้าชม</th><th scope="col">วันนี้</th><th scope="col">เดือนนี้</th><th scope="col">สะสม</th></tr></thead>
<tbody><tr><th scope="row">ผู้เข้าชมไม่ซ้ำ</th><td data-stat="visitors_today">—</td><td data-stat="visitors_month">—</td><td data-stat="visitors_total">—</td></tr>
<tr><th scope="row">จำนวนครั้ง</th><td data-stat="today">—</td><td data-stat="month">—</td><td data-stat="total">—</td></tr></tbody>
</table>
<p class="stats-note">ผู้เข้าชมไม่ซ้ำ = เบราว์เซอร์ที่ยินยอมเก็บสถิติ</p>
<p class="stats-note" data-stats-note role="status">กำลังโหลดสถิติ</p>
<noscript><p class="stats-note">เปิด JavaScript เพื่อแสดงสถิติ</p></noscript>
</section>
</div>
<div class="footer-bottom"><div class="wrap footer-bottom-in">
<p>© ${buddhistYear(rctx.now)} ${SITE_NAME}</p>
<ul class="footer-legal">
${live.has("cookies") ? html`<li><a href="/page/cookies">นโยบายคุกกี้</a></li>` : ""}
${live.has("privacy") ? html`<li><a href="/page/privacy">นโยบายคุ้มครองข้อมูลส่วนบุคคล</a></li>` : ""}
<li><a href="${live.has("cookies") ? "/page/cookies" : "#consent"}" data-cookie-settings>ตั้งค่าคุกกี้</a></li>
<li><a href="/sitemap.xml">แผนผังเว็บไซต์</a></li>
<li class="footer-staff"><a href="/staff.html">${icon("person", { size: 15 })}สำหรับเจ้าหน้าที่</a></li>
</ul>
</div></div>
</footer>`;
}

function floatingActions() {
  return html`<div class="fab-wrap">
<a class="fab-top" href="#top" aria-label="กลับขึ้นด้านบน" data-to-top>${icon("up", { size: 22 })}</a>
<a class="fab-line" href="${LINE_OA_URL}" target="_blank" rel="noopener noreferrer">${icon("line", { size: 24 })}<span>แชตกับเรา</span><span class="sr-only"> (เปิด LINE ในแท็บใหม่)</span></a>
</div>`;
}

function consentBar(chrome) {
  const cookiesLive = chrome.pages.some((p) => p.slug === "cookies");
  return html`<div class="consent" id="consent" role="region" aria-labelledby="consent-h" hidden>
<div class="wrap consent-in">
<div class="consent-text">
<h2 class="consent-h" id="consent-h">การใช้คุกกี้บนเว็บไซต์นี้</h2>
<p>เว็บไซต์จดจำการตั้งค่าที่จำเป็น การนับผู้เข้าชมไม่ซ้ำใช้รหัสสุ่มในเบราว์เซอร์เมื่อท่านยินยอม ส่วน Facebook, Google Maps และ YouTube จะโหลดเมื่อยินยอมให้แสดงเนื้อหาภายนอกเท่านั้น${cookiesLive ? html` <a href="/page/cookies">อ่านนโยบายคุกกี้</a>` : ""}</p>
</div>
<div class="consent-actions">
<button type="button" class="btn btn-primary" data-consent="all">ยอมรับทั้งหมด</button>
<button type="button" class="btn btn-outline" data-consent="necessary">ใช้เฉพาะที่จำเป็น</button>
<button type="button" class="btn btn-outline" data-consent="stats">อนุญาตเฉพาะสถิติ</button>
</div>
</div></div>`;
}

/* ═══ ส่วนประกอบ ═══ */
function pageHead({ crumbs, title, lead, chip }) {
  return html`<div class="page-head"><div class="wrap">
${breadcrumb(crumbs)}
${chip || ""}
<h1 class="page-title">${title}</h1>
${lead ? html`<p class="page-lead">${lead}</p>` : ""}
</div></div>`;
}
function breadcrumb(crumbs) {
  const all = [{ label: "หน้าแรก", href: "/" }, ...crumbs];
  return html`<nav class="crumbs" aria-label="เส้นทางนำทาง"><ol>${all.map((c, i) => i === all.length - 1
    ? html`<li><span aria-current="page">${c.label}</span></li>`
    : html`<li><a href="${c.href}">${c.label}</a></li>`)}</ol></nav>`;
}
function breadcrumbLd(crumbs) {
  const all = [{ label: "หน้าแรก", href: "/" }, ...crumbs];
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: all.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.label, item: absUrl(c.href) })),
  };
}
function sectionHead(id, title, more) {
  return html`<div class="sec-head"><h2 class="sec-title" id="${id}">${title}</h2>${more ? html`<a class="sec-more" href="${more.href}">${more.label}${icon("right", { size: 18 })}</a>` : ""}</div>`;
}
function catChip(key) {
  const c = categoryInfo(key);
  return c ? html`<span class="chip chip-${key}">${c.label}</span>` : raw("");
}

function postCard(p, rctx, { headingLevel = 3, eager = false } = {}) {
  const thumb = media(rctx, p.cover_thumb_path, ["cover"]);
  const full = media(rctx, p.cover_path, ["cover"]);
  const src = thumb || full;
  const c = categoryInfo(p.category);
  const tag = headingLevel === 2 ? "h2" : "h3";
  const imgHtml = src
    ? html`<img src="${src}"${thumb && full ? html` srcset="${thumb} 640w, ${full} 1600w" sizes="(min-width: 1080px) 300px, (min-width: 640px) 45vw, 100vw"` : ""} width="${String(thumb ? 640 : dim(p.cover_w, 1600))}" height="${String(thumb ? 360 : dim(p.cover_h, 900))}" alt="${plain(p.cover_alt || p.title, 200)}"${eager ? "" : raw(' loading="lazy"')} decoding="async" />`
    : html`<span class="card-ph"><img src="/assets/icons3d/${c ? iconFile(c.icon) : "scroll.png"}" width="256" height="256" alt="" loading="lazy" /></span>`;
  const excerpt = plain(p.excerpt, 180);
  return html`<li class="card${p.pinned ? " is-pinned" : ""}${rctx.preview && p.status !== "published" ? " is-draft" : ""}">
<a class="card-link" href="${postPath(p)}">
<span class="card-media">${imgHtml}</span>
<span class="card-body">
<span class="card-meta">${catChip(p.category)}${p.pinned ? html`<span class="chip chip-pin">ปักหมุด</span>` : ""}${rctx.preview && p.status !== "published" ? html`<span class="chip chip-draft">ร่าง</span>` : ""}</span>
<${raw(tag)} class="card-title">${plain(p.title, 300)}</${raw(tag)}>
${excerpt ? html`<span class="card-excerpt">${excerpt}</span>` : ""}
<span class="card-date">${icon("calendar", { size: 16 })}${p.published_at ? timeTag(p.published_at, { short: true }) : "ยังไม่กำหนดวันเผยแพร่"}</span>
</span>
</a>
</li>`;
}
function iconFile(name) {
  return ({ megaphone: "megaphone.png", sparkles: "sparkles.png", scroll: "scroll.png", books: "books.png" })[name] || "scroll.png";
}

function personCard(p, rctx, { big = false } = {}) {
  const src = media(rctx, big ? (p.photo_path || p.photo_thumb_path) : (p.photo_thumb_path || p.photo_path), ["person"]);
  return html`<li class="person${big ? " person-feature" : ""}">
<span class="person-photo">${src
    ? html`<img src="${src}" width="480" height="600" alt="${plain(p.name, 150)}" loading="lazy" decoding="async" />`
    : html`<img src="/assets/site/avatar.svg" width="480" height="600" alt="" loading="lazy" />`}</span>
<span class="person-text">
<span class="person-name">${plain(p.name, 150)}</span>
${p.position ? html`<span class="person-pos">${plain(p.position, 200)}</span>` : ""}
${p.organization ? html`<span class="person-org">${plain(p.organization, 200)}</span>` : ""}
${!big && p.bio ? html`<span class="person-bio">${plain(p.bio, 1000)}</span>` : ""}
</span>
</li>`;
}

function docRow(d, rctx) {
  const href = media(rctx, d.file_path, ["doc", "attachment"]);
  const kind = fileKind(d.file_type || d.file_name || d.file_path);
  const size = fileSize(d.file_size);
  return html`<li class="doc">
<span class="doc-ico doc-${kind.key}" aria-hidden="true">${kind.label}</span>
<span class="doc-body">
<span class="doc-title">${plain(d.title, 300)}</span>
${d.description ? html`<span class="doc-desc">${plain(d.description, 1000)}</span>` : ""}
<span class="doc-meta">${kind.label !== "ไฟล์" ? kind.label : ""}${size ? html` · ${size}` : ""}${d.published_at ? html` · ${timeTag(d.published_at, { short: true })}` : ""}</span>
</span>
${href ? html`<a class="btn btn-outline btn-sm doc-dl" href="${href}" download target="_blank" rel="noopener">${icon("download", { size: 18 })}ดาวน์โหลด<span class="sr-only"> ${plain(d.title, 120)}</span></a>` : ""}
</li>`;
}

/* เอกสารทางการ (OFFICIAL_DOCS) — ไฟล์นิ่งใน public/assets/official/ · เปิดอ่านในแท็บใหม่ (เป็นเอกสารให้อ่านมากกว่าให้โหลด) */
function officialDocRow(d) {
  return html`<li class="doc">
<span class="doc-ico doc-pdf" aria-hidden="true">PDF</span>
<span class="doc-body">
<span class="doc-title">${d.title}</span>
<span class="doc-desc">${d.description}</span>
<span class="doc-meta">PDF · ${String(d.pages)} หน้า · ${fileSize(d.bytes)} · <time datetime="${d.date.slice(0, 10)}">${thaiDate(d.date, { short: true })}</time></span>
</span>
<a class="btn btn-outline btn-sm doc-dl" href="${d.path}" target="_blank" rel="noopener">${icon("external", { size: 18 })}เปิดอ่าน<span class="sr-only"> ${d.title} (PDF ${String(d.pages)} หน้า)</span></a>
</li>`;
}

function faqItem(f, open = false) {
  const answer = isBlankHtml(f.answer_html) ? raw("") : renderRichHtml(f.answer_html);
  return html`<details class="faq"${open ? raw(" open") : ""}>
<summary class="faq-q"><span>${plain(f.question, 300)}</span>${icon("chevron", { size: 20, cls: "faq-caret" })}</summary>
<div class="faq-a prose">${answer}</div>
</details>`;
}

function hotlinesSection(id = "hotlines", headingId = "hot-h") {
  return html`<section class="sec sec-hotlines" id="${id}" aria-labelledby="${headingId}"><div class="wrap">
<div class="hot-head"><h2 class="sec-title on-dark" id="${headingId}">สายด่วนฉุกเฉิน</h2><p class="hot-sub">หน่วยงานระดับประเทศ โทรได้ตลอด 24 ชั่วโมง</p></div>
<ul class="hotlines">${HOTLINES.map((h) => html`<li><a class="hotline" href="tel:${h.number}">
<img src="/assets/icons3d/${h.icon}.png" width="256" height="256" alt="" loading="lazy" />
<span class="hl-num">${h.number}</span><span class="hl-title">${h.title}</span>
<span class="hl-call">${icon("phone", { size: 16 })}กดโทร</span></a></li>`)}</ul>
</div></section>`;
}

function contactCard(chrome) {
  const email = chrome.config.contact_email;
  return html`<div class="contact-card">
<h3 class="contact-h">${SITE_NAME}</h3>
<ul class="contact-list">
<li>${icon("pin", { size: 20 })}<span>${LOC.room}<br />${LOC.place}<br />${LOC.address}</span></li>
<li>${icon("phone", { size: 20 })}<span>โทร ${phoneLink(chrome.settings)}</span></li>
<li>${icon("clock", { size: 20 })}<span>เวลาทำการ ${officeHoursText(chrome.settings)}<br /><small>ทนายอาสา ${APPOINTMENT_INFO.lawyer_schedule} ${APPOINTMENT_INFO.lawyer_off}</small></span></li>
<li>${icon("line", { size: 20 })}<span>LINE <a href="${LINE_OA_URL}" target="_blank" rel="noopener noreferrer">${LINE_OA_ID}</a></span></li>
${email ? html`<li>${icon("mail", { size: 20 })}<a href="mailto:${email}">${email}</a></li>` : ""}
</ul>
<div class="contact-actions">
<a class="btn btn-primary" href="${MAP_DIR_URL}" target="_blank" rel="noopener noreferrer">${icon("directions", { size: 18 })}ขอเส้นทาง</a>
<a class="btn btn-outline" href="/appointment.html">${icon("calendar", { size: 18 })}จองคิวขอเข้ารับคำปรึกษา</a>
</div>
</div>`;
}

function mapEmbed() {
  const src = `https://maps.google.com/maps?q=${LOC.lat},${LOC.lng}&z=17&hl=th&output=embed`;
  return html`<div class="embed embed-map" data-embed="map" data-src="${src}" data-title="แผนที่ ${LOC.place}">
<div class="embed-ph">${icon("map", { size: 40 })}<p class="embed-title">แผนที่ Google Maps</p>
<p class="embed-note">แผนที่จะแสดงเมื่อท่านยินยอมให้โหลดเนื้อหาจากผู้ให้บริการภายนอก</p>
<button type="button" class="btn btn-primary embed-load" data-embed-load hidden>แสดงแผนที่</button>
<a class="embed-direct" href="${MAP_PIN_URL}" target="_blank" rel="noopener noreferrer">เปิดใน Google Maps ${icon("external", { size: 16 })}</a></div></div>`;
}

function facebookBlock(cfg, headingLevel = 2) {
  const pages = cfg.facebook_pages.filter((p) => p.url && isFacebookPageUrl(p.url));
  if (!pages.length) return raw("");
  const tag = raw(headingLevel === 2 ? "h2" : "h3");
  const panels = pages.map((p, i) => html`<div class="tab-panel" id="fb-panel-${String(i)}" data-panel${i ? raw(" hidden") : ""}>
<div class="embed embed-fb" data-embed="facebook" data-href="${p.url}" data-title="เพจ Facebook ${p.label}">
<div class="embed-ph">${icon("facebook", { size: 40 })}<p class="embed-title">${p.label}</p>
<p class="embed-note">ฟีดเพจจะแสดงเมื่อท่านยินยอมให้โหลดเนื้อหาจาก Facebook (Facebook อาจตั้งคุกกี้ของตนเอง)</p>
<button type="button" class="btn btn-primary embed-load" data-embed-load hidden>แสดงเนื้อหาจาก Facebook</button>
<a class="embed-direct" href="${p.url}" target="_blank" rel="noopener noreferrer">เปิดเพจบน Facebook ${icon("external", { size: 16 })}</a></div></div>
</div>`);
  return html`<div class="fb-block">
<${tag} class="block-title">${icon("facebook", { size: 22 })}ติดตามเราบน Facebook</${tag}>
${pages.length > 1 ? html`<div class="tabs" data-tabs><div class="tab-list" data-tablist aria-label="เลือกเพจ Facebook">${pages.map((p, i) => html`<a class="tab" href="${p.url}" id="fb-tab-${String(i)}" data-tab="fb-panel-${String(i)}"${i ? "" : raw(' aria-current="true"')} target="_blank" rel="noopener noreferrer">${p.label}</a>`)}</div>${panels}</div>` : panels}
</div>`;
}

function emptyState(text, actions) {
  return html`<div class="empty"><img src="/assets/icons3d/bookmark_tabs.png" width="256" height="256" alt="" loading="lazy" /><p>${text}</p>${actions || ""}</div>`;
}

/* ═══ หน้าแรก (สเปกข้อ 4.5 ครบ 13 ส่วน) ═══ */
function heroSlider(banners, rctx) {
  const list = banners.map((b) => ({
    src: media(rctx, b.image_path, ["banner"]),
    mobile: media(rctx, b.mobile_image_path, ["banner"]),
    w: dim(b.image_w, 1920), h: dim(b.image_h, 640),
    alt: plain(b.alt_text, 200), caption: plain(b.caption, 200), href: safeHref(b.link_url),
    draft: rctx.preview && !(b.active === true),
  })).filter((b) => b.src && b.alt);
  // ไม่มีแบนเนอร์ในระบบ (หรือ DB ล่ม) → แบนเนอร์ทางการโลโก้คู่ (สเปกข้อ 4.5 ข้อ 4)
  if (!list.length) list.push({ src: "/assets/hero-cover.jpg", mobile: null, w: 1207, h: 413, alt: `${SITE_NAME} — สภาทนายความจังหวัดสุพรรณบุรี ร่วมกับ องค์การบริหารส่วนจังหวัดสุพรรณบุรี`, caption: "", href: null });
  const n = list.length;
  const slides = list.map((b, i) => {
    const pic = html`<picture>${b.mobile ? html`<source media="(max-width: 640px)" srcset="${b.mobile}" />` : ""}<img class="slide-img" src="${b.src}" width="${String(b.w)}" height="${String(b.h)}" alt="${b.alt}"${i === 0 ? raw(' fetchpriority="high"') : raw(' loading="lazy"')} decoding="async" /></picture>`;
    return html`<li class="slide" id="slide-${String(i + 1)}"${n > 1 ? html` role="group" aria-roledescription="สไลด์" aria-label="${String(i + 1)} จาก ${String(n)}"` : ""}>
<img class="slide-fill" src="${b.src}" alt="" aria-hidden="true"${i === 0 ? "" : raw(' loading="lazy"')} decoding="async" />
${b.href ? html`<a class="slide-frame"${linkAttrs(b.href)}>${pic}</a>` : html`<div class="slide-frame">${pic}</div>`}
${b.caption ? html`<p class="slide-caption">${b.caption}</p>` : ""}
${b.draft ? html`<span class="chip chip-draft slide-flag">ปิดอยู่/นอกช่วงเวลา</span>` : ""}
</li>`;
  });
  return html`<section class="hero" aria-label="แบนเนอร์ประชาสัมพันธ์"${n > 1 ? raw(' aria-roledescription="ภาพสไลด์" data-carousel') : ""}>
<div class="hero-viewport"><ul class="hero-track">${slides}</ul></div>
${n > 1 ? html`<div class="hero-controls" hidden>
<button type="button" class="hero-btn" data-prev aria-label="สไลด์ก่อนหน้า">${icon("left", { size: 22 })}</button>
<div class="hero-dots">${list.map((_, i) => html`<button type="button" class="hero-dot" data-go="${String(i)}" aria-label="ไปสไลด์ที่ ${String(i + 1)}"></button>`)}</div>
<button type="button" class="hero-btn" data-next aria-label="สไลด์ถัดไป">${icon("right", { size: 22 })}</button>
<button type="button" class="hero-btn hero-pause" data-pause aria-label="หยุดเลื่อนอัตโนมัติ">${icon("pause", { size: 20, cls: "i-pause" })}${icon("play", { size: 20, cls: "i-play" })}</button>
</div>` : ""}
</section>`;
}

function quickServices() {
  const lineHint = (menu) => `เพิ่มเพื่อน LINE แล้วกดเมนู “${menu}”`;
  const items = [
    { href: "/appointment.html", icon: "spiral_calendar", title: "จองคิวขอเข้ารับคำปรึกษา", hint: "กรอกแบบคำร้องบนเว็บไซต์ได้ทันที" },
    { href: LINE_OA_URL, icon: "balance_scale", title: "ปรึกษาข้อกฎหมาย", hint: lineHint("ขอรับคำปรึกษากฎหมาย"), line: true },
    { href: LINE_OA_URL, icon: "memo", title: "ร้องเรียน / ร้องทุกข์", hint: lineHint("ร้องเรียน / ร้องทุกข์"), line: true },
    { href: LINE_OA_URL, icon: "magnifying_glass_tilted_left", title: "ติดตามสถานะเรื่อง", hint: "กดเมนู “ติดตามเรื่อง” หรือพิมพ์เลขที่เรื่องในแชต LINE", line: true },
    { href: "#hotlines", icon: "telephone_receiver", title: "สายด่วนฉุกเฉิน", hint: "4 หมายเลข โทรได้ 24 ชั่วโมง" },
    { href: "/documents", icon: "page_facing_up", title: "เอกสารดาวน์โหลด", hint: "แบบฟอร์มและเอกสารเผยแพร่" },
  ];
  return html`<section class="quick" aria-labelledby="quick-h"><div class="wrap">
<div class="quick-panel">
<h2 class="quick-title" id="quick-h">บริการประชาชน <span class="quick-free">ฟรี ไม่มีค่าใช้จ่าย</span></h2>
<ul class="quick-grid">${items.map((it) => html`<li><a class="quick-item" href="${it.href}"${it.line ? raw(' target="_blank" rel="noopener noreferrer"') : ""}>
<img src="/assets/icons3d/${it.icon}.png" width="256" height="256" alt="" />
<span class="qi-text"><span class="qi-title">${it.title}${it.line ? html`<span class="qi-line">LINE</span><span class="sr-only"> (เปิด LINE ในแท็บใหม่)</span>` : ""}</span><span class="qi-hint">${it.hint}</span></span>
</a></li>`)}</ul>
</div>
</div></section>`;
}

function newsSection(model, rctx) {
  const allEmpty = model.newsTabs.every((t) => !t.items.length);
  const fbFirst = model.chrome.config.facebook_pages.find((p) => p.url);
  const tabs = html`<div class="tabs" data-tabs>
<div class="tab-list" data-tablist aria-label="หมวดข่าว">${model.newsTabs.map((t, i) => html`<a class="tab" href="/news?cat=${t.key}" id="tab-${t.key}" data-tab="panel-${t.key}"${i ? "" : raw(' aria-current="true"')}>${t.info.label}</a>`)}</div>
${model.newsTabs.map((t, i) => html`<div class="tab-panel" id="panel-${t.key}" data-panel${i ? raw(" hidden") : ""}>
${t.items.length ? html`<ul class="cards cards-4">${t.items.map((p, j) => postCard(p, rctx, { eager: i === 0 && j < 2 }))}</ul>` : html`<p class="muted-note">ยังไม่มีรายการในหมวด${t.info.label}</p>`}
<p class="tab-more"><a class="link-arrow" href="/news?cat=${t.key}">ดู${t.info.label}ทั้งหมด${icon("right", { size: 18 })}</a></p>
</div>`)}
</div>`;
  const empty = emptyState("ยังไม่มีข่าวสารในขณะนี้ ติดตามความเคลื่อนไหวของศูนย์ได้ทางช่องทางด้านล่าง", html`<p class="empty-actions">
<a class="btn btn-primary" href="${LINE_OA_URL}" target="_blank" rel="noopener noreferrer">${icon("line", { size: 18 })}เพิ่มเพื่อน LINE ${LINE_OA_ID}</a>
${fbFirst ? html`<a class="btn btn-outline" href="${fbFirst.url}" target="_blank" rel="noopener noreferrer">${icon("facebook", { size: 18 })}ติดตามเพจ Facebook</a>` : ""}</p>`);
  return html`<section class="sec sec-news" aria-labelledby="news-h"><div class="wrap news-layout">
<div class="news-main">
${sectionHead("news-h", "ข่าวสารและกิจกรรม", { href: "/news", label: "ดูทั้งหมด" })}
${allEmpty ? empty : tabs}
</div>
<aside class="news-side" aria-label="ผู้บริหารและช่องทาง LINE">
${model.people.length ? html`<div class="side-box side-people"><h2 class="side-title">ผู้บริหาร</h2><ul class="people people-side">${model.people.map((p) => personCard(p, rctx, { big: true }))}</ul></div>` : ""}
<div class="side-box side-qr">
<h2 class="side-title">LINE ศูนย์ช่วยเหลือฯ</h2>
<img src="/assets/qr-lineoa.png" width="900" height="900" alt="คิวอาร์โค้ดเพิ่มเพื่อน LINE ${LINE_OA_ID}" loading="lazy" />
<p>สแกนเพื่อเพิ่มเพื่อน แล้วปรึกษา ร้องเรียน และติดตามเรื่องผ่านแชต</p>
<a class="btn btn-line" href="${LINE_OA_URL}" target="_blank" rel="noopener noreferrer">${icon("line", { size: 20 })}เพิ่มเพื่อน ${LINE_OA_ID}</a>
</div>
</aside>
</div></section>`;
}

function stepsSection() {
  const kinds = ["appointment", "consult", "complaint"];
  return html`<section class="sec sec-steps" aria-labelledby="steps-h"><div class="wrap">
${sectionHead("steps-h", "ขั้นตอนการขอรับบริการ", { href: "/services", label: "ดูรายละเอียด" })}
<p class="sec-lead"><span class="badge-free">${icon("check", { size: 18 })}ฟรี ไม่มีค่าใช้จ่าย</span> เลือกบริการที่ต้องการ แล้วทำตามขั้นตอนสั้นๆ ด้านล่าง</p>
<div class="steps-grid">${kinds.map((k) => html`<article class="steps-card">
<header class="steps-head"><img src="/assets/icons3d/${SERVICE_TITLES[k].icon}.png" width="256" height="256" alt="" loading="lazy" /><h3>${SERVICE_TITLES[k].title}</h3></header>
<ol class="steps">${serviceSteps(k).map((s) => html`<li>${s.title}</li>`)}</ol>
</article>`)}</div>
<p class="sec-cta"><a class="btn btn-primary" href="/services">ดูขั้นตอนการขอรับบริการโดยละเอียด</a></p>
</div></section>`;
}

function trioSection(model, rctx) {
  const cols = [];
  if (model.knowledge.length) cols.push(html`<div class="trio-col">
<h3 class="trio-title"><img src="/assets/icons3d/books.png" width="256" height="256" alt="" loading="lazy" />ความรู้กฎหมาย</h3>
<ul class="mini-list">${model.knowledge.map((p) => html`<li><a href="${postPath(p)}">${plain(p.title, 200)}</a>${p.published_at ? html`<span class="mini-date">${timeTag(p.published_at, { short: true })}</span>` : ""}</li>`)}</ul>
<a class="link-arrow" href="/knowledge">บทความทั้งหมด${icon("right", { size: 18 })}</a></div>`);
  if (model.faqs.length) cols.push(html`<div class="trio-col">
<h3 class="trio-title"><img src="/assets/icons3d/red_question_mark.png" width="256" height="256" alt="" loading="lazy" />คำถามที่พบบ่อย</h3>
<div class="faq-list faq-compact">${model.faqs.map((f) => faqItem(f))}</div>
<a class="link-arrow" href="/faq">คำถามทั้งหมด${icon("right", { size: 18 })}</a></div>`);
  if (model.docs.length) cols.push(html`<div class="trio-col">
<h3 class="trio-title"><img src="/assets/icons3d/page_facing_up.png" width="256" height="256" alt="" loading="lazy" />เอกสารดาวน์โหลด</h3>
<ul class="docs docs-compact">${model.docs.map((d) => docRow(d, rctx))}</ul>
<a class="link-arrow" href="/documents">เอกสารทั้งหมด${icon("right", { size: 18 })}</a></div>`);
  if (!cols.length) return raw("");
  return html`<section class="sec sec-trio" aria-labelledby="trio-h"><div class="wrap">
${sectionHead("trio-h", "ความรู้และเอกสาร")}
<div class="trio trio-${String(cols.length)}">${cols}</div>
</div></section>`;
}

function connectSection(model) {
  const fb = facebookBlock(model.chrome.config, 3);
  return html`<section class="sec sec-connect" aria-labelledby="connect-h"><div class="wrap">
${sectionHead("connect-h", "ติดตามเราและติดต่อ")}
<div class="connect-grid${fb.toString() ? "" : " no-fb"}">
${fb}
<div class="connect-contact">
${contactCard(model.chrome)}
${mapEmbed()}
</div>
</div>
</div></section>`;
}

function relatedSection(related, rctx) {
  const items = related.map((l) => {
    const href = safeHref(l.url, { allowRelative: false });
    if (!href) return null;
    const logo = media(rctx, l.logo_path, ["logo"]);
    const label = plain(l.label, 120);
    return html`<li><a class="partner" href="${href}" target="_blank" rel="noopener noreferrer">${logo ? html`<img src="${logo}" width="160" height="160" alt="" loading="lazy" />` : html`<span class="partner-ico">${icon("website", { size: 26 })}</span>`}<span class="partner-name">${label}</span><span class="sr-only"> (เปิดในแท็บใหม่)</span></a></li>`;
  }).filter(Boolean);
  if (!items.length) return raw("");
  return html`<section class="sec sec-partners" aria-labelledby="partners-h"><div class="wrap">
${sectionHead("partners-h", "หน่วยงานที่เกี่ยวข้อง")}
<ul class="partners">${items}</ul>
</div></section>`;
}

function orgLd(chrome) {
  const sameAs = [
    ...chrome.socials.map((s) => safeHref(s.url, { allowRelative: false })),
    ...chrome.config.facebook_pages.map((p) => p.url),
  ].filter((u) => u && /^https:\/\//.test(u));
  const tel = telHref(phoneText(chrome.settings));
  return {
    "@context": "https://schema.org", "@type": "GovernmentOrganization",
    name: SITE_NAME_FULL, alternateName: SITE_NAME, url: absUrl("/"),
    logo: absUrl("/assets/logo-pao.png"), image: absUrl(DEFAULT_OG_IMAGE.path),
    description: chrome.config.seo_description,
    ...(tel ? { telephone: tel.slice(4) } : {}),
    ...(chrome.config.contact_email ? { email: chrome.config.contact_email } : {}),
    address: { "@type": "PostalAddress", streetAddress: `${LOC.room} ${LOC.place} ${LOC.address}`, addressRegion: "สุพรรณบุรี", addressCountry: "TH" },
    geo: { "@type": "GeoCoordinates", latitude: LOC.lat, longitude: LOC.lng },
    ...(sameAs.length ? { sameAs: [...new Set(sameAs)] } : {}),
  };
}

function renderHome(model, rctx) {
  const intro = model.chrome.config.intro;
  const main = html`
<h1 class="sr-only">${SITE_NAME_FULL}</h1>
${heroSlider(model.banners, rctx)}
${quickServices()}
<p class="intro wrap">${intro}</p>
${newsSection(model, rctx)}
${stepsSection()}
${trioSection(model, rctx)}
${connectSection(model)}
${hotlinesSection()}
${relatedSection(model.chrome.related, rctx)}`;
  return layout(model, rctx, { title: "", path: "/", current: "home", ld: [orgLd(model.chrome)], main, bodyClass: "page-home" });
}

/* ═══ รายการข่าว/บทความ ═══ */
function pagination(base, page, pages, params) {
  if (pages <= 1) return raw("");
  const href = (n) => {
    const sp = new URLSearchParams(params);
    if (n > 1) sp.set("page", String(n)); else sp.delete("page");
    const qs = sp.toString();
    return `${base}${qs ? "?" + qs : ""}`;
  };
  const nums = [];
  for (let n = Math.max(1, page - 2); n <= Math.min(pages, page + 2); n++) nums.push(n);
  return html`<nav class="pager" aria-label="เลขหน้า"><ul>
${page > 1 ? html`<li><a href="${href(page - 1)}" rel="prev">${icon("left", { size: 18 })}<span>ก่อนหน้า</span></a></li>` : ""}
${nums.map((n) => n === page ? html`<li><span aria-current="page">${String(n)}</span></li>` : html`<li><a href="${href(n)}" aria-label="หน้า ${String(n)}">${String(n)}</a></li>`)}
${page < pages ? html`<li><a href="${href(page + 1)}" rel="next"><span>ถัดไป</span>${icon("right", { size: 18 })}</a></li>` : ""}
</ul></nav>`;
}

function renderList(model, rctx) {
  const isNews = model.view === "news";
  const base = isNews ? "/news" : "/knowledge";
  const catLabel = model.cat ? categoryInfo(model.cat).label : "";
  const title = isNews ? (catLabel || "ข่าวสารและกิจกรรม") : "ความรู้กฎหมาย";
  const crumbs = isNews
    ? [{ label: "ข่าวสาร", href: "/news" }, ...(catLabel ? [{ label: catLabel, href: `/news?cat=${model.cat}` }] : [])]
    : [{ label: "ความรู้กฎหมาย", href: "/knowledge" }];
  const params = {};
  if (model.cat) params.cat = model.cat;
  if (model.q) params.q = model.q;
  const chips = isNews
    ? html`<nav class="chips" aria-label="หมวดข่าว"><ul>
<li><a href="/news${model.q ? `?q=${encodeURIComponent(model.q)}` : ""}"${model.cat ? "" : raw(' aria-current="page"')}>ทั้งหมด</a></li>
${NEWS_CATEGORY_KEYS.map((k) => html`<li><a href="/news?cat=${k}${model.q ? `&q=${encodeURIComponent(model.q)}` : ""}"${model.cat === k ? raw(' aria-current="page"') : ""}>${categoryInfo(k).label}</a></li>`)}</ul></nav>`
    : html`<nav class="chips" aria-label="หมวดความรู้"><ul>
<li><a href="/knowledge" aria-current="page">บทความ</a></li><li><a href="/faq">คำถามที่พบบ่อย</a></li><li><a href="/documents">เอกสารดาวน์โหลด</a></li></ul></nav>`;
  const search = html`<form class="search" action="${base}" method="get" role="search">
${model.cat ? html`<input type="hidden" name="cat" value="${model.cat}" />` : ""}
<label class="sr-only" for="q">ค้นหาจากชื่อเรื่อง</label>
<input id="q" name="q" type="search" maxlength="100" value="${model.q}" placeholder="ค้นหาจากชื่อเรื่อง" autocomplete="off" />
<button type="submit" class="btn btn-primary">${icon("search", { size: 18 })}<span>ค้นหา</span></button>
</form>`;
  const result = model.items.length
    ? html`<p class="result-count" role="status">${model.q ? html`ผลการค้นหา “${model.q}” ` : ""}ทั้งหมด ${String(model.total)} รายการ${model.pages > 1 ? html` · หน้า ${String(model.page)}/${String(model.pages)}` : ""}</p>
<ul class="cards cards-3">${model.items.map((p, i) => postCard(p, rctx, { eager: i < 3 }))}</ul>
${pagination(base, model.page, model.pages, params)}`
    : emptyState(model.q ? `ไม่พบเรื่องที่ชื่อมีคำว่า “${model.q}” ลองใช้คำอื่น หรือดูทุกหมวด` : "ยังไม่มีรายการในหมวดนี้", model.q || model.cat ? html`<p class="empty-actions"><a class="btn btn-outline" href="${base}">ดูทั้งหมด</a></p>` : "");
  const main = html`${pageHead({ crumbs, title, lead: isNews ? "ข่าวประชาสัมพันธ์ ภาพกิจกรรม และประกาศของศูนย์" : "ความรู้กฎหมายใกล้ตัวสำหรับประชาชน — เป็นข้อมูลเบื้องต้นทั่วไป ไม่ใช่คำแนะนำเฉพาะคดี" })}
<div class="wrap list-page">
<div class="list-tools">${chips}${search}</div>
${result}
</div>`;
  // 5 ต.ค. 69 (nit จาก code-reviewer): canonical/og:url ไม่พา ?q= (ผลค้นหาไม่ใช่หน้าแยก — กัน Google เก็บ URL คำค้นเป็นหน้าซ้ำ)
  // ผลค้นหาชี้ไปหน้ารายการของหมวด (cat คงไว้) · page คงไว้เฉพาะรายการปกติ (หน้า 2 ของผลค้นหา ≠ หน้า 2 ของรายการ)
  const qs = new URLSearchParams(params);
  qs.delete("q");
  if (model.page > 1 && !model.q) qs.set("page", String(model.page));
  const path = `${base}${qs.toString() ? "?" + qs.toString() : ""}`;
  return layout(model, rctx, { title: model.page > 1 ? `${title} (หน้า ${model.page})` : title, path, current: isNews ? "news" : "knowledge", ld: [breadcrumbLd(crumbs)], main });
}

/* ═══ หน้าข่าว/บทความ ═══ */
function renderPost(model, rctx) {
  const p = model.post;
  const c = categoryInfo(p.category);
  const section = c.section;
  const crumbs = section === "knowledge"
    ? [{ label: "ความรู้กฎหมาย", href: "/knowledge" }, { label: plain(p.title, 60), href: postPath(p) }]
    : [{ label: "ข่าวสาร", href: "/news" }, { label: c.label, href: `/news?cat=${p.category}` }, { label: plain(p.title, 60), href: postPath(p) }];
  const cover = media(rctx, p.cover_path, ["cover"]);
  const coverAlt = plain(p.cover_alt || p.title, 200);
  const body = isBlankHtml(p.body_html) ? raw("") : renderRichHtml(p.body_html);
  const gallery = (Array.isArray(p.gallery) ? p.gallery : []).slice(0, 30).map((g) => ({
    full: media(rctx, g?.path, ["gallery"]), thumb: media(rctx, g?.thumb_path, ["gallery"]), alt: plain(g?.alt, 200), w: dim(g?.w, 1600), h: dim(g?.h, 1200),
  })).filter((g) => g.full || g.thumb);
  const attachments = (Array.isArray(p.attachments) ? p.attachments : []).slice(0, 10).map((a) => ({
    href: media(rctx, a?.path, ["attachment"]), name: plain(a?.name, 200) || "เอกสารแนบ", size: fileSize(a?.size),
  })).filter((a) => a.href);
  const url = absUrl(postPath(p));
  const shareText = plain(p.title, 200);
  const description = plain(p.excerpt, 300) || toPlainText(sanitizeRichHtml(p.body_html), 160) || model.chrome.config.seo_description;
  const draft = rctx.preview && !(p.status === "published" && p.published_at && toDate(p.published_at) <= rctx.now);
  const main = html`<article class="post">
${pageHead({ crumbs, title: plain(p.title, 300), chip: html`<p class="post-chips">${catChip(p.category)}${draft ? html`<span class="chip chip-draft">${p.status === "published" ? "ตั้งเวลาเผยแพร่" : "ร่าง"}</span>` : ""}</p>` })}
<div class="wrap post-wrap">
<p class="post-meta">${icon("calendar", { size: 18 })}${p.published_at ? html`เผยแพร่ ${timeTag(p.published_at)}` : "ยังไม่กำหนดวันเผยแพร่"}</p>
${cover ? html`<figure class="post-cover"><img src="${cover}" width="${String(dim(p.cover_w, 1600))}" height="${String(dim(p.cover_h, 900))}" alt="${coverAlt}" fetchpriority="high" decoding="async" /></figure>` : ""}
${body.toString() ? html`<div class="prose post-body">${body}</div>` : ""}
${gallery.length ? html`<section class="gallery" aria-labelledby="gal-h"><h2 class="block-title" id="gal-h">ภาพประกอบ (${String(gallery.length)} ภาพ)</h2>
<ul class="gal-grid" data-gallery>${gallery.map((g, i) => html`<li><a class="gal-item" href="${g.full || g.thumb}" data-index="${String(i)}" data-w="${String(g.w)}" data-h="${String(g.h)}"><img src="${g.thumb || g.full}" width="480" height="360" alt="${g.alt || `${shareText} ภาพที่ ${i + 1}`}" loading="lazy" decoding="async" /></a></li>`)}</ul>
</section>
<dialog class="lightbox" id="lightbox" aria-label="ดูภาพขนาดใหญ่"><div class="lb-in">
<img class="lb-img" alt="" /><p class="lb-cap" aria-live="polite"></p>
<button type="button" class="lb-btn lb-prev" data-lb-prev aria-label="ภาพก่อนหน้า">${icon("left", { size: 28 })}</button>
<button type="button" class="lb-btn lb-next" data-lb-next aria-label="ภาพถัดไป">${icon("right", { size: 28 })}</button>
<button type="button" class="lb-btn lb-close" data-lb-close aria-label="ปิดภาพ">${icon("close", { size: 26 })}</button>
</div></dialog>` : ""}
${attachments.length ? html`<section class="attach" aria-labelledby="att-h"><h2 class="block-title" id="att-h">เอกสารแนบ</h2><ul class="docs">${attachments.map((a) => html`<li class="doc">
<span class="doc-ico doc-pdf" aria-hidden="true">PDF</span><span class="doc-body"><span class="doc-title">${a.name}</span><span class="doc-meta">PDF${a.size ? html` · ${a.size}` : ""}</span></span>
<a class="btn btn-outline btn-sm doc-dl" href="${a.href}" target="_blank" rel="noopener">${icon("download", { size: 18 })}เปิดไฟล์<span class="sr-only"> ${a.name}</span></a></li>`)}</ul></section>` : ""}
<div class="share" aria-label="แชร์เรื่องนี้" role="group">
<span class="share-label">${icon("share", { size: 18 })}แชร์</span>
<a class="share-btn share-fb" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">${icon("facebook", { size: 18 })}Facebook</a>
<a class="share-btn share-line" href="https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">${icon("line", { size: 18 })}LINE</a>
<button type="button" class="share-btn share-copy" data-copy="${url}" hidden>${icon("link", { size: 18 })}<span data-copy-label>คัดลอกลิงก์</span></button>
</div>
</div>
</article>
${model.related.length ? html`<section class="sec sec-related" aria-labelledby="rel-h"><div class="wrap">
${sectionHead("rel-h", "เรื่องอื่นในหมวดเดียวกัน", { href: section === "knowledge" ? "/knowledge" : `/news?cat=${p.category}`, label: "ดูทั้งหมด" })}
<ul class="cards cards-3">${model.related.map((r) => postCard(r, rctx))}</ul>
</div></section>` : ""}`;
  const pub = toDate(p.published_at);
  const mod = toDate(p.updated_at);
  const coverW = dim(p.cover_w, null);
  const coverH = dim(p.cover_h, null);
  const image = cover ? { url: absUrl(cover), width: coverW, height: coverH, type: imageType(cover), alt: coverAlt } : null;
  const ld = [{
    "@context": "https://schema.org", "@type": section === "knowledge" ? "Article" : "NewsArticle",
    headline: plain(p.title, 110), description, mainEntityOfPage: url, url, inLanguage: "th",
    ...(pub ? { datePublished: pub.toISOString() } : {}),
    ...(mod ? { dateModified: mod.toISOString() } : pub ? { dateModified: pub.toISOString() } : {}),
    image: [cover ? absUrl(cover) : absUrl(DEFAULT_OG_IMAGE.path)],
    author: { "@type": "Organization", name: SITE_NAME_FULL, url: absUrl("/") },
    publisher: { "@type": "Organization", name: SITE_NAME_FULL, logo: { "@type": "ImageObject", url: absUrl("/assets/logo-pao.png") } },
  }, breadcrumbLd(crumbs)];
  return layout(model, rctx, {
    title: plain(p.title, 200), description, path: postPath(p), current: section, image,
    ogType: cover ? "article" : "website", publishedTime: cover && pub ? pub.toISOString() : null, modifiedTime: cover && mod ? mod.toISOString() : null,
    ld, main, bodyClass: "page-post",
  });
}

/* ═══ FAQ ═══ */
function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()];
}
function renderFaq(model, rctx) {
  const crumbs = [{ label: "ความรู้กฎหมาย", href: "/knowledge" }, { label: "คำถามที่พบบ่อย", href: "/faq" }];
  const groups = groupBy(model.faqs, (f) => plain(f.category, 80) || "ทั่วไป");
  const main = html`${pageHead({ crumbs, title: "คำถามที่พบบ่อย", lead: "คำตอบเป็นข้อมูลเบื้องต้นทั่วไป หากต้องการคำปรึกษาเฉพาะเรื่อง กรุณาจองคิวหรือติดต่อศูนย์" })}
<div class="wrap narrow">
${groups.length ? groups.map(([g, list], i) => html`<section class="faq-group" aria-labelledby="faq-g${String(i)}">
${groups.length > 1 || g !== "ทั่วไป" ? html`<h2 class="block-title" id="faq-g${String(i)}">${g}</h2>` : html`<h2 class="sr-only" id="faq-g${String(i)}">${g}</h2>`}
<div class="faq-list">${list.map((f) => faqItem(f))}</div></section>`) : emptyState("ยังไม่มีคำถามที่พบบ่อยในขณะนี้", html`<p class="empty-actions"><a class="btn btn-primary" href="/contact">ติดต่อสอบถามศูนย์</a></p>`)}
<div class="callout">${icon("line", { size: 22 })}<p>ไม่พบคำตอบที่ต้องการ? สอบถามผ่าน LINE <a href="${LINE_OA_URL}" target="_blank" rel="noopener noreferrer">${LINE_OA_ID}</a> หรือ <a href="/appointment.html">จองคิวขอเข้ารับคำปรึกษา</a></p></div>
</div>`;
  const ld = [breadcrumbLd(crumbs)];
  const qa = model.faqs.map((f) => ({ q: plain(f.question, 300), a: toPlainText(sanitizeRichHtml(f.answer_html), 1000) })).filter((x) => x.q && x.a);
  if (qa.length) ld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: qa.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) });
  return layout(model, rctx, { title: "คำถามที่พบบ่อย", path: "/faq", current: "knowledge", ld, main });
}

/* ═══ เอกสารดาวน์โหลด ═══ */
function renderDocuments(model, rctx) {
  const crumbs = [{ label: "ความรู้กฎหมาย", href: "/knowledge" }, { label: "เอกสารดาวน์โหลด", href: "/documents" }];
  const groups = groupBy(model.docs, (d) => plain(d.category, 80) || "เอกสารทั่วไป");
  // เอกสารทางการอยู่บนสุดเสมอ (ไฟล์นิ่ง ไม่พึ่งฐาน) — จึงไม่มีสถานะ "ยังไม่มีเอกสาร" อีก; หมวดจาก CMS ต่อท้าย
  const main = html`${pageHead({ crumbs, title: "เอกสารดาวน์โหลด", lead: "แบบฟอร์มและเอกสารเผยแพร่ของศูนย์ ดาวน์โหลดได้ฟรี" })}
<div class="wrap narrow">
<section class="doc-group" id="doc-official" aria-labelledby="doc-official-h"><h2 class="block-title" id="doc-official-h">เอกสารทางการของศูนย์</h2>
<ul class="docs">${OFFICIAL_DOCS.map((d) => officialDocRow(d))}</ul>
<p class="muted-note">เอกสารเป็นภาพสแกนจากฉบับที่ลงนามแล้ว</p></section>
${groups.map(([g, list], i) => html`<section class="doc-group" aria-labelledby="doc-g${String(i)}"><h2 class="block-title" id="doc-g${String(i)}">${g}</h2>
<ul class="docs">${list.map((d) => docRow(d, rctx))}</ul></section>`)}
</div>`;
  return layout(model, rctx, { title: "เอกสารดาวน์โหลด", path: "/documents", current: "knowledge", ld: [breadcrumbLd(crumbs)], main });
}

/* ═══ เกี่ยวกับศูนย์ + บุคลากร ═══ */
function renderAbout(model, rctx) {
  const pg = model.page;
  const crumbs = [{ label: plain(pg.title, 80) || "เกี่ยวกับศูนย์", href: "/about" }];
  const groups = PEOPLE_GROUPS.map((g) => ({ ...g, list: model.people.filter((p) => p.group_key === g.key) })).filter((g) => g.list.length);
  const body = isBlankHtml(pg.body_html) ? raw("") : renderRichHtml(pg.body_html);
  const main = html`${pageHead({ crumbs, title: plain(pg.title, 200) || "เกี่ยวกับศูนย์", lead: SITE_PARTNERS })}
<div class="wrap narrow">
${rctx.preview && pg.published !== true ? html`<p class="chip chip-draft">หน้านี้ยังไม่เผยแพร่</p>` : ""}
<div class="prose">${body}</div>
<section class="notice-box" id="notice" aria-labelledby="notice-h"><h2 class="block-title" id="notice-h">${LEGAL_NOTICE.title}</h2>
<ul>${LEGAL_NOTICE.items.map((t) => html`<li>${t}</li>`)}</ul></section>
<div class="callout">${icon("file", { size: 22 })}<p>เอกสารจัดตั้งศูนย์ฯ: <a href="${OFFICIAL_DOCS[0].path}" target="_blank" rel="noopener">ประกาศ อบจ.สุพรรณบุรี เรื่อง จัดตั้งศูนย์ช่วยเหลือประชาชนทางกฎหมาย</a> · <a href="${OFFICIAL_DOCS[1].path}" target="_blank" rel="noopener">บันทึกข้อตกลงความร่วมมือทางกฎหมาย</a> · <a href="/documents#doc-official">ดูทั้งหมดในหน้าเอกสารดาวน์โหลด</a></p></div>
</div>
${groups.length ? html`<section class="sec sec-people" id="people" aria-labelledby="people-h"><div class="wrap">
${sectionHead("people-h", "ผู้บริหารและทนายอาสา")}
${groups.map((g) => html`<div class="people-group"><h3 class="block-title">${g.label}</h3><ul class="people">${g.list.map((p) => personCard(p, rctx))}</ul></div>`)}
</div></section>` : raw('<span id="people"></span>')}`;
  const description = toPlainText(sanitizeRichHtml(pg.body_html), 160) || model.chrome.config.seo_description;
  return layout(model, rctx, { title: plain(pg.title, 200) || "เกี่ยวกับศูนย์", description, path: "/about", current: "about", ld: [breadcrumbLd(crumbs)], main });
}

/* ═══ บริการ (ขั้นตอนเต็มจาก serviceSteps() + ภาพวิธีขอรับบริการ + ข้อมูลวันนัด) ═══ */
function renderServices(model, rctx) {
  const crumbs = [{ label: "ขั้นตอนการขอรับบริการ", href: "/services" }];
  const services = [
    { key: "appointment", actions: html`<a class="btn btn-primary" href="/appointment.html">${icon("calendar", { size: 18 })}กรอกแบบคำร้องจองคิวบนเว็บไซต์</a><a class="btn btn-outline" href="${LINE_OA_URL}" target="_blank" rel="noopener noreferrer">${icon("line", { size: 18 })}จองผ่าน LINE</a>`, note: "จองผ่านเว็บไซต์ได้ทันทีโดยไม่ต้องมี LINE หรือจองผ่าน LINE ตามขั้นตอนด้านล่าง" },
    { key: "consult", actions: html`<a class="btn btn-primary" href="${LINE_OA_URL}" target="_blank" rel="noopener noreferrer">${icon("line", { size: 18 })}เริ่มขอรับคำปรึกษาใน LINE</a>`, note: "แบบฟอร์มขอรับคำปรึกษาเปิดจากเมนูใน LINE เพราะเป็นลิงก์เฉพาะของแต่ละท่าน" },
    { key: "complaint", actions: html`<a class="btn btn-primary" href="${LINE_OA_URL}" target="_blank" rel="noopener noreferrer">${icon("line", { size: 18 })}เริ่มร้องเรียนใน LINE</a>`, note: "แบบฟอร์มร้องเรียนเปิดจากเมนูใน LINE เพราะเป็นลิงก์เฉพาะของแต่ละท่าน" },
  ];
  const main = html`${pageHead({ crumbs, title: "ขั้นตอนการขอรับบริการ", lead: "ทุกบริการไม่มีค่าใช้จ่าย เลือกบริการที่ต้องการ แล้วทำตามขั้นตอน" })}
<div class="wrap">
<nav class="chips" aria-label="ข้ามไปบริการ"><ul>${services.map((s) => html`<li><a href="#svc-${s.key}">${SERVICE_TITLES[s.key].title}</a></li>`)}</ul></nav>
${services.map((s) => {
    const img = HOWTO_IMAGES[s.key];
    return html`<section class="svc" id="svc-${s.key}" aria-labelledby="svc-${s.key}-h">
<div class="svc-text">
<h2 class="svc-title" id="svc-${s.key}-h"><img src="/assets/icons3d/${SERVICE_TITLES[s.key].icon}.png" width="256" height="256" alt="" loading="lazy" />${SERVICE_TITLES[s.key].title}</h2>
<p class="svc-note">${s.note}</p>
<ol class="steps steps-full">${serviceSteps(s.key).map((st) => html`<li><strong>${st.title}</strong><span>${st.detail}</span></li>`)}</ol>
<p class="svc-actions">${s.actions}</p>
</div>
${img ? html`<a class="svc-img" href="/${img.full}" target="_blank" rel="noopener"><img src="/${img.preview}" width="520" height="${s.key === "appointment" ? "1619" : s.key === "complaint" ? "1051" : "1039"}" alt="ภาพ${SERVICE_TITLES[s.key].howto}" loading="lazy" decoding="async" /><span class="svc-img-cap">${icon("search", { size: 16 })}ดูภาพขนาดเต็ม</span></a>` : ""}
</section>`;
  })}
<section class="svc-visit" aria-labelledby="visit-h">
<h2 class="block-title" id="visit-h">เตรียมตัวก่อนมาพบตามนัด</h2>
<div class="visit-grid">
<div><h3>สถานที่</h3><p>${LOC.room}<br />${LOC.place}<br />${LOC.address}</p><p><a class="link-arrow" href="${MAP_DIR_URL}" target="_blank" rel="noopener noreferrer">ขอเส้นทาง${icon("right", { size: 18 })}</a></p>
<h3>เวลาให้คำปรึกษาของทนายอาสา</h3><p>${APPOINTMENT_INFO.lawyer_schedule}<br />${APPOINTMENT_INFO.lawyer_off}</p></div>
<div><h3>เอกสารที่ควรนำมา</h3><ol class="doc-checklist">${APPOINTMENT_INFO.documents.map((d) => html`<li>${d}</li>`)}</ol><p class="muted-note">${APPOINTMENT_INFO.documents_note}</p></div>
</div>
</section>
</div>
${hotlinesSection("hotlines", "svc-hot-h")}`;
  return layout(model, rctx, { title: "ขั้นตอนการขอรับบริการ", description: `ขั้นตอนจองคิว ปรึกษาข้อกฎหมาย และร้องเรียน — ${SITE_NAME} ฟรี ไม่มีค่าใช้จ่าย`, path: "/services", current: "services", ld: [breadcrumbLd(crumbs)], main });
}

/* ═══ ติดต่อเรา ═══ */
function renderContact(model, rctx) {
  const crumbs = [{ label: "ติดต่อเรา", href: "/contact" }];
  const fb = facebookBlock(model.chrome.config, 2);
  const main = html`${pageHead({ crumbs, title: "ติดต่อเรา", lead: "ช่องทางติดต่อศูนย์ช่วยเหลือประชาชนทางกฎหมาย" })}
<div class="wrap">
<div class="contact-grid">
${contactCard(model.chrome)}
${mapEmbed()}
</div>
<div class="contact-more">
<div class="side-box side-qr side-qr-wide">
<img src="/assets/qr-lineoa.png" width="900" height="900" alt="คิวอาร์โค้ดเพิ่มเพื่อน LINE ${LINE_OA_ID}" loading="lazy" />
<div><h2 class="side-title">LINE ${LINE_OA_ID}</h2><p>ปรึกษาข้อกฎหมาย ร้องเรียน และติดตามสถานะเรื่องผ่านแชต LINE</p>
<a class="btn btn-line" href="${LINE_OA_URL}" target="_blank" rel="noopener noreferrer">${icon("line", { size: 20 })}เพิ่มเพื่อน</a>
${model.chrome.socials.length ? html`<p class="follow-label">ช่องทางอื่น</p>${socialLinks(model.chrome.socials, "socials socials-lg")}` : ""}</div>
</div>
${fb}
</div>
</div>
${hotlinesSection()}`;
  return layout(model, rctx, { title: "ติดต่อเรา", description: `ที่อยู่ เบอร์โทร เวลาทำการ และช่องทางติดต่อ ${SITE_NAME}`, path: "/contact", current: "contact", ld: [breadcrumbLd(crumbs)], main });
}

/* ═══ หน้าเนื้อหาทั่วไป /page/:slug ═══ */
function renderPage(model, rctx) {
  const pg = model.page;
  const crumbs = [{ label: plain(pg.title, 80), href: `/page/${pg.slug}` }];
  const body = isBlankHtml(pg.body_html) ? raw("") : renderRichHtml(pg.body_html);
  const updated = toDate(pg.updated_at);
  const main = html`${pageHead({ crumbs, title: plain(pg.title, 200) })}
<div class="wrap narrow">
${rctx.preview && pg.published !== true ? html`<p class="chip chip-draft">หน้านี้ยังไม่เผยแพร่</p>` : ""}
<div class="prose">${body}</div>
${updated ? html`<p class="muted-note">ปรับปรุงล่าสุด ${timeTag(updated)}</p>` : ""}
</div>`;
  const description = toPlainText(sanitizeRichHtml(pg.body_html), 160) || model.chrome.config.seo_description;
  return layout(model, rctx, { title: plain(pg.title, 200), description, path: `/page/${pg.slug}`, current: "about", ld: [breadcrumbLd(crumbs)], main });
}

/* ═══ 404 / 503 ═══ */
export function renderNotFound(model, rctx) {
  const main = html`<div class="wrap status-page">
<img src="/assets/icons3d/magnifying_glass_tilted_left.png" width="256" height="256" alt="" />
<p class="status-code">404</p>
<h1 class="page-title">ไม่พบหน้าที่ท่านต้องการ</h1>
<p>ลิงก์อาจไม่ถูกต้อง หรือเนื้อหานี้ถูกย้าย/ยกเลิกการเผยแพร่แล้ว</p>
<p class="status-actions"><a class="btn btn-primary" href="/">กลับหน้าแรก</a><a class="btn btn-outline" href="/news">ข่าวสารล่าสุด</a><a class="btn btn-outline" href="/contact">ติดต่อเรา</a></p>
</div>`;
  return layout(model, { ...rctx, statsDisabled: true }, { title: "ไม่พบหน้าที่ต้องการ", path: rctx.path || "/", main, bodyClass: "page-status", noindex: true });
}
export function renderUnavailable(model, rctx) {
  const chrome = model?.chrome || fallbackChrome();
  const main = html`<div class="wrap status-page">
<img src="/assets/icons3d/hourglass_not_done.png" width="256" height="256" alt="" />
<h1 class="page-title">ระบบขัดข้องชั่วคราว</h1>
<p>ขออภัยในความไม่สะดวก กรุณาลองใหม่อีกครั้งในอีกสักครู่ หากต้องการความช่วยเหลือด่วน โทร ${phoneLink(chrome.settings)} หรือสายด่วนด้านล่าง</p>
<p class="status-actions"><a class="btn btn-primary" href="/">กลับหน้าแรก</a><a class="btn btn-outline" href="${LINE_OA_URL}" target="_blank" rel="noopener noreferrer">แชต LINE ${LINE_OA_ID}</a></p>
</div>
${hotlinesSection()}`;
  return layout({ ...model, chrome }, { ...rctx, statsDisabled: true }, { title: "ระบบขัดข้องชั่วคราว", path: rctx.path || "/", main, bodyClass: "page-status", noindex: true });
}
/* chrome สำรอง (ใช้ตอนไม่มีข้อมูลอะไรเลย) — ค่าเริ่มต้นล้วน
   5 ต.ค. 69: seo_description ใช้ข้อความเดิมของศูนย์ (SITE_CONFIG_DEFAULTS) — เดิม "" ทำให้หน้า 503/404 ไม่มี meta description */
export function fallbackChrome() {
  return {
    settings: { ...SETTINGS_DEFAULTS },
    config: { facebook_pages: [], notice: { enabled: false, text: "", link: "" }, mourning: false, intro: "", seo_description: SITE_CONFIG_DEFAULTS.seo_description, contact_email: "" },
    socials: [], related: [], pages: [],
  };
}

/* ═══ sitemap.xml ═══ */
function xmlEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
export function renderSitemap(model) {
  const day = (v) => { const d = toDate(v); return d ? d.toISOString().slice(0, 10) : null; };
  const urls = [
    { loc: "/" }, { loc: "/news" }, { loc: "/knowledge" }, { loc: "/faq" }, { loc: "/documents" },
    { loc: "/about" }, { loc: "/services" }, { loc: "/contact" },
    ...model.chrome.pages.filter((p) => p.slug !== "about").map((p) => ({ loc: `/page/${p.slug}`, lastmod: day(p.updated_at) })),
    ...model.posts.map((p) => ({ loc: postPath(p), lastmod: day(p.updated_at) || day(p.published_at) })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${xmlEsc(absUrl(u.loc))}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
}

/* ═══ ทางเข้าเดียว: model → HTML ═══ */
export function renderView(model, rctx) {
  switch (model.view) {
    case "home": return renderHome(model, rctx).toString();
    case "news":
    case "knowledge": return renderList(model, rctx).toString();
    case "post": return renderPost(model, rctx).toString();
    case "faq": return renderFaq(model, rctx).toString();
    case "documents": return renderDocuments(model, rctx).toString();
    case "about": return renderAbout(model, rctx).toString();
    case "services": return renderServices(model, rctx).toString();
    case "contact": return renderContact(model, rctx).toString();
    case "page": return renderPage(model, rctx).toString();
    default: return renderNotFound(model, rctx).toString();
  }
}
