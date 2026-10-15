// Offline contract checks for the new CMS client; no browser, database or credentials.
import assert from "node:assert/strict";
import { thaiDateTimeText, youtubeEmbedUrl, fitWithin, IMAGE_RULES, moveInArray, previewUrl, fixQuillSpaces, docTypeOf } from "../public/cms-utils.js";
import { uploadBlob, checkDocument } from "../public/cms-media.js";
import { createRichEditor } from "../public/cms-editor.js";

assert.match(thaiDateTimeText("2026-10-06T09:30"), /2569.*09\.30/);
assert.equal(thaiDateTimeText("2026-02-30T09:30"), "");
assert.equal(thaiDateTimeText("2026-10-06T25:30"), "");
assert.equal(youtubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
assert.equal(youtubeEmbedUrl("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ"), null);
assert.equal(youtubeEmbedUrl("javascript:alert(1)"), null);
assert.deepEqual(fitWithin(4000, 2000, IMAGE_RULES.cover), { w: 1600, h: 800 });
assert.deepEqual(fitWithin(300, 200, IMAGE_RULES.banner), { w: 300, h: 200 });
const order = [1, 2, 3];
assert.deepEqual(moveInArray(order, 1, -1), [2, 1, 3]);
assert.deepEqual(order, [1, 2, 3]);
assert.equal(moveInArray(order, 0, -1), null);
assert.equal(previewUrl("posts", { id: 5, category: "knowledge" }), "/knowledge/5?preview=1");
assert.equal(previewUrl("posts", {}), null);
assert.equal(fixQuillSpaces('<p title="a&nbsp;b">a&nbsp;b</p>'), '<p title="a&nbsp;b">a b</p>');
const docTypes = { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };
assert.equal(docTypeOf("file.docx", "", docTypes), Object.keys(docTypes)[0]);
assert.throws(() => checkDocument({ name: "sample.pdf", size: 101 }, "doc", { uploadKinds: { doc: { types: ["application/pdf"], maxBytes: 100 } } }, "application/pdf"), /เกิน/);

const realFetch = globalThis.fetch;
const realWindow = globalThis.window;
const realDocument = globalThis.document;
try {
  let received;
  globalThis.fetch = async () => new Response(JSON.stringify({ supabaseUrl: "https://upload.invalid", supabaseAnonKey: "test-public-key" }));
  globalThis.window = { supabase: { createClient: () => ({ storage: { from: (bucket) => {
    assert.equal(bucket, "site-media");
    return { uploadToSignedUrl: async (path, token, blob, options) => { received = { path, token, blob, options }; return { error: null }; } };
  } } }) } };
  const fakeApi = async (action, options) => {
    assert.equal(action, "cms-upload-url");
    assert.equal(options.body.contentType, "application/pdf");
    return { ok: true, path: "site/doc/test.pdf", token: "test-signature", publicUrl: "https://upload.invalid/test.pdf" };
  };
  await uploadBlob(fakeApi, "doc", new Blob(["%PDF-test"], { type: "" }), "application/pdf");
  assert.equal(received.blob.type, "application/pdf");
  assert.equal(received.options.contentType, "application/pdf");
  assert.equal(await received.blob.text(), "%PDF-test");
  await assert.rejects(uploadBlob(async () => ({ ok: false, error: "signed upload unavailable" }), "doc", new Blob(), "application/pdf"), /signed upload unavailable/);

  // A rejected inline upload must unblock Save; callback state stays balanced.
  const busy = [], errors = [];
  let rejectUpload;
  globalThis.document = { createElement: () => ({}) };
  window.Quill = class {
    constructor(_box, options) { this.options = options; }
    on() {}
    getSelection() { return { index: 0 }; }
    getLength() { return 2; }
  };
  const editor = createRichEditor({ append() {}, querySelector: () => null }, {
    uploadImage: () => new Promise((_resolve, reject) => { rejectUpload = reject; }),
    onBusy: (on) => busy.push(on), onError: (msg) => errors.push(msg),
  });
  const pending = editor.quill.options.modules.uploader.handler({ index: 0 }, [new Blob(["test"], { type: "image/png" })]);
  assert.equal(editor.isUploading(), true);
  rejectUpload(new Error("upload failed"));
  await pending;
  assert.equal(editor.isUploading(), false);
  assert.deepEqual(busy, [true, false]);
  assert.deepEqual(errors, ["upload failed"]);
} finally {
  globalThis.fetch = realFetch;
  globalThis.window = realWindow;
  globalThis.document = realDocument;
}
console.log("✅ test-cms-ui.mjs: offline date, media, preview and upload failure contracts passed");
