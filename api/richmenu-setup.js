/* api/richmenu-setup.js — ตั้ง/อัปเดต Rich Menu (เรียกครั้งเดียวหลัง deploy หรือทุกครั้งที่แก้ป้ายปุ่ม)
   เรียกผ่านเบราว์เซอร์: /api/richmenu-setup?token=<SETUP_TOKEN>[&action=...]

   ⚠️ ไม่ใช้ Chromium เรนเดอร์สดบน Vercel (บทเรียนจากระบบพี่น้อง — ต้องเซ็ต AWS_EXECUTION_ENV เอง
   กัน libnss3 หาย ยุ่งยากและเสี่ยงพังเงียบ) รูปเมนูจึงเป็นไฟล์นิ่งที่ commit ไว้แล้ว (เรนเดอร์ด้วย Playwright
   ตอน dev — ดู scripts/render-richmenu.mjs) ไฟล์นี้แค่ดึงรูปนิ่งนั้นจากเว็บที่ deploy แล้วมาอัปโหลดขึ้น LINE
   ข้อเสีย: แก้ป้ายปุ่มต้องรัน render-richmenu ใหม่ + commit รูปใหม่ — ยอมรับข้อเสียนี้เพื่อความนิ่ง

   🆕 30 ก.ย. 69 (งาน T1a — ริชเมนูแบบ Traffy) ทับของเดิม 15 ก.ย. 69:
   - พิกัด/action มาจาก api/_richmenu-layout.js ไฟล์เดียวกับที่ใช้วาดภาพ (เดิมเขียน TILES/COL_X ซ้ำไว้ที่นี่)
   - ภาพ v2 = public/assets/richmenu-v2.jpg (JPEG ≤ 1MB) ชื่อเมนูใหม่ RICHMENU_NAME (v2)
   - action (ค่าเริ่มต้น set):
       set                 สร้างเมนู v2 → ตั้งเป็นค่าเริ่มต้นของทุกคน → ลบเมนู v2 ใบเก่า (เหมือนเดิม: ลบใบชื่อเดียวกัน)
                           ⛔ ใช้หลังบอสอนุมัติหน้าตา v2 แล้วเท่านั้น · เมนู v1 ไม่ถูกลบ (เก็บไว้เผื่อย้อนกลับ)
       preview&uid=U…      สร้าง/อัปเดตเมนู v2 แล้วผูกกับผู้ใช้คนเดียว — ⛔ ไม่แตะค่าเริ่มต้นของทุกคน
                           ลบ v2 ใบเก่าเฉพาะใบที่ "ไม่ใช่ค่าเริ่มต้น" (คนที่ preview ใบเก่าไว้จะกลับไปเห็นค่าเริ่มต้น)
       unpreview&uid=U…    ยกเลิกการผูกรายคน → ผู้ใช้กลับไปเห็นเมนูค่าเริ่มต้นเดิม
       delete              ลบ rich menu ทุกใบ (เหมือนเดิม) */
import {
  createRichMenu, uploadRichMenuImage, setDefaultRichMenu, deleteAllRichMenus, richMenuIdsByName,
  getDefaultRichMenuId, linkRichMenuToUser, unlinkRichMenuFromUser, deleteRichMenu,
} from "./_lineapi.js";
import { RICHMENU_NAME, RICHMENU_IMAGE, RICHMENU_IMAGE_TYPE, RICHMENU_MAX_BYTES, richMenuDefinition } from "./_richmenu-layout.js";

// LINE userId = "U" + hex 32 ตัว — ตรวจรูปแบบก่อนยิง กันพิมพ์ผิดแล้วได้ error งงๆ จาก LINE
export const LINE_UID_RE = /^U[0-9a-f]{32}$/;

function param(req, key) {
  return req.query?.[key] || new URL(req.url, "http://x").searchParams.get(key);
}

async function createV2Menu() {
  const site = process.env.SITE_URL || "https://suphan-legalaid.vercel.app";
  const imgRes = await fetch(`${site}/${RICHMENU_IMAGE}`, { cache: "no-store" });
  if (!imgRes.ok) throw new Error(`ดึงรูป ${RICHMENU_IMAGE} จาก ${site} ไม่สำเร็จ (สถานะ ${imgRes.status})`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  if (buf.length > RICHMENU_MAX_BYTES) throw new Error(`รูป ${RICHMENU_IMAGE} ใหญ่ ${buf.length} ไบต์ เกินเพดาน LINE 1MB`);
  const id = await createRichMenu(richMenuDefinition());
  const uploaded = await uploadRichMenuImage(id, buf, RICHMENU_IMAGE_TYPE);
  if (!uploaded) {
    await deleteRichMenu(id).catch(() => {}); // ไม่ทิ้งเมนูไม่มีรูปค้างไว้
    throw new Error("อัปโหลดรูป rich menu ไม่สำเร็จ");
  }
  return id;
}

export default async function handler(req, res) {
  const token = param(req, "token");
  if (!process.env.SETUP_TOKEN || token !== process.env.SETUP_TOKEN) return res.status(404).send("not found");

  const action = param(req, "action") || "set";
  try {
    if (action === "delete") {
      const n = await deleteAllRichMenus();
      return res.status(200).send(`ลบ rich menu แล้ว ${n} ใบ`);
    }

    if (action === "preview" || action === "unpreview") {
      const uid = param(req, "uid") || "";
      if (!LINE_UID_RE.test(uid)) return res.status(400).send("ต้องระบุ uid=<LINE userId ขึ้นต้นด้วย U ตามด้วย 32 ตัว>");
      if (action === "unpreview") {
        const ok = await unlinkRichMenuFromUser(uid);
        if (!ok) throw new Error("ยกเลิกการผูกเมนูรายคนไม่สำเร็จ");
        return res.status(200).send(`ยกเลิกเมนูทดลองของ ${uid} แล้ว — กลับไปเห็นเมนูค่าเริ่มต้นเดิม`);
      }
      const [oldIds, defaultId] = await Promise.all([richMenuIdsByName(RICHMENU_NAME), getDefaultRichMenuId()]);
      const id = await createV2Menu();
      if (!(await linkRichMenuToUser(uid, id))) {
        await deleteRichMenu(id).catch(() => {});
        throw new Error("ผูกเมนูกับผู้ใช้ไม่สำเร็จ (ผู้ใช้ต้องเป็นเพื่อนกับ OA อยู่)");
      }
      for (const old of oldIds) if (old !== defaultId && old !== id) await deleteRichMenu(old).catch(() => {});
      return res.status(200).send(`ผูกเมนู v2 กับ ${uid} แล้ว richMenuId=${id} (ค่าเริ่มต้นของทุกคนไม่เปลี่ยน) — ปิดแชตแล้วเปิดใหม่ถ้ายังไม่เห็น`);
    }

    if (action !== "set") return res.status(400).send("action ที่รองรับ: set | preview | unpreview | delete");

    const oldIds = await richMenuIdsByName(RICHMENU_NAME);
    const id = await createV2Menu();
    if (!(await setDefaultRichMenu(id))) throw new Error("ตั้งเป็นเมนูค่าเริ่มต้นไม่สำเร็จ");
    for (const old of oldIds) if (old !== id) await deleteRichMenu(old).catch(() => {});
    return res.status(200).send(`ตั้ง Rich Menu สำเร็จ richMenuId=${id}`);
  } catch (e) {
    console.error("richmenu-setup failed", e);
    return res.status(500).send("ผิดพลาด: " + e.message);
  }
}
