/* api/_evidence.js — หลักฐานร้องเรียน (รูป/PDF) บน Supabase Storage bucket "evidence" (private)

   ⚠️ Vercel function รับ request body ได้สูงสุด 4.5MB เท่านั้น (ยืนยันจาก vercel.com/docs/
   functions/limitations วันที่ 15 ก.ย. 69) — รูปถ่ายจากมือถือมักเกินนี้ จึงห้ามส่งไฟล์ผ่าน
   api/form.js ตรงๆ ต้องให้ browser อัปโหลดตรงไปที่ Supabase ด้วย "signed upload URL" แทน:
     1. server (ที่นี่) ตรวจสิทธิ์แล้วออก {path, token} ด้วย service key
     2. browser เอา path+token ไปยิง storage.from('evidence').uploadToSignedUrl() เอง (ดู complaint.html)
     3. token ที่เซ็นมาคือตัวอนุญาตเฉพาะไฟล์นั้นครั้งเดียว ไม่ใช่ RLS — bucket ไม่มี public policy เลย
        ปลอดภัยแม้ anon key จะโผล่ในหน้าเว็บ (ตั้งใจให้เปิดเผยได้ ไม่ใช่ service key) */
import crypto from "node:crypto";
import { db } from "./_db.js";

const BUCKET = "evidence";
const ALLOWED_EXT = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILES = 3;

function safeExt(contentType) {
  return ALLOWED_EXT[contentType] || null;
}

/* path ผูกกับ uid ที่ยืนยันแล้วจาก form token (ไม่ใช้ค่าจาก client ตรงๆ กัน path traversal) */
export async function createEvidenceUploadUrl(uid, contentType) {
  const ext = safeExt(contentType);
  if (!ext) return { ok: false, error: "รองรับเฉพาะไฟล์ JPG, PNG, PDF เท่านั้น" };
  const rand = crypto.randomBytes(8).toString("hex");
  const path = `${uid}/${Date.now()}-${rand}.${ext}`;
  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return { ok: false, error: "สร้างลิงก์อัปโหลดไม่สำเร็จ: " + error.message };
  return { ok: true, path, token: data.token };
}

/* ตรวจ magic bytes จริงของไฟล์ที่อัปโหลดเสร็จแล้ว — ไม่เชื่อ contentType ที่ browser ส่งมาอย่างเดียว
   (กันคนเปลี่ยนนามสกุล/ปลอม header เพื่ออัปโหลดไฟล์อันตรายเข้ามา) */
const MAGIC = [
  { sig: [0xff, 0xd8, 0xff], contentType: "image/jpeg", ext: "jpg" }, // jpg
  { sig: [0x89, 0x50, 0x4e, 0x47], contentType: "image/png", ext: "png" }, // png
  { sig: [0x25, 0x50, 0x44, 0x46], contentType: "application/pdf", ext: "pdf" }, // %PDF
];
/* ชนิดไฟล์จากหัวไฟล์จริง (magic bytes) → {contentType, ext} หรือ null ถ้าไม่ใช่ jpg/png/pdf
   2 ต.ค. 69: แยกออกมาให้ไฟล์ที่ประชาชนส่งเข้าแชตไลน์ (api/_chatintake.js) ตรวจด้วยกติกาเดียวกับฟอร์มเว็บ */
export function evidenceTypeOf(buf) {
  if (!buf || buf.length < 4) return null;
  const head = [...buf.subarray(0, 4)];
  const hit = MAGIC.find((m) => m.sig.every((b, i) => head[i] === b));
  return hit ? { contentType: hit.contentType, ext: hit.ext } : null;
}
export async function verifyUploadedFile(path) {
  const { data, error } = await db().storage.from(BUCKET).download(path, { transform: undefined });
  if (error) return false;
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) return false;
  return !!evidenceTypeOf(buf);
}

/* ═══ ไฟล์ที่ประชาชนส่งเข้าแชตไลน์ (รับเรื่องทางแชต — 2 ต.ค. 69) ═══
   เซิร์ฟเวอร์โหลดจากไลน์เองแล้วอัปโหลดด้วย service key (ไม่ผ่านเบราว์เซอร์ จึงไม่ต้องใช้ signed upload URL)
   path ขึ้นต้นด้วย uid เสมอตามกฎเดิม: "<uid>/chat/<epochms>-<hex16>.<ext>" · เพดานขนาด = MAX_FILE_BYTES (8MB =
   file_size_limit ของ bucket evidence ใน supabase-setup.sql — ใหญ่กว่านี้ Storage ปฏิเสธเองอยู่แล้ว) */
export function chatEvidencePath(uid, ext, now = Date.now()) {
  return `${uid}/chat/${now}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
}
export async function storeEvidenceBuffer(path, buf, contentType) {
  if (!buf || buf.length > MAX_FILE_BYTES) return false;
  const { error } = await db().storage.from(BUCKET).upload(path, buf, { contentType, upsert: false });
  if (error) {
    console.error("storeEvidenceBuffer failed", error.message || error);
    return false;
  }
  return true;
}

export async function deleteEvidence(paths) {
  if (!paths || !paths.length) return;
  await db().storage.from(BUCKET).remove(paths).catch((e) => console.error("deleteEvidence failed", e));
}

/* ให้เจ้าหน้าที่ดูไฟล์จากหลังบ้าน — signed URL อายุสั้น ออกใหม่ทุกครั้งที่ขอดู ไม่เก็บลิงก์ยาว */
export async function getEvidenceViewUrl(path) {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, 10 * 60);
  if (error) return null;
  return data.signedUrl;
}
