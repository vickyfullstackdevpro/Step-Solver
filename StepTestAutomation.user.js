// ==UserScript==
// @name         StepTest Automation
// @namespace    http://localhost
// @version      2.2
// @description  Intelligent StepTest automation powered by Google Gemini AI. Automatically solves MCQs, sentence/phrase rearrangements, writing, and word choices. Persistent answer popup only closes when moved to the next question.
// @match        https://english.steptest.in/*
// @match        https://steptest.in/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    console.log("StepTest Automation (Gemini AI v2.2): Started");

    const BURNT_KEY = "AQ.Ab8RN6I1C1o7hEEyqfwMJUFw1TdSg-kRieVIS06703505QTCrQ";
    const MAX_KEYS = 10;

    // Retrieve all configured API keys (Max 10)
    function getApiKeys() {
        let raw = localStorage.getItem("GEMINI_API_KEYS");
        let keys = [];
        if (raw) {
            try {
                keys = JSON.parse(raw);
            } catch (_) {
                keys = [];
            }
        }

        // Migrate legacy single key if present
        const singleKey = localStorage.getItem("GEMINI_API_KEY");
        if (keys.length === 0 && singleKey && singleKey.trim() !== BURNT_KEY) {
            keys.push({
                key: singleKey.trim(),
                model: localStorage.getItem("GEMINI_WORKING_MODEL") || "gemini-3.1-flash-lite-preview",
                status: "active"
            });
            localStorage.setItem("GEMINI_API_KEYS", JSON.stringify(keys));
        }

        // Clean out burned / invalid keys
        keys = keys.filter(k => k && (typeof k === "string" ? k : k.key) && (typeof k === "string" ? k : k.key).trim() !== BURNT_KEY);
        // Normalize to objects
        keys = keys.map(k => typeof k === "string" ? { key: k.trim(), model: "gemini-3.1-flash-lite-preview", status: "active" } : k);

        if (keys.length > MAX_KEYS) {
            keys = keys.slice(0, MAX_KEYS);
        }

        return keys;
    }

    function saveApiKeys(keys) {
        localStorage.setItem("GEMINI_API_KEYS", JSON.stringify(keys.slice(0, MAX_KEYS)));
    }

    function getActiveKeyIndex(keysLength) {
        if (!keysLength) return 0;
        let idx = parseInt(localStorage.getItem("GEMINI_ACTIVE_KEY_INDEX") || "0", 10);
        if (isNaN(idx) || idx < 0 || idx >= keysLength) idx = 0;
        return idx;
    }

    function setActiveKeyIndex(idx) {
        localStorage.setItem("GEMINI_ACTIVE_KEY_INDEX", idx.toString());
    }

    // Console management helpers
    window.addGeminiKey = async function(key) {
        if (!key || !key.trim()) {
            console.error("[Gemini AI] Please pass a valid key: addGeminiKey('AIzaSy...')");
            return;
        }
        key = key.trim();
        if (key === BURNT_KEY) {
            console.error("[Gemini AI] That key is expired/invalid. Please generate a new key from Google AI Studio.");
            return;
        }
        let keys = getApiKeys();
        if (keys.length >= MAX_KEYS) {
            console.error(`[Gemini AI] Maximum limit reached (${MAX_KEYS} keys). Remove an existing key first using removeGeminiKey(index).`);
            return;
        }
        if (keys.some(k => k.key === key)) {
            console.warn("[Gemini AI] This key is already present in your pool.");
            return;
        }

        console.log("[Gemini AI] Auto-detecting optimal model for new key...");
        const detected = await getBestModel(key);
        keys.push({ key: key, model: detected, status: keys.length === 0 ? "active" : "standby" });
        saveApiKeys(keys);
        console.log(`%c[Gemini AI]%c Added Key #${keys.length} (${key.slice(0, 8)}...${key.slice(-4)}) with model: ${detected}. Total keys: ${keys.length}/${MAX_KEYS}`, "color:#10b981;font-weight:bold", "color:#fff");
    };

    window.listGeminiKeys = function() {
        const keys = getApiKeys();
        const activeIdx = getActiveKeyIndex(keys.length);
        console.log(`%c[Gemini AI API Key Pool: ${keys.length}/${MAX_KEYS}]%c`, "color:#38bdf8;font-weight:bold", "");
        if (keys.length === 0) {
            console.log("No keys configured. Run: addGeminiKey('AIzaSy...')");
            return;
        }
        const tableData = keys.map((k, i) => ({
            "#": i + 1,
            "Key": `${k.key.slice(0, 8)}...${k.key.slice(-4)}`,
            "Model": k.model || "gemini-3.1-flash-lite-preview",
            "Active": i === activeIdx ? ">>> ACTIVE <<<" : "Standby",
            "Status": k.status || "ready"
        }));
        console.table(tableData);
    };

    window.removeGeminiKey = function(index) {
        let keys = getApiKeys();
        const num = parseInt(index, 10);
        const zeroIndex = num > 0 ? num - 1 : num;
        if (isNaN(zeroIndex) || zeroIndex < 0 || zeroIndex >= keys.length) {
            console.error(`[Gemini AI] Invalid key index. Use 1 to ${keys.length}.`);
            return;
        }
        const removed = keys.splice(zeroIndex, 1)[0];
        saveApiKeys(keys);
        setActiveKeyIndex(0);
        console.log(`%c[Gemini AI]%c Removed key #${zeroIndex + 1}. Remaining keys: ${keys.length}`, "color:#f87171;font-weight:bold", "color:#fff");
    };

    window.clearGeminiKeys = function() {
        localStorage.removeItem("GEMINI_API_KEYS");
        localStorage.removeItem("GEMINI_API_KEY");
        localStorage.removeItem("GEMINI_ACTIVE_KEY_INDEX");
        localStorage.removeItem("GEMINI_WORKING_MODEL");
        console.log("%c[Gemini AI]%c All API keys cleared.", "color:#ef4444;font-weight:bold", "color:#fff");
    };

    // Backward compatibility
    window.setGeminiKey = function(key) {
        window.addGeminiKey(key);
    };
    window.clearGeminiKey = function() {
        window.clearGeminiKeys();
    };

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const randomWait = (min = 2500, max = 4500) => wait(Math.floor(Math.random() * (max - min)) + min);

    let lastAnsweredQuestion = "";
    let isProcessing = false;

    // Automatically detect the best available model for a key
    async function getBestModel(apiKey) {
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
            if (res.ok) {
                const data = await res.json();
                const available = (data.models || [])
                    .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
                    .map(m => m.name.replace(/^models\//, ""))
                    .filter(id => !/2\.5-flash/i.test(id));

                const preferenceList = [
                    "gemini-3.1-flash-lite-preview",
                    "gemini-3.1-flash-lite",
                    "gemini-3.6-flash",
                    "gemini-2.0-flash",
                    "gemini-1.5-flash",
                    "gemini-flash",
                    "gemini-2.0",
                    "gemini-1.5-pro",
                    "gemini-pro"
                ];

                for (const pref of preferenceList) {
                    const match = available.find(m => m === pref || m.includes(pref));
                    if (match) {
                        return match;
                    }
                }

                if (available.length > 0) {
                    return available[0];
                }
            }
        } catch (e) {
            console.warn("[Gemini AI] Model detection fallback:", e.message);
        }

        return "gemini-3.1-flash-lite-preview";
    }

    // -------------------------------------------------------------
    // Answer Banner Display (Persists until moved to next question)
    // -------------------------------------------------------------
    // -------------------------------------------------------------
    // Answer Banner Display (Persists until moved to next question & Movable)
    // -------------------------------------------------------------
    function makeDraggable(el, handle) {
        if (!el || !handle || el.__isDraggableAttached__) return;
        el.__isDraggableAttached__ = true;
        let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
        handle.style.cursor = "grab";
        handle.style.userSelect = "none";

        handle.addEventListener("mousedown", (e) => {
            if (e.target.closest("button") || e.target.closest("input")) return;
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            startX = e.clientX;
            startY = e.clientY;

            el.style.transition = "none";
            el.style.transform = "none";
            el.style.left = `${initialLeft}px`;
            el.style.top = `${initialTop}px`;
            handle.style.cursor = "grabbing";

            function onMouseMove(me) {
                me.preventDefault();
                const newLeft = Math.max(10, Math.min(window.innerWidth - el.offsetWidth - 10, initialLeft + (me.clientX - startX)));
                const newTop = Math.max(10, Math.min(window.innerHeight - el.offsetHeight - 10, initialTop + (me.clientY - startY)));
                el.style.left = `${newLeft}px`;
                el.style.top = `${newTop}px`;
            }

            function onMouseUp() {
                handle.style.cursor = "grab";
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            }

            document.addEventListener("mousemove", onMouseMove, { passive: false });
            document.addEventListener("mouseup", onMouseUp);
        });
    }

    function showAnswerBanner(mainText, subText = "", typeTitle = "Gemini Solution") {
        let banner = document.getElementById("steptest-ai-banner");
        if (!banner) {
            banner = document.createElement("div");
            banner.id = "steptest-ai-banner";
            banner.style.cssText = `
                position: fixed;
                top: 18px;
                left: 50%;
                transform: translateX(-50%);
                width: min(600px, 92vw);
                background: rgba(15, 23, 42, 0.97);
                backdrop-filter: blur(20px);
                border: 2px solid #10b981;
                border-radius: 16px;
                box-shadow: 0 16px 40px rgba(0,0,0,0.75), 0 0 24px rgba(16,185,129,0.3);
                color: #f8fafc;
                padding: 14px 18px;
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                display: flex;
                flex-direction: column;
                gap: 8px;
                transition: opacity 0.25s ease;
            `;
            document.body.appendChild(banner);
        }

        let displayMain = (mainText || "").trim();
        let displaySub = (subText || "").trim();

        // If mainText is a generic placeholder like "Option" or "MCQ", promote genuine subText
        if (/^(option|options|mcq|mcq answer|answer pending|answer|unknown)$/i.test(displayMain)) {
            if (displaySub && displaySub.length > 0) {
                displayMain = displaySub;
                displaySub = "";
            }
        }

        banner.innerHTML = `
            <div id="steptest-banner-header" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(16,185,129,0.25); padding-bottom: 8px; cursor: grab; user-select: none;">
                <span style="font-size: 11.5px; font-weight: 700; color: #34d399; text-transform: uppercase; letter-spacing: 0.8px;">🎯 ${typeTitle}</span>
                <button id="steptest-btn-close-banner" style="background: none; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 0 4px;">✕</button>
            </div>
            <div style="font-size: 22px; font-weight: 800; color: #ffffff; line-height: 1.35; word-break: break-word; text-shadow: 0 2px 8px rgba(0,0,0,0.6);">
                ${displayMain}
            </div>
            ${displaySub ? `<div style="font-size: 15px; color: #e2e8f0; line-height: 1.5; word-break: break-word;">${displaySub}</div>` : ''}
        `;

        banner.style.display = "flex";

        const header = document.getElementById("steptest-banner-header");
        if (header) makeDraggable(banner, header);

        const closeBtn = document.getElementById("steptest-btn-close-banner");
        if (closeBtn) closeBtn.onclick = hideAnswerBanner;
    }

    function hideAnswerBanner() {
        const banner = document.getElementById("steptest-ai-banner");
        if (banner) banner.style.display = "none";
    }

    function safeText(el) {
        if (!el) return "";
        return (el.innerText || el.textContent || el.value || "").trim();
    }

    // Dismiss answer banner when moving to the next question
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("button, a, input[type='button'], input[type='submit']");
        if (btn && !btn.closest("#steptest-ai-banner")) {
            const txt = safeText(btn).toLowerCase();
            if (txt.includes("next") || txt.includes("submit") || txt.includes("continue") || txt === "save & next") {
                setTimeout(hideAnswerBanner, 600);
            }
        }
    }, true);

    // Call Google Gemini API with automatic key failover (Max 10 keys)
    async function askGemini(questionText, options = [], context = "", taskType = "mcq") {
        let keys = getApiKeys();
        if (keys.length === 0) {
            console.warn("[Gemini AI] No API key configured. Run addGeminiKey('YOUR_KEY') in the DevTools console.");
            showAnswerBanner("API Key Required", "Open Browser Console (F12) and run: addGeminiKey('AIzaSy...')", "Configuration");
            return null;
        }

        let prompt = "";

        if (taskType === "cloze_passage") {
            prompt = `You are an expert English proficiency exam solver. Solve this passage completion / fill-in-the-blanks question with 100% accuracy.

QUESTION / PROMPT:
"""
${questionText}
"""

FULL PASSAGE / CONTEXT:
"""
${context || "None"}
"""

AVAILABLE WORD CHOICES:
${JSON.stringify(options, null, 2)}

TASK:
- The passage contains multiple blanks in logical sequence (e.g. Blank 1, Blank 2, Blank 3...).
- Carefully determine which word choice belongs in Blank 1, which in Blank 2, which in Blank 3, etc.
- Return the ordered array of words in "ordered_fill_blanks" (e.g. ["Initially", "However", "Finally"]).
- Return the complete reconstructed passage with all blanks filled in "reconstructed_passage".

RESPONSE FORMAT:
Return ONLY a valid JSON object without markdown fences:
{
  "ordered_fill_blanks": ["WordForBlank1", "WordForBlank2", "WordForBlank3"],
  "reconstructed_passage": "Complete passage with words inserted in logical order.",
  "explanation": "Brief reasoning"
}`;
        } else if (taskType === "rearrange_sentence") {
            prompt = `You are an expert English proficiency exam solver. Solve this sentence/phrase rearrangement question with 100% accuracy.

QUESTION / PROMPT:
"""
${questionText}
"""

WORDS / PHRASES TO REARRANGE:
${JSON.stringify(options, null, 2)}

TASK & CHRONOLOGICAL / GRAMMATICAL RULES:
- Determine the true, correct sequence:
  * For Story / Large Sentences (e.g. Aarav's Gokarna trek, vacations):
    - Identify the chronological narrative arc: Departure/Morning -> Daytime activities -> Culmination of trek -> Evening campfire -> Reflection/Conclusion.
    - In "reordered_token_indices", list the 0-based token indices in this chronological order (e.g. [3, 1, 4, 0, 2]).
    - In "reordered_token_texts", list each sentence in this exact chronological order.
    - In "reconstructed_sentence", combine all sentences in this exact chronological order.
    - NEVER simply output [0, 1, 2, 3, ...] in the on-screen order!
  * For Small Words / Phrases:
    - Assemble the words into a single grammatically correct English sentence.
    - In "reordered_token_indices", provide the exact sequence of indices to click from left to right (e.g. [4, 3, 2, 0, 5, 1, 6]).
    - In "reordered_token_texts", list the words in this order.
    - In "reconstructed_sentence", provide the full sentence.

RESPONSE FORMAT:
Return ONLY a valid JSON object without markdown fences:
{
  "clause_flow_analysis": "Chronological or grammatical progression",
  "reconstructed_sentence": "Full properly ordered sentence or story ending with period.",
  "reordered_token_texts": ["Token to click 1st", "Token to click 2nd", "Token to click 3rd"],
  "reordered_token_indices": [2, 0, 3, 1]
}`;
        } else if (taskType === "mcq" || (options && options.length > 0)) {
            prompt = `You are an expert English exam solver for The Hindu STEP test. Solve this question with 100% accuracy.

QUESTION / PROMPT:
"""
${questionText}
"""

FULL PASSAGE / CONTEXT:
"""
${context || "None"}
"""

OPTIONS:
${JSON.stringify(options, null, 2)}

TASK:
- If this is sentence rearrangement (e.g. S1..S6 with options like ADCB, DABC, CADB, BCDA), trace sentence connections and choose the exact option.
- If this is a multiple choice or vocabulary question, choose the single most accurate option.

RESPONSE FORMAT:
Return ONLY a valid JSON object without markdown fences:
{
  "selected_option": "Exact string of the correct option",
  "selected_index": 0
}`;
        } else if (taskType === "writing") {
            prompt = `You are an expert English examiner and academic writer taking the The Hindu STEP English test. Write a high-scoring, fluent, and well-structured response.

QUESTION / TOPIC:
"""
${questionText}
"""

CONTEXT:
"""
${context || "None"}
"""

TASK & SCORING GUIDELINES:
- If a word limit is specified (e.g. 100-150 words, 50-100 words), STRICTLY produce a complete essay within that range.
- Structure your response into clear, coherent paragraphs: Introduction, Body Paragraph(s), and Conclusion.
- Maintain impeccable grammar, sophisticated vocabulary, and natural academic transition words.
- Do not include greetings, placeholders, meta-text, or markdown formatting. Output raw natural text only.

RESPONSE FORMAT:
Return ONLY a valid JSON object without markdown fences:
{
  "detected_type": "writing",
  "writing_answer": "Complete high-scoring response text here.",
  "estimated_word_count": 125,
  "explanation": "Brief rationale"
}`;
        }

        let activeIdx = getActiveKeyIndex(keys.length);
        let attempts = 0;

        while (attempts < keys.length) {
            const keyObj = keys[activeIdx];
            const apiKey = keyObj.key;
            let model = keyObj.model;
            if (!model || model === "Auto-Selected" || model === "auto") {
                model = await getBestModel(apiKey);
                keyObj.model = model;
                saveApiKeys(keys);
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.1,
                            response_mime_type: "application/json"
                            // Unlimited output tokens: no artificial token cap
                        }
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error?.message || `HTTP ${response.status}`;
                    const isQuota = response.status === 429 || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit") || errMsg.toLowerCase().includes("exhausted");

                    if (isQuota && keys.length > 1) {
                        const nextIdx = (activeIdx + 1) % keys.length;
                        console.warn(`[Gemini AI] Key #${activeIdx + 1} exhausted. Failover switching to Key #${nextIdx + 1}...`);
                        showAnswerBanner("⚡ Token Limit Reached", `Key #${activeIdx + 1} quota reached. Switched to Backup Key #${nextIdx + 1}...`, "Auto-Failover");
                        keyObj.status = "exhausted";
                        activeIdx = nextIdx;
                        setActiveKeyIndex(activeIdx);
                        saveApiKeys(keys);
                        attempts++;
                        await wait(600);
                        continue;
                    }

                    throw new Error(errMsg);
                }

                const data = await response.json();
                const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!rawText) throw new Error("Empty candidate output from Gemini");

                return robustJSONParse(rawText);
            } catch (err) {
                console.error(`[Gemini AI Error with Key #${activeIdx + 1}]:`, err.message);
                if (keys.length > 1 && attempts < keys.length - 1) {
                    activeIdx = (activeIdx + 1) % keys.length;
                    setActiveKeyIndex(activeIdx);
                    attempts++;
                    continue;
                }
                return null;
            }
        }

        showAnswerBanner("⚠️ All Keys Exhausted", `All ${keys.length} API keys in your pool have reached their rate limit / quota.`, "Rate Limited");
        return null;
    }

    // Resilient JSON parser for Gemini candidate text with truncation recovery
    function robustJSONParse(rawText) {
        if (!rawText || typeof rawText !== "string") return null;
        let text = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const firstBrace = text.indexOf("{");
        if (firstBrace !== -1) {
            const lastBrace = text.lastIndexOf("}");
            if (lastBrace !== -1 && lastBrace > firstBrace) {
                text = text.slice(firstBrace, lastBrace + 1);
            } else {
                text = text.slice(firstBrace);
            }
        }
        try { return JSON.parse(text); } catch (_) {}

        let repaired = text.replace(/\/\/[^\r\n]*(\r?\n|$)/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
        repaired = repaired.replace(/,\s*([}\]])/g, "$1");
        repaired = repaired.replace(/(['"])?([a-zA-Z0-9_]+)\1\s*:/g, '"$2":');
        repaired = repaired.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"');
        repaired = repaired.replace(/\[\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, '["$1"');
        repaired = repaired.replace(/,\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ', "$1"');

        try { return JSON.parse(repaired); } catch (_) {}

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

        // Truncation Recovery
        const salvaged = salvageTruncatedJSON(repaired) || salvageTruncatedJSON(text);
        if (salvaged) {
            try { return JSON.parse(salvaged); } catch (_) {}
            try {
                const fn = new Function('"use strict"; return (' + salvaged + ');');
                const res = fn();
                if (res && typeof res === "object") return res;
            } catch (_) {}
        }

        return null;
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

        if (inString) s += '"';
        s = s.replace(/,\s*$/g, "");
        s = s.replace(/,\s*"[^"]*"\s*$/g, "");
        s = s.replace(/,\s*"[^"]*"\s*:\s*$/g, "");

        while (openBrackets > 0) { s += "]"; openBrackets--; }
        while (openBraces > 0) { s += "}"; openBraces--; }

        return s;
    }

    // Human-like typing simulation
    async function typeHumanly(element, text) {
        if (!element || !text) return;
        element.focus();
        element.value = "";
        for (let i = 0; i < text.length; i++) {
            await wait(Math.floor(Math.random() * 80) + 40);
            element.value += text[i];
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Framework-compatible value setter with execCommand and synthetic event dispatch
    function setElementValue(element, val) {
        if (!element) return;
        element.focus();

        let execSuccess = false;
        try {
            if (document.queryCommandSupported && document.queryCommandSupported("insertText")) {
                document.execCommand("selectAll", false, null);
                execSuccess = document.execCommand("insertText", false, val);
            }
        } catch (_) {}

        if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
            const prototype = element.tagName === "INPUT" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

            if (nativeSetter) {
                nativeSetter.call(element, val);
            } else {
                element.value = val;
            }
        } else if (element.isContentEditable || element.getAttribute("role") === "textbox") {
            if (!execSuccess || element.innerText.trim() !== val.trim()) {
                element.innerText = val;
            }
        }

        try {
            element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: val }));
        } catch (_) {}
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    // Authentic click simulation
    function simulateClick(element) {
        if (!element) return;
        try { element.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        try {
            if (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable) {
                element.focus();
            }
        } catch (_) {}

        const input = element.querySelector("input[type='radio'], input[type='checkbox']") ||
            (element.parentElement ? element.parentElement.querySelector("input[type='radio'], input[type='checkbox']") : null);

        const clickableContainer = element.closest(
            "button, [role='button'], [role='radio'], label, [class*='option' i], [class*='choice' i], [class*='card' i], [class*='item' i], [class*='chip' i], [class*='token' i], [class*='pill' i], [class*='answer' i], [class*='select' i], li"
        );

        const targets = new Set([element]);
        if (input) targets.add(input);
        if (clickableContainer) targets.add(clickableContainer);
        if (element.parentElement && element.parentElement !== document.body) {
            targets.add(element.parentElement);
        }

        if (input) {
            try {
                input.checked = true;
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
            } catch (_) {}
        }

        const clickEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        targets.forEach(tgt => {
            clickEvents.forEach(evtName => {
                try {
                    if (evtName.startsWith("pointer") && typeof PointerEvent !== "undefined") {
                        tgt.dispatchEvent(new PointerEvent(evtName, { bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: "mouse", isPrimary: true }));
                    } else {
                        tgt.dispatchEvent(new MouseEvent(evtName, { bubbles: true, cancelable: true, view: window }));
                    }
                } catch (_) {}
            });
            try { tgt.click(); } catch (_) {}
        });
    }

    function isElementVisible(el) {
        if (!el || !(el instanceof Element)) return false;
        if (el.closest("[style*='display: none'], [style*='display:none'], [hidden], .hidden, .hide, .d-none, .ng-hide, [aria-hidden='true']")) {
            return false;
        }
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
            return false;
        }
        const rect = el.getBoundingClientRect();
        return ((rect.width > 0 && rect.height > 0) || (el.offsetWidth > 0 && el.offsetHeight > 0));
    }

    // Detect if current screen is truly the post-submission Answer / Feedback / Review page
    function isAnswerOrFeedbackPage() {
        // 1. ACTIVE QUESTION CHECK: If any active interactive controls exist, it is NOT a feedback page!
        // Check for rearrangement chips:
        const activeTokens = findRearrangeTokens();
        if (activeTokens && activeTokens.length >= 3) {
            return false; // Active rearrange question!
        }

        const allButtons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a, div[role='button'], [class*='btn' i]"))
            .filter(b => isElementVisible(b) && !b.closest("#steptest-ai-banner, header, nav"));

        // If there is a visible Reset button, it is an active question!
        const hasResetBtn = allButtons.some(b => {
            const t = safeText(b).toLowerCase();
            return t.startsWith("reset");
        });
        if (hasResetBtn) {
            return false;
        }

        // If there is a visible Submit button, it is an active question!
        const hasSubmitBtn = allButtons.some(b => {
            const t = safeText(b).toLowerCase();
            return t === "submit" || t.startsWith("submit");
        });
        if (hasSubmitBtn) {
            return false;
        }

        // Check for interactive select/textarea/text inputs:
        const activeInputs = Array.from(document.querySelectorAll("select, textarea, input[type='text']:not(.gemini-input)"))
            .filter(el => isElementVisible(el) && !el.closest("#steptest-ai-banner"));
        if (activeInputs.length > 0) {
            return false;
        }

        // 2. POST-SUBMISSION REQUIREMENTS:
        // A post-submission feedback page MUST have a Next or Continue button:
        const hasNextBtn = allButtons.some(b => {
            const t = safeText(b).toLowerCase();
            return t === "next" || t.startsWith("next") || t === "continue";
        });

        if (!hasNextBtn) {
            return false; // No Next button -> cannot be post-submission review page
        }

        // 3. And MUST have site feedback elements outside our banner
        const candidateFeedbackElements = Array.from(document.querySelectorAll(
            ".feedback, .feedback-box, .explanation, .solution-box, [class*='feedback-content' i], [class*='feedback-card' i]"
        )).filter(el => isElementVisible(el) && !el.closest("#steptest-ai-banner"));

        if (candidateFeedbackElements.length > 0) {
            return true;
        }

        // Check for explicit site feedback text outside our banner
        try {
            const bodyClone = document.body.cloneNode(true);
            bodyClone.querySelectorAll("#steptest-ai-banner, script, style").forEach(el => el.remove());
            const cleanText = safeText(bodyClone).toLowerCase();

            if (
                cleanText.includes("view all options") ||
                cleanText.includes("hide all options") ||
                /\bfeedback\b/i.test(cleanText)
            ) {
                return true;
            }
        } catch (_) {}

        return false;
    }

    // Filter out top navbar, header, progress bars, and unit titles
    function isNavOrSystem(el) {
        if (!el || el.closest("#steptest-ai-banner")) return true;
        if (el.closest("header, nav, footer, [class*='navbar' i], [class*='top-bar' i], [class*='progress' i]")) return true;
        const text = safeText(el).toLowerCase();
        return /^\d{1,3}%$/.test(text) || /^unit\s*\d+/i.test(text);
    }

    // Detect if current screen is a Cloze / Multi-Blank Passage Question
    function checkIsClozePassage() {
        const bodyText = (document.body ? safeText(document.body) : "").toLowerCase();

        // Must NOT be a sentence rearrangement question
        const hasRearrangeKeywords = (
            bodyText.includes("rearrange the words or phrases") ||
            bodyText.includes("rearrange the phrases") ||
            bodyText.includes("rearrange the words") ||
            bodyText.includes("rearrange words") ||
            bodyText.includes("rearrange phrases") ||
            bodyText.includes("rearrange the sentence") ||
            bodyText.includes("arrange the following sentences") ||
            bodyText.includes("arrange the sentences") ||
            bodyText.includes("arrange sentences") ||
            bodyText.includes("form a logical sentence")
        );
        if (hasRearrangeKeywords) return false;

        // Reset button check: MANDATORY for StepTest cloze & rearrange
        const hasResetBtn = Array.from(document.querySelectorAll("button, a, input[type='button'], div[role='button']"))
            .some(b => !isNavOrSystem(b) && safeText(b).toLowerCase().startsWith("reset"));

        if (!hasResetBtn) return false;

        // Exclude single-choice questions (e.g. "1. Fill in the blank", "best answer from the following", "fill in the blank with the best answer")
        const isSingleChoicePrompt = (
            bodyText.includes("fill in the blank with the best answer") ||
            bodyText.includes("fill in the blank with the correct") ||
            bodyText.includes("best answer from the following") ||
            bodyText.includes("select the best answer") ||
            bodyText.includes("select the suitable word") ||
            bodyText.includes("choose the best answer")
        );

        const blankMatches = bodyText.match(/\[\s*blank\s*\d*\s*\]|\[\s*_\s*\]|\[\s*\]|_{2,}/gi) || [];
        if (isSingleChoicePrompt && blankMatches.length <= 1) {
            return false;
        }

        const hasClozeKeywords = (
            bodyText.includes("words for the blanks") ||
            bodyText.includes("choosing the correct words") ||
            bodyText.includes("words that best complete") ||
            bodyText.includes("fill in the blanks with suitable words") ||
            bodyText.includes("fill in the blanks with words") ||
            bodyText.includes("fill in the blanks") ||
            bodyText.includes("fill in each blank") ||
            bodyText.includes("suitable words for the blank") ||
            bodyText.includes("complete the passage") ||
            bodyText.includes("complete the airport announcement") ||
            bodyText.includes("complete the announcement") ||
            bodyText.includes("passage in a logical sequence")
        );

        const hasBlankDom = Array.from(document.querySelectorAll("[class*='blank' i], [class*='slot' i], [class*='drop' i], [class*='gap' i], [class*='target' i], [data-blank], [data-slot], [class*='droppable' i]"))
            .some(el => !el.closest("#steptest-ai-banner"));

        if (hasClozeKeywords || hasBlankDom || blankMatches.length >= 2) {
            return true;
        }

        return false;
    }

    // Extract clickable word choice chips for cloze passage
    function findClozeChips() {
        const chips = [];
        const seen = new Set();

        function isValidChip(el) {
            if (!el || el.closest("header, nav, video, iframe, #steptest-ai-banner")) return false;
            const txt = safeText(el);
            if (!txt || txt.length < 1 || txt.length > 60) return false;
            const lower = txt.toLowerCase();
            if (/^(reset|submit|next|replay|play|save|continue|grade)\b/i.test(lower)) return false;
            if (lower.startsWith("fill in the blank")) return false;
            if (lower.startsWith("complete the passage")) return false;
            if (lower.startsWith("complete the airport")) return false;
            if (lower.includes("words that best complete")) return false;
            if (lower.includes("words for the blanks")) return false;
            if (el.matches("button[type='submit'], input[type='submit']")) return false;
            if (/^\[?\s*blank\s*\d*\s*\]?$/i.test(txt)) return false;
            if (/^_{2,}$/.test(txt)) return false;
            if (/^\d+\s+of\s+\d+(\s+questions?)?$/i.test(txt)) return false;
            return true;
        }

        function isLeafChip(el) {
            if (!isValidChip(el)) return false;
            return !Array.from(el.querySelectorAll("*")).some(isValidChip);
        }

        // Strategy 0: Boundary search from Reset button
        const allVisible = Array.from(document.querySelectorAll("*")).filter(el => !isNavOrSystem(el));
        const resetIdx = allVisible.findIndex(el => {
            const txt = safeText(el).toLowerCase();
            return txt.startsWith("reset") && (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.matches("[class*='btn' i], a, div, span"));
        });

        if (resetIdx !== -1) {
            let startIdx = -1;
            for (let i = resetIdx - 1; i >= 0; i--) {
                const t = safeText(allVisible[i]).toLowerCase();
                if (
                    t.includes("words that best complete") ||
                    t.includes("fill in the blanks") ||
                    t.includes("choices below") ||
                    t.includes("from the choices") ||
                    t.includes("words for the blanks") ||
                    t.includes("complete the")
                ) {
                    startIdx = i;
                    break;
                }
            }

            const scanStart = startIdx !== -1 ? startIdx + 1 : Math.max(0, resetIdx - 30);
            for (let i = scanStart; i < resetIdx; i++) {
                const el = allVisible[i];
                if (isLeafChip(el) && !seen.has(el)) {
                    const t = safeText(el);
                    if (!chips.some(c => c.text === t)) {
                        seen.add(el);
                        chips.push({ element: el, index: chips.length, text: t });
                    }
                }
            }
            if (chips.length >= 2) return chips;
        }

        // Strategy 1: Candidate container holding 2 to 12 leaf chips
        const candidateContainers = Array.from(document.querySelectorAll("div, ul, section, ol, p")).filter(p => {
            if (!isElementVisible(p) || p.closest("header, nav, video, iframe, #steptest-ai-banner")) return false;
            const leafChips = Array.from(p.querySelectorAll("*")).filter(isLeafChip);
            return leafChips.length >= 2 && leafChips.length <= 12;
        });

        if (candidateContainers.length > 0) {
            candidateContainers.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
            const bestContainer = candidateContainers[0];
            Array.from(bestContainer.querySelectorAll("*")).filter(isLeafChip).forEach(el => {
                const t = safeText(el);
                if (!seen.has(el) && !chips.some(c => c.text === t)) {
                    seen.add(el);
                    chips.push({ element: el, index: chips.length, text: t });
                }
            });
            if (chips.length >= 2) return chips;
        }

        // Strategy 2: Candidate buttons or chips
        const candidates = Array.from(document.querySelectorAll("button, [class*='chip' i], [class*='choice' i], [class*='option' i], [class*='word' i], [class*='pill' i], [class*='card' i], [class*='item' i]"))
            .filter(isLeafChip);

        candidates.forEach(el => {
            const t = safeText(el);
            if (!seen.has(el) && !chips.some(c => c.text === t)) {
                seen.add(el);
                chips.push({ element: el, index: chips.length, text: t });
            }
        });

        return chips;
    }

    function findClozeBlanks() {
        const blanks = Array.from(document.querySelectorAll(
            "[class*='blank' i], [class*='slot' i], [class*='drop' i], [class*='gap' i], [class*='target' i], [class*='droppable' i], [data-blank], [data-slot], [data-index], input:not([type='button']):not([type='submit']):not([type='radio']):not([type='checkbox'])"
        )).filter(el => {
            if (!isElementVisible(el) || el.closest("#steptest-ai-banner, header, nav")) return false;
            const t = safeText(el).toLowerCase();
            return !/^(reset|submit|next)\b/i.test(t);
        });

        const paragraphs = Array.from(document.querySelectorAll("p, div.passage, div.content, div.question-body, section")).filter(p => {
            if (!isElementVisible(p) || isNavOrSystem(p)) return false;
            const txt = safeText(p);
            return txt.length > 20 && !txt.includes("14 of 14") && (txt.includes("delayed") || txt.includes("flight") || txt.includes("All") || txt.includes("check") || txt.includes("number"));
        });

        for (const p of paragraphs) {
            const inlineBoxes = Array.from(p.querySelectorAll("span, div, input")).filter(el => {
                if (!isElementVisible(el) || blanks.includes(el) || el.closest("#steptest-ai-banner")) return false;
                const rect = el.getBoundingClientRect();
                const txt = safeText(el);
                return rect.width >= 20 && rect.height >= 14 && (txt.length === 0 || /^\[?\s*blank\s*\d*\s*\]?$/i.test(txt) || /^_{1,}$/.test(txt));
            });
            inlineBoxes.forEach(box => {
                if (!blanks.includes(box)) blanks.push(box);
            });
        }

        blanks.sort((a, b) => {
            const rA = a.getBoundingClientRect();
            const rB = b.getBoundingClientRect();
            if (Math.abs(rA.top - rB.top) > 12) return rA.top - rB.top;
            return rA.left - rB.left;
        });

        return blanks;
    }

    // Detect if current screen is a Sentence Rearrangement question
    function checkIsRearrangeQuestion() {
        const bodyText = (document.body ? safeText(document.body) : "").toLowerCase();

        // Must NOT be a cloze passage question
        const hasClozeKeywords = (
            bodyText.includes("fill in the blanks with suitable words") ||
            bodyText.includes("complete the passage") ||
            bodyText.includes("passage in a logical sequence") ||
            bodyText.includes("fill in the blank above") ||
            bodyText.includes("choices below")
        );
        if (hasClozeKeywords) return false;

        // CRITICAL: If visible radio buttons exist, this is an MCQ (e.g. sequence ordering ABCD / DCAB), NOT chip rearrange!
        const hasRadioInputs = Array.from(document.querySelectorAll("input[type='radio']")).some(isElementVisible);
        if (hasRadioInputs) return false;

        // CRITICAL: "Fill in the blank" / "Choose the correct" questions are NEVER sentence rearrangements!
        const isFillBlankOrChoose = (
            bodyText.includes("fill in the blank") ||
            bodyText.includes("fill in the blanks") ||
            bodyText.includes("fill in the missing") ||
            bodyText.includes("select the best answer") ||
            bodyText.includes("choose the best") ||
            bodyText.includes("choose the correct") ||
            bodyText.includes("select the correct") ||
            bodyText.includes("select the suitable") ||
            bodyText.includes("choose the suitable") ||
            bodyText.includes("best answer from the following")
        );

        const hasRearrangeKeywords = (
            bodyText.includes("rearrange the words or phrases") ||
            bodyText.includes("rearrange the phrases") ||
            bodyText.includes("rearrange the words") ||
            bodyText.includes("rearrange words") ||
            bodyText.includes("rearrange phrases") ||
            bodyText.includes("rearrange the sentence") ||
            bodyText.includes("arrange the following sentences") ||
            bodyText.includes("arrange the sentences") ||
            bodyText.includes("arrange sentences") ||
            bodyText.includes("arrange the words") ||
            bodyText.includes("arrange the phrases") ||
            bodyText.includes("form a logical sentence") ||
            bodyText.includes("form a sentence")
        );

        if (isFillBlankOrChoose && !hasRearrangeKeywords) {
            return false;
        }

        if (hasRearrangeKeywords) return true;

        const hasResetBtn = Array.from(document.querySelectorAll("button, a, input, div, span, [role='button']"))
            .some(b => isElementVisible(b) && !isNavOrSystem(b) && safeText(b).toLowerCase().startsWith("reset"));

        const hasSlotDashes = (bodyText.includes("——") || bodyText.includes("––") || bodyText.includes("— —")) && (bodyText.includes("“") || bodyText.includes("”"));
        if (hasResetBtn && hasSlotDashes) {
            return true;
        }

        return false;
    }

    // Extract clickable words/phrase chips for rearrange questions
    function findRearrangeTokens() {
        const tokens = [];
        const seen = new Set();

        function isValidChip(el) {
            if (!el || !isElementVisible(el) || el.closest("header, nav, video, iframe, #steptest-ai-banner")) return false;
            const txt = safeText(el);
            if (!txt || txt.length < 1 || txt.length > 450) return false;
            const lower = txt.toLowerCase();
            if (/^(reset|submit|next|replay|play|save|continue|grade|abc|record|speak|mic|listen)\b/i.test(lower)) return false;
            if (lower.startsWith("rearrange the words or phrases")) return false;
            if (lower.startsWith("arrange the following sentences")) return false;
            if (lower.startsWith("form a logical sentence")) return false;
            if (lower.startsWith("if the video is not loading")) return false;
            if (/^\d{1,2}:\d{2}/.test(lower)) return false;
            if (el.matches("button[type='submit'], input[type='submit']")) return false;
            if (txt.includes("“") || txt.includes("”")) return false;
            if (/^[—–\-_.\s]+$/.test(txt)) return false;
            if (/^\d+\s+of\s+\d+(\s+questions?)?$/i.test(txt)) return false;
            return true;
        }

        function isLeafChip(el) {
            if (!isValidChip(el)) return false;
            return !Array.from(el.querySelectorAll("*")).some(ch => isValidChip(ch));
        }

        // Strategy 0: StepTest Rearrange Anchor to Reset Button
        const allLabels = Array.from(document.querySelectorAll("*")).filter(el => isElementVisible(el) && !isNavOrSystem(el));
        const matchingAnchors = allLabels.filter(el => {
            const t = safeText(el).toLowerCase();
            return (
                t.includes("rearrange the words or phrases") ||
                t.includes("arrange the following sentences") ||
                t.includes("form a logical sentence") ||
                t.includes("rearrange the sentence")
            );
        });

        if (matchingAnchors.length > 0) {
            matchingAnchors.sort((a, b) => safeText(a).length - safeText(b).length);
            const anchor = matchingAnchors[0];

            const allElements = Array.from(document.querySelectorAll("*")).filter(isElementVisible);
            const anchorIdx = allElements.indexOf(anchor);

            let endIdx = -1;
            const resetBtn = allElements.find((el, idx) => {
                if (idx <= anchorIdx || isNavOrSystem(el)) return false;
                const txt = safeText(el).toLowerCase();
                return txt.startsWith("reset");
            });
            if (resetBtn) {
                endIdx = allElements.indexOf(resetBtn);
            } else {
                const boundaryBtn = allElements.findIndex((el, idx) => {
                    if (idx <= anchorIdx) return false;
                    const txt = safeText(el).toLowerCase();
                    return (txt === "submit" || txt === "next") && el.matches("button, input, [role='button']");
                });
                endIdx = boundaryBtn !== -1 ? boundaryBtn : allElements.length;
            }

            if (anchorIdx !== -1) {
                for (let i = anchorIdx + 1; i < endIdx; i++) {
                    const el = allElements[i];
                    if (isLeafChip(el) && !seen.has(el)) {
                        const t = safeText(el);
                        seen.add(el);
                        tokens.push({ element: el, index: tokens.length, text: t });
                    }
                }
                if (tokens.length >= 3) return tokens;
            }
        }

        const candidateParents = Array.from(document.querySelectorAll("div, ul, section")).filter(p => {
            if (p.closest("header, nav, video, iframe, #steptest-ai-banner")) return false;
            const validChildren = Array.from(p.children).filter(isValidChip);
            return validChildren.length >= 3 && validChildren.length <= 15;
        });

        if (candidateParents.length > 0) {
            const bestParent = candidateParents[0];
            Array.from(bestParent.children).filter(isValidChip).forEach((el, idx) => {
                if (!seen.has(el)) {
                    seen.add(el);
                    tokens.push({ element: el, index: idx, text: safeText(el) });
                }
            });
            if (tokens.length >= 3) return tokens;
        }

        const allClickables = Array.from(document.querySelectorAll("button, div[role='button'], span[role='button'], div[tabindex]"))
            .filter(isValidChip);
        if (allClickables.length >= 3 && allClickables.length <= 15) {
            allClickables.forEach((el, idx) => {
                if (!seen.has(el)) {
                    seen.add(el);
                    tokens.push({ element: el, index: idx, text: safeText(el) });
                }
            });
        }

        return tokens;
    }

    // Extract current question context and options from StepTest DOM
    function scanPageForQuestion() {
        // 1. Find Numbered Prompt or Heading
        let questionText = "";
        const allHeadings = Array.from(document.querySelectorAll("h1, h2, h3, h4, p, div, span")).filter(el => !isNavOrSystem(el));
        const promptEl = allHeadings.find(el => {
            const t = safeText(el);
            return /^\d+\.\s+[A-Z]/i.test(t) || /^question\s*\d+/i.test(t);
        });
        if (promptEl) {
            questionText = safeText(promptEl);
        }

        // 2. Extract clean context (stripping video timestamps & player labels)
        let fullContext = "";
        const mainArea = document.querySelector("main, #content, .test-container, .question-container") || document.body;
        try {
            const clone = mainArea.cloneNode(true);
            clone.querySelectorAll("header, nav, footer, video, iframe, [class*='top-bar' i], [class*='progress' i], #steptest-ai-banner").forEach(n => n.remove());
            let txt = clone.innerText || clone.textContent || "";
            txt = txt.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "");
            txt = txt.replace(/\b\d+\s+of\s+\d+\s+questions\b/gi, "");
            fullContext = txt.replace(/\s+/g, " ").trim();
        } catch (_) {
            fullContext = "";
        }

        if (!questionText) {
            questionText = fullContext;
        }

        // 3. Cloze Detection
        const isCloze = checkIsClozePassage();
        let clozeChips = [];
        let clozeBlanks = [];
        if (isCloze) {
            clozeChips = findClozeChips();
            clozeBlanks = findClozeBlanks();
        }
        const finalIsCloze = isCloze && clozeChips.length >= 2;

        // 4. Rearrange Detection
        const isRearrange = !finalIsCloze && checkIsRearrangeQuestion();
        let sentenceTokens = [];
        if (isRearrange) {
            sentenceTokens = findRearrangeTokens();
        }
        const finalIsRearrange = isRearrange && sentenceTokens.length >= 3;

        // 5. Writing Area Detection
        const writingSelectors = "textarea:not(.gemini-input), [contenteditable='true'], [contenteditable=''], [contenteditable], [role='textbox'], .ql-editor, .fr-element, .monaco-editor, .public-DraftEditor-content, div.editable";
        const writingAreas = Array.from(
            document.querySelectorAll(writingSelectors)
        ).filter(el => isElementVisible(el) && !el.closest("#steptest-ai-banner") && !isNavOrSystem(el));

        const fullTextForWriting = (questionText + " " + fullContext).toLowerCase();
        const hasWritingKeywords = (
            fullTextForWriting.includes("write a paragraph") ||
            fullTextForWriting.includes("write an essay") ||
            fullTextForWriting.includes("write an email") ||
            fullTextForWriting.includes("write a letter") ||
            fullTextForWriting.includes("write a response") ||
            fullTextForWriting.includes("write a short") ||
            fullTextForWriting.includes("describe the") ||
            fullTextForWriting.includes("summarize the") ||
            fullTextForWriting.includes("in 100-150 words") ||
            fullTextForWriting.includes("in 50-100 words") ||
            fullTextForWriting.includes("word limit") ||
            fullTextForWriting.includes("word count") ||
            fullTextForWriting.includes("type your response") ||
            fullTextForWriting.includes("type your answer") ||
            fullTextForWriting.includes("writing task")
        );

        const hasRealRadios = Array.from(document.querySelectorAll("input[type='radio'], input[type='checkbox']")).some(isElementVisible);
        const finalIsWriting = writingAreas.length > 0 && (hasWritingKeywords || !hasRealRadios);

        // 6. Locate Options (Only disabled if verified as Cloze, Rearrange, or Writing!)
        const options = [];
        if (!finalIsCloze && !finalIsRearrange && !finalIsWriting) {
            const matchingAnchors = allHeadings.filter(el => {
                const raw = safeText(el);
                if (/^\d+[\.\)]/i.test(raw)) return false; // Ignore headings like "1. Fill in the blank"
                const txt = raw.toLowerCase();
                return txt.includes("select the best answer") ||
                       txt.includes("choose the correct") ||
                       txt.includes("select the following") ||
                       txt.includes("choose the best") ||
                       txt.includes("select correct") ||
                       txt.includes("select the suitable") ||
                       txt.includes("choose the suitable") ||
                       txt.includes("select the word") ||
                       txt.includes("fill in the blank with the best answer") ||
                       txt.includes("fill in the blank with the correct option") ||
                       txt.includes("fill in the blank with") ||
                       txt.includes("best answer from the following");
            });

            if (matchingAnchors.length > 0) {
                matchingAnchors.sort((a, b) => safeText(a).length - safeText(b).length);
                const anchor = matchingAnchors[0];

                // A. Check siblings directly following this anchor
                let next = anchor.nextElementSibling;
                while (next && options.length < 10) {
                    if (!isNavOrSystem(next)) {
                        const txt = safeText(next);
                        if (next.matches("button, input[type='submit']") || /^(submit|next|save|continue)\b/i.test(txt)) {
                            break;
                        }
                        const children = Array.from(next.children).filter(ch => !isNavOrSystem(ch) && safeText(ch).length > 0);
                        if (children.length >= 2 && children.length <= 10) {
                            children.forEach((c, idx) => {
                                options.push({ element: c, index: idx, text: safeText(c) });
                            });
                            break;
                        } else if (txt.length > 0 && txt.length < 450) {
                            options.push({ element: next, index: options.length, text: txt });
                        }
                    }
                    next = next.nextElementSibling;
                }

                // B. If not enough options, check anchor's parent's siblings
                if (options.length < 2 && anchor.parentElement) {
                    let parentNext = anchor.parentElement.nextElementSibling;
                    while (parentNext && options.length < 10) {
                        if (!isNavOrSystem(parentNext)) {
                            const pTxt = safeText(parentNext);
                            if (parentNext.matches("button, input[type='submit']") || /^(submit|next|save|continue)\b/i.test(pTxt)) {
                                break;
                            }
                            const children = Array.from(parentNext.children).filter(ch => !isNavOrSystem(ch) && safeText(ch).length > 0);
                            if (children.length >= 2 && children.length <= 10) {
                                children.forEach((c, idx) => {
                                    options.push({ element: c, index: idx, text: safeText(c) });
                                });
                                break;
                            } else if (pTxt.length > 0 && pTxt.length < 450) {
                                options.push({ element: parentNext, index: options.length, text: pTxt });
                            }
                        }
                        parentNext = parentNext.nextElementSibling;
                    }
                }
            }

            if (options.length === 0) {
                const inputs = Array.from(document.querySelectorAll("input[type='radio'], input[type='checkbox']"))
                    .filter(i => !isNavOrSystem(i));
                if (inputs.length >= 2) {
                    inputs.forEach((inp, idx) => {
                        const label = inp.closest("label") || inp.parentElement;
                        options.push({ element: inp, index: idx, text: label ? safeText(label) : (inp.value || "") });
                    });
                }
            }

            if (options.length === 0) {
                const choiceEls = Array.from(document.querySelectorAll("[class*='option' i], [class*='choice' i], [role='radio']"))
                    .filter(el => !isNavOrSystem(el) && safeText(el).length > 0 && safeText(el).length < 450 && !/^(submit|next|save|continue)\b/i.test(safeText(el)));
                if (choiceEls.length >= 2 && choiceEls.length <= 10) {
                    choiceEls.forEach((el, idx) => {
                        options.push({ element: el, index: idx, text: safeText(el) });
                    });
                }
            }
        }

        let qType = "mcq";
        if (finalIsCloze) qType = "cloze_passage";
        else if (finalIsWriting) qType = "writing";
        else if (finalIsRearrange) qType = "rearrange_sentence";

        return {
            type: qType,
            questionText,
            fullContext,
            options,
            wordChoices: clozeChips,
            clozeBlanks,
            sentenceTokens,
            writingArea: writingAreas[0] || null
        };
    }

    // Check if question is already answered on screen (Token-Saver)
    function isQuestionAlreadyAnswered(current) {
        if (isAnswerOrFeedbackPage()) return true;

        if (current.type === "writing") {
            const writingArea = current.writingArea || document.querySelector("textarea:not(.gemini-input), [contenteditable='true'], [role='textbox']");
            if (writingArea) {
                const val = (writingArea.value || writingArea.innerText || "").trim();
                if (val.length > 20) return true;
            }
        }

        if (current.type === "cloze_passage") {
            const placedBlanks = document.querySelectorAll("[class*='blank' i] [class*='chip' i], [class*='slot' i] [class*='chip' i]");
            if (placedBlanks.length >= 2) return true;
        }

        if (current.type === "rearrange_sentence") {
            const slots = document.querySelectorAll("[class*='slot' i], [class*='blank' i], [class*='drop' i]");
            if (slots.length > 0) {
                const filled = Array.from(slots).filter(s => safeText(s).length > 0);
                if (filled.length >= 3) return true;
            }
        }

        const checkedInput = document.querySelector("input[type='radio']:checked, input[type='checkbox']:checked");
        if (checkedInput) return true;

        const activeCard = Array.from(document.querySelectorAll("[class*='selected' i], [class*='active' i], [aria-checked='true']"))
            .find(el => !el.closest("#steptest-ai-banner, header, nav, .navbar, .tab, .tabs, .pagination, .breadcrumbs") && el.matches("[class*='option' i], [class*='choice' i], [class*='card' i], [class*='answer' i], [role='radio'], [role='option'], label"));
        if (activeCard) return true;

        return false;
    }

    // Main Automation Loop
    async function main() {
        console.log("[StepTest Gemini Automation] Background solver active");

        while (true) {
            try {
                // 1. Handle Videos: Play & wait until completion
                const video = document.querySelector('video');
                if (video && !video.ended) {
                    if (video.paused) {
                        console.log("[StepTest] Playing video...");
                        video.play().catch(() => {});
                    }
                    console.log("[StepTest] Waiting for video to finish...");
                    await wait(5000);
                    continue;
                }

                // Skip if currently on Answer / Feedback Review page
                if (isAnswerOrFeedbackPage()) {
                    await wait(2000);
                    continue;
                }

                // 2. Scan Current Question
                const current = scanPageForQuestion();
                const cleanPrompt = current.questionText.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "").replace(/\s+/g, " ").trim();
                const itemsList = current.options.length ? current.options : (current.wordChoices && current.wordChoices.length ? current.wordChoices : current.sentenceTokens);
                const itemsKey = itemsList.map(o => o.text).join('|');
                const questionHash = `${current.type}::${cleanPrompt}::${itemsKey}`;

                // 3. Handle Cloze / Multi-Blank Passage Questions via Gemini
                if (current.type === "cloze_passage" && current.wordChoices && current.wordChoices.length >= 2 && questionHash !== lastAnsweredQuestion && !isProcessing) {
                    if (!isQuestionAlreadyAnswered(current)) {
                        isProcessing = true;
                        hideAnswerBanner();

                        console.log(`[StepTest] Solving Cloze Passage Question: "${cleanPrompt.slice(0, 60)}..."`);
                        console.log("[StepTest] Word Choices:", current.wordChoices.map(c => c.text));

                        // Clean Board Check: If any blanks are already filled, reset first
                        const resetBtn = Array.from(document.querySelectorAll("button, div[role='button'], a, input[type='button']")).find(b => {
                            if (isNavOrSystem(b) || !isElementVisible(b)) return false;
                            const txt = safeText(b).toLowerCase();
                            return txt.startsWith("reset");
                        });
                        const hasPlacedBlanks = document.querySelectorAll("[class*='blank' i] [class*='chip' i], [class*='slot' i] [class*='chip' i]").length > 0;
                        if (resetBtn && hasPlacedBlanks) {
                            simulateClick(resetBtn);
                            await wait(250);
                        }

                        const solution = await askGemini(
                            current.questionText,
                            current.wordChoices.map(c => c.text),
                            current.fullContext,
                            "cloze_passage"
                        );

                        if (solution) {
                            console.log("[StepTest] Gemini Cloze Solution:", solution);

                            function cleanString(str) {
                                if (!str) return "";
                                return str
                                    .toLowerCase()
                                    .replace(/[“’”".,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
                                    .replace(/\s+/g, " ")
                                    .trim();
                            }

                            let orderedWords = [];
                            if (Array.isArray(solution.ordered_fill_blanks)) orderedWords.push(...solution.ordered_fill_blanks);
                            else if (Array.isArray(solution.fill_blanks)) orderedWords.push(...solution.fill_blanks);
                            else if (Array.isArray(solution.answers)) orderedWords.push(...solution.answers);

                            // Resilient fallback: Extract sequence from reconstructed_passage or explanation
                            if (orderedWords.length === 0) {
                                const sourceText = cleanString((solution.reconstructed_passage || "") + " " + (solution.explanation || ""));
                                const availableChips = findClozeChips();

                                const scoredChips = availableChips.map(chip => {
                                    const cleanChip = cleanString(chip.text);
                                    const pos = sourceText.indexOf(cleanChip);
                                    return { chip, pos: pos !== -1 ? pos : 999999 };
                                }).filter(s => s.pos !== 999999);

                                scoredChips.sort((a, b) => a.pos - b.pos);
                                orderedWords = scoredChips.map(s => s.chip.text);
                            }

                            const placedLabels = [];

                            // Sequentially place each word into its respective blank
                            for (let i = 0; i < orderedWords.length; i++) {
                                const targetWord = orderedWords[i];
                                const cleanTarget = cleanString(targetWord);
                                if (!cleanTarget) continue;

                                // 1. Fresh query for live blank slots in reading order
                                const liveBlanks = findClozeBlanks();
                                const targetBlank = liveBlanks[i] || null;

                                // Focus and click the target blank slot to activate it
                                if (targetBlank) {
                                    try {
                                        if (typeof targetBlank.focus === "function") targetBlank.focus();
                                        simulateClick(targetBlank);
                                        targetBlank.dispatchEvent(new Event("focus", { bubbles: true }));
                                        await wait(100);
                                    } catch (_) {}
                                }

                                // 2. Fresh query for live chips
                                const liveChips = findClozeChips();
                                let matchingChip = liveChips.find(c => {
                                    const cleanChip = cleanString(c.text);
                                    return cleanChip === cleanTarget;
                                }) || liveChips.find(c => {
                                    const cleanChip = cleanString(c.text);
                                    return cleanChip.includes(cleanTarget) || cleanTarget.includes(cleanChip);
                                });

                                if (!matchingChip) {
                                    const liveCandidate = Array.from(document.querySelectorAll("button, div[role='button'], [class*='chip' i], span"))
                                        .filter(el => isElementVisible(el) && !isNavOrSystem(el))
                                        .find(el => {
                                            const cleanEl = cleanString(safeText(el));
                                            return cleanEl === cleanTarget || cleanEl.includes(cleanTarget);
                                        });
                                    if (liveCandidate) {
                                        matchingChip = { element: liveCandidate, text: targetWord };
                                    }
                                }

                                if (matchingChip && matchingChip.element) {
                                    simulateClick(matchingChip.element);
                                    placedLabels.push(`${i + 1}: ${matchingChip.text}`);

                                    if (targetBlank && (targetBlank.tagName === "INPUT" || targetBlank.isContentEditable)) {
                                        setElementValue(targetBlank, matchingChip.text);
                                    }

                                    await wait(280);
                                }
                            }

                            const bannerDisplay = placedLabels.length > 0 ? placedLabels.join("  ➔  ") : orderedWords.map((w, idx) => `${idx + 1}: ${w}`).join("  ➔  ");
                            const subDisplay = solution.reconstructed_passage || solution.explanation || "All blanks filled in logical sequence";
                            showAnswerBanner(bannerDisplay, subDisplay, "Passage Blanks Solved");
                            lastAnsweredQuestion = questionHash;
                        }

                        isProcessing = false;
                        await randomWait(2000, 3500);
                    } else {
                        lastAnsweredQuestion = questionHash;
                    }
                }

                // 4. Handle Sentence / Phrase Rearrangement Questions via Gemini
                else if (current.type === "rearrange_sentence" && current.sentenceTokens.length >= 3 && questionHash !== lastAnsweredQuestion && !isProcessing) {
                    if (!isQuestionAlreadyAnswered(current)) {
                        isProcessing = true;
                        hideAnswerBanner(); // Dismiss previous banner on new question

                        console.log(`[StepTest] Solving Rearrange Question: "${cleanPrompt.slice(0, 60)}..."`);
                        console.log("[StepTest] Phrase Chips:", current.sentenceTokens.map(t => t.text));

                        // Clean Board Check: If any chips are already slotted, reset first!
                        const resetBtn = Array.from(document.querySelectorAll("button, div[role='button'], a, input[type='button']")).find(b => {
                            if (isNavOrSystem(b) || !isElementVisible(b)) return false;
                            const txt = safeText(b).toLowerCase();
                            return txt.startsWith("reset");
                        });
                        const hasPlacedChips = document.querySelectorAll("[class*='slot' i] [class*='chip' i], [class*='slot' i] span, .word-slot:not(:empty)").length > 0;
                        if (resetBtn && hasPlacedChips) {
                            console.log("[StepTest] Resetting rearrange slots to ensure clean insertion...");
                            simulateClick(resetBtn);
                            await wait(350);
                        }

                        const solution = await askGemini(
                            current.questionText,
                            current.sentenceTokens.map(t => t.text),
                            current.fullContext,
                            "rearrange_sentence"
                        );

                        if (solution) {
                            console.log("[StepTest] Gemini Rearrange Solution:", solution);

                            function normalizeTokenText(str) {
                                if (!str) return "";
                                return str
                                    .toLowerCase()
                                    // Strip leading numbering e.g. "1. ", "A) ", "(1) ", "Sentence 1: "
                                    .replace(/^(?:(?:\d+|[a-z])[\.\)\-:]|\((?:\d+|[a-z])\)|(?:sentence|phrase|clause)\s*\d+[:\-]?)\s*/i, "")
                                    // Strip punctuation and quotes
                                    .replace(/[“’”".,\/#!$%\^&\*;:{}=\-_`~()?]/g, " ")
                                    .replace(/\s+/g, " ")
                                    .trim();
                            }

                            const totalCount = current.sentenceTokens.length;

                            // Candidate 1: From reordered_token_indices
                            let candidateIndices = null;
                            let rawIndices = Array.isArray(solution.reordered_token_indices)
                                ? solution.reordered_token_indices
                                : (Array.isArray(solution.indices) ? solution.indices : []);

                            if (rawIndices.length > 0) {
                                const minIdx = Math.min(...rawIndices);
                                const maxIdx = Math.max(...rawIndices);
                                if (minIdx === 1 && maxIdx === totalCount) {
                                    rawIndices = rawIndices.map(i => i - 1);
                                }
                                const validIndices = rawIndices.filter(i => Number.isInteger(i) && i >= 0 && i < totalCount);
                                const uniqueIndices = [...new Set(validIndices)];
                                const isIdentity = (uniqueIndices.length === totalCount) && uniqueIndices.every((val, idx) => val === idx);

                                if (uniqueIndices.length >= Math.min(totalCount, 3)) {
                                    candidateIndices = {
                                        tokens: uniqueIndices.map(i => current.sentenceTokens[i]),
                                        isIdentity: isIdentity,
                                        count: uniqueIndices.length
                                    };
                                }
                            }

                            // Candidate 2: From reordered_token_texts
                            let candidateTexts = null;
                            const targetTexts = solution.reordered_token_texts || solution.ordered_tokens || solution.reordered_tokens || solution.ordered_sentences || solution.sentences || [];
                            if (Array.isArray(targetTexts) && targetTexts.length > 0) {
                                const remaining = [...current.sentenceTokens];
                                const textMatched = [];

                                for (const target of targetTexts) {
                                    const cleanTarget = normalizeTokenText(target);
                                    if (!cleanTarget) continue;

                                    let bestScore = -1;
                                    let bestIdx = -1;

                                    for (let i = 0; i < remaining.length; i++) {
                                        const cleanTok = normalizeTokenText(remaining[i].text);
                                        let score = 0;
                                        if (cleanTok === cleanTarget) {
                                            score = 10000;
                                        } else if (cleanTok.startsWith(cleanTarget) || cleanTarget.startsWith(cleanTok)) {
                                            score = 8000;
                                        } else if (cleanTok.includes(cleanTarget) || cleanTarget.includes(cleanTok)) {
                                            score = 5000 + Math.min(cleanTok.length, cleanTarget.length);
                                        } else {
                                            const tWords = new Set(cleanTarget.split(" ").filter(w => w.length > 1));
                                            const kWords = cleanTok.split(" ").filter(w => w.length > 1);
                                            let matchWords = 0;
                                            for (const w of kWords) {
                                                if (tWords.has(w)) matchWords++;
                                            }
                                            if (matchWords > 0) {
                                                score = (matchWords / Math.max(tWords.size, kWords.length)) * 1000;
                                            }
                                        }

                                        if (score > bestScore && score > 0) {
                                            bestScore = score;
                                            bestIdx = i;
                                        }
                                    }

                                    if (bestIdx !== -1 && bestScore > 100) {
                                        textMatched.push(remaining[bestIdx]);
                                        remaining.splice(bestIdx, 1);
                                    }
                                }

                                if (textMatched.length >= Math.min(totalCount, 3)) {
                                    const isIdentity = (textMatched.length === totalCount) && textMatched.every((tok, idx) => tok.index === idx);
                                    candidateTexts = {
                                        tokens: textMatched,
                                        isIdentity: isIdentity,
                                        count: textMatched.length
                                    };
                                }
                            }

                            // Candidate 3: Sequential sentence matching (Highest linguistic fidelity for Small Words & Stories)
                            let candidateSentence = null;
                            if (solution.reconstructed_sentence && typeof solution.reconstructed_sentence === "string") {
                                const cleanSentence = normalizeTokenText(solution.reconstructed_sentence);
                                let remaining = [...current.sentenceTokens];
                                const ordered = [];
                                let cursor = 0;

                                while (remaining.length > 0 && cursor < cleanSentence.length) {
                                    const sub = cleanSentence.slice(cursor).trim();
                                    if (!sub) break;

                                    let bestMatch = null;
                                    let bestScore = -1;
                                    let bestLen = 0;

                                    for (let i = 0; i < remaining.length; i++) {
                                        const tok = remaining[i];
                                        const cleanTok = normalizeTokenText(tok.text);
                                        if (!cleanTok) continue;

                                        if (sub.startsWith(cleanTok)) {
                                            const afterChar = sub[cleanTok.length];
                                            if (!afterChar || /\s/.test(afterChar)) {
                                                const score = 10000 + cleanTok.length;
                                                if (score > bestScore) {
                                                    bestScore = score;
                                                    bestMatch = { tok, idx: i, len: cleanTok.length };
                                                }
                                            }
                                        } else {
                                            const escaped = cleanTok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                                            const m = sub.match(new RegExp("(?:^|\\s+)" + escaped + "(?:\\s+|$)", "i"));
                                            if (m && m.index !== undefined && m.index <= 15) {
                                                const score = 5000 - m.index + cleanTok.length;
                                                if (score > bestScore) {
                                                    bestScore = score;
                                                    bestMatch = { tok, idx: i, len: m.index + cleanTok.length };
                                                }
                                            }
                                        }
                                    }

                                    if (bestMatch) {
                                        ordered.push(bestMatch.tok);
                                        remaining.splice(bestMatch.idx, 1);
                                        cursor = cleanSentence.indexOf(normalizeTokenText(bestMatch.tok.text), cursor);
                                        if (cursor !== -1) {
                                            cursor += normalizeTokenText(bestMatch.tok.text).length;
                                        } else {
                                            cursor += bestMatch.len;
                                        }
                                        while (cursor < cleanSentence.length && /[\s.,\/#!$%\^&\*;:{}=\-_`~()?]/.test(cleanSentence[cursor])) {
                                            cursor++;
                                        }
                                    } else {
                                        const nextSpace = sub.indexOf(" ");
                                        if (nextSpace !== -1) {
                                            cursor += nextSpace + 1;
                                        } else {
                                            break;
                                        }
                                    }
                                }

                                if (ordered.length >= Math.min(totalCount, 3)) {
                                    const isIdentity = (ordered.length === totalCount) && ordered.every((s, idx) => s.index === idx);
                                    candidateSentence = {
                                        tokens: ordered,
                                        isIdentity: isIdentity,
                                        count: ordered.length
                                    };
                                }
                            }

                            // Consensus: Prioritize genuine linguistic rearranged sequence
                            let winner = null;
                            const candidates = [candidateSentence, candidateTexts, candidateIndices].filter(c => c && c.tokens && c.tokens.length > 0);

                            const nonIdentityFull = candidates.filter(c => !c.isIdentity && c.count === totalCount);
                            if (nonIdentityFull.length > 0) {
                                winner = nonIdentityFull[0].tokens;
                            } else {
                                const nonIdentityPartial = candidates.filter(c => !c.isIdentity).sort((a, b) => b.count - a.count);
                                if (nonIdentityPartial.length > 0) {
                                    winner = nonIdentityPartial[0].tokens;
                                } else if (candidates.length > 0) {
                                    winner = candidates[0].tokens;
                                }
                            }

                            if (!winner || winner.length === 0) {
                                console.warn("[StepTest] Could not verify rearrangement order. Aborting click.");
                                isProcessing = false;
                                return;
                            }

                            // Append unplaced tokens only after AI-ordered tokens
                            const orderedChips = [...winner];
                            for (const tok of current.sentenceTokens) {
                                if (!orderedChips.includes(tok)) {
                                    orderedChips.push(tok);
                                }
                            }

                            // Sequentially click the chips in order
                            for (const chip of orderedChips) {
                                simulateClick(chip.element);
                                await wait(300);
                            }

                            const resultSentence = solution.reconstructed_sentence || orderedChips.map(c => c.text).join(" ");
                            showAnswerBanner(resultSentence, "Rearranged into logical sequence", "Sentence Rearranged");
                            lastAnsweredQuestion = questionHash;
                        }

                        isProcessing = false;
                        await randomWait(2000, 3500);
                    } else {
                        lastAnsweredQuestion = questionHash;
                    }
                }

                // Handle Writing Questions via Gemini
                else if (current.type === "writing" && questionHash !== lastAnsweredQuestion && !isProcessing) {
                    if (!isQuestionAlreadyAnswered(current)) {
                        isProcessing = true;
                        hideAnswerBanner();

                        console.log(`[StepTest] Solving Writing Question: "${cleanPrompt.slice(0, 60)}..."`);
                        const solution = await askGemini(current.questionText, [], current.fullContext, "writing");

                        if (solution) {
                            const textToInsert = (
                                solution.writing_answer ||
                                solution.essay ||
                                solution.response ||
                                solution.text ||
                                solution.answer ||
                                ""
                            ).trim();

                            const targetArea = current.writingArea || document.querySelector("textarea:not(.gemini-input), [contenteditable='true'], [role='textbox']");
                            if (targetArea && textToInsert) {
                                setElementValue(targetArea, textToInsert);
                                const words = textToInsert.split(/\s+/).filter(Boolean).length;
                                showAnswerBanner(textToInsert.slice(0, 90) + (textToInsert.length > 90 ? "..." : ""), `Generated ${words} words response adhering to requirements`, "Writing Answer");
                                lastAnsweredQuestion = questionHash;
                            }
                        }

                        isProcessing = false;
                        await randomWait(2000, 3500);
                    } else {
                        lastAnsweredQuestion = questionHash;
                    }
                }

                // 4. Handle MCQ Options via Gemini
                else if (current.type === "mcq" && current.options.length >= 2 && questionHash !== lastAnsweredQuestion && !isProcessing) {
                    if (!isQuestionAlreadyAnswered(current)) {
                        isProcessing = true;
                        hideAnswerBanner(); // Dismiss previous banner on new question

                        console.log(`[StepTest] Solving MCQ: "${cleanPrompt.slice(0, 60)}..."`);
                        console.log("[StepTest] Detected Options:", current.options.map(o => o.text));

                        const solution = await askGemini(
                            current.questionText,
                            current.options.map(o => ({ index: o.index, text: o.text })),
                            current.fullContext,
                            "mcq"
                        );

                        if (solution) {
                            console.log("[StepTest] Gemini Solution:", solution);

                            let chosen = null;
                            const answerTexts = [];
                            if (solution.selected_option) answerTexts.push(solution.selected_option);
                            if (solution.answer) answerTexts.push(solution.answer);
                            if (Array.isArray(solution.mcq_answers)) answerTexts.push(...solution.mcq_answers);
                            else if (typeof solution.mcq_answers === "string") answerTexts.push(solution.mcq_answers);
                            if (Array.isArray(solution.answers)) answerTexts.push(...solution.answers);

                            const answerIndices = [];
                            if (typeof solution.selected_index === "number") answerIndices.push(solution.selected_index);
                            if (typeof solution.index === "number") answerIndices.push(solution.index);
                            if (Array.isArray(solution.mcq_indices)) answerIndices.push(...solution.mcq_indices);
                            else if (typeof solution.mcq_indices === "number") answerIndices.push(solution.mcq_indices);

                            // Extract letter/number indices from answers e.g. "Option A", "B)", "(C)", "Option 2"
                            for (const ans of answerTexts) {
                                if (typeof ans !== "string") continue;
                                const t = ans.trim();
                                const letterMatch = t.match(/^(?:option\s*)?\(?([a-d])\)?(?:\s*[:.)\-]|\s*$)/i);
                                if (letterMatch) {
                                    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
                                    if (!answerIndices.includes(idx)) answerIndices.push(idx);
                                }
                                const numMatch = t.match(/^(?:option\s*)?\(?([1-9])\)?(?:\s*[:.)\-]|\s*$)/i);
                                if (numMatch) {
                                    const idx = parseInt(numMatch[1], 10) - 1;
                                    if (!answerIndices.includes(idx)) answerIndices.push(idx);
                                }
                            }

                            function cleanStr(s) {
                                if (!s) return "";
                                let str = (s || "")
                                    .replace(/[“’”".,\/#!$%\^&\*;:{}=\-_`~()]/g, " ")
                                    .replace(/\s+/g, " ")
                                    .trim()
                                    .toLowerCase();
                                const stripped = str.replace(/^(?:option\s*[a-d1-4]|[a-d1-4])\s+/i, "").trim();
                                return stripped.length > 0 ? stripped : str;
                            }

                            // Match by text first (Highest accuracy)
                            if (answerTexts.length > 0) {
                                for (const ans of answerTexts) {
                                    const cleanTarget = cleanStr(ans);
                                    if (!cleanTarget) continue;
                                    chosen = current.options.find(o => {
                                        const cleanOpt = cleanStr(o.text);
                                        if (cleanTarget.length > 1) {
                                            return cleanOpt === cleanTarget || cleanOpt.includes(cleanTarget) || cleanTarget.includes(cleanOpt);
                                        } else {
                                            if (cleanOpt === cleanTarget) return true;
                                            const tokens = cleanOpt.split(/\s+/);
                                            return tokens[0] === cleanTarget || (tokens[0] === "option" && tokens[1] === cleanTarget);
                                        }
                                    });
                                    if (chosen) break;
                                }
                            }

                            // Match by token overlap (fuzzy matching)
                            if (!chosen && answerTexts.length > 0) {
                                let bestScore = 0;
                                for (const opt of current.options) {
                                    const optWords = cleanStr(opt.text).split(/\s+/).filter(w => w.length >= 2);
                                    if (optWords.length === 0) continue;
                                    for (const ans of answerTexts) {
                                        const ansWords = cleanStr(ans).split(/\s+/).filter(w => w.length >= 2);
                                        if (ansWords.length === 0) continue;
                                        const common = optWords.filter(w => ansWords.includes(w));
                                        const score = common.length / Math.max(optWords.length, ansWords.length);
                                        if (score > bestScore && score >= 0.35) {
                                            bestScore = score;
                                            chosen = opt;
                                        }
                                    }
                                }
                            }

                            // Match by index second (with 1-based offset support)
                            if (!chosen && answerIndices.length > 0) {
                                let normIndices = [...answerIndices];
                                if (normIndices.some(i => i === current.options.length)) {
                                    normIndices = normIndices.map(i => i - 1);
                                }
                                for (const idx of normIndices) {
                                    if (current.options[idx]) {
                                        chosen = current.options[idx];
                                        break;
                                    }
                                }
                            }

                            // Match by option letter label in option text (e.g. "A.", "B)", "Option C")
                            if (!chosen && answerIndices.length > 0) {
                                for (const idx of answerIndices) {
                                    const targetLetter = String.fromCharCode(65 + idx);
                                    const found = current.options.find(opt => {
                                        const t = (opt.text || "").trim().toUpperCase();
                                        return (
                                            t.startsWith(`OPTION ${targetLetter}`) ||
                                            t.startsWith(`${targetLetter}.`) ||
                                            t.startsWith(`${targetLetter})`) ||
                                            t.startsWith(`(${targetLetter})`) ||
                                            t === targetLetter
                                        );
                                    });
                                    if (found) {
                                        chosen = found;
                                        break;
                                    }
                                }
                            }

                            // Failover DOM search
                            if (!chosen && answerTexts.length > 0) {
                                for (const ans of answerTexts) {
                                    const cleanTarget = cleanStr(ans);
                                    if (!cleanTarget) continue;
                                    const matches = Array.from(document.querySelectorAll("div, span, button, label, li, [role='radio'], [role='option']"))
                                        .filter(el => !isNavOrSystem(el) && cleanStr(safeText(el)).includes(cleanTarget));
                                    if (matches.length > 0) {
                                        matches.sort((a, b) => safeText(a).length - safeText(b).length);
                                        chosen = { element: matches[0], text: ans };
                                        break;
                                    }
                                }
                            }

                            // Guaranteed Click Fallback: never leave an option unclicked when options exist!
                            if (!chosen && current.options.length > 0) {
                                if (answerIndices.length > 0 && current.options[answerIndices[0]]) {
                                    chosen = current.options[answerIndices[0]];
                                } else {
                                    chosen = current.options[0];
                                }
                                console.log(`[StepTest] Applied guaranteed option fallback: "${chosen.text}"`);
                            }

                            if (chosen && chosen.element) {
                                console.log(`[StepTest] Selecting Gemini Choice: "${chosen.text}"`);
                                await wait(600);
                                simulateClick(chosen.element);
                                showAnswerBanner(chosen.text, "Correct option selected on page", "MCQ Answer");
                                lastAnsweredQuestion = questionHash;
                            } else {
                                const answerLabel = answerTexts.join(", ") || "Option Identified";
                                showAnswerBanner(answerLabel, solution.explanation || "Correct answer identified", "Answer Pending");
                                lastAnsweredQuestion = questionHash;
                            }
                        }

                        isProcessing = false;
                        await randomWait(2000, 3500);
                    } else {
                        lastAnsweredQuestion = questionHash;
                    }
                }

                // 5. Handle Dropdowns (<select>) via Gemini
                const dropdowns = Array.from(document.querySelectorAll("select"))
                    .filter(s => !isNavOrSystem(s) && (s.value === "" || s.selectedIndex === 0));

                for (const sel of dropdowns) {
                    const optList = Array.from(sel.options).map((o, idx) => ({ index: idx, text: o.text, value: o.value }));
                    if (optList.length > 1) {
                        console.log("[StepTest] Found dropdown, consulting Gemini...");
                        const solution = await askGemini(
                            current.questionText,
                            optList.map(o => o.text),
                            current.fullContext,
                            "mcq"
                        );

                        if (solution && solution.selected_option) {
                            const matchOpt = optList.find(o => o.text.toLowerCase().includes(solution.selected_option.toLowerCase()));
                            if (matchOpt) sel.selectedIndex = matchOpt.index;
                            else sel.selectedIndex = 1;
                        } else {
                            sel.selectedIndex = 1;
                        }
                        sel.dispatchEvent(new Event("change", { bubbles: true }));
                        showAnswerBanner("Dropdown Option Selected", "", "Word Choice");
                        await wait(1000);
                    }
                }

                // 6. Handle Inputs & Textareas (Writing Questions) via Gemini
                const emptyInputs = Array.from(document.querySelectorAll('input[type="text"], textarea'))
                    .filter(el => !isNavOrSystem(el) && (el.value || "").trim() === "");

                for (const input of emptyInputs) {
                    console.log("[StepTest] Found empty text input, generating answer via Gemini...");
                    const writeSolution = await askGemini(current.questionText, [], current.fullContext, "writing");
                    const answer = writeSolution?.writing_answer || "Clear communication and structured ideas are essential for effective professional expression.";

                    setElementValue(input, answer);
                    showAnswerBanner(answer.slice(0, 90) + "...", "Answer typed into text area", "Writing Answer");
                    await randomWait(1500, 3000);
                }

                await wait(2000);
            } catch (e) {
                console.error("[StepTest Loop Error]:", e);
                await wait(6000);
            }
        }
    }

    // Launch automation after page initializes
    setTimeout(main, 2000);
})();
