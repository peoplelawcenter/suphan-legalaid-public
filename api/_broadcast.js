/* api/_broadcast.js — ส่งโปสเตอร์ข่าว ปชส. ถึงเพื่อนทุกคนของ LINE OA จากหน้าเว็บหลังบ้าน (public/broadcast.html)
   บอสสั่ง 24 ก.ย. 69: "ทำหน้าแยกของ admin ไว้ส่งรูป poster ข่าว ปชส. แบบเหมือนใน line สป แต่เอามาให้ admin
   กดส่งได้ผ่าน web เข้า line chat oa ทุกคนที่ add เป็นเพื่อน"

   ยืมแบบจาก #ประกาศรูป ของไลน์สำนักปลัด (คนละ repo — ยืมแค่แนวคิด ไม่ได้ต่อโครงสร้างใดๆ ข้ามกัน):
   - ส่งเป็นข้อความชนิด image ของไลน์ (เห็นเต็มใบ แตะขยาย/บันทึก/แชร์ต่อได้) ไม่ยัดเป็นหัวการ์ด Flex ที่ครอปรูป
   - ข้อความ/ลิงก์ใต้รูปเป็นการ์ดเล็กต่อท้ายในคำขอเดียวกัน — LINE นับโควตา "ต่อหัวผู้รับ" ไม่นับจำนวนบอลลูน
     (สำนักปลัดยืนยันจากเอกสาร LINE pricing แล้ว 23 ก.ย. 69) รูป 4 ใบ + การ์ด = 1 ข้อความต่อคนเท่าส่งรูปเดียว
   - ⛔ ไม่กั้นปุ่มส่งด้วยโควตา — บอสสั่งไว้กับไลน์สำนักปลัด 23 ก.ย. 69 "ให้ผมกดประกาศได้เอง ห้ามปิดกั้นการ
     จำกัดโควตา เดี๋ยวผมคำนวณเอง" ใช้หลักเดียวกันที่นี่: โชว์ตัวเลขให้ครบ ด่านเดียวคือไลน์ปฏิเสธเองถ้าไม่พอจริง

   ต่างจากสำนักปลัด: ที่นี่ไม่มีตารางรายชื่อผู้ใช้ไลน์ของประชาชน → ใช้ /message/broadcast ของไลน์ (ถึงเพื่อน
   ทุกคนรวมคนที่แอดก่อนระบบนี้เกิดด้วย) แทน multicast ตามรายชื่อ · แอดมินส่งจากเว็บ ไม่ใช่คำสั่งในแชต
   (กฎ "ฝั่ง LINE OA เป็นของประชาชนล้วนๆ" 17 ก.ย. 69 — ห้ามเพิ่มคำสั่ง # ของเจ้าหน้าที่กลับเข้า webhook)

   รูปเก็บที่ Supabase Storage bucket "posters" แบบ public (ไลน์ต้องโหลดรูปจาก URL https ได้ตรงๆ ตอนผู้รับเปิดดู
   — เป็นโปสเตอร์ประชาสัมพันธ์ ไม่มีข้อมูลส่วนบุคคล คนละ bucket กับ "evidence" หลักฐานร้องเรียนที่ private เด็ดขาด)
   bucket สร้างเองอัตโนมัติครั้งแรกที่ใช้ (ensurePosterBucket) ไม่ต้องรอใครรัน SQL
   อัปโหลดตรงจากเบราว์เซอร์ด้วย signed upload URL (เหมือน _evidence.js — Vercel รับ body ได้แค่ 4.5MB)
   เบราว์เซอร์ย่อรูป/ทำภาพย่อเองก่อนอัปโหลด (canvas) → เซิร์ฟเวอร์ไม่ต้องมี sharp และตรวจซ้ำแค่หัวไฟล์+ขนาด

   ประวัติการส่งเก็บในตาราง broadcasts (supabase-migration-11-broadcasts.sql) — ยังไม่รันก็ส่งได้ปกติ
   แค่หน้าเว็บจะไม่มีประวัติให้ดู */
import crypto from "node:crypto";
import { db } from "./_db.js";
import { broadcast, validateBroadcast, pushDetailed, fetchMessageQuota, fetchFollowerStats, isWellFormedUri } from "./_lineapi.js";
import { broadcastCaptionCard } from "./_cards.js";

export const POSTER_BUCKET = "posters";
export const MAX_IMAGES = 4;             // + การ์ดข้อความ 1 = 5 ข้อความ เพดานต่อคำขอของไลน์พอดี
export const MAX_CAPTION = 1000;         // ภาษาไทย 1 ตัว = 3 ไบต์ → ~3KB ห่างเพดานการ์ด 9,500 ไบต์สบาย
export const MAX_LINK = 1000;            // เพดาน uri action ของไลน์
export const LINE_IMG_MAX = 10 * 1048576;     // originalContentUrl ≤ 10 MB (เอกสาร LINE image message)
export const LINE_PREVIEW_MAX = 1048576;      // previewImageUrl ≤ 1 MB
const ALLOWED_CT = { "image/jpeg": "jpg", "image/png": "png" };

const err = (error, extra) => ({ ok: false, error, ...(extra || {}) });

/* ═══ ที่เก็บรูป ═══ */
export function posterPrefix(staffId) {
  return `bc/${staffId}/`;
}
// path ออกจากเซิร์ฟเวอร์เท่านั้น (createPosterUploadUrl) — ตอนส่งจริงต้องตรงรูปแบบนี้ + เป็นของแอดมินคนที่กดส่ง
// (กันยิง path มั่วๆ/path ของไฟล์อื่นใน bucket/path traversal เข้ามาให้ไลน์ไปโหลด)
const PATH_RE = /^bc\/(\d+)\/\d{13}-[0-9a-f]{16}\.(jpg|png)$/;
export function isOwnPosterPath(path, staffId) {
  const m = PATH_RE.exec(String(path || ""));
  return !!m && m[1] === String(staffId);
}
export function publicPosterUrl(path) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${POSTER_BUCKET}/${path}`;
}

let bucketReady = false;
export async function ensurePosterBucket() {
  if (bucketReady) return;
  const storage = db().storage;
  const { data, error } = await storage.getBucket(POSTER_BUCKET);
  if (data && !error) {
    // ⛔ ไม่แก้เป็น public ให้เองถ้ามีคนตั้ง private ไว้ — อาจมีไฟล์อื่นที่ตั้งใจเก็บลับอยู่ในนั้น ให้คนตัดสินเอง
    if (!data.public) throw new Error(`ที่เก็บรูป "${POSTER_BUCKET}" ตั้งเป็น private อยู่ ไลน์จะโหลดรูปไม่ได้ — เปลี่ยนเป็น public ที่ Supabase > Storage ก่อน`);
    bucketReady = true;
    return;
  }
  const created = await storage.createBucket(POSTER_BUCKET, {
    public: true, fileSizeLimit: LINE_IMG_MAX, allowedMimeTypes: Object.keys(ALLOWED_CT),
  });
  if (created.error && !/already exists/i.test(created.error.message || "")) {
    throw new Error("สร้างที่เก็บรูปประกาศไม่สำเร็จ: " + created.error.message);
  }
  bucketReady = true;
}

export async function createPosterUploadUrl(staffId, contentType) {
  const ext = ALLOWED_CT[String(contentType || "").toLowerCase()];
  if (!ext) return err("รองรับเฉพาะรูป JPG หรือ PNG");
  await ensurePosterBucket();
  const path = `${posterPrefix(staffId)}${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const { data, error } = await db().storage.from(POSTER_BUCKET).createSignedUploadUrl(path);
  if (error) return err("สร้างลิงก์อัปโหลดไม่สำเร็จ: " + error.message);
  return { ok: true, path, token: data.token };
}

/* ═══ ตรวจไฟล์ที่อัปโหลดแล้ว — ไม่เชื่อ contentType จากเบราว์เซอร์ อ่านหัวไฟล์จริง (magic bytes) + ขนาดจริง
   ขอแค่ 16 ไบต์แรกด้วย Range (ไม่โหลดทั้งไฟล์ 10MB เข้า function) ขนาดรวมอ่านจาก Content-Range ═══ */
export function sniffImage(bytes) {
  const b = bytes || [];
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  return null;
}
export function totalSizeFrom(status, contentRange, contentLength) {
  const m = /\/(\d+)\s*$/.exec(String(contentRange || ""));
  if (m) return Number(m[1]);
  if (status === 200 && contentLength != null && contentLength !== "") return Number(contentLength);
  return null;
}
async function readHead(res) {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, 16);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  reader.cancel().catch(() => {}); // เซิร์ฟเวอร์ไม่สน Range แล้วส่งมาทั้งไฟล์ = ตัดทิ้งหลังได้ก้อนแรก
  return value ? value.slice(0, 16) : new Uint8Array();
}
export async function inspectPoster(path) {
  let res;
  try {
    res = await fetch(publicPosterUrl(path), { headers: { Range: "bytes=0-15" }, signal: AbortSignal.timeout(8000) });
  } catch {
    return err("โหลดรูปที่อัปโหลดไว้ไม่สำเร็จ กรุณาลองใหม่");
  }
  if (res.status !== 206 && res.status !== 200) {
    res.body?.cancel().catch(() => {});
    return err(`ไม่พบรูปที่อัปโหลดไว้ (HTTP ${res.status}) กรุณาเลือกรูปใหม่`);
  }
  const size = totalSizeFrom(res.status, res.headers.get("content-range"), res.headers.get("content-length"));
  const type = sniffImage(await readHead(res));
  if (!type) return err("ไฟล์ที่อัปโหลดไม่ใช่รูป JPG/PNG จริง");
  return { ok: true, type, size };
}

/* ═══ ตรวจ/จัดรูปข้อมูลที่หน้าเว็บส่งมา (ฟังก์ชันบริสุทธิ์ — test-broadcast.mjs เรียกตรง) ═══ */
export function normalizeLink(raw) {
  let s = String(raw || "").trim();
  if (!s) return { ok: true, link: null };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[\w-]+(\.[\w-]+)+(\/|\?|#|$)/.test(s)) s = "https://" + s; // พิมพ์แค่ www.xxx.go.th
  let u;
  try { u = new URL(s); } catch { return err("ลิงก์ไม่ถูกต้อง — ใส่ลิงก์เต็มที่ขึ้นต้นด้วย https://"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") return err("ลิงก์ต้องขึ้นต้นด้วย https:// หรือ http:// เท่านั้น");
  const href = u.href; // URL parser แปลงภาษาไทย/ช่องว่างเป็น %xx ให้แล้ว (uri action ของไลน์รับเฉพาะ ASCII)
  if (!/^[\x21-\x7e]+$/.test(href)) return err("ลิงก์มีอักขระที่ไลน์ไม่รองรับ");
  // 30 ก.ย. 69: URL parser ไม่ตรวจ % ที่ไม่ครบ (เช่น "?q=%zz") แต่ไลน์ตอบ 400 invalid uri — ตรวจชุดเดียวกับ assertFlexSafe
  if (!isWellFormedUri(href)) return err("ลิงก์มีรูปแบบ % ไม่ถูกต้อง กรุณาคัดลอกลิงก์จากแถบที่อยู่ของเบราว์เซอร์ใหม่");
  if (href.length > MAX_LINK) return err(`ลิงก์ยาวเกิน ${MAX_LINK} ตัวอักษร`);
  return { ok: true, link: href };
}

export function normalizeDraft(body, staffId) {
  const imgsIn = Array.isArray(body?.images) ? body.images : [];
  if (!imgsIn.length) return err("กรุณาเลือกรูปโปสเตอร์อย่างน้อย 1 รูป");
  if (imgsIn.length > MAX_IMAGES) return err(`ส่งได้ครั้งละไม่เกิน ${MAX_IMAGES} รูป`);
  const images = [];
  for (const im of imgsIn) {
    const orig = String(im?.orig || "");
    const preview = im?.preview ? String(im.preview) : orig;
    if (!isOwnPosterPath(orig, staffId) || !isOwnPosterPath(preview, staffId)) return err("ข้อมูลรูปไม่ถูกต้อง กรุณาเลือกรูปใหม่");
    images.push({ orig, preview });
  }
  const caption = String(body?.caption || "").replace(/\r\n?/g, "\n").trim();
  if (caption.length > MAX_CAPTION) return err(`ข้อความใต้รูปยาวเกิน ${MAX_CAPTION} ตัวอักษร`);
  const ln = normalizeLink(body?.link);
  if (!ln.ok) return ln;
  return { ok: true, images, caption, link: ln.link, notify: body?.notify !== false };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isRetryKey(k) {
  return UUID_RE.test(String(k || ""));
}

/* ข้อความที่ส่งจริง: รูปทีละใบ (ตามลำดับที่แอดมินเรียง) + การ์ดข้อความใต้รูปถ้ามีข้อความหรือลิงก์ */
export function buildBroadcastMessages({ images, caption, link }) {
  const msgs = (images || []).slice(0, MAX_IMAGES).map((im) => ({
    type: "image", originalContentUrl: im.originalUrl, previewImageUrl: im.previewUrl || im.originalUrl,
  }));
  if (String(caption || "").trim() || link) msgs.push(broadcastCaptionCard(caption, link));
  return msgs;
}

/* ตรวจรูปทุกใบของร่างกับไฟล์จริงใน bucket แล้วคืน URL สาธารณะ (ต้นฉบับ ≤10MB, ภาพย่อ ≤1MB) */
export async function resolveDraftImages(images) {
  const uniq = [...new Set(images.flatMap((im) => [im.orig, im.preview]))];
  const infos = await Promise.all(uniq.map((p) => inspectPoster(p)));
  const info = Object.fromEntries(uniq.map((p, i) => [p, infos[i]]));
  const out = [];
  for (const [i, im] of images.entries()) {
    const o = info[im.orig], p = info[im.preview];
    const no = images.length > 1 ? ` (รูปที่ ${i + 1})` : "";
    if (!o.ok) return err(o.error + no);
    if (!p.ok) return err(p.error + no);
    if (o.size != null && o.size > LINE_IMG_MAX) return err("รูปใหญ่เกิน 10 MB" + no);
    if (p.size != null && p.size > LINE_PREVIEW_MAX) return err("ภาพย่อใหญ่เกิน 1 MB — ลองเลือกรูปใหม่อีกครั้ง" + no);
    out.push({ originalUrl: publicPosterUrl(im.orig), previewUrl: publicPosterUrl(im.preview) });
  }
  return { ok: true, images: out };
}

/* ═══ ประวัติการส่ง (ตาราง broadcasts — supabase-migration-11) ยังไม่รัน = ข้ามเงียบๆ ไม่ขวางการส่ง ═══ */
async function logBroadcast(row) {
  try {
    const { error } = await db().from("broadcasts").insert(row);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("logBroadcast ไม่สำเร็จ (ยังไม่ได้รัน supabase-migration-11-broadcasts.sql?)", e?.message || e);
    return false;
  }
}
async function listBroadcasts(limit = 20) {
  const { data, error } = await db().from("broadcasts")
    .select("id,created_at,staff_name,mode,image_urls,caption,link,notify,status,error,est_recipients,line_request_id")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) return { available: false, rows: [] };
  return { available: true, rows: data || [] };
}
async function alreadySent(retryKey) {
  const { data, error } = await db().from("broadcasts").select("line_request_id")
    .eq("retry_key", retryKey).eq("status", "sent").eq("mode", "all").limit(1);
  return !error && data && data.length ? data[0] : null;
}
async function myLineUid(staffId) {
  const { data } = await db().from("staff").select("line_uid").eq("id", staffId).maybeSingle();
  return data?.line_uid || null;
}

/* ═══ action ทั้งหมดของหน้า broadcast.html (staff.js ส่งต่อมาที่นี่หลังเช็คแล้วว่าเป็นแอดมิน) ═══
   คืน { status, body } ให้ staff.js ตอบเป็น JSON — ไม่แตะ req/res ตรงๆ */
export async function broadcastAction(action, method, body, who) {
  if (action === "bc-info" && method === "GET") {
    const [quota, followers, lineUid, history] = await Promise.all([
      fetchMessageQuota({ fresh: true }), fetchFollowerStats(), myLineUid(who.staffId), listBroadcasts(20),
    ]);
    return { status: 200, body: {
      ok: true, quota, followers, lineLinked: !!lineUid,
      historyAvailable: history.available, history: history.rows,
      limits: { maxImages: MAX_IMAGES, maxCaption: MAX_CAPTION, maxOrigBytes: LINE_IMG_MAX, maxPreviewBytes: LINE_PREVIEW_MAX },
    } };
  }

  if (action === "bc-upload-url" && method === "POST") {
    const r = await createPosterUploadUrl(who.staffId, body.contentType);
    return { status: r.ok ? 200 : 400, body: r };
  }

  // bc-check = ตรวจครบทุกชั้น (ไฟล์จริง + ไลน์ตรวจรูปแบบข้อความ) โดยไม่ส่ง · bc-send = ส่งจริง
  if ((action === "bc-check" || action === "bc-send") && method === "POST") {
    const draft = normalizeDraft(body, who.staffId);
    if (!draft.ok) return { status: 400, body: draft };
    const resolved = await resolveDraftImages(draft.images);
    if (!resolved.ok) return { status: 400, body: resolved };
    const messages = buildBroadcastMessages({ images: resolved.images, caption: draft.caption, link: draft.link });

    if (action === "bc-check") {
      const v = await validateBroadcast(messages);
      return { status: v.ok ? 200 : 400, body: v.ok ? { ok: true, messageCount: messages.length } : v };
    }

    const mode = body.mode === "test" ? "test" : "all";
    const logRow = {
      staff_id: who.staffId, staff_name: who.displayName || null, mode,
      image_urls: resolved.images.map((im) => im.originalUrl), caption: draft.caption || null, link: draft.link,
      notify: draft.notify,
    };

    if (mode === "test") {
      const uid = await myLineUid(who.staffId);
      if (!uid) return { status: 400, body: err("บัญชีของท่านยังไม่ได้เชื่อม LINE — เชื่อมที่หน้าหลังบ้าน แท็บโปรไฟล์/ตั้งค่า ก่อนจึงจะส่งทดสอบได้", { code: "no_line" }) };
      const r = await pushDetailed(uid, messages);
      await logBroadcast({ ...logRow, status: r.ok ? "sent" : "failed", error: r.ok ? null : r.error, est_recipients: 1 });
      return { status: r.ok ? 200 : 502, body: r.ok ? { ok: true, mode } : { ...r, mode } };
    }

    // ส่งจริงถึงทุกคน — คีย์กันซ้ำต้องมาจากหน้าเว็บ (หน้าเว็บคงคีย์เดิมไว้จนกว่าร่างจะเปลี่ยน/ส่งสำเร็จ
    // กดซ้ำ/เน็ตหลุดแล้วกดใหม่ = คีย์เดิม = ไลน์ไม่ส่งซ้ำ) ไม่มีคีย์/รูปแบบผิด = ปฏิเสธ ไม่สุ่มให้เอง
    // (สุ่มให้ = กดซ้ำได้คีย์ใหม่ทุกครั้ง = กันซ้ำไม่ได้จริง)
    const retryKey = String(body.retryKey || "");
    if (!isRetryKey(retryKey)) return { status: 400, body: err("คำขอไม่สมบูรณ์ กรุณารีเฟรชหน้าแล้วลองใหม่") };
    const prev = await alreadySent(retryKey);
    if (prev) return { status: 200, body: { ok: true, mode, duplicate: true, requestId: prev.line_request_id } };

    const [quotaBefore, followers] = await Promise.all([fetchMessageQuota({ fresh: true }), fetchFollowerStats()]);
    const r = await broadcast(messages, { retryKey, notificationDisabled: !draft.notify });
    // ไลน์ตอบ 409 (คีย์นี้ส่งไปแล้ว) แต่ตารางเราไม่มีแถว sent ของคีย์นี้ (เช็คข้างบนแล้ว) = รอบก่อนส่งสำเร็จ
    // แต่ function ตายก่อนบันทึก → บันทึกตอนนี้แทน ประวัติจะได้ไม่ขาด
    const logged = await logBroadcast({
      ...logRow, status: r.ok ? "sent" : "failed", error: r.ok ? null : r.error, retry_key: retryKey,
      line_request_id: r.requestId || null, est_recipients: followers?.reachable ?? null,
      quota_before: quotaBefore?.unknown ? null : quotaBefore?.remaining ?? null,
    });
    if (!r.ok) return { status: 502, body: { ...r, mode } };
    // ตอบกลับทันทีหลังไลน์รับ — ไม่ดึงโควตาซ้ำตรงนี้ (หน้าเว็บเรียก bc-info เองต่อ) ยิ่งช้ายิ่งเสี่ยง function
    // หมดเวลาหลังส่งสำเร็จแล้ว แอดมินเห็นเป็น error ทั้งที่ส่งไปแล้ว
    return { status: 200, body: { ok: true, mode, duplicate: !!r.duplicate, requestId: r.requestId, logged } };
  }

  return { status: 400, body: err("ไม่รู้จัก action นี้") };
}
