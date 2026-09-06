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
                model: localStorage.getItem("GEMINI_WORKING_MODEL") || "gemini-2.0-flash",
                status: "active"
            });
            localStorage.setItem("GEMINI_API_KEYS", JSON.stringify(keys));
        }

        // Clean out burned / invalid keys
        keys = keys.filter(k => k && (typeof k === "string" ? k : k.key) && (typeof k === "string" ? k : k.key).trim() !== BURNT_KEY);
        // Normalize to objects
        keys = keys.map(k => typeof k === "string" ? { key: k.trim(), model: "gemini-2.0-flash", status: "active" } : k);

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
            "Model": k.model || "gemini-2.0-flash",
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

        return "gemini-3.6-flash";
    }

    // -------------------------------------------------------------
    // Answer Banner Display (Persists until moved to next question)
    // -------------------------------------------------------------
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
                width: min(580px, 92vw);
                background: rgba(15, 23, 42, 0.97);
                backdrop-filter: blur(20px);
                border: 2px solid #10b981;
                border-radius: 14px;
                box-shadow: 0 16px 40px rgba(0,0,0,0.75), 0 0 24px rgba(16,185,129,0.3);
                color: #f8fafc;
                padding: 14px 18px;
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                display: flex;
                flex-direction: column;
                gap: 6px;
                transition: all 0.25s ease;
            `;
            document.body.appendChild(banner);
        }

        banner.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(16,185,129,0.25); padding-bottom: 6px;">
                <span style="font-size: 12px; font-weight: 700; color: #34d399; text-transform: uppercase; letter-spacing: 0.5px;">🎯 ${typeTitle}</span>
                <button id="steptest-btn-close-banner" style="background: none; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 0 4px;">✕</button>
            </div>
            <div style="font-size: 18px; font-weight: 800; color: #ffffff; line-height: 1.4; word-break: break-word; text-shadow: 0 2px 8px rgba(0,0,0,0.5);">
                ${mainText}
            </div>
            ${subText ? `<div style="font-size: 12.5px; color: #cbd5e1;">${subText}</div>` : ''}
        `;

        banner.style.display = "flex";

        const closeBtn = document.getElementById("steptest-btn-close-banner");
        if (closeBtn) closeBtn.onclick = hideAnswerBanner;
    }

    function hideAnswerBanner() {
        const banner = document.getElementById("steptest-ai-banner");
        if (banner) banner.style.display = "none";
    }

    // Dismiss answer banner when moving to the next question
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("button, a, input[type='button'], input[type='submit']");
        if (btn && !btn.closest("#steptest-ai-banner")) {
            const txt = (btn.innerText || btn.value || "").trim().toLowerCase();
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

        if (taskType === "rearrange_sentence") {
            prompt = `You are an expert English proficiency exam solver. Solve this sentence/phrase rearrangement question with 100% accuracy.

QUESTION / PROMPT:
"""
${questionText}
"""

WORDS / PHRASES TO REARRANGE:
${JSON.stringify(options, null, 2)}

TASK:
- Rearrange the words/phrases into a coherent, grammatically correct sentence (in active voice if requested).
- Provide the 0-based index sequence of the tokens in "reordered_token_indices".
- Provide the ordered words in "reordered_token_texts".
- Provide the reconstructed full sentence in "reconstructed_sentence".

RESPONSE FORMAT:
Return ONLY a valid JSON object without markdown fences:
{
  "reordered_token_indices": [0, 1, 2],
  "reordered_token_texts": ["phrase1", "phrase2"],
  "reconstructed_sentence": "Full reconstructed sentence."
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
            prompt = `You are taking an English proficiency exam. Write a well-structured, fluent, and grammatically accurate answer.

QUESTION / TOPIC:
"""
${questionText}
"""

CONTEXT:
"""
${context || "None"}
"""

TASK:
- Write a natural, articulate, high-scoring response completely fulfilling all prompt requirements.
- Do not include greetings, boilerplate, or meta commentary.

RESPONSE FORMAT:
Return ONLY a valid JSON object without markdown fences:
{
  "writing_answer": "Your answer text here"
}
`;
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

    // Authentic click simulation
    function simulateClick(element) {
        if (!element) return;
        try { element.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        element.focus();

        const target = element.querySelector("input[type='radio'], input[type='checkbox']") || element;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
            target.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
        });

        try { target.click(); } catch (_) {}
        if (target !== element) {
            try { element.click(); } catch (_) {}
        }
    }

    // Filter out top navbar, header, progress bars, and unit titles
    function isNavOrSystem(el) {
        if (!el || el.closest("#steptest-ai-banner")) return true;
        if (el.closest("header, nav, footer, [class*='header' i], [class*='top-bar' i], [class*='navbar' i], [class*='progress' i]")) return true;
        const text = (el.innerText || "").trim().toLowerCase();
        return /^\d{1,3}%$/.test(text) || /^unit\s*\d+/i.test(text);
    }

    // Detect if current screen is a Sentence Rearrangement question
    function checkIsRearrangeQuestion() {
        const bodyText = (document.body ? document.body.innerText : "").toLowerCase();
        return (
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
            bodyText.includes("form a sentence") ||
            bodyText.includes("correct sequence") ||
            bodyText.includes("logical sequence") ||
            bodyText.includes("proper sequence") ||
            (Array.from(document.querySelectorAll("button, a, div[role='button']")).some(b => (b.innerText || "").trim().toLowerCase().startsWith("reset")) && (bodyText.includes("“") || bodyText.includes("\"") || bodyText.includes("sentence") || bodyText.includes("phrase")))
        );
    }

    // Extract clickable words/phrase chips for rearrange questions
    function findRearrangeTokens() {
        const tokens = [];
        const seen = new Set();

        function isValidChip(el) {
            if (!el || el.closest("header, nav, video, iframe, #steptest-ai-banner")) return false;
            const txt = el.innerText.trim();
            if (!txt || txt.length < 2 || txt.length > 450) return false;
            const lower = txt.toLowerCase();
            if (/^(reset|submit|next|replay|play|save|continue|grade)\b/i.test(lower)) return false;
            if (lower.startsWith("rearrange the words or phrases")) return false;
            if (lower.startsWith("arrange the following sentences")) return false;
            if (lower.startsWith("form a logical sentence")) return false;
            if (/^\d{1,2}:\d{2}/.test(lower)) return false;
            if (el.matches("button[type='submit'], input[type='submit']")) return false;
            if (txt.includes("“") && txt.includes("”")) return false;
            if (/^_{3,}$/.test(txt)) return false;
            return true;
        }

        function isLeafChip(el) {
            if (!isValidChip(el)) return false;
            return !Array.from(el.querySelectorAll("*")).some(ch => isValidChip(ch));
        }

        // Strategy 0: StepTest Rearrange Anchor to Reset Button
        const allLabels = Array.from(document.querySelectorAll("*")).filter(el => !isNavOrSystem(el));
        const matchingAnchors = allLabels.filter(el => {
            const t = el.innerText.trim().toLowerCase();
            return (
                t.includes("rearrange the words or phrases") ||
                t.includes("arrange the following sentences") ||
                t.includes("form a logical sentence") ||
                t.includes("rearrange the sentence")
            );
        });

        if (matchingAnchors.length > 0) {
            matchingAnchors.sort((a, b) => a.innerText.trim().length - b.innerText.trim().length);
            const anchor = matchingAnchors[0];

            const allElements = Array.from(document.querySelectorAll("*"));
            const anchorIdx = allElements.indexOf(anchor);

            const resetBtn = allElements.find(el => {
                if (isNavOrSystem(el)) return false;
                const txt = (el.innerText || "").trim().toLowerCase();
                return el.matches("button, div[role='button']") && txt.startsWith("reset");
            });
            const endIdx = resetBtn ? allElements.indexOf(resetBtn) : allElements.length;

            if (anchorIdx !== -1) {
                for (let i = anchorIdx + 1; i < endIdx; i++) {
                    const el = allElements[i];
                    if (isLeafChip(el) && !seen.has(el)) {
                        const t = el.innerText.trim();
                        if (!tokens.some(tok => tok.text === t)) {
                            seen.add(el);
                            tokens.push({ element: el, index: tokens.length, text: t });
                        }
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
                    tokens.push({ element: el, index: idx, text: el.innerText.trim() });
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
                    tokens.push({ element: el, index: idx, text: el.innerText.trim() });
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
            const t = el.innerText.trim();
            return /^\d+\.\s+[A-Z]/i.test(t) || /^question\s*\d+/i.test(t);
        });
        if (promptEl) {
            questionText = promptEl.innerText.trim();
        }

        // 2. Extract clean context (stripping video timestamps & player labels)
        let fullContext = "";
        const mainArea = document.querySelector("main, #content, .test-container, .question-container") || document.body;
        try {
            const clone = mainArea.cloneNode(true);
            clone.querySelectorAll("header, nav, footer, video, iframe, [class*='header' i], [class*='top-bar' i], [class*='progress' i], #steptest-ai-banner").forEach(n => n.remove());
            let txt = clone.innerText || "";
            txt = txt.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "");
            txt = txt.replace(/\b\d+\s+of\s+\d+\s+questions\b/gi, "");
            fullContext = txt.replace(/\s+/g, " ").trim();
        } catch (_) {
            fullContext = "";
        }

        if (!questionText) {
            questionText = fullContext;
        }

        // 3. Check if Sentence Rearrangement Question
        const isRearrange = checkIsRearrangeQuestion() || /rearrange/i.test(questionText);
        let sentenceTokens = [];
        if (isRearrange) {
            sentenceTokens = findRearrangeTokens();
        }

        // 4. Locate Options (Disabled for rearrange questions)
        const options = [];
        if (!isRearrange) {
            const matchingAnchors = allHeadings.filter(el => {
                const txt = (el.innerText || "").trim().toLowerCase();
                return txt.includes("select the best answer") ||
                       txt.includes("choose the correct") ||
                       txt.includes("select the following") ||
                       txt.includes("choose the best") ||
                       txt.includes("select correct");
            });

            if (matchingAnchors.length > 0) {
                matchingAnchors.sort((a, b) => a.innerText.trim().length - b.innerText.trim().length);
                const anchor = matchingAnchors[0];

                // A. Check siblings directly following this anchor
                let next = anchor.nextElementSibling;
                while (next && options.length < 10) {
                    if (!isNavOrSystem(next)) {
                        const txt = next.innerText.trim();
                        if (next.matches("button, input[type='submit']") || /^(submit|next|save|continue)\b/i.test(txt)) {
                            break;
                        }
                        const children = Array.from(next.children).filter(ch => !isNavOrSystem(ch) && ch.innerText.trim().length > 0);
                        if (children.length >= 2 && children.length <= 10) {
                            children.forEach((c, idx) => {
                                options.push({ element: c, index: idx, text: c.innerText.trim() });
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
                            const pTxt = parentNext.innerText.trim();
                            if (parentNext.matches("button, input[type='submit']") || /^(submit|next|save|continue)\b/i.test(pTxt)) {
                                break;
                            }
                            const children = Array.from(parentNext.children).filter(ch => !isNavOrSystem(ch) && ch.innerText.trim().length > 0);
                            if (children.length >= 2 && children.length <= 10) {
                                children.forEach((c, idx) => {
                                    options.push({ element: c, index: idx, text: c.innerText.trim() });
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
                        options.push({ element: inp, index: idx, text: label ? label.innerText.trim() : inp.value });
                    });
                }
            }

            if (options.length === 0) {
                const choiceEls = Array.from(document.querySelectorAll("[class*='option' i], [class*='choice' i], [role='radio']"))
                    .filter(el => !isNavOrSystem(el) && el.innerText.trim().length > 0 && el.innerText.trim().length < 450 && !/^(submit|next|save|continue)\b/i.test(el.innerText.trim()));
                if (choiceEls.length >= 2 && choiceEls.length <= 10) {
                    choiceEls.forEach((el, idx) => {
                        options.push({ element: el, index: idx, text: el.innerText.trim() });
                    });
                }
            }
        }

        return {
            type: isRearrange || sentenceTokens.length >= 3 ? "rearrange_sentence" : "mcq",
            questionText,
            fullContext,
            options,
            sentenceTokens
        };
    }

    // Check if question is already answered on screen (Token-Saver)
    function isQuestionAlreadyAnswered(current) {
        if (current.type === "rearrange_sentence") {
            const slots = document.querySelectorAll("[class*='slot' i], [class*='blank' i], [class*='drop' i]");
            if (slots.length > 0) {
                const filled = Array.from(slots).filter(s => s.innerText.trim().length > 0);
                if (filled.length >= 3) return true;
            }
        }

        const checkedInput = document.querySelector("input[type='radio']:checked, input[type='checkbox']:checked");
        if (checkedInput) return true;

        const activeCard = document.querySelector("[class*='selected' i], [class*='active' i], [aria-checked='true']");
        if (activeCard && !activeCard.closest("#steptest-ai-banner")) return true;

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

                // 2. Scan Current Question
                const current = scanPageForQuestion();
                const cleanPrompt = current.questionText.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "").replace(/\s+/g, " ").trim();
                const itemsKey = (current.options.length ? current.options : current.sentenceTokens).map(o => o.text).join('|');
                const questionHash = `${current.type}::${cleanPrompt}::${itemsKey}`;

                // 3. Handle Sentence / Phrase Rearrangement Questions via Gemini
                if (current.type === "rearrange_sentence" && current.sentenceTokens.length >= 3 && questionHash !== lastAnsweredQuestion && !isProcessing) {
                    if (!isQuestionAlreadyAnswered(current)) {
                        isProcessing = true;
                        hideAnswerBanner(); // Dismiss previous banner on new question

                        console.log(`[StepTest] Solving Rearrange Question: "${cleanPrompt.slice(0, 60)}..."`);
                        console.log("[StepTest] Phrase Chips:", current.sentenceTokens.map(t => t.text));

                        const solution = await askGemini(
                            current.questionText,
                            current.sentenceTokens.map(t => t.text),
                            current.fullContext,
                            "rearrange_sentence"
                        );

                        if (solution) {
                            console.log("[StepTest] Gemini Rearrange Solution:", solution);

                            let orderedChips = [];
                            if (Array.isArray(solution.reordered_token_indices) && solution.reordered_token_indices.length > 0) {
                                orderedChips = solution.reordered_token_indices.map(idx => current.sentenceTokens[idx]).filter(Boolean);
                            }

                            if (orderedChips.length === 0 && Array.isArray(solution.reordered_token_texts) && solution.reordered_token_texts.length > 0) {
                                const remaining = [...current.sentenceTokens];
                                for (const targetWord of solution.reordered_token_texts) {
                                    const cleanTarget = targetWord.replace(/['".,]/g, "").trim().toLowerCase();
                                    const matchIdx = remaining.findIndex(t => {
                                        const cleanToken = t.text.replace(/['".,]/g, "").trim().toLowerCase();
                                        return cleanToken === cleanTarget || cleanToken.includes(cleanTarget) || cleanTarget.includes(cleanToken);
                                    });
                                    if (matchIdx !== -1) {
                                        orderedChips.push(remaining[matchIdx]);
                                        remaining.splice(matchIdx, 1);
                                    }
                                }
                            }

                            // Sequentially click the chips in order
                            for (const chip of orderedChips) {
                                simulateClick(chip.element);
                                await wait(260);
                            }

                            const resultSentence = solution.reconstructed_sentence || orderedChips.map(c => c.text).join(" ");
                            showAnswerBanner(resultSentence, "Rearranged into active voice sentence", "Sentence Rearranged");
                            lastAnsweredQuestion = questionHash;
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
                            if (solution.selected_option) {
                                const cleanTarget = solution.selected_option.replace(/\s+/g, "").toLowerCase();
                                chosen = current.options.find(o => {
                                    const cleanOpt = o.text.replace(/\s+/g, "").toLowerCase();
                                    return cleanOpt === cleanTarget || cleanOpt.includes(cleanTarget) || cleanTarget.includes(cleanOpt);
                                });
                            }

                            if (!chosen && typeof solution.selected_index === "number" && current.options[solution.selected_index]) {
                                chosen = current.options[solution.selected_index];
                            }

                            if (!chosen && solution.selected_option) {
                                const cleanTarget = solution.selected_option.trim().toLowerCase();
                                const matches = Array.from(document.querySelectorAll("div, span, button, label, li"))
                                    .filter(el => !isNavOrSystem(el) && el.innerText.trim().toLowerCase() === cleanTarget);
                                if (matches.length > 0) {
                                    matches.sort((a, b) => a.innerText.length - b.innerText.length);
                                    chosen = { element: matches[0], text: solution.selected_option };
                                }
                            }

                            if (chosen && chosen.element) {
                                console.log(`[StepTest] Selecting Gemini Choice: "${chosen.text}"`);
                                await wait(600);
                                simulateClick(chosen.element);
                                showAnswerBanner(chosen.text, "Correct option selected on page", "MCQ Answer");
                                lastAnsweredQuestion = questionHash;
                            } else {
                                simulateClick(current.options[0].element);
                                showAnswerBanner(current.options[0].text, "Option selected", "MCQ Answer");
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
                    .filter(el => !isNavOrSystem(el) && el.value.trim() === "");

                for (const input of emptyInputs) {
                    console.log("[StepTest] Found empty text input, generating answer via Gemini...");
                    const writeSolution = await askGemini(current.questionText, [], current.fullContext, "writing");
                    const answer = writeSolution?.writing_answer || "Clear communication and structured ideas are essential for effective professional expression.";

                    await typeHumanly(input, answer);
                    showAnswerBanner(answer.slice(0, 90) + "...", "Answer typed into text area", "Writing Answer");
                    await randomWait(1500, 3000);
                }

                // 7. Handle Navigation (Next / Submit / Continue)
                const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'))
                    .filter(btn => !isNavOrSystem(btn) && !btn.disabled && !isProcessing);

                for (const btn of buttons) {
                    const text = (btn.innerText || btn.value || "").trim().toLowerCase();
                    const isNavBtn = (
                        text.includes('next') ||
                        text.includes('submit') ||
                        text.includes('continue') ||
                        text === 'save & next'
                    );

                    if (isNavBtn) {
                        const readyToAdvance = isQuestionAlreadyAnswered(current) || questionHash === lastAnsweredQuestion;

                        if (readyToAdvance) {
                            console.log(`[StepTest] Advancing: Clicking "${text}"`);
                            await randomWait(2500, 4500);
                            btn.click();
                            // Banner automatically closes when moving to the next question
                            setTimeout(hideAnswerBanner, 600);
                            await randomWait(3000, 5000);
                            break;
                        }
                    }
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
