// test/auto_solve_spa_gating.test.js
// Automated tests for Auto-Solve Next Question & SPA Route Gating (Submit-Button Gated)
// and Simplified, Unique Question Type Detection (Zero-Conflict on Shared Prompts)
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

describe("Auto-Solve Next Question & SPA Route Gating (Submit Button Gated)", () => {

  function createMockEnvironment(options = {}) {
    const state = {
      isEnabled: true,
      isAutoWatch: true,
      isProcessing: false,
      autoSubmitEnabled: options.autoSubmitEnabled || false,
      solvedQuestionIds: new Set(),
      lastSolvedQuestionId: null,
      statusText: "Ready",
      statusClass: "idle",
      statusCode: "IDLE"
    };

    let solveTriggerCount = 0;
    let questionScanCount = 0;
    let autoNextCount = 0;

    function updateStatus(text, cls, code) {
      state.statusText = text;
      state.statusClass = cls;
      state.statusCode = code;
    }

    function hasVisibleSubmitButton() {
      return Boolean(options.hasSubmitButton);
    }

    function isAnswerOrFeedbackPage() {
      return Boolean(options.isAnswerPage);
    }

    function findActiveQuestionContainer() {
      questionScanCount++;
      if (options.hasQuestionContainer) {
        return { id: "q-container-1", textContent: "Sample Question" };
      }
      return null;
    }

    function extractQuestionData(container) {
      return {
        questionText: options.questionText || "What is the answer?",
        options: options.options || (options.type === "rearrange_sentence" || options.type === "cloze_passage" ? [] : ["A", "B", "C", "D"]),
        sentenceTokens: options.sentenceTokens || [],
        wordChoices: options.wordChoices || [],
        type: options.type || "mcq"
      };
    }

    function getQuestionIdentifier(container, data) {
      if (options.questionId) return options.questionId;
      const typeTag = (data && data.type) ? data.type : "q";
      const titlePart = data && data.questionText ? data.questionText.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase() : "q";
      let contentFingerprint = "";
      if (data) {
        if (data.options && data.options.length > 0) {
          contentFingerprint = data.options.map(o => (typeof o === "string" ? o : o.text || "").slice(0, 15)).join("-");
        } else if (data.sentenceTokens && data.sentenceTokens.length > 0) {
          contentFingerprint = data.sentenceTokens.map(t => (typeof t === "string" ? t : t.text || "").slice(0, 10)).join("-");
        } else if (data.wordChoices && data.wordChoices.length > 0) {
          contentFingerprint = data.wordChoices.map(c => (typeof c === "string" ? c : c.text || "").slice(0, 10)).join("-");
        }
      }
      return [typeTag, titlePart, contentFingerprint].filter(Boolean).join("::");
    }

    function triggerSolve(isAuto = false) {
      if (!hasVisibleSubmitButton()) {
        if (!isAnswerOrFeedbackPage()) {
          updateStatus("Idle", "idle", "IDLE");
        }
        return;
      }
      solveTriggerCount++;
      const currentData = extractQuestionData();
      state.lastSolvedQuestionId = getQuestionIdentifier(null, currentData);
      state.solvedQuestionIds.add(state.lastSolvedQuestionId);
    }

    function handleAutoNext() {
      autoNextCount++;
      updateStatus("Next in 2s...", "working", "NEXT");
    }

    function runAutoSolveCycle() {
      if (!state.isEnabled || !state.isAutoWatch) return;

      // THE ONE AND ONLY RULE:
      // If the page has a visible submit button -> only scan for the question.
      // If not -> do NOT scan, switch to idle mode!
      if (!hasVisibleSubmitButton()) {
        if (isAnswerOrFeedbackPage()) {
          if (state.autoSubmitEnabled) {
            handleAutoNext();
          }
          return;
        }

        if (!state.isProcessing && state.statusText !== "Idle") {
          updateStatus("Idle", "idle", "IDLE");
        }
        return;
      }

      if (state.isProcessing) return;

      const container = findActiveQuestionContainer();
      if (!container) return;

      const data = extractQuestionData(container);
      const currentId = getQuestionIdentifier(container, data);

      if (currentId && !state.solvedQuestionIds.has(currentId) && currentId !== state.lastSolvedQuestionId) {
        triggerSolve(true);
      }
    }

    return {
      state,
      runAutoSolveCycle,
      triggerSolve,
      hasVisibleSubmitButton,
      setHasSubmitButton: (val) => { options.hasSubmitButton = val; },
      setIsAnswerPage: (val) => { options.isAnswerPage = val; },
      setQuestionData: (data) => {
        options.questionText = data.questionText;
        options.options = data.options;
        options.sentenceTokens = data.sentenceTokens;
        options.wordChoices = data.wordChoices;
        options.type = data.type;
        options.questionId = null;
      },
      getCounts: () => ({ solveTriggerCount, questionScanCount, autoNextCount })
    };
  }

  test("Rule 1: On Home Page / Chapter List (no Submit button), does NOT scan for questions and sets status to Idle", () => {
    const env = createMockEnvironment({
      hasSubmitButton: false,
      hasQuestionContainer: true,
      isAnswerPage: false
    });

    env.runAutoSolveCycle();

    const counts = env.getCounts();
    assert.equal(counts.questionScanCount, 0, "Question scan should NEVER run when submit button is absent");
    assert.equal(counts.solveTriggerCount, 0, "Solver should NEVER trigger when submit button is absent");
    assert.equal(env.state.statusText, "Idle", "Status text must transition to Idle");
    assert.equal(env.state.statusCode, "IDLE", "Status code must be IDLE");
  });

  test("Rule 2: On Active Question Page (with visible Submit button), scans for question and triggers solve", () => {
    const env = createMockEnvironment({
      hasSubmitButton: true,
      hasQuestionContainer: true,
      isAnswerPage: false,
      questionId: "q-unit-456"
    });

    env.runAutoSolveCycle();

    const counts = env.getCounts();
    assert.equal(counts.questionScanCount, 1, "Question scan must run when submit button is present");
    assert.equal(counts.solveTriggerCount, 1, "Solver must trigger for unsolved question");
    assert.ok(env.state.solvedQuestionIds.has("q-unit-456"), "Question must be marked solved");
  });

  test("Rule 3: Already solved question is not repeatedly solved on subsequent cycles", () => {
    const env = createMockEnvironment({
      hasSubmitButton: true,
      hasQuestionContainer: true,
      isAnswerPage: false,
      questionId: "q-unit-789"
    });

    env.runAutoSolveCycle();
    assert.equal(env.getCounts().solveTriggerCount, 1);

    // Second cycle on the same question
    env.runAutoSolveCycle();
    assert.equal(env.getCounts().solveTriggerCount, 1, "Should not re-trigger solve for already solved question");
  });

  test("Rule 4: On Answer/Feedback Page (no Submit button, Next button active), delegates to auto-next and does not scan questions", () => {
    const env = createMockEnvironment({
      hasSubmitButton: false,
      isAnswerPage: true,
      autoSubmitEnabled: true
    });

    env.runAutoSolveCycle();

    const counts = env.getCounts();
    assert.equal(counts.questionScanCount, 0, "Question scan must not run on answer/feedback page");
    assert.equal(counts.solveTriggerCount, 0, "Solve must not trigger on answer/feedback page");
    assert.equal(counts.autoNextCount, 1, "Auto-Next should be invoked when auto-submit is enabled");
  });

  test("Rule 5: SPA Client-side Route Transition (Moving from Question to Chapter list) instantly switches to Idle", () => {
    const env = createMockEnvironment({
      hasSubmitButton: true,
      hasQuestionContainer: true,
      isAnswerPage: false,
      questionId: "q-chapter-1"
    });

    // Step 1: Solving on Question Page
    env.runAutoSolveCycle();
    assert.equal(env.getCounts().solveTriggerCount, 1);

    // Step 2: User completes chapter or navigates to Home / Chapter list in SPA without full reload
    env.setHasSubmitButton(false);
    env.setIsAnswerPage(false);

    // Simulated route change callback
    env.runAutoSolveCycle();

    assert.equal(env.state.statusText, "Idle", "Status must immediately switch to Idle upon leaving question page");
    assert.equal(env.getCounts().solveTriggerCount, 1, "No further solves should occur on home/chapter list");
  });

  test("Rule 6: Manual triggerSolve(false) on non-question page immediately exits and switches to Idle", () => {
    const env = createMockEnvironment({
      hasSubmitButton: false,
      isAnswerPage: false
    });

    env.triggerSolve(false);

    assert.equal(env.getCounts().solveTriggerCount, 0, "triggerSolve must immediately abort when no submit button");
    assert.equal(env.state.statusText, "Idle");
  });

  test("Rule 7: Consecutive questions with the EXACT SAME prompt do NOT conflict and both get solved", () => {
    const env = createMockEnvironment({
      hasSubmitButton: true,
      hasQuestionContainer: true,
      isAnswerPage: false,
      type: "rearrange_sentence",
      questionText: "Rearrange the following words to form a sentence.",
      sentenceTokens: ["I", "love", "learning", "languages"]
    });

    // Solve Question 1
    env.runAutoSolveCycle();
    assert.equal(env.getCounts().solveTriggerCount, 1, "Question 1 must be solved");

    // Move to Question 2 with identical prompt text, but different tokens
    env.setQuestionData({
      type: "rearrange_sentence",
      questionText: "Rearrange the following words to form a sentence.",
      sentenceTokens: ["She", "reads", "a", "book", "daily"]
    });

    env.runAutoSolveCycle();
    assert.equal(env.getCounts().solveTriggerCount, 2, "Question 2 with identical prompt MUST be recognized as new and solved");
  });

  test("Rule 8: Shared prompt across different question types (MCQ vs Cloze) creates distinct, separate identifiers", () => {
    const env = createMockEnvironment({
      hasSubmitButton: true,
      hasQuestionContainer: true,
      isAnswerPage: false,
      type: "mcq",
      questionText: "Fill in the blanks with suitable words",
      options: ["option A", "option B", "option C", "option D"]
    });

    // Solve MCQ Question
    env.runAutoSolveCycle();
    assert.equal(env.getCounts().solveTriggerCount, 1);

    // Next question is a Cloze with the exact same prompt text
    env.setQuestionData({
      type: "cloze_passage",
      questionText: "Fill in the blanks with suitable words",
      wordChoices: ["happy", "sad", "angry"]
    });

    env.runAutoSolveCycle();
    assert.equal(env.getCounts().solveTriggerCount, 2, "Cloze question with same prompt as MCQ MUST be recognized and solved separately");
  });
});
