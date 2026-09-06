// background.js - Service Worker for Gemini Live Question Solver

const DEFAULT_MODEL = "gemini-3.6-flash";

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SOLVE_QUESTION") {
    handleSolveQuestion(request.payload)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message, code: err.code }));
    return true; // Keep message channel open for async response
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
  // Prefer newest Flash models (gemini-3.6-flash, gemini-2.0-flash, gemini-1.5-flash) for fast solving with highest RPM
  const priorityPatterns = [
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
  const BURNT_KEY = "AQ.Ab8RN6I1C1o7hEEyqfwMJUFw1TdSg-kRieVIS06703505QTCrQ";
  const settings = await chrome.storage.local.get([
    "geminiApiKeys",
    "activeKeyIndex",
    "geminiApiKey",
    "geminiModel"
  ]);

  let keys = Array.isArray(settings.geminiApiKeys) ? [...settings.geminiApiKeys] : [];
  let activeIndex = typeof settings.activeKeyIndex === "number" ? settings.activeKeyIndex : 0;

  // Filter out burned / invalid key
  keys = keys.filter(k => k && k.key && k.key.trim() !== BURNT_KEY);

  // Migrate legacy single key if present
  if (keys.length === 0 && settings.geminiApiKey && settings.geminiApiKey.trim() !== BURNT_KEY) {
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
    const apiKey = keyObj.key.trim();

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

Writing Criteria / Constraints:
${JSON.stringify(payload.writingConstraints || {}, null, 2)}

CRITICAL CLASSIFICATION & SOLVING RULES:
- If Question Category is 'rearrange_sentence' OR if the question asks to 'rearrange the phrases', 'rearrange the words', 'arrange the following sentences', or 'arrange sentences in the correct sequence' to form a logical story/sentence (e.g. Aarav's trip, sentences/phrases into sequence), THIS IS A REARRANGE SENTENCE QUESTION!
- For rearrange sentence, you MUST set "detected_type": "rearrange_sentence", specify the 0-based token index sequence in "reordered_token_indices", list the words/sentences in "reordered_token_texts", and return the full sentence/narrative in "reconstructed_sentence".
- If 'Extracted Options' is not empty AND it is NOT a rearrange question (such as choices A, B, C, D or combination choices like ADCB, DABC, CADB, BCDA), THIS IS AN MCQ QUESTION!
- For any question with choices to select from, you MUST set "detected_type": "mcq" and specify the exact correct option text in "mcq_answers" and its 0-based index in "mcq_indices".
- NEVER classify a question as "speaking" if there are selectable options, sentences to arrange, or multiple choices on screen! Speaking is ONLY for oral voice recording tasks that have an active microphone button.
- If the question is about paragraph ordering (S1..S6, A..D) with options like ADCB, DABC, CADB, BCDA, analyze the logical cohesion and pick the correct option.

TASK RULES BY QUESTION TYPE:
1. MCQ (Multiple Choice):
   - Identify the single or multiple correct answers.
   - Return both the exact text of the correct option(s) and their 0-based indices in "mcq_answers" and "mcq_indices".

2. CHOOSE THE CORRECT WORD:
   - If dropdowns are present, specify the exact option value/text to select in "dropdown_selections".
   - If fill-in blanks are present, specify the exact word(s) in "text_blanks".

3. REARRANGE THE SENTENCE:
   - Identify the correct grammatical, natural sentence (active voice if requested).
   - Return the 0-based index sequence of the tokens in "reordered_token_indices".
   - Return array of ordered token strings in "reordered_token_texts".
   - Return the reconstructed full sentence string in "reconstructed_sentence".

4. WRITING QUESTION:
   - Write a high-quality, articulate, grammatically flawless response in "writing_answer". Respect any word count or prompt criteria.

5. SPEAKING QUESTION:
   - Only for questions where the user must speak into a microphone.
   - Provide a natural, fluent spoken script in "speaking_script".
   - If the speaking question includes any dropdown to pick first, provide the correct choice in "dropdown_selections".

RESPONSE FORMAT:
You MUST reply ONLY with a single valid RFC 8259 JSON object without markdown code blocks, backticks, or comments.
CRITICAL: All keys and strings MUST be enclosed in standard double quotes (""). Do NOT include unused or empty fields for other question types.

Return ONLY the fields relevant to the question:
- If MCQ:
  {"detected_type": "mcq", "mcq_answers": ["exact option text"], "mcq_indices": [0], "explanation": "Short 1-sentence reason."}
- If Sentence Rearrangement:
  {"detected_type": "rearrange_sentence", "reordered_token_indices": [0, 1, 2], "reconstructed_sentence": "Full properly ordered sentence."}
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

    // Auto-recover if model is not available: detect current models and retry
    if (errorMsg.includes("is no longer available") || response.status === 404) {
      console.warn(`[Gemini Solver] Model "${model}" is unavailable. Auto-detecting available models from API key...`);
      try {
        const detection = await autoDetectBestModel(apiKey);
        if (detection.bestModel && detection.bestModel !== model) {
          await chrome.storage.local.set({ geminiModel: detection.bestModel });
          return callGeminiAPI(apiKey, detection.bestModel, prompt);
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
