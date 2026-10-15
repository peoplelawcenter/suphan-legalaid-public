/* public/staff-settings.js — หน้า "ตั้งค่า" ของหลังบ้านเจ้าหน้าที่ (7 ต.ค. 69 · แยกออกจาก staff.html)
   บอสสั่งปรับตามภาพต้นแบบ Traffy Fondue: เมนู User (รูป/ชื่อ/User: รหัส) · เปลี่ยนรูปโปรไฟล์ได้ · หน้าตั้งค่าเป็น "เมนูซ้ายกดทีละหัวข้อ"
   (ไม่ซ้อนหัวข้อยาวทั้งหน้าอีก) · หน้า QR Code ของหน่วยงาน

   หัวข้อ: me โปรไฟล์ของฉัน · links บัญชีที่เชื่อม · staff จัดการเจ้าหน้าที่* · center ตั้งค่าศูนย์* · qr QR Code     (* เฉพาะผู้ดูแลระบบ)
   · หัวข้อ * เจ้าหน้าที่ทั่วไปยังเห็นในเมนูแต่เปิดแล้วเป็นการ์ด 🔒 (แบบต้นแบบ) — ⛔ ห้ามถือว่าซ่อนหน้าเว็บ = ปลอดภัย สิทธิ์จริงตรวจที่ api/staff.js ทุก action
   · ห่อด้วย IIFE: เปิดออกมาแค่ window.StaffSettings = { init, show } กันชื่อชนกับสคริปต์ inline ของ staff.html (ตัวแปรระดับบนสุดของ classic script
     ใช้ร่วมกัน ชนชื่อ = SyntaxError ทั้งไฟล์) · ใช้ของ staff.html: api() esc() myRole myStaffId CATEGORY_TH CATEGORY_KEYS — ตอนเรียกใช้จริงเท่านั้น
   · รูปโปรไฟล์: ครอป/ย่อเป็น JPEG 256×256 ในเบราว์เซอร์ → POST action=avatar-set (เซิร์ฟเวอร์ตรวจซ้ำที่ api/_avatar.js) เก็บที่ staff.avatar_data (migration-16) */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ROLE_TH = { admin: "ผู้ดูแลระบบ", staff: "เจ้าหน้าที่" };
  const AVATAR_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
  const LS_COLLAPSE = "legalaid.staffSettings.navCollapsed";

  let me = {};            // ข้อมูลจาก action=me ล่าสุด ({} ถ้าดึงไม่สำเร็จ)
  let current = "me";     // หัวข้อที่เปิดอยู่
  const loaded = {};      // topic → โหลดข้อมูลสำเร็จแล้วหรือยัง (ล้มเหลว = false เพื่อให้เปิดใหม่แล้วลองอีกครั้ง)

  // ───────────────────────── ตัวช่วยทั่วไป ─────────────────────────
  function tryLS(fn) { try { return fn(); } catch { return null; } }   // localStorage อาจใช้ไม่ได้ (โหมดส่วนตัว/ถูกบล็อก) — หน้าต้องทำงานได้เสมอ

  async function callApi(action, opts) {
    try { return await api(action, opts); } catch { return { ok: false, error: "เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่อีกครั้ง" }; }
  }

  let toastTimer = null;
  function toast(msg) {
    let el = $("staffToast");
    if (!el) { el = document.createElement("div"); el.id = "staffToast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // พยัญชนะตัวแรกของชื่อ — ข้ามสระนำหน้า (เ แ โ ใ ไ) เช่น "เสน่ห์" ได้ "ส" ไม่ใช่ "เ"
  function initialOf(name) {
    const chars = Array.from(String(name || "").trim());
    if (!chars.length) return "?";
    const i = chars.findIndex((c) => !/[เแโใไ]/.test(c));
    return (chars[i < 0 ? 0 : i] || "?").toUpperCase();
  }

  // วาดรูป/ตัวอักษรย่อลงวงกลม avatar — ค่ารูปต้องผ่าน AVATAR_RE ก่อนใส่ลง CSS url() (เซิร์ฟเวอร์ตรวจแล้วแต่กันซ้ำที่ปลายทางด้วย)
  function paintAvatar(el, url, name) {
    if (!el) return;
    const ok = typeof url === "string" && AVATAR_RE.test(url);
    el.style.backgroundImage = ok ? `url("${url}")` : "";
    el.classList.toggle("has-img", ok);
    el.textContent = ok ? "" : initialOf(name);
  }

  function displayName() { return (me && me.displayName) || (myRole === "admin" ? "ผู้ดูแลระบบ" : "เจ้าหน้าที่"); }
  function userLine() { return `User: ${myStaffId ?? "—"} · ${ROLE_TH[myRole] || "เจ้าหน้าที่"}`; }

  // เมนู User มุมขวาบน + หัวโปรไฟล์ในหน้าตั้งค่า
  function paintIdentity() {
    const name = displayName();
    for (const id of ["avatarChip", "avatarChipLg", "avatarChipXl"]) paintAvatar($(id), me.avatarUrl, name);
    $("pdName").textContent = name;
    $("pdMeta").textContent = userLine();
    $("pdEmail").textContent = me.email || "";
    $("meName").textContent = name;
    $("meSub").textContent = userLine();
    $("avatarRemoveBtn").hidden = !me.avatarUrl;
  }

  // ───────────────────────── เมนูซ้าย (กดทีละหัวข้อ) ─────────────────────────
  const TOPICS = {
    me:     { admin: false, load: loadMe },
    links:  { admin: false, load: loadLinks },
    staff:  { admin: true,  load: loadStaffMgmt },
    center: { admin: true,  load: loadCenter },
    qr:     { admin: false, load: loadQr },
  };

  function show(topic) {
    if (!topic) topic = current;
    if (!TOPICS[topic]) topic = "me";
    current = topic;
    const def = TOPICS[topic];
    const locked = def.admin && myRole !== "admin";

    $$(".sn-item").forEach((b) => {
      const on = b.dataset.topic === topic;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
    // มือถือ: เมนูเป็นแถบเลื่อนแนวนอน — เลื่อนให้ปุ่มที่เลือกอยู่กลางจอ (ไม่ใช้ scrollIntoView เพราะอาจเลื่อนทั้งหน้า)
    const list = $("snList"), active = list.querySelector(".sn-item.active");
    if (active && list.scrollWidth > list.clientWidth) list.scrollLeft = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2;

    $$(".spane").forEach((p) => {
      const on = p.dataset.topic === topic;
      p.hidden = !on;
      if (on && p.hasAttribute("data-admin")) {
        const lock = p.querySelector(".locked-card"), body = p.querySelector(".pane-body");
        if (lock) lock.hidden = !locked;
        if (body) body.hidden = locked;
      }
    });

    if (!locked && !loaded[topic]) {
      loaded[topic] = true;
      Promise.resolve().then(def.load).then((okLoad) => { if (okLoad === false) loaded[topic] = false; }, () => { loaded[topic] = false; });
    }
  }

  function initNav() {
    $$(".sn-item").forEach((b) => {
      b.title = b.querySelector(".sn-label")?.textContent || "";   // ตอนเมนูย่อเหลือแต่ไอคอน ต้องยังรู้ว่าปุ่มไหนคืออะไร
      b.onclick = () => show(b.dataset.topic);
    });
    $$(".sn-item[data-admin] .sn-lock").forEach((el) => { el.hidden = myRole === "admin"; });

    const wrap = $("settings"), btn = $("snCollapse");
    const apply = (collapsed) => {
      wrap.classList.toggle("collapsed", collapsed);
      btn.textContent = collapsed ? "»" : "«";
      btn.setAttribute("aria-expanded", String(!collapsed));
      btn.setAttribute("aria-label", collapsed ? "ขยายเมนูตั้งค่า" : "ย่อเมนูตั้งค่า");
    };
    let collapsed = tryLS(() => localStorage.getItem(LS_COLLAPSE)) === "1";
    apply(collapsed);
    btn.onclick = () => { collapsed = !collapsed; apply(collapsed); tryLS(() => localStorage.setItem(LS_COLLAPSE, collapsed ? "1" : "0")); };
  }

  // ───────────────────────── ① โปรไฟล์ของฉัน ─────────────────────────
  // ดีไซน์ปรับใช้จากหน้าโปรไฟล์ Traffy Fondue — ลำดับขั้น "ยืนยันอีเมล → ผู้ดูแลระบบอนุมัติ → กรอกข้อมูลติดต่อ" แทน "ยืนยัน ThaiID → OTP เบอร์ → บันทึก"
  // (2 ขั้นแรกครบเสมอถ้าเข้าหน้านี้ได้ เพราะระบบล็อกอินบังคับก่อนออก session — ขั้นที่ 3 เท่านั้นที่เป็นตัวบอกสถานะจริง)
  async function loadMe() {
    const r = await callApi("me");
    if (!r.ok) return false;
    me = r;
    renderIdentity(r);
    paintIdentity();
    return true;
  }

  function renderIdentity(m) {
    const steps = [
      { label: "ยืนยันอีเมลแล้ว", done: !!m.emailVerified },
      { label: "ผู้ดูแลระบบอนุมัติแล้ว", done: !!m.approved },
      { label: "กรอกข้อมูลติดต่อครบถ้วนแล้ว", done: !!m.position && !!m.phone },
    ];
    $("verifySteps").innerHTML = steps.map((s, i) => `
      <div class="verify-step ${s.done ? "done" : ""}">
        <span class="verify-dot">${s.done ? "✓" : i + 1}</span>
        <span>${esc(s.label)}</span>
      </div>`).join("");
    const allDone = steps.every((s) => s.done);
    $("verifyBanner").innerHTML = allDone
      ? `<div class="verify-banner ok">✅ ยืนยันตัวตนสำเร็จ — ใช้อีเมลที่ยืนยันแล้วเป็นข้อมูลยืนยันตัวตนหลัก</div>`
      : `<div class="verify-banner pending">กรุณากรอกข้อมูลให้ครบตามขั้นตอนด้านบน</div>`;
    $("fieldName").textContent = "🔒 " + (m.displayName || "—");
    $("fieldEmail").textContent = "🔒 " + (m.email || "—") + (m.emailVerified ? "  ✓ ยืนยันแล้ว" : "");
    $("fieldPhone").value = m.phone || "";
    $("fieldPosition").value = m.position || "";
  }

  async function saveProfile() {
    const position = $("fieldPosition").value.trim();
    const phone = $("fieldPhone").value.trim();
    if (!phone) return alert("กรุณากรอกเบอร์โทรศัพท์");
    if (!position) return alert("กรุณากรอกตำแหน่งในหน่วยงาน");
    const btn = $("saveProfileBtn");
    btn.disabled = true;
    const r = await callApi("update-profile", { method: "POST", body: { position, phone } });
    btn.disabled = false;
    if (!r.ok) return alert(r.error || "บันทึกไม่สำเร็จ");
    await loadMe();
    toast("บันทึกข้อมูลแล้ว");
  }

  // ───────────── รูปโปรไฟล์: เลือกไฟล์ → หน้าต่างลาก/ซูม → ย่อเป็น JPEG 256×256 → ส่งเซิร์ฟเวอร์ ─────────────
  const CROP = { view: 320, out: 256, img: null, url: null, zoom: 1, panX: 0, panY: 0, drag: null, opener: null };
  const CLIENT_MAX_CHARS = 100000;   // ≈ 73 KB หลัง base64 — ต่ำกว่าเพดานเซิร์ฟเวอร์ 80 KB (api/_avatar.js) เสมอ

  function initAvatar() {
    const file = $("avatarFile");
    const pick = (e) => { CROP.opener = e.currentTarget; file.click(); };
    $("avatarEditBtn").onclick = pick;
    $("avatarChangeBtn").onclick = pick;
    file.onchange = () => { const f = file.files && file.files[0]; file.value = ""; if (f) openCropper(f); };

    $("avatarRemoveBtn").onclick = async () => {
      if (!confirm("ลบรูปโปรไฟล์? ระบบจะกลับไปแสดงตัวอักษรย่อของชื่อแทน")) return;
      const r = await callApi("avatar-clear", { method: "POST" });
      if (!r.ok) return alert(r.error || "ลบรูปไม่สำเร็จ");
      me.avatarUrl = null;
      paintIdentity();
      toast("ลบรูปโปรไฟล์แล้ว");
    };

    const stage = $("avStage");
    stage.addEventListener("pointerdown", (e) => {
      if (!CROP.img) return;
      stage.setPointerCapture(e.pointerId);
      CROP.drag = { x: e.clientX, y: e.clientY, px: CROP.panX, py: CROP.panY };
      stage.classList.add("dragging");
    });
    stage.addEventListener("pointermove", (e) => {
      if (!CROP.drag) return;
      const k = CROP.view / stage.getBoundingClientRect().width;   // จอจริงอาจเล็กกว่า 320px (มือถือ) — แปลงเป็นหน่วยแคนวาส
      CROP.panX = CROP.drag.px + (e.clientX - CROP.drag.x) * k;
      CROP.panY = CROP.drag.py + (e.clientY - CROP.drag.y) * k;
      drawCrop();
    });
    const endDrag = () => { CROP.drag = null; stage.classList.remove("dragging"); };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    stage.addEventListener("wheel", (e) => {
      if (!CROP.img) return;
      e.preventDefault();
      setZoom(CROP.zoom + (e.deltaY < 0 ? 0.08 : -0.08));
    }, { passive: false });
    stage.addEventListener("keydown", (e) => {
      const step = 12, d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (!d || !CROP.img) return;
      e.preventDefault();
      CROP.panX += d[0]; CROP.panY += d[1];
      drawCrop();
    });
    $("avZoom").oninput = (e) => setZoom(Number(e.target.value));
    $("avCancel").onclick = closeCropper;
    $("avSave").onclick = saveCrop;
    // ผูกที่ document (ไม่ใช่ตัวหน้าต่าง): ปุ่มที่ถูก disable ระหว่างบันทึกทำให้โฟกัสหลุดไปที่ body — ถ้าผูกกับหน้าต่างจะกด Esc ไม่ได้อีก
    document.addEventListener("keydown", (e) => {
      const modal = $("avatarModal");
      if (modal.hidden) return;
      if (e.key === "Escape") { e.preventDefault(); closeCropper(); return; }
      if (e.key !== "Tab") return;
      const f = ["avStage", "avZoom", "avCancel", "avSave"].map($).filter((el) => el && !el.disabled);   // วนโฟกัสอยู่ในหน้าต่างเท่านั้น
      const first = f[0], last = f[f.length - 1];
      if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function openCropper(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return alert("กรุณาเลือกไฟล์ภาพ JPG, PNG หรือ WebP");
    if (file.size > 15 * 1024 * 1024) return alert("ไฟล์ภาพใหญ่เกิน 15 MB กรุณาเลือกรูปที่เล็กกว่านี้");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (Math.min(img.naturalWidth, img.naturalHeight) < 64) { URL.revokeObjectURL(url); return alert("รูปเล็กเกินไป (ด้านสั้นต้องอย่างน้อย 64 พิกเซล) กรุณาเลือกรูปอื่น"); }
      CROP.img = img; CROP.url = url; CROP.zoom = 1; CROP.panX = 0; CROP.panY = 0;
      $("avZoom").value = "1";
      $("avatarModal").hidden = false;
      document.body.style.overflow = "hidden";
      drawCrop();
      $("avStage").focus();
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert("อ่านไฟล์ภาพนี้ไม่ได้ กรุณาลองไฟล์อื่น"); };
    img.src = url;
  }

  function closeCropper() {
    $("avatarModal").hidden = true;
    document.body.style.overflow = "";
    if (CROP.url) URL.revokeObjectURL(CROP.url);
    CROP.img = null; CROP.url = null; CROP.drag = null;
    if (CROP.opener && CROP.opener.focus) CROP.opener.focus();
  }

  function setZoom(z) {
    CROP.zoom = Math.min(3, Math.max(1, z));
    $("avZoom").value = String(CROP.zoom);
    drawCrop();
  }

  // ตำแหน่ง/ขนาดรูปในกรอบ — ซูม 1 = รูปคลุมกรอบพอดีด้านสั้น · ลาก/ซูมแล้วต้องไม่เห็นพื้นว่างในกรอบ (หนีบ pan ให้อยู่ในช่วงเสมอ)
  function cropGeometry() {
    const img = CROP.img, V = CROP.view;
    const s = (V / Math.min(img.naturalWidth, img.naturalHeight)) * CROP.zoom;
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    const maxX = Math.max(0, (w - V) / 2), maxY = Math.max(0, (h - V) / 2);
    CROP.panX = Math.min(maxX, Math.max(-maxX, CROP.panX));
    CROP.panY = Math.min(maxY, Math.max(-maxY, CROP.panY));
    return { w, h, x: (V - w) / 2 + CROP.panX, y: (V - h) / 2 + CROP.panY };
  }

  function drawCrop() {
    if (!CROP.img) return;
    const c = $("avCanvas"), g = c.getContext("2d"), geo = cropGeometry();
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(CROP.img, geo.x, geo.y, geo.w, geo.h);
  }

  function renderCropOutput() {
    const out = document.createElement("canvas");
    out.width = out.height = CROP.out;
    const g = out.getContext("2d"), geo = cropGeometry(), k = CROP.out / CROP.view;
    g.fillStyle = "#fff"; g.fillRect(0, 0, out.width, out.height);   // PNG โปร่งใส → พื้นขาว (JPEG ไม่มีช่องโปร่งใส)
    g.imageSmoothingQuality = "high";
    g.drawImage(CROP.img, geo.x * k, geo.y * k, geo.w * k, geo.h * k);
    for (const q of [0.88, 0.8, 0.7, 0.6]) {
      const d = out.toDataURL("image/jpeg", q);
      if (d.length <= CLIENT_MAX_CHARS) return d;
    }
    return null;
  }

  async function saveCrop() {
    if (!CROP.img) return;
    const dataUrl = renderCropOutput();
    if (!dataUrl) return alert("ย่อรูปไม่สำเร็จ กรุณาเลือกรูปอื่น");
    const btn = $("avSave");
    btn.disabled = true; btn.textContent = "กำลังบันทึก...";
    const r = await callApi("avatar-set", { method: "POST", body: { dataUrl } });
    btn.disabled = false; btn.textContent = "บันทึกรูป";
    btn.focus();   // ปุ่มที่ถูก disable ทำให้โฟกัสหลุด — คืนให้ปุ่มเดิม (ผู้ใช้ลองกดซ้ำ/กด Esc ต่อได้)
    if (!r.ok) return alert(r.error || "บันทึกรูปไม่สำเร็จ");
    me.avatarUrl = r.avatarUrl;
    paintIdentity();
    closeCropper();
    toast("เปลี่ยนรูปโปรไฟล์แล้ว");
  }

  // ───────────────────────── ② บัญชีที่เชื่อม ─────────────────────────
  async function loadLinks() {
    showOauthLinkResult();   // อ่านผล ?linked=/&linkerror= จากตอนเด้งกลับจาก oauth-callback (ดู api/staff-auth.js)
    const r = await callApi("me");   // ดึงสดเสมอ — ไม่ใช้ activeStaffList (scope=active ไม่ส่งสถานะการเชื่อมบัญชีมาให้)
    if (!r.ok) {
      ["lineStatus", "googleStatus", "facebookStatus"].forEach((id) => { $(id).innerHTML = `<div class="lr-text"><div class="lr-desc">โหลดสถานะไม่สำเร็จ กรุณาเปิดหัวข้อนี้ใหม่อีกครั้ง</div></div>`; });
      return false;
    }
    me = { ...me, ...r };
    renderLineRow(!!r.lineLinked);
    renderOauthRow("google", "Google", "🔵", "เข้าสู่ระบบด้วยบัญชี Google ของท่านได้ทันที ไม่ต้องกรอกรหัสผ่าน", r.googleLinked);
    renderOauthRow("facebook", "Facebook", "🔷", "เข้าสู่ระบบด้วยบัญชี Facebook ของท่านได้ทันที ไม่ต้องกรอกรหัสผ่าน", r.facebookLinked);
    return true;
  }

  function showOauthLinkResult() {
    const p = new URLSearchParams(location.search);
    if (!p.get("linked") && !p.get("linkerror")) return;
    const name = { google: "Google", facebook: "Facebook", line: "LINE" }[p.get("provider") || p.get("linked")] || "บัญชี";
    const msg = p.get("linked") ? `เชื่อมบัญชี ${name} สำเร็จแล้ว` : `เชื่อมบัญชี ${name} ไม่สำเร็จ — บัญชีนี้ถูกเชื่อมกับเจ้าหน้าที่ท่านอื่นไปแล้ว`;
    history.replaceState(null, "", location.pathname + "?tab=settings&topic=links");   // ล้างผล ?linked= แต่คงหัวข้อไว้ (รีเฟรชแล้วไม่หลุดไปแท็บรายการเรื่อง)
    if (p.get("linked")) toast(msg); else alert(msg);
  }

  function linkRowShell(ico, name, desc, linked, actionHtml) {
    return `
      <div class="lr-ico" aria-hidden="true">${ico}</div>
      <div class="lr-text"><div class="lr-name">${esc(name)}</div><div class="lr-desc">${esc(desc)}</div></div>
      <div class="lr-state ${linked ? "on" : ""}">${linked ? "🟢 เชื่อมแล้ว" : "ยังไม่ได้เชื่อม"}</div>
      <div class="lr-action">${actionHtml}</div>`;
  }

  function renderLineRow(linked) {
    const box = $("lineStatus");
    const desc = "รับแจ้งเตือนเรื่องใหม่/เร่งด่วนเสริมทาง LINE และเข้าสู่ระบบด้วย LINE ได้";
    if (linked) {
      box.innerHTML = linkRowShell("💬", "LINE", desc, true, `<button type="button" class="btn small danger" id="unlinkLineBtn">ยกเลิกเชื่อม</button>`);
      $("unlinkLineBtn").onclick = async () => {
        if (!confirm("ยกเลิกเชื่อมบัญชี LINE? ท่านจะไม่ได้รับแจ้งเตือนเสริมทาง LINE อีก (ยังเข้าสู่ระบบด้วยอีเมลได้ปกติ)")) return;
        const r = await callApi("unlink-line", { method: "POST" });
        if (!r.ok) return alert(r.error || "ยกเลิกเชื่อมไม่สำเร็จ");
        loadLinks();
      };
      return;
    }
    box.innerHTML = linkRowShell("💬", "LINE", desc, false, `<button type="button" class="btn small" id="genLinkCodeBtn">🔗 สร้างรหัสเชื่อมบัญชี</button>`)
      + `<div class="lr-extra" id="linkCodeResult" hidden></div>`;
    $("genLinkCodeBtn").onclick = async () => {
      const r = await callApi("link-line-code", { method: "POST" });
      if (!r.ok) return alert(r.error || "สร้างรหัสไม่สำเร็จ");
      const out = $("linkCodeResult");
      out.hidden = false;
      out.innerHTML = `
        <p>เปิด LINE เพิ่มเพื่อน OA ของศูนย์ (ถ้ายังไม่ได้เพิ่ม) แล้วพิมพ์ข้อความนี้ในแชต ภายใน ${esc(r.expiresInMinutes)} นาที:</p>
        <div class="link-code">#เชื่อม ${esc(r.code)}</div>`;
    };
  }

  // Google/Facebook ใช้ปุ่มเดียวกับหน้าล็อกอิน (oauth-start) — เพราะกำลังล็อกอินอยู่แล้ว (มี session cookie)
  // api/staff-auth.js ที่ปลายทางจะรู้เองว่านี่คือ "เชื่อมบัญชีเพิ่ม" ไม่ใช่ "ล็อกอินใหม่" (เช็คจากคุกกี้)
  function renderOauthRow(provider, label, ico, desc, linked) {
    const box = $(provider + "Status");
    if (linked) {
      box.innerHTML = linkRowShell(ico, label, desc, true, `<button type="button" class="btn small danger" id="unlink-${provider}-btn">ยกเลิกเชื่อม</button>`);
      $(`unlink-${provider}-btn`).onclick = async () => {
        if (!confirm(`ยกเลิกเชื่อมบัญชี ${label}? ท่านจะเข้าสู่ระบบผ่านปุ่ม ${label} ไม่ได้อีก (ยังเข้าสู่ระบบด้วยอีเมลได้ปกติ)`)) return;
        const r = await callApi(`unlink-${provider}`, { method: "POST" });
        if (!r.ok) return alert(r.error || "ยกเลิกเชื่อมไม่สำเร็จ");
        loadLinks();
      };
      return;
    }
    box.innerHTML = linkRowShell(ico, label, desc, false, `<a class="btn small" href="/api/staff-auth?action=oauth-start&provider=${provider}">🔗 เชื่อมบัญชี</a>`);
  }

  // ───────────────────────── ③ จัดการเจ้าหน้าที่ (แอดมิน) ─────────────────────────
  let staffSub = null;   // มุมมองที่เลือกอยู่ (null = ยังไม่เคยเลือก → เลือกให้ตามว่ามีคำขอค้างไหม)

  function initStaffSubtabs() {
    $$("#staffSubtabs [data-sub]").forEach((b) => { b.onclick = () => showStaffSub(b.dataset.sub); });
  }

  function showStaffSub(name) {
    staffSub = name;
    $$("#staffSubtabs [data-sub]").forEach((b) => {
      const on = b.dataset.sub === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    $$("#spane-staff .subpane").forEach((p) => { p.hidden = p.dataset.sub !== name; });
  }

  // จำนวนคำขอสมัครที่รออนุมัติ → จุดแดงบนแท็บ "ตั้งค่า" + ตัวเลขบนหัวข้อ + บนชิป (แต่ก่อนแอดมินต้องเปิดแท็บเจ้าหน้าที่เองถึงจะรู้ว่ามีคนสมัคร)
  function setReqCount(n) {
    const has = n > 0;
    $("settingsDot").hidden = !has;
    const badge = $("staffReqBadge"), chip = $("reqCount");
    badge.hidden = !has; badge.textContent = String(n);
    chip.hidden = !has; chip.textContent = String(n);
  }

  async function refreshReqCount() {
    const r = await callApi("staff-requests");
    if (r.ok) setReqCount(r.rows.length);
  }

  async function loadStaffMgmt() {
    const [reqs, list, workload] = await Promise.all([callApi("staff-requests"), callApi("staff-list"), callApi("staff-workload")]);
    if (!reqs.ok && !list.ok) return false;
    const reqRows = reqs.ok ? reqs.rows : [];
    setReqCount(reqRows.length);
    renderStaffRequests(reqRows);
    renderStaffList(list.ok ? list.rows : []);
    renderWorkloadTable(workload.ok ? workload.rows : []);
    if (staffSub === null) showStaffSub(reqRows.length ? "requests" : "list");
    return true;
  }

  function renderWorkloadTable(rows) {
    const table = $("workloadTable"), empty = $("workloadEmpty");
    const withCases = rows.filter((r) => r.total > 0);
    if (!withCases.length) { table.innerHTML = ""; empty.hidden = false; return; }
    empty.hidden = true;
    table.innerHTML = `
      <tr><th>เจ้าหน้าที่</th><th>กำลังดำเนินการ</th><th>ปิดแล้ว</th><th>ทั้งหมด</th></tr>
      ${withCases.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.active)}</td><td>${esc(r.closed)}</td><td>${esc(r.total)}</td></tr>`).join("")}`;
  }

  function renderStaffRequests(rows) {
    const box = $("staffRequests"), empty = $("requestsEmpty");
    if (!rows.length) { box.innerHTML = ""; empty.hidden = false; return; }
    empty.hidden = true;
    box.innerHTML = rows.map((r) => `
      <div class="staff-card">
        <div class="top"><span class="avatar sm" aria-hidden="true">${esc(initialOf(r.display_name))}</span><span class="name">${esc(r.display_name)}</span></div>
        <div class="row2 sub">${esc(r.email)} · ยืนยันอีเมลแล้ว</div>
        <div class="row2">
          <button type="button" class="btn small" data-approve="${esc(r.id)}">✅ อนุมัติ</button>
          <button type="button" class="btn small danger" data-reject="${esc(r.id)}">❌ ปฏิเสธ</button>
        </div>
      </div>`).join("");
    box.querySelectorAll("[data-approve]").forEach((btn) => btn.onclick = async () => {
      const r = await callApi("staff-approve", { method: "POST", body: { id: Number(btn.dataset.approve) } });
      if (!r.ok) return alert(r.error || "อนุมัติไม่สำเร็จ");
      loadStaffMgmt();
    });
    box.querySelectorAll("[data-reject]").forEach((btn) => btn.onclick = async () => {
      if (!confirm("ปฏิเสธคำขอนี้? บัญชีที่สมัครไว้จะถูกลบทิ้ง")) return;
      const r = await callApi("staff-reject", { method: "POST", body: { id: Number(btn.dataset.reject) } });
      if (!r.ok) return alert(r.error || "ปฏิเสธไม่สำเร็จ");
      loadStaffMgmt();
    });
  }

  function renderStaffList(rows) {
    const box = $("staffList");
    box.innerHTML = rows.map((s, i) => `
      <div class="staff-card" data-id="${esc(s.id)}">
        <div class="top">
          <span class="avatar sm" data-av="${i}" aria-hidden="true"></span>
          <span class="name">${esc(s.display_name || "เจ้าหน้าที่ #" + s.id)} ${s.role === "admin" ? "· แอดมิน" : ""}${!s.active ? " · (ถอนสิทธิ์แล้ว)" : ""}${s.line_uid ? " · 🔗 เชื่อม LINE แล้ว" : ""}${s.id === myStaffId ? " · (คุณ)" : ""}</span>
        </div>
        <div class="row2">
          <label><input type="checkbox" data-field="notify_line" ${s.notify_line ? "checked" : ""}> แจ้งไลน์</label>
          <label><input type="checkbox" data-field="notify_email" ${s.notify_email ? "checked" : ""}> แจ้งอีเมล</label>
          <label><input type="checkbox" data-field="can_edit_site" ${s.can_edit_site ? "checked" : ""}> ผู้ดูแลเว็บไซต์</label>
          <input type="email" class="staff-email" data-field="email" placeholder="อีเมล (ใช้เข้าสู่ระบบด้วย)" value="${esc(s.email || "")}">
        </div>
        <div class="row2 cat-row">
          <span class="cat-row-label">รับแจ้งเตือนหมวด:</span>
          ${CATEGORY_KEYS.map((k2) => `<label><input type="checkbox" data-cat="${esc(k2)}" ${(!s.notify_categories || !s.notify_categories.length || s.notify_categories.includes(k2)) ? "checked" : ""}> ${esc(CATEGORY_TH[k2])}</label>`).join("")}
        </div>
        <div class="row2">
          <button type="button" class="btn small" data-save>💾 บันทึก</button>
          ${s.id === myStaffId ? "" : `<button type="button" class="btn small danger" data-revoke>${s.active ? "ถอนสิทธิ์" : "คืนสิทธิ์"}</button>`}
        </div>
      </div>`).join("");

    // รูปโปรไฟล์ใส่หลังสร้าง DOM (ไม่ฝังข้อมูลรูปขนาดหลายสิบ KB ลงสตริง HTML)
    rows.forEach((s, i) => paintAvatar(box.querySelector(`[data-av="${i}"]`), s.avatar_url, s.display_name));

    box.querySelectorAll(".staff-card").forEach((card) => {
      const id = Number(card.dataset.id);
      card.querySelector("[data-save]").onclick = async () => {
        // แจ้งเตือนเฉพาะหมวด (แนวคิดจาก Traffy Fondue เพิ่ม 17 ก.ย. 69) — เลือกครบทุกหมวด = ส่ง null
        // (หมายถึง "รับทุกหมวด" ไม่ต้องกรอง ดู notifiableStaff() ใน _staffauth.js) ไม่เลือกเลย = เตือนไม่ให้บันทึก
        const checkedCats = Array.from(card.querySelectorAll("[data-cat]")).filter((cb) => cb.checked).map((cb) => cb.dataset.cat);
        if (!checkedCats.length) return alert("กรุณาเลือกอย่างน้อย 1 หมวด หรือเลือกให้ครบทุกหมวดเพื่อรับแจ้งเตือนทุกหมวด");
        const patch = {
          notify_line: card.querySelector('[data-field="notify_line"]').checked,
          notify_email: card.querySelector('[data-field="notify_email"]').checked,
          can_edit_site: card.querySelector('[data-field="can_edit_site"]').checked,
          email: card.querySelector('[data-field="email"]').value.trim() || null,
          notify_categories: checkedCats.length === CATEGORY_KEYS.length ? null : checkedCats,
        };
        const r = await callApi("staff-update", { method: "POST", body: { id, patch } });
        if (!r.ok) return alert(r.error || "บันทึกไม่สำเร็จ");
        toast("บันทึกแล้ว");
      };
      const revokeBtn = card.querySelector("[data-revoke]");
      if (revokeBtn) revokeBtn.onclick = async () => {
        const wasActive = revokeBtn.textContent.includes("ถอนสิทธิ์");
        if (!confirm(wasActive ? "ถอนสิทธิ์เจ้าหน้าที่ท่านนี้?" : "คืนสิทธิ์เจ้าหน้าที่ท่านนี้?")) return;
        const r = await callApi("staff-update", { method: "POST", body: { id, patch: { active: !wasActive } } });
        if (!r.ok) return alert(r.error || "ทำรายการไม่สำเร็จ");
        loadStaffMgmt();
      };
    });
  }

  // ───────────────────────── ④ ตั้งค่าศูนย์ (แอดมิน) ─────────────────────────
  async function loadCenter() {
    const d = await callApi("settings-get");
    if (!d.ok) { $("settingsForm").innerHTML = `<p class="empty-hint">โหลดการตั้งค่าไม่สำเร็จ กรุณาเปิดหัวข้อนี้ใหม่อีกครั้ง</p>`; return false; }
    renderSettingsForm(d.settings);
    return true;
  }

  function renderSettingsForm(s) {
    const box = $("settingsForm");
    box.innerHTML = `
      <div class="field-row">
        <div class="field-group"><label for="setStart">เวลาทำการ เริ่ม</label><input type="text" id="setStart" value="${esc(s.office_hours.start)}" placeholder="08:30"></div>
        <div class="field-group"><label for="setEnd">เวลาทำการ สิ้นสุด</label><input type="text" id="setEnd" value="${esc(s.office_hours.end)}" placeholder="16:30"></div>
      </div>
      <div class="field-group"><label for="setPhone">เบอร์โทรติดต่อ</label><input type="text" id="setPhone" value="${esc(s.phone)}"></div>
      <div class="field-group"><label for="setResponder">คำเรียกผู้ตอบ (แสดงในการ์ดต่างๆ)</label><input type="text" id="setResponder" value="${esc(s.responder_label)}"></div>
      <div class="checkbox-row"><input type="checkbox" id="setAppt" ${s.appointment_enabled ? "checked" : ""}><label for="setAppt">เปิดปุ่มจองคิวทนายอาสา</label></div>
      <button type="button" class="btn primary" id="saveSettingsBtn">บันทึกการตั้งค่า</button>`;
    $("saveSettingsBtn").onclick = async () => {
      const patch = {
        office_hours: { ...s.office_hours, start: $("setStart").value.trim(), end: $("setEnd").value.trim() },
        phone: $("setPhone").value.trim(),
        responder_label: $("setResponder").value.trim(),
        appointment_enabled: $("setAppt").checked,
      };
      const r = await callApi("settings-update", { method: "POST", body: { patch } });
      if (!r.ok) return alert(r.error || "บันทึกไม่สำเร็จ");
      renderSettingsForm(r.settings);
      toast("บันทึกการตั้งค่าแล้ว");
    };
  }

  // ───────────────────────── ⑤ QR Code ─────────────────────────
  // QR สำเร็จรูป 3 ใบ สร้างในเบราว์เซอร์จากลิงก์กลาง (action=qr-config → SITE_URL + LINE OA ของศูนย์) — ย้ายโดเมนแล้ว QR ตามเอง
  // "มีกรอบ" = โปสเตอร์ 1080×1560 (หัวโลโก้คู่ + ข้อความ + QR) พิมพ์ติดป้ายได้ · "ไม่มีกรอบ" = QR ล้วนพื้นขาว มีขอบเงียบ 4 โมดูลตามมาตรฐาน
  // ⛔ ข้อความบนโปสเตอร์ห้ามเติมคำสัญญาที่ไม่มีในเอกสารทางการ (เช่น "ฟรี") — ใช้เฉพาะข้อเท็จจริงของระบบ
  const QR_INK = "#0B2E6D", NAVY = "#0B2E6D", NAVY_DARK = "#082158", GOLD = "#D9A93B";
  const FRAME_W = 1080, FRAME_H = 1560;
  let qrCfg = null, qrItems = [], qrFramed = true;
  const qrCache = new Map();     // `${id}:${1|0}` → { url (blob), blob }
  const imgCache = {};

  function loadImg(src) {
    return imgCache[src] || (imgCache[src] = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
  }

  async function ensureQrFonts() {
    // ฟอนต์ Prompt โฮสต์เอง (fonts.css) โหลดตามช่วงตัวอักษรที่ใช้จริง — แคนวาสไม่ทริกเกอร์เอง ต้องสั่งโหลดก่อนวาด ไม่งั้นได้ฟอนต์สำรอง
    try {
      await Promise.all(["500", "600", "700", "800"].flatMap((w) => [
        document.fonts.load(`${w} 40px Prompt`, "ศูนย์ช่วยเหลือประชาชน"),
        document.fonts.load(`${w} 40px Prompt`, "LINE @073kbdgu abc"),
      ]));
    } catch { /* ใช้ฟอนต์สำรองต่อได้ — QR ยังสแกนได้ปกติ */ }
  }

  function makeQr(text) {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr;
  }

  function drawModules(g, qr, x, y, cell) {
    const n = qr.getModuleCount();
    g.fillStyle = QR_INK;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(x + c * cell, y + r * cell, cell, cell);
  }

  function toBlob(canvas) { return new Promise((res) => canvas.toBlob(res, "image/png")); }

  async function renderPlain(item) {
    const qr = makeQr(item.url), n = qr.getModuleCount(), quiet = 4;
    const cell = Math.max(8, Math.ceil(1000 / (n + quiet * 2)));
    const size = cell * (n + quiet * 2);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, size, size);
    drawModules(g, qr, cell * quiet, cell * quiet, cell);
    return toBlob(c);
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // ลดขนาดตัวอักษรจนพอดีความกว้าง (ไม่ตัดบรรทัดเอง — ข้อความไทยไม่มีช่องว่างให้ตัดคำ ใช้ย่อขนาดแทนเพื่อให้ผลคงที่)
  function drawFitted(g, text, cx, cy, weight, size, maxW, color) {
    let s = size;
    for (; s > 22; s -= 2) { g.font = `${weight} ${s}px Prompt, Sarabun, sans-serif`; if (g.measureText(text).width <= maxW) break; }
    g.font = `${weight} ${s}px Prompt, Sarabun, sans-serif`;
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, cx, cy);
  }

  function drawLogo(g, img, cx, cy, d) {
    g.save();
    g.beginPath(); g.arc(cx, cy, d / 2 + 7, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill();
    g.beginPath(); g.arc(cx, cy, d / 2, 0, Math.PI * 2); g.clip();
    const r = Math.min(d / img.naturalWidth, d / img.naturalHeight) * 0.94;
    const w = img.naturalWidth * r, h = img.naturalHeight * r;
    g.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    g.restore();
  }

  async function renderFramed(item) {
    const [pao, council] = await Promise.all([loadImg("/assets/logo-pao.png"), loadImg("/assets/logo-lawyers-council-sm.png")]);
    const c = document.createElement("canvas");
    c.width = FRAME_W; c.height = FRAME_H;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, FRAME_W, FRAME_H);

    // หัวสีกรม + แถบทอง + โลโก้คู่ (อบจ. + สภาทนายความ — ศูนย์เป็นงานร่วม 2 หน่วยงาน)
    const grad = g.createLinearGradient(0, 0, FRAME_W, 380);
    grad.addColorStop(0, NAVY); grad.addColorStop(1, NAVY_DARK);
    g.fillStyle = grad; g.fillRect(0, 0, FRAME_W, 380);
    g.fillStyle = GOLD; g.fillRect(0, 380, FRAME_W, 14);
    const logos = [pao, council].filter(Boolean);
    logos.forEach((img, i) => drawLogo(g, img, FRAME_W / 2 + (i - (logos.length - 1) / 2) * 190, 108, 140));
    drawFitted(g, "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย", FRAME_W / 2, 252, "800", 58, 960, "#fff");
    drawFitted(g, "สภาทนายความจังหวัดสุพรรณบุรี ร่วมกับ อบจ.สุพรรณบุรี", FRAME_W / 2, 316, "500", 31, 960, "#cdd9ef");

    // หัวข้อของ QR ใบนี้
    drawFitted(g, item.frame.title[0], FRAME_W / 2, 500, "800", 80, 940, NAVY);
    drawFitted(g, item.frame.title[1], FRAME_W / 2, 590, "600", 50, 940, "#3d4a61");

    // กล่อง QR
    const bx = (FRAME_W - 720) / 2, by = 670;
    g.save();
    g.shadowColor = "rgba(11,46,109,0.22)"; g.shadowBlur = 36; g.shadowOffsetY = 12;
    roundRect(g, bx, by, 720, 720, 44); g.fillStyle = "#fff"; g.fill();
    g.restore();
    roundRect(g, bx, by, 720, 720, 44); g.lineWidth = 12; g.strokeStyle = NAVY; g.stroke();
    const qr = makeQr(item.url), n = qr.getModuleCount();
    const cell = Math.floor(560 / n), qrSize = cell * n;   // 560 (ไม่ใช่ 600) → ขอบขาวรอบ QR ≥ 4 โมดูลทุกขนาด (ผู้ตรวจวัดได้ 3.2 ที่ 600)
    drawModules(g, qr, bx + (720 - qrSize) / 2, by + (720 - qrSize) / 2, cell);

    // คำอธิบายใต้ QR + แถบท้าย
    drawFitted(g, item.frame.caption, FRAME_W / 2, 1450, "700", 48, 940, NAVY);
    g.fillStyle = NAVY; g.fillRect(0, 1490, FRAME_W, 70);
    g.fillStyle = GOLD; g.fillRect(0, 1490, FRAME_W, 8);
    drawFitted(g, item.frame.note, FRAME_W / 2, 1528, "500", 30, 980, "#fff");
    return toBlob(c);
  }

  // แคชเก็บ "Promise" (ไม่ใช่ผลลัพธ์) — เรียกพร้อมกันด้วย key เดียวกันได้ภาพเดียว ไม่เรนเดอร์ซ้ำ/ไม่สร้าง blob URL ทิ้งไว้ · เรนเดอร์พัง = เอาออกจากแคชให้ลองใหม่ได้
  function qrImage(item, framed) {
    const key = `${item.id}:${framed ? 1 : 0}`;
    if (!qrCache.has(key)) {
      qrCache.set(key, (async () => {
        const blob = await (framed ? renderFramed(item) : renderPlain(item));
        return { blob, url: URL.createObjectURL(blob) };
      })().catch((e) => { qrCache.delete(key); throw e; }));
    }
    return qrCache.get(key);
  }

  function buildQrItems(cfg) {
    let host = cfg.siteUrl;
    try { host = new URL(cfg.siteUrl).host; } catch { /* ใช้ค่าเดิม */ }
    return [
      {
        id: "line", file: "qr-line-oa", badge: "ประชาชน", badgeCls: "b-blue", url: cfg.lineOaUrl,
        name: "QR เพิ่มเพื่อน LINE OA",
        desc: "ให้ประชาชนสแกนเพื่อเพิ่มเพื่อน LINE ของศูนย์ แล้วแจ้งเรื่อง ปรึกษา หรือจองคิวผ่านแชต",
        frame: { title: ["สแกนเพื่อเพิ่มเพื่อน LINE", "แจ้งเรื่อง · ปรึกษา · จองคิว"], caption: `LINE OA ${cfg.lineOaId}`, note: "เปิดแอป LINE แล้วสแกน QR นี้เพื่อเพิ่มเพื่อน" },
      },
      {
        id: "web", file: "qr-website", badge: "เว็บไซต์", badgeCls: "b-gold", url: cfg.siteUrl,
        name: "QR เว็บไซต์ศูนย์",
        desc: "พาไปหน้าเว็บไซต์ของศูนย์ ดูบริการ ข่าวประชาสัมพันธ์ เอกสาร และช่องทางติดต่อ",
        frame: { title: ["สแกนเพื่อเข้าเว็บไซต์", "ศูนย์ช่วยเหลือประชาชนทางกฎหมาย"], caption: host, note: "สแกนด้วยกล้องมือถือเพื่อเปิดเว็บไซต์ของศูนย์" },
      },
      {
        id: "staff", file: "qr-staff-register", badge: "เจ้าหน้าที่", badgeCls: "b-purple", url: cfg.staffRegisterUrl,
        name: "QR สมัครเข้าใช้งานสำหรับเจ้าหน้าที่",
        desc: "ส่งให้เจ้าหน้าที่ที่จะเข้าใช้หลังบ้าน สแกนแล้วไปหน้าสมัครสมาชิก (ยืนยันอีเมลและรอผู้ดูแลระบบอนุมัติ)",
        frame: { title: ["สำหรับเจ้าหน้าที่", "สมัครเข้าใช้งานระบบหลังบ้าน"], caption: `${host}/staff-register`, note: "สมัครแล้วต้องรอผู้ดูแลระบบอนุมัติก่อนเข้าใช้งาน" },
      },
    ];
  }

  async function loadQr() {
    const grid = $("qrGrid");
    grid.innerHTML = `<p class="empty-hint">กำลังเตรียม QR Code...</p>`;
    if (typeof qrcode !== "function") { grid.innerHTML = `<p class="empty-hint">โหลดตัวสร้าง QR ไม่สำเร็จ กรุณารีเฟรชหน้านี้</p>`; return false; }
    const r = await callApi("qr-config");
    if (!r.ok) { grid.innerHTML = `<p class="empty-hint">โหลดข้อมูลลิงก์ไม่สำเร็จ กรุณาเปิดหัวข้อนี้ใหม่อีกครั้ง</p>`; return false; }
    qrCfg = r;
    qrItems = buildQrItems(r);
    await ensureQrFonts();
    await renderQrGrid();
    return true;
  }

  let qrRenderSeq = 0;   // กันรอบเก่าที่จบทีหลังเขียนทับรอบใหม่ (กดสลับ มีกรอบ/ไม่มีกรอบ หรือพิมพ์ค้นหาเร็วๆ) — ภาพที่เห็นต้องตรงกับปุ่มที่เลือก/ไฟล์ที่ดาวน์โหลดเสมอ
  async function renderQrGrid() {
    const seq = ++qrRenderSeq;
    const grid = $("qrGrid");
    const q = $("qrSearch").value.trim().toLowerCase();
    const items = qrItems.filter((it) => !q || `${it.name} ${it.desc} ${it.badge}`.toLowerCase().includes(q));
    let imgs;
    try { imgs = await Promise.all(items.map((it) => qrImage(it, qrFramed))); }
    catch { if (seq === qrRenderSeq) grid.innerHTML = `<p class="empty-hint">สร้างภาพ QR ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</p>`; return; }
    if (seq !== qrRenderSeq) return;
    $("qrEmpty").hidden = items.length > 0;
    grid.innerHTML = items.map((it, i) => `
      <article class="qr-card" data-qr="${esc(it.id)}">
        <div class="qr-thumb">
          <span class="qr-badge ${esc(it.badgeCls)}">${esc(it.badge)}</span>
          <img src="${esc(imgs[i].url)}" alt="QR Code: ${esc(it.name)}">
        </div>
        <div class="qr-body">
          <h3>${esc(it.name)}</h3>
          <p class="qr-desc">${esc(it.desc)}</p>
          <div class="qr-url">${esc(it.url)}</div>
        </div>
        <div class="qr-foot">
          <button type="button" class="qr-dl" data-dl="${esc(it.id)}">⬇ โหลด QR</button>
          <button type="button" class="qr-copy" data-copy="${esc(it.id)}" title="คัดลอกลิงก์" aria-label="คัดลอกลิงก์ ${esc(it.name)}">📋</button>
        </div>
      </article>`).join("");
    grid.querySelectorAll("[data-dl]").forEach((b) => b.onclick = async () => {
      const it = qrItems.find((x) => x.id === b.dataset.dl);
      const img = await qrImage(it, qrFramed);
      const a = document.createElement("a");
      a.href = img.url; a.download = `${it.file}${qrFramed ? "-frame" : ""}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    });
    grid.querySelectorAll("[data-copy]").forEach((b) => b.onclick = async () => {
      const it = qrItems.find((x) => x.id === b.dataset.copy);
      try { await navigator.clipboard.writeText(it.url); toast("คัดลอกลิงก์แล้ว"); }
      catch { window.prompt("คัดลอกลิงก์นี้", it.url); }   // เบราว์เซอร์ที่ไม่ให้เขียนคลิปบอร์ด — ให้ผู้ใช้กดคัดลอกเอง
    });
  }

  function initQr() {
    $("qrSearch").addEventListener("input", () => { if (qrItems.length) renderQrGrid(); });
    $$("#qrFrameSeg [data-frame]").forEach((b) => b.onclick = () => {
      qrFramed = b.dataset.frame === "1";
      $$("#qrFrameSeg [data-frame]").forEach((x) => { const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on)); });
      if (qrItems.length) renderQrGrid();
    });
  }

  // ความสูงแถบบนสุดไม่คงที่ (ชื่อแท็บ/ปุ่มยาวจนตัดบรรทัดเป็น 2 แถวบนจอแคบ) — เมนูซ้ายที่ติดจอ (sticky) ต้องเริ่มใต้แถบบนเสมอ ไม่งั้นถูกบัง (ใช้ตัวแปร CSS --navbar-h)
  function trackNavbarHeight() {
    const nb = document.querySelector(".navbar");
    if (!nb) return;
    const set = () => document.documentElement.style.setProperty("--navbar-h", nb.offsetHeight + "px");
    set();
    if ("ResizeObserver" in window) new ResizeObserver(set).observe(nb); else window.addEventListener("resize", set);
  }

  // ───────────────────────── เริ่มทำงาน ─────────────────────────
  function init(meInfo) {
    me = meInfo || {};
    trackNavbarHeight();
    paintIdentity();
    initNav();
    initAvatar();
    initStaffSubtabs();
    initQr();
    $("saveProfileBtn").onclick = saveProfile;
    if (myRole === "admin") refreshReqCount();   // จุดแดง "มีคำขอสมัครรออนุมัติ" ให้แอดมินเห็นตั้งแต่เปิดหน้า
  }

  window.StaffSettings = { init, show };
})();
