// Ascend ICT — Callingly webhook receiver
//
// Callingly fires this when an inbound call rings/connects/completes.
// We extract the agent email + lead phone, look up the FUB person ID,
// and write {agentEmail, fubPersonId, ringingAt, callId, status} into
// Netlify Blobs so the engine's active-call.js endpoint can read it.
//
// Required env vars:
//   FUB_API_KEY                — to look up the lead by phone
//   CALLINGLY_WEBHOOK_SECRET   — shared secret in the webhook URL or header
//
// Set up in Callingly:
//   Webhook URL: https://conversionengine.netlify.app/api/callingly-event?secret=YOUR_SECRET
//   Events: call.received, call.connected, call.completed (or whatever Callingly exposes)

const { getStore } = require("@netlify/blobs");

const FUB_API_BASE = "https://api.followupboss.com/v1";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Callingly-Signature"
  };
}

function fubAuth() {
  return "Basic " + Buffer.from(`${process.env.FUB_API_KEY}:`).toString("base64");
}

// Look up FUB person by phone. Returns FUB person ID or null.
async function lookupFubPersonByPhone(phone) {
  if (!phone) return null;
  const clean = String(phone).replace(/[^\d]/g, "");
  if (clean.length < 10) return null;
  const last10 = clean.slice(-10);
  try {
    const res = await fetch(`${FUB_API_BASE}/people?phone=${encodeURIComponent(last10)}&fields=allFields&limit=5`, {
      headers: {
        "Authorization": fubAuth(),
        "Accept": "application/json",
        "X-System": "AscendICT"
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const people = data.people || [];
    return people.length ? {
      id: people[0].id,
      firstName: people[0].firstName || "",
      lastName: people[0].lastName || "",
      name: people[0].name || "",
      email: (people[0].emails && people[0].emails[0] && people[0].emails[0].value) || "",
      source: people[0].source || "",
      stage: people[0].stage || ""
    } : null;
  } catch (e) {
    console.warn("FUB person lookup failed:", e);
    return null;
  }
}

// Pull all the possible field locations Callingly might use. They differ by plan / event type.
function extractCallData(body) {
  const root = body || {};
  const call = root.call || root.payload || root.data || root;
  const agent = call.agent || call.user || call.assignee || root.agent || {};
  const lead = call.lead || call.contact || call.person || root.lead || {};
  return {
    eventType: root.event || root.type || call.event || call.type || "unknown",
    callId: call.id || call.call_id || call.callId || root.id || null,
    agentEmail: (agent.email || agent.user_email || agent.username || call.agent_email || "").toLowerCase().trim(),
    leadPhone: call.lead_phone || call.phone || lead.phone || lead.phone_number || (lead.phones && lead.phones[0] && (lead.phones[0].value || lead.phones[0].number)) || null,
    leadFirstName: lead.first_name || lead.firstName || "",
    leadLastName: lead.last_name || lead.lastName || "",
    direction: call.direction || "inbound",
    status: call.status || call.outcome || root.status || "unknown",
    timestamp: call.timestamp || call.created_at || call.created || root.timestamp || new Date().toISOString()
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };

  // Auth — secret in query param OR header
  const expectedSecret = process.env.CALLINGLY_WEBHOOK_SECRET;
  if (!expectedSecret) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: CALLINGLY_WEBHOOK_SECRET missing" }) };
  const qs = event.queryStringParameters || {};
  const headerSecret = (event.headers || {})["x-callingly-secret"] || (event.headers || {})["X-Callingly-Secret"];
  const providedSecret = qs.secret || headerSecret;
  if (providedSecret !== expectedSecret) return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  if (!process.env.FUB_API_KEY) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: FUB_API_KEY missing" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const data = extractCallData(body);
  console.log("[Callingly Event]", data);

  if (!data.agentEmail) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Could not extract agent email from payload", received: body }) };
  }

  // Open the active-calls blob store
  const store = getStore("active-calls");
  const key = data.agentEmail;

  // Status filtering — only set "active" for ringing/connected. Clear on completed.
  const status = (data.status || "").toLowerCase();
  const isCallEnded = /completed|ended|hangup|hung_up|finished|disconnected/.test(status) || /completed|ended|finished/.test(data.eventType);
  const isCallStart = /received|ringing|connected|in_progress|active/.test(status) || /received|ringing|connected|started/.test(data.eventType);

  if (isCallEnded) {
    // Clear state
    try { await store.delete(key); } catch (e) {}
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ status: "cleared", agent: key }) };
  }

  // Otherwise look up the FUB person and write state
  const fubPerson = await lookupFubPersonByPhone(data.leadPhone);

  const stateRecord = {
    agentEmail: data.agentEmail,
    callId: data.callId,
    direction: data.direction,
    status: data.status,
    eventType: data.eventType,
    leadPhone: data.leadPhone,
    leadFirstName: data.leadFirstName,
    leadLastName: data.leadLastName,
    fubPersonId: fubPerson ? fubPerson.id : null,
    fubLead: fubPerson || null,
    receivedAt: new Date().toISOString(),
    source: "callingly"
  };

  try {
    await store.setJSON(key, stateRecord, {
      metadata: { ttl: Date.now() + (5 * 60 * 1000) } // 5 min stale window
    });
  } catch (e) {
    console.error("Blob write failed:", e);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Failed to write state", detail: String(e).slice(0, 200) }) };
  }

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ status: "stored", agent: key, fubPersonId: stateRecord.fubPersonId, receivedAt: stateRecord.receivedAt })
  };
};
