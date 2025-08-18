// netlify/functions/generate-outline.js  (v3)
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  const apiKey = process.env.OPENAI_API_KEY;
  const model  = process.env.MODEL || "gpt-5-mini";
  if (!apiKey) return { statusCode: 500, headers: cors(), body: "Missing OPENAI_API_KEY" };

  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, headers: cors(), body: "Bad JSON" }; }

  const required = ["startup","one_liner","industry","target_user","problem","solution"];
  const missing  = required.filter(k => !String(input[k]||"").trim());
  if (missing.length) return { statusCode: 400, headers: cors(), body: `Missing: ${missing.join(", ")}` };

  const schema = `{
    "deck": {
      "meta": {
        "startup": "<string>",
        "industry": "<string>",
        "stage": "seed",
        "tone": "<crisp|narrative|technical>",
        "prompt_version": "v1",
        "created_at": "<ISO8601>"
      },
      "slides": [{
        "id": 1,
        "title": "<Title Case>",
        "purpose": "<investor question this slide answers>",
        "bullets": ["<12–20 words>", "<3–5 bullets total>"],
        "visual": "<suggested chart/mock/layout>",
        "proof_needed": ["<evidence item 1>", "<2–4 items>"]
      }],
      "proof_todos": ["<global TODOs founders must supply>"],
      "warnings": ["<any caveats or missing info>"]
    }
  }`;

  const system = `
You are “Neovik Deck Co-Author”: a seed-stage investor-grade deck outliner.
Return ONLY valid JSON per the schema. No prose, no markdown.
- 10–12 slides. Each slide answers a real investor question.
- 3–5 bullets/slide (12–20 words each). No fluff.
- Do NOT invent numbers or names. If missing, add precise proof_needed and global proof_todos.
- Seed bar: prove pull, wedge, path to revenue in 12–18 months.
- Titles in Title Case. Visuals are concrete (e.g., "cohort chart").
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
    const resp = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    instructions: system,
    input: user,
    text: { format: { type: "json_object" } }, // <-- changed
    max_output_tokens: 1100
  })
});


    if (!resp.ok) return { statusCode: 502, headers: cors(), body: `Upstream error: ${await resp.text()}` };

    const data = await resp.json();
    const text = data?.output_text || "";
    if (!text) return { statusCode: 502, headers: cors(), body: "Empty model output" };

    let json;
    try { json = JSON.parse(text); } catch { return { statusCode: 502, headers: cors(), body: "Model did not return valid JSON" }; }
    if (json.deck?.meta) json.deck.meta.created_at = new Date().toISOString();

    return { statusCode: 200, headers: { ...cors(), "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(json) };
  } catch (e) {
    return { statusCode: 500, headers: cors(), body: `Server error: ${e.message}` };
  }
}

function cors(){
  return {
    "Access-Control-Allow-Origin": "https://theneovik.com",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
