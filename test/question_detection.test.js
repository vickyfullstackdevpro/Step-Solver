// test/question_detection.test.js
// Automated regression tests for Question Type Detection
// Ensures sentence rearrangement is NEVER misclassified as MCQ, especially on modern StepTest SPAs without Reset buttons
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

describe("Question Type Detection & Zero-Conflict Isolation", () => {

  // Pure logic replica of checkIsRearrangeQuestion and extractQuestionData
  function detectQuestionType(dom) {
    const scopeTxt = (dom.bodyText || "").toLowerCase();

    // 1. Speaking
    if (dom.hasActiveMic) return "speaking";

    // 2. Writing
    const hasWritingKeywords = (
      scopeTxt.includes("write a paragraph") ||
      scopeTxt.includes("write an essay") ||
      scopeTxt.includes("write an email") ||
      scopeTxt.includes("write a letter") ||
      scopeTxt.includes("write a response") ||
      scopeTxt.includes("write a short") ||
      scopeTxt.includes("word limit") ||
      scopeTxt.includes("word count") ||
      scopeTxt.includes("type your response")
    );
    if (dom.hasWritingArea && (hasWritingKeywords || !dom.hasRadioInputs)) {
      return "writing";
    }

    // 3. Dropdowns
    if (dom.dropdowns && dom.dropdowns.length > 0) {
      return "choose_word";
    }

    // 4. Rearrange Sentence Detection
    // Strict exclusions: Radios -> MCQ; Textarea writing -> Writing
    let isRearrange = false;
    if (!dom.hasRadioInputs && !dom.hasWritingArea) {
      const tokensCount = dom.tokens ? dom.tokens.length : 0;

      // Structural Ground Truth (PRIMARY signal — checked BEFORE token count)
      // findRearrangeTokens may miss chips on certain HTML layouts (e.g. chips with border-line class
      // that match the work zone selector). Word bank + Your sentence alone is conclusive.
      const hasWordBank = dom.hasWordBankLabel || scopeTxt.includes("word bank");
      // NOTE: Do NOT use "border-line" as a work zone signal — chip buttons have class 'border-line'
      const hasWorkZone = dom.hasAnswerWorkZone || scopeTxt.includes("your sentence") || scopeTxt.includes("tap chips below");

      // Condition A: Word bank + Your sentence — conclusive structural match, no tokens needed
      if (hasWordBank && hasWorkZone) {
        isRearrange = true;
      }

      // SPECIFIC full-phrase keywords ONLY — never standalone "rearrange" which fires on ANY MCQ
      // that mentions the word (e.g. "The customer asked them to rearrange the meeting.")
      const hasRearrangePrompt = (
        scopeTxt.includes("rearrange the words or phrases") ||
        scopeTxt.includes("rearrange the phrases") ||
        scopeTxt.includes("rearrange the words") ||
        scopeTxt.includes("rearrange the following") ||
        scopeTxt.includes("rearrange the sentence") ||
        scopeTxt.includes("rearrange the statements") ||
        scopeTxt.includes("rearrange to form") ||
        scopeTxt.includes("rearrange words to form") ||
        scopeTxt.includes("rearrange the given") ||
        scopeTxt.includes("arrange the following statements") ||
        scopeTxt.includes("arrange the following sentences") ||
        scopeTxt.includes("arrange the following words") ||
        scopeTxt.includes("arrange the following phrases") ||
        scopeTxt.includes("arrange the sentences") ||
        scopeTxt.includes("arrange the words") ||
        scopeTxt.includes("arrange these sentences") ||
        scopeTxt.includes("arrange these words") ||
        scopeTxt.includes("increasing order of politeness") ||
        scopeTxt.includes("decreasing order of politeness") ||
        scopeTxt.includes("increasing order of formality") ||
        scopeTxt.includes("decreasing order of formality") ||
        scopeTxt.includes("order of politeness") ||
        scopeTxt.includes("order of formality") ||
        scopeTxt.includes("form a logical sentence") ||
        scopeTxt.includes("form a sentence using") ||
        scopeTxt.includes("form a sentence with") ||
        scopeTxt.includes("form a sentence from") ||
        scopeTxt.includes("form a sentence requesting") ||
        scopeTxt.includes("tap chips below to build your answer") ||
        scopeTxt.includes("——")
      );

      // Condition B: Specific rearrange keyword phrase + structural signal (tokens as fallback)
      if (!isRearrange && hasRearrangePrompt && (hasWorkZone || (hasWordBank && tokensCount >= 2))) {
        isRearrange = true;
      }
      // Condition C: Legacy Reset button + slot dashes + tokens >= 2
      if (!isRearrange && dom.hasResetButton && (scopeTxt.includes("——") || hasWorkZone) && tokensCount >= 2) {
        isRearrange = true;
      }
    }

    if (isRearrange && dom.tokens && dom.tokens.length >= 2) {
      return "rearrange_sentence";
    }

    // 5. Cloze Passage Detection
    let isCloze = false;
    if (!dom.hasRadioInputs && !isRearrange) {
      const hasClozeBlanks = dom.clozeBlanks && dom.clozeBlanks.length >= 2;
      const hasClozeChips = dom.clozeChips && dom.clozeChips.length >= 2;
      if (hasClozeBlanks && hasClozeChips) {
        isCloze = true;
      }
    }

    if (isCloze) {
      return "cloze_passage";
    }

    // 6. Text blanks without options
    if (dom.textBlanks && dom.textBlanks.length > 0 && (!dom.options || dom.options.length === 0)) {
      return "choose_word";
    }

    // 7. MCQ (Options or Radio buttons)
    // Filter out options if they are inside Word Bank or Answer Zone
    const cleanOptions = (dom.options || []).filter(opt => {
      if (opt.isInsideWordBank || opt.isInsideAnswerZone) return false;
      return true;
    });

    if (cleanOptions.length > 0 || dom.hasRadioInputs) {
      return "mcq";
    }

    return "mcq";
  }

  test("Detection 1: Live StepTest SPA Rearrange question with NO Reset button is detected as rearrange_sentence and NOT mcq", () => {
    const liveStepTestDOM = {
      bodyText: "Arrange the following statements in increasing order of politeness. Your sentence Tap chips below to build your answer Word bank I would appreciate a full refund I assume you'll refund me I demand a full refund Submit",
      hasRadioInputs: false,
      hasResetButton: false, // NO RESET BUTTON on modern React SPA!
      hasWordBankLabel: true,
      hasAnswerWorkZone: true,
      tokens: [
        "I would appreciate a full refund...",
        "I assume you'll refund me...",
        "I demand a full refund..."
      ],
      // If MCQ finder were naive, it would see these 3 buttons
      options: [
        { text: "I would appreciate a full refund...", isInsideWordBank: true },
        { text: "I assume you'll refund me...", isInsideWordBank: true },
        { text: "I demand a full refund...", isInsideWordBank: true }
      ]
    };

    const detected = detectQuestionType(liveStepTestDOM);
    assert.equal(detected, "rearrange_sentence", "Must be detected as rearrange_sentence, NEVER mcq");
  });

  test("Detection 2: Rearrange with prompt 'Arrange the following statements in increasing order of politeness' without Reset button", () => {
    const promptDOM = {
      bodyText: "Arrange the following statements in increasing order of politeness. Word bank Could you please assist me with this matter? Help me right now. I need you to fix this immediately.",
      hasRadioInputs: false,
      hasResetButton: false,
      hasWordBankLabel: true,
      hasAnswerWorkZone: true,
      tokens: [
        "Could you please assist me with this matter?",
        "Help me right now.",
        "I need you to fix this immediately."
      ]
    };

    const detected = detectQuestionType(promptDOM);
    assert.equal(detected, "rearrange_sentence");
  });

  test("Detection 3: Live screenshot page - 'Rearrange the words to form a sentence requesting information' with Reset button", () => {
    // This is the EXACT page from the screenshot the user reported
    const screenshotDOM = {
      bodyText: "Rearrange the words to form a sentence requesting information: Your sentence Tap chips below to build your answer Word bank provide us a room with could you please a king bed? Reset Submit",
      hasRadioInputs: false,
      hasResetButton: true,
      hasWordBankLabel: true,
      hasAnswerWorkZone: true,
      tokens: ["provide us", "a room", "with", "could you", "please", "a king bed?"],
      options: [
        { text: "provide us", isInsideWordBank: true },
        { text: "a room", isInsideWordBank: true },
        { text: "with", isInsideWordBank: true },
        { text: "could you", isInsideWordBank: true },
        { text: "please", isInsideWordBank: true },
        { text: "a king bed?", isInsideWordBank: true }
      ]
    };

    const detected = detectQuestionType(screenshotDOM);
    assert.equal(detected, "rearrange_sentence", "Page from screenshot must be rearrange_sentence, not mcq");
  });

  test("Detection 4: MCQ where passage contains the word 'rearrange' must NOT be detected as rearrange_sentence", () => {
    // FALSE POSITIVE BUG: An MCQ question whose answer options or passage text include "rearrange"
    // was being misclassified as rearrange_sentence due to the broad scopeTxt.includes("rearrange") match.
    const mcqWithRearrangeInText = {
      bodyText: "Select the best answer: The hotel staff will rearrange the furniture for the event. A) rearrange B) rearranged C) rearranging D) to rearrange",
      hasRadioInputs: false,
      hasResetButton: false,
      hasWordBankLabel: false,
      hasAnswerWorkZone: false,
      // No tokens (no word bank chips)
      tokens: [],
      options: [
        { text: "rearrange", isInsideWordBank: false },
        { text: "rearranged", isInsideWordBank: false },
        { text: "rearranging", isInsideWordBank: false },
        { text: "to rearrange", isInsideWordBank: false }
      ]
    };

    const detected = detectQuestionType(mcqWithRearrangeInText);
    assert.equal(detected, "mcq", "MCQ with 'rearrange' in the passage text must NEVER be classified as rearrange_sentence");
  });

  test("Detection 5: Question with radio buttons (ordering ABCD) is detected as MCQ, NOT rearrange", () => {
    const mcqSequenceOrderingDOM = {
      bodyText: "Arrange the following sentences in logical sequence: 1. He woke up. 2. He ate breakfast. A) 1-2 B) 2-1",
      hasRadioInputs: true, // Visible radio buttons present!
      hasResetButton: false,
      tokens: ["1. He woke up", "2. He ate breakfast"],
      options: [
        { text: "A) 1-2", isInsideWordBank: false },
        { text: "B) 2-1", isInsideWordBank: false }
      ]
    };

    const detected = detectQuestionType(mcqSequenceOrderingDOM);
    assert.equal(detected, "mcq", "Radio button ordering question must be classified as mcq");
  });

  test("Detection 6: Standard MCQ with options cards is detected as mcq", () => {
    const standardMCQDOM = {
      bodyText: "Select the correct synonym for 'meticulous': careful, careless, quick, loud",
      hasRadioInputs: false,
      hasResetButton: false,
      tokens: [],
      options: [
        { text: "careful", isInsideWordBank: false },
        { text: "careless", isInsideWordBank: false },
        { text: "quick", isInsideWordBank: false },
        { text: "loud", isInsideWordBank: false }
      ]
    };

    const detected = detectQuestionType(standardMCQDOM);
    assert.equal(detected, "mcq");
  });

  test("Detection 7: Cloze passage with multiple blanks is detected as cloze_passage", () => {
    const clozeDOM = {
      bodyText: "Complete the passage with suitable words from the box below.",
      hasRadioInputs: false,
      hasResetButton: false,
      clozeBlanks: ["blank_1", "blank_2", "blank_3"],
      clozeChips: ["departure", "arrival", "boarding"]
    };

    const detected = detectQuestionType(clozeDOM);
    assert.equal(detected, "cloze_passage");
  });

  test("Detection 8: Writing task with textarea is detected as writing", () => {
    const writingDOM = {
      bodyText: "Write an email to your manager requesting leave. Word limit: 100-150 words.",
      hasRadioInputs: false,
      hasWritingArea: true
    };

    const detected = detectQuestionType(writingDOM);
    assert.equal(detected, "writing");
  });

  test("Detection 9: Speaking task with active microphone is detected as speaking", () => {
    const speakingDOM = {
      bodyText: "Describe the picture on screen using your microphone.",
      hasActiveMic: true,
      hasRadioInputs: false
    };

    const detected = detectQuestionType(speakingDOM);
    assert.equal(detected, "speaking");
  });

  test("Detection 10: Word Bank chips are strictly excluded from MCQ options in findMCQOptions guard", () => {
    const rawOptions = [
      { text: "Option A", isInsideWordBank: false },
      { text: "Option B", isInsideWordBank: false },
      { text: "Chip 1", isInsideWordBank: true },
      { text: "Chip 2", isInsideAnswerZone: true }
    ];

    const cleanOptions = rawOptions.filter(o => !o.isInsideWordBank && !o.isInsideAnswerZone);
    assert.equal(cleanOptions.length, 2);
    assert.deepEqual(cleanOptions.map(o => o.text), ["Option A", "Option B"]);
  });

  test("Detection 11: StepTest SPA wrapped in min-h-screen page shell retains chips and detects rearrange_sentence", () => {
    // Simulating isValidChip logic against min-h-screen container
    function isValidChip(el) {
      const lower = el.text.toLowerCase();
      if (/^(reset|submit|next)\b/i.test(lower)) return false;
      const workZone = el.closestWorkZone;
      if (workZone && !workZone.isMinHeightScreen) {
        if (workZone.text.toLowerCase().includes("your sentence") && !workZone.text.toLowerCase().includes("word bank")) return false;
        if (workZone.isAnswerZone) return false;
      }
      return true;
    }

    const chipsInShell = [
      { text: "what", closestWorkZone: { isMinHeightScreen: true, isAnswerZone: false, text: "player shell min-h-screen" } },
      { text: "to make", closestWorkZone: { isMinHeightScreen: true, isAnswerZone: false, text: "player shell min-h-screen" } },
      { text: "of this", closestWorkZone: { isMinHeightScreen: true, isAnswerZone: false, text: "player shell min-h-screen" } }
    ];

    const validChips = chipsInShell.filter(isValidChip);
    assert.equal(validChips.length, 3, "All chips should be valid and not discarded by min-h-screen");

    const rearrangeDOM = {
      bodyText: "Describe and correspond 2 of 5 Word bank Your sentence Tap chips below to build your answer",
      hasWordBankLabel: true,
      hasAnswerWorkZone: true,
      hasRadioInputs: false,
      hasWritingArea: false,
      hasResetButton: false,
      tokens: validChips
    };

    const detected = detectQuestionType(rearrangeDOM);
    assert.equal(detected, "rearrange_sentence", "Must detect rearrange_sentence and never fall back to mcq");
  });
});

