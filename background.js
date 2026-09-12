// background.js - Service Worker for Gemini Live Question Solver
importScripts("auth.js");

const DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";
const BURNT_KEY = "AQ.Ab8RN6I1C1o7hEEyqfwMJUFw1TdSg-kRieVIS06703505QTCrQ";

// Trial & Lifetime Subscription Configuration
const TRIAL_DURATION_MS = 30 * 60 * 1000; // 30 minutes in milliseconds
const LIFETIME_PURCHASE_URL = "https://vignesh-fullstackdev-portfolio.vercel.app/";

// Initialize trial timestamp upon first installation
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["trialStartedAt", "isLifetimeActive"]);
  if (!data.trialStartedAt && !data.isLifetimeActive) {
    await chrome.storage.local.set({ trialStartedAt: Date.now() });
  }
});

// Setup Declarative Net Request rules to eliminate CORS preflight & Origin restrictions for backend APIs
function setupCorsRules() {
  if (!chrome.declarativeNetRequest) return;
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1001, 1002],
    addRules: [
      {
        id: 1001,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Origin", operation: "remove" }
          ],
          responseHeaders: [
            { header: "Access-Control-Allow-Origin", operation: "set", value: "*" },
            { header: "Access-Control-Allow-Methods", operation: "set", value: "GET, POST, OPTIONS, PUT, DELETE, PATCH" },
            { header: "Access-Control-Allow-Headers", operation: "set", value: "*" }
          ]
        },
        condition: {
          urlFilter: "||api.razorpay.com/*"
        }
      },
      {
        id: 1002,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Origin", operation: "remove" }
          ],
          responseHeaders: [
            { header: "Access-Control-Allow-Origin", operation: "set", value: "*" },
            { header: "Access-Control-Allow-Methods", operation: "set", value: "GET, POST, OPTIONS, PUT, DELETE, PATCH" },
            { header: "Access-Control-Allow-Headers", operation: "set", value: "*" }
          ]
        },
        condition: {
          urlFilter: "||api.resend.com/*"
        }
      }
    ]
  }).catch((err) => console.warn("[DNR] Rule setup notice:", err.message));
}

setupCorsRules();

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SOLVE_QUESTION") {
    handleSolveQuestion(request.payload)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({
        success: false,
        error: err.message,
        code: err.code,
        isTrialExpired: !!err.isTrialExpired,
        purchaseUrl: err.purchaseUrl || LIFETIME_PURCHASE_URL
      }));
    return true; // Keep message channel open for async response
  }

  if (request.action === "CREATE_RAZORPAY_PAYMENT_LINK") {
    StepAuth.createRazorpayPaymentLink(request.customerEmail, request.customerName)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "VERIFY_RAZORPAY_PAYMENT_LINK") {
    StepAuth.verifyRazorpayPaymentLink(request.paymentLinkId)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "SEND_RESEND_VERIFICATION") {
    StepAuth.sendResendVerificationNotice(request.recipientEmail, request.userName)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "GET_SUBSCRIPTION_STATUS") {
    getSubscriptionStatus()
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "ACTIVATE_LICENSE_KEY") {
    handleActivateLicenseKey(request.licenseKey)
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "TEST_API_KEY") {
    testApiKey(request.apiKey, request.model)
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "GET_AVAILABLE_MODELS") {
    autoDetectBestModel(request.apiKey)
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "REFRESH_ALL_KEYS") {
    handleRefreshAllKeys()
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "REFRESH_SINGLE_KEY") {
    handleRefreshSingleKey(request.keyIndex)
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// Listen for keyboard shortcut commands
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (command === "solve_current_question") {
    chrome.tabs.sendMessage(tab.id, { action: "TRIGGER_SOLVE" }).catch(() => {});
  } else if (command === "toggle_hud") {
    chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_HUD" }).catch(() => {});
  }
});

// Auto-detect all models supported by this user's API key and choose the best one
async function autoDetectBestModel(apiKey) {
  if (!apiKey) throw new Error("Please enter your Gemini API key.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);

  if (!response.ok) {
    let errorMsg = `API Key Verification Failed (${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.error?.message) errorMsg = errorJson.error.message;
    } catch (_) {}
    throw new Error(errorMsg);
  }

  const data = await response.json();
  const rawModels = data.models || [];

  // Filter for models that support text generation (generateContent)
  // Filter out deprecated models like gemini-2.5-flash that are no longer available
  const validModels = rawModels
    .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .filter(m => !/2\.5-flash/i.test(m.name))
    .map(m => {
      const id = m.name.replace(/^models\//, "");
      return {
        id: id,
        displayName: m.displayName || id,
        description: m.description || ""
      };
    });

  if (validModels.length === 0) {
    throw new Error("No active text generation models found for this API key.");
  }

  // Model selection priority:
  // Prefer gemini-3.1-flash-lite-preview for ultra-low token consumption and fastest execution,
  // then fallback to other flash models if unavailable for the key
  const priorityPatterns = [
    /^gemini-3\.1-flash-lite-preview/i,
    /^gemini-3\.1-flash-lite/i,
    /^gemini-3\.\d+-flash-lite/i,
    /flash-lite/i,
    /^gemini-3\.6-flash/i,
    /^gemini-3\.\d+-flash/i,
    /^gemini-2\.0-flash/i,
    /^gemini-1\.5-flash/i,
    /flash/i,
    /^gemini-3/i,
    /^gemini-2/i,
    /^gemini-1\.5-pro/i,
    /^gemini/i
  ];

  // Sort candidate models by priority
  const sortedModels = [...validModels].sort((a, b) => {
    let idxA = priorityPatterns.findIndex(p => p.test(a.id));
    let idxB = priorityPatterns.findIndex(p => p.test(b.id));
    if (idxA === -1) idxA = 999;
    if (idxB === -1) idxB = 999;
    return idxA - idxB;
  });

  const best = sortedModels[0];

  return {
    bestModel: best.id,
    bestModelName: best.displayName,
    models: validModels,
    sortedModels: sortedModels
  };
}

const keyModelCache = new Map();

async function getOrDetectModel(apiKey) {
  if (keyModelCache.has(apiKey)) {
    const cached = keyModelCache.get(apiKey);
    if (Date.now() - cached.time < 3600000) {
      return cached.model;
    }
  }
  try {
    const detection = await autoDetectBestModel(apiKey);
    keyModelCache.set(apiKey, { model: detection.bestModel, time: Date.now() });
    return detection.bestModel;
  } catch (err) {
    console.warn("[Gemini Solver] Model detection fallback to default:", err.message);
    return DEFAULT_MODEL;
  }
}

// Query Gemini API with question payload and automatic key failover (Max 10 keys)
async function handleSolveQuestion(payload) {
  // 1. Verify User Authentication Session
  if (typeof StepAuth !== "undefined") {
    const session = await StepAuth.getStoredSession();
    if (!session || !session.access_token) {
      const err = new Error("Authentication required. Please click the Step Solver extension icon and sign in.");
      err.code = "AUTH_REQUIRED";
      throw err;
    }

    // 2. Strict Single-Device Concurrency Lock Verification
    const concurrency = await StepAuth.verifyDeviceConcurrency();
    if (concurrency.isDeviceActive === false) {
      const err = new Error("Device revoked. Your account is active on another device. Open the extension popup to claim this device.");
      err.code = "DEVICE_REVOKED";
      throw err;
    }
  }

  // 3. Verify 30-Minute Free Trial / Lifetime Subscription
  const subStatus = await getSubscriptionStatus();
  if (subStatus.isTrialExpired && !subStatus.isLifetime) {
    const error = new Error("Your 30-minute free trial has expired. Upgrade to Lifetime Access to continue solving.");
    error.code = "TRIAL_EXPIRED";
    error.isTrialExpired = true;
    error.purchaseUrl = subStatus.purchaseUrl;
    throw error;
  }

  const settings = await chrome.storage.local.get([
    "geminiApiKeys",
    "activeKeyIndex",
    "geminiApiKey",
    "geminiModel"
  ]);

  let keys = Array.isArray(settings.geminiApiKeys) ? [...settings.geminiApiKeys] : [];
  let activeIndex = typeof settings.activeKeyIndex === "number" ? settings.activeKeyIndex : 0;

  // Filter out burned / invalid key
  keys = keys.filter(k => {
    const kStr = typeof k === "string" ? k : k?.key;
    return kStr && typeof kStr === "string" && kStr.trim() !== BURNT_KEY;
  });

  // Migrate legacy single key if present
  if (keys.length === 0 && settings.geminiApiKey && typeof settings.geminiApiKey === "string" && settings.geminiApiKey.trim() !== BURNT_KEY) {
    keys.push({
      key: settings.geminiApiKey.trim(),
      model: settings.geminiModel || "Auto-Selected",
      status: "active",
      addedAt: Date.now()
    });
    activeIndex = 0;
  }

  if (keys.length === 0) {
    const error = new Error("Gemini API key is not configured. Please open the extension popup and add your Gemini API key.");
    error.code = "API_KEY_MISSING";
    throw error;
  }

  // Hard limit: max 10 keys
  if (keys.length > 10) {
    keys = keys.slice(0, 10);
  }

  if (activeIndex >= keys.length) {
    activeIndex = 0;
  }

  const originalIndex = activeIndex;
  let currentIndex = activeIndex;
  let attempts = 0;
  let rotated = false;
  let lastError = null;

  // Loop through available keys in pool if rate limits / token drains occur
  while (attempts < keys.length) {
    const keyObj = keys[currentIndex];
    const apiKey = (typeof keyObj === "string" ? keyObj : keyObj?.key || "").trim();
    if (!apiKey) {
      currentIndex = (currentIndex + 1) % keys.length;
      attempts++;
      continue;
    }

    // Auto-detect optimal model for this key if not already configured
    let model = keyObj.model;
    if (!model || model === "Auto-Selected" || model === "auto") {
      model = await getOrDetectModel(apiKey);
      keyObj.model = model;
    }

    try {
      const prompt = buildGeminiPrompt(payload);
      const responseData = await callGeminiAPI(apiKey, model, prompt);

      // If we switched keys during failover, persist the active key & state
      if (rotated) {
        keys.forEach((k, idx) => {
          if (idx === currentIndex) k.status = "active";
          else if (k.status === "active") k.status = "standby";
        });
        await chrome.storage.local.set({
          geminiApiKeys: keys,
          activeKeyIndex: currentIndex,
          geminiApiKey: apiKey,
          geminiModel: model
        });
      }

      return {
        ...responseData,
        _keyRotated: rotated,
        _originalKeyIndex: originalIndex,
        _activeKeyIndex: currentIndex,
        _totalKeys: keys.length,
        _modelUsed: model
      };
    } catch (err) {
      const isQuotaOrRateLimit =
        err.code === "RATE_LIMITED" ||
        err.message.toLowerCase().includes("429") ||
        err.message.toLowerCase().includes("quota") ||
        err.message.toLowerCase().includes("rate limit") ||
        err.message.toLowerCase().includes("exhausted") ||
        err.message.toLowerCase().includes("resource_exhausted");

      if (isQuotaOrRateLimit && keys.length > 1) {
        console.warn(`[Gemini Solver] Key #${currentIndex + 1} quota/token drained. Rotating to next key in pool...`);
        keyObj.status = "exhausted";
        currentIndex = (currentIndex + 1) % keys.length;
        rotated = true;
        attempts++;
        lastError = err;
        continue; // Retry with next key in pool
      } else {
        throw err;
      }
    }
  }

  // All keys in the pool were exhausted
  await chrome.storage.local.set({ geminiApiKeys: keys });
  throw new Error(`All ${keys.length} API keys in your pool have exhausted their rate limit / daily quota. Please wait a minute or add a fresh key in the extension settings.`);
}

// Construct clear prompt instructing Gemini to solve the detected question
function buildGeminiPrompt(payload) {
  return `You are an expert exam, test, and assessment solver. Your job is to analyze the provided on-screen question and return the 100% accurate, high-scoring answer in a strictly structured JSON format.

QUESTION DETAILS:
Question Category / Intended Type: ${payload.type || "Auto-detect"}
Question Prompt:
"""
${payload.questionText || "No explicit text, see options and context below"}
"""

Surrounding Context / Instructions:
"""
${payload.context || "None"}
"""

Extracted Options (for MCQ / Word Choice):
${JSON.stringify(payload.options || [], null, 2)}

Extracted Dropdowns (for Choose the Correct Word or Speaking dropdowns):
${JSON.stringify(payload.dropdowns || [], null, 2)}

Extracted Scrambled Tokens (for Rearrange Sentence):
${JSON.stringify(payload.sentenceTokens || [], null, 2)}

Extracted Word Choice Chips (for Multi-Blank Cloze Passage):
${JSON.stringify(payload.wordChoices || [], null, 2)}

Writing Criteria / Constraints:
${JSON.stringify(payload.writingConstraints || {}, null, 2)}

CRITICAL CLASSIFICATION & SOLVING RULES:
- If Question Category is 'writing' OR if a writing textarea/box is present (payload.writingConstraints && payload.writingConstraints.hasTextarea) OR if the prompt asks to "write a paragraph", "write an essay", "write an email", "write a letter", "write a response", "describe", "summarize", or specifies a word limit: THIS IS A WRITING QUESTION!
  * You MUST set "detected_type": "writing".
  * In "writing_answer", write a comprehensive, articulate, natural, grammatically flawless, high-scoring response that directly addresses all instructions.
  * Strictly adhere to any stated word limit or paragraph structure (e.g. 50-100 words, 100-150 words).
  * DO NOT classify this as MCQ even if format buttons or toolbars are present!
- If the question asks to arrange sentences/paragraphs and provides multiple-choice permutation options like "ADCB", "DCAB", "CADB", "1-3-4-2": THIS IS AN MCQ QUESTION!
  * Set "detected_type": "mcq" and return the chosen permutation in "mcq_answers" (e.g. ["DCAB"]) and its index in "mcq_indices".
- If Question Category is 'cloze_passage' OR if the question prompt asks to "complete the ... by choosing the correct words for the blanks", "fill in the blanks with words that best complete the sentence", "words for the blanks", "fill in the blanks with suitable words", "fill in the blanks", "complete the passage", "complete the announcement", "fill in each blank", or if the passage contains multiple blank slots/spaces: THIS IS A MULTI-BLANK CLOZE PASSAGE QUESTION!
  * For cloze passage, you MUST set "detected_type": "cloze_passage".
  * The passage has multiple blanks (e.g. 1st blank, 2nd blank, 3rd blank, 4th blank, 5th blank).
  * You MUST provide the suitable matching word from the available word choices for EVERY blank in exact sequential order from first blank to last blank.
  * Return the complete ordered list of words in "ordered_fill_blanks" (e.g. ["arrivals", "departures", "security", "board", "gate"]). If there are 5 blanks, "ordered_fill_blanks" MUST contain exactly 5 words!
  * Return the complete reconstructed passage with all blanks filled in "reconstructed_passage".
  * CRITICAL: DO NOT classify multiple-blank questions as single-option MCQ! All blanks must be solved! NEVER return a single generic word like "Option".
- If Question Category is 'rearrange_sentence' OR if the question asks to 'rearrange the phrases', 'rearrange the words', 'arrange the following sentences', or 'arrange sentences in the correct sequence' to form a logical story/sentence where clickable chips/tokens are provided on screen: THIS IS A REARRANGE SENTENCE QUESTION!
  * CRITICAL FOR REARRANGEMENT QUESTIONS:
    - The tokens on screen are in SCRAMBLED or ARBITRARY order.
    - You MUST analyze the narrative/chronological timeline or grammatical syntax to determine the true, correct sequence.
    - NEVER simply output the on-screen [0, 1, 2, ...] order! You must provide the genuine rearranged sequence.
    - Format 1 (Large / Full Sentences / Story): Each token is a full sentence describing an event. Determine the chronological sequence (Departure / Morning -> Daytime activities -> Culmination -> Evening campfire -> Reflection / Conclusion).
    - Format 2 (Small Words / Phrases): Each token is a word or short phrase. Arrange them to form a single, grammatically correct English sentence from left to right.
    - Format 3 (Clauses with Conjunctions): Analyze coordinating conjunctions ('so', 'but', 'for', 'as', 'because', 'although'). Start with the capital letter clause, sequence the causes/contrasts/consequences, end with the period.
  * For rearrange sentence, you MUST:
    1) Set "detected_type": "rearrange_sentence".
    2) Specify the 0-based index sequence in "reordered_token_indices" representing the permutation to click (e.g. [3, 1, 4, 0, 2] or [4, 3, 2, 0, 5, 1, 6]).
    3) List each phrase/sentence in this exact sequence in "reordered_token_texts".
    4) Return the full properly ordered narrative or sentence in "reconstructed_sentence".
- If 'Extracted Options' is not empty and NOT cloze/rearrange, OR if the question asks to "fill in the blank", "fill in the blank with the best answer", "fill in the blank with the correct option", "select the best answer", "select the suitable word", "choose the correct", or fill a single blank with options (e.g. "The Taj Mahal encompasses ________ hectares", or reported speech fill-in with chips [could, can, should, must]): THIS IS AN MCQ QUESTION!
  * For any question with choices or option chips to select from for a single blank or question, you MUST set "detected_type": "mcq" and specify the exact single correct option text in "mcq_answers" (e.g. ["could"]) and its 0-based index in "mcq_indices" (e.g. [0]).
  * DO NOT classify single fill-in-the-blank questions as sentence rearrangement!
  * NEVER return generic labels like "Option" in "mcq_answers" — return the exact option text.
- NEVER classify a question as "speaking" if there are selectable options, sentences to arrange, or multiple choices on screen! Speaking is ONLY for oral voice recording tasks that have an active microphone button.
- If the question is about paragraph ordering (S1..S6, A..D) with options like ADCB, DABC, CADB, BCDA, analyze the logical cohesion and pick the correct option.

TASK RULES BY QUESTION TYPE:
1. MCQ (Multiple Choice):
   - Identify the single or multiple correct answers.
   - Return both the exact text of the correct option(s) and their 0-based indices in "mcq_answers" and "mcq_indices".

2. CHOOSE THE CORRECT WORD:
   - If dropdowns are present, specify the exact option value/text to select in "dropdown_selections".
   - If fill-in blanks are present, specify the exact word(s) in "text_blanks".

3. REARRANGE THE SENTENCE / STORY:
   - Determine the correct chronological or syntactic sequence:
     * For Stories / Large Sentences: Chronological progression of events from start to finish.
     * For Sentences / Clauses:
       - Starting Clause begins with a capital letter establishing the subject/situation.
       - Conjunctions: 'for' introduces reasons ('because'), 'so' introduces consequences, 'but' introduces contrasts, 'as' introduces simultaneous causes.
       - Ending Clause concludes thought with a period.
   - REASONING SEQUENCE:
     1) "clause_flow_analysis": Explain the chronological timeline or grammatical structure.
     2) "reconstructed_sentence": Write out the complete, grammatically flawless, natural sentence or story.
     3) "reordered_token_texts": List the exact phrase/sentence tokens in the exact order they should be clicked.
     4) "reordered_token_indices": An array of 0-based integers representing the permutation of original token indices in the new order (e.g. [3, 1, 4, 0, 2]). Index 0 corresponds to token index 0. The first item in this array MUST be the index of the token to click first! DO NOT return [0, 1, 2, 3, ...] in the on-screen order!

4. CLOZE / MULTI-BLANK PASSAGE:
   - Carefully analyze the passage context, blank positions, and discourse markers.
   - Match each blank slot in sequential order (Blank 1 -> Blank 2 -> Blank 3) to the best option from the choices.
   - Return the ordered array of chosen words in "ordered_fill_blanks": ["WordForBlank1", "WordForBlank2", "WordForBlank3"].
   - Return the fully filled passage in "reconstructed_passage".

5. WRITING QUESTION:
   - Write a high-quality, articulate, grammatically flawless response in "writing_answer". Respect any word count or prompt criteria.

6. SPEAKING QUESTION:
   - Only for questions where the user must speak into a microphone.
   - Provide a natural, fluent spoken script in "speaking_script".
   - If the speaking question includes any dropdown to pick first, provide the correct choice in "dropdown_selections".

RESPONSE FORMAT:
You MUST reply ONLY with a single valid RFC 8259 JSON object without markdown code blocks, backticks, or comments.
CRITICAL: All keys and strings MUST be enclosed in standard double quotes (""). Do NOT include unused or empty fields for other question types.

Return ONLY the fields relevant to the question:
- If Cloze Passage (Fill in multiple blanks in passage):
  {"detected_type": "cloze_passage", "ordered_fill_blanks": ["WordForBlank1", "WordForBlank2", "WordForBlank3"], "reconstructed_passage": "Complete passage with all blanks filled in.", "explanation": "Brief explanation of logical transitions"}
- If MCQ:
  {"detected_type": "mcq", "mcq_answers": ["exact option text"], "mcq_indices": [0], "explanation": "Short 1-sentence reason."}
- If Sentence Rearrangement:
  {"detected_type": "rearrange_sentence", "clause_flow_analysis": "Narrative or syntactic progression", "reconstructed_sentence": "Full properly ordered sentence or story ending with period.", "reordered_token_texts": ["Token to click 1st", "Token to click 2nd", "Token to click 3rd"], "reordered_token_indices": [2, 0, 3, 1], "explanation": "Grammatical or chronological reasoning"}
- If Choose the Correct Word:
  {"detected_type": "choose_word", "dropdown_selections": [{"dropdown_index": 0, "selected_text": "chosen text"}]}
- If Writing:
  {"detected_type": "writing", "writing_answer": "Complete articulate essay response."}
- If Speaking:
  {"detected_type": "speaking", "speaking_script": "Natural spoken text for reading aloud."}
`;
}

// Call Google Generative Language API
async function callGeminiAPI(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: "application/json"
      // Unlimited output tokens: no artificial token cap
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    let errorMsg = `Gemini API error (Status ${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.error?.message) {
        errorMsg = errorJson.error.message;
      }
    } catch (_) {}

    // Clear and helpful error message for rate-limiting
    if (response.status === 429 || errorMsg.toLowerCase().includes("quota") || errorMsg.toLowerCase().includes("rate limit") || errorMsg.toLowerCase().includes("exhausted")) {
      errorMsg = "Gemini API Limit Exhausted (HTTP 429): Your API key quota or per-minute rate limit was exceeded. Please wait 60 seconds or use a newly generated API key from Google AI Studio.";
    }

    // Auto-recover if model is not available or unsupported: detect available models and retry with alternative
    const isModelUnavailable = errorMsg.includes("is no longer available") ||
      errorMsg.includes("not found") ||
      errorMsg.includes("not supported") ||
      errorMsg.includes("unsupported") ||
      response.status === 404 ||
      (response.status === 400 && (errorMsg.includes("models/") || errorMsg.includes("model")));

    if (isModelUnavailable) {
      console.warn(`[Gemini Solver] Model "${model}" is unavailable (${errorMsg}). Auto-detecting alternative working model from API key...`);
      try {
        const detection = await autoDetectBestModel(apiKey);
        const candidates = detection.sortedModels || detection.models;
        const alternative = candidates.find(m => m.id !== model)?.id || "gemini-2.0-flash";
        if (alternative && alternative !== model) {
          console.log(`[Gemini Solver] Auto-switching from "${model}" to alternative model "${alternative}"...`);
          await chrome.storage.local.set({ geminiModel: alternative });
          return callGeminiAPI(apiKey, alternative, prompt);
        }
      } catch (autoErr) {
        console.error("Auto-detect failed:", autoErr);
      }
    }

    const err = new Error(errorMsg);
    err.code = response.status === 400 ? "BAD_REQUEST" : response.status === 429 ? "RATE_LIMITED" : response.status === 403 ? "FORBIDDEN" : "API_ERROR";
    throw err;
  }

  const result = await response.json();
  const textOutput = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textOutput) {
    console.warn("[Gemini Solver] Empty response candidate received.");
    throw new Error("Gemini returned an empty response or candidate was blocked.");
  }

  console.log("[Gemini Live Response Text]:", textOutput);
  return robustJSONParse(textOutput);
}

// Resilient, multi-stage JSON parser for Gemini responses with truncation recovery
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

  // 6. Truncation Recovery: If response was cut off mid-flight, balance quotes & braces
  const salvaged = salvageTruncatedJSON(repaired) || salvageTruncatedJSON(text);
  if (salvaged) {
    try {
      return JSON.parse(salvaged);
    } catch (_) {}
    try {
      const fn = new Function('"use strict"; return (' + salvaged + ');');
      const res = fn();
      if (res && typeof res === "object") return res;
    } catch (_) {}
  }

  throw new Error(`Unable to parse structured response from Gemini: ${rawText.slice(0, 90)}...`);
}

function salvageTruncatedJSON(str) {
  if (!str || typeof str !== "string") return null;
  const firstBrace = str.indexOf("{");
  if (firstBrace === -1) return null;
  let s = str.slice(firstBrace);

  let inString = false;
  let escaped = false;
  let openBrackets = 0;
  let openBraces = 0;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && inString) {
      escaped = !escaped;
      continue;
    }
    if (c === '"' && !escaped) {
      inString = !inString;
    } else if (!inString) {
      if (c === "[") openBrackets++;
      else if (c === "]") openBrackets = Math.max(0, openBrackets - 1);
      else if (c === "{") openBraces++;
      else if (c === "}") openBraces = Math.max(0, openBraces - 1);
    }
    escaped = false;
  }

  if (inString) {
    s += '"';
  }

  // Remove trailing dangling commas or partial key names
  s = s.replace(/,\s*$/g, "");
  s = s.replace(/,\s*"[^"]*"\s*$/g, "");
  s = s.replace(/,\s*"[^"]*"\s*:\s*$/g, "");

  while (openBrackets > 0) {
    s += "]";
    openBrackets--;
  }
  while (openBraces > 0) {
    s += "}";
    openBraces--;
  }

  return s;
}

// Test API Key and automatically select the best active working model
async function testApiKey(apiKey, requestedModel = "auto") {
  if (!apiKey) throw new Error("API key cannot be empty.");

  // 1. Auto-detect available models for this specific API key
  const detection = await autoDetectBestModel(apiKey);
  const candidates = detection.sortedModels || detection.models;

  let verifiedModel = null;
  let lastError = null;

  // 2. Perform a lightweight ping test to verify text generation works, trying candidates in priority order
  for (const candidate of candidates) {
    const candidateId = candidate.id;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [
        {
          parts: [{ text: "Respond only with OK." }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 5,
        temperature: 0.0
      }
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        let errorMsg = `Ping test failed (${response.status})`;
        try {
          const errorJson = await response.json();
          if (errorJson.error?.message) errorMsg = errorJson.error.message;
        } catch (_) {}
        console.warn(`[Gemini Solver] Candidate model "${candidateId}" rejected: ${errorMsg}. Trying next candidate...`);
        lastError = new Error(errorMsg);
        continue; // Try next candidate model
      }

      verifiedModel = candidate;
      break; // Found a working model!
    } catch (netErr) {
      console.warn(`[Gemini Solver] Network ping error for "${candidateId}": ${netErr.message}`);
      lastError = netErr;
    }
  }

  if (!verifiedModel) {
    throw new Error(lastError?.message || "Could not verify any active text generation model with this API key.");
  }

  const targetModel = verifiedModel.id;

  // Save in cache
  keyModelCache.set(apiKey, { model: targetModel, time: Date.now() });

  // Save successful state
  await chrome.storage.local.set({
    geminiApiKey: apiKey,
    geminiModel: targetModel,
    availableModels: detection.models
  });

  return {
    message: `Connected successfully! Auto-selected: ${targetModel}`,
    detectedModel: targetModel,
    detectedModelName: verifiedModel.displayName || targetModel,
    availableModels: detection.models
  };
}

// Lightweight test to check if an API key is active or if its rate limit/quota has restored
async function pingCheckKey(apiKey, currentModel) {
  if (!apiKey || typeof apiKey !== "string") {
    return { ok: false, status: "invalid", error: "Missing API Key" };
  }

  const trimmedKey = apiKey.trim();
  if (trimmedKey === BURNT_KEY) {
    return { ok: false, status: "invalid", error: "Burnt or revoked API key" };
  }

  // Priority candidate models to test
  const candidateModels = [];
  if (currentModel && currentModel !== "Auto-Selected" && currentModel !== "auto") {
    candidateModels.push(currentModel);
  }
  candidateModels.push("gemini-3.1-flash-lite-preview", "gemini-2.0-flash", "gemini-1.5-flash");
  const uniqueCandidates = [...new Set(candidateModels)];

  let isRateLimited = false;
  let isInvalid = false;
  let lastError = null;

  for (const modelId of uniqueCandidates) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(trimmedKey)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "OK" }] }],
          generationConfig: { maxOutputTokens: 2, temperature: 0.0 }
        })
      });

      if (response.ok) {
        return { ok: true, status: "ready", model: modelId };
      }

      let errorMsg = `HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson.error?.message) errorMsg = errJson.error.message;
      } catch (_) {}

      const errLower = errorMsg.toLowerCase();
      if (response.status === 429 || errLower.includes("quota") || errLower.includes("rate limit") || errLower.includes("resource_exhausted") || errLower.includes("exhausted")) {
        isRateLimited = true;
        lastError = "Rate limit / quota exceeded (HTTP 429)";
        break; // Key is rate-limited across models
      } else if (response.status === 400 || response.status === 403 || errLower.includes("api_key_invalid") || errLower.includes("not valid") || errLower.includes("forbidden")) {
        isInvalid = true;
        lastError = errorMsg || "Invalid or unauthorized API key";
        break;
      } else if (response.status === 404 || errLower.includes("not found")) {
        // Model not found or deprecated for this key, try next candidate
        continue;
      } else {
        lastError = errorMsg;
      }
    } catch (netErr) {
      lastError = netErr.message;
    }
  }

  // If candidate loop did not succeed and wasn't a confirmed 429 or 400/403, fallback to autoDetectBestModel
  if (!isRateLimited && !isInvalid) {
    try {
      const detection = await autoDetectBestModel(trimmedKey);
      if (detection.bestModel) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(detection.bestModel)}:generateContent?key=${encodeURIComponent(trimmedKey)}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "OK" }] }],
            generationConfig: { maxOutputTokens: 2, temperature: 0.0 }
          })
        });

        if (response.ok) {
          return { ok: true, status: "ready", model: detection.bestModel };
        }

        let errorMsg = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson.error?.message) errorMsg = errJson.error.message;
        } catch (_) {}

        const errLower = errorMsg.toLowerCase();
        if (response.status === 429 || errLower.includes("quota") || errLower.includes("rate limit") || errLower.includes("exhausted")) {
          return { ok: false, status: "exhausted", error: "Rate limit / quota exceeded (HTTP 429)" };
        }
        if (response.status === 400 || response.status === 403) {
          return { ok: false, status: "invalid", error: errorMsg };
        }
      }
    } catch (detectErr) {
      const detectErrLower = detectErr.message.toLowerCase();
      if (detectErrLower.includes("quota") || detectErrLower.includes("429")) {
        return { ok: false, status: "exhausted", error: detectErr.message };
      }
      if (detectErrLower.includes("invalid") || detectErrLower.includes("not valid") || detectErrLower.includes("400") || detectErrLower.includes("403")) {
        return { ok: false, status: "invalid", error: detectErr.message };
      }
    }
  }

  if (isRateLimited) {
    return { ok: false, status: "exhausted", error: lastError };
  }
  if (isInvalid) {
    return { ok: false, status: "invalid", error: lastError };
  }
  return { ok: false, status: "exhausted", error: lastError || "Ping verification failed" };
}

// Refresh and verify limits for all API keys in the pool
async function handleRefreshAllKeys() {
  const settings = await chrome.storage.local.get([
    "geminiApiKeys",
    "activeKeyIndex",
    "geminiApiKey",
    "geminiModel"
  ]);

  let keys = Array.isArray(settings.geminiApiKeys) ? [...settings.geminiApiKeys] : [];
  let activeIndex = typeof settings.activeKeyIndex === "number" ? settings.activeKeyIndex : 0;

  // Filter out burned / empty keys
  keys = keys.filter(k => {
    const kStr = typeof k === "string" ? k : k?.key;
    return kStr && typeof kStr === "string" && kStr.trim() !== BURNT_KEY;
  });

  // Migrate legacy key if needed
  if (keys.length === 0 && settings.geminiApiKey && typeof settings.geminiApiKey === "string" && settings.geminiApiKey.trim() !== BURNT_KEY) {
    keys.push({
      key: settings.geminiApiKey.trim(),
      model: settings.geminiModel || "Auto-Selected",
      status: "active",
      addedAt: Date.now()
    });
    activeIndex = 0;
  }

  if (keys.length === 0) {
    throw new Error("No API keys found in pool to refresh. Please add an API key first.");
  }

  // Normalize key objects
  keys = keys.map((k, idx) => {
    if (typeof k === "string") {
      return { key: k, model: "Auto-Selected", status: (idx === activeIndex ? "active" : "standby"), addedAt: Date.now() };
    }
    return { ...k };
  });

  if (activeIndex >= keys.length) {
    activeIndex = 0;
  }

  let restoredCount = 0;
  let readyCount = 0;
  let exhaustedCount = 0;
  let invalidCount = 0;

  // Test all keys in pool concurrently
  const checkResults = await Promise.all(
    keys.map(async (keyObj, idx) => {
      const apiKey = keyObj.key.trim();
      const prevStatus = keyObj.status;
      const res = await pingCheckKey(apiKey, keyObj.model);
      return { idx, prevStatus, res };
    })
  );

  // Apply outcomes
  checkResults.forEach(({ idx, prevStatus, res }) => {
    const keyObj = keys[idx];
    keyObj.lastChecked = Date.now();

    if (res.ok) {
      if (res.model) keyObj.model = res.model;
      if (prevStatus === "exhausted" || prevStatus === "invalid") {
        restoredCount++;
      }
      keyObj.status = "ready"; // temporary marker for active/standby assignment
      delete keyObj.lastError;
      readyCount++;
    } else {
      if (res.status === "invalid") {
        keyObj.status = "invalid";
        invalidCount++;
      } else {
        keyObj.status = "exhausted";
        exhaustedCount++;
      }
      keyObj.lastError = res.error;
    }
  });

  // If current active key is not ready, auto-promote the first ready key
  if (keys[activeIndex]?.status !== "ready") {
    const firstReadyIdx = keys.findIndex(k => k.status === "ready");
    if (firstReadyIdx !== -1) {
      activeIndex = firstReadyIdx;
    }
  }

  // Finalize statuses to active or standby
  keys.forEach((k, idx) => {
    if (k.status === "ready") {
      k.status = (idx === activeIndex) ? "active" : "standby";
    }
  });

  // Save to storage
  await chrome.storage.local.set({
    geminiApiKeys: keys,
    activeKeyIndex: activeIndex,
    geminiApiKey: keys[activeIndex] ? keys[activeIndex].key : "",
    geminiModel: keys[activeIndex] ? keys[activeIndex].model : ""
  });

  console.log(`[Gemini Solver] Keys limits refreshed: ${readyCount} ready, ${restoredCount} restored, ${exhaustedCount} exhausted, ${invalidCount} invalid.`);

  return {
    keys,
    activeKeyIndex: activeIndex,
    stats: {
      total: keys.length,
      restored: restoredCount,
      ready: readyCount,
      exhausted: exhaustedCount,
      invalid: invalidCount
    }
  };
}

// Refresh and verify limits for a single key at specified index
async function handleRefreshSingleKey(keyIndex) {
  const settings = await chrome.storage.local.get([
    "geminiApiKeys",
    "activeKeyIndex",
    "geminiApiKey",
    "geminiModel"
  ]);

  let keys = Array.isArray(settings.geminiApiKeys) ? [...settings.geminiApiKeys] : [];
  let activeIndex = typeof settings.activeKeyIndex === "number" ? settings.activeKeyIndex : 0;

  if (keyIndex < 0 || keyIndex >= keys.length) {
    throw new Error("Invalid API key index.");
  }

  const keyObj = typeof keys[keyIndex] === "string" 
    ? { key: keys[keyIndex], model: "Auto-Selected", status: "standby", addedAt: Date.now() }
    : { ...keys[keyIndex] };
  keys[keyIndex] = keyObj;

  const prevStatus = keyObj.status;
  const apiKey = (keyObj.key || "").trim();
  const res = await pingCheckKey(apiKey, keyObj.model);
  let wasRestored = false;

  keyObj.lastChecked = Date.now();

  if (res.ok) {
    if (res.model) keyObj.model = res.model;
    if (prevStatus === "exhausted" || prevStatus === "invalid") {
      wasRestored = true;
    }
    keyObj.status = (keyIndex === activeIndex) ? "active" : "standby";
    delete keyObj.lastError;

    // If current active key is exhausted/invalid and this key is healthy, promote this key to active
    if (keys[activeIndex]?.status === "exhausted" || keys[activeIndex]?.status === "invalid") {
      activeIndex = keyIndex;
      keyObj.status = "active";
    }
  } else if (res.status === "invalid") {
    keyObj.status = "invalid";
    keyObj.lastError = res.error;
  } else {
    keyObj.status = "exhausted";
    keyObj.lastError = res.error;
  }

  await chrome.storage.local.set({
    geminiApiKeys: keys,
    activeKeyIndex: activeIndex,
    geminiApiKey: keys[activeIndex] ? keys[activeIndex].key : "",
    geminiModel: keys[activeIndex] ? keys[activeIndex].model : ""
  });

  return {
    keys,
    activeKeyIndex: activeIndex,
    keyIndex,
    wasRestored,
    status: keyObj.status,
    model: keyObj.model,
    error: res.error
  };
}

// -------------------------------------------------------------
// Free Trial (30 Min) & Lifetime Subscription Manager
// -------------------------------------------------------------
async function getSubscriptionStatus() {
  const data = await chrome.storage.local.get([
    "isLifetimeActive",
    "trialStartedAt",
    "licenseKey",
    "lifetimeActivatedAt",
    "userProfile"
  ]);

  // If user profile from Supabase indicates paid
  if (data.userProfile && data.userProfile.payment_status === "paid") {
    if (!data.isLifetimeActive) {
      await chrome.storage.local.set({ isLifetimeActive: true, paidViaRazorpay: true });
    }
    return {
      status: "LIFETIME_ACTIVE",
      isLifetime: true,
      isTrialExpired: false,
      remainingMs: Infinity,
      remainingMinutes: Infinity,
      remainingSeconds: Infinity,
      purchaseUrl: LIFETIME_PURCHASE_URL
    };
  }

  // If user profile from Supabase explicitly indicates NOT paid
  if (data.userProfile && data.userProfile.payment_status !== "paid") {
    const hasValidKey = data.licenseKey && validateLicenseKey(data.licenseKey);
    if (!hasValidKey) {
      if (data.isLifetimeActive) {
        await chrome.storage.local.set({ isLifetimeActive: false, paidViaRazorpay: false });
        data.isLifetimeActive = false;
      }
    }
  }

  if (data.isLifetimeActive === true) {
    return {
      status: "LIFETIME_ACTIVE",
      isLifetime: true,
      isTrialExpired: false,
      remainingMs: Infinity,
      remainingMinutes: Infinity,
      remainingSeconds: Infinity,
      purchaseUrl: LIFETIME_PURCHASE_URL
    };
  }

  const now = Date.now();
  let trialStartedAt = data.trialStartedAt;

  // If server profile has trial_started_at, prioritize server timestamp
  if (data.userProfile && data.userProfile.trial_started_at) {
    const serverMs = new Date(data.userProfile.trial_started_at).getTime();
    if (!isNaN(serverMs)) {
      trialStartedAt = serverMs;
    }
  }

  // Initialize trial timestamp on first query if not present
  if (!trialStartedAt || typeof trialStartedAt !== "number") {
    trialStartedAt = now;
    await chrome.storage.local.set({ trialStartedAt });
  }

  const elapsedMs = now - trialStartedAt;
  const remainingMs = Math.max(0, TRIAL_DURATION_MS - elapsedMs);
  const remainingMinutes = Math.ceil(remainingMs / 60000);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const isTrialExpired = remainingMs <= 0;

  return {
    status: isTrialExpired ? "TRIAL_EXPIRED" : "TRIAL_ACTIVE",
    isLifetime: false,
    isTrialExpired,
    trialStartedAt,
    elapsedMs,
    remainingMs,
    remainingMinutes,
    remainingSeconds,
    purchaseUrl: LIFETIME_PURCHASE_URL
  };
}

function validateLicenseKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return false;
  const key = rawKey.trim().toUpperCase().replace(/\s+/g, "");

  // 1. Direct VIP / Master Keys
  const masterKeys = [
    "STEP-LIFETIME-VIP",
    "STEP-PRO-2026",
    "VIGNESH-VIP-ACCESS",
    "STEP-SOLVER-PRO",
    "STEP-LIFE-UNLIMITED"
  ];
  if (masterKeys.includes(key)) return true;

  // 2. Pattern A: STEP-LIFE-[alphanumeric 4-16 chars] (e.g. STEP-LIFE-USER50, STEP-LIFE-987654)
  if (/^STEP-LIFE-[A-Z0-9]{4,16}$/.test(key)) return true;

  // 3. Pattern B: STEP-[4 chars]-[4 chars]-[4 chars] (e.g. STEP-ABCD-1234-EFGH)
  if (/^STEP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return true;

  return false;
}

async function handleActivateLicenseKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string" || !rawKey.trim()) {
    throw new Error("Please enter an activation key.");
  }

  const normalized = rawKey.trim().toUpperCase();
  const isValid = validateLicenseKey(normalized);

  if (!isValid) {
    throw new Error("Invalid activation key. Please verify your key or purchase lifetime access.");
  }

  await chrome.storage.local.set({
    isLifetimeActive: true,
    licenseKey: normalized,
    lifetimeActivatedAt: Date.now()
  });

  return {
    success: true,
    message: "Lifetime access activated successfully! Unlimited solving unlocked.",
    isLifetime: true
  };
}
