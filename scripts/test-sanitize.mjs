/* ตรวจตัวกรอง HTML (api/_sanitize.js) + สัญญากลางเว็บไซต์ (api/_site-shared.js) แบบออฟไลน์ — เว็บไซต์ไดนามิก 30 ก.ย. 69
   ไม่ต่อเน็ต/DB · ตั้ง env ปลอมเองในไฟล์นี้ */
process.env.SUPABASE_URL = "https://demo-ref.supabase.co";
process.env.SITE_URL = "https://suphan-legalaid.vercel.app";

const { sanitizeRichHtml, toPlainText, isBlankHtml, escapeHtml, youtubeEmbedId, isAllowedImageSrc } = await import("../api/_sanitize.js");
const S = await import("../api/_site-shared.js");

let n = 0;
function check(cond, msg) {
  n++;
  if (!cond) { console.error("❌", msg); process.exit(1); }
}
const MEDIA = "https://demo-ref.supabase.co/storage/v1/object/public/site-media/site/inline/202610/1790000000000-0123456789abcdef.webp";

/* ═══ 1) โค้ดอันตรายต้องหายหมด ═══ */
const attacks = [
  `<script>alert(1)</script>ok`,
  `<img src=x onerror=alert(1)>`,
  `<img src="${MEDIA}" onerror="alert(1)">`,
  `<a href="javascript:alert(1)">x</a>`,
  `<a href="jav&#x09;ascript:alert(1)">x</a>`,
  `<a href=" JaVaScRiPt:alert(1)">x</a>`,
  `<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>`,
  `<p style="background:url(javascript:alert(1))">x</p>`,
  `<svg><script>alert(1)</script></svg>`,
  `<iframe src="https://evil.example/x"></iframe>`,
  `<iframe srcdoc="<script>alert(1)</script>"></iframe>`,
  `<object data="x.swf"></object><embed src="x">`,
  `<form action="https://evil.example"><input name=a></form>`,
  `<style>body{display:none}</style>`,
  `<math><mi xlink:href="javascript:alert(1)">x</mi></math>`,
  `<p onclick="alert(1)">x</p>`,
  `<a href="//evil.example/x">x</a>`,
  `<img src="data:image/png;base64,AAAA">`,
  `<img src="https://evil.example/pixel.gif">`,
  `<img src="http://demo-ref.supabase.co/storage/v1/object/public/site-media/site/inline/202610/1790000000000-0123456789abcdef.webp">`,
  `<img src="${MEDIA.replace("/site/inline/", "/site/../evidence/")}">`,
  `<base href="https://evil.example/">`,
  `<meta http-equiv="refresh" content="0;url=https://evil.example">`,
  `<link rel=stylesheet href="https://evil.example/x.css">`,
];
for (const a of attacks) {
  const out = sanitizeRichHtml(a);
  check(!/<script|<svg|<style|<object|<embed|<form|<input|<math|<base|<meta|<link|srcdoc|on\w+=|javascript:|data:|style=|evil\.example/i.test(out),
    `กรองไม่หมด: ${a} → ${out}`);
}

/* ═══ 2) ของที่ต้องเก็บไว้ ═══ */
check(sanitizeRichHtml(`<p class="ql-align-center">กลาง</p>`) === `<p class="ql-align-center">กลาง</p>`, "ต้องเก็บ ql-align-center");
check(sanitizeRichHtml(`<p class="evil ql-indent-2">x</p>`) === `<p class="ql-indent-2">x</p>`, "ต้องทิ้ง class ที่ไม่อยู่ในรายการ");
check(sanitizeRichHtml(`<h1>หัวข้อ</h1>`) === `<h2>หัวข้อ</h2>`, "h1 ต้องกลายเป็น h2 (หน้าเว็บมี h1 ของตัวเองแล้ว)");
check(sanitizeRichHtml(`<ul><li>ก</li><li>ข</li></ul>`) === `<ul><li>ก</li><li>ข</li></ul>`, "ต้องเก็บรายการ");
const img = sanitizeRichHtml(`<img src="${MEDIA}" alt="ภาพ" width="800" height="600">`);
check(img.includes(`src="${MEDIA}"`) && img.includes(`alt="ภาพ"`) && img.includes(`loading="lazy"`) && img.includes(`width="800"`), `ต้องเก็บรูปจาก site-media: ${img}`);
check(sanitizeRichHtml(`<img src="/assets/logo-pao.png" alt="โลโก้">`).includes(`src="/assets/logo-pao.png"`), "ต้องเก็บรูปจาก /assets/");
const ext = sanitizeRichHtml(`<a href="https://www.lawyerscouncil.or.th/">สภาทนายความ</a>`);
check(ext.includes(`target="_blank"`) && ext.includes(`rel="noopener noreferrer nofollow"`), `ลิงก์ภายนอกต้องได้ target/rel: ${ext}`);
const own = sanitizeRichHtml(`<a href="https://suphan-legalaid.vercel.app/news/1">ข่าว</a><a href="/about">เกี่ยวกับ</a>`);
check(!own.includes("target="), `ลิงก์ภายในเว็บต้องไม่เปิดแท็บใหม่: ${own}`);
check(sanitizeRichHtml(`<a href="tel:035525500">โทร</a>`).includes(`href="tel:035525500"`), "ต้องเก็บลิงก์ tel:");
const yt = sanitizeRichHtml(`<iframe class="ql-video" src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=5" frameborder="0" allowfullscreen="true"></iframe>`);
check(yt.includes(`src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"`) && yt.includes(`class="ql-video"`), `YouTube ต้องถูกบังคับเป็น nocookie: ${yt}`);
check(sanitizeRichHtml(`<iframe src="https://www.youtube.com/embed/abc"></iframe>`) === "", "YouTube id ไม่ครบ 11 ตัวต้องถูกลบ");
check(sanitizeRichHtml(`<table><tr><td colspan="2">x</td></tr></table>`).includes(`colspan="2"`), "ต้องเก็บตาราง");

/* ═══ 3) ข้อความล้วน/ค่าว่าง/escape ═══ */
check(toPlainText(`<p>ก &amp; ข</p><p>ค&nbsp;ง</p>`) === "ก & ข ค ง", `toPlainText decode ผิด: ${toPlainText(`<p>ก &amp; ข</p><p>ค&nbsp;ง</p>`)}`);
check(toPlainText(`<script>alert(1)</script>ข้อความ`) === "ข้อความ", "toPlainText ต้องทิ้งเนื้อหา script");
check(toPlainText("กขคงจฉชซฌญ", 5) === "กขคง…", `ตัดความยาวผิด: ${toPlainText("กขคงจฉชซฌญ", 5)}`);
check(isBlankHtml("<p><br></p>") && isBlankHtml("") && !isBlankHtml(`<p><img src="${MEDIA}"></p>`) && !isBlankHtml("<p>x</p>"), "isBlankHtml ผิด");
check(escapeHtml(`<a href="x">'&</a>`) === "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;", "escapeHtml ผิด");
check(youtubeEmbedId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ") === "dQw4w9WgXcQ" && !youtubeEmbedId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "youtubeEmbedId ผิด");
check(isAllowedImageSrc(MEDIA) && !isAllowedImageSrc("https://evil.example/x.png") && !isAllowedImageSrc("/assets/../api/x"), "isAllowedImageSrc ผิด");

/* ═══ 4) สัญญากลาง _site-shared.js ═══ */
check(S.safeHref("javascript:alert(1)") === null && S.safeHref("data:text/html,x") === null && S.safeHref("//evil.example") === null, "safeHref ต้องปฏิเสธลิงก์อันตราย");
check(S.safeHref("www.suphan.go.th") === "https://www.suphan.go.th/", `safeHref เติม https ผิด: ${S.safeHref("www.suphan.go.th")}`);
check(S.safeHref("/appointment.html") === "/appointment.html" && S.safeHref("/x", { allowRelative: false }) === null, "safeHref path ภายในผิด");
check(S.safeHref("https://a.example/x y") === null && S.safeHref("mailto:a@b.co") === "mailto:a@b.co", "safeHref ช่องว่าง/mailto ผิด");
check(S.isFacebookPageUrl("https://www.facebook.com/profile.php?id=61585714474321"), "เพจจาก facebook.txt ต้องผ่าน");
check(S.isFacebookPageUrl("https://www.facebook.com/SuphanburiPAO") && !S.isFacebookPageUrl("https://evil.example/facebook.com") && !S.isFacebookPageUrl("https://www.facebook.com/profile.php?id=abc"), "isFacebookPageUrl ผิด");
const cfg = S.mergeSiteConfig({
  facebook_pages: [{ label: "<b>x</b>", url: "https://evil.example/" }, { label: "", url: "https://www.facebook.com/profile.php?id=61585714474321" }, { label: "a" }, { label: "เกิน", url: "" }],
  notice: { enabled: true, text: "", link: "javascript:alert(1)" },
  mourning: "yes", contact_email: "not-an-email", intro: "   ",
});
check(cfg.facebook_pages.length === 3 && cfg.facebook_pages[0].url === "" && cfg.facebook_pages[1].url.includes("61585714474321") && cfg.facebook_pages[1].label === "Facebook", `mergeSiteConfig facebook_pages ผิด: ${JSON.stringify(cfg.facebook_pages)}`);
check(cfg.notice.enabled === false && cfg.notice.link === "" && cfg.mourning === false && cfg.contact_email === "", "mergeSiteConfig ค่าเสียต้องถูกตัด");
check(cfg.intro === S.SITE_CONFIG_DEFAULTS.intro, "intro ว่างต้องกลับเป็นค่าเริ่มต้น");
const def = S.mergeSiteConfig(null);
check(def.facebook_pages[0].url === "https://www.facebook.com/profile.php?id=61585714474321" && def.facebook_pages[1].url === "", "ค่าเริ่มต้นเพจ Facebook ไม่ตรงมติบอส");
check(S.isMediaPath("site/banner/202610/1790000000000-0123456789abcdef.webp"), "isMediaPath แบนเนอร์ต้องผ่าน");
check(S.isMediaPath("site/cover/202610/1790000000000-0123456789abcdef-t.jpg", "cover"), "isMediaPath รูปย่อต้องผ่าน");
check(!S.isMediaPath("site/banner/202610/1790000000000-0123456789abcdef.pdf"), "แบนเนอร์ต้องเป็นรูปเท่านั้น");
check(!S.isMediaPath("site/doc/202610/1790000000000-0123456789abcdef.exe") && !S.isMediaPath("../site/doc/202610/1790000000000-0123456789abcdef.pdf"), "isMediaPath ต้องปฏิเสธ exe/traversal");
check(S.isMediaPath("site/doc/202610/1790000000000-0123456789abcdef.docx", ["doc"]) && !S.isMediaPath("site/doc/202610/1790000000000-0123456789abcdef.docx", ["attachment"]), "isMediaPath จำกัดชนิดผิด");
check(S.postPath({ id: 7, category: "knowledge" }) === "/knowledge/7" && S.postPath({ id: 8, category: "activity" }) === "/news/8", "postPath ผิด");
check(S.absUrl("/news/1") === "https://suphan-legalaid.vercel.app/news/1", "absUrl ผิด");
check(S.DEFAULT_PAGES.privacy.published === false && S.DEFAULT_PAGES.about.published === true, "privacy ต้องปิดไว้จนกว่าผู้มีอำนาจตรวจ");
for (const p of Object.values(S.DEFAULT_PAGES)) check(sanitizeRichHtml(p.body_html) === p.body_html, `หน้าเริ่มต้น ${p.slug} ต้องผ่านตัวกรองโดยไม่ถูกแก้`);
check(S.DEFAULT_PAGES.about.body_html.includes("ชั้น 1") && S.DEFAULT_PAGES.about.body_html.includes("72000"), "หน้าเกี่ยวกับต้องดึงที่อยู่จาก _serviceinfo.js");

console.log(`✅ test-sanitize: ผ่านครบ ${n} ข้อ`);
