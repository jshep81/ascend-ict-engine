// Ascend ICT — FUB Smart List + Lead Queue
//
// Required Netlify environment variables:
//   FUB_API_KEY            — FUB API key
//   ASCEND_AI_SECRET       — shared secret matching the engine
//
// Two actions in one function:
//   POST { "action": "list-smartlists" }
//     -> returns the rep's available smart lists
//   POST { "action": "list-people", "smartListId": 123, "limit": 100 }
//     -> returns the leads in that smart list with the fields the engine needs

const FUB_API_BASE = "https://api.followupboss.com/v1";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ascend-Secret"
  };
}

function fubAuthHeader() {
  return "Basic " + Buffer.from(`${process.env.FUB_API_KEY}:`).toString("base64");
}

async function fubGet(path) {
  const res = await fetch(`${FUB_API_BASE}${path}`, {
    headers: {
      "Authorization": fubAuthHeader(),
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

  const action = body.action || "list-smartlists";

  try {
    if (action === "list-smartlists") {
      const result = await fubGet("/smartLists?limit=100");
      if (!result.ok) {
        const detail = result.data && (result.data.errorMessage || result.data.message || result.data.error || JSON.stringify(result.data).slice(0, 400));
        return {
          statusCode: 502,
          headers: corsHeaders(),
          body: JSON.stringify({ error: `FUB API error (${result.status})`, detail: detail || "(no detail returned)" })
        };
      }
      // Normalize the list
      const lists = (result.data.smartlists || result.data.smartLists || []).map(l => ({
        id: l.id,
        name: l.name,
        type: l.type,
        peopleCount: l.peopleCount || l.count
      }));
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ lists })
      };
    }

    if (action === "list-people") {
      const id = body.smartListId;
      if (!id) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "smartListId required" }) };
      const limit = Math.min(parseInt(body.limit, 10) || 100, 200);
      // FUB people endpoint with smartListId filter. Request `fields=allFields`
      // so we get assigned user / pond data which isn't in the default subset.
      const result = await fubGet(`/people?smartListId=${encodeURIComponent(id)}&limit=${limit}&fields=allFields`);
      if (!result.ok) {
        const detail = result.data && (result.data.errorMessage || result.data.message || result.data.error || JSON.stringify(result.data).slice(0, 400));
        return {
          statusCode: 502,
          headers: corsHeaders(),
          body: JSON.stringify({ error: `FUB API error (${result.status})`, detail: detail || "(no detail returned)" })
        };
      }
      const rawPeople = result.data.people || [];
      const people = rawPeople.map(p => {
        // FUB has multiple fields for assignment depending on whether the lead
        // is in a pond, claimed by an agent, or sitting unassigned. Check each.
        const assignedAgent = (
          p.assignedUserName ||
          p.assignedTo ||
          p.claimedBy ||
          p.assignedPondName ||
          p.pondName ||
          (p.assignedUser && (p.assignedUser.name || p.assignedUser.firstName)) ||
          null
        );
        return {
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          name: p.name || [p.firstName, p.lastName].filter(Boolean).join(" "),
          phone: (p.phones && p.phones[0] && p.phones[0].value) || null,
          email: (p.emails && p.emails[0] && p.emails[0].value) || null,
          source: p.source,
          stage: p.stage,
          price: p.price,
          assignedTo: assignedAgent,
          assignedUserId: p.assignedUserId || null,
          assignedPondId: p.assignedPondId || null,
          lastActivity: p.lastActivity,
          created: p.created || p.createdAt || null,
          timeFrame: p.timeFrame
        };
      });
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          people,
          total: result.data._metadata && result.data._metadata.total,
          smartListId: id
        })
      };
    }

    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Unknown action: " + action }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "FUB request failed", detail: String(err).slice(0, 300) })
    };
  }
};
