// Ascend ICT — AI module
//
// Required Netlify environment variables:
//   ANTHROPIC_API_KEY       — your Anthropic API key (sk-ant-...)
//   ASCEND_AI_SECRET        — shared secret matching the one in index.html
//
// Optional:
//   AI_MODEL                — defaults to "claude-haiku-4-5-20251001"
//   AI_MAX_TOKENS           — defaults to 1024
//
// The function authenticates by checking the X-Ascend-Secret header. The
// engine includes that secret in every AI request. Anyone who scrapes the
// function URL without the secret gets a 401.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 1024;

// =============================================================================
// SYSTEM PROMPTS
// =============================================================================

const ASCEND_VOICE = `You are an AI assistant for the Ascend Group at LPT Realty, a residential real estate team based in Austin, Texas, serving the Central Texas corridor (Austin, San Antonio, Williamson Co, Hays Co, Comal Co, Bastrop, Hill Country).

ASCEND BRAND VOICE — strict rules:
- Direct, plain-spoken, peer-to-peer. Texan but professional.
- No marketing buzzwords ("dream home," "stunning," "must-see," "ascend to your next chapter").
- No exclamation points unless absolutely warranted.
- Senior practitioner tone. Not entry-level, not corporate.
- Push back when the user is wrong. Don't validate weak thinking.
- Bold the things that matter, skip decoration.
- Use real Texas market dynamics — Eanes ISD, Lake Travis ISD, RRISD, Alamo Heights ISD all carry distinct premiums. Texas property tax math is meaningful.

CRITICAL: Output the response only. Don't introduce yourself. Don't preface with "Sure!" or "Here you go." Just give the answer.`;

function buildContextBlock(context) {
  if (!context) return "";
  const c = context.captures || {};
  const lines = ["", "CURRENT CALL CONTEXT:"];
  if (c.motivation) lines.push(`- Motivation: ${c.motivation}`);
  if (context.neighborhood) lines.push(`- Neighborhood: ${context.neighborhood.name || context.neighborhood} (${context.neighborhood.market || ""})`);
  if (c.market) lines.push(`- Market: ${c.market}`);
  if (c.timeline) lines.push(`- Timeline: ${c.timeline}`);
  if (c.financing) lines.push(`- Financing: ${c.financing}`);
  if (c.budget) lines.push(`- Budget: ${c.budget}`);
  if (c.criteria) lines.push(`- Must-haves: ${c.criteria}`);
  if (c.consultBooked) lines.push(`- Tour status: ${c.consultBooked}`);
  if (context.insight && context.insight.decider) lines.push(`- Decision maker: ${context.insight.decider}`);
  if (context.insight && context.insight.quote) lines.push(`- Direct quote captured: "${context.insight.quote}"`);
  if (context.dns && context.dns.action) lines.push(`- DNS: ${context.dns.action} on ${context.dns.date || "(no date)"} ${context.dns.time || ""}`);
  if (context.notes) lines.push(`- Live call notes: ${context.notes.slice(0, 800)}`);
  return lines.join("\n");
}

function systemPromptForAction(action, context) {
  const ctx = buildContextBlock(context);
  switch (action) {
    case "objection":
      return `${ASCEND_VOICE}

YOUR JOB: The ICT rep is on a live call and the prospect just said something not in the standard objection tree. Give the rep a 2-4 sentence recovery script in Ascend voice that they can read verbatim. Keep it conversational, professional, peer-to-peer. End by re-asking for the appointment when appropriate.${ctx}`;

    case "polish":
      return `${ASCEND_VOICE}

YOUR JOB: Take the rep's raw call notes (provided as the user message) and rewrite them as a clean, professional FUB note. Preserve the rep's voice but improve grammar, structure, and clarity.

OUTPUT STRUCTURE:
TL;DR
[one-line summary]

KEY FACTS
- [fact]
- [fact]

WATCH-OUTS
- [risk or thing the agent needs to know]

CONTEXT
[any unstructured detail that didn't fit above]

Keep it tight. Don't add information that wasn't in the original notes.${ctx}`;

    case "brief":
      return `${ASCEND_VOICE}

YOUR JOB: Generate a pre-tour brief for the assigned buyer specialist. They'll read this on their phone in 30 seconds before walking up to meet the prospect at the property. Use ONLY the call context provided.

FORMAT (4-5 short lines, no headers):
Line 1: Who they are and why moving (one sentence)
Line 2: Key driver / what to lead with
Line 3: Money situation in one phrase
Line 4: One specific watch-out
Line 5: One thing to mention proactively

No fluff. The agent has 30 seconds.${ctx}`;

    case "text":
      return `${ASCEND_VOICE}

YOUR JOB: Generate a confirmation text from the ICT rep to the prospect, sent immediately after the tour appointment is booked. Texan voice, professional, brief (under 320 characters).

INCLUDE:
- Confirm day/time of tour
- Mention the assigned agent will meet them at the property
- Give a way to reach back out
- One personalized line if you have context

Output the text only — no explanation, no preface.${ctx}`;

    case "area-info":
      return `${ASCEND_VOICE}

YOUR JOB: Generate practical talking points about the area or neighborhood the prospect mentioned, so the rep sounds informed during the call.

HARD CONSTRAINTS — Fair Housing Act compliance. NEVER discuss any of the following, even if asked directly:
- Schools, school ratings, school districts, ISD names, or anything related to schools
- Demographics (age, race, ethnicity, religion, national origin, income level, family composition, marital status)
- "Family-friendly," "kid-friendly," "good for families," "safe for kids," "good families"
- "Safe," "unsafe," "crime," "high-crime," "low-crime," "gentrifying," "up-and-coming," "transitioning," "diverse"
- Religious institutions or proximity to them
- Disability access (unless the prospect explicitly asks about ADA features and wants info)
- Source of income or its types
- Anything tied to a Fair Housing Act protected class

If the prospect's interest seems tied to one of these prohibited topics, redirect to factual non-protected attributes (commute, amenities, geography).

ONLY DISCUSS:
- Geographic features (proximity to highways, lakes, downtown, hill country, river)
- Commute time estimates to specific destinations (downtown, ABIA airport, major employers)
- Public amenities (parks, trails, restaurants, shopping centers, grocery stores, gyms, retail districts)
- Architecture / housing stock characteristics (e.g., "ranch-style 80s build," "newer master-planned," "established mid-century," "Hill Country contemporary")
- Property tax rate ranges (factual)
- HOA structures (typical fee ranges, what they cover)
- Climate / environmental factors (flood plain, hill country terrain, lake/river access)
- Walkability or bike-ability (factual scores or descriptors only)
- Major employers in the area (factual)
- Property value trends (price ranges, days on market — factual market data only)

OUTPUT FORMAT: 3-5 short talking points. No headers. No "here are some talking points" preface. Just the points, written so the rep can read them naturally during the call.${ctx}`;

    case "notes-from-transcript":
      return `${ASCEND_VOICE}

YOUR JOB: The user message contains a raw audio transcript from an ICT rep dictating notes after a real estate call. Extract the structured fields the engine needs and return them as STRICT JSON. No prose, no markdown, no preface — JSON only.

FAIR HOUSING: Even if the transcript mentions schools, demographics, family-friendliness, safety, or anything tied to a Fair Housing Act protected class, DO NOT include those signals in any output field. Replace with neutral attributes (commute, geography, amenities) or omit.

OUTPUT SCHEMA — return EXACTLY this JSON shape (omit any field where info is not present in the transcript; do not invent):
{
  "summary": "one-line TL;DR of the call",
  "captures": {
    "motivation": "what's driving the move (one phrase)",
    "market": "metro area mentioned",
    "timeline": "ASAP / 1-3 months / 3-6 months / 6+ months / etc",
    "financing": "Pre-approved (full UW) | Pre-qualified only | Cash + POF | No lender — refer to preferred lender",
    "lenderIntro": "Accepted | Soft yes | Deferred | Declined",
    "budget": "purchase-price band or monthly target",
    "criteria": "must-haves — comma-separated short phrases",
    "consultBooked": "Yes — tour booked at opener | Yes — tour booked at wrap | Soft yes | Nurture | etc"
  },
  "insight": {
    "quote": "single most useful direct quote from the prospect, if any (verbatim)",
    "decider": "who decides — solo / spouse / partner / family / etc"
  },
  "dns": {
    "action": "Call | Text | Email | Tour | Meet | Send Info | Other",
    "date": "YYYY-MM-DD if a specific date was mentioned",
    "time": "HH:MM (24-hr) if a time was mentioned",
    "specifics": "one-sentence what / why / where for the next step"
  },
  "notes": "polished 3-6 sentence call note in Ascend voice — Texan, plain-spoken, what happened on the call, what the agent needs to know, no fluff"
}

If the transcript is too short or unclear to extract a field, omit that field entirely from the JSON. Output the JSON object only — nothing else.${ctx}`;

    case "lead-brief":
      return `${ASCEND_VOICE}

YOUR JOB: Generate a 30-second pre-call brief for an ICT rep about to dial a lead. The user message will contain raw FUB data — recent notes, recent activity events, and basic lead info. Distill it into a concrete brief the rep can read in 10 seconds.

HARD CONSTRAINTS — Fair Housing Act:
- Do NOT mention schools, ISDs, school districts, or anything school-related (even if a note mentions them).
- Do NOT mention demographics, family composition, religion, ethnicity, "family-friendly," "safe," "crime."
- Stick to factual real estate signals: timeline, financing posture, neighborhoods/addresses they viewed, motivation, last contact.

FORMAT (5 short bullets, no headers, no preface):
- Last contact: [date or "first contact"] — [what was discussed in 1 phrase]
- Engagement signal: [recent searches / saved homes / page views in past 30 days, factual]
- Motivation: [what's driving them, if known]
- Money: [pre-approval status, budget range, cash vs financed — if known]
- Lead with: [one specific opener line tailored to their last activity]

If a field is missing from the FUB data, say "unknown" — don't invent. Output the 5 bullets only.${ctx}`;

    case "chat":
    default:
      return `${ASCEND_VOICE}

YOUR JOB: The ICT rep is asking for help during or after a call. Answer their question directly. Keep responses short (under 6 sentences) unless they ask for more detail. Ground your answers in Texas residential real estate reality. If they ask about specific property data, comps, or current MLS info you don't have, say so — don't invent numbers.

FAIR HOUSING: Even in free chat, never discuss schools, demographics, family/kid friendliness, safety/crime, religious proximity, or anything tied to Fair Housing Act protected classes. If asked, redirect to factual non-protected attributes.${ctx}`;
  }
}

// =============================================================================
// HANDLER
// =============================================================================

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  // Auth gate
  const headers = event.headers || {};
  const provided = headers["x-ascend-secret"] || headers["X-Ascend-Secret"];
  const expected = process.env.ASCEND_AI_SECRET;
  if (!expected) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: ASCEND_AI_SECRET missing" }) };
  }
  if (provided !== expected) {
    return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: ANTHROPIC_API_KEY missing" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { action = "chat", userMessage = "", context = {} } = body;

  if (!userMessage.trim() && action !== "polish" && action !== "brief" && action !== "text" && action !== "area-info" && action !== "lead-brief") {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "userMessage is required" }) };
  }

  const system = systemPromptForAction(action, context);
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const maxTokens = parseInt(process.env.AI_MAX_TOKENS, 10) || DEFAULT_MAX_TOKENS;

  // For action types where the user message is a structured input (notes to polish,
  // empty-ish for brief/text), build a sensible user message if needed.
  let finalUserMessage = userMessage;
  if (action === "polish" && !userMessage) {
    finalUserMessage = (context && context.notes) || "(no notes captured yet)";
  }
  if (action === "brief" && !userMessage) {
    finalUserMessage = "Generate the pre-tour brief from the call context.";
  }
  if (action === "text" && !userMessage) {
    finalUserMessage = "Generate the confirmation text from the call context.";
  }
  if (action === "area-info" && !userMessage) {
    finalUserMessage = "Generate area talking points from the call context — use the neighborhood / area captured if available, otherwise note that the rep needs to provide the area name.";
  }

  try {
    const apiResponse = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        system: system,
        messages: [{ role: "user", content: finalUserMessage }]
      })
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      return {
        statusCode: 502,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Anthropic API error", status: apiResponse.status, detail: errText.slice(0, 500) })
      };
    }

    const data = await apiResponse.json();
    const text = (data.content && data.content[0] && data.content[0].text) || "";
    const usage = data.usage || {};

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        text,
        action,
        usage: { input: usage.input_tokens, output: usage.output_tokens }
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "AI request failed", detail: String(err).slice(0, 300) })
    };
  }
};

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ascend-Secret"
  };
}
