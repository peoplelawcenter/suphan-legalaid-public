/* scripts/fixtures/site-fixtures.mjs — ข้อมูลตัวอย่าง + Supabase ปลอม สำหรับเว็บไซต์หน้าบ้าน (สเปก docs/WEBSITE-SPEC.md ข้อ 7)
   เพิ่ม 5 ต.ค. 69 (developer ตามโจทย์ Hermes — ผลตรวจ code-reviewer: site.css ขาดกฎ ~80 class ต้องเปิดดูจริงทุก view)
   ใช้โดย scripts/test-site.mjs (ตรวจ class ↔ site.css + ฐานไม่ตอบ) และ scripts/dev-site.mjs (เว็บจำลองให้ Playwright ถ่ายจอ)

   ⛔ ข้อความตัวอย่างทุกชิ้นขึ้นต้น "[ตัวอย่าง]" — ห้ามแต่งข้อมูลจริง (ชื่อคน/เบอร์/เนื้อหากฎหมาย) · อยู่ใน scripts/ (ไม่ขึ้น deploy ตาม .vercelignore)
   ⛔ รูปตัวอย่างใช้ไฟล์ที่มีอยู่แล้วใน public/assets/ เท่านั้น (MEDIA_FILES จับคู่ path ในฐาน → ไฟล์จริง)

   fakeClient(tables, { mode }) = แทน db() ของ supabase-js เฉพาะที่ api/_site-data.js ใช้
     mode "ok"   = กรอง/เรียง/แบ่งหน้าจริงตาม query
     mode "down" = ตอบ error ทันที (ตารางหาย/ฐานล่ม)
     mode "hang" = รับสายแต่ไม่ตอบเลย (ไม่สน abortSignal) — จำลองบั๊กหน้าแรกค้าง 504 */

const DAY = 86400000;

/* path ตามรูปแบบ isMediaPath(): site/<kind>/<YYYYMM>/<ms13>-<hex16>[-t].<ext> */
export function mediaPath(kind, n, ext = "jpg", thumb = false) {
  const hex = n.toString(16).padStart(16, "0");
  return `site/${kind}/202610/${1790000000000 + n}-${hex}${thumb ? "-t" : ""}.${ext}`;
}

/* path ในฐาน → ไฟล์ตัวอย่างใน public/ (dev-site.mjs เสิร์ฟให้ที่ /storage/v1/object/public/site-media/<path>) */
export const MEDIA_FILES = {};
function m(kind, n, file, ext, thumb = false) {
  const p = mediaPath(kind, n, ext, thumb);
  MEDIA_FILES[p] = file;
  return p;
}

export function makeFixtures(now = new Date(), { notice = true, mourning = false } = {}) {
  const ago = (d) => new Date(now.getTime() - d * DAY).toISOString();
  const later = (d) => new Date(now.getTime() + d * DAY).toISOString();
  const covers = [
    ["assets/og-legal-aid-v2.png", "png", 1200, 630],
    ["assets/poster-v2-preview.jpg", "jpg", 1040, 735],
    ["assets/howto/welcome-hero.jpg", "jpg", 1040, 676],
    ["assets/logo-line-cover.png", "png", 1080, 878],
  ];
  const posts = [];
  let id = 1;
  const addPost = (category, i, extra = {}) => {
    const c = covers[i % covers.length];
    const withCover = i % 3 !== 2; // บางเรื่องไม่มีรูปปก → ใช้ไอคอนแทน (ต้องดูเรียบร้อยด้วย)
    posts.push({
      id: id++, category,
      title: `[ตัวอย่าง] ${({ news: "ข่าวประชาสัมพันธ์", activity: "ภาพกิจกรรม", announcement: "ประกาศ", knowledge: "บทความความรู้กฎหมาย" })[category]} เรื่องที่ ${i + 1} สำหรับทดสอบการแสดงผลหัวเรื่องที่ยาวพอสมควรสองบรรทัด`,
      excerpt: i % 2 ? `[ตัวอย่าง] คำโปรยสั้นๆ ของเรื่องที่ ${i + 1} ใช้ทดสอบการตัดบรรทัดในการ์ดข่าวบนจอมือถือและจอคอมพิวเตอร์` : "",
      cover_path: withCover ? m("cover", 100 + id, c[0], c[1]) : null,
      cover_thumb_path: null,
      cover_w: withCover ? c[2] : null, cover_h: withCover ? c[3] : null,
      cover_alt: "", pinned: i === 0, status: "published", published_at: ago(i + 1), updated_at: ago(i),
      body_html: [
        "<p>[ตัวอย่าง] ย่อหน้าแรกของเนื้อหา ใช้ทดสอบความกว้างบรรทัด ระยะบรรทัด และการตัดคำภาษาไทยบนจอมือถือ</p>",
        "<h2>[ตัวอย่าง] หัวข้อย่อย</h2><ul><li>รายการที่หนึ่ง</li><li>รายการที่สอง</li></ul>",
        "<blockquote>[ตัวอย่าง] ข้อความอ้างอิง</blockquote>",
        '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe>',
        "<p>[ตัวอย่าง] ลิงก์ <a href=\"/faq\">คำถามที่พบบ่อย</a></p>",
      ].join(""),
      gallery: i === 0 ? [0, 1, 2, 3, 4].map((g) => ({ path: m("gallery", 300 + id * 10 + g, covers[g % 4][0], covers[g % 4][1]), thumb_path: null, alt: `[ตัวอย่าง] ภาพที่ ${g + 1}`, w: covers[g % 4][2], h: covers[g % 4][3] })) : [],
      attachments: i === 0 ? [{ path: mediaPath("attachment", 500 + id, "pdf"), name: "[ตัวอย่าง] เอกสารแนบ.pdf", size: 245760, type: "application/pdf" }] : [],
      ...extra,
    });
  };
  for (const cat of ["news", "activity", "announcement"]) for (let i = 0; i < 5; i++) addPost(cat, i);
  for (let i = 0; i < 4; i++) addPost("knowledge", i);
  addPost("news", 9, { status: "draft", published_at: null, title: "[ตัวอย่าง] ร่างข่าว (เห็นเฉพาะโหมดดูตัวอย่าง)" });
  addPost("news", 10, { published_at: later(3), title: "[ตัวอย่าง] ข่าวตั้งเวลาเผยแพร่ล่วงหน้า" });

  return {
    settings: [
      { key: "site_config", value: {
        facebook_pages: [
          { label: "[ตัวอย่าง] เพจสภาทนายความ", url: "https://www.facebook.com/profile.php?id=61585714474321" },
          { label: "[ตัวอย่าง] เพจ อบจ.", url: "https://www.facebook.com/example.page" },
        ],
        notice: { enabled: notice, text: "[ตัวอย่าง] แถบประกาศด่วน — ศูนย์ปิดให้บริการวันหยุดนักขัตฤกษ์", link: "/news" },
        mourning,
        contact_email: "example@example.test",
      } },
    ],
    site_banners: [
      { id: 1, alt_text: "[ตัวอย่าง] แบนเนอร์ที่ 1", caption: "[ตัวอย่าง] ข้อความบนแบนเนอร์", image_path: m("banner", 1, "assets/hero-cover.jpg", "jpg"), image_w: 1207, image_h: 413, mobile_image_path: null, link_url: "/news", sort_order: 10, active: true, starts_at: null, ends_at: null },
      { id: 2, alt_text: "[ตัวอย่าง] แบนเนอร์ที่ 2", caption: "", image_path: m("banner", 2, "assets/og-legal-aid-v2.png", "png"), image_w: 1200, image_h: 630, mobile_image_path: null, link_url: null, sort_order: 20, active: true, starts_at: ago(1), ends_at: later(10) },
      { id: 3, alt_text: "[ตัวอย่าง] แบนเนอร์ปิดอยู่", caption: "", image_path: m("banner", 3, "assets/poster-v2-preview.jpg", "jpg"), image_w: 1040, image_h: 735, mobile_image_path: null, link_url: null, sort_order: 30, active: false, starts_at: null, ends_at: null },
    ],
    site_posts: posts,
    site_pages: [
      { slug: "about", title: "เกี่ยวกับศูนย์", body_html: "<p>[ตัวอย่าง] เนื้อหาหน้าเกี่ยวกับศูนย์</p><h2>[ตัวอย่าง] หัวข้อ</h2><p>[ตัวอย่าง] รายละเอียด</p>", show_in_menu: true, sort_order: 0, published: true, updated_at: ago(2) },
      { slug: "history", title: "[ตัวอย่าง] ประวัติศูนย์", body_html: "<p>[ตัวอย่าง] หน้าเนื้อหาเพิ่มเติม</p>", show_in_menu: true, sort_order: 10, published: true, updated_at: ago(3) },
      { slug: "draft-page", title: "[ตัวอย่าง] หน้าร่าง", body_html: "<p>[ตัวอย่าง] ร่าง</p>", show_in_menu: true, sort_order: 20, published: false, updated_at: ago(3) },
    ],
    site_people: [
      { id: 1, group_key: "executive", name: "[ตัวอย่าง] ชื่อผู้บริหาร คนที่หนึ่ง", position: "[ตัวอย่าง] ตำแหน่ง", organization: "[ตัวอย่าง] หน่วยงาน", photo_path: m("person", 1, "assets/logo-line-icon.png", "png"), photo_thumb_path: null, bio: "[ตัวอย่าง] ประวัติย่อ", show_on_home: true, sort_order: 10, active: true },
      { id: 2, group_key: "executive", name: "[ตัวอย่าง] ชื่อผู้บริหาร คนที่สอง", position: "[ตัวอย่าง] ตำแหน่ง", organization: "", photo_path: null, photo_thumb_path: null, bio: "", show_on_home: true, sort_order: 20, active: true },
      { id: 3, group_key: "lawyer", name: "[ตัวอย่าง] ทนายอาสา", position: "[ตัวอย่าง] ทนายความอาสา", organization: "", photo_path: null, photo_thumb_path: null, bio: "[ตัวอย่าง] ประวัติย่อทนายอาสาที่ยาวกว่าปกติเพื่อดูการตัดบรรทัด", show_on_home: false, sort_order: 30, active: true },
      { id: 4, group_key: "staff", name: "[ตัวอย่าง] เจ้าหน้าที่ศูนย์", position: "[ตัวอย่าง] เจ้าหน้าที่", organization: "", photo_path: null, photo_thumb_path: null, bio: "", show_on_home: false, sort_order: 40, active: true },
      { id: 5, group_key: "staff", name: "[ตัวอย่าง] ปิดใช้งาน", position: "", organization: "", photo_path: null, photo_thumb_path: null, bio: "", show_on_home: false, sort_order: 50, active: false },
    ],
    site_faqs: [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, question: `[ตัวอย่าง] คำถามที่พบบ่อยข้อที่ ${i} ยาวพอสมควรเพื่อดูการตัดบรรทัด`, answer_html: `<p>[ตัวอย่าง] คำตอบข้อที่ ${i}</p>`, category: i <= 3 ? "[ตัวอย่าง] หมวดทั่วไป" : "[ตัวอย่าง] หมวดการจองคิว", sort_order: i * 10, active: true })),
    site_documents: [
      { id: 1, title: "[ตัวอย่าง] แบบฟอร์มคำร้อง", description: "[ตัวอย่าง] คำอธิบายเอกสาร", category: "[ตัวอย่าง] แบบฟอร์ม", file_path: mediaPath("doc", 1, "pdf"), file_name: "form.pdf", file_size: 183500, file_type: "application/pdf", sort_order: 10, active: true, published_at: ago(5), updated_at: ago(5) },
      { id: 2, title: "[ตัวอย่าง] เอกสาร Word", description: "", category: "[ตัวอย่าง] แบบฟอร์ม", file_path: mediaPath("doc", 2, "docx"), file_name: "doc.docx", file_size: 52000, file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sort_order: 20, active: true, published_at: ago(4), updated_at: ago(4) },
      { id: 3, title: "[ตัวอย่าง] ตาราง Excel", description: "[ตัวอย่าง] สถิติ", category: "[ตัวอย่าง] เอกสารเผยแพร่", file_path: mediaPath("doc", 3, "xlsx"), file_name: "stat.xlsx", file_size: 12000, file_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sort_order: 30, active: true, published_at: ago(3), updated_at: ago(3) },
    ],
    site_links: [
      { id: 1, kind: "social", label: "[ตัวอย่าง] Facebook", url: "https://www.facebook.com/example.page", icon: "facebook", logo_path: null, sort_order: 10, active: true },
      { id: 2, kind: "social", label: "[ตัวอย่าง] YouTube", url: "https://www.youtube.com/@example", icon: "youtube", logo_path: null, sort_order: 20, active: true },
      { id: 3, kind: "related", label: "[ตัวอย่าง] หน่วยงานที่เกี่ยวข้อง ก", url: "https://example.test/a", icon: null, logo_path: m("logo", 1, "assets/logo-pao.png", "png"), sort_order: 30, active: true },
      { id: 4, kind: "related", label: "[ตัวอย่าง] หน่วยงานที่เกี่ยวข้อง ข (ไม่มีโลโก้)", url: "https://example.test/b", icon: null, logo_path: null, sort_order: 40, active: true },
    ],
  };
}

/* ═══ เครื่องกรองแถวแบบ PostgREST อย่างง่าย (ใช้ร่วม fakeClient + เซิร์ฟเวอร์ปลอมใน dev-site.mjs) ═══
   ops = { filters:[{col,op,val}], order:[{col,asc,nullsFirst}], offset, limit } · ค่าเทียบเป็นสตริงแบบที่ PostgREST รับจาก URL */
function cmpVal(a, b) {
  const sa = String(a), sb = String(b);
  if (/^-?\d+(\.\d+)?$/.test(sa) && /^-?\d+(\.\d+)?$/.test(sb)) return Number(sa) - Number(sb);
  const ta = Date.parse(sa), tb = Date.parse(sb);
  if (/^\d{4}-\d{2}-\d{2}/.test(sa) && /^\d{4}-\d{2}-\d{2}/.test(sb) && Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
function likeToRegex(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (ch === "%" || ch === "*") re += ".*";
    else if (ch === "_") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is");
}
export function applyQuery(rows, ops) {
  let out = (rows || []).filter((r) => (ops.filters || []).every(({ col, op, val }) => {
    const v = r[col];
    if (op === "eq") return v !== null && v !== undefined && String(v) === String(val);
    if (op === "neq") return v === null || v === undefined || String(v) !== String(val);
    if (op === "lte") return v !== null && v !== undefined && cmpVal(v, val) <= 0;
    if (op === "gte") return v !== null && v !== undefined && cmpVal(v, val) >= 0;
    if (op === "in") return v !== null && v !== undefined && val.map(String).includes(String(v));
    if (op === "ilike") return v !== null && v !== undefined && likeToRegex(String(val)).test(String(v));
    throw new Error(`fake supabase: ไม่รองรับตัวกรอง ${op}`);
  }));
  const order = ops.order || [];
  out = out.slice().sort((a, b) => {
    for (const { col, asc, nullsFirst } of order) {
      const x = a[col], y = b[col];
      const xn = x === null || x === undefined, yn = y === null || y === undefined;
      if (xn || yn) {
        if (xn && yn) continue;
        const nf = nullsFirst ?? !asc; // ค่าเริ่มต้น PostgreSQL: desc = nulls first
        return xn ? (nf ? -1 : 1) : (nf ? 1 : -1);
      }
      const c = typeof x === "boolean" || typeof y === "boolean" ? Number(x) - Number(y) : cmpVal(x, y);
      if (c) return asc ? c : -c;
    }
    return 0;
  });
  const count = out.length;
  const offset = ops.offset || 0;
  const limit = ops.limit ?? out.length;
  return { data: out.slice(offset, offset + limit), count };
}

/* ═══ client ปลอม (แทน db()) — ทำงานแบบ thenable เหมือน builder ของ supabase-js ═══ */
export function fakeClient(tables, { mode = "ok", calls } = {}) {
  return () => ({
    from(table) {
      const ops = { filters: [], order: [], offset: 0, limit: undefined };
      let single = false;
      let wantCount = false;
      const b = {
        select(_cols, opts) { wantCount = opts?.count === "exact"; return b; },
        eq(col, val) { ops.filters.push({ col, op: "eq", val }); return b; },
        neq(col, val) { ops.filters.push({ col, op: "neq", val }); return b; },
        lte(col, val) { ops.filters.push({ col, op: "lte", val }); return b; },
        gte(col, val) { ops.filters.push({ col, op: "gte", val }); return b; },
        in(col, val) { ops.filters.push({ col, op: "in", val }); return b; },
        ilike(col, val) { ops.filters.push({ col, op: "ilike", val }); return b; },
        order(col, o = {}) { ops.order.push({ col, asc: o.ascending !== false, nullsFirst: o.nullsFirst }); return b; },
        range(a, z) { ops.offset = a; ops.limit = z - a + 1; return b; },
        limit(n) { ops.limit = n; return b; },
        maybeSingle() { single = true; return b; },
        abortSignal() { return b; }, // โหมด hang ตั้งใจไม่สน signal (แย่ที่สุด = ต้องพึ่ง withTimeout ของเราเอง)
        then(resolve, reject) {
          calls?.push(table);
          if (mode === "hang") return new Promise(() => {}).then(resolve, reject);
          if (mode === "down") return Promise.resolve({ data: null, count: null, error: { message: `fake: ${table} ล่ม` } }).then(resolve, reject);
          if (!(table in tables)) return Promise.resolve({ data: null, count: null, error: { message: `fake: ไม่มีตาราง ${table}` } }).then(resolve, reject);
          const { data, count } = applyQuery(tables[table], ops);
          const out = single ? { data: data[0] ?? null, error: null } : { data, count: wantCount ? count : null, error: null };
          return Promise.resolve(out).then(resolve, reject);
        },
      };
      return b;
    },
  });
}

/* getSettings ปลอม (แบบเดียวกับ api/_settings.js: DEFAULTS + แถวในตาราง settings) */
export function fakeGetSettings(tables, defaults, { mode = "ok" } = {}) {
  return async () => {
    if (mode === "hang") return new Promise(() => {});
    if (mode === "down") throw new Error("fake: settings ล่ม");
    const merged = { ...defaults };
    for (const r of tables.settings || []) merged[r.key] = r.value;
    return merged;
  };
}
