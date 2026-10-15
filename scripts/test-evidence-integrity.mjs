/* Offline regression for concurrent file appends and failed-form cleanup. Real case/form services,
   synthetic PostgREST/Storage only; all unexpected requests fail before reaching any network. */
import assert from "node:assert/strict";
import { Readable } from "node:stream";

process.env.SUPABASE_URL = "http://evidence-integrity.invalid";
process.env.SUPABASE_SERVICE_KEY = "test-evidence-key-only";
process.env.FORM_SECRET = "test-evidence-form-secret-only";

const state = { row: null, events: [], snapshots: 0, gate: null, release: null, beforePatch: null, patches: 0, storage: new Map(), removes: 0 };
function reset(extra = {}, parallel = false) {
  state.row = { id: 42, status: "in_progress", evidence_paths: ["Usynthetic/original.pdf"], resolution_paths: [], ...extra };
  state.events = [];
  state.snapshots = 0;
  state.beforePatch = null;
  state.patches = 0;
  state.gate = parallel ? new Promise((resolve) => { state.release = resolve; }) : null;
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const copy = (value) => JSON.parse(JSON.stringify(value));
function matches(row, key, value) {
  if (value === "is.null") return row[key] == null;
  if (!value.startsWith("eq.")) throw new Error("unexpected filter");
  const expected = value.slice(3);
  if (key.endsWith("_paths")) return JSON.stringify(row[key]) === JSON.stringify(JSON.parse("[" + expected.slice(1, -1) + "]"));
  return String(row[key]) === expected;
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  assert.equal(url.origin, "http://evidence-integrity.invalid", "no real services may be called");
  const object = new Headers(options.headers).get("Accept")?.includes("vnd.pgrst.object+json");
  if (url.pathname === "/rest/v1/cases") {
    const filtered = () => state.row && [...url.searchParams].every(([key, value]) => key === "select" || matches(state.row, key, value));
    if (options.method === "PATCH") {
      state.patches++;
      if (state.beforePatch) state.beforePatch();
      if (!filtered()) return json([]);
      Object.assign(state.row, JSON.parse(options.body));
      return json(object ? copy(state.row) : [copy(state.row)]);
    }
    const snapshot = filtered() ? copy(state.row) : null;
    state.snapshots++;
    // Both initial readers must hold the same snapshot before either writer can proceed.
    if (state.gate && state.snapshots <= 2) {
      if (state.snapshots === 2) state.release();
      await state.gate;
    }
    return json(object ? snapshot : snapshot ? [snapshot] : []);
  }
  if (url.pathname === "/rest/v1/case_events") {
    state.events.push(JSON.parse(options.body));
    return json(null, 201);
  }
  if (url.pathname === "/rest/v1/rpc/next_case_no") return json({ code: "XX001", message: "synthetic sequence failure" }, 400);
  if (url.pathname.startsWith("/storage/v1/object/evidence/")) {
    const path = decodeURIComponent(url.pathname.slice("/storage/v1/object/evidence/".length));
    assert.ok(state.storage.has(path), "only existing synthetic evidence can be downloaded");
    return new Response(state.storage.get(path), { status: 200, headers: { "Content-Type": "application/pdf" } });
  }
  if (url.pathname === "/storage/v1/object/evidence" && options.method === "DELETE") {
    state.removes++;
    for (const path of JSON.parse(options.body).prefixes) state.storage.delete(path);
    return json([]);
  }
  throw new Error("unexpected synthetic-service path: " + url.pathname);
};

try {
  const { addEvidenceFiles, addResolutionFiles, MAX_TOTAL_EVIDENCE } = await import("../api/_cases.js");
  reset({}, true);
  const special = 'Usynthetic/comma,quote"slash\\tail.pdf';
  await Promise.all([addEvidenceFiles(42, [special]), addEvidenceFiles(42, ["Usynthetic/second.pdf"])]);
  assert.deepEqual(new Set(state.row.evidence_paths), new Set(["Usynthetic/original.pdf", special, "Usynthetic/second.pdf"]));
  assert.equal(state.events.length, 2, "both successful writers are audited after persistence");
  assert.equal(state.patches, 3, "losing compare-and-swap retries against the latest array");
  await addEvidenceFiles(42, [special, special]);
  assert.equal(state.row.evidence_paths.length, 3, "repeat file submission does not duplicate paths");
  assert.equal(state.events.length, 2, "no false audit event for duplicate-only submission");

  reset({ status: "closed", resolution_paths: ["staff/original.pdf"] }, true);
  await Promise.all([addResolutionFiles(42, "1", ["staff/a.pdf"]), addResolutionFiles(42, "2", ["staff/b.pdf"])]);
  assert.deepEqual(new Set(state.row.resolution_paths), new Set(["staff/original.pdf", "staff/a.pdf", "staff/b.pdf"]));
  assert.equal(state.events.length, 2, "closed cases still accept staff resolution documents per existing behavior");

  reset();
  state.beforePatch = () => { state.row.status = "closed"; state.beforePatch = null; };
  await assert.rejects(addEvidenceFiles(42, ["Usynthetic/too-late.pdf"]), /ปิด\/ยกเลิก/);
  assert.equal(state.row.evidence_paths.length, 1, "closure during upload prevents append after reload");
  assert.equal(state.events.length, 0);

  reset({ evidence_paths: Array.from({ length: MAX_TOTAL_EVIDENCE - 1 }, (_, i) => `Usynthetic/${i}.pdf`) });
  await addEvidenceFiles(42, ["Usynthetic/last.pdf", "Usynthetic/overflow.pdf"]);
  assert.equal(state.row.evidence_paths.length, MAX_TOTAL_EVIDENCE);
  assert.equal(state.row.evidence_paths.includes("Usynthetic/overflow.pdf"), false, "existing cap semantics retained");
  assert.match(state.events[0].note, /^\+1 /, "audit counts accepted files, not the discarded overflow");

  reset({ evidence_paths: null });
  await addEvidenceFiles(42, ["Usynthetic/null-array.pdf"]);
  assert.deepEqual(state.row.evidence_paths, ["Usynthetic/null-array.pdf"], "nullable legacy array is compared with IS NULL");

  reset();
  state.beforePatch = () => { state.row.evidence_paths.push(`Usynthetic/concurrent-${state.patches}.pdf`); };
  await assert.rejects(addEvidenceFiles(42, ["Usynthetic/not-persisted.pdf"]), /พร้อมกัน/);
  assert.equal(state.patches, 5, "contention has a bounded retry budget");
  assert.equal(state.row.evidence_paths.includes("Usynthetic/not-persisted.pdf"), false);
  assert.equal(state.events.length, 0, "failed append never logs success");

  reset();
  state.row = null;
  await assert.rejects(addEvidenceFiles(42, ["Usynthetic/missing.pdf"]), /ไม่พบเรื่อง/);

  // A new/retried form may reference a path already attached to an older case. A failed create must
  // preserve that object; this reproduces the previous unconditional deletion through the real handler.
  reset({ citizen_line_uid: "Usynthetic" });
  state.storage.set("Usynthetic/original.pdf", Buffer.from("%PDF-synthetic-file"));
  const { default: formHandler } = await import("../api/form.js");
  const { makeFormToken } = await import("../api/_formauth.js");
  const req = Readable.from([Buffer.from(JSON.stringify({
    k: makeFormToken("Usynthetic", "complaint"), formType: "complaint", pdpaConsent: true,
    detail: "Synthetic form", evidencePaths: ["Usynthetic/original.pdf"],
  }))]);
  req.method = "POST";
  req.url = "/api/form";
  req.headers = {};
  let status, payload;
  const res = { status(code) { status = code; return this; }, setHeader() { return this; }, send(body) { payload = JSON.parse(body); } };
  const realError = console.error;
  console.error = () => {}; // Expected synthetic sequence failure; avoid unnecessary error output.
  try { await formHandler(req, res); } finally { console.error = realError; }
  assert.equal(status, 500);
  assert.equal(payload.ok, false);
  assert.equal(state.removes, 0, "failed submit must never delete a potentially referenced object");
  assert.ok(state.storage.has(state.row.evidence_paths[0]), "the older case retains readable evidence");
  console.log("PASS evidence concurrency, path escaping, idempotency, closure, cap, nullable arrays, contention and failed-form preservation");
} finally {
  globalThis.fetch = realFetch;
}
