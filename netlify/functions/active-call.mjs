// Ascend ICT — active-call state reader (Netlify Functions v2)
//
// The engine polls this every 5 seconds to find out if there's an inbound
// call ringing for the rep. If yes, the engine auto-loads the lead.
//
// GET /api/active-call?email=adam@theagencytexas.com
//
// Returns: { active: bool, fubPersonId, fubLead, receivedAt, ageSec }
//
// Required env vars: ASCEND_AI_SECRET

import { getStore } from "@netlify/blobs";

const STALE_AFTER_MS = 5 * 60 * 1000; // 5 min — drop calls older than this

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Ascend-Secret",
  "Cache-Control": "no-cache, no-store, must-revalidate"
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: CORS });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });

  // Auth
  const provided = req.headers.get("x-ascend-secret");
  if (!process.env.ASCEND_AI_SECRET) return json({ error: "Server not configured: ASCEND_AI_SECRET missing" }, 500);
  if (provided !== process.env.ASCEND_AI_SECRET) return json({ error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  let email = (url.searchParams.get("email") || "").toLowerCase().trim();
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body.email) email = String(body.email).toLowerCase().trim();
    } catch (e) {}
  }
  if (!email) return json({ error: "email required" }, 400);

  try {
    const store = getStore("active-calls");
    const record = await store.get(email, { type: "json" });
    if (!record) {
      return json({ active: false, agentEmail: email });
    }
    const receivedAtMs = Date.parse(record.receivedAt) || 0;
    const ageSec = Math.round((Date.now() - receivedAtMs) / 1000);
    if (Date.now() - receivedAtMs > STALE_AFTER_MS) {
      try { await store.delete(email); } catch (e) {}
      return json({ active: false, agentEmail: email, reason: "stale" });
    }
    return json({
      active: true,
      agentEmail: email,
      fubPersonId: record.fubPersonId,
      fubLead: record.fubLead,
      callId: record.callId,
      direction: record.direction,
      status: record.status,
      leadPhone: record.leadPhone,
      receivedAt: record.receivedAt,
      ageSec,
      source: record.source || "callingly"
    });
  } catch (err) {
    return json({ error: "Read failed", detail: String(err).slice(0, 300) }, 500);
  }
};

export const config = {
  path: "/api/active-call"
};
