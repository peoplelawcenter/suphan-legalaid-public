process.env.SITE_URL = "https://example.test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseId, parsePage, parseQuery, isLiveBanner, isLivePost, isLiveDoc, mergePageMeta, safeSettings, loadView } from "../api/_site-data.js";
import { renderRichHtml, renderNotFound, renderUnavailable, fallbackChrome, renderSitemap, renderView } from "../api/_site-render.js";
import { DEFAULTS as SETTINGS_DEFAULTS } from "../api/_settings.js";
import { SITE_CONFIG_DEFAULTS, OFFICIAL_DOCS, LEGAL_NOTICE, DEFAULT_PAGES } from "../api/_site-shared.js";
import { fakeClient, fakeGetSettings, makeFixtures } from "./fixtures/site-fixtures.mjs";
import siteHandler, { csp } from "../api/site.js";
let n=0; const ok=(v,m)=>{assert.ok(v,m);n++}; const eq=(a,b,m)=>{assert.equal(a,b,m);n++};
eq(parseId("12"),12,"id ถูกต้อง"); eq(parseId("0"),null,"id ศูนย์ไม่ผ่าน"); eq(parsePage("501"),null,"page เกินเพดาน");
eq(parseQuery("  ข่าว*** ทดสอบ  "),"ข่าว ทดสอบ","คำค้นถูกทำความสะอาด");
const now=new Date("2026-10-02T00:00:00Z");
ok(isLiveBanner({active:true,starts_at:null,ends_at:null},now),"แบนเนอร์เปิดแสดง"); ok(!isLiveBanner({active:false},now),"แบนเนอร์ปิดไม่แสดง");
ok(isLivePost({status:"published",published_at:"2026-10-01T00:00:00Z"},now),"โพสต์เผยแพร่แล้ว"); ok(!isLivePost({status:"draft",published_at:"2026-10-01T00:00:00Z"},now),"ร่างไม่แสดง");
ok(isLiveDoc({active:true,published_at:"2026-10-01T00:00:00Z"},now),"เอกสารเผยแพร่แล้ว");
const pages=mergePageMeta([],false); ok(pages.some(x=>x.slug==="about")&&!pages.some(x=>x.slug==="privacy"),"ค่าเริ่มต้นแสดงเฉพาะหน้าที่เผยแพร่");
const clean=renderRichHtml('<p>ดี</p><script>alert(1)</script><img src=x onerror=alert(2)>').toString(); ok(clean.includes('<p>ดี</p>')&&!clean.includes('script')&&!clean.includes('onerror'),"HTML ถูก sanitize ซ้ำ");
const nf=renderNotFound({chrome:fallbackChrome()},{preview:false,now,path:"/missing"}).toString(); ok(nf.includes('404')&&nf.includes('/site.css')&&nf.includes('/site.js'),"หน้า 404 ใช้ layout จริง");
const sm=renderSitemap({chrome:{pages:[{slug:'about'},{slug:'cookies'}]},posts:[{id:7,category:'knowledge',published_at:now.toISOString()}]}); ok(sm.includes('https://example.test/knowledge/7')&&!sm.includes('<script'),"sitemap สร้าง URL ถูกต้อง");
ok(csp().includes("upgrade-insecure-requests"),"CSP บังคับอัปเกรดทรัพยากรเป็น HTTPS");
const previewRes={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v},status(c){this.statusCode=c;return this},send(v){this.body=v;return this},end(){return this},redirect(c,loc){this.statusCode=c;this.headers.Location=loc;return this}};
await siteHandler({method:"GET",query:{view:"missing",preview:"1"},headers:{}},previewRes);
eq(previewRes.statusCode,404,"ผู้ไม่มี session ที่ใส่ preview=1 เห็นผลแบบผู้ชมทั่วไป ไม่ใช่ 403");
// 5 ต.ค. 69 (minor 2): ขอ preview=1 ต้อง private, no-store เสมอ (CDN ไม่สนคุกกี้ — เดิม public ทำให้ผู้ดูแลเว็บได้หน้าในแคชแทนร่าง) · เนื้อหา/robots ยังเหมือนผู้ชมทั่วไป
eq(previewRes.headers["Cache-Control"],"private, no-store","preview=1 ที่ไม่มีสิทธิ์ห้าม CDN แคช");
ok(!previewRes.headers["X-Robots-Tag"],"preview ที่ไม่มีสิทธิ์ไม่ได้ header noindex แบบโหมดตัวอย่าง");
const publicRes={...previewRes,headers:{},statusCode:200};
await siteHandler({method:"GET",query:{view:"missing"},headers:{}},publicRes);
ok(publicRes.statusCode===404&&String(publicRes.headers["Cache-Control"]).startsWith("public"),"หน้าไม่มี preview ยังแคชแบบสาธารณะตามเดิม");
// 5 ต.ค. 69 (minor 5): ลิงก์เก่า /index.html (หน้าแรกเดิมก่อนเป็นเว็บไดนามิก) ต้องพาไปหน้าแรก ไม่ใช่ 404
const vercelCfg=JSON.parse(fs.readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
ok((vercelCfg.redirects||[]).some((r)=>r.source==="/index.html"&&r.destination==="/"&&r.permanent===true),"vercel.json redirect /index.html → / แบบถาวร");
ok(!fs.existsSync(new URL("../public/index.html",import.meta.url)),"ไม่มีไฟล์ public/index.html ค้าง (หน้าแรกมาจาก /api/site)");
// 5 ต.ค. 69 (minor 4 — บอสอนุมัติ): ฟอนต์โฮสต์เอง ห้ามมีคำขอไป Google Fonts (PDPA: IP ผู้ชมห้ามออกไป Google ก่อนยินยอม)
{
  const GOOGLE_FONTS=/fonts\.googleapis\.com|fonts\.gstatic\.com/;
  const apiDir=new URL("../api/",import.meta.url), pubDir=new URL("../public/",import.meta.url);
  const scanned=[...fs.readdirSync(apiDir).filter((f)=>/^(_site-.*|site)\.js$/.test(f)).map((f)=>new URL(f,apiDir)),
    ...fs.readdirSync(pubDir).filter((f)=>/\.(html|css|js)$/.test(f)).map((f)=>new URL(f,pubDir))];
  const leaks=scanned.filter((u)=>GOOGLE_FONTS.test(fs.readFileSync(u,"utf8"))).map((u)=>u.pathname.split("/").pop());
  eq(leaks.join(","),"","api/_site-*.js + public/*.html|css|js ไม่มีโดเมน Google Fonts");
  ok(!GOOGLE_FONTS.test(csp())&&csp().includes("font-src 'self'")&&/style-src 'self' 'unsafe-inline'(;|$)/.test(csp()),"CSP ฟอนต์/สไตล์เหลือ 'self' (ไม่มี Google)");
  const fontDir=new URL("../public/assets/fonts/",import.meta.url);
  const fontCss=fs.readFileSync(new URL("fonts.css",fontDir),"utf8");
  const urls=[...fontCss.matchAll(/url\(\.\/([^)]+)\)/g)].map((m)=>m[1]);
  ok(urls.length>=18&&urls.every((f)=>/\.v\d+\.woff2$/.test(f)&&fs.existsSync(new URL(f,fontDir))),"ทุก url() ใน fonts.css ชี้ไฟล์ woff2 ที่มีอยู่จริง และชื่อมีเวอร์ชัน");
  for(const [fam,w,st] of [["Prompt",500,"normal"],["Prompt",600,"normal"],["Prompt",700,"normal"],["Prompt",800,"normal"],["Prompt",400,"normal"],["Sarabun",400,"normal"],["Sarabun",600,"normal"],["Sarabun",700,"normal"],["Sarabun",400,"italic"]])
    ok(new RegExp(`font-family:'${fam}';font-style:${st};font-weight:${w};font-display:swap`).test(fontCss),`fonts.css มี ${fam} ${w} ${st} + swap`);
  ok(fs.existsSync(new URL("OFL-Prompt.txt",fontDir))&&fs.existsSync(new URL("OFL-Sarabun.txt",fontDir)),"มีไฟล์สัญญาอนุญาต OFL ของทั้งสองฟอนต์");
  const fontHdr=(vercelCfg.headers||[]).find((h)=>h.source==="/assets/fonts/(.*).woff2");
  ok(fontHdr&&fontHdr.headers.some((x)=>x.key==="Cache-Control"&&/immutable/.test(x.value)&&/max-age=31536000/.test(x.value)),"vercel.json ให้ไฟล์ฟอนต์ immutable 1 ปี");
  for(const f of ["appointment","consult","complaint","add-evidence","staff","staff-login","staff-register","broadcast"])
    ok(fs.readFileSync(new URL(`${f}.html`,pubDir),"utf8").includes('href="/assets/fonts/fonts.css"'),`${f}.html ใช้ฟอนต์โฮสต์เอง`);
}
const timeoutStart=Date.now();
const fallback=await safeSettings({getSettings:()=>new Promise(()=>{})},25);
ok(fallback.phone===SETTINGS_DEFAULTS.phone&&Date.now()-timeoutStart<500,"settings ไม่ตอบต้อง timeout แล้วใช้ค่าเริ่มต้น");

const tables=makeFixtures(now);
const ctx={client:fakeClient(tables),getSettings:fakeGetSettings(tables,SETTINGS_DEFAULTS),now,preview:false};
const cases=[
  ["home",{}],["news",{}],["post",{section:"news",id:"1"}],["knowledge",{}],
  ["faq",{}],["documents",{}],["about",{}],["services",{}],["contact",{}],["page",{slug:"history"}],
];
const html=[];
for(const [view,obj] of cases){
  const params=new URLSearchParams(obj);
  const model=await loadView(view,params,ctx);
  ok(model.kind==="page",`fixture ${view} โหลดได้`);
  const path=view==="home"?"/":view==="post"?"/news/1":view==="page"?"/page/history":`/${view}`;
  html.push(renderView(model,{preview:false,now,path}).toString());
}
const unavailable=renderUnavailable({chrome:fallbackChrome()},{preview:false,now,path:"/"}).toString();
html.push(nf,unavailable);
// 5 ต.ค. 69 (nit จาก code-reviewer): 404/503 ต้อง noindex + 503 ต้องมี description เดิมของศูนย์ · หน้าปกติห้าม noindex
ok(nf.includes('<meta name="robots" content="noindex" />')&&unavailable.includes('<meta name="robots" content="noindex" />'),"หน้า 404/503 มี meta robots noindex");
ok(!html[0].includes('name="robots"'),"หน้าแรกปกติไม่มี noindex");
ok(/<meta name="description" content="[^"]{20,}"/.test(unavailable)&&unavailable.includes(SITE_CONFIG_DEFAULTS.seo_description),"หน้า 503 มี description ข้อความเดิมของศูนย์");
// canonical ของผลค้นหาไม่พา ?q= (คง cat ไว้)
const searchModel=await loadView("news",new URLSearchParams({q:"ตัวอย่าง",cat:"news"}),ctx);
const searchHtml=renderView(searchModel,{preview:false,now,path:"/news"}).toString();
const canon=(/<link rel="canonical" href="([^"]+)"/.exec(searchHtml)||[])[1]||"";
ok(canon.startsWith("https://example.test/news")&&!canon.includes("q=")&&canon.includes("cat=news"),"canonical ผลค้นหาไม่มี q= แต่คงหมวด: "+canon);
// โหมดดูตัวอย่าง: html.is-preview + แถบข้อความ (class ต้องมีกฎ CSS — รวมเข้าชุดตรวจ class ด้านล่าง)
const previewHtml=renderView(await loadView("post",new URLSearchParams({section:"news",id:"1"}),{...ctx,preview:true}),{preview:true,now,path:"/news/1"}).toString();
ok(previewHtml.includes('class="no-js is-preview"')&&previewHtml.includes('class="preview-bar"')&&previewHtml.includes('content="noindex, nofollow"'),"โหมดดูตัวอย่างมีกรอบ/แถบบอก + noindex");
html.push(previewHtml);
// แกลเลอรี/ปุ่มคัดลอก: renderer ออก markup ที่ site.js ผูก (major 1) — ทดสอบการทำงานจริงด้วย scripts/check-site-interactive.mjs (Playwright)
const postHtml=html[2];
ok(/<ul class="gal-grid" data-gallery>/.test(postHtml)&&/<dialog class="lightbox" id="lightbox"/.test(postHtml)&&/data-lb-prev/.test(postHtml)&&/data-lb-next/.test(postHtml)&&/data-lb-close/.test(postHtml),"หน้าข่าวมีแกลเลอรี + dialog lightbox ครบปุ่ม");
ok(/data-copy="https:\/\/example\.test\/news\/1"[^>]*hidden/.test(postHtml),"ปุ่มคัดลอกส่งมาแบบ hidden (JS เปิดเอง)");
const siteJs=fs.readFileSync(new URL("../public/site.js",import.meta.url),"utf8");
ok(/qs\("#lightbox"\)/.test(siteJs)&&/showModal/.test(siteJs)&&/\[data-lb-prev\]/.test(siteJs)&&/ArrowRight/.test(siteJs)&&/opener\?\.focus\(\)/.test(siteJs),"site.js ผูก lightbox (เปิด/เลื่อน/คืนโฟกัส)");
ok(/qsa\("\[data-copy\]"\)/.test(siteJs)&&/clipboard\?\.writeText/.test(siteJs)&&/คัดลอกแล้ว/.test(siteJs),"site.js ผูกปุ่มคัดลอกลิงก์");
ok(/step === 0 \? 0/.test(siteJs)&&!/Number\(b\.dataset\.fs\) \+ 1/.test(siteJs),"ปุ่ม ก = กลับขนาดปกติ ไม่ใช่ +1 (minor 1)");
ok(html.every((page)=>page.includes('<link rel="stylesheet" href="/assets/fonts/fonts.css" />')&&page.includes('href="/assets/fonts/sarabun-thai-400-normal.v530.woff2" as="font" type="font/woff2" crossorigin')&&!/fonts\.(googleapis|gstatic)\.com/.test(page)),"ทุกหน้าที่เรนเดอร์ใช้ฟอนต์โฮสต์เอง + preload Sarabun ไทย ไม่มี Google Fonts");
ok(html.every((page)=>page.includes('href="/staff.html"')&&page.includes('สำหรับเจ้าหน้าที่')),"ทุกหน้ามีทางเข้าเจ้าหน้าที่ใน footer");
// 6 ต.ค. 69: เอกสารทางการ (ประกาศ อบจ. + MOU) เป็นไฟล์นิ่ง ไม่พึ่งฐาน — ต้องขึ้นหน้า /documents เสมอ + ลิงก์จาก /about + ไฟล์จริงตรงกับที่โค้ดประกาศ
const docsPage=html[cases.findIndex(([v])=>v==="documents")], aboutPage=html[cases.findIndex(([v])=>v==="about")];
eq(OFFICIAL_DOCS.length,2,"มีเอกสารทางการ 2 ฉบับ (ประกาศ + MOU)");
for(const d of OFFICIAL_DOCS){
  ok(/^\/assets\/official\/[a-z0-9-]+\.pdf$/.test(d.path),"ชื่อไฟล์เอกสารทางการเป็น ASCII ล้วน: "+d.path);
  const buf=fs.readFileSync(new URL("../public"+d.path,import.meta.url));
  eq(buf.subarray(0,5).toString("latin1"),"%PDF-","ไฟล์จริงเป็น PDF: "+d.path);
  eq(buf.length,d.bytes,"ขนาดไฟล์จริงตรงกับ OFFICIAL_DOCS.bytes: "+d.path);
  ok(docsPage.includes(`href="${d.path}"`)&&docsPage.includes("เอกสารทางการของศูนย์"),"หน้า /documents ลิงก์เอกสารทางการ: "+d.key);
  ok(aboutPage.includes(`href="${d.path}"`),"หน้า /about ลิงก์เอกสารทางการ: "+d.key);
}
// 6 ต.ค. 69: "ข้อควรทราบ" (ประกาศ ข้อ 6–7 + MOU ข้อ 8) — ต้องอยู่ในโค้ด ไม่ผ่าน CMS และขึ้นทุกหน้า/ฟอร์ม
eq(LEGAL_NOTICE.items.length,5,"ข้อควรทราบ 5 ข้อ");
ok(LEGAL_NOTICE.items.some((t)=>t.includes("ไม่ถือเป็นการรับว่าความ"))&&LEGAL_NOTICE.items.some((t)=>t.includes("ไม่เป็นการรับรอง"))&&LEGAL_NOTICE.items.some((t)=>t.includes("ไม่ได้เป็นผู้ให้คำปรึกษาทางกฎหมาย")),"ข้อควรทราบมีใจความข้อ 6, ข้อ 7 และ MOU ข้อ 8 ครบ");
ok(!LEGAL_NOTICE.items.concat(LEGAL_NOTICE.short).some((t)=>/ฟรี|ไม่มีค่าใช้จ่าย|ครับ/.test(t)),"ข้อควรทราบไม่เติมคำสัญญาที่เอกสารไม่ได้เขียน (ฟรี) และไม่ใช้ 'ครับ'");
ok(aboutPage.includes('id="notice"')&&LEGAL_NOTICE.items.every((t)=>aboutPage.includes(t.slice(0,40))),"หน้า /about มีกล่องข้อควรทราบครบ 5 ข้อ (id=notice)");
ok(html.every((page)=>page.includes('class="footer-notice"')&&page.includes('href="/about#notice"')),"ทุกหน้ามีข้อความสั้นข้อควรทราบ + ลิงก์ใน footer");
for(const f of ["consult","complaint","appointment"]){const src=fs.readFileSync(new URL(`../public/${f}.html`,import.meta.url),"utf8");ok(src.includes(LEGAL_NOTICE.short)&&src.includes('/about#notice'),`ฟอร์ม ${f}.html มีข้อควรทราบ (ถ้อยคำตรง LEGAL_NOTICE.short)`);}
ok(DEFAULT_PAGES.privacy.published===false,"ร่างนโยบายข้อมูลส่วนบุคคลยังไม่เผยแพร่เอง (รอผู้มีอำนาจตรวจ)");
ok(!docsPage.includes("ยังไม่มีเอกสารเผยแพร่"),"/documents ไม่ขึ้น 'ยังไม่มีเอกสาร' เมื่อมีเอกสารทางการ");
const emptyDocs=renderView(await loadView("documents",new URLSearchParams(),{...ctx,client:fakeClient({...tables,site_documents:[]})}),{preview:false,now,path:"/documents"}).toString();
ok(emptyDocs.includes(OFFICIAL_DOCS[0].path)&&emptyDocs.includes(OFFICIAL_DOCS[1].path),"ฐานไม่มีเอกสารเลย เอกสารทางการยังขึ้นครบ");
const used=new Set();
for(const page of html)for(const m of page.matchAll(/class="([^"]+)"/g))for(const cls of m[1].split(/\s+/))if(/^[a-zA-Z][\w-]*$/.test(cls))used.add(cls);
const css=fs.readFileSync(new URL("../public/site.css",import.meta.url),"utf8");
const styled=new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m)=>m[1]));
const intentionallyUnstyled=[];
const missing=[...used].filter((cls)=>!styled.has(cls)&&!intentionallyUnstyled.includes(cls)).sort();
eq(missing.join(","),"","ทุก class จาก renderer ต้องมีกฎใน site.css หรืออยู่ใน intentionallyUnstyled");
console.log(`✅ test-site.mjs ผ่านทั้งหมด (${n} ข้อตรวจ)`);
