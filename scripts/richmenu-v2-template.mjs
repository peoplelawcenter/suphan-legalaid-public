/* scripts/richmenu-v2-template.mjs — เทมเพลต HTML ของ Rich Menu v2 (แนว Traffy Fondue — 30 ก.ย. 69 งาน T1a)
   ⛔ ห้ามเขียนพิกัด/ป้ายซ้ำในไฟล์นี้ — วาดจาก RICHMENU_AREAS ใน api/_richmenu-layout.js ที่เดียว (ไฟล์เดียวกับที่
      api/richmenu-setup.js ส่งขึ้น LINE) กันรูปกับพื้นที่กดไม่ตรงกัน
   ภาพ = ไอคอน 3 มิติ Fluent Emoji (MIT) + กราฟิก ไม่ใช้ภาพถ่าย/หน้าคน (มติบอส 30 ก.ย. 69)
   พื้นไล่สีน้ำเงิน-ทองตามแบรนด์ (#0B2E6D / #EAF3FC / #D9A93B) + ลวดลายเส้นทแยงจางๆ */
import { RICHMENU_AREAS, RICHMENU_SIZE, LABEL_PX } from "../api/_richmenu-layout.js";
import { fontFaceCss, icon3d } from "./_render-lib.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// โทนแถบใหญ่ 4 ช่อง — น้ำเงินทั้งหมด (แบรนด์) ต่างเฉดเล็กน้อยให้แยกช่องออกเหมือนแถบภาพของ Traffy
const BANNER_TONES = {
  consult: ["#0B2E6D", "#2B66CC"],
  appointment: ["#0A3470", "#1A7DB5"],
  complaint: ["#12296A", "#4150B5"],
  knowledge: ["#0B2E6D", "#1E5AA8"],
};

function cell(a) {
  const lines = a.lines.map((l) => `<div class="line">${esc(l)}</div>`).join("");
  const sub = esc(a.sub).replace(/\n/g, "<br>");
  const style = `left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.h}px`;
  if (a.kind === "banner") {
    const [c1, c2] = BANNER_TONES[a.key] || BANNER_TONES.consult;
    return `<div class="area banner" data-key="${a.key}" style="${style}">
      <div class="card" style="background:linear-gradient(120deg, ${c1} 0%, ${c2} 100%)">
        <div class="pattern"></div><div class="glow"></div>
        <div class="text"><div class="label" style="font-size:${LABEL_PX.banner}px">${lines}</div><div class="bar"></div><div class="sub">${sub}</div></div>
        <img class="icon" src="${icon3d(a.icon)}" alt="">
      </div></div>`;
  }
  const px = a.kind === "urgent" ? LABEL_PX.urgent : LABEL_PX.tile;
  return `<div class="area ${a.kind}" data-key="${a.key}" style="${style}">
    <div class="card">
      ${a.kind === "tile" ? "" : '<div class="pattern"></div>'}
      <img class="icon" src="${icon3d(a.icon)}" alt="">
      <div class="label" style="font-size:${px}px">${lines}</div>
      <div class="sub">${sub}</div>
    </div></div>`;
}

export function buildRichMenuHtml() {
  const { width: W, height: H } = RICHMENU_SIZE;
  const topH = Math.min(...RICHMENU_AREAS.filter((a) => a.kind !== "urgent" && a.kind !== "banner").map((a) => a.y)); // เส้นแบ่งส่วนบน/แถวล่าง
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
${fontFaceCss()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;font-family:'Prompt',sans-serif}
body{position:relative;background:linear-gradient(180deg,#0B2E6D 0,#0B2E6D ${topH}px,#DCE8F7 ${topH}px,#EAF3FC 100%)}
.area{position:absolute;padding:14px}
.card{position:relative;width:100%;height:100%;border-radius:40px;overflow:hidden}
.line{white-space:nowrap}
.pattern{position:absolute;inset:0;opacity:.09;background:repeating-linear-gradient(135deg,#fff 0 3px,transparent 3px 34px)}
/* แถบใหญ่ 2×2 */
.banner .card{display:flex;align-items:center;padding:0 40px 0 64px;box-shadow:inset 0 0 0 4px rgba(217,169,59,.55)}
.banner .glow{position:absolute;right:-60px;top:50%;width:520px;height:520px;transform:translateY(-50%);border-radius:50%;background:radial-gradient(circle,rgba(234,243,252,.34) 0%,rgba(234,243,252,0) 68%)}
.banner .text{position:relative;flex:1;min-width:0;color:#fff}
.banner .label{font-weight:800;line-height:1.14;text-shadow:0 4px 14px rgba(0,0,0,.28)}
.banner .bar{width:120px;height:10px;border-radius:5px;background:#D9A93B;margin:22px 0 18px}
.banner .sub{font-size:40px;font-weight:600;color:#DCEBFF;line-height:1.3}
.banner .icon{position:relative;width:300px;height:300px;flex:0 0 300px;filter:drop-shadow(0 14px 18px rgba(0,0,0,.35))}
/* คอลัมน์เหตุด่วนซ้าย (แบบกระดิ่งของ Traffy) */
.urgent .card{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#fff;
  background:linear-gradient(180deg,#D93025 0%,#9E1B14 100%);box-shadow:inset 0 0 0 4px rgba(255,255,255,.35)}
.urgent .icon{position:relative;width:230px;height:230px;filter:drop-shadow(0 12px 16px rgba(0,0,0,.35));margin-bottom:26px}
.urgent .label{position:relative;font-weight:800;line-height:1.15}
.urgent .sub{position:relative;margin-top:30px;font-size:40px;font-weight:700;line-height:1.35;background:rgba(0,0,0,.22);border-radius:26px;padding:14px 22px}
/* แถวล่าง 5 ช่อง */
.tile .card,.primary .card{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.tile .card{background:linear-gradient(180deg,#FFFFFF 0%,#F2F7FD 100%);color:#0B2E6D;box-shadow:inset 0 0 0 3px #C9DAF0,0 8px 18px rgba(11,46,109,.12)}
.primary .card{background:linear-gradient(160deg,#0B2E6D 0%,#051B45 100%);color:#fff;box-shadow:inset 0 0 0 6px #D9A93B}
.tile .icon,.primary .icon{position:relative;width:200px;height:200px;filter:drop-shadow(0 10px 12px rgba(11,46,109,.25));margin-bottom:18px}
.tile .label,.primary .label{position:relative;font-weight:700;line-height:1.12}
.tile .sub,.primary .sub{position:relative;margin-top:12px;font-size:34px;font-weight:600;line-height:1.25}
.tile .sub{color:#5A6B85}
.primary .sub{color:#F3D48A}
</style></head><body>
${RICHMENU_AREAS.map(cell).join("\n")}
</body></html>`;
}
