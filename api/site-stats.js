import { isStatsBot, isPublicStatsPath, sameOriginStatsRequest, isViewId, visitorHash, loadStats } from "./_site-stats.js";

// Separate from cached SSR: visits served from the CDN must still be counted.
export function createStatsHandler(read = loadStats) {
  return async function handler(req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    const send = (code, body) => res.status(code).send(JSON.stringify(body));
    if (!["GET", "HEAD", "POST"].includes(req.method)) {
      res.setHeader("Allow", "GET, HEAD, POST");
      return send(405, { ok: false });
    }
    const record = req.method === "POST";
    let hash = null;
    let viewId = null;
    if (record) {
      if (!sameOriginStatsRequest(req)) return send(403, { ok: false });
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.["content-type"] || "")) return send(415, { ok: false });
      let body = req.body;
      if (typeof body === "string") {
        if (body.length > 256) return send(413, { ok: false });
        try { body = JSON.parse(body); } catch { return send(400, { ok: false }); }
      }
      if (!body || !isPublicStatsPath(body.path) || !isViewId(body.viewId) || Object.keys(body).some((k) => !["path", "visitorId", "viewId"].includes(k))) return send(400, { ok: false });
      viewId = body.viewId;
      try { hash = visitorHash(body.visitorId); } catch { return send(400, { ok: false }); }
      if (isStatsBot(req)) return res.status(204).end();
    }
    try {
      const stats = await read(record, hash, viewId);
      if (!record) res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=60");
      if (req.method === "HEAD") return res.status(200).end();
      return send(200, { ok: true, stats });
    } catch {
      // Do not expose DB errors or manufacture zero counts when unavailable.
      return send(503, { ok: false, error: "สถิติไม่พร้อมใช้งานชั่วคราว" });
    }
  };
}
export default createStatsHandler();
