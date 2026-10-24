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

describe("Auto-Submit Waiting Logic & Scoped Exceptional Fallback", () => {
  function isExceptionalQuestion(type, text = "") {
    const t = (type || "").toLowerCase();
    const txt = (text || "").toLowerCase();
    if (t === "cloze_passage" || t === "rearrange_sentence") return true;
    if (txt.includes("rearrange the sentence") || txt.includes("arrange the following sentences") || txt.includes("fill in the blanks with suitable words")) {
      return true;
    }
    return false;
  }

  function hasAnyAnswerSelectedMock(domState) {
    if (!domState) return false;
    if (domState.hasCheckedRadio) return true;
    if (domState.hasSelectedClass) return true;
    if (domState.hasPlacedChips && domState.placedChipsCount > 0) return true;
    if (domState.textInputValue && domState.textInputValue.trim().length > 0) return true;
    if (domState.selectedDropdownIndex > 0) return true;
    return false;
  }

  function isAnswerOrFeedbackPageMock(hasFeedbackElements, hasFeedbackKeywords, hasUnansweredQuestionElements, submitBtnDisabled) {
    if (hasFeedbackElements) return true;
    if (hasFeedbackKeywords) return true;
    if (hasUnansweredQuestionElements) return false;
    if (submitBtnDisabled) return true;
    return false;
  }

  function triggerSolvePostLockSimulation(solveResult, state) {
    let effectiveClickedCount = 0;
    if (solveResult && typeof solveResult === "object") {
      effectiveClickedCount = solveResult.clickedCount || 0;
    }

    const isSuccess = solveResult && solveResult.success && effectiveClickedCount > 0;
    if (!isSuccess) {
      state.isProcessing = false;
      state.inFlightQuestionId = null;
      return { success: false, submitted: false };
    }

    state.lastSolvedQuestionId = state.inFlightQuestionId;
    state.solvedQuestionIds.add(state.inFlightQuestionId);
    state.inFlightQuestionId = null;
    state.isProcessing = false;

    return { success: true, submitted: state.autoSubmitEnabled };
  }

  function fallbackFillSimulation(questionType, autoSubmitEnabled, solveResult) {
    const exceptional = isExceptionalQuestion(questionType);
    if (!autoSubmitEnabled || !exceptional) {
      // Standard MCQs or manual solves NEVER use random fallback!
      return solveResult;
    }
    if (solveResult.clickedCount === 0) {
      return { success: true, clickedCount: 3, message: "Filled via fallback" };
    }
    return solveResult;
  }

  test("Exceptional Type 1: Accurately identifies Cloze & Rearrange as exceptional", () => {
    assert.equal(isExceptionalQuestion("cloze_passage"), true);
    assert.equal(isExceptionalQuestion("rearrange_sentence"), true);
    assert.equal(isExceptionalQuestion("mcq", "Rearrange the sentence in logical order"), true);
    assert.equal(isExceptionalQuestion("mcq", "Choose the best synonym for happy"), false);
    assert.equal(isExceptionalQuestion("choose_word"), false);
  });

  test("Answer Verification Guard: Blocks auto-submit when DOM has zero selected items", () => {
    assert.equal(hasAnyAnswerSelectedMock({ hasCheckedRadio: false, textInputValue: "" }), false);
    assert.equal(hasAnyAnswerSelectedMock({ hasCheckedRadio: true }), true);
    assert.equal(hasAnyAnswerSelectedMock({ hasSelectedClass: true }), true);
    assert.equal(hasAnyAnswerSelectedMock({ hasPlacedChips: true, placedChipsCount: 2 }), true);
    assert.equal(hasAnyAnswerSelectedMock({ textInputValue: "completed" }), true);
    assert.equal(hasAnyAnswerSelectedMock({ selectedDropdownIndex: 1 }), true);
  });

  test("Active Question Protection: Never flags active question with options as Answer Page", () => {
    // When Question 2 loads with options and disabled Submit button, but no feedback elements
    const isAnswer = isAnswerOrFeedbackPageMock(false, false, true, true);
    assert.equal(isAnswer, false, "Active question with options must NOT be mistaken for Answer page!");

    // Real Answer / Feedback page with explanation element
    const isRealAnswer = isAnswerOrFeedbackPageMock(true, false, false, true);
    assert.equal(isRealAnswer, true, "True feedback container must be identified as Answer page");
  });

  test("Post-Solve Locking: Question ID is only locked in solvedQuestionIds AFTER successful solve", () => {
    const mockState = {
      solvedQuestionIds: new Set(),
      lastSolvedQuestionId: "",
      inFlightQuestionId: "Q_2_OF_5",
      isProcessing: true,
      autoSubmitEnabled: true
    };

    // Failed solve (e.g. rate limit, 0 clicked items)
    const failOutcome = triggerSolvePostLockSimulation({ success: false, clickedCount: 0 }, mockState);
    assert.equal(failOutcome.success, false);
    assert.equal(mockState.solvedQuestionIds.has("Q_2_OF_5"), false, "Failed solve must NOT lock questionId!");
    assert.equal(mockState.isProcessing, false);

    // Successful solve
    mockState.inFlightQuestionId = "Q_2_OF_5";
    mockState.isProcessing = true;
    const successOutcome = triggerSolvePostLockSimulation({ success: true, clickedCount: 1 }, mockState);
    assert.equal(successOutcome.success, true);
    assert.equal(mockState.solvedQuestionIds.has("Q_2_OF_5"), true, "Successful solve locks questionId post-click");
  });

  test("Scoped Fallback: Fallback fill runs ONLY for exceptional questions when Auto-Submit is ON", () => {
    // 1. Standard MCQ question with 0 clicks -> Fallback must NEVER run
    const mcqResult = fallbackFillSimulation("mcq", true, { success: false, clickedCount: 0 });
    assert.equal(mcqResult.clickedCount, 0, "Standard MCQ must not use random fallback even if Auto-Submit is ON");

    // 2. Cloze question with 0 clicks and Auto-Submit is OFF -> Fallback must NOT run
    const clozeManual = fallbackFillSimulation("cloze_passage", false, { success: false, clickedCount: 0 });
    assert.equal(clozeManual.clickedCount, 0, "Cloze question must not fallback click when Auto-Submit is OFF");

    // 3. Cloze question with 0 clicks and Auto-Submit is ON -> Fallback MUST run
    const clozeAuto = fallbackFillSimulation("cloze_passage", true, { success: false, clickedCount: 0 });
    assert.equal(clozeAuto.clickedCount, 3, "Cloze question must auto-fill when Auto-Submit is ON");
    assert.equal(clozeAuto.success, true);

    // 4. Rearrange question with 0 clicks and Auto-Submit is ON -> Fallback MUST run
    const rearrangeAuto = fallbackFillSimulation("rearrange_sentence", true, { success: false, clickedCount: 0 });
    assert.equal(rearrangeAuto.clickedCount, 3, "Rearrange question must auto-fill when Auto-Submit is ON");
    assert.equal(rearrangeAuto.success, true);
  });

  test("Non-Question Page Guard: Rejects course landing pages without test buttons", () => {
    function mockIsQuestionOrTestActive(url, hasSubmit, hasReset, hasQuestionMeta) {
      if (hasSubmit || hasReset || hasQuestionMeta) return true;
      if (url.includes("/courses/") || url.includes("/dashboard") || url.includes("/home")) {
        return false;
      }
      return false;
    }

    assert.equal(mockIsQuestionOrTestActive("https://steptest.ai/courses/931", false, false, false), false, "Course dashboard must be recognized as non-question page");
    assert.equal(mockIsQuestionOrTestActive("https://steptest.ai/courses/931/test/1", true, false, false), true, "Test page with submit button must be active");
    assert.equal(mockIsQuestionOrTestActive("https://steptest.ai/courses/931/test/2", false, true, false), true, "Test page with reset button must be active");
  });

  test("Question Fingerprinting: Generates distinct IDs for identical prompts with different choices", () => {
    function computeId(prompt, options) {
      const titlePart = prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      const optionsSnippet = options.map(o => o.slice(0, 8)).join("_").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase().slice(0, 30);
      return `${titlePart}::${optionsSnippet}`;
    }

    const q1 = computeId("Choose the correct word:", ["apple", "banana", "cherry"]);
    const q2 = computeId("Choose the correct word:", ["dog", "elephant", "fox"]);

    assert.notEqual(q1, q2, "Two questions with identical prompt must have different IDs based on options");
  });
});

