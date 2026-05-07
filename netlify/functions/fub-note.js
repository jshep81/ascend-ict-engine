// Ascend ICT — FUB note auto-write
//
// Required Netlify environment variables:
//   FUB_API_KEY            — FUB API key
//   ASCEND_AI_SECRET       — shared secret matching the engine
//
// Receives the formatted note text + FUB person ID and creates a note on
// that lead's record via the FUB API.

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

  // Auth
  const provided = (event.headers || {})["x-ascend-secret"] || (event.headers || {})["X-Ascend-Secret"];
  if (!process.env.ASCEND_AI_SECRET) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: ASCEND_AI_SECRET missing" }) };
  if (provided !== process.env.ASCEND_AI_SECRET) return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  if (!process.env.FUB_API_KEY) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: FUB_API_KEY missing" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { personId, noteText, subject } = body;

  if (!personId) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "FUB Lead ID required — paste the FUB lead URL into the engine first" }) };
  }
  if (!noteText || !noteText.trim()) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Note text is empty" }) };
  }

  const noteSubject = subject || `ICT Call Note — ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  const noteBody = {
    personId: parseInt(personId, 10),
    subject: noteSubject,
    body: noteText,
    isHtml: false
  };

  const auth = Buffer.from(`${process.env.FUB_API_KEY}:`).toString("base64");

  try {
    const fubResponse = await fetch(`${FUB_API_BASE}/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Basic ${auth}`,
        "X-System": "AscendICT"
      },
      body: JSON.stringify(noteBody)
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
      body: JSON.stringify({
        success: true,
        noteId: responseData.id,
        subject: noteSubject
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
