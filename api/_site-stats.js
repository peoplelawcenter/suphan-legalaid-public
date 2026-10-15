/* Aggregate views + consented, pseudonymous browsers. Never store IPs, URLs or case data. */
import { createHash } from "node:crypto";
import { db } from "./_db.js";

export const STATS_TIMEOUT_MS = 4000;
export function isViewId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function visitorHash(value) {
  if (value === null || value === undefined) return null;
  if (!isViewId(value)) throw new Error("invalid visitor");
  return createHash("sha256").update(value.toLowerCase()).digest("hex");
}
const BOT = /bot|crawler|spider|slurp|facebookexternalhit|preview|headless/i;
export function isStatsBot(req) {
  return BOT.test(String(req.headers?.["user-agent"] || "")) ||
    /prefetch|prerender/i.test(String(req.headers?.["sec-purpose"] || req.headers?.purpose || ""));
}
export function isPublicStatsPath(value) {
  return typeof value === "string" && (value === "/" ||
    /^\/(?:news|knowledge|faq|documents|about|services|contact)$/.test(value) ||
    /^\/(?:news|knowledge)\/[1-9]\d{0,14}$/.test(value) ||
    /^\/page\/[a-z][a-z0-9-]{1,39}$/.test(value));
}
export function sameOriginStatsRequest(req) {
  const site = req.headers?.["sec-fetch-site"];
  if (site && site !== "same-origin") return false;
  try {
    const origin = new URL(req.headers?.origin);
    return /^(https?:)$/.test(origin.protocol) && origin.host === req.headers?.host;
  } catch { return false; }
}
export function normalizeStats(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error("invalid stats");
  const count = (v) => {
    if (typeof v !== "number" && !(typeof v === "string" && /^\d+$/.test(v))) throw new Error("invalid count");
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("invalid count");
    return n;
  };
  const today = count(row.today), month = count(row.month), total = count(row.total);
  const visitors_today = count(row.visitors_today), visitors_month = count(row.visitors_month), visitors_total = count(row.visitors_total);
  const validDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (today > month || month > total || visitors_today > visitors_month || visitors_month > visitors_total || visitors_today > today || visitors_month > month || visitors_total > total || !validDate(row.date) || !validDate(row.since) || row.since > row.date) throw new Error("invalid stats");
  return { today, month, total, visitors_today, visitors_month, visitors_total, date: row.date, since: row.since };
}
export async function loadStats(record = false, hash = null, viewId = null, client = db) {
  const { data, error } = await client().rpc(record ? "record_site_view" : "get_site_stats", record ? { p_view_id: viewId, p_visitor_hash: hash } : {})
    .abortSignal(AbortSignal.timeout(STATS_TIMEOUT_MS));
  if (error) throw new Error("stats unavailable");
  return normalizeStats(data);
}
