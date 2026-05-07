// Ascend ICT — FUB lead stage update
//
// PUTs to /v1/people/{id} to update the lead's stage.
//
// Required Netlify environment variables:
//   FUB_API_KEY            — FUB API key
//   ASCEND_AI_SECRET       — shared secret matching the engine

const FUB_API_BASE = "https://api.followupboss.com/v1";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ascend-Secret"
  };
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

  const { personId, stage } = body;
  if (!personId) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "personId required" }) };
  if (!stage) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "stage required" }) };

  const auth = Buffer.from(`${process.env.FUB_API_KEY}:`).toString("base64");

  try {
    const fubResponse = await fetch(`${FUB_API_BASE}/people/${parseInt(personId, 10)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Basic ${auth}`,
        "X-System": "AscendICT"
      },
      body: JSON.stringify({ stage: stage })
    });

    const responseText = await fubResponse.text();
    let responseData;
    try { responseData = JSON.parse(responseText); } catch (e) { responseData = { raw: responseText }; }

    if (!fubResponse.ok) {
      const detail = responseData.errorMessage || responseData.message || responseData.error || responseText.slice(0, 400);
      return {
        statusCode: 502,
        headers: corsHeaders(),
        body: JSON.stringify({ error: `FUB API error (${fubResponse.status})`, detail: detail || "(no detail returned)" })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, personId, stage })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "FUB request failed", detail: String(err).slice(0, 300) })
    };
  }
};
