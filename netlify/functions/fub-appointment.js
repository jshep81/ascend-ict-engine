// Ascend ICT — FUB appointment auto-create
//
// Required Netlify environment variables:
//   FUB_API_KEY          — your FUB API key
//   ASCEND_AI_SECRET     — shared secret matching the engine
//
// Receives the appointment data + FUB person ID and creates a calendar
// appointment on that lead's record via the FUB API.

const FUB_API_BASE = "https://api.followupboss.com/v1";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ascend-Secret"
  };
}

// Build ISO 8601 datetime in Central Time (-05:00)
function buildISODateTime(date, time) {
  if (!date) return null;
  const t = (time && /^\d{1,2}:\d{2}/.test(time)) ? time : "09:00";
  return `${date}T${t}:00-05:00`;
}

// Default end time is start time + 1 hour if not provided
function deriveEndTime(date, startTime, endTime) {
  if (endTime) return buildISODateTime(date, endTime);
  if (!startTime) return null;
  const [h, m] = startTime.split(":");
  const hourNum = parseInt(h, 10);
  const endHour = (hourNum + 1) % 24;
  const endStr = `${String(endHour).padStart(2, "0")}:${m || "00"}`;
  return buildISODateTime(date, endStr);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };

  // Auth gate
  const provided = (event.headers || {})["x-ascend-secret"] || (event.headers || {})["X-Ascend-Secret"];
  if (!process.env.ASCEND_AI_SECRET) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: ASCEND_AI_SECRET missing" }) };
  if (provided !== process.env.ASCEND_AI_SECRET) return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  if (!process.env.FUB_API_KEY) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: FUB_API_KEY missing" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { personId, appointment } = body;

  if (!personId) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "FUB Lead ID required — paste the FUB lead URL into the engine first" }) };
  }
  if (!appointment || !appointment.date || !appointment.startTime) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Appointment date and start time required — fill out the appointment card before pushing" }) };
  }

  const startISO = buildISODateTime(appointment.date, appointment.startTime);
  const endISO = deriveEndTime(appointment.date, appointment.startTime, appointment.endTime);

  const apptBody = {
    personId: parseInt(personId, 10),
    title: appointment.title || `Property Tour`,
    type: appointment.type || "Buyer- Showing Appt",
    outcome: appointment.outcome || "No Outcome",
    start: startISO,
    end: endISO,
    location: appointment.location || "",
    description: appointment.description || ""
  };

  const auth = Buffer.from(`${process.env.FUB_API_KEY}:`).toString("base64");

  try {
    const fubResponse = await fetch(`${FUB_API_BASE}/appointments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Basic ${auth}`,
        "X-System": "AscendICT"
      },
      body: JSON.stringify(apptBody)
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
        appointmentId: responseData.id,
        title: apptBody.title,
        type: apptBody.type,
        start: startISO,
        end: endISO
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
