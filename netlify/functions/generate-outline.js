// netlify/functions/generate-outline.js  (v6: health GET + clearer errors)
export async function handler(event) {
  // Health check (open in browser to verify function works)
  if (event.httpMethod === "GET") {
    return json(200, { ok: true, version: "v6", model: process.env.MODEL || "gpt-5-mini", hasKey: !!process.env.OPENAI_API_KEY });
  }
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return text(405, "Method Not Allowed");

  const apiKey = process.env.OPENAI_API_KEY;
  const model  = process.env.MODEL || "gpt-5-mini";
  if (!apiKey) return text(500, "Missing OPENAI_API_KEY");

  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return text(400, "Bad JSON"); }

  const required = ["startup","one_liner","industry","target_user","problem","solution"];
  const miss = required.filter(k => !String(input[k]||"").trim());
  if (miss.length) return text(400, `Missing: ${miss.join(", ")}`);

  const schema = `{
    "deck": {
      "meta": {"startup":"<string>","industry":"<string>","stage":"seed","tone":"<crisp|narrative|technical>","prompt_version":"v1","created_at":"<ISO8601>"},
      "slides": [{"id":1,"title":"<Title Case>","purpose":"<investor question>","bullets":["<12–18 words>"],"visual":"<layout>","proof_needed":["<evidence>"]}],
      "proof_todos": ["<global TODOs>"],
      "warnings": ["<caveats>"]
    }
  }`;

  const system = `
You are “Neovik Deck Co-Author”: a seed-stage investor-grade deck outliner.
Return ONLY valid JSON per the schema. No prose, no markdown.
- 10–12 slides. Each slide answers a real investor question.
- 3–5 bullets/slide (12–18 words each). No fluff.
- Do NOT invent numbers/names. If missing, add precise proof_needed and global proof_todos.
- Seed bar: prove pull, wedge, path to revenue in 12–18 months.
- Titles in Title Case. Visuals are concrete (e.g., "cohort chart", "bottom-up calc table").
- Keep tone crisp (McKinsey/Goldman). All schema fields must exist.
`;

  const user = `
SCHEMA:
${schema}

FOUNDER_INPUT:
startup: ${input.startup}
one_liner: ${input.one_liner}
industry: ${input.industry}
stage: seed
target_user: ${input.target_user}
problem: ${input.problem}
solution: ${input.solution}
gtm: ${input.gtm || ""}
business_model: ${input.business_model || ""}
traction: ${input.traction || ""}
competition: ${input.competition || ""}
moat: ${input.moat || ""}
ask_use: ${input.ask_use || ""}
tone: ${input.tone || "crisp"}

TASK:
Produce a 12-slide outline for seed investors.
Each slide: title, purpose, 3–5 bullets, visual, and 2–4 proof_needed.
Aggregate the most critical missing evidence into proof_todos (max 8).
Return ONLY valid JSON.
`;

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: system,
        input: user,
        text: { format: { type: "json_object" } },
        max_output_tokens: 2000
      })
    });

    if (!upstream.ok) return text(502, `Upstream error: ${await upstream.text()}`);

    const data = await upstream.json();
    const out = extractText(data);
    if (!out) return text(502, "Upstream (no text): " + JSON.stringify(data).slice(0, 1500));

    let parsed;
    try { parsed = JSON.parse(out); }
    catch { return text(502, "Model returned non-JSON text: " + out.slice(0, 500)); }

    if (parsed.deck?.meta) parsed.deck.meta.created_at = new Date().toISOString();
    return json(200, parsed);
  } catch (e) {
    return text(500, `Server error: ${e.message || e}`);
  }
}

function extractText(d) {
  if (!d) return "";
  if (typeof d.output_text === "string" && d.output_text.trim()) return d.output_text;
  const oc = d.output && Array.isArray(d.output[0]?.content) ? d.output[0].content : null;
  if (oc) {
    for (const c of oc) {
      if (typeof c.text === "string" && c.text.trim()) return c.text;
      if (c.type === "output_text" && typeof c.output_text === "string" && c.output_text.trim()) return c.output_text;
      if (c.type === "refusal" && c.refusal) return JSON.stringify({ error: "refusal", detail: c.refusal });
    }
  }
  const ch = d.choices?.[0]?.message?.content;
  if (typeof ch === "string" && ch.trim()) return ch;
  return "";
}

function cors() { return {
  "Access-Control-Allow-Origin": "*", // relax while we debug; can lock to domain later
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};}
function text(code, body){ return { statusCode: code, headers: cors(), body }; }
function json(code, obj){ return { statusCode: code, headers: { ...cors(), "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(obj) }; }
