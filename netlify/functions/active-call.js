// Ascend ICT — active-call state reader
//
// The engine polls this every few seconds to find out if there's an
// inbound call ringing for the rep. If yes, the engine auto-loads the lead.
//
// GET /api/active-call?email=adam@theagencytexas.com
//
// Returns: { active: bool, fubPersonId, fubLead, receivedAt, ageSec }
//
// Required env vars: ASCEND_AI_SECRET (engine includes it as header on each poll)

const { getStore } = require("@netlify/blobs");

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ascend-Secret",
    "Cache-Control": "no-cache, no-store, must-revalidate"
  };
}

const STALE_AFTER_MS = 5 * 60 * 1000; // 5 min — drop calls older than this

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };

  // Auth
  const provided = (event.headers || {})["x-ascend-secret"] || (event.headers || {})["X-Ascend-Secret"];
  if (!process.env.ASCEND_AI_SECRET) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: ASCEND_AI_SECRET missing" }) };
  if (provided !== process.env.ASCEND_AI_SECRET) return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };

  const params = event.queryStringParameters || {};
  // Also accept POST body for emails with special chars
  let body = {};
  if (event.httpMethod === "POST" && event.body) {
    try { body = JSON.parse(event.body); } catch (e) {}
  }
  const email = (params.email || body.email || "").toLowerCase().trim();
  if (!email) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "email required" }) };

  try {
    const store = getStore("active-calls");
    const record = await store.get(email, { type: "json" });
    if (!record) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ active: false, agentEmail: email }) };
    }
    const receivedAtMs = Date.parse(record.receivedAt) || 0;
    const ageSec = Math.round((Date.now() - receivedAtMs) / 1000);
    if (Date.now() - receivedAtMs > STALE_AFTER_MS) {
      // Stale — clean up and return inactive
      try { await store.delete(email); } catch (e) {}
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ active: false, agentEmail: email, reason: "stale" }) };
    }
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
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
      })
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Read failed", detail: String(err).slice(0, 200) }) };
  }
};
