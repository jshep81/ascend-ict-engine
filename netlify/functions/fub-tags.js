// Ascend ICT — FUB tag sync
//
// GETs the lead's current tags from FUB, merges with the new tags from the
// engine's captures, and PUTs the union back. Doesn't overwrite existing tags.
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

function fubAuth() {
  return "Basic " + Buffer.from(`${process.env.FUB_API_KEY}:`).toString("base64");
}

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

  const { personId, tags } = body;
  if (!personId) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "personId required" }) };
  if (!Array.isArray(tags) || tags.length === 0) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "tags array required" }) };

  const cleanedTags = [...new Set(tags.map(t => String(t).trim()).filter(Boolean))];

  try {
    // GET current person to merge tags
    const personRes = await fetch(`${FUB_API_BASE}/people/${parseInt(personId, 10)}?fields=tags`, {
      headers: { "Authorization": fubAuth(), "Accept": "application/json", "X-System": "AscendICT" }
    });
    let existingTags = [];
    if (personRes.ok) {
      const p = await personRes.json();
      existingTags = Array.isArray(p.tags) ? p.tags : [];
    }
    const merged = [...new Set([...existingTags, ...cleanedTags])];

    const putRes = await fetch(`${FUB_API_BASE}/people/${parseInt(personId, 10)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": fubAuth(),
        "X-System": "AscendICT"
      },
      body: JSON.stringify({ tags: merged })
    });

    const responseText = await putRes.text();
    let responseData;
    try { responseData = JSON.parse(responseText); } catch (e) { responseData = { raw: responseText }; }

    if (!putRes.ok) {
      const detail = responseData.errorMessage || responseData.message || responseText.slice(0, 400);
      return {
        statusCode: 502,
        headers: corsHeaders(),
        body: JSON.stringify({ error: `FUB API error (${putRes.status})`, detail })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        tagsAdded: cleanedTags.filter(t => !existingTags.includes(t)),
        totalTags: merged.length,
        existingTags
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "FUB request failed", detail: String(err).slice(0, 300) })
    };
  }
};
