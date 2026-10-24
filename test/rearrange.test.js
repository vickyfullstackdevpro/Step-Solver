// test/rearrange.test.js
// Automated regression tests for Sentence / Story Rearrangement and Word Bank isolation
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

// Token Text Normalizer mirrored from content.js & background.js
function normalizeTokenText(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/^(?:(?:\d+|[a-z])[\.\)\-:]|\((?:\d+|[a-z])\)|(?:sentence|phrase|clause)\s*\d+[:\-]?)\s*/i, "")
    .replace(/[“’”'"]/g, "")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Chip Validator logic mirrored from content.js
function isValidChipText(txt, isInsideDestination = false) {
  if (!txt || typeof txt !== "string") return false;
  const trimmed = txt.trim();
  if (trimmed.length < 1 || trimmed.length > 500) return false;
  if (isInsideDestination) return false;

  const lower = trimmed.toLowerCase();

  // Navigation / Action words
  if (/^(reset|submit|next|replay|play|save|continue|grade|abc|record|speak|mic|listen|share|subscribe)\b/i.test(lower)) return false;

  // Prompts & instructions
  if (lower.startsWith("rearrange the words or phrases")) return false;
  if (lower.startsWith("arrange the following sentences")) return false;
  if (lower.startsWith("rearrange the following sentences")) return false;
  if (lower.startsWith("arrange the sentences")) return false;
  if (lower.startsWith("rearrange the sentence")) return false;
  if (lower.startsWith("rearrange words")) return false;
  if (lower.startsWith("rearrange phrases")) return false;
  if (lower.startsWith("form a logical sentence")) return false;
  if (lower.startsWith("form sentences")) return false;
  if (lower.startsWith("form a sentence")) return false;

  // Filter contextual prompts containing rearrange instructions
  if (lower.includes("arrange the following sentences") || lower.includes("rearrange the following sentences")) return false;
  if (lower.includes("in the correct sequence to see") || lower.includes("in the correct sequence")) return false;
  if (lower.includes("rearrange the words or phrases") || lower.includes("form a logical sentence")) return false;

  // Video helpers
  if (lower.includes("if the video is not loading")) return false;
  if (lower === "click here" || lower.startsWith("click here")) return false;
  if (lower.includes("watch on youtube") || lower.includes("step - the hindu group")) return false;
  if (lower.includes("record your answer using your microphone")) return false;
  if (lower.includes("form sentences that express opinion")) return false;
  if (/^\d{1,2}:\d{2}/.test(lower)) return false;

  // UI Headers & Subtext
  if (lower === "your sentence" || lower === "your answer" || lower === "your story" || lower === "your passage" || lower === "your response") return false;
  if (lower === "word bank" || lower === "phrase bank" || lower === "word list" || lower === "words" || lower === "words to arrange") return false;
  if (lower.includes("tap chips below") || lower.includes("tap words below") || lower.includes("build your answer")) return false;
  if (lower.includes("tap on the words") || lower.includes("tap to build")) return false;

  // Punctuation & counters
  if (txt.includes("“") || txt.includes("”")) return false;
  if (/^[—–\-_.\s]+$/.test(txt)) return false;
  if (/^\d+\s+of\s+\d+(\s+questions?)?$/i.test(txt)) return false;

  return true;
}

// Clean Board Check Simulation
function needsBoardReset(destBoxItemsCount, slotDashesCount) {
  return destBoxItemsCount > 0 || slotDashesCount > 0;
}

describe("Sentence / Story Rearrangement & Word Bank Isolation", () => {
  test("Rearrange 1: Rejects UI container labels from being parsed as chips", () => {
    assert.strictEqual(isValidChipText("YOUR SENTENCE"), false, "YOUR SENTENCE should be filtered");
    assert.strictEqual(isValidChipText("Tap chips below to build your answer"), false, "Subtext instruction should be filtered");
    assert.strictEqual(isValidChipText("WORD BANK"), false, "WORD BANK header should be filtered");
    assert.strictEqual(isValidChipText("Reset"), false, "Reset button should be filtered");
    assert.strictEqual(isValidChipText("If the video is not loading, click here"), false, "Video notice should be filtered");
    assert.strictEqual(isValidChipText("Click here"), false, "Click here button should be filtered");
    assert.strictEqual(isValidChipText("Aarav is writing to his friend about his trip. Arrange the following sentences in the correct sequence to see how Aarav's day went."), false, "Main prompt should be filtered");
  });

  test("Rearrange 2: Rejects any chip text if it resides inside the destination box (already placed)", () => {
    const validSentence = "A beach trek in Gokarna was an experience of a lifetime.";
    // When inside destination box
    assert.strictEqual(isValidChipText(validSentence, true), false, "Chips inside destination box must not be extracted as Word Bank pool");
    // When inside Word Bank source
    assert.strictEqual(isValidChipText(validSentence, false), true, "Chips inside Word Bank pool must be accepted");
  });

  test("Rearrange 3: Validates genuine full-sentence chips from Aarav's Day story", () => {
    const aaravStoryChips = [
      "Evening camps around a bonfire are a good time to make new friends...",
      "While trekking was one of the main goals of the trip...",
      "It's left me with so many good memories...",
      "A beach trek in Gokarna was an experience of a lifetime...",
      "The full day trek was very exciting but also exhausting."
    ];

    aaravStoryChips.forEach(chip => {
      assert.strictEqual(isValidChipText(chip, false), true, `Expected "${chip}" to be a valid chip`);
    });
  });

  test("Rearrange 4: Normalizes token text and removes prefixes/punctuation", () => {
    assert.strictEqual(
      normalizeTokenText("1. A beach trek in Gokarna was an experience of a lifetime!"),
      "a beach trek in gokarna was an experience of a lifetime"
    );
    assert.strictEqual(
      normalizeTokenText("Sentence 3: It's left me with so many good memories..."),
      "its left me with so many good memories"
    );
    assert.strictEqual(
      normalizeTokenText("A) While trekking was one of the main goals of the trip,"),
      "while trekking was one of the main goals of the trip"
    );
  });

  test("Rearrange 5: Detects unclean board and signals Reset before placing tokens", () => {
    // Empty board
    assert.strictEqual(needsBoardReset(0, 0), false, "Fresh board should not need reset");

    // Board with duplicate or pre-filled tokens in YOUR SENTENCE
    assert.strictEqual(needsBoardReset(2, 0), true, "Board with placed tokens must trigger reset");
    assert.strictEqual(needsBoardReset(0, 1), true, "Board with slotted dashes must trigger reset");
  });

  test("Rearrange 6: Sequence consensus sorts chronological narrative correctly", () => {
    const originalWordBank = [
      { text: "Evening camps around a bonfire are a good time to make new friends..." },
      { text: "While trekking was one of the main goals of the trip..." },
      { text: "It's left me with so many good memories..." },
      { text: "A beach trek in Gokarna was an experience of a lifetime..." },
      { text: "The full day trek was very exciting but also exhausting." }
    ];

    // Gemini solution indicating chronological order
    const solution = {
      reordered_token_texts: [
        "A beach trek in Gokarna was an experience of a lifetime...",
        "While trekking was one of the main goals of the trip...",
        "The full day trek was very exciting but also exhausting.",
        "Evening camps around a bonfire are a good time to make new friends...",
        "It's left me with so many good memories..."
      ]
    };

    const remaining = [...originalWordBank];
    const orderedSequence = [];

    for (const target of solution.reordered_token_texts) {
      const cleanTarget = normalizeTokenText(target);
      const matchIdx = remaining.findIndex(tok => normalizeTokenText(tok.text) === cleanTarget);
      if (matchIdx !== -1) {
        orderedSequence.push(remaining[matchIdx]);
        remaining.splice(matchIdx, 1);
      }
    }

    assert.strictEqual(orderedSequence.length, 5, "All 5 sentences must be matched");
    assert.strictEqual(orderedSequence[0].text.startsWith("A beach trek"), true, "Step 1 must be introduction / beach trek");
    assert.strictEqual(orderedSequence[1].text.startsWith("While trekking"), true, "Step 2 must be daytime trekking");
    assert.strictEqual(orderedSequence[2].text.startsWith("The full day"), true, "Step 3 must be trek conclusion");
    assert.strictEqual(orderedSequence[3].text.startsWith("Evening camps"), true, "Step 4 must be evening bonfire");
    assert.strictEqual(orderedSequence[4].text.startsWith("It's left me"), true, "Step 5 must be reflection / memories");
  });
});
