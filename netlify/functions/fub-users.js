// Ascend ICT — FUB users (team roster) + reassign
//
// Two actions in one function:
//   POST { "action": "list-users" }
//     -> returns the FUB team users so the engine can show a reassign dropdown
//   POST { "action": "reassign", "personId": 12345, "userId": 678 }
//     -> reassigns the lead to the given FUB user
//
// Required env vars:
//   FUB_API_KEY
//   ASCEND_AI_SECRET

const FUB_API_BASE = "https://api.followupboss.com/v1";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ascend-Secret"
  };
}

function fubAuth() { return "Basic " + Buffer.from(`${process.env.FUB_API_KEY}:`).toString("base64"); }

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };

  const provided = (event.headers || {})["x-ascend-secret"] || (event.headers || {})["X-Ascend-Secret"];
  if (!process.env.ASCEND_AI_SECRET) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: ASCEND_AI_SECRET missing" }) };
  if (provided !== process.env.ASCEND_AI_SECRET) return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  if (!process.env.FUB_API_KEY) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: FUB_API_KEY missing" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const action = body.action || "list-users";

  try {
    if (action === "list-users") {
      const res = await fetch(`${FUB_API_BASE}/users?limit=100`, {
        headers: { "Authorization": fubAuth(), "Accept": "application/json", "X-System": "AscendICT" }
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
      if (!res.ok) {
        const detail = data.errorMessage || data.message || text.slice(0, 400);
        return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: `FUB API error (${res.status})`, detail }) };
      }
      const users = (data.users || []).map(u => ({
        id: u.id,
        name: u.name || [u.firstName, u.lastName].filter(Boolean).join(" "),
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        role: u.role,
        groups: u.groups || [],
        teamLeader: u.teamLeader || u.isTeamLeader || false,
        userType: u.userType || "",
        status: u.status
      }));
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ users }) };
    }

    if (action === "reassign") {
      const { personId, userId } = body;
      if (!personId) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "personId required" }) };
      if (!userId) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "userId required" }) };
      const res = await fetch(`${FUB_API_BASE}/people/${parseInt(personId, 10)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": fubAuth(),
          "X-System": "AscendICT"
        },
        body: JSON.stringify({ assignedUserId: parseInt(userId, 10) })
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
      if (!res.ok) {
        const detail = data.errorMessage || data.message || text.slice(0, 400);
        return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: `FUB API error (${res.status})`, detail }) };
      }
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true, personId, userId }) };
    }

    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Unknown action: " + action }) };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "FUB request failed", detail: String(err).slice(0, 300) }) };
  }
};
