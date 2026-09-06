// content.js - Live On-Screen Question Solver & Assistant Engine

(function () {
  "use strict";

  // Prevent multiple injections
  if (window.__GEMINI_SOLVER_INJECTED__) return;
  window.__GEMINI_SOLVER_INJECTED__ = true;

  // Global State
  const state = {
    isEnabled: true,
    isAutoWatch: false,
    isProcessing: false,
    lastSolvedHash: "",
    lastSolvedQuestionId: "",
    solvedQuestionIds: new Set(),
    lastSolveTimestamp: 0,
    typingDelayMs: 250,
    hudMinimized: false,
    observer: null,
    bannerTimer: null
  };

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // -------------------------------------------------------------
  // 1. UI Initialization: Floating Widget & Teleprompter
  // -------------------------------------------------------------
  async function initHUD() {
    if (document.getElementById("gemini-live-host")) return;

    // Load enabled state from storage
    const stored = await chrome.storage.local.get(["extensionEnabled", "typingDelayMs"]);
    if (stored.extensionEnabled !== undefined) {
      state.isEnabled = stored.extensionEnabled;
    }
    if (stored.typingDelayMs !== undefined) {
      state.typingDelayMs = stored.typingDelayMs;
    }

    const host = document.createElement("div");
    host.id = "gemini-live-host";
    if (!state.isEnabled) {
      host.classList.add("power-off");
      host.style.display = "none";
    }

    host.innerHTML = `
      <!-- Floating Main Controller -->
      <div id="gemini-widget" class="gemini-widget ${state.isEnabled ? '' : 'power-off'}">
        <div id="gemini-drag-header" class="gemini-widget-header">
          <div class="gemini-brand">
            <svg class="gemini-sparkle-icon" viewBox="0 0 24 24">
              <defs>
                <linearGradient id="gemini-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#818cf8"/>
                  <stop offset="100%" stop-color="#38bdf8"/>
                </linearGradient>
              </defs>
              <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="url(#gemini-gradient)"/>
            </svg>
            <span>Gemini Live</span>
          </div>
          <div class="gemini-header-actions">
            <button id="gemini-btn-power" class="gemini-icon-btn power-btn ${state.isEnabled ? '' : 'off'}" title="${state.isEnabled ? 'Turn Extension OFF (Completely Hides UI)' : 'Turn Extension ON'}">
              ⏻
            </button>
            <button id="gemini-btn-minimize" class="gemini-icon-btn" title="Minimize/Expand">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
        </div>

        <div class="gemini-widget-body">
          <div class="gemini-status-bar">
            <div class="gemini-status-indicator">
              <div id="gemini-pulse-dot" class="gemini-pulse-dot"></div>
              <span id="gemini-status-text">${state.isEnabled ? 'Ready' : 'Paused (OFF)'}</span>
            </div>
            <span id="gemini-type-badge" class="gemini-question-badge">${state.isEnabled ? 'IDLE' : 'OFF'}</span>
          </div>

          <div class="gemini-button-group">
            <button id="gemini-btn-solve" class="gemini-btn-primary" ${state.isEnabled ? '' : 'disabled'}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
              <span>Solve Current (Alt+S)</span>
            </button>

            <div class="gemini-btn-secondary" id="gemini-toggle-container">
              <span>Auto-Solve Next Question</span>
              <label class="gemini-switch">
                <input type="checkbox" id="gemini-autowatch-toggle">
                <span class="gemini-slider"></span>
              </label>
            </div>
          </div>

          <div id="gemini-info-box" class="gemini-info-box"></div>
        </div>
      </div>

      <!-- Large 5-Second Answer Showcase Banner -->
      <div id="gemini-answer-banner" class="gemini-answer-banner">
        <div class="gemini-answer-banner-header">
          <div class="gemini-answer-tag">
            <span>🎯</span>
            <span id="gemini-answer-type-title">Correct Answer</span>
          </div>
          <button id="gemini-btn-close-answer" class="gemini-icon-btn" title="Dismiss">✕</button>
        </div>
        <div class="gemini-answer-banner-body">
          <div id="gemini-answer-main-text" class="gemini-answer-main-text"></div>
          <div id="gemini-answer-sub-text" class="gemini-answer-sub-text"></div>
        </div>
        <div class="gemini-answer-progress">
          <div id="gemini-answer-progress-bar" class="gemini-answer-progress-bar"></div>
        </div>
      </div>

      <!-- Speaking Teleprompter Overlay -->
      <div id="gemini-teleprompter" class="gemini-teleprompter-overlay">
        <div class="gemini-teleprompter-header">
          <div class="gemini-teleprompter-title">
            <span>🎙️ Speaking Teleprompter</span>
            <span class="gemini-teleprompter-badge">Ready to Read</span>
          </div>
          <div class="gemini-header-actions">
            <button id="gemini-btn-copy-speech" class="gemini-btn-copy">Copy Text</button>
            <button id="gemini-btn-close-speech" class="gemini-icon-btn" title="Close Teleprompter">✕</button>
          </div>
        </div>
        <div id="gemini-dropdown-notice" class="gemini-dropdown-auto-notice" style="display: none;">
          <span>✓ Dropdown option was automatically selected for this question</span>
        </div>
        <div class="gemini-teleprompter-body">
          <div id="gemini-speech-content" class="gemini-speech-text"></div>
        </div>
        <div class="gemini-teleprompter-footer">
          <span id="gemini-speech-notes" class="gemini-teleprompter-notes">Speak clearly with natural pacing.</span>
          <span id="gemini-speech-meta">~0 words</span>
        </div>
      </div>

      <!-- Floating Toast -->
      <div id="gemini-toast" class="gemini-toast">
        <span id="gemini-toast-msg">Notification</span>
      </div>
    `;

    document.body.appendChild(host);
    bindHUDEvents();
    makeDraggable(document.getElementById("gemini-widget"), document.getElementById("gemini-drag-header"));
  }

  // -------------------------------------------------------------
  // 2. HUD Event Handlers & Draggable Implementation
  // -------------------------------------------------------------
  function bindHUDEvents() {
    const btnSolve = document.getElementById("gemini-btn-solve");
    const toggleAuto = document.getElementById("gemini-autowatch-toggle");
    const btnMinimize = document.getElementById("gemini-btn-minimize");
    const widget = document.getElementById("gemini-widget");
    const btnCloseSpeech = document.getElementById("gemini-btn-close-speech");
    const btnCopySpeech = document.getElementById("gemini-btn-copy-speech");
    const btnPower = document.getElementById("gemini-btn-power");
    const btnCloseAnswer = document.getElementById("gemini-btn-close-answer");

    btnPower.addEventListener("click", () => {
      toggleExtensionPower(!state.isEnabled);
    });

    if (btnCloseAnswer) {
      btnCloseAnswer.addEventListener("click", () => {
        const banner = document.getElementById("gemini-answer-banner");
        if (banner) {
          banner.classList.remove("show", "animating");
          clearTimeout(state.bannerTimer);
        }
      });
    }

    btnSolve.addEventListener("click", () => {
      if (!state.isEnabled) return;
      triggerSolve(false);
    });

    toggleAuto.addEventListener("change", (e) => {
      if (!state.isEnabled) {
        e.target.checked = false;
        showToast("Enable extension first");
        return;
      }
      state.isAutoWatch = e.target.checked;
      showToast(state.isAutoWatch ? "Auto-Solve Loop Activated" : "Auto-Solve Loop Paused");
      if (state.isAutoWatch) {
        startAutoWatcher();
        triggerSolve(true);
      } else {
        stopAutoWatcher();
      }
    });

    btnMinimize.addEventListener("click", () => {
      state.hudMinimized = !state.hudMinimized;
      widget.classList.toggle("minimized", state.hudMinimized);
    });

    btnCloseSpeech.addEventListener("click", () => {
      document.getElementById("gemini-teleprompter").classList.remove("active");
    });

    btnCopySpeech.addEventListener("click", () => {
      const text = document.getElementById("gemini-speech-content").innerText;
      navigator.clipboard.writeText(text).then(() => {
        showToast("Speech text copied to clipboard!");
      });
    });
  }

  function toggleExtensionPower(enabled) {
    state.isEnabled = enabled;
    const host = document.getElementById("gemini-live-host");
    const widget = document.getElementById("gemini-widget");
    const btnPower = document.getElementById("gemini-btn-power");
    const btnSolve = document.getElementById("gemini-btn-solve");

    if (host) {
      host.classList.toggle("power-off", !enabled);
      host.style.display = enabled ? "block" : "none";
    }
    if (widget) {
      widget.classList.toggle("power-off", !enabled);
    }
    if (btnPower) {
      btnPower.classList.toggle("off", !enabled);
      btnPower.title = enabled ? "Turn Extension OFF (Completely Hides UI)" : "Turn Extension ON";
    }
    if (btnSolve) {
      btnSolve.disabled = !enabled;
    }

    if (!enabled) {
      stopAutoWatcher();
      hideAnswerBanner();
      const teleprompter = document.getElementById("gemini-teleprompter");
      if (teleprompter) teleprompter.classList.remove("active");

      const autoToggle = document.getElementById("gemini-autowatch-toggle");
      if (autoToggle) autoToggle.checked = false;
      state.isAutoWatch = false;

      updateStatus("Paused (OFF)", "idle", "OFF");
    } else {
      updateStatus("Ready", "idle", "IDLE");
      showToast("Extension Enabled (ON)");
    }

    chrome.storage.local.set({ extensionEnabled: enabled });
  }

  // Smooth 1:1 Instant Mouse Dragging (No Lag, No Resistance)
  function makeDraggable(el, handle) {
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest("label")) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;

      // Disable transition and fix right/left conflict immediately
      el.classList.add("gemini-dragging");
      el.style.transition = "none";
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.left = `${initialLeft}px`;
      el.style.top = `${initialTop}px`;

      function onMouseMove(moveEvent) {
        moveEvent.preventDefault();
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        const newLeft = Math.max(10, Math.min(window.innerWidth - el.offsetWidth - 10, initialLeft + deltaX));
        const newTop = Math.max(10, Math.min(window.innerHeight - el.offsetHeight - 10, initialTop + deltaY));

        el.style.left = `${newLeft}px`;
        el.style.top = `${newTop}px`;
      }

      function onMouseUp() {
        el.classList.remove("gemini-dragging");
        el.style.transition = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }

      document.addEventListener("mousemove", onMouseMove, { passive: false });
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  // Answer Showcase Banner (Persists until moved to the next question)
  function showAnswerBanner(mainText, subText = "", typeTitle = "Correct Answer") {
    const banner = document.getElementById("gemini-answer-banner");
    const mainEl = document.getElementById("gemini-answer-main-text");
    const subEl = document.getElementById("gemini-answer-sub-text");
    const typeEl = document.getElementById("gemini-answer-type-title");
    const progBar = document.getElementById("gemini-answer-progress-bar");

    if (!banner || !mainEl) return;

    if (state.bannerTimer) {
      clearTimeout(state.bannerTimer);
      state.bannerTimer = null;
    }

    mainEl.innerText = mainText;
    if (subEl) {
      subEl.innerText = subText;
      subEl.style.display = subText ? "block" : "none";
    }
    if (typeEl) typeEl.innerText = typeTitle;

    // Keep persistent until moved to the next question (no auto-vanish)
    if (progBar) {
      progBar.style.display = "none";
    }

    banner.classList.remove("animating");
    banner.classList.add("show");
  }

  function hideAnswerBanner() {
    const banner = document.getElementById("gemini-answer-banner");
    if (banner) {
      banner.classList.remove("show", "animating");
    }
    if (state.bannerTimer) {
      clearTimeout(state.bannerTimer);
      state.bannerTimer = null;
    }
  }

  function updateStatus(status, type = "working", badge = "SCANNING") {
    const statusText = document.getElementById("gemini-status-text");
    const pulseDot = document.getElementById("gemini-pulse-dot");
    const typeBadge = document.getElementById("gemini-type-badge");

    if (statusText) statusText.innerText = status;
    if (typeBadge) typeBadge.innerText = badge;

    if (pulseDot) {
      pulseDot.className = "gemini-pulse-dot";
      if (type === "working") pulseDot.classList.add("working");
      else if (type === "error") pulseDot.classList.add("error");
    }
  }

  function showToast(message) {
    const toast = document.getElementById("gemini-toast");
    const toastMsg = document.getElementById("gemini-toast-msg");
    if (!toast || !toastMsg) return;
    toastMsg.innerText = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3500);
  }

  function showInfo(infoText) {
    const box = document.getElementById("gemini-info-box");
    if (!box) return;
    if (infoText) {
      box.innerText = infoText;
      box.classList.add("visible");
    } else {
      box.classList.remove("visible");
    }
  }

  // -------------------------------------------------------------
  // 3. Question Detection & DOM Parsing Engine
  // -------------------------------------------------------------
  function isNavOrSystem(el) {
    if (!el || el.closest("#gemini-live-host")) return true;

    // Strictly exclude headers, navbars, progress indicators, breadcrumbs, footers
    if (el.closest("header, nav, footer, aside, [class*='header' i], [class*='top-bar' i], [class*='topbar' i], [class*='navbar' i], [class*='progress' i], [class*='breadcrumb' i]")) {
      return true;
    }

    const text = (el.innerText || "").trim().toLowerCase();
    // Exclude progress percentages (e.g. "0%", "100%")
    if (/^\d{1,3}%$/.test(text)) return true;
    // Exclude unit titles or course navigation headers (e.g. "Unit 4Structure your paragraph")
    if (/^unit\s*\d+/i.test(text)) return true;
    if (/^level\s*\d+/i.test(text)) return true;

    const excludedWords = ["submit", "next", "previous", "prev", "skip", "continue", "review", "grade", "save & next", "clear", "cancel", "done"];
    if (excludedWords.includes(text)) return true;
    if (/^\d+\s+of\s+\d+/i.test(text)) return true;

    return false;
  }

  function findActiveQuestionContainer() {
    const focused = document.activeElement;
    if (focused && focused !== document.body && !focused.closest("#gemini-live-host, header, nav, [class*='header' i], [class*='top-bar' i]")) {
      const container = focused.closest(".question, .question-card, .quiz-question, .exercise, [role='region'], fieldset, form, main, .test-container");
      if (container) return container;
    }

    // Look for question prompt element with numbering (e.g. "1. Rearrange...", "Question 1")
    const numberedHeaders = Array.from(document.querySelectorAll("h1, h2, h3, h4, p, div, span")).filter(el => {
      if (!isElementVisible(el) || isNavOrSystem(el)) return false;
      const t = el.innerText.trim();
      return /^\d+\.\s+[A-Z]/i.test(t) || /^question\s*\d+/i.test(t);
    });

    if (numberedHeaders.length > 0) {
      let current = numberedHeaders[0];
      while (current && current.parentElement && current.parentElement !== document.body) {
        if (
          current.parentElement.innerText.includes("Select the best answer") ||
          current.parentElement.innerText.includes("Select the correct") ||
          current.parentElement.querySelector("button, input[type='radio'], [class*='option' i]")
        ) {
          return current.parentElement;
        }
        current = current.parentElement;
      }
      if (current) return current;
    }

    const candidateSelectors = [
      "main", "#content", ".test-container", ".question-container",
      ".question.active", ".active-question", ".current-question",
      ".question-card", ".question", ".quiz-card", ".exercise", "form",
      "[data-question]:not([style*='display: none'])"
    ];

    for (const selector of candidateSelectors) {
      const matches = document.querySelectorAll(selector);
      for (const el of matches) {
        if (isElementVisible(el) && !el.closest("#gemini-live-host, header, nav, [class*='header' i], [class*='top-bar' i]")) {
          return el;
        }
      }
    }

    return document.body;
  }

  function isElementVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    // Element must have dimensions in DOM (rendered, not collapsed)
    const rect = el.getBoundingClientRect();
    return (
      rect.width > 0 ||
      rect.height > 0 ||
      el.offsetWidth > 0 ||
      el.offsetHeight > 0 ||
      el.getClientRects().length > 0
    );
  }

  // Check if current question is a Sentence / Phrase Rearrangement question
  function checkIsRearrangeQuestion(container) {
    const checkText = ((container ? container.innerText : "") + " " + (document.body ? document.body.innerText : "")).toLowerCase();
    if (
      checkText.includes("rearrange the phrases") ||
      checkText.includes("rearrange the words") ||
      checkText.includes("rearrange words") ||
      checkText.includes("rearrange phrases") ||
      checkText.includes("rearrange the sentence") ||
      checkText.includes("arrange the following sentences") ||
      checkText.includes("arrange the sentences") ||
      checkText.includes("arrange sentences") ||
      checkText.includes("arrange the words") ||
      checkText.includes("arrange the phrases") ||
      checkText.includes("form a logical sentence") ||
      checkText.includes("form a sentence") ||
      checkText.includes("correct sequence") ||
      checkText.includes("logical sequence") ||
      checkText.includes("proper sequence")
    ) {
      return true;
    }

    const hasResetBtn = Array.from(document.querySelectorAll("button, a, input[type='button'], div[role='button']"))
      .some(b => !isNavOrSystem(b) && (b.innerText || b.value || "").trim().toLowerCase().startsWith("reset"));
    if (hasResetBtn && (checkText.includes("“") || checkText.includes("\"") || checkText.includes("active voice") || checkText.includes("passive voice") || checkText.includes("sentence") || checkText.includes("phrase"))) {
      return true;
    }

    return false;
  }

  // Extract scrambled tokens / chips for sentence rearrangement
  function findRearrangeTokens(container) {
    const tokens = [];
    const seen = new Set();
    const scope = (container && container !== document.body && container.querySelectorAll("*").length > 5) ? container : document.body;

    function isValidChip(el) {
      if (!el || !isElementVisible(el) || el.closest("#gemini-live-host, header, nav, video, iframe, .ytp-chrome-bottom")) return false;
      const txt = el.innerText.trim();
      if (!txt || txt.length < 2 || txt.length > 450) return false;
      const lower = txt.toLowerCase();
      if (/^(reset|submit|next|replay|play|save|continue|grade)\b/i.test(lower)) return false;
      if (lower.startsWith("rearrange the words or phrases")) return false;
      if (lower.startsWith("arrange the following sentences")) return false;
      if (lower.startsWith("form a logical sentence")) return false;
      if (/^\d{1,2}:\d{2}/.test(lower)) return false; // timecode
      if (el.matches("button[type='submit'], input[type='submit']")) return false;
      if (txt.includes("“") && txt.includes("”")) return false; // slot container
      if (/^_{3,}$/.test(txt)) return false; // slot lines
      return true;
    }

    // Leaf chip filter: avoid picking outer wrappers if inner children are valid chips
    function isLeafChip(el) {
      if (!isValidChip(el)) return false;
      const hasChipChild = Array.from(el.querySelectorAll("*")).some(ch => isValidChip(ch));
      return !hasChipChild;
    }

    // Strategy 0: Find instruction anchor ("rearrange the words or phrases", "arrange the following sentences", etc.)
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
      // Pick the leaf anchor (shortest text length)
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
              tokens.push({
                element: el,
                index: tokens.length,
                id: `token_${tokens.length}`,
                text: t
              });
            }
          }
        }
        if (tokens.length >= 3) return tokens;
      }
    }

    // Strategy A: Direct container holding 3 to 15 leaf chips
    const candidateContainers = Array.from(scope.querySelectorAll("div, ul, section, ol")).filter(p => {
      if (!isElementVisible(p) || p.closest("#gemini-live-host, header, nav, video, iframe")) return false;
      const leafChips = Array.from(p.querySelectorAll("*")).filter(isLeafChip);
      return leafChips.length >= 3 && leafChips.length <= 15;
    });

    if (candidateContainers.length > 0) {
      candidateContainers.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
      const bestContainer = candidateContainers[0];
      Array.from(bestContainer.querySelectorAll("*")).filter(isLeafChip).forEach(el => {
        const t = el.innerText.trim();
        if (!seen.has(el) && !tokens.some(tok => tok.text === t)) {
          seen.add(el);
          tokens.push({
            element: el,
            index: tokens.length,
            id: `token_${tokens.length}`,
            text: t
          });
        }
      });
      if (tokens.length >= 3) return tokens;
    }

    // Strategy B: Known chip / phrase classes
    const chipSelectors = [
      ".word-chip", ".sentence-token", ".draggable-word", ".sortable-item",
      ".word-tile", "[data-word]", "[class*='phrase' i]", "[class*='chip' i]",
      "[class*='token' i]", "[class*='badge' i]", ".btn-phrase", ".pill",
      "[class*='sentence' i]", "[class*='block' i]", "[class*='tile' i]"
    ];
    for (const sel of chipSelectors) {
      const found = Array.from(scope.querySelectorAll(sel)).filter(isLeafChip);
      if (found.length >= 3 && found.length <= 15) {
        found.forEach((el) => {
          const t = el.innerText.trim();
          if (!seen.has(el) && !tokens.some(tok => tok.text === t)) {
            seen.add(el);
            tokens.push({ element: el, index: tokens.length, id: `token_${tokens.length}`, text: t });
          }
        });
        if (tokens.length >= 3) return tokens;
      }
    }

    // Strategy C: Fallback to document.body
    if (tokens.length === 0 && scope !== document.body) {
      return findRearrangeTokens(document.body);
    }

    return tokens;
  }

  // Dedicated multi-strategy MCQ option finder
  // Dedicated multi-strategy MCQ option finder
  function findMCQOptions(container) {
    // CRITICAL: If this is a sentence rearrangement question, DO NOT hijack chips as MCQ options!
    if (checkIsRearrangeQuestion(container)) {
      return [];
    }

    const options = [];
    const seenElements = new Set();

    function addOption(el, text) {
      if (!el || seenElements.has(el) || isNavOrSystem(el)) return;
      const cleaned = (text || el.innerText || "").trim();
      if (!cleaned || cleaned.length < 2) return;
      // Do not add navigation / submit buttons as options
      if (/^(submit|next|save|continue|reset|replay|review)\b/i.test(cleaned)) return;
      if (el.matches("button[type='submit'], input[type='submit']")) return;

      seenElements.add(el);
      options.push({
        element: el,
        index: options.length,
        id: el.id || `opt_${options.length}`,
        text: cleaned
      });
    }

    // Strategy 1 (Highest Confidence): Contextual phrase anchor ("Select the best answer", "Choose the correct", etc.)
    const allElements = Array.from(container.querySelectorAll("*")).filter(el => !isNavOrSystem(el));
    const matchingAnchors = allElements.filter(el => {
      const txt = (el.innerText || "").trim().toLowerCase();
      return (
        txt.includes("select the best answer") ||
        txt.includes("choose the correct") ||
        txt.includes("select the following") ||
        txt.includes("choose the best") ||
        txt.includes("select correct")
      );
    });

    if (matchingAnchors.length > 0) {
      // Pick the leaf/most specific anchor element (shortest text)
      matchingAnchors.sort((a, b) => a.innerText.trim().length - b.innerText.trim().length);
      const anchor = matchingAnchors[0];

      // A. Check sibling elements directly following this anchor
      let nextEl = anchor.nextElementSibling;
      while (nextEl && options.length < 10) {
        if (!isNavOrSystem(nextEl)) {
          const txt = nextEl.innerText.trim();
          if (nextEl.matches("button, input[type='submit']") || /^(submit|next|save|continue)\b/i.test(txt)) {
            break;
          }
          const children = Array.from(nextEl.children).filter(ch => isElementVisible(ch) && !isNavOrSystem(ch));
          if (children.length >= 2 && children.length <= 10) {
            children.forEach(ch => addOption(ch, ch.innerText));
            break;
          } else if (txt.length > 0 && txt.length < 450) {
            addOption(nextEl, txt);
          }
        }
        nextEl = nextEl.nextElementSibling;
      }

      // B. If not enough options found, check anchor's parent's siblings
      if (options.length < 2 && anchor.parentElement) {
        let parentNext = anchor.parentElement.nextElementSibling;
        while (parentNext && options.length < 10) {
          if (!isNavOrSystem(parentNext)) {
            const pTxt = parentNext.innerText.trim();
            if (parentNext.matches("button, input[type='submit']") || /^(submit|next|save|continue)\b/i.test(pTxt)) {
              break;
            }
            const children = Array.from(parentNext.children).filter(ch => isElementVisible(ch) && !isNavOrSystem(ch));
            if (children.length >= 2 && children.length <= 10) {
              children.forEach(ch => addOption(ch, ch.innerText));
              break;
            } else if (pTxt.length > 0 && pTxt.length < 450) {
              addOption(parentNext, pTxt);
            }
          }
          parentNext = parentNext.nextElementSibling;
        }
      }

      if (options.length >= 2) return options;
    }

    // Strategy 2: Standard radio/checkbox inputs
    const inputs = Array.from(container.querySelectorAll("input[type='radio'], input[type='checkbox']"))
      .filter(i => isElementVisible(i) && !isNavOrSystem(i));

    if (inputs.length >= 2) {
      inputs.forEach(input => {
        let text = "";
        const label = input.id ? container.querySelector(`label[for='${input.id}']`) : null;
        if (label) text = label.innerText.trim();
        else {
          const parent = input.closest("label") || input.parentElement;
          text = parent ? parent.innerText.trim() : input.value;
        }
        addOption(input, text);
      });
      if (options.length >= 2) return options;
    }

    // Strategy 3: Common CSS class selectors for quiz options
    const optionSelectors = [
      "[class*='option' i]",
      "[class*='choice' i]",
      "[class*='answer' i]",
      "[class*='ans' i]",
      "[class*='radio' i]",
      "[role='radio']",
      "[role='checkbox']",
      "[role='option']",
      ".mat-radio-button",
      "mat-radio-button",
      ".custom-control"
    ];

    for (const sel of optionSelectors) {
      const candidates = Array.from(container.querySelectorAll(sel)).filter(el => {
        if (!isElementVisible(el) || isNavOrSystem(el)) return false;
        const txt = el.innerText.trim();
        return txt.length > 0 && txt.length < 450 && !/^(submit|next|save|continue)\b/i.test(txt);
      });

      if (candidates.length >= 2 && candidates.length <= 10) {
        candidates.forEach(c => addOption(c, c.innerText));
        if (options.length >= 2) return options;
      }
    }

    // Strategy 4: Sibling card cluster detection (Strictly in non-navigation elements)
    const parentContainers = Array.from(container.querySelectorAll("div, ul, ol, section, fieldset")).filter(
      p => !isNavOrSystem(p) && !p.closest("header, nav, [class*='header' i], [class*='top-bar' i]")
    );

    for (const p of parentContainers) {
      const children = Array.from(p.children).filter(c => {
        if (!isElementVisible(c) || isNavOrSystem(c)) return false;
        const txt = c.innerText.trim();
        return txt.length > 0 && txt.length < 450 && !/^(submit|next|save|continue)\b/i.test(txt);
      });

      if (children.length >= 2 && children.length <= 8) {
        children.forEach(c => addOption(c, c.innerText));
        if (options.length >= 2) return options;
      }
    }

    // Strategy 5: If not in body, scan document.body
    if (options.length === 0 && container !== document.body) {
      return findMCQOptions(document.body);
    }

    return options;
  }

  // Extract clean context without video timestamps, clocks, or noise (Token-Saver)
  function getCleanContext(container) {
    if (!container) return "";
    try {
      const clone = container.cloneNode(true);
      clone.querySelectorAll("#gemini-live-host, header, nav, footer, video, iframe, [class*='player' i], [class*='video' i], .ytp-chrome-bottom, button, input[type='button']").forEach(n => n.remove());
      let txt = clone.innerText || "";
      // Strip timecodes e.g. 00:00/10:30, 01:25
      txt = txt.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "");
      txt = txt.replace(/\b\d+\s+of\s+\d+\s+questions\b/gi, "");
      txt = txt.replace(/\s+/g, " ").trim();
      return txt;
    } catch (_) {
      return "";
    }
  }

  function extractQuestionData(container) {
    // 1. Identify Question Prompt Text (Strictly ignoring header / navigation)
    let questionText = "";

    const questionHeaders = Array.from(container.querySelectorAll("h1, h2, h3, h4, p, div, span")).filter(el => {
      if (!isElementVisible(el) || isNavOrSystem(el)) return false;
      const t = el.innerText.trim();
      return (/^\d+\.\s+[A-Z]/i.test(t) || /^question\s*\d+/i.test(t)) && t.length > 15;
    });

    if (questionHeaders.length > 0) {
      questionText = questionHeaders[0].innerText.trim();
    }

    if (!questionText) {
      const promptSelectors = [
        ".question-title", ".question-text", ".prompt", ".instruction",
        "h1, h2, h3, h4", "legend", "p.title", "label.question-label"
      ];
      for (const sel of promptSelectors) {
        const el = container.querySelector(sel);
        if (el && isElementVisible(el) && !isNavOrSystem(el)) {
          const t = el.innerText.trim();
          if (t.length > 10) {
            questionText = t;
            break;
          }
        }
      }
    }

    const cleanContext = getCleanContext(container);
    if (!questionText) {
      questionText = cleanContext;
    }

    // 2. Check if this is a Sentence Rearrangement Question
    const isRearrange = checkIsRearrangeQuestion(container) || checkIsRearrangeQuestion(document.body) || /rearrange/i.test(questionText) || /arrange the following/i.test(questionText);
    let sentenceTokens = [];
    if (isRearrange) {
      sentenceTokens = findRearrangeTokens(container);
    }
    if (isRearrange && sentenceTokens.length === 0) {
      sentenceTokens = findRearrangeTokens(document.body);
    }
    const finalIsRearrange = isRearrange || sentenceTokens.length >= 3;

    // 3. Identify Options (Disabled for rearrange questions)
    const options = finalIsRearrange ? [] : findMCQOptions(container);

    // 4. Identify Dropdowns
    const dropdowns = [];
    const selectElements = Array.from(container.querySelectorAll("select")).filter(
      el => isElementVisible(el) && !el.closest("#gemini-live-host")
    );

    selectElements.forEach((sel, idx) => {
      const optList = Array.from(sel.options).map(opt => ({
        value: opt.value,
        text: opt.text.trim()
      }));
      dropdowns.push({
        element: sel,
        index: idx,
        id: sel.id || `select_${idx}`,
        name: sel.name || `dropdown_${idx}`,
        options: optList
      });
    });

    // 5. Identify Fill-in Text Blanks
    const textBlanks = [];
    const blankInputs = Array.from(
      container.querySelectorAll("input[type='text']:not(.gemini-input), input:not([type])")
    ).filter(el => isElementVisible(el) && !el.closest("#gemini-live-host"));

    blankInputs.forEach((inp, idx) => {
      textBlanks.push({
        element: inp,
        index: idx,
        id: inp.id || `blank_${idx}`,
        placeholder: inp.placeholder
      });
    });

    // 6. Identify Writing Area
    const writingAreas = Array.from(
      container.querySelectorAll("textarea, [contenteditable='true']")
    ).filter(el => isElementVisible(el) && !el.closest("#gemini-live-host"));

    // 7. Strictly Detect Speaking Indicators (Only when active recording hardware button exists)
    const micButton = document.querySelector(
      "button.record, .mic-btn, [aria-label*='record' i], [aria-label*='speak' i], .audio-record, [class*='record' i], [class*='mic' i]"
    );
    const hasActiveMic = !!micButton && isElementVisible(micButton);

    // Classify Question Type
    let detectedType = "auto_detect";
    if (finalIsRearrange || sentenceTokens.length >= 3) {
      detectedType = "rearrange_sentence";
    } else if (options.length > 0) {
      detectedType = "mcq";
    } else if (writingAreas.length > 0) {
      detectedType = "writing";
    } else if (dropdowns.length > 0 || textBlanks.length > 0) {
      detectedType = "choose_word";
    } else if (hasActiveMic) {
      detectedType = "speaking";
    }

    return {
      container,
      type: detectedType,
      questionText,
      context: cleanContext,
      options: options.map(o => ({ index: o.index, id: o.id, text: o.text })),
      dropdowns: dropdowns.map(d => ({ index: d.index, id: d.id, name: d.name, options: d.options.map(o => o.text) })),
      sentenceTokens: sentenceTokens.map(t => ({ index: t.index, id: t.id, text: t.text })),
      writingConstraints: {
        hasTextarea: writingAreas.length > 0
      },
      domReferences: {
        options,
        dropdowns,
        textBlanks,
        sentenceTokens,
        writingArea: writingAreas[0] || null
      }
    };
  }

  // Stable global question identifier extractor to prevent duplicate answers
  function getQuestionIdentifier(container, data) {
    const fullText = (document.body ? document.body.innerText : "") || (container ? container.innerText : "");
    // Match question number like "1 of 5 questions", "1 of 6 questions", "Question 2 of 10"
    const numMatch = fullText.match(/\b(\d+)\s+of\s+(\d+)\s+questions?\b/i) ||
                     fullText.match(/\bquestion\s*(\d+)\s+of\s+(\d+)\b/i);

    // Match prompt heading like "1. Aarav is writing to his friend..."
    const titleMatch = fullText.match(/(?:^|\n)\s*(\d+)[\.\)]\s+([^\n\r]{8,90})/);

    let prefix = "";
    if (numMatch) {
      prefix = `Q_${numMatch[1]}_OF_${numMatch[2]}`;
    }

    let titlePart = "";
    if (titleMatch) {
      titlePart = `${titleMatch[1]}_${titleMatch[2].slice(0, 50).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}`;
    } else if (data && data.questionText && data.questionText.length > 10) {
      titlePart = data.questionText.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    }

    if (prefix && titlePart) {
      return `${prefix}::${titlePart}`;
    }
    if (prefix) return prefix;
    if (titlePart) return titlePart;
    return fullText.slice(0, 80).replace(/\s+/g, "_").toLowerCase();
  }

  // Token-Saver: Check if question is already answered on screen
  function isQuestionAlreadyAnswered(data, container, questionId) {
    if (!data) return false;

    // 1. Explicitly marked as solved by extension
    if (container && container.getAttribute("data-gemini-solved") === "true") {
      return true;
    }
    if (questionId && (state.lastSolvedQuestionId === questionId || state.solvedQuestionIds.has(questionId))) {
      return true;
    }

    // 2. MCQ: Has any option been checked or selected?
    if (data.type === "mcq") {
      const anyInputChecked = document.querySelector("input[type='radio']:checked, input[type='checkbox']:checked");
      if (anyInputChecked && !anyInputChecked.closest("#gemini-live-host")) return true;

      const anyClassSelected = document.querySelector(
        "[class*='selected' i], [class*='checked' i], [class*='active' i], [aria-checked='true']"
      );
      if (anyClassSelected && !anyClassSelected.closest("#gemini-live-host, header, nav, video")) return true;

      if (data.domReferences && data.domReferences.options) {
        const anyOptSelected = data.domReferences.options.some(opt => {
          if (!opt.element) return false;
          const cls = (opt.element.className || "").toLowerCase();
          return cls.includes("selected") || cls.includes("active") || cls.includes("checked") || opt.element.getAttribute("aria-checked") === "true";
        });
        if (anyOptSelected) return true;
      }
    }

    // 3. Rearrange: Have tokens already been moved or slot blanks filled?
    if (data.type === "rearrange_sentence") {
      const slots = document.querySelectorAll("[class*='slot' i], [class*='blank' i], [class*='drop' i]");
      if (slots.length > 0) {
        const filledSlots = Array.from(slots).filter(s => s.innerText.trim().length > 0);
        if (filledSlots.length >= 2) return true;
      }
    }

    // 4. Writing: Is textarea filled with substantive text?
    if (data.type === "writing" && data.domReferences && data.domReferences.writingArea) {
      if (data.domReferences.writingArea.value?.trim().length > 15) return true;
    }

    // 5. Dropdown: Are choices already picked?
    if (data.type === "choose_word" && data.domReferences && data.domReferences.dropdowns) {
      const allPicked = data.domReferences.dropdowns.every(d => d.element && d.element.value !== "" && d.element.selectedIndex > 0);
      if (allPicked && data.domReferences.dropdowns.length > 0) return true;
    }

    return false;
  }

  // -------------------------------------------------------------
  // 4. Automation Solvers (Synthetic DOM Actions)
  // -------------------------------------------------------------
  function highlightElement(el) {
    if (!el) return;
    try {
      const originalOutline = el.style.outline;
      const originalBoxShadow = el.style.boxShadow;
      el.style.outline = "3px solid #10b981";
      el.style.boxShadow = "0 0 16px rgba(16, 185, 129, 0.7)";
      setTimeout(() => {
        el.style.outline = originalOutline;
        el.style.boxShadow = originalBoxShadow;
      }, 5000);
    } catch (_) {}
  }

  function simulateClick(element) {
    if (!element) return;
    try { element.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
    element.focus();

    highlightElement(element);

    const target = element.querySelector("input[type='radio'], input[type='checkbox']") || element;
    const clickEvents = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    clickEvents.forEach(evtName => {
      const evt = new MouseEvent(evtName, { bubbles: true, cancelable: true, view: window });
      target.dispatchEvent(evt);
    });

    try { target.click(); } catch (_) {}
    if (target !== element) {
      try { element.click(); } catch (_) {}
    }
  }

  function setElementValue(element, val) {
    if (!element) return;
    element.focus();

    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      const prototype = element.tagName === "INPUT" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

      if (nativeSetter) {
        nativeSetter.call(element, val);
      } else {
        element.value = val;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (element.isContentEditable) {
      element.innerText = val;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // Solve MCQ
  async function executeMCQ(solution, domRefs) {
    let answers = [];
    if (Array.isArray(solution.mcq_answers)) answers.push(...solution.mcq_answers);
    else if (typeof solution.mcq_answers === "string" && solution.mcq_answers.trim()) answers.push(solution.mcq_answers.trim());
    if (solution.selected_option && typeof solution.selected_option === "string") answers.push(solution.selected_option.trim());
    if (solution.answer && typeof solution.answer === "string") answers.push(solution.answer.trim());
    if (Array.isArray(solution.answers)) answers.push(...solution.answers);

    let indices = [];
    if (Array.isArray(solution.mcq_indices)) indices.push(...solution.mcq_indices);
    else if (typeof solution.mcq_indices === "number") indices.push(solution.mcq_indices);
    if (typeof solution.selected_index === "number") indices.push(solution.selected_index);
    if (typeof solution.index === "number") indices.push(solution.index);

    let clickedCount = 0;
    let optionsList = domRefs && Array.isArray(domRefs.options) && domRefs.options.length > 0 ? domRefs.options : findMCQOptions(document.body);

    function cleanString(str) {
      if (!str) return "";
      return str
        .replace(/^(option\s*[a-d1-4][:.)\-]?|[a-d1-4][:.)\-]\s*)/i, "")
        .replace(/['"“”’‘]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    }

    // Attempt 1: Match against detected optionsList
    for (const opt of optionsList) {
      const matchByIndex = indices.includes(opt.index);
      const optClean = cleanString(opt.text);

      const matchByText = answers.some(ans => {
        const ansClean = cleanString(ans);
        if (!ansClean || !optClean) return false;
        return (
          optClean === ansClean ||
          optClean.includes(ansClean) ||
          ansClean.includes(optClean)
        );
      });

      if (matchByIndex || matchByText) {
        simulateClick(opt.element);
        clickedCount++;
        await delay(state.typingDelayMs || 250);
      }
    }

    // Attempt 2 (FAILPROOF FULL-PAGE SEARCH): Search the entire page DOM for elements containing the answer text
    if (clickedCount === 0 && answers.length > 0) {
      for (const ans of answers) {
        const targetClean = cleanString(ans);
        if (!targetClean || targetClean.length < 5) continue;

        const allCandidates = Array.from(document.querySelectorAll("div, p, span, li, button, label, td, tr"))
          .filter(el => {
            if (!isElementVisible(el) || isNavOrSystem(el)) return false;
            if (el.innerText.length > 800) return false; // Ignore large wrappers/passages
            const t = cleanString(el.innerText);
            return t === targetClean || t.includes(targetClean) || (targetClean.length > 20 && targetClean.includes(t) && t.length > 20);
          });

        if (allCandidates.length > 0) {
          allCandidates.sort((a, b) => a.innerText.trim().length - b.innerText.trim().length);
          const bestEl = allCandidates[0];
          simulateClick(bestEl);
          clickedCount++;
          await delay(state.typingDelayMs || 250);
          break;
        }
      }
    }

    const answerLabel = answers.length > 0 ? answers.join(", ") : (optionsList[0]?.text || "Option");
    if (clickedCount > 0) {
      showAnswerBanner(answerLabel, solution.explanation || "Correct option selected on page", "MCQ Answer", 5000);
      return `Selected option: ${answerLabel}`;
    }

    // Attempt 3: If options were identified, click the first one as emergency fallback
    if (optionsList.length > 0) {
      simulateClick(optionsList[0].element);
      showAnswerBanner(optionsList[0].text, "Selected option", "MCQ Answer", 5000);
      return `Selected option: ${optionsList[0].text}`;
    }

    return "Could not locate matching option element";
  }

  // Solve Choose the Correct Word
  async function executeChooseWord(solution, domRefs) {
    let actionsTaken = 0;

    // 1. Dropdown Selection
    if (solution.dropdown_selections && domRefs.dropdowns.length > 0) {
      for (const selPlan of solution.dropdown_selections) {
        const targetDropdown = domRefs.dropdowns[selPlan.dropdown_index ?? 0] || domRefs.dropdowns[0];
        if (targetDropdown && targetDropdown.element) {
          const selectEl = targetDropdown.element;
          const targetText = (selPlan.selected_text || selPlan.selected_value || "").toLowerCase();

          for (let i = 0; i < selectEl.options.length; i++) {
            const opt = selectEl.options[i];
            if (
              opt.text.toLowerCase().includes(targetText) ||
              opt.value.toLowerCase().includes(targetText) ||
              targetText.includes(opt.text.toLowerCase())
            ) {
              selectEl.selectedIndex = i;
              selectEl.value = opt.value;
              selectEl.dispatchEvent(new Event("change", { bubbles: true }));
              selectEl.dispatchEvent(new Event("input", { bubbles: true }));
              actionsTaken++;
              break;
            }
          }
        }
      }
    }

    // 2. Fill-in text blanks
    if (solution.text_blanks && domRefs.textBlanks.length > 0) {
      for (const blankPlan of solution.text_blanks) {
        const blank = domRefs.textBlanks[blankPlan.blank_index ?? 0] || domRefs.textBlanks[0];
        if (blank && blank.element && blankPlan.fill_text) {
          setElementValue(blank.element, blankPlan.fill_text);
          actionsTaken++;
        }
      }
    }

    showAnswerBanner("Word choices updated", solution.explanation || "Selected correct vocabulary option", "Word Choice", 5000);
    return actionsTaken > 0 ? `Selected/Filled ${actionsTaken} word choice(s)` : "Word choices updated";
  }

  // Solve Rearrange the Sentence
  async function executeRearrange(solution, domRefs) {
    let tokens = domRefs && domRefs.sentenceTokens && domRefs.sentenceTokens.length > 0 ? domRefs.sentenceTokens : findRearrangeTokens(document.body);
    if (!tokens || tokens.length === 0) return "No rearrange tokens found on page";

    let orderedSequence = [];

    // 1. Check indices from Gemini
    const indices = solution.reordered_token_indices || solution.indices || [];
    if (Array.isArray(indices) && indices.length > 0) {
      orderedSequence = indices.map(idx => tokens[idx]).filter(Boolean);
    }

    // 2. Check token texts or ordered sentences
    const targetTexts = solution.reordered_token_texts || solution.ordered_sentences || solution.reordered_sentences || solution.sentences || [];
    if (orderedSequence.length === 0 && Array.isArray(targetTexts) && targetTexts.length > 0) {
      const remainingTokens = [...tokens];
      for (const targetWord of targetTexts) {
        const cleanTarget = targetWord.replace(/['".,]/g, "").trim().toLowerCase();
        const matchIdx = remainingTokens.findIndex(t => {
          const cleanToken = t.text.replace(/['".,]/g, "").trim().toLowerCase();
          return cleanToken === cleanTarget || cleanToken.includes(cleanTarget) || cleanTarget.includes(cleanToken);
        });
        if (matchIdx !== -1) {
          orderedSequence.push(remainingTokens[matchIdx]);
          remainingTokens.splice(matchIdx, 1);
        }
      }
    }

    // 3. Fallback to reconstructed_sentence text matching
    if (orderedSequence.length === 0 && solution.reconstructed_sentence) {
      const fullText = solution.reconstructed_sentence.toLowerCase();
      const scoredTokens = tokens.map(t => {
        const pos = fullText.indexOf(t.text.toLowerCase().slice(0, 30));
        return { token: t, pos: pos !== -1 ? pos : 999999 };
      });
      scoredTokens.sort((a, b) => a.pos - b.pos);
      orderedSequence = scoredTokens.map(s => s.token);
    }

    // 4. Default to original tokens if matching failed
    if (orderedSequence.length === 0) {
      orderedSequence = [...tokens];
    }

    // Sequentially click each token in order
    for (const token of orderedSequence) {
      simulateClick(token.element);
      await delay(Math.max(260, state.typingDelayMs || 250));
    }

    const fullSentence = solution.reconstructed_sentence || orderedSequence.map(t => t.text).join(" ");
    showAnswerBanner(fullSentence, solution.explanation || "Rearranged phrases into logical sequence", "Sentence Rearranged");

    return `Ordered ${orderedSequence.length} items: "${fullSentence.slice(0, 60)}..."`;
  }

  // Solve Writing Question
  async function executeWriting(solution, domRefs) {
    const textarea = domRefs.writingArea;
    if (!textarea) return "No writing textarea detected";

    const textToInsert = solution.writing_answer || solution.speaking_script || "";
    setElementValue(textarea, textToInsert);

    showAnswerBanner(textToInsert.slice(0, 80) + (textToInsert.length > 80 ? "..." : ""), "Typed response into answer box", "Writing Answer", 5000);
    return `Typed ${textToInsert.split(/\s+/).length} words into answer box`;
  }

  // Solve Speaking Question
  async function executeSpeaking(solution, domRefs) {
    // If MCQ options available on screen, NEVER open teleprompter!
    if (domRefs.options && domRefs.options.length > 0) {
      return executeMCQ(solution, domRefs);
    }

    // 1. Check if speaking question contains any dropdown option to pick first
    let dropdownNotice = false;
    if (domRefs.dropdowns.length > 0 && solution.dropdown_selections) {
      await executeChooseWord(solution, domRefs);
      dropdownNotice = true;
    }

    // 2. Only show teleprompter if there's an actual active mic button on screen
    const micButton = document.querySelector(
      "button.record, .mic-btn, [aria-label*='record' i], [aria-label*='speak' i], .audio-record, [class*='record' i], [class*='mic' i]"
    );
    if (!micButton && (!domRefs.container || !domRefs.container.classList.contains("speaking-question"))) {
      return executeMCQ(solution, domRefs);
    }

    // 3. Display Teleprompter for the User to Read
    const teleprompter = document.getElementById("gemini-teleprompter");
    const speechContent = document.getElementById("gemini-speech-content");
    const speechNotes = document.getElementById("gemini-speech-notes");
    const speechMeta = document.getElementById("gemini-speech-meta");
    const dropdownNoticeEl = document.getElementById("gemini-dropdown-notice");

    if (teleprompter && speechContent) {
      speechContent.innerText = solution.speaking_script || "No speech script generated.";
      if (speechNotes) speechNotes.innerText = solution.speaking_notes || "Speak clearly with natural pacing.";
      if (speechMeta) {
        const wordCount = (solution.speaking_script || "").split(/\s+/).filter(Boolean).length;
        speechMeta.innerText = `~${wordCount} words`;
      }
      if (dropdownNoticeEl) {
        dropdownNoticeEl.style.display = dropdownNotice ? "block" : "none";
      }
      teleprompter.classList.add("active");
    }

    showAnswerBanner("Speaking script loaded in teleprompter", solution.speaking_notes || "Speak clearly with natural pacing", "Speaking Task", 5000);
    return dropdownNotice ? "Auto-selected dropdown & speech teleprompter is ready!" : "Speaking teleprompter is ready!";
  }

  // -------------------------------------------------------------
  // 5. Main Trigger Controller (Token-Saver Guarded)
  // -------------------------------------------------------------
  async function triggerSolve(isAutomated = false) {
    if (!state.isEnabled) return;
    if (state.isProcessing) return;

    // Immediately dismiss any open speaking teleprompter or previous answer banner
    const teleprompter = document.getElementById("gemini-teleprompter");
    if (teleprompter) teleprompter.classList.remove("active");

    const container = findActiveQuestionContainer();
    const data = extractQuestionData(container);
    const questionId = getQuestionIdentifier(container, data);

    if (!questionId) return;

    if (isAutomated) {
      // 1. If this exact question was already solved, DO NOT CALL GEMINI!
      if (state.lastSolvedQuestionId === questionId || state.solvedQuestionIds.has(questionId)) {
        return;
      }
      // 2. If question already has an answer placed on screen, mark solved and DO NOT CALL GEMINI!
      if (isQuestionAlreadyAnswered(data, container, questionId)) {
        state.lastSolvedQuestionId = questionId;
        state.solvedQuestionIds.add(questionId);
        if (container) container.setAttribute("data-gemini-solved", "true");
        return;
      }
      // Throttle automated checks: minimum 2.0s between requests
      const now = Date.now();
      if (now - state.lastSolveTimestamp < 2000) {
        return;
      }
    }

    // IMMEDIATELY lock this question as solved in state to prevent duplicate parallel/loop calls
    state.lastSolvedQuestionId = questionId;
    state.solvedQuestionIds.add(questionId);
    state.lastSolveTimestamp = Date.now();
    state.isProcessing = true;

    console.log("%c[Gemini Live]%c Solving current question: " + questionId, "color:#818cf8;font-weight:bold", "color:#fff");
    console.log("[Gemini Live] Detected Category:", data.type.toUpperCase());
    console.log("[Gemini Live] Question Prompt:", data.questionText.slice(0, 80));

    updateStatus("Analyzing question...", "working", data.type.toUpperCase());
    const btnSolve = document.getElementById("gemini-btn-solve");
    if (btnSolve) btnSolve.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        action: "SOLVE_QUESTION",
        payload: {
          type: data.type,
          questionText: data.questionText,
          context: data.context,
          options: data.options,
          dropdowns: data.dropdowns,
          sentenceTokens: data.sentenceTokens,
          writingConstraints: data.writingConstraints
        }
      });

      if (!response || !response.success) {
        throw new Error(response?.error || "Failed to receive answer from Gemini API.");
      }

      const solution = response.data;

      // Notify user if automatic failover rotated keys
      if (solution && solution._keyRotated) {
        const failoverNotice = `⚡ Key #${solution._originalKeyIndex + 1} limit reached. Switched to Key #${solution._activeKeyIndex + 1} (${solution._modelUsed})`;
        showToast(failoverNotice);
        showInfo(failoverNotice);
      }

      // CRITICAL: Prevent Gemini from misclassifying detected sentence rearrangement into MCQ!
      let targetType = solution.detected_type || data.type;
      if (data.type === "rearrange_sentence" || (data.domReferences && data.domReferences.sentenceTokens && data.domReferences.sentenceTokens.length >= 3)) {
        targetType = "rearrange_sentence";
      }

      updateStatus("Applying solution...", "working", targetType.toUpperCase());

      let resultMsg = "";
      switch (targetType) {
        case "rearrange_sentence":
          resultMsg = await executeRearrange(solution, data.domReferences);
          break;
        case "mcq":
          resultMsg = await executeMCQ(solution, data.domReferences);
          break;
        case "choose_word":
          resultMsg = await executeChooseWord(solution, data.domReferences);
          break;
        case "writing":
          resultMsg = await executeWriting(solution, data.domReferences);
          break;
        case "speaking":
          resultMsg = await executeSpeaking(solution, data.domReferences);
          break;
        default:
          if (data.domReferences.sentenceTokens && data.domReferences.sentenceTokens.length >= 3) {
            resultMsg = await executeRearrange(solution, data.domReferences);
          } else if (data.domReferences.options && data.domReferences.options.length > 0) {
            resultMsg = await executeMCQ(solution, data.domReferences);
          } else {
            resultMsg = "Question processed.";
          }
      }

      if (container) {
        container.setAttribute("data-gemini-solved", "true");
      }

      updateStatus("Done", "idle", targetType.toUpperCase());
      showToast(resultMsg);

    } catch (err) {
      console.error("[Gemini Live Solver Error]:", err);
      updateStatus("Error", "error", "FAILED");
      showToast(err.message);
      showInfo(`⚠️ ${err.message}`);

      // Stop auto-watcher immediately on rate-limit or missing key to protect quota
      const errLower = (err.message || "").toLowerCase();
      if (errLower.includes("429") || errLower.includes("quota") || errLower.includes("rate limit") || errLower.includes("not configured") || errLower.includes("missing")) {
        const autoToggle = document.getElementById("gemini-autowatch-toggle");
        if (autoToggle) autoToggle.checked = false;
        state.isAutoWatch = false;
        stopAutoWatcher();
      }
    } finally {
      state.isProcessing = false;
      if (btnSolve) btnSolve.disabled = !state.isEnabled;
    }
  }

  // -------------------------------------------------------------
  // 6. Auto-Watch Mutation Observer (Controlled & Token-Safe)
  // -------------------------------------------------------------
  let autoWatchDebounce = null;
  let autoWatchInterval = null;

  function startAutoWatcher() {
    if (state.observer) state.observer.disconnect();
    if (autoWatchInterval) clearInterval(autoWatchInterval);

    state.observer = new MutationObserver(() => {
      if (!state.isEnabled || !state.isAutoWatch || state.isProcessing) return;
      clearTimeout(autoWatchDebounce);
      autoWatchDebounce = setTimeout(() => {
        triggerSolve(true);
      }, 1000);
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also check every 2 seconds to detect if user advanced to next question
    autoWatchInterval = setInterval(() => {
      if (!state.isEnabled || !state.isAutoWatch || state.isProcessing) return;
      const currentId = getQuestionIdentifier();
      if (currentId && !state.solvedQuestionIds.has(currentId) && currentId !== state.lastSolvedQuestionId) {
        triggerSolve(true);
      }
    }, 2000);
  }

  function stopAutoWatcher() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (autoWatchInterval) {
      clearInterval(autoWatchInterval);
      autoWatchInterval = null;
    }
  }

  // -------------------------------------------------------------
  // 7. Message Listener (from Popup / Background Shortcuts)
  // -------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "TRIGGER_SOLVE") {
      if (!state.isEnabled) return sendResponse({ status: "disabled" });
      triggerSolve(false);
      sendResponse({ status: "triggered" });
    } else if (msg.action === "TOGGLE_HUD") {
      if (!state.isEnabled) {
        toggleExtensionPower(true);
      } else {
        const widget = document.getElementById("gemini-widget");
        if (widget) {
          state.hudMinimized = !state.hudMinimized;
          widget.classList.toggle("minimized", state.hudMinimized);
        }
      }
      sendResponse({ minimized: state.hudMinimized, enabled: state.isEnabled });
    } else if (msg.action === "EXTENSION_POWER_TOGGLED") {
      toggleExtensionPower(msg.enabled);
      sendResponse({ enabled: state.isEnabled });
    }
  });

  // Dismiss answer banner when moving to the next question and auto-solve next
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button, a, input[type='button'], input[type='submit']");
    if (btn && !btn.closest("#gemini-live-host")) {
      const text = (btn.innerText || btn.value || "").trim().toLowerCase();
      if (text.includes("next") || text.includes("submit") || text.includes("continue") || text === "save & next") {
        setTimeout(hideAnswerBanner, 600);
        // After advancing to the next question, trigger solve if auto-solve is enabled
        setTimeout(() => {
          if (state.isEnabled && state.isAutoWatch && !state.isProcessing) {
            triggerSolve(true);
          }
        }, 1800);
      }
    }
  }, true);

  // Initialize UI on page load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initHUD);
  } else {
    initHUD();
  }

})();
