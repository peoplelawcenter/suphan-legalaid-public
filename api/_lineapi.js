/* api/_lineapi.js — ทุกอย่างที่คุยกับ LINE Messaging API
   บทเรียนที่นำมาใช้ตั้งแต่ต้น (เจอมาแล้วจริงในระบบพี่น้อง "ระบบดิจิทัลสำนักปลัด" — คนละบัญชี คนละ repo
   แต่ยืมบทเรียนมาใช้ได้เพราะเจ้าของเดียวกัน):

   1) ⛔ ระบบเดิมมี lineReply(token, text) กับ lineReplyMsgs(token, [msgObj]) เป็นคนละฟังก์ชัน
      แล้วมีจุดหนึ่งเผลอส่ง object เข้า lineReply() → String(object) กลายเป็น "[object Object]" เงียบๆ
      ไม่มี error ให้เห็น ผู้ใช้เห็นข้อความนั้นตรงๆ ในแชต
      **ทางแก้ของระบบนี้: เหลือฟังก์ชันเดียว (`reply` / `push`) ที่ normalize input เองทุกรูปแบบ**
      (string ธรรมดา, message object เดี่ยว, อาเรย์ของอย่างใดอย่างหนึ่ง) — ตัดบั๊กคลาสนี้ทิ้งทั้งหมด
      ไม่ต้องมี 2 ฟังก์ชันให้สลับผิดอีก

   2) ฟิลด์ผิดคอมโพเนนต์ (เช่น cornerRadius บน image ซึ่งรองรับเฉพาะ box) ทำให้ LINE ตีกลับ "ทั้งข้อความ"
      แบบเงียบ (400 error ฝั่งเรา แต่ผู้ใช้ไม่เห็นอะไรเลย) — กันด้วย assertFlexSafe() + test-cards.mjs

   3) ทุกอย่างต้องผ่าน clampMessages()/shrinkFlex() ก่อนถึง LINE เสมอ (บับเบิล ≤9,500 ไบต์ กันพลาด 10KB
      จริง เพราะ LINE นับรวม overhead ของ JSON ด้วย ไม่ใช่แค่ตัวอักษรในนั้น) */

import crypto from "node:crypto";

const API = "https://api.line.me/v2/bot";
const DATA_API = "https://api-data.line.me/v2/bot";

function token() {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!t) throw new Error("ยังไม่ตั้ง LINE_CHANNEL_ACCESS_TOKEN");
  return t;
}

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: "Bearer " + token() };
}

/* ยิง LINE API พร้อม timeout + retry 1 ครั้ง (network แกว่งบน serverless เจอบ่อย) */
export async function lineFetch(url, opts = {}, { timeout = 8000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt >= retries) throw err;
    }
  }
}

/* ═══ ตรวจลายเซ็น webhook (ต้องเช็คก่อนประมวลผล event ใดๆ ทุกครั้ง) ═══ */
export function verifySignature(rawBody, signatureHeader) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signatureHeader) return false;
  const want = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  try {
    const a = Buffer.from(want);
    const b = Buffer.from(String(signatureHeader));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* ═══ ลิมิตของ LINE (เกินแล้วตีกลับทั้งข้อความ) ═══ */
const MAX_MSGS = 5;
const MAX_ALT = 400;
const MAX_QR = 13;
const QR_LABEL_MAX = 20;
export const FLEX_BTN_LABEL_MAX = 40;
const MAX_BUBBLE_BYTES = 9500; // เผื่อจาก 10KB จริง เพราะ LINE นับ overhead ของ JSON ด้วย

function byteLen(v) {
  return Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8");
}

/* ฟิลด์ที่ห้ามใส่บน component ที่ไม่รองรับ — ใส่แล้ว LINE ตีกลับทั้งข้อความเงียบๆ (บั๊กจริงที่เคยเกิด) */
const IMAGE_FORBIDDEN_FIELDS = ["cornerRadius", "borderWidth", "borderColor", "backgroundColor", "paddingAll"];

export function assertFlexSafe(node, path = "$") {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => assertFlexSafe(n, `${path}[${i}]`));
    return;
  }
  if (node.type === "image") {
    for (const f of IMAGE_FORBIDDEN_FIELDS) {
      if (f in node) throw new Error(`assertFlexSafe: ฟิลด์ "${f}" ใส่บน image ไม่ได้ (${path}) — ครอบด้วย box แล้วใส่ที่ box แทน`);
    }
    // 30 ก.ย. 69: รูปใน Flex ต้องเป็น https เท่านั้น (สเปก LINE) — การ์ดใหม่ใช้ไอคอน 3 มิติเป็นรูปหลายจุด
    if (typeof node.url !== "string" || !/^https:\/\/[\x21-\x7E]+$/.test(node.url)) {
      throw new Error(`assertFlexSafe: image url ต้องเป็น https และ ASCII ล้วน (${path}) — "${node.url}"`);
    }
  }
  // 30 ก.ย. 69 (การ์ดแบบ Traffy — หัวการ์ดไล่สี): `background` ใส่ได้เฉพาะ box และต้องเป็น linearGradient ตามสเปก
  // LINE (angle เป็นองศา "…deg" · startColor/endColor เป็น #RRGGBB[AA] · centerColor/centerPosition ถ้ามี) — ผิดรูป =
  // LINE ตีกลับทั้งข้อความเงียบๆ แบบเดียวกับ cornerRadius บน image
  if ("background" in node && node.type !== "flex" && node.type !== "bubble") {
    const bg = node.background;
    const hex = (c) => typeof c === "string" && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c);
    if (node.type !== "box") throw new Error(`assertFlexSafe: ฟิลด์ "background" ใส่ได้เฉพาะ box (${path})`);
    if (!bg || bg.type !== "linearGradient" || typeof bg.angle !== "string" || !/^-?\d+(\.\d+)?deg$/.test(bg.angle)
      || !hex(bg.startColor) || !hex(bg.endColor)
      || ("centerColor" in bg && !hex(bg.centerColor))
      || ("centerPosition" in bg && !/^\d+(\.\d+)?%$/.test(String(bg.centerPosition)))) {
      throw new Error(`assertFlexSafe: background ของ box ไม่ตรงสเปก linearGradient (${path}) — ${JSON.stringify(bg)}`);
    }
  }
  // ⛔⛔ บั๊กจริง 16 ก.ย. 69 — settings.map_url เก็บภาษาไทยดิบไม่ผ่าน encode ใน uri action
  // LINE ตอบ 400 "Invalid action URI" ตีกลับทั้งข้อความเงียบๆ (reply() แค่ log ไม่ throw ผู้ใช้ไม่เห็นอะไรเลย)
  // ต้อง encodeURIComponent ส่วนที่ไม่ใช่ ASCII เสมอก่อนใส่เป็น uri action
  if (node.type === "uri" && typeof node.uri === "string" && !/^[\x00-\x7F]*$/.test(node.uri)) {
    throw new Error(`assertFlexSafe: uri action มีอักขระนอก ASCII (${path}) — "${node.uri}" ต้อง encode ก่อน`);
  }
  // ⛔⛔ บั๊กจริงรอบ 2 (พบ 30 ก.ย. 69): settings.map_url ใน DB ถูกตัดกลาง percent-encoding ("...%E0%B8%84%") →
  // LINE ตอบ 400 "invalid uri" ตีกลับการ์ด "ติดต่อเรา" ทั้งใบ (กดแล้วบอทเงียบ) — ตรวจว่า % ครบ 2 หลักฐานสิบหกทุกตัว
  if (node.type === "uri" && typeof node.uri === "string" && !isWellFormedUri(node.uri)) {
    throw new Error(`assertFlexSafe: uri action รูปแบบเสีย (${path}) — "${node.uri}" (percent-encoding ไม่ครบ/ไม่มี scheme)`);
  }
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === "object") assertFlexSafe(v, `${path}.${k}`);
  }
}

/* uri ที่ LINE รับ: มี scheme (https/http/tel/line/mailto) · percent-encoding ครบทุกตัว · ASCII ล้วน (30 ก.ย. 69) */
export function isWellFormedUri(u) {
  if (typeof u !== "string" || !/^(https?:\/\/|tel:|line:\/\/|mailto:)/i.test(u) || !/^[\x21-\x7E]+$/.test(u)) return false;
  if (/%(?![0-9A-Fa-f]{2})/.test(u)) return false;
  try { decodeURI(u); return true; } catch { return false; }
}

/* ลดขนาด flex ให้พอดีเพดาน — ตัดแถวปุ่ม/รายการท้ายสุดออกทีละรายการจน bytes พอ
   ใช้เมื่อการ์ดมีความยาวไม่แน่นอน (carousel, รายการเรื่อง) แทนตั้งค่าตายตัวแล้วหวังว่าจะพอ */
export function shrinkFlex(bubble, trimmableArrayPath) {
  let cur = bubble;
  let guard = 0;
  while (byteLen(cur) > MAX_BUBBLE_BYTES && guard++ < 50) {
    const arr = trimmableArrayPath(cur);
    if (!Array.isArray(arr) || arr.length <= 1) break; // เหลือ 1 แถวแล้วยังเกิน = ปล่อยไป ให้ clamp ท้ายจัดการ
    arr.pop();
  }
  return cur;
}

function truncate(s, max) {
  s = String(s ?? "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/* ด่านสุดท้ายก่อนออกไป LINE จริง — normalize + ตัดทุกอย่างที่เกินเพดานให้พอดี ไม่ปฏิเสธเงียบๆ */
export function clampMessages(input) {
  let list = Array.isArray(input) ? input : [input];
  list = list
    .filter(Boolean)
    .map((m) => (typeof m === "string" ? { type: "text", text: m } : m))
    .filter((m) => m && typeof m === "object" && m.type);

  list = list.map((m) => {
    if (m.type === "text") {
      const text = String(m.text ?? "").trim();
      return { ...m, text: text || "(ไม่มีข้อความ)" };
    }
    if (m.type === "flex") {
      assertFlexSafe(m.contents);
      if (byteLen(m.contents) > MAX_BUBBLE_BYTES) {
        console.error("clampMessages: flex bubble เกินเพดานหลัง shrink แล้ว ยังส่งต่อ (LINE อาจตีกลับ)", m.altText);
      }
      return { ...m, altText: truncate(m.altText || "การ์ดข้อมูล", MAX_ALT) };
    }
    return m;
  });

  if (list.length > MAX_MSGS) list = list.slice(0, MAX_MSGS);
  if (!list.length) list = [{ type: "text", text: "ขออภัย เกิดข้อผิดพลาดในการสร้างข้อความ" }];
  return list;
}

function clampQuickReply(qrItems) {
  if (!qrItems || !qrItems.length) return undefined;
  const items = qrItems.slice(0, MAX_QR).map((it) => ({
    ...it,
    action: { ...it.action, label: truncate(it.action.label, QR_LABEL_MAX) },
  }));
  return { items };
}

/* ═══ ส่งข้อความ — ฟังก์ชันเดียว รับได้ทุกรูปแบบ (string / object / array ผสมกันก็ได้) ═══ */
export async function reply(replyToken, messages, { quickReply } = {}) {
  const list = clampMessages(messages);
  if (quickReply) list[list.length - 1].quickReply = clampQuickReply(quickReply);
  const res = await lineFetch(API + "/message/reply", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ replyToken, messages: list }),
  });
  if (!res.ok) console.error("reply failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}

export async function push(to, messages, { quickReply } = {}) {
  const list = clampMessages(messages);
  if (quickReply) list[list.length - 1].quickReply = clampQuickReply(quickReply);
  const res = await lineFetch(API + "/message/push", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ to, messages: list }),
  });
  if (!res.ok) console.error("push failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}

export async function multicast(uids, messages) {
  if (!uids || !uids.length) return true;
  const list = clampMessages(messages);
  const res = await lineFetch(API + "/message/multicast", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ to: uids, messages: list }),
  });
  if (!res.ok) console.error("multicast failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}

/* ═══ ประกาศถึงเพื่อนทุกคน (broadcast) — หน้าเว็บ broadcast.html ของแอดมิน (เพิ่ม 24 ก.ย. 69) ═══
   ต่างจาก push/multicast ข้างบนตรงที่ผู้เรียก "ต้องรู้ผลละเอียด" (โควตาหมด/ส่งถี่/รูปแบบผิด) ไปบอกแอดมิน
   ไม่ใช่แค่ true/false + log เงียบๆ — จึงแยกเป็นชุดใหม่ ไม่แตะ reply/push/multicast เดิมที่ทั้งระบบใช้อยู่

   ⛔ X-Line-Retry-Key (UUID) กันส่งซ้ำ: ไลน์จำคีย์ไว้ 24 ชม. คำขอที่ใช้คีย์เดิมซ้ำจะได้ 409 + ไม่ส่งซ้ำ
      → lineFetch() retry ตอนเน็ตหลุดได้อย่างปลอดภัย (ถ้ารอบแรกไลน์รับไปแล้วจริง รอบสองจะได้ 409 ไม่ใช่
      ส่งให้ทุกคนสองรอบ) · 409 จึงนับเป็น "สำเร็จ (ส่งไปแล้วก่อนหน้านี้)" ไม่ใช่ error
      ไม่มีคีย์ = ห้าม retry เด็ดขาด (เน็ตหลุดหลังไลน์รับไปแล้ว → retry = เพื่อนทุกคนได้ 2 รอบ) */
async function postLine(path, payload, { retryKey, timeout = 8000 } = {}) {
  const headers = authHeaders();
  if (retryKey) headers["X-Line-Retry-Key"] = retryKey;
  const res = await lineFetch(API + path, { method: "POST", headers, body: JSON.stringify(payload) }, { timeout, retries: retryKey ? 1 : 0 });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

/* แปลง error ของไลน์เป็นภาษาคน (ฟังก์ชันบริสุทธิ์ — test-broadcast.mjs เรียกตรงได้)
   429 มี 2 ความหมายคนละเรื่อง: โควตารายเดือนหมด ("You have reached your monthly limit.") กับยิงถี่เกิน
   rate limit — ต้องแยกให้ออก เพราะแอดมินต้องทำคนละอย่าง (รอเดือนหน้า vs รอสักครู่แล้วกดใหม่) */
export function classifyLineError(status, body = {}) {
  const msg = String(body?.message || "");
  const details = (Array.isArray(body?.details) ? body.details : [])
    .map((d) => [d?.property, d?.message].filter(Boolean).join(": ")).filter(Boolean).join(" · ");
  if (status === 429 && /monthly limit/i.test(msg)) {
    return { code: "quota", error: "โควตาข้อความของเดือนนี้ไม่พอสำหรับจำนวนเพื่อนทั้งหมด — ไลน์ปฏิเสธการส่งทั้งชุด ยังไม่มีใครได้รับประกาศนี้" };
  }
  if (status === 429) return { code: "rate", error: "ส่งถี่เกินกว่าที่ไลน์กำหนด กรุณารอสักครู่แล้วกดส่งอีกครั้ง (ยังไม่มีใครได้รับ)" };
  if (status === 400) return { code: "invalid", error: "ไลน์ไม่รับรูปแบบข้อความนี้" + (details || msg ? " — " + (details || msg) : "") };
  if (status === 401 || status === 403) return { code: "auth", error: "โทเคนของ LINE OA ใช้ส่งไม่ได้ (หมดอายุหรือไม่มีสิทธิ์) — ตรวจ LINE_CHANNEL_ACCESS_TOKEN" };
  return { code: "line", error: `ไลน์ตอบกลับผิดปกติ (HTTP ${status})` + (msg ? " — " + msg : "") };
}

export async function broadcast(messages, { retryKey, notificationDisabled = false } = {}) {
  const { res, body } = await postLine("/message/broadcast",
    { messages: clampMessages(messages), notificationDisabled: !!notificationDisabled }, { retryKey });
  const requestId = res.headers.get("x-line-request-id");
  if (res.ok) return { ok: true, requestId };
  if (res.status === 409) return { ok: true, duplicate: true, requestId: res.headers.get("x-line-accepted-request-id") || requestId };
  console.error("broadcast failed", res.status, JSON.stringify(body));
  return { ok: false, status: res.status, requestId, ...classifyLineError(res.status, body) };
}

/* ตรวจรูปแบบข้อความกับไลน์จริง "โดยไม่ส่ง" (ไม่กินโควตา) — ใช้ก่อนเปิดหน้าต่างยืนยันส่งจริงทุกครั้ง */
export async function validateBroadcast(messages) {
  const { res, body } = await postLine("/message/validate/broadcast", { messages: clampMessages(messages) });
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, ...classifyLineError(res.status, body) };
}

/* ส่งทดสอบเข้าแชตตัวเอง (push 1 คน = 1 ข้อความจากโควตา) — คืนผลละเอียดแบบเดียวกับ broadcast() */
export async function pushDetailed(to, messages) {
  const { res, body } = await postLine("/message/push", { to, messages: clampMessages(messages) });
  if (res.ok) return { ok: true };
  console.error("pushDetailed failed", res.status, JSON.stringify(body));
  return { ok: false, status: res.status, ...classifyLineError(res.status, body) };
}

/* จำนวนเพื่อน (สถิติรายวันของไลน์ — วันที่เป็นเวลาญี่ปุ่น UTC+9 และคำนวณเสร็จวันถัดไป จึงขอ "เมื่อวาน"
   ก่อน ยังไม่เสร็จค่อยถอยไปวันก่อนหน้า) followers = คนที่เคยเพิ่มเพื่อน (ไม่ลดเวลาโดนบล็อก) จึงประมาณ
   "ส่งถึงได้จริง" = followers − blocks · ตัวเลขนี้ใช้โชว์ให้แอดมินคำนวณโควตาเองเท่านั้น ไม่ใช้กั้นการส่ง */
let followerCache = null;
let followerCacheAt = 0;
export function yyyymmddJst(now, daysBack) {
  return new Date(now.getTime() + 9 * 3600 * 1000 - daysBack * 86400 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}
export async function fetchFollowerStats(now = new Date()) {
  if (followerCache && Date.now() - followerCacheAt < 30 * 60 * 1000) return followerCache;
  for (const back of [1, 2]) {
    const date = yyyymmddJst(now, back);
    try {
      const res = await lineFetch(API + "/insight/followers?date=" + date, { headers: authHeaders() }, { timeout: 5000 });
      if (!res.ok) { console.error("fetchFollowerStats", res.status, await res.text().catch(() => "")); return null; }
      const j = await res.json();
      if (j.status === "ready" && j.followers != null) {
        const followers = Number(j.followers) || 0;
        const blocks = Number(j.blocks) || 0;
        followerCache = { date, followers, blocks, reachable: Math.max(0, followers - blocks) };
        followerCacheAt = Date.now();
        return followerCache;
      }
    } catch (e) {
      console.error("fetchFollowerStats failed", e);
      return null;
    }
  }
  return null;
}

/* ═══ ตัวช่วยสร้าง action ปุ่ม ═══ */
export const fbPost = (label, data, opts) => ({ type: "postback", label, data, displayText: label, ...(opts || {}) });
export const fbUri = (label, uri) => ({ type: "uri", label, uri });
export const fbMsg = (label, text) => ({ type: "message", label, text });

export function footerButtons(buttons) {
  // buttons: [{label, action:'postback'|'uri'|'message', ...}]
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: buttons.map((b) => ({
      type: "button",
      style: b.style || "primary",
      color: b.color,
      height: "sm",
      action: { ...b.action, label: truncate(b.action.label, FLEX_BTN_LABEL_MAX) },
    })),
  };
}

/* ═══ โควตา push ฟรี 300 ข้อความ/เดือน (reply ไม่นับ) ═══
   ใช้เช็คก่อนส่ง push ที่ "ไม่เร่งด่วน" — เรื่องใหม่/คำเร่งด่วนส่งเสมอไม่ว่าจะเหลือเท่าไร */
let quotaCache = null;
let quotaCacheAt = 0;
const QUOTA_TTL_MS = 10 * 60 * 1000;

// fresh: ข้าม cache — หน้าประกาศ (broadcast.html) ต้องเห็นตัวเลขสดก่อนตัดสินใจส่งถึงทุกคน
export async function fetchMessageQuota({ fresh = false } = {}) {
  if (!fresh && quotaCache && Date.now() - quotaCacheAt < QUOTA_TTL_MS) return quotaCache;
  try {
    const [limitRes, usedRes] = await Promise.all([
      lineFetch(API + "/message/quota", { headers: authHeaders() }),
      lineFetch(API + "/message/quota/consumption", { headers: authHeaders() }),
    ]);
    const limit = await limitRes.json().catch(() => ({}));
    const used = await usedRes.json().catch(() => ({}));
    const totalUsage = Number(used.totalUsage ?? 0);
    const value = Number(limit.value ?? 300);
    quotaCache = { limit: value, used: totalUsage, remaining: Math.max(0, value - totalUsage) };
    quotaCacheAt = Date.now();
    return quotaCache;
  } catch (e) {
    console.error("fetchMessageQuota failed", e);
    return { limit: 300, used: 0, remaining: 300, unknown: true };
  }
}

/* priority: 'urgent' (เรื่องใหม่/คำเร่งด่วน — ส่งเสมอ) | 'normal' (แจ้งผล/อัปเดต — หยุดถ้าเหลือน้อย) */
const LOW_QUOTA_RESERVE = 20;
export async function pushAllowed(priority = "normal") {
  if (priority === "urgent") return true;
  const q = await fetchMessageQuota();
  if (q.unknown) return true; // เช็คไม่ได้ ยอมให้ส่งไปก่อนดีกว่าเงียบทั้งระบบ
  return q.remaining > LOW_QUOTA_RESERVE;
}

/* ═══ ตัวบ่งชี้ "กำลังพิมพ์..." ในแชต 1:1 — เรียกก่อนเริ่มประมวลผล event ที่ต้องคิด/ยิง DB
   ใช้ไม่ได้ในแชตกลุ่ม/ห้อง (LINE รองรับเฉพาะ 1:1) ถ้าเรียกไม่สำเร็จ ไม่ให้พังการตอบจริง ═══ */
export async function showLoading(uid, seconds = 20) {
  if (!uid) return;
  try {
    await lineFetch(
      API + "/chat/loading/start",
      { method: "POST", headers: authHeaders(), body: JSON.stringify({ chatId: uid, loadingSeconds: seconds }) },
      { timeout: 3000, retries: 0 }
    );
  } catch (e) {
    console.error("showLoading failed", e);
  }
}

/* ═══ ตัวบ่งชี้ "อ่านแล้ว" — ใช้ markAsReadToken จาก event.message (มีเฉพาะ event ประเภท message)
   ⚠️ ต้องเปิด "Chat" ใน LINE Official Account Manager > Response settings ก่อน ไม่งั้น LINE จะ mark
   อ่านแล้วเองอัตโนมัติแบบไม่มี UI ให้เห็น (เรียก API นี้ไปก็ไม่มีผลต่างจากเดิม) ═══ */
export async function markAsRead(token) {
  if (!token) return;
  try {
    await lineFetch(
      API + "/chat/markAsRead",
      { method: "POST", headers: authHeaders(), body: JSON.stringify({ markAsReadToken: token }) },
      { timeout: 3000, retries: 0 }
    );
  } catch (e) {
    console.error("markAsRead failed", e);
  }
}

/* ═══ ข้อมูลผู้ใช้ ═══
   30 ก.ย. 69: รับ timeout/retries ได้ — ข้อความต้อนรับ (follow) เรียกแบบสั้น (ดึงชื่อไม่ทันก็ทัก "สวัสดีค่ะ" เฉยๆ
   ดีกว่าให้คนเพิ่งแอดรอ 16 วิ) ค่าเริ่มต้นเหมือนเดิมสำหรับผู้เรียกอื่น */
export async function getProfile(uid, { timeout = 8000, retries = 1 } = {}) {
  try {
    const res = await lineFetch(API + "/profile/" + uid, { headers: authHeaders() }, { timeout, retries });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/* ═══ ไฟล์ที่ผู้ใช้ส่งเข้าแชต (รูป/PDF) — รับเรื่องทางแชต 2 ต.ค. 69 (api/_chatintake.js) ═══
   GET api-data.line.me/v2/bot/message/{id}/content → { buffer, contentType } หรือ null เมื่อ
   202 (ไลน์ยังเตรียมไฟล์ไม่เสร็จ — วิดีโอ/เสียง) · 404/410 (หมดอายุ/ไม่มี) · ใหญ่เกิน maxBytes · โหลดไม่ทันเวลา
   ⚠️ ไม่ใช้ lineFetch() เพราะ timeout ของมันหยุดนับตอนได้ header — ที่นี่ต้องคุมเวลาจนอ่าน body เสร็จ (webhook มีเวลา 30 วิ)
   ไม่ retry (ไฟล์ใหญ่โหลดซ้ำกินเวลา) · อ่านทีละก้อนแล้วตัดทิ้งทันทีที่เกินเพดาน ไม่โหลดไฟล์ใหญ่ทั้งไฟล์ค้างในหน่วยความจำ */
export async function getMessageContent(messageId, { timeout = 15000, maxBytes = 10 * 1024 * 1024 } = {}) {
  if (!/^[0-9A-Za-z]+$/.test(String(messageId || ""))) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, timeout));
  try {
    const res = await fetch(`${DATA_API}/message/${messageId}/content`, {
      headers: { Authorization: "Bearer " + token() },
      signal: ctrl.signal,
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const chunks = [];
    let size = 0;
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(Buffer.from(value));
      }
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) return null;
      chunks.push(buf);
      size = buf.length;
    }
    if (!size) return null;
    return { buffer: Buffer.concat(chunks), contentType: String(res.headers.get("content-type") || "") };
  } catch (e) {
    console.error("getMessageContent failed", e?.name || e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ═══ Rich Menu ═══ */
export async function richMenuIdByName(name) {
  const res = await lineFetch(API + "/richmenu/list", { headers: authHeaders() });
  const d = await res.json().catch(() => ({}));
  const found = (d.richmenus || []).find((m) => m.name === name);
  return found ? found.richMenuId : null;
}

/* ทุกใบที่ชื่อตรง (30 ก.ย. 69 — ใช้ลบใบเก่าของชื่อเดียวกัน ซึ่งอาจค้างมากกว่า 1 ใบถ้าเคยตั้งไม่สำเร็จครึ่งทาง) */
export async function richMenuIdsByName(name) {
  const res = await lineFetch(API + "/richmenu/list", { headers: authHeaders() });
  const d = await res.json().catch(() => ({}));
  return (d.richmenus || []).filter((m) => m.name === name).map((m) => m.richMenuId);
}

/* rich menu ค่าเริ่มต้นของทุกคนตอนนี้ (null = ยังไม่ได้ตั้ง) — preview ต้องไม่ลบใบนี้เด็ดขาด */
export async function getDefaultRichMenuId() {
  const res = await lineFetch(API + "/user/all/richmenu", { headers: authHeaders() });
  if (!res.ok) return null;
  const d = await res.json().catch(() => ({}));
  return d.richMenuId || null;
}

export async function setDefaultRichMenu(richMenuId) {
  const res = await lineFetch(API + `/user/all/richmenu/${richMenuId}`, { method: "POST", headers: authHeaders() });
  return res.ok;
}

export async function createRichMenu(def) {
  const res = await lineFetch(API + "/richmenu", { method: "POST", headers: authHeaders(), body: JSON.stringify(def) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.richMenuId) throw new Error("สร้าง rich menu ไม่สำเร็จ: " + JSON.stringify(d));
  return d.richMenuId;
}

export async function uploadRichMenuImage(richMenuId, buffer, contentType = "image/png") {
  const res = await lineFetch(DATA_API + `/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token(), "Content-Type": contentType },
    body: buffer,
  }, { timeout: 15000 });
  return res.ok;
}

/* ผูก/ยกเลิกผูก rich menu กับผู้ใช้คนเดียว (30 ก.ย. 69 — ทดลองเมนู v2 กับตัวเองก่อน ไม่แตะค่าเริ่มต้นของทุกคน)
   เมนูที่ผูกรายคนชนะค่าเริ่มต้นเสมอ · ยกเลิกผูกแล้วผู้ใช้กลับไปเห็นเมนูค่าเริ่มต้นเดิม */
export async function linkRichMenuToUser(uid, richMenuId) {
  const res = await lineFetch(API + `/user/${encodeURIComponent(uid)}/richmenu/${encodeURIComponent(richMenuId)}`, { method: "POST", headers: authHeaders() });
  return res.ok;
}

export async function unlinkRichMenuFromUser(uid) {
  const res = await lineFetch(API + `/user/${encodeURIComponent(uid)}/richmenu`, { method: "DELETE", headers: authHeaders() });
  return res.ok;
}

/* ลบ rich menu ใบเดียว (ใช้ลบใบเก่าชื่อเดียวกันหลังสร้างใบใหม่สำเร็จ) */
export async function deleteRichMenu(richMenuId) {
  const res = await lineFetch(API + "/richmenu/" + encodeURIComponent(richMenuId), { method: "DELETE", headers: authHeaders() });
  return res.ok;
}

export async function deleteAllRichMenus() {
  const res = await lineFetch(API + "/richmenu/list", { headers: authHeaders() });
  const d = await res.json().catch(() => ({}));
  for (const m of d.richmenus || []) {
    await lineFetch(API + "/richmenu/" + m.richMenuId, { method: "DELETE", headers: authHeaders() });
  }
  return (d.richmenus || []).length;
}
