// netlify/functions/generate-outline.js  (v5 with auto-compact retry)
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  const apiKey = process.env.OPENAI_API_KEY;
  const model  = process.env.MODEL || "gpt-5-mini";
  if (!apiKey) return { statusCode: 500, headers: cors(), body: "Missing OPENAI_API_KEY" };

  let input;
  try { input = JSON.parse(event.body || "{}"); } 
  catch { return { statusCode: 400, headers: cors(), body: "Bad JSON" }; }

  const required = ["startup","one_liner","industry","target_user","problem","solution"];
  const missing  = required.filter(k => !String(input[k]||"").trim());
  if (missing.length) return { statusCode: 400, headers: cors(), body: `Missing: ${missing.join(", ")}` };

  const schema = `{
    "deck": {
      "meta": {"startup":"<string>","industry":"<string>","stage":"seed","tone":"<crisp|narrative|technical>","prompt_version":"v1","created_at":"<ISO8601>"},
      "slides": [{"id":1,"title":"<Title Case>","purpose":"<investor question>","bullets":["<12–18 words>"],"visual":"<layout>","proof_needed":["<evidence>"]}],
      "proof_todos": ["<global TODOs>"],
      "warnings": ["<caveats>"]
    }
  }`;

  const baseSystem = `
You are “Neovik Deck Co-Author”: a seed-stage investor-grade deck outliner.
Return ONLY valid JSON per the schema. No prose, no markdown.
- 10–12 slides. Each slide answers a real investor question.
- 3–5 bullets/slide (12–18 words each). No fluff.
- Do NOT invent numbers/names. If missing, add precise proof_needed and global proof_todos.
- Seed bar: prove pull, wedge, path to revenue in 12–18 months.
- Titles in Title Case. Visuals are concrete (e.g., "cohort chart", "bottom-up calc table").
- Keep tone crisp (McKinsey/Goldman). All schema fields must exist.
`;

  const founderInput = `
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
    // Try full version first (higher token cap)
    let data = await call(model, baseSystem, founderInput, 2000);
    if (data.status === "incomplete" && data.incomplete_details?.reason === "max_output_tokens") {
      // Retry compact version
      const compactSystem = baseSystem + `
COMPACT MODE:
- Hard cap 10–11 slides.
- 3–4 bullets per slide, tighter phrasing.
- Prefer warnings/proof_todos over long bullets.
`;
      data = await call(model, compactSystem, founderInput, 1400);
    }

    const text = extractText(data);
    if (!text) {
      return { statusCode: 502, headers: cors(), body: "Upstream (no text): " + JSON.stringify(data).slice(0, 1500) };
    }

    let json;
    try { json = JSON.parse(text); }
    catch { return { statusCode: 502, headers: cors(), body: "Model returned non-JSON text: " + text.slice(0, 500) }; }

    if (json.deck?.meta) json.deck.meta.created_at = new Date().toISOString();

    return { statusCode: 200, headers: { ...cors(), "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(json) };
  } catch (e) {
    return { statusCode: 500, headers: cors(), body: `Server error: ${e.message}` };
  }
}

async function call(model, instructions, input, maxTokens){
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions,
      input,
      text: { format: { type: "json_object" } },
      max_output_tokens: maxTokens
    })
  });
  if (!resp.ok) {
    const msg = await resp.text();
    throw new Error(`Upstream error: ${msg}`);
  }
  return await resp.json();
}

function extractText(d) {
  if (!d) return "";
  if (typeof d.output_text === "string" && d.output_text.trim()) return d.output_text;
  if (Array.isArray(d.output) && Array.isArray(d.output[0]?.content)) {
    for (const c of d.output[0].content) {
      if (typeof c.text === "string" && c.text.trim()) return c.text;
      if (c.type === "output_text" && typeof c.output_text === "string" && c.output_text.trim()) return c.output_text;
    }
  }
  const ch = d.choices?.[0]?.message?.content;
  if (typeof ch === "string" && ch.trim()) return ch;
  return "";
}

function cors(){
  return {
    "Access-Control-Allow-Origin": "https://theneovik.com",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
