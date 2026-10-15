/* public/site.js — ลูกเล่นหน้าบ้าน (progressive enhancement: ไม่มีไฟล์นี้ก็ยังอ่าน/ใช้งานหลักได้ · สเปก docs/WEBSITE-SPEC.md ข้อ 4.5/4.7/4.9)
   5 ต.ค. 69 (developer ตามโจทย์ Hermes — ผลตรวจ code-reviewer):
   - "ตั้งค่าคุกกี้" → เลือก "ใช้เฉพาะที่จำเป็น" = ถอนความยินยอม ต้องเอา iframe Facebook/Maps/YouTube ออกจริง (เดิมแค่เปิดแถบใหม่ iframe ยังค้าง)
   - สไลด์เคารพ prefers-reduced-motion (ไม่เลื่อนเอง) + ปุ่มหยุด/เล่นสลับสถานะ/ไอคอน/ป้ายจริง (เดิมกดแล้วหน้าตาไม่เปลี่ยน · WCAG 2.2.2)
   - เมนูมือถือ: โฟกัสวนในลิ้นชัก + Esc ปิดแล้วโฟกัสกลับปุ่มเมนู (สเปกข้อ 4.5 ข้อ 3) · ปุ่มลอยหลบตอนแถบคุกกี้เปิด (ข้อ 13)
   5 ต.ค. 69 รอบ 2 (ผลตรวจ code-reviewer): lightbox แกลเลอรี + ปุ่มคัดลอกลิงก์ (เดิมมีแต่ markup ไม่มีโค้ด) · ปุ่ม ก ไม่ทำตัวใหญ่ขึ้นแล้ว
   ⛔ ก่อนยินยอม ห้ามมี request ไป facebook.com / google.com / youtube — iframe สร้างที่นี่ที่เดียว หลังผู้ชมยอมรับหรือกดโหลดเอง
   ⛔ localStorage ครอบ try/catch ทุกครั้ง (โหมดส่วนตัว/บล็อกคุกกี้ = ใช้ค่าเริ่มต้น ไม่พัง) */
(() => {
  "use strict";
  const root = document.documentElement;
  root.classList.remove("no-js");
  const qs = (s, p = document) => p.querySelector(s);
  const qsa = (s, p = document) => [...p.querySelectorAll(s)];
  const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const STATS_ID_KEY = "site_stats_browser_v1";
  const clearStatsBrowser = () => { try { localStorage.removeItem(STATS_ID_KEY); } catch {} };
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const isDrawer = () => !window.matchMedia?.("(min-width: 1180px)").matches;

  /* Views are counted once per document, independently of the SSR/CDN cache.
     Only consented browsers get a persistent random ID; no fingerprint/IP/query.
     The document ID deduplicates a consent update without adding another view. */
  let updateSiteStats = () => {};
  const stats = qs("[data-site-stats]");
  if (stats) {
    const ID_KEY = STATS_ID_KEY;
    const uuid = () => { try { return crypto.randomUUID(); } catch { return null; } };
    const viewId = uuid();
    const record = !!viewId && stats.dataset.track === "true" && new URLSearchParams(location.search).get("preview") !== "1";
    let lastSignature = null, queue = Promise.resolve();
    const browserId = () => {
      let allowed = false;
      try { allowed = JSON.parse(safeGet("site_consent_v1"))?.analytics === true; } catch {}
      if (!allowed) { clearStatsBrowser(); return null; }
      let id = safeGet(ID_KEY);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || "")) {
        id = uuid();
        if (!id) return null;
        safeSet(ID_KEY, id);
        if (safeGet(ID_KEY) !== id) return null; // blocked storage: don't invent a new visitor on every page
      }
      return id;
    };
    const requestStats = async (visitorId) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const note = qs("[data-stats-note]", stats);
      try {
        const response = await fetch("/api/site-stats", {
          method: record ? "POST" : "GET", credentials: "omit", cache: "no-store", signal: controller.signal,
          ...(record ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: location.pathname, viewId, visitorId }) } : {}),
        });
        if (response.status === 204) { if (note) note.textContent = "ไม่นับการเข้าชมจากระบบอัตโนมัติ"; return; }
        if (!response.ok) throw new Error("stats unavailable");
        const result = await response.json(), s = result.stats;
        const keys = ["today", "month", "total", "visitors_today", "visitors_month", "visitors_total"];
        if (!result.ok || !s || !keys.every((k) => Number.isSafeInteger(s[k]) && s[k] >= 0) || s.today > s.month || s.month > s.total || s.visitors_today > s.visitors_month || s.visitors_month > s.visitors_total) throw new Error("invalid stats");
        const since = /^\d{4}-\d{2}-\d{2}$/.test(s.since) ? new Date(`${s.since}T00:00:00+07:00`) : null;
        if (!since || !Number.isFinite(since.getTime())) throw new Error("invalid stats date");
        const nf = new Intl.NumberFormat("th-TH");
        for (const key of keys) { const el = qs(`[data-stat="${key}"]`, stats); if (el) el.textContent = nf.format(s[key]); }
        if (note) note.textContent = `เริ่มนับ ${new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" }).format(since)} · เวลาไทย`;
      } catch {
        if (note) note.textContent = "สถิติไม่พร้อมใช้งานชั่วคราว";
      } finally { clearTimeout(timer); }
    };
    updateSiteStats = () => {
      if (document.visibilityState !== "visible" || document.prerendering) return;
      const visitorId = record ? browserId() : null;
      const signature = record ? visitorId || "anonymous" : "read";
      if (signature === lastSignature) return;
      lastSignature = signature;
      // Consent can change while a previous fetch is pending. Read it again at
      // execution time so a queued opt-in never sends an ID after withdrawal.
      queue = queue.then(() => requestStats(record ? browserId() : null));
    };
    document.addEventListener("visibilitychange", updateSiteStats);
    document.addEventListener("prerenderingchange", updateSiteStats);
    updateSiteStats();
  }

  /* ═══ เมนูมือถือ (ลิ้นชัก) ═══ */
  const nav = qs("#site-nav"), toggle = qs(".nav-toggle"), close = qs(".nav-close");
  toggle?.removeAttribute("hidden");
  qsa("[data-a11y]").forEach((x) => { x.hidden = false; });
  const navOpen = () => nav?.classList.contains("is-open");
  const setNav = (on) => {
    if (!nav) return;
    nav.classList.toggle("is-open", on);
    toggle?.setAttribute("aria-expanded", String(on));
    close?.toggleAttribute("hidden", !on);
    if (on) close?.focus(); else toggle?.focus();
  };
  toggle?.addEventListener("click", () => setNav(!navOpen()));
  close?.addEventListener("click", () => setNav(false));
  nav?.addEventListener("click", (e) => { if (navOpen() && e.target.closest("a")) setNav(false); });
  document.addEventListener("keydown", (e) => {
    if (!navOpen() || !isDrawer()) return;
    if (e.key === "Escape") { setNav(false); return; }
    if (e.key !== "Tab") return;
    const items = qsa("a[href], button:not([hidden])", nav).filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ═══ ขนาดตัวอักษร 3 ระดับ (0=16px · 1=18px · 2=20px) + คอนทราสต์สูง (จำค่าในเบราว์เซอร์) ═══
     5 ต.ค. 69 (ผลตรวจ code-reviewer minor 1): เดิมสูตร data-fs + 1 → ปุ่ม "ก" (ขนาดปกติ) กลับทำให้ตัวใหญ่ขึ้นเป็น 18px
     ตอนนี้ตรงป้าย aria: ก- = ลดทีละขั้น · ก = กลับขนาดปกติ (16px) · ก+ = เพิ่มทีละขั้น (เพดาน 16–20px)
     ค่าที่จำไว้แบบเดิมเป็น 0/1/2 เหมือนกัน (ใช้ต่อได้) · ค่าเสีย/อ่านไม่ได้ = ขนาดปกติ */
  let size = Number(safeGet("site_font_size") || 0);
  if (![0, 1, 2].includes(size)) size = 0;
  let contrast = safeGet("site_contrast") === "1";
  const contrastBtn = qs("[data-contrast]");
  const applyPrefs = () => {
    root.classList.toggle("text-large", size === 1);
    root.classList.toggle("text-xlarge", size === 2);
    root.classList.toggle("high-contrast", contrast);
    contrastBtn?.setAttribute("aria-pressed", String(contrast));
  };
  applyPrefs();
  qsa("[data-fs]").forEach((b) => b.addEventListener("click", () => {
    const step = Number(b.dataset.fs);
    size = step === 0 ? 0 : Math.max(0, Math.min(2, size + (step < 0 ? -1 : 1)));
    safeSet("site_font_size", String(size));
    applyPrefs();
  }));
  contrastBtn?.addEventListener("click", () => { contrast = !contrast; safeSet("site_contrast", contrast ? "1" : "0"); applyPrefs(); });

  /* ═══ ความยินยอม + เนื้อหาภายนอก (PDPA สเปกข้อ 4.7) ═══ */
  const KEY = "site_consent_v1";
  let consent = null;
  try { consent = JSON.parse(safeGet(KEY)); } catch {}
  const bar = qs("#consent");
  const showBar = (on) => {
    if (!bar) return;
    bar.hidden = !on;
    root.classList.toggle("has-consent", on);
  };
  const embed = (el) => {
    if (el.dataset.loaded) return;
    let src = el.dataset.src;
    if (el.dataset.embed === "facebook") src = `https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(el.dataset.href)}&tabs=timeline&width=500&height=600&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=false`;
    if (el.dataset.embed === "youtube") src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(el.dataset.id)}`;
    if (!src) return;
    const f = document.createElement("iframe");
    f.src = src; f.title = el.dataset.title || "เนื้อหาภายนอก"; f.loading = "lazy";
    f.referrerPolicy = "strict-origin-when-cross-origin"; f.allowFullscreen = true;
    el.phNodes = [...el.childNodes]; // เก็บกล่องรอยินยอมไว้คืนตอนถอนความยินยอม
    el.replaceChildren(f);
    el.dataset.loaded = "1";
  };
  const unload = (el) => {
    if (!el.dataset.loaded) return;
    el.replaceChildren(...(el.phNodes || []));
    delete el.dataset.loaded;
  };
  const applyConsent = () => {
    const external = consent?.external === true;
    qsa("[data-embed]").forEach((el) => {
      const b = qs("[data-embed-load]", el);
      if (b) { b.hidden = false; b.onclick = () => embed(el); }
      if (external) embed(el); else unload(el);
    });
    showBar(!consent);
  };
  qsa("[data-consent]").forEach((b) => b.addEventListener("click", () => {
    consent = { external: b.dataset.consent === "all", analytics: ["all", "stats"].includes(b.dataset.consent), at: new Date().toISOString() };
    safeSet(KEY, JSON.stringify(consent));
    if (!consent.analytics) clearStatsBrowser();
    applyConsent();
    updateSiteStats();
  }));
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    try { consent = JSON.parse(event.newValue); } catch { consent = null; }
    if (consent?.analytics !== true) clearStatsBrowser();
    applyConsent();
    updateSiteStats();
  });
  qsa("[data-cookie-settings]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    showBar(true);
    qs("[data-consent]", bar)?.focus();
  }));
  applyConsent();

  /* ═══ แท็บ (ข่าว / เพจ Facebook) — ไม่มี JS = ลิงก์ธรรมดา ═══ */
  qsa("[data-tabs]").forEach((tabsRoot) => qsa("[data-tab]", tabsRoot).forEach((tab) => tab.addEventListener("click", (e) => {
    e.preventDefault();
    qsa("[data-tab]", tabsRoot).forEach((x) => x.removeAttribute("aria-current"));
    qsa("[data-panel]", tabsRoot).forEach((x) => { if (x.closest("[data-tabs]") === tabsRoot) x.hidden = true; });
    tab.setAttribute("aria-current", "true");
    const p = qs(`#${CSS.escape(tab.dataset.tab)}`);
    if (p) p.hidden = false;
  })));

  /* ═══ สไลด์แบนเนอร์: เลื่อนเอง 6 วิ · หยุด/เล่น · จุด · ลูกศร · ปัด · reduced-motion = ไม่เลื่อนเอง ═══ */
  qsa("[data-carousel]").forEach((hero) => {
    const track = qs(".hero-track", hero), slides = qsa(".slide", hero), controls = qs(".hero-controls", hero);
    if (!track || slides.length < 2 || !controls) return;
    controls.hidden = false;
    const pauseBtn = qs("[data-pause]", hero);
    let i = 0;
    let paused = reduceMotion; // ผู้ใช้ขอลดการเคลื่อนไหว = เริ่มแบบหยุด (กดเล่นเองได้)
    let hold = false; // ชี้เมาส์/โฟกัสอยู่ในสไลด์ = พักชั่วคราว
    const go = (n) => {
      i = (n + slides.length) % slides.length;
      track.style.transform = `translateX(${-100 * i}%)`;
      slides.forEach((s, j) => { s.setAttribute("aria-hidden", String(i !== j)); qsa("a", s).forEach((a) => { a.tabIndex = i === j ? 0 : -1; }); });
      qsa(".hero-dot", hero).forEach((d, j) => { d.classList.toggle("is-active", i === j); d.setAttribute("aria-current", i === j ? "true" : "false"); });
    };
    const setPaused = (on) => {
      paused = on;
      hero.classList.toggle("is-paused", on);
      pauseBtn?.setAttribute("aria-label", on ? "เล่นสไลด์อัตโนมัติ" : "หยุดเลื่อนอัตโนมัติ");
      pauseBtn?.setAttribute("aria-pressed", String(on));
    };
    qs("[data-prev]", hero)?.addEventListener("click", () => go(i - 1));
    qs("[data-next]", hero)?.addEventListener("click", () => go(i + 1));
    qsa("[data-go]", hero).forEach((d) => d.addEventListener("click", () => go(Number(d.dataset.go))));
    pauseBtn?.addEventListener("click", () => setPaused(!paused));
    hero.addEventListener("mouseenter", () => { hold = true; });
    hero.addEventListener("mouseleave", () => { hold = false; });
    hero.addEventListener("focusin", () => { hold = true; });
    hero.addEventListener("focusout", () => { hold = false; });
    let x0 = null;
    hero.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 40) go(dx < 0 ? i + 1 : i - 1);
    }, { passive: true });
    setPaused(paused);
    go(0);
    setInterval(() => { if (!paused && !hold && !document.hidden) go(i + 1); }, 6000);
  });

  /* ═══ แกลเลอรีภาพ: lightbox (สเปกข้อ 4.6 "lightbox ใช้แป้นพิมพ์ได้") ═══
     5 ต.ค. 69 (ผลตรวจ code-reviewer major 1): renderer ออก <dialog id="lightbox"> + ปุ่ม data-lb-* ไว้แล้ว แต่ไม่เคยมีโค้ดเปิด (กดรูป = เปิดไฟล์ดิบในแท็บเดิม)
     กดรูป → เปิด dialog · ปุ่ม/ลูกศรซ้าย-ขวา = เลื่อนภาพ (วนรอบ) · Esc/ปุ่มปิด/แตะพื้นหลัง = ปิด แล้วคืนโฟกัสไปรูปที่กด · ปัดนิ้วซ้าย-ขวาบนมือถือ
     เบราว์เซอร์ไม่มี showModal = ไม่ผูกอะไรเลย ลิงก์เปิดรูปเต็มตามเดิม (progressive enhancement) · กด Ctrl/⌘/กลางเมาส์ = เปิดแท็บใหม่ตามปกติ */
  const lb = qs("#lightbox"), gallery = qs("[data-gallery]");
  if (lb && gallery && typeof lb.showModal === "function") {
    const items = qsa(".gal-item", gallery);
    const lbImg = qs(".lb-img", lb), lbCap = qs(".lb-cap", lb);
    const lbPrev = qs("[data-lb-prev]", lb), lbNext = qs("[data-lb-next]", lb), lbClose = qs("[data-lb-close]", lb);
    let cur = 0, opener = null;
    const show = (n) => {
      cur = (n + items.length) % items.length;
      const a = items[cur], alt = qs("img", a)?.alt || "";
      lbImg.alt = alt;
      lbImg.src = a.href;
      lbCap.textContent = items.length > 1 ? `${alt} (ภาพที่ ${cur + 1} จาก ${items.length})` : alt;
    };
    lbImg.addEventListener("error", () => { if (lb.open) lbCap.textContent = "ขออภัย ไม่สามารถแสดงภาพนี้ได้ กรุณาลองภาพถัดไปหรือลองใหม่ภายหลัง"; });
    const multi = items.length > 1;
    lbPrev.hidden = !multi; lbNext.hidden = !multi;
    items.forEach((a, i) => a.addEventListener("click", (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      opener = a;
      show(i);
      lb.showModal();
      root.classList.add("lb-open");
      lbClose.focus();
    }));
    lbPrev.addEventListener("click", () => show(cur - 1));
    lbNext.addEventListener("click", () => show(cur + 1));
    lbClose.addEventListener("click", () => lb.close());
    lb.addEventListener("click", (e) => { if (e.target === lb) lb.close(); }); // แตะพื้นหลังมืด (::backdrop) = ปิด
    lb.addEventListener("keydown", (e) => {
      if (!multi) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); show(cur - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); show(cur + 1); }
    });
    lb.addEventListener("close", () => { // Esc ปิดเองโดย dialog แล้วมาถึงตรงนี้เหมือนกัน
      root.classList.remove("lb-open");
      lbImg.removeAttribute("src");
      opener?.focus();
    });
    let lx0 = null;
    lb.addEventListener("touchstart", (e) => { lx0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    lb.addEventListener("touchend", (e) => {
      if (lx0 === null || !multi) return;
      const dx = e.changedTouches[0].clientX - lx0;
      lx0 = null;
      if (Math.abs(dx) > 40) show(dx < 0 ? cur + 1 : cur - 1);
    }, { passive: true });
  }

  /* ═══ ปุ่มคัดลอกลิงก์ (แชร์ในหน้าข่าว) — renderer ส่งมาแบบ hidden · โชว์เฉพาะเบราว์เซอร์ที่คัดลอกได้จริง (HTTPS + Clipboard API) ═══ */
  qsa("[data-copy]").forEach((b) => {
    if (!navigator.clipboard?.writeText || window.isSecureContext === false) return;
    const label = qs("[data-copy-label]", b);
    const original = label?.textContent || "";
    label?.setAttribute("aria-live", "polite");
    let timer = 0;
    b.hidden = false;
    b.addEventListener("click", async () => {
      let msg;
      try { await navigator.clipboard.writeText(b.dataset.copy); msg = "คัดลอกแล้ว"; }
      catch { msg = "คัดลอกไม่สำเร็จ โปรดคัดลอกจากแถบที่อยู่"; }
      if (label) label.textContent = msg;
      clearTimeout(timer);
      timer = setTimeout(() => { if (label) label.textContent = original; }, 2000);
    });
  });

  /* ═══ ปุ่มกลับขึ้นบน: โผล่หลังเลื่อนลงมาแล้ว ═══ */
  const toTop = qs("[data-to-top]");
  if (toTop) {
    const onScroll = () => toTop.classList.toggle("is-visible", window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    toTop.addEventListener("click", (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      qs("#main")?.focus({ preventScroll: true });
    });
  }
})();
