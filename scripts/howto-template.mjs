/* scripts/howto-template.mjs — เทมเพลต HTML ภาพ "วิธีขอรับบริการ" 3 บริการ + ภาพหัวการ์ดต้อนรับ (30 ก.ย. 69 งาน T1a)
   แนวเดียวกับภาพ "วิธีแจ้งคำร้อง" ของ ทต.หนองป่าครั่ง ที่บอสส่งมา (ตัวอย่าง แจ้งขอเข้ารับคำปรึกษา.jpg):
   หัวภาพ + ภาพหน้าจอไลน์ประกอบ + ขั้นตอนเป็นข้อ + ท้ายภาพมีเวลาทำการ/เบอร์/โลโก้คู่
   ⛔ เนื้อหาขั้นตอนมาจาก serviceSteps() ใน api/_serviceinfo.js ที่เดียว (ข้อเท็จจริงจากฟอร์มจริง/SPEC) ห้ามพิมพ์ซ้ำที่นี่
   ⛔ ภาพนิ่งดึง settings ตอนรันไม่ได้ → ใช้คำว่า "เจ้าหน้าที่" และเวลาทำการ/เบอร์จากค่าที่สคริปต์ส่งเข้ามา
      (DEFAULTS ใน _settings.js) — แก้เบอร์/เวลาทำการใน settings แล้วต้องเรนเดอร์ภาพใหม่ */
import { serviceSteps, SERVICE_TITLES, APPOINTMENT_INFO } from "../api/_serviceinfo.js";
import { RICHMENU_AREAS } from "../api/_richmenu-layout.js";
import { fontFaceCss, icon3d, asset } from "./_render-lib.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Prompt',sans-serif;color:#1c2530;background:#EAF3FC}
.pattern{position:absolute;inset:0;opacity:.08;background:repeating-linear-gradient(135deg,#fff 0 2px,transparent 2px 26px);pointer-events:none}
.logos{display:flex;align-items:center;gap:14px}
.logo{width:92px;height:92px;border-radius:50%;background:#fff;overflow:hidden;box-shadow:0 0 0 4px rgba(217,169,59,.9);display:flex;align-items:center;justify-content:center}
.logo img{width:100%;height:100%;object-fit:cover}
`;

function logosHtml(size = 92) {
  const s = `width:${size}px;height:${size}px`;
  return `<div class="logos"><div class="logo" style="${s}"><img src="${asset("logo-pao.png")}" alt=""></div><div class="logo" style="${s}"><img src="${asset("logo-lawyers-council-sm.png")}" alt=""></div></div>`;
}

/* หน้าจอไลน์จำลอง 3 จอ: กดเมนู → การ์ดตอบกลับมีปุ่มเปิดแบบฟอร์ม → กรอกแบบฟอร์ม */
function phoneMocks(kind) {
  const grid = RICHMENU_AREAS.filter((a) => a.kind === "banner").map((a) =>
    `<div class="mini-tile${a.key === kind ? " hot" : ""}"><img src="${icon3d(a.icon)}" alt=""></div>`).join("");
  const title = SERVICE_TITLES[kind].title;
  return `<div class="phones">
    <div class="phone"><div class="scr">
      <div class="bubble-me">${esc(title)}</div>
      <div class="mini-menu">${grid}</div>
    </div><div class="cap"><b>1</b> กดเมนู<br>ด้านล่างแชต</div></div>
    <div class="arrow">➜</div>
    <div class="phone"><div class="scr">
      <div class="bubble-bot"><div class="bb-h"></div><div class="bb-l"></div><div class="bb-l s"></div><div class="bb-btn">📝 เปิดแบบฟอร์ม</div></div>
    </div><div class="cap"><b>2</b> กดปุ่ม<br>"เปิดแบบฟอร์ม"</div></div>
    <div class="arrow">➜</div>
    <div class="phone"><div class="scr form">
      <div class="f-l"></div><div class="f-in"></div><div class="f-l"></div><div class="f-in"></div><div class="f-l"></div><div class="f-in tall"></div><div class="f-send">ส่ง</div>
    </div><div class="cap"><b>3</b> กรอกแบบฟอร์ม<br>แล้วกดส่ง</div></div>
  </div>`;
}

const HOWTO_CSS = `
.hero{position:relative;overflow:hidden;background:linear-gradient(135deg,#0B2E6D 0%,#1D4F9E 100%);color:#fff;padding:40px 48px 44px}
.hero .top{position:relative;display:flex;align-items:center;gap:20px}
.hero .org{font-size:25px;line-height:1.35;font-weight:600}
.hero .org small{display:block;font-size:20px;font-weight:400;color:#DCEBFF}
.hero .main{position:relative;display:flex;align-items:center;margin-top:30px}
.hero .t{flex:1}
.hero .pill{display:inline-block;background:#D9A93B;color:#0B2E6D;font-weight:700;font-size:24px;border-radius:30px;padding:6px 22px}
.hero h1{font-size:62px;font-weight:800;line-height:1.18;margin-top:14px;text-shadow:0 4px 14px rgba(0,0,0,.25)}
.hero p{font-size:27px;color:#DCEBFF;margin-top:12px;font-weight:600}
.hero .big{width:230px;height:230px;filter:drop-shadow(0 14px 18px rgba(0,0,0,.35))}
.hero .gold{position:absolute;left:0;right:0;bottom:0;height:10px;background:#D9A93B}
.phones{display:flex;align-items:flex-start;justify-content:center;gap:10px;padding:34px 30px 8px}
.phone{width:270px}
.scr{height:300px;border-radius:30px;background:#9DB9DD;border:8px solid #1c2530;padding:16px 12px;display:flex;flex-direction:column;justify-content:flex-end;gap:12px;box-shadow:0 10px 22px rgba(11,46,109,.18)}
.scr.form{background:#fff;justify-content:flex-start;gap:8px}
.cap{text-align:center;font-size:23px;font-weight:600;color:#0B2E6D;margin-top:12px;line-height:1.3}
.cap b{display:inline-flex;width:34px;height:34px;border-radius:50%;background:#D9A93B;color:#0B2E6D;align-items:center;justify-content:center;font-size:21px;margin-right:4px}
.arrow{font-size:40px;color:#D9A93B;margin-top:130px;font-weight:800}
.bubble-me{align-self:flex-end;background:#6CD46C;color:#10301a;font-size:17px;font-weight:600;border-radius:16px;padding:7px 11px;max-width:92%}
.mini-menu{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:#0B2E6D;border-radius:10px;padding:6px}
.mini-tile{height:52px;border-radius:8px;background:#2B5AA8;display:flex;align-items:center;justify-content:center}
.mini-tile img{width:40px;height:40px}
.mini-tile.hot{background:#D9A93B;box-shadow:0 0 0 4px #fff,0 0 0 8px #D93025}
.bubble-bot{background:#fff;border-radius:16px;overflow:hidden;padding-bottom:12px}
.bb-h{height:46px;background:linear-gradient(90deg,#0B2E6D,#2B66CC)}
.bb-l{height:12px;border-radius:6px;background:#dfe7f2;margin:12px 12px 0}
.bb-l.s{width:55%}
.bb-btn{margin:14px 12px 0;background:#0B2E6D;color:#fff;font-size:18px;font-weight:700;text-align:center;border-radius:10px;padding:8px 0;box-shadow:0 0 0 4px #fff,0 0 0 8px #D93025}
.f-l{height:10px;width:45%;border-radius:5px;background:#c9d6e8}
.f-in{height:30px;border-radius:8px;border:2px solid #c9d6e8}
.f-in.tall{height:58px}
.f-send{margin-top:auto;background:#D9A93B;color:#0B2E6D;font-weight:800;font-size:19px;text-align:center;border-radius:10px;padding:6px 0}
.steps{padding:26px 40px 10px;display:flex;flex-direction:column;gap:16px}
.step{display:flex;align-items:center;gap:20px;background:#fff;border-radius:26px;padding:20px 26px;box-shadow:0 6px 16px rgba(11,46,109,.08);border-left:10px solid #0B2E6D}
.step .n{flex:0 0 58px;height:58px;border-radius:50%;background:#0B2E6D;color:#fff;font-size:32px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 4px #D9A93B}
.step img{flex:0 0 92px;width:92px;height:92px}
.step .tt{font-size:34px;font-weight:700;color:#0B2E6D;line-height:1.25}
.step .dd{font-size:25px;color:#415069;line-height:1.4;margin-top:4px}
.visit{margin:18px 40px 0;background:#fff;border-radius:26px;padding:26px 30px;box-shadow:0 6px 16px rgba(11,46,109,.08);border:3px solid #0B2E6D}
.visit .vh{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:800;color:#0B2E6D;margin-top:18px}
.visit .vh:first-child{margin-top:0}
.visit .vh img{width:58px;height:58px}
.visit .vbig{font-size:29px;font-weight:700;color:#0B2E6D;line-height:1.35;margin:8px 0 0 72px}
.visit .vsm{font-size:23px;color:#415069;line-height:1.4;margin:4px 0 0 72px}
.visit ol{margin:10px 0 0 72px;padding-left:34px}
.visit li{font-size:24px;color:#26344d;line-height:1.42;margin-top:6px}
.visit li::marker{color:#D9A93B;font-weight:800}
.visit .vnote{margin:12px 0 0 72px;display:inline-block;background:#FFF4D6;color:#7a5a00;font-size:22px;font-weight:600;border-radius:12px;padding:6px 14px}
.notes{display:flex;gap:14px;padding:18px 40px 30px}
.note{flex:1;background:#fff;border:3px solid #D9A93B;border-radius:22px;padding:16px 14px;text-align:center}
.note img{width:64px;height:64px}
.note div{font-size:23px;font-weight:700;color:#0B2E6D;line-height:1.3;margin-top:6px}
.foot{position:relative;overflow:hidden;background:#0B2E6D;color:#fff;padding:30px 44px;display:flex;align-items:center;gap:26px}
.foot .info{position:relative;flex:1;font-size:27px;line-height:1.5;font-weight:600}
.foot .info .ph{font-size:40px;font-weight:800;color:#F3D48A}
.foot .info small{display:block;font-size:21px;font-weight:400;color:#DCEBFF}
.foot .logos{position:relative}
`;

export function buildHowtoHtml(kind, settings) {
  const t = SERVICE_TITLES[kind];
  const oh = settings.office_hours;
  const steps = serviceSteps(kind).map((s, i) => `<div class="step"><div class="n">${i + 1}</div><img src="${icon3d(s.icon)}" alt=""><div><div class="tt">${esc(s.title)}</div><div class="dd">${esc(s.detail)}</div></div></div>`).join("");
  const third = kind === "appointment"
    ? { icon: "telephone_receiver", text: "นัดเบื้องต้น<br>ยืนยันทางโทรศัพท์" }
    : { icon: "alarm_clock", text: "ติดต่อกลับภายใน<br>วันทำการถัดไป" };
  // 30 ก.ย. 69: กล่องข้อมูลวันนัด (สถานที่/ทนายอาสา/เอกสาร) เฉพาะภาพจองคิว — ข้อมูลจริงจากบอสใน APPOINTMENT_INFO
  // ค่าไหนเป็น null ก็ไม่แสดงหัวข้อนั้น (ขั้นที่ 6 ยังมีข้อความสำรองอยู่แล้ว) — ไม่แต่งข้อมูลในเทมเพลต
  const ai = APPOINTMENT_INFO;
  const loc = ai.location;
  const docs = Array.isArray(ai.documents) ? ai.documents : [];
  const visit = kind === "appointment" && (loc || ai.lawyer_schedule || docs.length) ? `<div class="visit">
  ${loc ? `<div class="vh"><img src="${icon3d("round_pushpin")}" alt="">สถานที่เข้ารับคำปรึกษา</div><div class="vbig">${esc(loc.room)}<br>${esc(loc.place)}</div><div class="vsm">${esc(loc.address)} · แตะหมุดแผนที่ในแชตเพื่อนำทาง</div>` : ""}
  ${ai.lawyer_schedule ? `<div class="vh"><img src="${icon3d("spiral_calendar")}" alt="">ทนายอาสาประจำศูนย์</div><div class="vbig">${esc(ai.lawyer_schedule)}</div>${ai.lawyer_off ? `<div class="vsm">${esc(ai.lawyer_off)}</div>` : ""}` : ""}
  ${docs.length ? `<div class="vh"><img src="${icon3d("clipboard")}" alt="">เอกสารที่ต้องนำมาในวันนัด</div><ol>${docs.map((d) => `<li>${esc(d)}</li>`).join("")}</ol>${ai.documents_note ? `<div class="vnote">${esc(ai.documents_note)}</div>` : ""}` : ""}
</div>` : "";
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
${fontFaceCss()}
html,body{width:1040px}
${BASE_CSS}
${HOWTO_CSS}
</style></head><body>
<div class="hero"><div class="pattern"></div>
  <div class="top">${logosHtml(92)}<div class="org">ศูนย์ช่วยเหลือประชาชนทางกฎหมาย<small>สภาทนายความจังหวัดสุพรรณบุรี ร่วมกับ อบจ.สุพรรณบุรี</small></div></div>
  <div class="main"><div class="t"><span class="pill">วิธีขอรับบริการผ่าน LINE</span><h1>${esc(t.howto)}</h1><p>กรอกแบบฟอร์มได้ตลอด 24 ชม. ไม่ต้องเดินทาง</p></div><img class="big" src="${icon3d(t.icon)}" alt=""></div>
  <div class="gold"></div>
</div>
${phoneMocks(kind)}
<div class="steps">${steps}</div>
${visit}
<div class="notes">
  <div class="note"><img src="${icon3d("check_mark_button")}" alt=""><div>บริการฟรี<br>ไม่มีค่าใช้จ่าย</div></div>
  <div class="note"><img src="${icon3d("locked")}" alt=""><div>ข้อมูลเก็บเป็นความลับ<br>ใช้เพื่อติดต่อกลับ</div></div>
  <div class="note"><img src="${icon3d(third.icon)}" alt=""><div>${third.text}</div></div>
</div>
<div class="foot"><div class="pattern"></div>
  <div class="info">☀️ เวลาทำการ ${esc(oh.days)} ${esc(oh.start)}–${esc(oh.end)} น.<small>หยุดวันหยุดราชการ · นอกเวลาทำการกรอกแบบฟอร์มทิ้งไว้ได้</small><div class="ph">☎️ โทร ${esc(settings.phone)}</div></div>
  ${logosHtml(96)}
</div>
</body></html>`;
}

/* ภาพหัวการ์ดต้อนรับ 1040x676 (20:13 ตาม hero ของ bubble ใน _cards.js) — โลโก้คู่ + "ยินดีให้บริการ" + ไอคอน 3 มิติ */
export function buildWelcomeHeroHtml() {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
${fontFaceCss()}
html,body{width:1040px;height:676px;overflow:hidden}
${BASE_CSS}
.w{position:relative;width:1040px;height:676px;overflow:hidden;background:radial-gradient(circle at 50% 30%,#2B66CC 0%,#0B2E6D 62%,#061A40 100%);color:#fff;text-align:center;padding-top:62px}
.w .logos{justify-content:center;gap:26px}
.w .logo{box-shadow:0 0 0 6px #D9A93B,0 12px 26px rgba(0,0,0,.35)}
.w h1{font-size:84px;font-weight:800;color:#F3D48A;margin-top:34px;line-height:1.1;text-shadow:0 5px 16px rgba(0,0,0,.35)}
.w h2{font-size:44px;font-weight:700;margin-top:14px}
.w p{font-size:26px;color:#DCEBFF;margin-top:10px;font-weight:600}
.w .ic{position:absolute;width:210px;height:210px;filter:drop-shadow(0 14px 18px rgba(0,0,0,.4))}
.w .l{left:34px;bottom:40px}
.w .r{right:34px;bottom:40px}
.w .gold{position:absolute;left:0;right:0;bottom:0;height:14px;background:linear-gradient(90deg,#B8861F,#F3D48A,#B8861F)}
</style></head><body>
<div class="w"><div class="pattern"></div>
  ${logosHtml(170)}
  <h1>ยินดีให้บริการ</h1>
  <h2>ศูนย์ช่วยเหลือประชาชนทางกฎหมาย</h2>
  <p>สภาทนายความจังหวัดสุพรรณบุรี ร่วมกับ อบจ.สุพรรณบุรี</p>
  <img class="ic l" src="${icon3d("balance_scale")}" alt=""><img class="ic r" src="${icon3d("classical_building")}" alt="">
  <div class="gold"></div>
</div>
</body></html>`;
}
