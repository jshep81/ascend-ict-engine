// Ascend ICT — FUB lead context
//
// Pulls notes + activity events for a single FUB person so the engine can
// build a "pre-call brief" — last 3 notes, last 10 events, and the lead's
// created/lastActivity timestamps for speed-to-lead math.
//
// POST { "action": "get-context", "personId": 12345 }
//   -> { person, notes, events, savedSearches, propertyInquiries }
//
// Required env vars: FUB_API_KEY, ASCEND_AI_SECRET

const FUB_API_BASE = "https://api.followupboss.com/v1";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ascend-Secret"
  };
}

function fubAuth() {
  return "Basic " + Buffer.from(`${process.env.FUB_API_KEY}:`).toString("base64");
}

async function fubGet(path) {
  const res = await fetch(`${FUB_API_BASE}${path}`, {
    headers: {
      "Authorization": fubAuth(),
      "Accept": "application/json",
      "X-System": "AscendICT"
    }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };

  // Auth
  const provided = (event.headers || {})["x-ascend-secret"] || (event.headers || {})["X-Ascend-Secret"];
  if (!process.env.ASCEND_AI_SECRET) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: ASCEND_AI_SECRET missing" }) };
  if (provided !== process.env.ASCEND_AI_SECRET) return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  if (!process.env.FUB_API_KEY) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: FUB_API_KEY missing" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const action = body.action || "get-context";
  const personId = parseInt(body.personId, 10);

  if (!personId) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "personId required" }) };
  }

  if (action !== "get-context") {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Unknown action: " + action }) };
  }

  try {
    // Fetch in parallel for speed.
    const [personRes, notesRes, eventsRes] = await Promise.all([
      fubGet(`/people/${personId}?fields=allFields`),
      fubGet(`/notes?personId=${personId}&limit=10&sort=-created`),
      fubGet(`/events?personId=${personId}&limit=20&sort=-created`)
    ]);

    if (!personRes.ok) {
      const detail = personRes.data && (personRes.data.errorMessage || personRes.data.message || JSON.stringify(personRes.data).slice(0, 400));
      return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: `FUB person fetch failed (${personRes.status})`, detail }) };
    }

    const p = personRes.data || {};
    const person = {
      id: p.id,
      name: p.name || [p.firstName, p.lastName].filter(Boolean).join(" "),
      firstName: p.firstName,
      lastName: p.lastName,
      phone: (p.phones && p.phones[0] && p.phones[0].value) || null,
      email: (p.emails && p.emails[0] && p.emails[0].value) || null,
      source: p.source,
      stage: p.stage,
      tags: p.tags || [],
      created: p.created || p.createdAt || null,
      lastActivity: p.lastActivity || null,
      assignedUserName: p.assignedUserName || (p.assignedUser && p.assignedUser.name) || p.assignedTo || p.assignedPondName || null,
      assignedUserId: p.assignedUserId || null,
      assignedPondId: p.assignedPondId || null
    };

    const rawNotes = (notesRes.ok && notesRes.data && notesRes.data.notes) || [];
    const notes = rawNotes.slice(0, 5).map(n => ({
      id: n.id,
      created: n.created,
      author: n.createdByName || n.createdBy || "",
      subject: n.subject || "",
      body: (n.body || "").slice(0, 800)
    }));

    const rawEvents = (eventsRes.ok && eventsRes.data && eventsRes.data.events) || [];
    const events = rawEvents.slice(0, 30).map(e => ({
      id: e.id,
      type: e.type,
      created: e.created,
      source: e.source,
      message: e.message || e.description || "",
      property: e.property ? {
        street: e.property.street || e.property.address,
        city: e.property.city,
        state: e.property.state,
        postalCode: e.property.postalCode || e.property.zip,
        price: e.property.price,
        beds: e.property.bedrooms || e.property.beds,
        baths: e.property.bathrooms || e.property.baths,
        sqft: e.property.area || e.property.sqft || e.property.squareFeet,
        lotSize: e.property.lotSize,
        yearBuilt: e.property.yearBuilt,
        type: e.property.type || e.property.propertyType,
        mlsNumber: e.property.mlsNumber || e.property.mlsId,
        listed: e.property.listed || e.property.listDate,
        url: e.property.url
      } : null
    }));

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ person, notes, events })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "FUB request failed", detail: String(err).slice(0, 300) })
    };
  }
};
