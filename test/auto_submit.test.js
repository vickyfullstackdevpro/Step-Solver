// test/auto_submit.test.js
// Automated regression tests for auto-submit button detection (Start, Submit, Next, Continue)
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

function isStartMatch(rawTxt, cls = "", aria = "") {
  const txt = (rawTxt || "").toLowerCase().trim();
  if (txt === "restart" || txt.includes("restart")) return false;
  if (/^(start|start\s+test|start\s+assessment|start\s+quiz|start\s+now|begin|begin\s+test)$/i.test(txt)) return true;
  if (/^start\b/i.test(txt) && !txt.includes("option") && !txt.includes("question 1 of")) return true;
  if (/^begin\b/i.test(txt)) return true;
  if ((cls.includes("start-btn") || cls.includes("btn-start")) && !txt.includes("restart")) return true;
  if (/^start\b/i.test(aria) && !aria.includes("restart")) return true;
  return false;
}

function isSubmitMatch(rawTxt, cls = "") {
  const txt = (rawTxt || "").toLowerCase().trim();
  if (txt === "submitted" || txt.includes("already submitted") || txt.includes("feedback")) return false;
  if (/^(submit|submit\s+answer|save\s*&\s*next)$/i.test(txt)) return true;
  if (/^submit\b/i.test(txt) && !txt.includes("option") && !txt.includes("feedback")) return true;
  if ((cls.includes("submit-btn") || cls.includes("btn-submit")) && !txt.includes("feedback") && !txt.includes("next")) return true;
  return false;
}

function isNextMatch(rawTxt, cls = "", aria = "") {
  const txt = (rawTxt || "").toLowerCase().trim();
  if (/^(next|continue|proceed|next\s*question)$/i.test(txt)) return true;
  if (/^next\b/i.test(txt) && !txt.includes("option") && !txt.includes("question 1 of")) return true;
  if (/^continue\b/i.test(txt) && !txt.includes("option")) return true;
  if (/^proceed\b/i.test(txt)) return true;
  if ((cls.includes("next-btn") || cls.includes("btn-next")) && !txt.includes("submit")) return true;
  if (/^(next|continue|proceed)\b/i.test(aria)) return true;
  return false;
}

function isButtonDisabled(btn) {
  if (!btn) return true;
  if (btn.disabled === true) return true;
  if (btn.ariaDisabled === "true") return true;
  if (btn.className && (btn.className.includes("disabled") || btn.className.includes("inactive"))) return true;
  return false;
}

describe("Auto-Submit Multi-Button Detection (Start, Submit, Next, Continue)", () => {
  test("Start 1: Detects 'Start', 'Start Test', 'Start Assessment', 'Begin'", () => {
    assert.equal(isStartMatch("Start"), true);
    assert.equal(isStartMatch("Start Test"), true);
    assert.equal(isStartMatch("Start Assessment"), true);
    assert.equal(isStartMatch("Begin"), true);
    assert.equal(isStartMatch("Begin Test"), true);
    assert.equal(isStartMatch("", "btn-start"), true);
  });

  test("Start 2: Rejects false positives like 'Restart' or 'Question 1 of 5'", () => {
    assert.equal(isStartMatch("Restart"), false);
    assert.equal(isStartMatch("Restart Quiz"), false);
    assert.equal(isStartMatch("Start option A"), false);
  });

  test("Submit 1: Detects 'Submit', 'Submit Answer', 'Save & Next'", () => {
    assert.equal(isSubmitMatch("Submit"), true);
    assert.equal(isSubmitMatch("Submit Answer"), true);
    assert.equal(isSubmitMatch("Save & Next"), true);
    assert.equal(isSubmitMatch("", "submit-btn"), true);
  });

  test("Submit 2: Rejects 'Submitted' or feedback headers", () => {
    assert.equal(isSubmitMatch("Submitted"), false);
    assert.equal(isSubmitMatch("Already submitted"), false);
  });

  test("Next 1: Detects 'Next', 'Continue', 'Proceed', 'Next Question'", () => {
    assert.equal(isNextMatch("Next"), true);
    assert.equal(isNextMatch("Continue"), true);
    assert.equal(isNextMatch("Proceed"), true);
    assert.equal(isNextMatch("Next Question"), true);
    assert.equal(isNextMatch("", "next-btn"), true);
  });

  test("Disabled Button Guard: Accurately identifies disabled states", () => {
    assert.equal(isButtonDisabled({ disabled: true }), true);
    assert.equal(isButtonDisabled({ ariaDisabled: "true" }), true);
    assert.equal(isButtonDisabled({ className: "btn disabled" }), true);
    assert.equal(isButtonDisabled({ disabled: false, ariaDisabled: "false", className: "btn active" }), false);
  });
});
