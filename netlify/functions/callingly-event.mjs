// Ascend ICT — Callingly webhook receiver (Netlify Functions v2)
//
// Callingly fires this when an inbound call rings/connects/completes.
// We extract the agent email + lead phone, look up the FUB person ID,
// and write {agentEmail, fubPersonId, ringingAt, callId, status} into
// Netlify Blobs so the engine's active-call endpoint can read it.
//
// Required env vars:
//   FUB_API_KEY                — to look up the lead by phone
//   CALLINGLY_WEBHOOK_SECRET   — shared secret in the webhook URL or header
//
// Set up in Callingly:
//   Webhook URL: https://conversionengine.netlify.app/api/callingly-event?secret=YOUR_SECRET
//   Events: Call Accepted, Call Completed (we filter event types in code)

import { getStore } from "@netlify/blobs";

const FUB_API_BASE = "https://api.followupboss.com/v1";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Callingly-Signature, X-Callingly-Secret"
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: CORS });

const fubAuth = () =>
  "Basic " + Buffer.from(`${process.env.FUB_API_KEY}:`).toString("base64");

// Look up FUB person by phone. Returns FUB person summary or null.
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

// Pull all the possible field locations Callingly might use. Field shapes
// vary by Callingly plan and event type so we try every common path.
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

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Auth — secret in query param OR header
  const expectedSecret = process.env.CALLINGLY_WEBHOOK_SECRET;
  if (!expectedSecret) return json({ error: "Server not configured: CALLINGLY_WEBHOOK_SECRET missing" }, 500);

  const url = new URL(req.url);
  const headerSecret = req.headers.get("x-callingly-secret");
  const providedSecret = url.searchParams.get("secret") || headerSecret;
  if (providedSecret !== expectedSecret) return json({ error: "Unauthorized" }, 401);
  if (!process.env.FUB_API_KEY) return json({ error: "Server not configured: FUB_API_KEY missing" }, 500);

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "Invalid JSON" }, 400);
  }

  const data = extractCallData(body);
  console.log("[Callingly Event]", JSON.stringify(data));

  if (!data.agentEmail) {
    return json({ error: "Could not extract agent email from payload", received: body }, 400);
  }

  const store = getStore("active-calls");
  const key = data.agentEmail;

  // Status / event-type filtering. Clear state on completed events,
  // write state on ringing / accepted / connected events.
  const status = (data.status || "").toLowerCase();
  const evt = (data.eventType || "").toLowerCase();
  const isCallEnded =
    /completed|ended|hangup|hung_up|finished|disconnected/.test(status) ||
    /completed|ended|finished|call_completed|call\.completed/.test(evt);
  // Anything that isn't a clear "end" event we treat as a "start" — most
  // permissive shape so Call Accepted, Call Connected, Call Received all hit.

  if (isCallEnded) {
    try { await store.delete(key); } catch (e) {}
    return json({ status: "cleared", agent: key });
  }

  // Look up the FUB person and write state
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
    await store.setJSON(key, stateRecord);
  } catch (e) {
    console.error("Blob write failed:", e);
    return json({ error: "Failed to write state", detail: String(e).slice(0, 300) }, 500);
  }

  return json({ status: "stored", agent: key, fubPersonId: stateRecord.fubPersonId, receivedAt: stateRecord.receivedAt });
};

export const config = {
  path: "/api/callingly-event"
};
