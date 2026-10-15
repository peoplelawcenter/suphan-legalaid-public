/* Offline API regression: editing staff must never serialize authentication/private columns.
   Uses the real handler and session validation with synthetic PostgREST responses. No network access. */
import assert from "node:assert/strict";
import { Readable } from "node:stream";

process.env.SUPABASE_URL = "http://staff-response.invalid";
process.env.SUPABASE_SERVICE_KEY = "test-service-key-only";
process.env.STAFF_SECRET = "test-staff-response-secret-only";

const rows = [
  { id: 1, display_name: "Test admin", role: "admin", active: true, approved_at: "2026-01-01T00:00:00Z" },
  {
    id: 2, display_name: "Test staff", role: "staff", active: true, approved_at: "2026-01-01T00:00:00Z",
    email: "staff@example.invalid", notify_email: false, notify_line: true,
    notify_categories: ["debt"], can_edit_site: false,
    password_hash: "synthetic-password-hash", otp_hash: "synthetic-otp-hash",
    otp_attempts: 1, otp_expires_at: "2099-01-01T00:00:00Z",
    google_sub: "synthetic-google-id", facebook_id: "synthetic-facebook-id", line_uid: "synthetic-line-id",
    avatar_data: "synthetic-avatar", phone: "synthetic-private-phone", future_private_column: "synthetic-private-value",
  },
];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  assert.equal(url.origin, "http://staff-response.invalid", "test must not access real services");
  assert.equal(url.pathname, "/rest/v1/staff", "only synthetic staff queries expected");
  const id = Number((url.searchParams.get("id") || "").replace(/^eq\./, ""));
  const found = rows.filter((row) => row.id === id);
  if (options.method === "PATCH") {
    const patch = JSON.parse(options.body);
    for (const row of found) Object.assign(row, patch);
  }
  const select = url.searchParams.get("select") || "*";
  const view = (row) => select === "*" ? { ...row } : Object.fromEntries(select.split(",").map((key) => [key, row[key]]));
  const headers = new Headers(options.headers);
  const response = headers.get("Accept")?.includes("vnd.pgrst.object+json") ? view(found[0]) : found.map(view);
  return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
};

try {
  const { default: handler } = await import("../api/staff.js");
  const { makeSessionToken, COOKIE_NAME } = await import("../api/_staffauth.js");
  async function update(asId, body) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = "POST";
    req.url = "/api/staff?action=staff-update";
    req.headers = { cookie: `${COOKIE_NAME}=${encodeURIComponent(makeSessionToken(asId))}` };
    let status, payload;
    const res = {
      status(code) { status = code; return this; },
      setHeader() { return this; },
      send(value) { payload = JSON.parse(value); },
    };
    await handler(req, res);
    return { status, payload };
  }
  const changed = await update(1, { id: 2, patch: { notify_email: true } });
  assert.equal(changed.status, 200);
  assert.equal(changed.payload.ok, true);
  assert.deepEqual(changed.payload.row, {
    id: 2, display_name: "Test staff", role: "staff", active: true, email: "staff@example.invalid",
    notify_line: true, notify_email: true, notify_categories: ["debt"], can_edit_site: false,
  }, "response must contain only safe management fields, excluding current and future private columns");
  assert.equal(rows[1].notify_email, true, "real update path still persists the requested preference");
  assert.equal(rows[1].password_hash, "synthetic-password-hash", "edit preserves authentication data");

  // Optional columns may not exist before migrations; editing a legacy preference still works.
  delete rows[1].can_edit_site;
  delete rows[1].notify_categories;
  const legacy = await update(1, { id: 2, patch: { notify_line: false } });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.payload.row.notify_line, false);
  assert.equal(Object.hasOwn(legacy.payload.row, "password_hash"), false);
  assert.equal(Object.hasOwn(legacy.payload.row, "can_edit_site"), false);

  const denied = await update(2, { id: 1, patch: { notify_email: false } });
  assert.equal(denied.status, 403, "ordinary staff cannot edit staff management");
  assert.equal(Object.hasOwn(denied.payload, "row"), false);
  const self = await update(1, { id: 1, patch: { active: false } });
  assert.equal(self.status, 400, "admin self-lockout protection remains intact");
  const missing = await update(1, { id: 999, patch: { notify_email: true } });
  assert.equal(missing.status, 200);
  assert.equal(missing.payload.row, null, "missing staff retains existing response behavior");
  console.log("PASS staff-update response privacy, persistence, legacy columns, role checks and self-lockout");
} finally {
  globalThis.fetch = realFetch;
}
