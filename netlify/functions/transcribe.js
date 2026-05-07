// Ascend ICT — Audio transcription via OpenAI Whisper
//
// Required Netlify environment variables:
//   OPENAI_API_KEY     — OpenAI API key (sk-...)
//   ASCEND_AI_SECRET   — shared secret matching the engine
//
// POST { "audioBase64": "<base64>", "filename": "dictation.webm", "mimeType": "audio/webm" }
//   -> { transcript: "...", durationSec: 12.3 }
//
// The front-end records audio via MediaRecorder, base64-encodes the blob,
// and POSTs it as JSON. We decode, build a multipart/form-data request to
// OpenAI's audio transcription endpoint, and return the transcript.
//
// Body limit on Netlify is 6 MB. webm/opus at 32 kbps is ~240 KB/min, so
// ~25 minutes of audio fits comfortably. For the Dictate Notes use case
// (30-90 sec post-call dictation) this is plenty.

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-1";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ascend-Secret"
  };
}

// Build a multipart/form-data body manually so we don't pull in any deps.
// Returns { body: Buffer, contentType: string }
function buildMultipart(fields, file) {
  const boundary = "----AscendBoundary" + Math.random().toString(36).slice(2);
  const CRLF = "\r\n";
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`,
      "utf8"
    ));
  }

  parts.push(Buffer.from(
    `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${file.filename}"${CRLF}Content-Type: ${file.contentType}${CRLF}${CRLF}`,
    "utf8"
  ));
  parts.push(file.buffer);
  parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`, "utf8"));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };

  // Auth
  const provided = (event.headers || {})["x-ascend-secret"] || (event.headers || {})["X-Ascend-Secret"];
  if (!process.env.ASCEND_AI_SECRET) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: ASCEND_AI_SECRET missing" }) };
  if (provided !== process.env.ASCEND_AI_SECRET) return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  if (!process.env.OPENAI_API_KEY) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Server not configured: OPENAI_API_KEY missing" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const audioBase64 = body.audioBase64;
  if (!audioBase64) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "audioBase64 is required" }) };
  }

  const filename = body.filename || "dictation.webm";
  const mimeType = body.mimeType || "audio/webm";
  const model = body.model || process.env.WHISPER_MODEL || DEFAULT_MODEL;
  const language = body.language || "en";

  let audioBuffer;
  try {
    audioBuffer = Buffer.from(audioBase64, "base64");
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Failed to decode audioBase64" }) };
  }

  if (audioBuffer.length < 1024) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Audio file is too small — recording may have failed" }) };
  }

  const { body: multipartBody, contentType } = buildMultipart(
    { model, language, response_format: "json" },
    { filename, contentType: mimeType, buffer: audioBuffer }
  );

  try {
    const res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": contentType
      },
      body: multipartBody
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      const detail = (data.error && (data.error.message || data.error)) || data.raw || `HTTP ${res.status}`;
      return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: "OpenAI transcription failed", detail: String(detail).slice(0, 500) }) };
    }
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        transcript: data.text || "",
        durationSec: data.duration || null,
        model
      })
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "Transcription request failed", detail: String(err).slice(0, 300) }) };
  }
};
