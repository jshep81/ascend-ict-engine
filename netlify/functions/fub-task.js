// Ascend ICT — FUB task auto-create
//
// Required Netlify environment variables:
//   FUB_API_KEY            — your FUB API key (My Settings -> API -> Create API Key)
//   ASCEND_AI_SECRET       — same shared secret the engine uses
//
// Receives the DNS data + FUB person ID from the engine, constructs a FUB
// task via Basic Auth, and returns the task ID on success.

const FUB_API_BASE = "https://api.followupboss.com/v1";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ascend-Secret"
  };
}

// Map DNS action to FUB task type. FUB's task type values: Call, Text, Email,
// Mailed, Other. Anything not a clean match defaults to Other.
function mapActionToType(action) {
  if (!action) return "Other";
  const a = action.toLowerCase();
  if (a.includes("text")) return "Text";
  if (a.includes("email")) return "Email";
  if (a.includes("send listings") || a.includes("info") || a.includes("one-pager")) return "Email";
  if (a.includes("call") || a.includes("confirm appointment") || a.includes("reschedule") || a.includes("schedule tour") || a.includes("update") || a.includes("check-in") || a.includes("lender intro")) return "Call";
  return "Other";
}

// Build an ISO 8601 due date string in Central Time (-05:00). FUB accepts ISO
// strings with offsets. If only date is provided, default to 9am Central.
function buildDueDate(date, time) {
  if (!date) return null;
  const t = time && /^\d{1,2}:\d{2}/.test(time) ? time : "09:00";
  // Pad the seconds and offset
  return `${date}T${t}:00-05:00`;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  // Auth gate — same shared secret as the AI module
  const provided = (event.headers || {})["x-ascend-secret"] || (event.headers || {})["X-Ascend-Secret"];
  if (!process.env.ASCEND_AI_SECRET) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: ASCEND_AI_SECRET missing" }) };
  }
  if (provided !== process.env.ASCEND_AI_SECRET) {
    return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  }

  if (!process.env.FUB_API_KEY) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: FUB_API_KEY missing" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { personId, dns } = body;

  if (!personId) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "FUB Lead ID required — paste the FUB lead URL into the engine first" }) };
  }
  if (!dns || !dns.action) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "DNS action required — set Defined Next Step before creating the task" }) };
  }

  // Build task name from DNS action + specifics
  const nameParts = [dns.action];
  if (dns.specifics && dns.specifics.trim()) nameParts.push("— " + dns.specifics.trim());
  const taskName = nameParts.join(" ");

  const taskBody = {
    personId: parseInt(personId, 10),
    name: taskName,
    type: mapActionToType(dns.action),
    isCompleted: false
  };

  const dueDate = buildDueDate(dns.date, dns.time);
  if (dueDate) taskBody.dueDate = dueDate;

  // FUB Basic Auth: API key as username, empty password
  const auth = Buffer.from(`${process.env.FUB_API_KEY}:`).toString("base64");

  try {
    const fubResponse = await fetch(`${FUB_API_BASE}/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Basic ${auth}`,
        "X-System": "AscendICT"
      },
      body: JSON.stringify(taskBody)
    });

    const responseText = await fubResponse.text();
    let responseData;
    try { responseData = JSON.parse(responseText); } catch (e) { responseData = { raw: responseText }; }

    if (!fubResponse.ok) {
      return {
        statusCode: 502,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: "FUB API error",
          status: fubResponse.status,
          detail: responseData.errorMessage || responseData.message || responseText.slice(0, 400)
        })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        taskId: responseData.id,
        taskName: taskName,
        type: taskBody.type,
        dueDate: dueDate
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
