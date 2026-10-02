// test/parser.test.js
// Automated regression tests for Gemini solution response parser
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

// Mirror of robustJSONParse from background.js
function robustJSONParse(rawText) {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Empty response received from Gemini.");
  }

  // 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
  let text = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // 2. Extract outermost JSON object {...}
  const firstBrace = text.indexOf("{");
  if (firstBrace !== -1) {
    const lastBrace = text.lastIndexOf("}");
    if (lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    } else {
      text = text.slice(firstBrace);
    }
  }

  // 3. Fast path: Standard JSON.parse
  try {
    return JSON.parse(text);
  } catch (_) {}

  // 4. Regex repair for single-quoted keys, unquoted keys, comments, and trailing commas
  let repaired = text.replace(/\/\/[^\r\n]*(\r?\n|$)/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");
  repaired = repaired.replace(/(['"])?([a-zA-Z0-9_]+)\1\s*:/g, '"$2":');
  repaired = repaired.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"');
  repaired = repaired.replace(/\[\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, '["$1"');
  repaired = repaired.replace(/,\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ', "$1"');

  try {
    return JSON.parse(repaired);
  } catch (_) {}

  // 5. JavaScript Evaluator Fallback (Natively parses JS Object literals, unquoted keys, single quotes)
  try {
    const fn = new Function('"use strict"; return (' + text + ');');
    const res = fn();
    if (res && typeof res === "object") return res;
  } catch (_) {}

  try {
    const fn = new Function('"use strict"; return (' + repaired + ');');
    const res = fn();
    if (res && typeof res === "object") return res;
  } catch (_) {}

  throw new Error("Failed to parse Gemini response as JSON");
}

describe("Gemini Response Robust Parser", () => {
  test("Parser 1: Parses standard RFC 8259 JSON response", () => {
    const raw = '{"detected_type": "mcq", "mcq_answers": ["Option B"], "mcq_indices": [1]}';
    const parsed = robustJSONParse(raw);
    assert.equal(parsed.detected_type, "mcq");
    assert.deepEqual(parsed.mcq_answers, ["Option B"]);
    assert.deepEqual(parsed.mcq_indices, [1]);
  });

  test("Parser 2: Strips markdown code fences (```json ... ```)", () => {
    const raw = `\`\`\`json
{
  "detected_type": "mcq",
  "mcq_answers": ["Photosynthesis"],
  "mcq_indices": [2]
}
\`\`\``;
    const parsed = robustJSONParse(raw);
    assert.equal(parsed.detected_type, "mcq");
    assert.deepEqual(parsed.mcq_answers, ["Photosynthesis"]);
  });

  test("Parser 3: Multi-blank Cloze passage response with ordered fill blanks", () => {
    const raw = `\`\`\`json
{
  "detected_type": "cloze_passage",
  "ordered_fill_blanks": ["arrivals", "departures", "security", "boarding", "gate"],
  "reconstructed_passage": "At the airport, check arrivals..."
}
\`\`\``;
    const parsed = robustJSONParse(raw);
    assert.equal(parsed.detected_type, "cloze_passage");
    assert.equal(parsed.ordered_fill_blanks.length, 5);
    assert.equal(parsed.ordered_fill_blanks[0], "arrivals");
    assert.equal(parsed.ordered_fill_blanks[4], "gate");
  });

  test("Parser 4: Sentence rearrangement response with indices and tokens", () => {
    const raw = `\`\`\`json
{
  "detected_type": "rearrange_sentence",
  "reordered_token_indices": [3, 0, 2, 1],
  "reordered_token_texts": ["First token", "Second token", "Third token", "Fourth token"],
  "reconstructed_sentence": "First token Second token Third token Fourth token."
}
\`\`\``;
    const parsed = robustJSONParse(raw);
    assert.equal(parsed.detected_type, "rearrange_sentence");
    assert.deepEqual(parsed.reordered_token_indices, [3, 0, 2, 1]);
  });

  test("Parser 5: Auto-repairs single quotes and trailing commas", () => {
    const raw = `
{
  'detected_type': 'mcq',
  'mcq_answers': ['Hypothesis'],
  'mcq_indices': [0],
}
`;
    const parsed = robustJSONParse(raw);
    assert.equal(parsed.detected_type, "mcq");
    assert.deepEqual(parsed.mcq_answers, ["Hypothesis"]);
  });

  test("Parser 6: Throws meaningful error on empty or null response", () => {
    assert.throws(() => robustJSONParse(""), /Empty response received/);
    assert.throws(() => robustJSONParse(null), /Empty response received/);
  });
});
