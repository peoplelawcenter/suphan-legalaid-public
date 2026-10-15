/* public/cms-media.js — ย่อรูปในเบราว์เซอร์ + อัปโหลดตรงไป Supabase Storage "site-media" ของหน้า CMS
   6 ต.ค. 69 (สเปก docs/WEBSITE-SPEC.md ข้อ 5.4): หน้า CMS รุ่นแรกส่งไฟล์ต้นฉบับขึ้นตรงๆ (รูปมือถือ 4–8MB ทะลุเพดาน 5MB บ่อย) →
   ย่อด้วย canvas ก่อนเสมอ ตามขนาดใน IMAGE_RULES (cms-utils.js) · WebP 0.82 (เบราว์เซอร์ทำ WebP ไม่ได้ → JPEG 0.85) · โลโก้ = PNG คงพื้นโปร่ง
   - หมุนตาม EXIF: เบราว์เซอร์ปัจจุบันหมุนรูปตาม EXIF ให้เองตอนวาดลง canvas (CSS image-orientation: from-image เป็นค่าเริ่มต้น) และ
     createImageBitmap ขอ imageOrientation:"from-image" ตรงๆ → รูปที่ได้ตั้งตรงเสมอ และไฟล์ใหม่ไม่มี EXIF (ไม่หลุดพิกัด GPS จากกล้องด้วย)
   - อัปโหลดแบบเดียวกับ broadcast.html: ขอ path+token จาก action=cms-upload-url (path ออกจากเซิร์ฟเวอร์เท่านั้น) แล้ว
     supabase.storage.from("site-media").uploadToSignedUrl(...) — คีย์ที่ใช้คือ anon key จาก /api/form?action=config (ไม่ใช่ความลับ)
   - เอกสาร (PDF/Word/Excel) ไม่แปลง ตรวจชนิด/ขนาดตาม cms-meta แล้วส่งไฟล์เดิม */
import { IMAGE_RULES, fitWithin, formatBytes } from "./cms-utils.js";

let sbClient = null;
async function storage() {
  if (!sbClient) {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("โหลดระบบอัปโหลดไฟล์ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วโหลดหน้าใหม่");
    }
    const res = await fetch("/api/form?action=config");
    const cfg = await res.json().catch(() => ({}));
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("ระบบอัปโหลดไฟล์ยังไม่พร้อม กรุณาแจ้งผู้ดูแลระบบ");
    sbClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }
  return sbClient.storage.from("site-media");
}

/* อ่านรูปจากไฟล์ → แหล่งภาพที่วาดลง canvas ได้ (ตั้งตรงตาม EXIF แล้ว) */
async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close && bmp.close() };
    } catch { /* บางเบราว์เซอร์ไม่รับตัวเลือก → ใช้ <img> แทน */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("decode"));
      im.src = url;
    });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/* วาดย่อแบบลดทีละครึ่ง (ย่อจาก 4000px เหลือ 480px ครั้งเดียวภาพจะแตกเป็นฟันเลื่อย) */
function drawScaled(source, sw, sh, w, h, whiteBg) {
  let cur = source, cw = sw, ch = sh;
  while (cw / 2 >= w && ch / 2 >= h) {
    const c = document.createElement("canvas");
    c.width = Math.round(cw / 2); c.height = Math.round(ch / 2);
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c; cw = c.width; ch = c.height;
  }
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const ctx = out.getContext("2d");
  if (whiteBg) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); } // JPEG ไม่มีพื้นใส → ขาว (ไม่งั้นกลายเป็นดำ)
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, 0, 0, w, h);
  return out;
}

async function encode(source, sw, sh, rule, png) {
  const { w, h } = fitWithin(sw, sh, rule);
  if (png) {
    const blob = await canvasToBlob(drawScaled(source, sw, sh, w, h, false), "image/png");
    if (blob) return { blob, type: "image/png", w, h };
  } else {
    const webp = await canvasToBlob(drawScaled(source, sw, sh, w, h, false), "image/webp", 0.82);
    if (webp && webp.type === "image/webp") return { blob: webp, type: "image/webp", w, h };
    const jpg = await canvasToBlob(drawScaled(source, sw, sh, w, h, true), "image/jpeg", 0.85);
    if (jpg) return { blob: jpg, type: "image/jpeg", w, h };
  }
  throw new Error("ย่อรูปไม่สำเร็จ กรุณาลองรูปอื่น");
}

/* เตรียมรูปตามชนิดช่อง → { main, thumb?, originalSize, summary } */
export async function prepareImage(file, kind, meta) {
  const rule = IMAGE_RULES[kind];
  const info = meta?.uploadKinds?.[kind];
  if (!rule || !info) throw new Error("ชนิดรูปไม่ถูกต้อง");
  if (!/^image\//.test(file.type || "") && !/\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name || "")) {
    throw new Error(`ไฟล์ “${file.name}” ไม่ใช่รูปภาพ`);
  }
  if (file.size > 40 * 1048576) throw new Error(`รูป “${file.name}” ใหญ่เกิน 40 MB กรุณาเลือกรูปที่เล็กลง`);
  let img;
  try {
    img = await decodeImage(file);
  } catch {
    throw new Error(`เปิดรูป “${file.name}” ไม่ได้ — กรุณาใช้ไฟล์ JPG, PNG หรือ WebP`);
  }
  try {
    const main = await encode(img.src, img.w, img.h, rule, !!rule.png);
    const thumb = rule.thumb ? await encode(img.src, img.w, img.h, rule.thumb, false) : null;
    if (main.blob.size > info.maxBytes) {
      throw new Error(`${info.label}ยังใหญ่เกิน ${formatBytes(info.maxBytes)} หลังย่อแล้ว กรุณาเลือกรูปอื่น`);
    }
    return {
      main, thumb, originalSize: file.size,
      summary: `ขนาดเดิม ${formatBytes(file.size)} → ${formatBytes(main.blob.size)} (${main.w}×${main.h} พิกเซล)`,
    };
  } finally {
    img.done();
  }
}

/* ตรวจเอกสาร/ไฟล์แนบก่อนอัปโหลด (ไม่แปลง) — คืน contentType ที่จะส่ง */
export function checkDocument(file, kind, meta, contentType) {
  const info = meta?.uploadKinds?.[kind];
  if (!info) throw new Error("ชนิดไฟล์ไม่ถูกต้อง");
  if (!contentType || !info.types.includes(contentType)) {
    throw new Error(`ไฟล์ “${file.name}” ไม่รองรับ — ${info.hint}`);
  }
  if (!(file.size > 0)) throw new Error(`ไฟล์ “${file.name}” เป็นไฟล์ว่าง`);
  if (file.size > info.maxBytes) throw new Error(`ไฟล์ “${file.name}” มีขนาด ${formatBytes(file.size)} เกิน ${formatBytes(info.maxBytes)}`);
  return contentType;
}

/* อัปโหลด 1 ก้อน → { path, publicUrl } · api = ฟังก์ชันเรียก /api/staff ของ cms.js */
export async function uploadBlob(api, kind, blob, contentType, variant = "main") {
  const u = await api("cms-upload-url", { method: "POST", body: { kind, contentType, variant } });
  if (!u.ok) throw new Error(u.error || "ขอลิงก์อัปโหลดไม่สำเร็จ");
  const bucket = await storage();
  // supabase-js ห่อ Blob เป็น multipart แล้วใช้ "ชนิดของ Blob เอง" (ไม่ใช้ contentType ที่ส่ง) — bucket site-media รับเฉพาะ allowed_mime_types
  // (migration-13) ไฟล์ .docx/.xlsx จากมือถือบางรุ่นมี file.type ว่าง = ถูกปฏิเสธ → ห่อใหม่ให้ชนิดตรงกับที่ขอ path ไว้เสมอ
  const body = blob.type === contentType ? blob : new Blob([blob], { type: contentType });
  const { error } = await bucket.uploadToSignedUrl(u.path, u.token, body, { contentType });
  if (error) throw new Error("อัปโหลดไม่สำเร็จ: " + (error.message || String(error)));
  return { path: u.path, publicUrl: u.publicUrl };
}

/* รูป 1 ใบครบชุด (รูปหลัก + รูปย่อถ้าช่องนั้นมี) */
export async function uploadImage(api, file, kind, meta, onStep) {
  onStep?.("กำลังย่อรูป…");
  const prep = await prepareImage(file, kind, meta);
  onStep?.("กำลังอัปโหลด…");
  const main = await uploadBlob(api, kind, prep.main.blob, prep.main.type, "main");
  const thumb = prep.thumb ? await uploadBlob(api, kind, prep.thumb.blob, prep.thumb.type, "thumb") : null;
  return { path: main.path, publicUrl: main.publicUrl, thumbPath: thumb?.path || null, w: prep.main.w, h: prep.main.h, summary: prep.summary };
}
