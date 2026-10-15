/* api/_site-data.js — ดึงข้อมูลเว็บไซต์หน้าบ้านจาก Supabase (สาย A · เว็บไซต์ไดนามิก 1 ต.ค. 69 — สเปก docs/WEBSITE-SPEC.md ข้อ 4)
   บอสสั่ง 30 ก.ย. 69: "รื้อหน้า web ใหม่ ทำแบบ dynamic website มี banner มี social มีระบบ backend admin"

   ⛔ กติกา "เผยแพร่แล้ว" (สเปกข้อ 4.2) อยู่ที่ไฟล์นี้ที่เดียว — ใช้ 2 ชั้น: กรองใน query (ประหยัด) + กรองซ้ำด้วย isLive*() ใน JS
      (กันกรณี query ถูกแก้พลาดภายหลังแล้วร่าง/ของตั้งเวลาหลุดขึ้นหน้าเว็บ) · ไม่ผ่านกติกา = 404 ยกเว้นโหมดดูตัวอย่าง (ctx.preview)
   ⛔ ห้ามให้ผลขึ้นกับ cookie/session (CDN แคชรวมทุกคน) — ข้อยกเว้นเดียวคือ ?preview=1 ที่ site.js ตั้ง no-store ให้แล้ว
   ⚠️ ความทนทาน (ข้อ 4.10): ทุก query ผ่าน run() = timeout + จับ error → ส่วนนั้นว่าง + console.error · หน้าแรกขึ้นเสมอ
      แม้ DB ล่มทั้งหมด · หน้าเนื้อหา (post/page/รายการ) ที่ query หลักพัง → kind "unavailable" (site.js ตอบ 503 no-store)

   ctx = { client: () => supabase client, getSettings: async () => settings, now: Date, preview: bool }
   (ฉีดของปลอมได้ — scripts/test-site.mjs / scripts/dev-site.mjs ใช้ fixture แทน DB จริง) */
import { db } from "./_db.js";
import { DEFAULTS as SETTINGS_DEFAULTS } from "./_settings.js";
import { whoFromSession, escapeLikePattern } from "./_staffauth.js";
import {
  mergeSiteConfig, DEFAULT_PAGES, NEWS_CATEGORY_KEYS, categoryInfo, postPath, cleanText,
} from "./_site-shared.js";

export const PAGE_SIZE = 12;
export const MAX_PAGE = 500;
export const QUERY_TIMEOUT_MS = 4000;
export const HOME_POSTS_PER_TAB = 8;
export const MAX_BANNERS = 10;
export const SEARCH_MAX = 100;
export const PAGE_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const POST_CARD_COLS = "id,category,title,excerpt,cover_path,cover_thumb_path,cover_w,cover_h,cover_alt,pinned,status,published_at,updated_at";
const POST_FULL_COLS = `${POST_CARD_COLS},body_html,gallery,attachments`;
const BANNER_COLS = "id,alt_text,caption,image_path,image_w,image_h,mobile_image_path,link_url,sort_order,active,starts_at,ends_at";
const PEOPLE_COLS = "id,group_key,name,position,organization,photo_path,photo_thumb_path,bio,show_on_home,sort_order,active";
const FAQ_COLS = "id,question,answer_html,category,sort_order,active";
const DOC_COLS = "id,title,description,category,file_path,file_name,file_size,file_type,sort_order,active,published_at,updated_at";
const LINK_COLS = "id,kind,label,url,icon,logo_path,sort_order,active";
const PAGE_META_COLS = "slug,title,show_in_menu,sort_order,published,updated_at";

/* ═══ กติกาเผยแพร่ (ฟังก์ชันบริสุทธิ์ — เทสต์ตรงได้) ═══ */
function ms(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : NaN;
}
export function isLiveBanner(b, now) {
  if (!b || b.active !== true) return false;
  const s = ms(b.starts_at); const e = ms(b.ends_at); const n = now.getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return false; // วันที่เสีย = ไม่แสดง (ปลอดภัยไว้ก่อน)
  return (s === null || s <= n) && (e === null || e > n);
}
export function isLivePost(p, now) {
  if (!p || p.status !== "published") return false;
  const t = ms(p.published_at);
  return typeof t === "number" && !Number.isNaN(t) && t <= now.getTime();
}
export function isLiveDoc(d, now) {
  if (!d || d.active !== true) return false;
  const t = ms(d.published_at);
  return typeof t === "number" && !Number.isNaN(t) && t <= now.getTime();
}
export function isActive(row) {
  return !!row && row.active === true;
}
/* หน้าเนื้อหา: แถว DB published=true หรือ (ไม่มีแถว และค่าเริ่มต้นของระบบ published) */
export function isLivePage(row, slug) {
  if (row) return row.published === true;
  return DEFAULT_PAGES[slug]?.published === true;
}

/* ═══ ตัวรัน query: timeout + จับ error ทุกกรณี (รวม db() โยนเพราะยังไม่ตั้ง env) ═══ */
function withTimeout(promise, ms, label) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout ${ms}ms (${label})`)), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}
async function run(label, build) {
  try {
    let b = build();
    if (b && typeof b.abortSignal === "function" && typeof AbortSignal?.timeout === "function") {
      b = b.abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    }
    const res = await withTimeout(Promise.resolve(b), QUERY_TIMEOUT_MS + 200, label);
    if (res?.error) throw res.error;
    return { ok: true, data: res?.data ?? null, count: res?.count ?? null };
  } catch (e) {
    console.error(`[site] query "${label}" ล้มเหลว:`, e?.message || e);
    return { ok: false, data: null, count: null };
  }
}

/* ═══ ค่าพารามิเตอร์จาก URL (ตรวจทุกตัว — ค่าเสียไม่ทำให้ query พัง) ═══ */
export function parseId(v) {
  const s = String(v ?? "");
  if (!/^[1-9]\d{0,14}$/.test(s)) return null;
  return Number(s);
}
/* page: ว่าง/ไม่ใช่ตัวเลข = 1 · เกิน MAX_PAGE = null (404) */
export function parsePage(v) {
  const s = String(v ?? "").trim();
  if (!s) return 1;
  if (!/^\d{1,6}$/.test(s)) return 1;
  const n = Number(s);
  if (n < 1) return 1;
  return n > MAX_PAGE ? null : n;
}
/* คำค้น: ≤ 100 ตัว · ตัด * (PostgREST ตีความเป็น wildcard เหมือน %) · ช่องว่างซ้อนเหลือช่องเดียว */
export function parseQuery(v) {
  return cleanText(String(v ?? "").replace(/\*/g, " ").replace(/\s+/g, " "), SEARCH_MAX);
}

/* ═══ ส่วนร่วมทุกหน้า: ตั้งค่า + ลิงก์โซเชียล/หน่วยงาน + หน้าเนื้อหา (เมนู/ท้ายเว็บ/sitemap) ═══ */
export async function safeSettings(ctx, timeoutMs = QUERY_TIMEOUT_MS) {
  try {
    const s = await withTimeout(Promise.resolve().then(() => ctx.getSettings()), timeoutMs, "settings");
    return s && typeof s === "object" ? s : { ...SETTINGS_DEFAULTS };
  } catch (e) {
    console.error("[site] getSettings ล้มเหลว ใช้ค่าเริ่มต้น:", e?.message || e);
    return { ...SETTINGS_DEFAULTS };
  }
}
/* รวมแถว DB กับหน้าระบบที่ยังไม่มีแถว (DEFAULT_PAGES) → เฉพาะที่เผยแพร่ (หรือทั้งหมดในโหมดดูตัวอย่าง) */
export function mergePageMeta(rows, preview) {
  const bySlug = new Map();
  for (const r of rows || []) if (r && typeof r.slug === "string") bySlug.set(r.slug, r);
  for (const [slug, d] of Object.entries(DEFAULT_PAGES)) {
    if (!bySlug.has(slug)) bySlug.set(slug, { slug, title: d.title, show_in_menu: d.show_in_menu, sort_order: d.sort_order, published: d.published, updated_at: null, isDefault: true });
  }
  return [...bySlug.values()]
    .filter((p) => preview || isLivePage(p.isDefault ? null : p, p.slug))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.slug).localeCompare(String(b.slug)));
}
async function loadChrome(ctx) {
  const c = ctx.client;
  const [settings, links, pages] = await Promise.all([
    safeSettings(ctx),
    run("site_links", () => {
      let b = c().from("site_links").select(LINK_COLS);
      if (!ctx.preview) b = b.eq("active", true);
      return b.order("sort_order", { ascending: true }).order("id", { ascending: true }).limit(100);
    }),
    run("site_pages(meta)", () => c().from("site_pages").select(PAGE_META_COLS).order("sort_order", { ascending: true }).limit(200)),
  ]);
  const linkRows = (links.data || []).filter((l) => ctx.preview || isActive(l));
  return {
    settings,
    config: mergeSiteConfig(settings.site_config),
    socials: linkRows.filter((l) => l.kind === "social"),
    related: linkRows.filter((l) => l.kind === "related"),
    pages: mergePageMeta(pages.data, ctx.preview),
  };
}

/* ═══ query โพสต์ (ใช้ร่วม หน้าแรก/รายการ/เรื่องที่เกี่ยวข้อง) ═══ */
function postsQuery(ctx, { categories, limit, offset = 0, q = "", pinnedFirst = false, count = false, excludeId = null }) {
  let b = ctx.client().from("site_posts").select(POST_CARD_COLS, count ? { count: "exact" } : undefined);
  b = b.in("category", categories);
  if (!ctx.preview) b = b.eq("status", "published").lte("published_at", ctx.now.toISOString());
  if (q) b = b.ilike("title", `%${escapeLikePattern(q)}%`);
  if (excludeId) b = b.neq("id", excludeId);
  if (pinnedFirst) b = b.order("pinned", { ascending: false });
  return b.order("published_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).range(offset, offset + limit - 1);
}
function livePosts(ctx, rows) {
  return (rows || []).filter((p) => ctx.preview || isLivePost(p, ctx.now));
}

/* ═══ ตัวโหลดต่อหน้า → model ให้ _site-render.js ═══
   คืน { kind: "page"|"notfound"|"redirect"|"unavailable", view, chrome, ... } */
async function loadHome(ctx) {
  const c = ctx.client;
  const [chrome, banners, people, faqs, docs, knowledge, ...tabs] = await Promise.all([
    loadChrome(ctx),
    run("site_banners", () => {
      let b = c().from("site_banners").select(BANNER_COLS);
      if (!ctx.preview) b = b.eq("active", true);
      return b.order("sort_order", { ascending: true }).order("id", { ascending: true }).limit(50);
    }),
    run("site_people(home)", () => {
      let b = c().from("site_people").select(PEOPLE_COLS).eq("show_on_home", true);
      if (!ctx.preview) b = b.eq("active", true);
      return b.order("sort_order", { ascending: true }).order("id", { ascending: true }).limit(3);
    }),
    run("site_faqs(home)", () => {
      let b = c().from("site_faqs").select(FAQ_COLS);
      if (!ctx.preview) b = b.eq("active", true);
      return b.order("sort_order", { ascending: true }).order("id", { ascending: true }).limit(5);
    }),
    run("site_documents(home)", () => {
      let b = c().from("site_documents").select(DOC_COLS);
      if (!ctx.preview) b = b.eq("active", true).lte("published_at", ctx.now.toISOString());
      return b.order("published_at", { ascending: false }).order("id", { ascending: false }).limit(5);
    }),
    run("site_posts(knowledge home)", () => postsQuery(ctx, { categories: ["knowledge"], limit: 3 })),
    ...NEWS_CATEGORY_KEYS.map((k) => run(`site_posts(home ${k})`, () => postsQuery(ctx, { categories: [k], limit: HOME_POSTS_PER_TAB, pinnedFirst: true }))),
  ]);
  return {
    kind: "page", view: "home", chrome,
    banners: (banners.data || []).filter((b) => ctx.preview || isLiveBanner(b, ctx.now)).slice(0, MAX_BANNERS),
    newsTabs: NEWS_CATEGORY_KEYS.map((k, i) => ({ key: k, info: categoryInfo(k), items: livePosts(ctx, tabs[i].data) })),
    people: (people.data || []).filter((p) => ctx.preview || isActive(p)).slice(0, 3),
    knowledge: livePosts(ctx, knowledge.data).slice(0, 3),
    faqs: (faqs.data || []).filter((f) => ctx.preview || isActive(f)).slice(0, 5),
    docs: (docs.data || []).filter((d) => ctx.preview || isLiveDoc(d, ctx.now)).slice(0, 5),
  };
}

async function loadList(ctx, view, params) {
  const page = parsePage(params.get("page"));
  const q = parseQuery(params.get("q"));
  let cat = "";
  let categories = ["knowledge"];
  if (view === "news") {
    const want = String(params.get("cat") || "");
    cat = NEWS_CATEGORY_KEYS.includes(want) ? want : "";
    categories = cat ? [cat] : NEWS_CATEGORY_KEYS;
  }
  const chromeP = loadChrome(ctx);
  if (page === null) return { kind: "notfound", chrome: await chromeP };
  const [chrome, res] = await Promise.all([
    chromeP,
    run(`site_posts(list ${view})`, () => postsQuery(ctx, { categories, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, q, pinnedFirst: true, count: true })),
  ]);
  if (!res.ok) return { kind: "unavailable", chrome };
  const items = livePosts(ctx, res.data);
  const total = Number.isFinite(res.count) ? res.count : items.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > 1 && items.length === 0) return { kind: "notfound", chrome };
  return { kind: "page", view, chrome, items, total, page, pages: Math.min(pages, MAX_PAGE), q, cat };
}

async function loadPost(ctx, params) {
  const id = parseId(params.get("id"));
  const section = params.get("section") === "knowledge" ? "knowledge" : "news";
  const chromeP = loadChrome(ctx);
  if (!id) return { kind: "notfound", chrome: await chromeP };
  const [chrome, res] = await Promise.all([
    chromeP,
    run("site_posts(one)", () => ctx.client().from("site_posts").select(POST_FULL_COLS).eq("id", id).maybeSingle()),
  ]);
  if (!res.ok) return { kind: "unavailable", chrome };
  const post = res.data;
  if (!post || !categoryInfo(post.category) || !(ctx.preview || isLivePost(post, ctx.now))) return { kind: "notfound", chrome };
  // path ไม่ตรงหมวด (เช่น /knowledge/5 แต่เป็นข่าว) → 301 ไป path ที่ถูก (เฉพาะเรื่องที่เผยแพร่แล้ว — ไม่บอกว่ามีร่างอยู่)
  if (categoryInfo(post.category).section !== section) return { kind: "redirect", location: postPath(post) };
  const rel = await run("site_posts(related)", () => postsQuery(ctx, { categories: [post.category], limit: 3, excludeId: post.id }));
  return { kind: "page", view: "post", chrome, post, related: livePosts(ctx, rel.data).filter((p) => p.id !== post.id).slice(0, 3) };
}

async function loadFaq(ctx) {
  const [chrome, res] = await Promise.all([
    loadChrome(ctx),
    run("site_faqs", () => {
      let b = ctx.client().from("site_faqs").select(FAQ_COLS);
      if (!ctx.preview) b = b.eq("active", true);
      return b.order("sort_order", { ascending: true }).order("id", { ascending: true }).limit(500);
    }),
  ]);
  if (!res.ok) return { kind: "unavailable", chrome };
  return { kind: "page", view: "faq", chrome, faqs: (res.data || []).filter((f) => ctx.preview || isActive(f)) };
}

async function loadDocuments(ctx) {
  const [chrome, res] = await Promise.all([
    loadChrome(ctx),
    run("site_documents", () => {
      let b = ctx.client().from("site_documents").select(DOC_COLS);
      if (!ctx.preview) b = b.eq("active", true).lte("published_at", ctx.now.toISOString());
      return b.order("sort_order", { ascending: true }).order("id", { ascending: true }).limit(500);
    }),
  ]);
  if (!res.ok) return { kind: "unavailable", chrome };
  return { kind: "page", view: "documents", chrome, docs: (res.data || []).filter((d) => ctx.preview || isLiveDoc(d, ctx.now)) };
}

/* หน้าเนื้อหา 1 หน้า (แถว DB หรือค่าเริ่มต้นของระบบ) — คืน { ok, page|null } · ok=false = DB พัง */
async function fetchPage(ctx, slug) {
  const res = await run(`site_pages(${slug})`, () => ctx.client().from("site_pages").select("slug,title,body_html,show_in_menu,sort_order,published,updated_at").eq("slug", slug).maybeSingle());
  if (!res.ok) return { ok: false, page: null };
  const row = res.data;
  if (row) return { ok: true, page: ctx.preview || isLivePage(row, slug) ? row : null };
  const d = DEFAULT_PAGES[slug];
  if (d && (ctx.preview || d.published)) return { ok: true, page: { ...d, updated_at: null, isDefault: true } };
  return { ok: true, page: null };
}

async function loadAbout(ctx) {
  const [chrome, pg, people] = await Promise.all([
    loadChrome(ctx),
    fetchPage(ctx, "about"),
    run("site_people", () => {
      let b = ctx.client().from("site_people").select(PEOPLE_COLS);
      if (!ctx.preview) b = b.eq("active", true);
      return b.order("sort_order", { ascending: true }).order("id", { ascending: true }).limit(300);
    }),
  ]);
  if (!pg.ok) return { kind: "unavailable", chrome };
  if (!pg.page) return { kind: "notfound", chrome };
  return { kind: "page", view: "about", chrome, page: pg.page, people: (people.data || []).filter((p) => ctx.preview || isActive(p)) };
}

async function loadContentPage(ctx, params) {
  const slug = String(params.get("slug") || "");
  if (slug === "about") return { kind: "redirect", location: "/about" };
  const chromeP = loadChrome(ctx);
  if (!PAGE_SLUG_RE.test(slug) || slug.length < 2 || slug.length > 40) return { kind: "notfound", chrome: await chromeP };
  const [chrome, pg] = await Promise.all([chromeP, fetchPage(ctx, slug)]);
  if (!pg.ok) return { kind: "unavailable", chrome };
  if (!pg.page) return { kind: "notfound", chrome };
  return { kind: "page", view: "page", chrome, page: pg.page };
}

async function loadSitemap(ctx) {
  // sitemap ไม่มีโหมดดูตัวอย่างเด็ดขาด (ห้ามร่างหลุด)
  const pub = { ...ctx, preview: false };
  const [chrome, posts] = await Promise.all([
    loadChrome(pub),
    run("site_posts(sitemap)", () => ctx.client().from("site_posts").select("id,category,status,published_at,updated_at")
      .eq("status", "published").lte("published_at", ctx.now.toISOString())
      .order("published_at", { ascending: false }).order("id", { ascending: false }).limit(5000)),
  ]);
  if (!posts.ok) return { kind: "unavailable", chrome };
  return { kind: "sitemap", chrome, posts: livePosts(pub, posts.data).filter((p) => categoryInfo(p.category)) };
}

export const VIEWS = ["home", "news", "knowledge", "post", "faq", "documents", "about", "services", "contact", "page", "sitemap"];

export async function loadView(view, params, ctx) {
  switch (view) {
    case "home": return loadHome(ctx);
    case "news":
    case "knowledge": return loadList(ctx, view, params);
    case "post": return loadPost(ctx, params);
    case "faq": return loadFaq(ctx);
    case "documents": return loadDocuments(ctx);
    case "about": return loadAbout(ctx);
    case "services":
    case "contact": return { kind: "page", view, chrome: await loadChrome(ctx) };
    case "page": return loadContentPage(ctx, params);
    case "sitemap": return loadSitemap(ctx);
    default: return { kind: "notfound", chrome: await loadChrome(ctx) };
  }
}

/* ═══ สิทธิ์ดูตัวอย่าง (?preview=1) — admin หรือ staff.can_edit_site=true (อ่านสดจาก DB · column หาย/พัง = false) ═══ */
export async function canPreviewFromSession(req) {
  try {
    const who = await whoFromSession(req, "staff");
    if (!who.ok) return false;
    if (who.role === "admin") return true;
    const { data, error } = await db().from("staff").select("can_edit_site").eq("id", who.staffId).maybeSingle();
    return !error && data?.can_edit_site === true;
  } catch (e) {
    console.error("[site] ตรวจสิทธิ์ดูตัวอย่างล้มเหลว:", e?.message || e);
    return false;
  }
}
