// Ascend ICT — FUB person lookup by phone (Netlify Functions v2)
//
// The engine calls this when the rep pastes a phone number into the Quick
// Phone Lookup field. We strip to digits, take the last 10, query FUB,
// return the matching person summary. Engine then triggers its existing
// autoLoadFromEmbedParams chain with the personId.
//
// GET /api/fub-find-by-phone?phone=5125551234
//
// Returns: { found: bool, person: {...}, count: N }
//
// Required env vars: FUB_API_KEY, ASCEND_AI_SECRET

const FUB_API_BASE = "https://api.followupboss.com/v1";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Ascend-Secret",
  "Cache-Control": "no-cache, no-store, must-revalidate"
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: CORS });

const fubAuth = () =>
  "Basic " + Buffer.from(`${process.env.FUB_API_KEY}:`).toString("base64");

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });

  // Auth
  const provided = req.headers.get("x-ascend-secret");
  if (!process.env.ASCEND_AI_SECRET) return json({ error: "Server not configured: ASCEND_AI_SECRET missing" }, 500);
  if (provided !== process.env.ASCEND_AI_SECRET) return json({ error: "Unauthorized" }, 401);
  if (!process.env.FUB_API_KEY) return json({ error: "Server not configured: FUB_API_KEY missing" }, 500);

  const url = new URL(req.url);
  let phone = url.searchParams.get("phone") || "";
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body.phone) phone = String(body.phone);
    } catch (e) {}
  }

  // Normalize: strip non-digits, take the trailing 10 digits (US number).
  const clean = String(phone).replace(/[^\d]/g, "");
  if (clean.length < 10) return json({ error: "Phone must be at least 10 digits", received: phone }, 400);
  const last10 = clean.slice(-10);

  try {
    const res = await fetch(`${FUB_API_BASE}/people?phone=${encodeURIComponent(last10)}&fields=allFields&limit=5`, {
      headers: {
        "Authorization": fubAuth(),
        "Accept": "application/json",
        "X-System": "AscendICT"
      }
    });
    if (!res.ok) {
      const detail = await res.text();
      return json({ error: `FUB lookup failed (${res.status})`, detail: detail.slice(0, 300) }, 502);
    }
    const data = await res.json();
    const people = data.people || [];
    if (!people.length) {
      return json({ found: false, count: 0, phone: last10 });
    }
    // Return the first match. If FUB returned multiple, also surface count
    // so the rep knows there's ambiguity.
    const p = people[0];
    return json({
      found: true,
      count: people.length,
      person: {
        id: p.id,
        firstName: p.firstName || "",
        lastName: p.lastName || "",
        name: p.name || "",
        email: (p.emails && p.emails[0] && p.emails[0].value) || "",
        phone: (p.phones && p.phones[0] && p.phones[0].value) || "",
        source: p.source || "",
        stage: p.stage || ""
      }
    });
  } catch (err) {
    return json({ error: "FUB request failed", detail: String(err).slice(0, 300) }, 500);
  }
};

export const config = {
  path: "/api/fub-find-by-phone"
};
