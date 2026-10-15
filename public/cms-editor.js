/* public/cms-editor.js — ตัวแก้ข้อความ Quill 2.0.3 ของหน้า CMS (สเปก docs/WEBSITE-SPEC.md ข้อ 5.4)
   6 ต.ค. 69: แทนช่อง "เนื้อหา HTML" ดิบของรุ่นแรก — เจ้าหน้าที่ที่ไม่ใช่สายเทคจัดรูปแบบเองได้บนมือถือ
   - โหลด Quill จาก jsDelivr แบบ pin เวอร์ชัน + integrity (ดู cms.html) · โหลดไม่ขึ้น = แจ้งผู้ใช้ ไม่พังเงียบ
   - toolbar ตามสเปก: หัวข้อ 2/3 · ตัวหนา/เอียง/ขีดเส้นใต้ · ลิงก์ · อ้างอิง · รายการ · จัดแนว · รูป · วิดีโอ YouTube · ล้างรูปแบบ
   - formats จำกัดเท่าที่ toolbar มี → วางข้อความจาก Word/เว็บอื่นแล้วสี/ฟอนต์ไม่ติดมา (เซิร์ฟเวอร์ตัดทิ้งอยู่แล้ว ตัวแก้จะได้ตรงกับหน้าเว็บจริง)
   - รูป: ปุ่มแทรกรูป / วาง / ลากไฟล์ → ย่อ + อัปโหลดผ่านระบบเรา (ไม่ใช้ค่าเริ่มต้นของ Quill ที่ฝังรูปเป็น base64 — เซิร์ฟเวอร์จะตัดทิ้งเงียบๆ)
   - บันทึกด้วย getSemanticHTML() แล้วคืนช่องว่างปกติด้วย fixQuillSpaces() (Quill 2.0.3 แปลงทุกช่องว่างเป็น &nbsp;)
   - ใส่เนื้อหาเดิมด้วย clipboard.convert({html}) — HTML ที่ใส่เข้ามาคือ body_html/answer_html ที่เซิร์ฟเวอร์ sanitize แล้วเท่านั้น */
import { fixQuillSpaces, youtubeEmbedUrl } from "./cms-utils.js";

const TOOLBAR = [
  [{ header: [2, 3, false] }],
  ["bold", "italic", "underline"],
  ["link", "blockquote"],
  [{ list: "ordered" }, { list: "bullet" }],
  [{ align: [] }],
  ["image", "video"],
  ["clean"],
];
const FORMATS = ["header", "bold", "italic", "underline", "link", "blockquote", "list", "indent", "align", "image", "video"];
const TITLES = { // ปุ่มไอคอนต้องมีชื่อภาษาไทย (ผู้ใช้ทั่วไปเดาไอคอนไม่ออก + โปรแกรมอ่านหน้าจอ)
  ".ql-header .ql-picker-label": "รูปแบบหัวข้อ", "button.ql-bold": "ตัวหนา", "button.ql-italic": "ตัวเอียง", "button.ql-underline": "ขีดเส้นใต้",
  "button.ql-link": "แทรกลิงก์", "button.ql-blockquote": "ข้อความอ้างอิง", "button.ql-list[value=ordered]": "รายการลำดับเลข",
  "button.ql-list[value=bullet]": "รายการสัญลักษณ์", ".ql-align .ql-picker-label": "จัดแนวข้อความ", "button.ql-image": "แทรกรูป",
  "button.ql-video": "แทรกวิดีโอ YouTube", "button.ql-clean": "ล้างรูปแบบ",
};
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"];

export function quillReady() {
  return typeof window.Quill === "function";
}

/* host = กล่องว่างที่จะวางตัวแก้ · opts: { placeholder, onChange(), uploadImage(file) → Promise<{publicUrl}>, askVideo() → Promise<string|null>,
   onError(msg), onBusy(true, ข้อความ) ตอนเริ่มอัปโหลดรูป, onInserted() เมื่อแทรกรูปสำเร็จ } */
export function createRichEditor(host, opts = {}) {
  const box = document.createElement("div");
  host.append(box);
  const quill = new window.Quill(box, {
    theme: "snow",
    placeholder: opts.placeholder || "พิมพ์เนื้อหาที่นี่…",
    formats: FORMATS,
    modules: {
      toolbar: {
        container: TOOLBAR,
        handlers: {
          image: () => pickImage(),
          video: () => insertVideo(),
        },
      },
      uploader: { mimetypes: IMAGE_TYPES, handler: (range, files) => uploadFiles(range, files) },
    },
  });
  const toolbar = host.querySelector(".ql-toolbar");
  for (const [sel, title] of Object.entries(TITLES)) {
    toolbar?.querySelectorAll(sel).forEach((b) => { b.title = title; b.setAttribute("aria-label", title); });
  }
  quill.on("text-change", (_d, _o, source) => { if (source === "user") opts.onChange?.(); });

  let uploading = 0;
  async function uploadFiles(range, files) {
    const list = [...files].filter((f) => /^image\//.test(f.type || "") || /\.(heic|heif)$/i.test(f.name || ""));
    let index = (range || quill.getSelection(true) || { index: quill.getLength() }).index;
    for (const file of list) {
      uploading++;
      opts.onBusy?.(true, `กำลังย่อและอัปโหลดรูป “${file.name}”…`);
      try {
        const up = await opts.uploadImage(file);
        quill.insertEmbed(index, "image", up.publicUrl, "user");
        index += 1;
        quill.setSelection(index, 0, "silent");
        opts.onInserted?.();
      } catch (e) {
        opts.onError?.(e.message || "แทรกรูปไม่สำเร็จ");
      } finally {
        uploading--;
        opts.onBusy?.(false);
      }
    }
  }
  function pickImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.addEventListener("change", () => { if (input.files?.length) uploadFiles(quill.getSelection(true), input.files); });
    input.click();
  }
  async function insertVideo() {
    const range = quill.getSelection(true);
    const raw = await opts.askVideo?.();
    if (raw == null) return;
    const url = youtubeEmbedUrl(raw);
    if (!url) return opts.onError?.("ลิงก์วิดีโอไม่ถูกต้อง — รองรับลิงก์ YouTube เช่น https://www.youtube.com/watch?v=… หรือ https://youtu.be/…");
    const at = range ? range.index : quill.getLength();
    quill.insertEmbed(at, "video", url, "user");
    quill.setSelection(at + 1, 0, "silent");
  }

  return {
    quill,
    setHTML(html) {
      const delta = quill.clipboard.convert({ html: String(html || "") });
      quill.setContents(delta, "silent");
      quill.history.clear();
    },
    getHTML() {
      if (quill.getLength() <= 1) return "";
      return fixQuillSpaces(quill.getSemanticHTML());
    },
    isUploading: () => uploading > 0,
    focus: () => quill.focus(),
  };
}
