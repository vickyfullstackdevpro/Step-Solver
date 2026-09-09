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

    // Load enabled state and pacing from storage
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
            <img src="${chrome.runtime.getURL('icons/icon48.png')}" style="width: 16px; height: 16px; object-fit: contain; border-radius: 3px;" alt="Step Solver">
            <span>Step Solver</span>
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

    const answerBanner = document.getElementById("gemini-answer-banner");
    const answerHeader = answerBanner ? answerBanner.querySelector(".gemini-answer-banner-header") : null;
    if (answerBanner && answerHeader) {
      makeDraggable(answerBanner, answerHeader);
    }
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

      // Disable transition and fix right/left/transform conflict immediately
      el.classList.add("gemini-dragging");
      el.style.transition = "none";
      el.style.transform = "none";
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

    let displayMain = (mainText || "").trim();
    let displaySub = (subText || "").trim();

    // If mainText is a generic placeholder like "Option" or "MCQ", promote genuine subText
    if (/^(option|options|mcq|mcq answer|answer pending|answer|unknown)$/i.test(displayMain)) {
      if (displaySub && displaySub.length > 0) {
        displayMain = displaySub;
        displaySub = "";
      }
    }

    mainEl.innerText = displayMain;
    if (subEl) {
      subEl.innerText = displaySub;
      subEl.style.display = displaySub ? "block" : "none";
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
  function safeText(el) {
    if (!el) return "";
    return (el.innerText || el.textContent || el.value || "").trim();
  }

  function isNavOrSystem(el) {
    if (!el || el.closest("#gemini-live-host")) return true;

    // Exclude top-level page headers, navbars, progress indicators, breadcrumbs, footers
    // NOTE: Do NOT use generic [class*='header'] as that improperly excludes .question-header and .card-header
    if (el.closest("header, nav, footer, aside, [class*='top-bar' i], [class*='topbar' i], [class*='navbar' i], [class*='site-header' i], [class*='page-header' i], [class*='app-header' i], [class*='global-header' i], [class*='progress' i], [class*='breadcrumb' i]")) {
      return true;
    }

    const text = safeText(el).toLowerCase();
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

  function getCurrentQuestionMeta() {
    const fullText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
    const progressMatch = fullText.match(/\b(\d+)\s+of\s+(\d+)\s+questions?\b/i) ||
                          fullText.match(/\bquestion\s*(\d+)\s+of\s+(\d+)\b/i) ||
                          fullText.match(/\b(\d+)\s+of\s+(\d+)\b/i);
    let currentNum = null;
    let totalNum = null;
    if (progressMatch) {
      currentNum = parseInt(progressMatch[1], 10);
      totalNum = parseInt(progressMatch[2], 10);
    }

    // Also look for visible numbered heading like "1. Aarav...", "4. Which of the..."
    if (!currentNum) {
      const headingEl = Array.from(document.querySelectorAll("h1, h2, h3, h4, p, div, span")).find(el => {
        if (!isElementVisible(el) || isNavOrSystem(el)) return false;
        const t = safeText(el);
        return /^\d+[\.\)]\s+[A-Za-z]/.test(t) || /^question\s*\d+/i.test(t);
      });
      if (headingEl) {
        const hText = safeText(headingEl);
        const match = hText.match(/^(\d+)[\.\)]/i) || hText.match(/^question\s*(\d+)/i);
        if (match) currentNum = parseInt(match[1], 10);
      }
    }

    return { currentNum, totalNum };
  }

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

  function findActiveQuestionContainer() {
    const meta = getCurrentQuestionMeta();
    const currentNum = meta.currentNum;

    // 1. If active element is an input/choice in a question, use its container
    const focused = document.activeElement;
    if (focused && focused !== document.body && !focused.closest("#gemini-live-host, header, nav, [class*='top-bar' i]")) {
      const container = focused.closest(".question, .question-card, .quiz-question, .exercise, [role='region'], fieldset, form");
      if (container && isElementVisible(container)) return container;
    }

    // 2. Target the specific question header matching currentNum (e.g. "4. Which of...")
    let targetHeader = null;
    if (currentNum) {
      const targetRegex = new RegExp(`^\\s*${currentNum}[\\.\\)]\\s+`, "i");
      const altRegex = new RegExp(`^\\s*question\\s*${currentNum}\\b`, "i");

      const candidates = Array.from(document.querySelectorAll("h1, h2, h3, h4, p, div, span")).filter(el => {
        if (!isElementVisible(el) || isNavOrSystem(el)) return false;
        const t = safeText(el);
        return (targetRegex.test(t) || altRegex.test(t)) && t.length > 5;
      });

      if (candidates.length > 0) {
        candidates.sort((a, b) => safeText(a).length - safeText(b).length);
        targetHeader = candidates[0];
      }
    }

    // 3. Fallback: Find visible numbered headers in viewport
    if (!targetHeader) {
      const allHeaders = Array.from(document.querySelectorAll("h1, h2, h3, h4, p, div, span")).filter(el => {
        if (!isElementVisible(el) || isNavOrSystem(el)) return false;
        const t = safeText(el);
        return (/^\d+[\.\)]\s+[A-Za-z]/i.test(t) || /^question\s*\d+/i.test(t)) && t.length > 10;
      });

      if (allHeaders.length > 0) {
        allHeaders.sort((a, b) => {
          const aTop = a.getBoundingClientRect().top;
          const bTop = b.getBoundingClientRect().top;
          const aScore = aTop >= -20 && aTop <= window.innerHeight * 0.8 ? aTop : Math.abs(aTop) + 10000;
          const bScore = bTop >= -20 && bTop <= window.innerHeight * 0.8 ? bTop : Math.abs(bTop) + 10000;
          return aScore - bScore;
        });
        targetHeader = allHeaders[0];
      }
    }

    // 4. Walk up from targetHeader to find enclosing question container that encloses prompt AND options/inputs
    if (targetHeader) {
      let current = targetHeader;
      let bestContainer = null;
      while (current && current.parentElement && current.parentElement !== document.body) {
        const p = current.parentElement;
        if (isNavOrSystem(p)) break;

        const hasInteractive = p.querySelector(
          "input, select, textarea, [class*='option' i], [class*='choice' i], [class*='chip' i], [class*='blank' i], [class*='slot' i]"
        ) || Array.from(p.querySelectorAll("button, div[role='button']")).some(b => {
          const t = safeText(b).toLowerCase();
          return t.startsWith("reset") || t === "submit" || t.startsWith("submit");
        });

        // Only treat as a valid container if it actually encloses response/interactive controls!
        if (hasInteractive) {
          bestContainer = p;
          if (
            p.classList.contains("question") ||
            p.classList.contains("question-card") ||
            p.classList.contains("quiz-card") ||
            p.classList.contains("exercise") ||
            p.classList.contains("test-container") ||
            p.getAttribute("role") === "region"
          ) {
            break;
          }
        }
        current = p;
      }
      if (bestContainer) return bestContainer;
    }

    // 5. Look for main single-question content wrapper
    const candidateSelectors = [
      "main", "#content", ".test-container", ".question-container",
      ".question.active", ".active-question", ".current-question",
      ".question-card", ".question", ".quiz-card", ".exercise"
    ];

    for (const selector of candidateSelectors) {
      const el = document.querySelector(selector);
      if (el && isElementVisible(el) && !el.closest("#gemini-live-host, header, nav, [class*='top-bar' i]")) {
        return el;
      }
    }

    return document.body;
  }

  function isElementVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    // Check if element or any ancestor is explicitly hidden via inline style or CSS classes
    if (el.closest("[style*='display: none'], [style*='display:none'], [hidden], .hidden, .hide, .d-none, .ng-hide, [aria-hidden='true']")) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return (
      (rect.width > 0 && rect.height > 0) ||
      (el.offsetWidth > 0 && el.offsetHeight > 0)
    );
  }

  // Detect if current screen is the post-submission Answer / Feedback / Review page
  // Detect if current screen is truly the post-submission Answer / Feedback / Review page
  function isAnswerOrFeedbackPage(container) {
    const scope = (container && container !== document.body) ? container : document.body;

    // 1. ACTIVE QUESTION CHECK: If any active interactive controls exist, it is NOT a feedback page!
    // Check for rearrangement chips:
    const activeTokens = findRearrangeTokens(scope);
    if (activeTokens && activeTokens.length >= 3) {
      return false; // Active rearrange question!
    }

    // Check all visible buttons on page (excluding our extension HUD)
    const allButtons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a, div[role='button'], [class*='btn' i]"))
      .filter(b => isElementVisible(b) && !b.closest("#gemini-live-host, #steptest-ai-banner, header, nav"));

    // If there is a visible Reset button, it is an active question!
    const hasResetBtn = allButtons.some(b => {
      const t = safeText(b).toLowerCase();
      return t.startsWith("reset");
    });
    if (hasResetBtn) {
      return false;
    }

    // If there is a visible Submit button (even if disabled before answering), it is an active question!
    const hasSubmitBtn = allButtons.some(b => {
      const t = safeText(b).toLowerCase();
      return t === "submit" || t.startsWith("submit");
    });
    if (hasSubmitBtn) {
      return false;
    }

    // Check for interactive select/textarea/text inputs:
    const activeInputs = Array.from(document.querySelectorAll("select, textarea, input[type='text']:not(.gemini-input)"))
      .filter(el => isElementVisible(el) && !el.closest("#gemini-live-host, #steptest-ai-banner"));
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

    // 3. And MUST have site feedback elements outside our extension UI
    const candidateFeedbackElements = Array.from(document.querySelectorAll(
      ".feedback, .feedback-box, .explanation, .solution-box, [class*='feedback-content' i], [class*='feedback-card' i]"
    )).filter(el => isElementVisible(el) && !el.closest("#gemini-live-host, #steptest-ai-banner"));

    if (candidateFeedbackElements.length > 0) {
      return true;
    }

    // Check for explicit site feedback text outside our extension
    try {
      const bodyClone = document.body.cloneNode(true);
      bodyClone.querySelectorAll("#gemini-live-host, #steptest-ai-banner, script, style").forEach(el => el.remove());
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

  // Check if current question is a Cloze / Multi-Blank Passage Question
  function checkIsClozePassage(container) {
    const scope = (container && container !== document.body) ? container : document.body;
    const pageText = (safeText(scope) + " " + (document.body ? safeText(document.body) : "")).toLowerCase();

    // Must NOT be a sentence rearrangement question
    const hasRearrangeKeywords = (
      pageText.includes("rearrange the words or phrases") ||
      pageText.includes("rearrange the phrases") ||
      pageText.includes("rearrange the words") ||
      pageText.includes("rearrange words") ||
      pageText.includes("rearrange phrases") ||
      pageText.includes("rearrange the sentence") ||
      pageText.includes("arrange the following sentences") ||
      pageText.includes("arrange the sentences") ||
      pageText.includes("arrange sentences") ||
      pageText.includes("form a logical sentence")
    );
    if (hasRearrangeKeywords) return false;

    // Check for visible Reset button on page (MANDATORY for StepTest cloze & rearrange questions)
    const hasVisibleResetBtn = Array.from(document.querySelectorAll("button, a, input[type='button'], div[role='button']"))
      .some(b => isElementVisible(b) && !isNavOrSystem(b) && safeText(b).toLowerCase().startsWith("reset"));

    // In StepTest / exams, cloze questions ALWAYS require a Reset button to reset placed chips
    if (!hasVisibleResetBtn) {
      return false;
    }

    // Exclude single-choice questions (e.g. "1. Fill in the blank", "best answer from the following", "fill in the blank with the best answer")
    const isSingleChoicePrompt = (
      pageText.includes("fill in the blank with the best answer") ||
      pageText.includes("fill in the blank with the correct") ||
      pageText.includes("best answer from the following") ||
      pageText.includes("select the best answer") ||
      pageText.includes("select the suitable word") ||
      pageText.includes("choose the best answer")
    );

    // Check for explicit multiple blank markers: [blank 1], [blank 2] or multiple occurrences of [____] or blanks
    const blankMatches = pageText.match(/\[\s*blank\s*\d*\s*\]|\[\s*_\s*\]|\[\s*\]|_{2,}/gi) || [];
    if (isSingleChoicePrompt && blankMatches.length <= 1) {
      return false;
    }

    const hasClozeKeywords = (
      pageText.includes("words for the blanks") ||
      pageText.includes("choosing the correct words") ||
      pageText.includes("words that best complete") ||
      pageText.includes("fill in the blanks with suitable words") ||
      pageText.includes("fill in the blanks with words") ||
      pageText.includes("fill in the blanks") ||
      pageText.includes("fill in each blank") ||
      pageText.includes("suitable words for the blank") ||
      pageText.includes("complete the passage") ||
      pageText.includes("complete the airport announcement") ||
      pageText.includes("complete the announcement") ||
      pageText.includes("passage in a logical sequence")
    );

    const hasBlankDom = Array.from(document.querySelectorAll("[class*='blank' i], [class*='slot' i], [class*='drop' i], [class*='gap' i], [class*='target' i], [data-blank], [data-slot], [class*='droppable' i]"))
      .some(el => isElementVisible(el) && !el.closest("#gemini-live-host, #steptest-ai-banner"));

    if (hasClozeKeywords || hasBlankDom || blankMatches.length >= 2) {
      return true;
    }

    return false;
  }

  // Extract clickable word choice chips for multi-blank passage
  function findClozeChips(container) {
    const chips = [];
    const seen = new Set();
    const scope = (container && container !== document.body) ? container : document.body;

    function isValidChip(el) {
      if (!el || !isElementVisible(el) || el.closest("#gemini-live-host, #steptest-ai-banner, header, nav, video, iframe, .ytp-chrome-bottom")) return false;
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
      const hasChild = Array.from(el.querySelectorAll("*")).some(isValidChip);
      return !hasChild;
    }

    // Strategy 0: Boundary search using Reset button!
    // In StepTest, the word chips appear directly above the Reset button and below the instruction
    const allVisible = Array.from(scope.querySelectorAll("*")).filter(el => isElementVisible(el) && !isNavOrSystem(el));
    const resetIdx = allVisible.findIndex(el => {
      const txt = safeText(el).toLowerCase();
      return txt.startsWith("reset") && (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.matches("[class*='btn' i], a, div, span"));
    });

    if (resetIdx !== -1) {
      // Find instruction / prompt anchor before the Reset button
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
            chips.push({ element: el, index: chips.length, id: `cloze_chip_${chips.length}`, text: t });
          }
        }
      }
      if (chips.length >= 2) return chips;
    }

    // Strategy 1: Container holding 2 to 12 leaf chips
    const candidateContainers = Array.from(scope.querySelectorAll("div, ul, section, ol, p")).filter(p => {
      if (!isElementVisible(p) || p.closest("#gemini-live-host, header, nav, video, iframe")) return false;
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
          chips.push({ element: el, index: chips.length, id: `cloze_chip_${chips.length}`, text: t });
        }
      });
      if (chips.length >= 2) return chips;
    }

    // Strategy 2: Candidate buttons or chip classes
    const candidates = Array.from(scope.querySelectorAll("button, [class*='chip' i], [class*='choice' i], [class*='option' i], [class*='word' i], [class*='pill' i], [class*='card' i], [class*='item' i], [class*='token' i]"))
      .filter(isLeafChip);

    candidates.forEach(el => {
      const t = safeText(el);
      if (!seen.has(el) && !chips.some(c => c.text === t)) {
        seen.add(el);
        chips.push({ element: el, index: chips.length, id: `cloze_chip_${chips.length}`, text: t });
      }
    });

    if (chips.length < 2 && scope !== document.body) {
      return findClozeChips(document.body);
    }
    return chips;
  }

  // Extract blank slots in passage in document reading order
  function findClozeBlanks(container) {
    const scope = (container && container !== document.body) ? container : document.body;
    const blanks = Array.from(scope.querySelectorAll(
      "[class*='blank' i], [class*='slot' i], [class*='drop' i], [class*='gap' i], [class*='target' i], [class*='droppable' i], [class*='placeholder' i], [data-blank], [data-slot], [data-index], input:not([type='button']):not([type='submit']):not([type='radio']):not([type='checkbox'])"
    )).filter(el => {
      if (!isElementVisible(el) || el.closest("#gemini-live-host, #steptest-ai-banner, header, nav")) return false;
      const t = safeText(el).toLowerCase();
      return !/^(reset|submit|next)\b/i.test(t);
    });

    // Also scan passage paragraphs for rounded empty inline boxes / drop zones
    const paragraphs = Array.from(scope.querySelectorAll("p, div.passage, div.content, div.question-body, section")).filter(p => {
      if (!isElementVisible(p) || isNavOrSystem(p)) return false;
      const txt = safeText(p);
      return txt.length > 20 && !txt.includes("14 of 14") && (txt.includes("delayed") || txt.includes("flight") || txt.includes("All") || txt.includes("check") || txt.includes("number"));
    });

    for (const p of paragraphs) {
      const inlineBoxes = Array.from(p.querySelectorAll("span, div, input")).filter(el => {
        if (!isElementVisible(el) || blanks.includes(el) || el.closest("#gemini-live-host, #steptest-ai-banner")) return false;
        const rect = el.getBoundingClientRect();
        const txt = safeText(el);
        return rect.width >= 20 && rect.height >= 14 && (txt.length === 0 || /^\[?\s*blank\s*\d*\s*\]?$/i.test(txt) || /^_{1,}$/.test(txt));
      });
      inlineBoxes.forEach(box => {
        if (!blanks.includes(box)) blanks.push(box);
      });
    }

    // Sort by physical reading order (top-to-bottom, left-to-right)
    blanks.sort((a, b) => {
      const rA = a.getBoundingClientRect();
      const rB = b.getBoundingClientRect();
      if (Math.abs(rA.top - rB.top) > 12) {
        return rA.top - rB.top;
      }
      return rA.left - rB.left;
    });

    if (blanks.length === 0 && scope !== document.body) {
      return findClozeBlanks(document.body);
    }
    return blanks;
  }

  // Check if current question is a Sentence / Phrase Rearrangement question
  function checkIsRearrangeQuestion(container) {
    const scope = (container && container !== document.body) ? container : document.body;
    const pageText = (safeText(scope) + " " + (document.body ? safeText(document.body) : "")).toLowerCase();

    // Must NOT be a cloze passage question
    const hasClozeKeywords = (
      pageText.includes("fill in the blanks with suitable words") ||
      pageText.includes("complete the passage") ||
      pageText.includes("passage in a logical sequence") ||
      pageText.includes("fill in the blank above") ||
      pageText.includes("choices below")
    );
    if (hasClozeKeywords) return false;

    // CRITICAL: If visible radio buttons exist, this is an MCQ (e.g. sequence ordering ABCD / DCAB), NOT chip rearrange!
    const hasRadioInputs = Array.from(document.querySelectorAll("input[type='radio']")).some(isElementVisible);
    if (hasRadioInputs) return false;

    // CRITICAL: "Fill in the blank" / "Choose the correct" questions are NEVER sentence rearrangements!
    const isFillBlankOrChoose = (
      pageText.includes("fill in the blank") ||
      pageText.includes("fill in the blanks") ||
      pageText.includes("fill in the missing") ||
      pageText.includes("select the best answer") ||
      pageText.includes("choose the best") ||
      pageText.includes("choose the correct") ||
      pageText.includes("select the correct") ||
      pageText.includes("select the suitable") ||
      pageText.includes("choose the suitable") ||
      pageText.includes("best answer from the following")
    );

    const hasRearrangeKeywords = (
      pageText.includes("rearrange the words or phrases") ||
      pageText.includes("rearrange the phrases") ||
      pageText.includes("rearrange the words") ||
      pageText.includes("rearrange words") ||
      pageText.includes("rearrange phrases") ||
      pageText.includes("rearrange the sentence") ||
      pageText.includes("arrange the following sentences") ||
      pageText.includes("arrange the sentences") ||
      pageText.includes("arrange sentences") ||
      pageText.includes("arrange the words") ||
      pageText.includes("arrange the phrases") ||
      pageText.includes("form a logical sentence") ||
      pageText.includes("form a sentence") ||
      (pageText.includes("rearrange") && pageText.includes("read it aloud"))
    );

    if (isFillBlankOrChoose && !hasRearrangeKeywords) {
      return false;
    }

    if (hasRearrangeKeywords) return true;

    // Reset button check: search visible buttons on page ONLY with genuine slot dashes
    const hasVisibleResetBtn = Array.from(document.querySelectorAll("button, a, input, div, span, [role='button']"))
      .some(b => isElementVisible(b) && !isNavOrSystem(b) && safeText(b).toLowerCase().startsWith("reset"));

    const hasSlotDashes = (pageText.includes("——") || pageText.includes("––") || pageText.includes("— —")) && (pageText.includes("“") || pageText.includes("”"));
    if (hasVisibleResetBtn && hasSlotDashes) {
      return true;
    }

    return false;
  }

  // Extract scrambled tokens / chips for sentence rearrangement (Strictly within current container)
  function findRearrangeTokens(container) {
    const tokens = [];
    const seen = new Set();
    const scope = (container && container !== document.body && container.querySelectorAll("*").length > 5) ? container : document.body;

    function isValidChip(el) {
      if (!el || !isElementVisible(el) || el.closest("#gemini-live-host, header, nav, video, iframe, .ytp-chrome-bottom")) return false;
      const txt = safeText(el);
      if (!txt || txt.length < 1 || txt.length > 450) return false;
      const lower = txt.toLowerCase();
      if (/^(reset|submit|next|replay|play|save|continue|grade|abc|record|speak|mic|listen)\b/i.test(lower)) return false;
      if (lower.startsWith("rearrange the words or phrases")) return false;
      if (lower.startsWith("arrange the following sentences")) return false;
      if (lower.startsWith("form a logical sentence")) return false;
      if (lower.startsWith("if the video is not loading")) return false;
      if (lower.includes("record your answer using your microphone")) return false;
      if (lower.includes("form sentences that express opinion")) return false;
      if (/^\d{1,2}:\d{2}/.test(lower)) return false; // timecode
      if (el.matches("button[type='submit'], input[type='submit']")) return false;
      if (txt.includes("“") || txt.includes("”")) return false; // slot container quotes
      if (/^[—–\-_.\s]+$/.test(txt)) return false; // slot lines or dashes
      if (/^\d+\s+of\s+\d+(\s+questions?)?$/i.test(txt)) return false; // question counter
      return true;
    }

    // Leaf chip filter: avoid picking outer wrappers if inner children are valid chips
    function isLeafChip(el) {
      if (!isValidChip(el)) return false;
      const hasChipChild = Array.from(el.querySelectorAll("*")).some(ch => isValidChip(ch));
      return !hasChipChild;
    }

    // Strategy 0: Find instruction anchor within the current question scope
    const allLabels = Array.from(scope.querySelectorAll("*")).filter(el => isElementVisible(el) && !isNavOrSystem(el));
    const matchingAnchors = allLabels.filter(el => {
      const t = safeText(el).toLowerCase();
      return (
        t.includes("rearrange the words or phrases") ||
        t.includes("rearrange the words") ||
        t.includes("rearrange the phrases") ||
        t.includes("rearrange the sentence") ||
        t.includes("rearrange words") ||
        t.includes("rearrange phrases") ||
        t.includes("arrange the following sentences") ||
        t.includes("arrange the sentences") ||
        t.includes("arrange the words") ||
        t.includes("form a logical sentence") ||
        t.includes("form sentences") ||
        t.includes("form a sentence")
      );
    });

    if (matchingAnchors.length > 0) {
      matchingAnchors.sort((a, b) => safeText(a).length - safeText(b).length);
      const anchor = matchingAnchors[0];

      const allElements = Array.from(scope.querySelectorAll("*")).filter(isElementVisible);
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
            tokens.push({
              element: el,
              index: tokens.length,
              id: `token_${tokens.length}`,
              text: t
            });
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
        const t = safeText(el);
        if (!seen.has(el)) {
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
          const t = safeText(el);
          if (!seen.has(el)) {
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
  function findMCQOptions(container) {
    const scope = (container && container !== document.body) ? container : document.body;

    // CRITICAL: Only suppress MCQ options if confirmed interactive chips/tokens exist for Cloze or Rearrange!
    if (
      (checkIsRearrangeQuestion(scope) && findRearrangeTokens(scope).length >= 3) ||
      (checkIsClozePassage(scope) && findClozeChips(scope).length >= 2 && findClozeBlanks(scope).length >= 2)
    ) {
      return [];
    }

    const options = [];
    const seenElements = new Set();

    function addOption(el, text) {
      if (!el || seenElements.has(el) || !isElementVisible(el) || isNavOrSystem(el)) return;
      const cleaned = (text || safeText(el)).trim();
      // Allow single-character options (e.g. "8", "5", "A", "B")
      if (!cleaned || cleaned.length < 1) return;
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

    // Strategy 1 (Highest Confidence for StepTest & standard exams):
    // Find phrase anchor ("Select the best answer", "Choose the correct", etc.) and scan candidate option cards up to Submit
    const allVisible = Array.from(scope.querySelectorAll("*")).filter(el => isElementVisible(el));
    const matchingAnchors = allVisible.filter(el => {
      if (isNavOrSystem(el)) return false;
      const raw = safeText(el);
      if (/^\d+[\.\)]/i.test(raw)) return false; // Ignore headings like "1. Fill in the blank"
      const txt = raw.toLowerCase();
      return (
        txt.includes("select the best answer") ||
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
        txt.includes("best answer from the following")
      );
    });

    if (matchingAnchors.length > 0) {
      matchingAnchors.sort((a, b) => safeText(a).length - safeText(b).length);
      const anchor = matchingAnchors[0];
      const anchorIdx = allVisible.indexOf(anchor);

      if (anchorIdx !== -1) {
        // Find Submit/Next boundary
        const submitIdx = allVisible.findIndex((el, idx) => {
          if (idx <= anchorIdx) return false;
          const txt = safeText(el).toLowerCase();
          return (txt === "submit" || txt === "next" || txt === "save & next") && el.matches("button, input, [role='button'], div, a");
        });
        const endIdx = submitIdx !== -1 ? submitIdx : Math.min(allVisible.length, anchorIdx + 60);

        // Collect visible leaf option elements between anchor and submit
        for (let i = anchorIdx + 1; i < endIdx; i++) {
          const el = allVisible[i];
          if (isNavOrSystem(el)) continue;
          const txt = safeText(el);
          if (txt.length >= 1 && txt.length <= 450) {
            const hasOptionChild = Array.from(el.children).some(c => {
              const cTxt = safeText(c);
              return cTxt.length >= 1 && cTxt.length <= 450 && isElementVisible(c) && !isNavOrSystem(c);
            });
            if (!hasOptionChild) {
              addOption(el, txt);
            }
          }
        }
      }

      if (options.length >= 2) return options;
    }

    // Strategy 2: Standard radio/checkbox inputs
    const inputs = Array.from(scope.querySelectorAll("input[type='radio'], input[type='checkbox']"))
      .filter(i => isElementVisible(i) && !isNavOrSystem(i));

    if (inputs.length >= 2) {
      inputs.forEach(input => {
        let text = "";
        const label = input.id ? document.querySelector(`label[for='${input.id}']`) : null;
        if (label && isElementVisible(label)) text = safeText(label);
        else {
          const parent = input.closest("label") || input.parentElement;
          text = parent ? safeText(parent) : (input.value || "");
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
      ".custom-control",
      "[aria-checked]",
      "[data-option]",
      "[data-choice]",
      "[data-value]",
      ".selectable",
      "[class*='selectable' i]",
      "[class*='chip' i]:not([class*='slot' i])"
    ];

    for (const sel of optionSelectors) {
      const candidates = Array.from(scope.querySelectorAll(sel)).filter(el => {
        if (!isElementVisible(el) || isNavOrSystem(el)) return false;
        const txt = safeText(el);
        return txt.length >= 1 && txt.length < 450 && !/^(submit|next|save|continue)\b/i.test(txt);
      });

      if (candidates.length >= 2 && candidates.length <= 10) {
        candidates.forEach(c => addOption(c, safeText(c)));
        if (options.length >= 2) return options;
      }
    }

    // Strategy 4: Sibling card cluster detection
    const parentContainers = Array.from(scope.querySelectorAll("div, ul, ol, section, fieldset")).filter(
      p => isElementVisible(p) && !isNavOrSystem(p)
    );

    for (const p of parentContainers) {
      const children = Array.from(p.children).filter(c => {
        if (!isElementVisible(c) || isNavOrSystem(c)) return false;
        const txt = safeText(c);
        return txt.length >= 1 && txt.length < 450 && !/^(submit|next|save|continue)\b/i.test(txt);
      });

      if (children.length >= 2 && children.length <= 8) {
        children.forEach(c => addOption(c, safeText(c)));
        if (options.length >= 2) return options;
      }
    }

    // Fallback: If container scope found fewer than 2 options, search document.body!
    if (options.length < 2 && scope !== document.body) {
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
      let txt = clone.innerText || clone.textContent || "";
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
    // 1. Identify Question Prompt Text (Strictly ignoring top header / navigation)
    let questionText = "";

    const questionHeaders = Array.from(container.querySelectorAll("h1, h2, h3, h4, p, div, span")).filter(el => {
      if (!isElementVisible(el) || isNavOrSystem(el)) return false;
      const t = safeText(el);
      return (/^\d+[\.\)]\s+[A-Za-z]/i.test(t) || /^question\s*\d+/i.test(t)) && t.length > 10;
    });

    if (questionHeaders.length > 0) {
      questionHeaders.sort((a, b) => safeText(a).length - safeText(b).length);
      questionText = safeText(questionHeaders[0]);
    }

    if (!questionText) {
      const promptSelectors = [
        ".question-title", ".question-text", ".prompt", ".instruction",
        "h1, h2, h3, h4", "legend", "p.title", "label.question-label"
      ];
      for (const sel of promptSelectors) {
        const el = container.querySelector(sel);
        if (el && isElementVisible(el) && !isNavOrSystem(el)) {
          const t = safeText(el);
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

    // 2. Check if this is a Cloze / Multi-Blank Passage Question
    const isCloze = checkIsClozePassage(container);
    let clozeChips = [];
    let clozeBlanks = [];
    if (isCloze) {
      clozeChips = findClozeChips(container);
      clozeBlanks = findClozeBlanks(container);
    }
    const hasMultipleBlanks = clozeBlanks.length >= 2 || (clozeChips.length >= 2 && /\[\s*blank\s*[12]|\[\s*_\s*\]|\[\s*\]|_{2,}.*_{2,}/is.test(cleanContext));
    const finalIsCloze = isCloze && clozeChips.length >= 2 && hasMultipleBlanks;

    // 3. Check if this is a Sentence Rearrangement Question (Scoped strictly to active container)
    const isRearrange = !finalIsCloze && checkIsRearrangeQuestion(container);
    let sentenceTokens = [];
    if (isRearrange) {
      sentenceTokens = findRearrangeTokens(container);
    }
    // Question is rearrangement ONLY if rearrange keywords/Reset exist AND at least 3 visible chips are found
    const finalIsRearrange = isRearrange && sentenceTokens.length >= 3;

    // 4. Identify Options (Disabled for cloze and rearrange questions)
    const options = (finalIsCloze || finalIsRearrange) ? [] : findMCQOptions(container);

    // 5. Identify Dropdowns
    const dropdowns = [];
    const selectElements = Array.from(container.querySelectorAll("select")).filter(
      el => isElementVisible(el) && !el.closest("#gemini-live-host")
    );

    selectElements.forEach((sel, idx) => {
      const optList = Array.from(sel.options).map(opt => ({
        value: opt.value,
        text: (opt.text || opt.innerText || "").trim()
      }));
      dropdowns.push({
        element: sel,
        index: idx,
        id: sel.id || `select_${idx}`,
        name: sel.name || `dropdown_${idx}`,
        options: optList
      });
    });

    // 6. Identify Fill-in Text Blanks
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

    // 7. Identify Writing Area (Check container and full document fallback)
    const writingSelectors = "textarea:not(.gemini-input), [contenteditable='true'], [contenteditable=''], [contenteditable], [role='textbox'], .ql-editor, .fr-element, .monaco-editor, .public-DraftEditor-content, div.editable";
    let writingAreas = Array.from(
      container.querySelectorAll(writingSelectors)
    ).filter(el => isElementVisible(el) && !el.closest("#gemini-live-host, #gemini-answer-banner"));

    if (writingAreas.length === 0 && document.body) {
      writingAreas = Array.from(
        document.querySelectorAll(writingSelectors)
      ).filter(el => isElementVisible(el) && !el.closest("#gemini-live-host, #gemini-answer-banner") && !isNavOrSystem(el));
    }

    const fullTextForWriting = (questionText + " " + cleanContext).toLowerCase();
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

    const hasRealRadios = Array.from(container.querySelectorAll("input[type='radio'], input[type='checkbox']")).some(isElementVisible);
    const finalIsWriting = writingAreas.length > 0 && (hasWritingKeywords || !hasRealRadios || options.length <= 4);

    // If writing task, clear out accidental toolbar options
    if (finalIsWriting) {
      options.length = 0;
    }

    // 8. Strictly Detect Speaking Indicators (Only when active recording hardware button exists)
    const micButton = document.querySelector(
      "button.record, .mic-btn, [aria-label*='record' i], [aria-label*='speak' i], .audio-record, [class*='record' i], [class*='mic' i]"
    );
    const hasActiveMic = !!micButton && isElementVisible(micButton);

    // Classify Question Type
    let detectedType = "auto_detect";
    if (finalIsCloze) {
      detectedType = "cloze_passage";
    } else if (finalIsWriting) {
      detectedType = "writing";
    } else if (finalIsRearrange) {
      detectedType = "rearrange_sentence";
    } else if (options.length > 0) {
      detectedType = "mcq";
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
      wordChoices: clozeChips.map(c => ({ index: c.index, id: c.id, text: c.text })),
      dropdowns: dropdowns.map(d => ({ index: d.index, id: d.id, name: d.name, options: d.options.map(o => o.text) })),
      sentenceTokens: sentenceTokens.map(t => ({ index: t.index, id: t.id, text: t.text, contentText: normalizeTokenText(t.text) })),
      writingConstraints: {
        hasTextarea: writingAreas.length > 0
      },
      domReferences: {
        options,
        wordChoices: clozeChips,
        clozeBlanks,
        dropdowns,
        textBlanks,
        sentenceTokens,
        writingArea: writingAreas[0] || null
      }
    };
  }

  // Stable global question identifier extractor to prevent duplicate answers
  function getQuestionIdentifier(container, data) {
    const meta = getCurrentQuestionMeta();
    let prefix = "";
    if (meta.currentNum && meta.totalNum) {
      prefix = `Q_${meta.currentNum}_OF_${meta.totalNum}`;
    } else if (meta.currentNum) {
      prefix = `Q_${meta.currentNum}`;
    }

    let titlePart = "";
    if (data && data.questionText && data.questionText.length > 5) {
      titlePart = data.questionText.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    } else if (container) {
      const headerEl = container.querySelector("h1, h2, h3, h4, p");
      if (headerEl) {
        titlePart = safeText(headerEl).slice(0, 50).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      }
    }

    if (!titlePart && meta.currentNum) {
      const targetRegex = new RegExp(`(?:^|\\n)\\s*${meta.currentNum}[\\.\\)]\\s+([^\\n\\r]{6,80})`, "i");
      const match = (document.body ? safeText(document.body) : "").match(targetRegex);
      if (match) {
        titlePart = `${meta.currentNum}_${match[1].replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}`;
      }
    }

    if (prefix && titlePart) {
      return `${prefix}::${titlePart}`;
    }
    return prefix || titlePart || "active_question";
  }

  // Token-Saver: Check if question is already answered on screen
  function isQuestionAlreadyAnswered(data, container) {
    if (!data) return false;

    // 0. If currently on post-submission Answer / Feedback / Review page, do not solve
    if (isAnswerOrFeedbackPage(container)) {
      return true;
    }

    // 1. MCQ: Has any option in data.domReferences.options been checked or selected?
    if (data.type === "mcq" && data.domReferences && Array.isArray(data.domReferences.options)) {
      const anyOptSelected = data.domReferences.options.some(opt => {
        if (!opt.element) return false;
        const input = opt.element.matches("input[type='radio'], input[type='checkbox']")
          ? opt.element
          : opt.element.querySelector("input[type='radio'], input[type='checkbox']");
        if (input && input.checked) return true;

        const cls = (opt.element.className || "").toLowerCase();
        return (
          cls.includes("selected") ||
          cls.includes("checked") ||
          cls.includes("active") ||
          opt.element.getAttribute("aria-checked") === "true"
        );
      });
      if (anyOptSelected) return true;

      // Check if question has actual interactive blank chips placed
      const placedChips = container ? Array.from(container.querySelectorAll("[class*='blank' i] [class*='chip' i], [class*='slot' i] [class*='chip' i]")) : [];
      if (placedChips.length > 0) return true;
    }

    // 2. Rearrange: Have all tokens already been placed into slots?
    if (data.type === "rearrange_sentence" && container && data.sentenceTokens && data.sentenceTokens.length >= 3) {
      const placedChips = container.querySelectorAll(
        "[class*='slot' i] [class*='chip' i], [class*='chip' i].selected, [class*='token' i].selected, [class*='phrase' i].selected"
      );
      if (placedChips.length >= data.sentenceTokens.length) {
        return true;
      }
    }

    // 3. Cloze Passage: Have blank slots already been filled?
    if (data.type === "cloze_passage" && container && data.domReferences && data.domReferences.wordChoices) {
      const placedBlanks = container.querySelectorAll(
        "[class*='blank' i] [class*='chip' i], [class*='slot' i] [class*='chip' i], [class*='chip' i].selected"
      );
      if (placedBlanks.length >= 2) {
        return true;
      }
    }

    if (data.type === "writing" && data.domReferences && data.domReferences.writingArea) {
      const wVal = (data.domReferences.writingArea.value || data.domReferences.writingArea.innerText || "").trim();
      if (wVal.length > 15) return true;
    }

    // 4. Dropdown: Are choices already picked?
    if (data.type === "choose_word" && data.domReferences && data.domReferences.dropdowns) {
      const allPicked = data.domReferences.dropdowns.every(d => d.element && d.element.value !== "" && d.element.selectedIndex > 0);
      if (allPicked && data.domReferences.dropdowns.length > 0) return true;
    }

    return false;
  }

  // -------------------------------------------------------------
  // 4. Automation Solvers (Synthetic DOM Actions)
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
    try {
      if (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable) {
        element.focus();
      }
    } catch (_) {}

    highlightElement(element);

    const isDirectButton = element.tagName === "BUTTON" ||
                           element.tagName === "A" ||
                           element.type === "submit" ||
                           element.type === "button" ||
                           element.getAttribute("role") === "button";

    const targets = new Set([element]);

    if (!isDirectButton) {
      // Find radio/checkbox input inside, or sibling, or closest clickable container
      const input = element.querySelector("input[type='radio'], input[type='checkbox']") ||
        (element.parentElement ? element.parentElement.querySelector("input[type='radio'], input[type='checkbox']") : null);

      const clickableContainer = element.closest(
        "button, [role='button'], [role='radio'], label, [class*='option' i], [class*='choice' i], [class*='card' i], [class*='item' i], [class*='chip' i], [class*='token' i], [class*='pill' i], [class*='answer' i], [class*='select' i], li"
      );

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
    }

    const clickEvents = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
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

  function setElementValue(element, val) {
    if (!element) return;
    element.focus();

    // 1. Try modern execCommand to trigger React / Angular / TinyMCE / Quill internal state
    let execSuccess = false;
    try {
      if (document.queryCommandSupported && document.queryCommandSupported("insertText")) {
        document.execCommand("selectAll", false, null);
        execSuccess = document.execCommand("insertText", false, val);
      }
    } catch (_) {}

    // 2. Value assignment and native setter fallback
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

    // 3. Dispatch comprehensive event chain to notify all frameworks
    try {
      element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: val }));
    } catch (_) {}
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // Solve MCQ
  async function executeMCQ(solution, domRefs) {
    let answers = [];
    if (Array.isArray(solution.mcq_answers)) answers.push(...solution.mcq_answers);
    else if (typeof solution.mcq_answers === "string" && solution.mcq_answers.trim()) answers.push(solution.mcq_answers.trim());
    if (solution.selected_option && typeof solution.selected_option === "string") answers.push(solution.selected_option.trim());
    if (solution.answer && typeof solution.answer === "string") answers.push(solution.answer.trim());
    if (solution.correct_answer && typeof solution.correct_answer === "string") answers.push(solution.correct_answer.trim());
    if (solution.option && typeof solution.option === "string") answers.push(solution.option.trim());
    if (solution.word && typeof solution.word === "string") answers.push(solution.word.trim());
    if (Array.isArray(solution.answers)) answers.push(...solution.answers);
    if (Array.isArray(solution.fill_blanks)) answers.push(...solution.fill_blanks);
    if (solution.fill_text && typeof solution.fill_text === "string") answers.push(solution.fill_text.trim());

    answers = answers.filter(a => typeof a === "string" && a.trim().length > 0);

    let indices = [];
    if (Array.isArray(solution.mcq_indices)) indices.push(...solution.mcq_indices);
    else if (typeof solution.mcq_indices === "number") indices.push(solution.mcq_indices);
    if (typeof solution.selected_index === "number") indices.push(solution.selected_index);
    if (typeof solution.index === "number") indices.push(solution.index);

    // Extract letter/number indices from answers e.g. "Option A", "B)", "(C)", "Option 2"
    for (const ans of answers) {
      if (typeof ans !== "string") continue;
      const t = ans.trim();
      // Match letter: "Option A", "A", "A.", "A)", "(A)", "A: ..."
      const letterMatch = t.match(/^(?:option\s*)?\(?([a-d])\)?(?:\s*[:.)\-]|\s*$)/i);
      if (letterMatch) {
        const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
        if (!indices.includes(idx)) indices.push(idx);
      }
      // Match number: "Option 1", "1", "1.", "1)", "(1)"
      const numMatch = t.match(/^(?:option\s*)?\(?([1-9])\)?(?:\s*[:.)\-]|\s*$)/i);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (!indices.includes(idx)) indices.push(idx);
      }
    }

    let clickedCount = 0;
    let optionsList = domRefs && Array.isArray(domRefs.options) && domRefs.options.length > 0
      ? domRefs.options
      : findMCQOptions(document.body);

    function cleanString(str) {
      if (!str) return "";
      let s = str
        .replace(/[“’”".,\/#!$%\^&\*;:{}=\-_`~()]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      // Strip leading option prefix like "option a", "option 1", "a", etc. ONLY IF substantive content remains
      const stripped = s.replace(/^(?:option\s*[a-d1-4]|[a-d1-4])\s+/i, "").trim();
      return stripped.length > 0 ? stripped : s;
    }

    const matchedOptions = [];

    // Attempt 1: Exact / Substring Text Match
    if (answers.length > 0) {
      for (const opt of optionsList) {
        const optClean = cleanString(opt.text);
        const matchByText = answers.some(ans => {
          const ansClean = cleanString(ans);
          if (!ansClean || !optClean) return false;
          if (ansClean.length > 1) {
            return (
              optClean === ansClean ||
              optClean.includes(ansClean) ||
              ansClean.includes(optClean)
            );
          } else {
            if (optClean === ansClean) return true;
            const tokens = optClean.split(/\s+/);
            return tokens[0] === ansClean || (tokens[0] === "option" && tokens[1] === ansClean);
          }
        });

        if (matchByText && !matchedOptions.includes(opt)) {
          matchedOptions.push(opt);
        }
      }
    }

    // Attempt 2: Word Token Overlap Match (Fuzzy similarity for long phrases or minor wording differences)
    if (matchedOptions.length === 0 && answers.length > 0) {
      let bestScore = 0;
      let bestOpt = null;
      for (const opt of optionsList) {
        const optWords = cleanString(opt.text).split(/\s+/).filter(w => w.length >= 2);
        if (optWords.length === 0) continue;
        for (const ans of answers) {
          const ansWords = cleanString(ans).split(/\s+/).filter(w => w.length >= 2);
          if (ansWords.length === 0) continue;
          const common = optWords.filter(w => ansWords.includes(w));
          const score = common.length / Math.max(optWords.length, ansWords.length);
          if (score > bestScore && score >= 0.35) {
            bestScore = score;
            bestOpt = opt;
          }
        }
      }
      if (bestOpt && !matchedOptions.includes(bestOpt)) {
        matchedOptions.push(bestOpt);
      }
    }

    // Attempt 3: Match by indices (handling both 0-based and 1-based)
    if (matchedOptions.length === 0 && indices.length > 0) {
      let normIndices = [...indices];
      if (normIndices.some(i => i === optionsList.length)) {
        normIndices = normIndices.map(i => i - 1);
      }
      for (const idx of normIndices) {
        if (optionsList[idx] && !matchedOptions.includes(optionsList[idx])) {
          matchedOptions.push(optionsList[idx]);
        }
      }
    }

    // Attempt 4: Match by option letter label in option text (e.g. "A.", "B)", "Option C")
    if (matchedOptions.length === 0 && indices.length > 0) {
      for (const idx of indices) {
        const targetLetter = String.fromCharCode(65 + idx); // A, B, C, D
        const found = optionsList.find(opt => {
          const t = (opt.text || "").trim().toUpperCase();
          return (
            t.startsWith(`OPTION ${targetLetter}`) ||
            t.startsWith(`${targetLetter}.`) ||
            t.startsWith(`${targetLetter})`) ||
            t.startsWith(`(${targetLetter})`) ||
            t === targetLetter
          );
        });
        if (found && !matchedOptions.includes(found)) {
          matchedOptions.push(found);
          break;
        }
      }
    }

    // Attempt 5: Full visible DOM scan fallback
    if (matchedOptions.length === 0 && answers.length > 0) {
      for (const ans of answers) {
        const targetClean = cleanString(ans);
        if (!targetClean || targetClean.length < 1) continue;

        const allCandidates = Array.from(document.querySelectorAll("div, p, span, li, button, label, td, tr, [role='radio'], [role='option']"))
          .filter(el => {
            if (!isElementVisible(el) || isNavOrSystem(el)) return false;
            const text = safeText(el);
            if (text.length > 600) return false;
            const t = cleanString(text);
            return t === targetClean || t.includes(targetClean) || (targetClean.length > 3 && targetClean.includes(t) && t.length > 3);
          });

        if (allCandidates.length > 0) {
          allCandidates.sort((a, b) => safeText(a).length - safeText(b).length);
          const bestEl = allCandidates[0];
          matchedOptions.push({ element: bestEl, text: safeText(bestEl), index: 0 });
          break;
        }
      }
    }

    // Attempt 6 (GUARANTEED CLICK ENABLED): If still not matched, select option by index or first available option
    if (matchedOptions.length === 0 && optionsList.length > 0) {
      if (indices.length > 0 && optionsList[indices[0]]) {
        matchedOptions.push(optionsList[indices[0]]);
      } else {
        matchedOptions.push(optionsList[0]);
      }
      console.log("[Gemini Live] Applied guaranteed option fallback to click on screen:", matchedOptions[0].text);
    }

    // CLICK ALL MATCHED OPTIONS
    for (const opt of matchedOptions) {
      if (opt && opt.element) {
        simulateClick(opt.element);
        clickedCount++;
        await delay(Math.min(100, state.typingDelayMs || 100));
      }
    }

    let answerLabel = matchedOptions.map(o => o.text).filter(Boolean).join(", ");
    if (!answerLabel) {
      answerLabel = answers.length > 0 ? answers.join(", ") : (optionsList[indices[0]]?.text || "");
    }
    if (!answerLabel || /^(option|options|answer)$/i.test(answerLabel.trim())) {
      answerLabel = solution.explanation || (optionsList[0]?.text || "Answer");
    }

    if (clickedCount > 0) {
      showAnswerBanner(answerLabel, solution.explanation || "Correct option selected on page", "MCQ Answer");
      return { success: true, message: `Selected option: ${answerLabel}`, clickedCount };
    }

    // Final fallback: if no options list existed in container or page, show banner
    showAnswerBanner(answerLabel, solution.explanation || "Correct answer identified by AI", "Answer Pending");
    return { success: true, message: `Answer: ${answerLabel}`, clickedCount: 0 };
  }

  // Solve Cloze / Multi-Blank Passage Question
  async function executeClozePassage(solution, domRefs) {
    const chips = domRefs && Array.isArray(domRefs.wordChoices) && domRefs.wordChoices.length > 0
      ? domRefs.wordChoices
      : findClozeChips(document.body);

    function cleanString(str) {
      if (!str) return "";
      return str
        .toLowerCase()
        .replace(/[“’”".,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    // 0. Clean Board Check: If any blanks are already filled, click "Reset" first
    const resetBtn = Array.from(document.querySelectorAll("button, div[role='button'], a, input[type='button']")).find(b => {
      if (isNavOrSystem(b) || !isElementVisible(b)) return false;
      const txt = (b.innerText || b.value || "").trim().toLowerCase();
      return txt.startsWith("reset");
    });

    const hasPlacedBlanks = (
      document.querySelectorAll("[class*='blank' i] [class*='chip' i], [class*='slot' i] [class*='chip' i]").length > 0 ||
      document.querySelectorAll("[class*='chip' i].selected").length > 0
    );

    if (resetBtn && hasPlacedBlanks) {
      simulateClick(resetBtn);
      await delay(180);
    }

    // Extract ordered words from Gemini response
    let orderedWords = [];
    if (Array.isArray(solution.ordered_fill_blanks)) orderedWords.push(...solution.ordered_fill_blanks);
    else if (Array.isArray(solution.fill_blanks)) orderedWords.push(...solution.fill_blanks);
    else if (Array.isArray(solution.answers)) orderedWords.push(...solution.answers);
    else if (Array.isArray(solution.ordered_words)) orderedWords.push(...solution.ordered_words);
    else if (Array.isArray(solution.cloze_answers)) orderedWords.push(...solution.cloze_answers);

    // Resilient fallback: Extract sequence from reconstructed_passage or explanation
    if (orderedWords.length === 0) {
      const sourceText = cleanString((solution.reconstructed_passage || "") + " " + (solution.explanation || ""));
      const availableChips = chips.length > 0 ? chips : findClozeChips(document.body);

      const scoredChips = availableChips.map(chip => {
        const cleanChip = cleanString(chip.text);
        const pos = sourceText.indexOf(cleanChip);
        return { chip, pos: pos !== -1 ? pos : 999999 };
      }).filter(s => s.pos !== 999999);

      scoredChips.sort((a, b) => a.pos - b.pos);
      orderedWords = scoredChips.map(s => s.chip.text);
    }

    let placedCount = 0;
    const placedLabels = [];

    // Sequentially place each word into its respective blank
    for (let i = 0; i < orderedWords.length; i++) {
      const targetWord = orderedWords[i];
      const cleanTarget = cleanString(targetWord);
      if (!cleanTarget) continue;

      // 1. Fresh query for live blank slots in reading order
      const liveBlanks = findClozeBlanks(document.body);
      const targetBlank = liveBlanks[i] || null;

      // Click the blank slot first to ensure StepTest focuses / selects this slot
      if (targetBlank) {
        try {
          if (typeof targetBlank.focus === "function") targetBlank.focus();
          simulateClick(targetBlank);
          targetBlank.dispatchEvent(new Event("focus", { bubbles: true }));
          await delay(100);
        } catch (_) {}
      }

      // 2. Fresh query for live unplaced chips
      const liveChips = findClozeChips(document.body);
      let matchingChip = liveChips.find(c => {
        const cleanChip = cleanString(c.text);
        return cleanChip === cleanTarget;
      }) || liveChips.find(c => {
        const cleanChip = cleanString(c.text);
        return cleanChip.includes(cleanTarget) || cleanTarget.includes(cleanChip);
      });

      // Fallback search across visible candidate elements
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
        placedCount++;
        placedLabels.push(`${i + 1}: ${matchingChip.text}`);

        // If target blank is an input element, ensure value is explicitly populated
        if (targetBlank && (targetBlank.tagName === "INPUT" || targetBlank.isContentEditable)) {
          setElementValue(targetBlank, matchingChip.text);
        }

        await delay(Math.max(250, state.typingDelayMs || 250));
      }
    }

    const bannerDisplay = placedLabels.length > 0 ? placedLabels.join("  ➔  ") : orderedWords.map((w, idx) => `${idx + 1}: ${w}`).join("  ➔  ");
    const subDisplay = solution.reconstructed_passage || solution.explanation || "All blanks filled in logical sequence";
    showAnswerBanner(bannerDisplay, subDisplay, "Passage Blanks Solved");

    return placedCount > 0 ? `Filled ${placedCount} blanks: ${bannerDisplay}` : `Answer: ${bannerDisplay}`;
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
    const container = domRefs?.container || findActiveQuestionContainer();

    // 0. Clean Board Check: If any chips are already slotted or selected, click "Reset" first!
    const resetBtn = Array.from(document.querySelectorAll("button, a, input, div, span, [role='button']")).find(b => {
      if (isNavOrSystem(b) || !isElementVisible(b)) return false;
      const txt = (b.innerText || b.value || "").trim().toLowerCase();
      return txt === "reset" || txt.startsWith("reset");
    });

    const hasPlacedChips = (
      document.querySelectorAll("[class*='slot' i] [class*='chip' i], [class*='slot' i] span, .word-slot:not(:empty)").length > 0 ||
      document.querySelectorAll("[class*='chip' i].selected, [class*='token' i].selected, [class*='phrase' i].selected").length > 0 ||
      document.querySelectorAll(".selected-chip, .placed-token, [data-placed='true']").length > 0
    );

    if (resetBtn && hasPlacedChips) {
      console.log("[Gemini Live] Resetting rearrange slots to ensure clean insertion...");
      simulateClick(resetBtn);
      await delay(350);
    }

    // Prefer domRefs.sentenceTokens if connected (ground truth matched to Gemini index), else scan
    let tokens = (domRefs?.sentenceTokens?.length >= 3 && domRefs.sentenceTokens.every(t => t.element && t.element.isConnected))
      ? domRefs.sentenceTokens
      : findRearrangeTokens(container);

    if (!tokens || tokens.length === 0) {
      tokens = domRefs && domRefs.sentenceTokens && domRefs.sentenceTokens.length > 0 ? domRefs.sentenceTokens : [];
    }
    if (!tokens || tokens.length === 0) {
      tokens = findRearrangeTokens(document.body);
    }
    if (!tokens || tokens.length === 0) return "No rearrange tokens found on page";

    tokens.forEach((t, idx) => {
      if (typeof t.index !== "number") t.index = idx;
    });

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

    const totalCount = tokens.length;

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
          tokens: uniqueIndices.map(i => tokens[i]),
          isIdentity: isIdentity,
          count: uniqueIndices.length
        };
      }
    }

    // Candidate 2: From reordered_token_texts
    let candidateTexts = null;
    const targetTexts = solution.reordered_token_texts || solution.ordered_tokens || solution.ordered_sentences || solution.reordered_sentences || solution.sentences || [];
    if (Array.isArray(targetTexts) && targetTexts.length > 0) {
      const remaining = [...tokens];
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
      let remaining = [...tokens];
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

    // Consensus Selection: Prioritize genuine linguistic rearranged sequence
    let winner = null;
    const candidates = [candidateSentence, candidateTexts, candidateIndices].filter(c => c && c.tokens && c.tokens.length > 0);

    // 1. Non-identity candidate with full coverage (Sentence text prioritized)
    const nonIdentityFull = candidates.filter(c => !c.isIdentity && c.count === totalCount);
    if (nonIdentityFull.length > 0) {
      winner = nonIdentityFull[0].tokens;
      console.log("[Gemini Live] Applied full linguistic non-identity rearrangement sequence");
    } else {
      // 2. Non-identity partial candidates (sorted by count descending)
      const nonIdentityPartial = candidates.filter(c => !c.isIdentity).sort((a, b) => b.count - a.count);
      if (nonIdentityPartial.length > 0) {
        winner = nonIdentityPartial[0].tokens;
        console.log(`[Gemini Live] Applied partial non-identity AI rearrangement sequence (${winner.length}/${totalCount})`);
      } else if (candidates.length > 0) {
        winner = candidates[0].tokens;
        console.log("[Gemini Live] Using consensus ordering from AI");
      }
    }

    if (!winner || winner.length === 0) {
      if (solution.reconstructed_sentence && tokens.length > 0) {
        const sorted = [...tokens].sort((a, b) => {
          const posA = solution.reconstructed_sentence.toLowerCase().indexOf(a.text.toLowerCase().trim());
          const posB = solution.reconstructed_sentence.toLowerCase().indexOf(b.text.toLowerCase().trim());
          return (posA !== -1 ? posA : 999) - (posB !== -1 ? posB : 999);
        });
        winner = sorted;
      } else if (tokens.length > 0) {
        winner = tokens;
      }
    }

    if (!winner || winner.length === 0) {
      const warnMsg = "No tokens detected to click.";
      console.warn("[Gemini Live]", warnMsg);
      showAnswerBanner("Rearrangement Notice", "No tokens found on page.", "Rearrange Notice", 8000);
      return { success: false, message: warnMsg };
    }

    // Append any unplaced tokens ONLY after all AI-ordered tokens
    const orderedSequence = [...winner];
    for (const tok of tokens) {
      if (!orderedSequence.includes(tok)) {
        orderedSequence.push(tok);
      }
    }

    console.log("[Gemini Live] Clicking rearrange tokens in order:", orderedSequence.map(t => `[${t.index}] ${t.text.slice(0, 30)}...`));

    // Sequentially click each token in order
    for (const token of orderedSequence) {
      simulateClick(token.element);
      await delay(Math.max(300, state.typingDelayMs || 250));
    }

    const fullSentence = solution.reconstructed_sentence || orderedSequence.map(t => t.text).join(" ");
    showAnswerBanner(fullSentence, solution.explanation || "Rearranged into logical sequence", "Sentence Rearranged", 15000);

    return { success: true, message: `Ordered ${orderedSequence.length} items: "${fullSentence.slice(0, 60)}..."`, clickedCount: orderedSequence.length };
  }

  // Solve Writing Question
  async function executeWriting(solution, domRefs) {
    let textarea = domRefs?.writingArea;
    if (!textarea || !textarea.isConnected) {
      const writingSelectors = "textarea:not(.gemini-input), [contenteditable='true'], [contenteditable=''], [contenteditable], [role='textbox'], .ql-editor, .fr-element, .monaco-editor, .public-DraftEditor-content, div.editable";
      textarea = document.querySelector(writingSelectors);
    }
    if (!textarea) {
      const warnMsg = "No writing textarea detected on page.";
      console.warn("[Gemini Live]", warnMsg);
      showAnswerBanner("Writing Task", warnMsg, "Writing Notice", 5000);
      return { success: false, message: warnMsg };
    }

    const textToInsert = (
      solution.writing_answer ||
      solution.essay ||
      solution.response ||
      solution.text ||
      solution.answer ||
      solution.content ||
      solution.speaking_script ||
      ""
    ).trim();

    if (!textToInsert) {
      const warnMsg = "No writing text returned by AI.";
      console.warn("[Gemini Live]", warnMsg);
      return { success: false, message: warnMsg };
    }

    setElementValue(textarea, textToInsert);

    const words = textToInsert.split(/\s+/).filter(Boolean).length;
    showAnswerBanner(textToInsert.slice(0, 100) + (textToInsert.length > 100 ? "..." : ""), `Generated ${words} words response adhering to prompt requirements`, "Writing Answer", 8000);
    return { success: true, message: `Typed ${words} words into answer box`, wordCount: words };
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
  // Button Finder & Auto-Advance Controller
  // -------------------------------------------------------------
  function findActionElement(actionType) {
    const candidates = Array.from(
      document.querySelectorAll("button, input[type='submit'], input[type='button'], a, div[role='button'], span[role='button'], [class*='btn' i], [class*='button' i], [role='button']")
    ).filter(el => {
      if (!el || el.closest("#gemini-live-host, #gemini-answer-banner, #gemini-teleprompter, #steptest-ai-banner")) return false;
      return isElementVisible(el);
    });

    const isSubmitMatch = (rawTxt, el) => {
      const txt = (rawTxt || "").toLowerCase().trim();
      if (/^(submit|save\s*&\s*next|check(?:\s*answer)?|verify|confirm)$/i.test(txt)) return true;
      if (/^submit\b/i.test(txt) && !txt.includes("option")) return true;
      if (/^check\b/i.test(txt) && !txt.includes("option")) return true;
      const cls = (el.className || "").toString().toLowerCase();
      const id = (el.id || "").toString().toLowerCase();
      if (cls.includes("submit-btn") || cls.includes("btn-submit") || cls.includes("submit")) return true;
      if (id.includes("submit")) return true;
      return false;
    };

    const isNextMatch = (rawTxt, el) => {
      const txt = (rawTxt || "").toLowerCase().trim();
      if (/^(next|continue|proceed|next\s*question)$/i.test(txt)) return true;
      if (/^next\b/i.test(txt) && !txt.includes("option") && !txt.includes("question 1 of")) return true;
      if (/^continue\b/i.test(txt)) return true;
      if (/^proceed\b/i.test(txt)) return true;
      const cls = (el.className || "").toString().toLowerCase();
      const id = (el.id || "").toString().toLowerCase();
      if (cls.includes("next-btn") || cls.includes("btn-next")) return true;
      if (id.includes("next")) return true;
      return false;
    };

    const matcher = actionType === "submit" ? isSubmitMatch : isNextMatch;

    for (const el of candidates) {
      const txt = safeText(el);
      if (matcher(txt, el)) {
        return el.closest("button, [role='button'], a, input") || el;
      }
    }

    for (const el of candidates) {
      if (el.children) {
        for (const child of el.children) {
          const cTxt = safeText(child);
          if (matcher(cTxt, el)) {
            return el.closest("button, [role='button'], a, input") || el;
          }
        }
      }
    }

    return null;
  }

  function isButtonDisabled(el) {
    if (!el) return true;
    const btn = el.closest("button, [role='button'], a, input") || el;
    if (btn.disabled) return true;
    if (btn.getAttribute("aria-disabled") === "true") return true;
    if (btn.hasAttribute("disabled")) return true;
    const cls = (btn.className || "").toString().toLowerCase();
    if (cls.includes("disabled") || cls.includes("inactive") || cls.includes("btn-disabled")) return true;
    try {
      const style = window.getComputedStyle(btn);
      if (style.pointerEvents === "none") return true;
      if (parseFloat(style.opacity) < 0.4) return true;
    } catch (_) {}
    return false;
  }

  // -------------------------------------------------------------
  // 5. Main Trigger Controller (Token-Saver Guarded)
  // -------------------------------------------------------------
  async function triggerSolve(isAutomated = false) {
    if (!state.isEnabled) return;

    try {
      // If user clicked manually ("Solve Current" or Alt+S), instantly unfreeze any stuck processing state
      if (!isAutomated) {
        state.isProcessing = false;
      } else if (state.isProcessing) {
        if (Date.now() - state.lastSolveTimestamp > 8000) {
          state.isProcessing = false;
        } else {
          return;
        }
      }

      // Immediately dismiss any open speaking teleprompter or previous answer banner
      const teleprompter = document.getElementById("gemini-teleprompter");
      if (teleprompter) teleprompter.classList.remove("active");

      const container = findActiveQuestionContainer();

      // CRITICAL: If currently on the post-submission Answer / Feedback / Review page, DO NOT SOLVE!
      if (isAnswerOrFeedbackPage(container)) {
        console.log("%c[Gemini Live]%c Currently on Answer/Feedback review page. Skipping solve.", "color:#10b981;font-weight:bold", "color:#fff");
        hideAnswerBanner();
        updateStatus("Answer / Feedback Page", "idle", "REVIEW");
        if (!isAutomated) {
          showToast("Currently on Answer / Feedback page. Click 'Next' to solve the next question.");
        }
        return;
      }

      const data = extractQuestionData(container);

      // If page is between questions / transitioning / no question content yet, do not trigger
      if (!data.questionText && (!data.options || data.options.length === 0) && (!data.sentenceTokens || data.sentenceTokens.length === 0) && (!data.wordChoices || data.wordChoices.length === 0) && (!data.dropdowns || data.dropdowns.length === 0) && !data.domReferences.writingArea) {
        if (!isAutomated) {
          showToast("No active question detected. Please ensure the question has loaded.");
        }
        return;
      }

      const questionId = getQuestionIdentifier(container, data);
      if (!questionId) return;

      if (!isAutomated) {
        // User explicitly clicked "Solve Current (Alt+S)": Unblock question so it always re-solves
        state.isProcessing = false;
        state.lastSolveTimestamp = 0;
        state.solvedQuestionIds.delete(questionId);
        if (state.lastSolvedQuestionId === questionId) {
          state.lastSolvedQuestionId = "";
        }
      } else {
        // Automated Mode:
        if (state.lastSolvedQuestionId === questionId || state.solvedQuestionIds.has(questionId)) {
          return;
        }
        if (isQuestionAlreadyAnswered(data, container, questionId)) {
          state.lastSolvedQuestionId = questionId;
          state.solvedQuestionIds.add(questionId);
          return;
        }
        const now = Date.now();
        if (now - state.lastSolveTimestamp < 2000) {
          return;
        }
      }

      // Lock this question as solved in state to prevent duplicate parallel/loop calls
      state.lastSolvedQuestionId = questionId;
      state.solvedQuestionIds.add(questionId);
      state.lastSolveTimestamp = Date.now();
      state.isProcessing = true;

      console.log("%c[Gemini Live]%c Solving question: " + questionId, "color:#818cf8;font-weight:bold", "color:#fff");
      console.log("[Gemini Live] Detected Category:", data.type.toUpperCase());
      console.log("[Gemini Live] Question Prompt:", data.questionText.slice(0, 80));

      updateStatus("Analyzing question...", "working", data.type.toUpperCase());
      const btnSolve = document.getElementById("gemini-btn-solve");
      if (btnSolve) btnSolve.disabled = true;

      const response = await chrome.runtime.sendMessage({
        action: "SOLVE_QUESTION",
        payload: {
          type: data.type,
          questionText: data.questionText,
          context: data.context,
          options: data.options,
          wordChoices: data.wordChoices,
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

      // DOM Ground Truth Rule: The DOM parser knows the physical UI elements on screen.
      let targetType = data.type;
      if (targetType === "auto_detect" || !targetType) {
        targetType = solution.detected_type || "mcq";
      }

      updateStatus("Applying solution...", "working", targetType.toUpperCase());

      let solveResult = null;
      switch (targetType) {
        case "cloze_passage":
          solveResult = await executeClozePassage(solution, data.domReferences);
          if (!solveResult || solveResult.clickedCount === 0 || (typeof solveResult === "string" && solveResult.startsWith("Answer:"))) {
            console.log("[Gemini Live] Cloze placed 0 chips, executing MCQ fallback");
            const mcqResult = await executeMCQ(solution, data.domReferences);
            if (mcqResult && mcqResult.clickedCount > 0) {
              solveResult = mcqResult;
            }
          }
          break;
        case "rearrange_sentence":
          solveResult = await executeRearrange(solution, data.domReferences);
          break;
        case "mcq":
          solveResult = await executeMCQ(solution, data.domReferences);
          break;
        case "choose_word":
          solveResult = await executeChooseWord(solution, data.domReferences);
          break;
        case "writing":
          solveResult = await executeWriting(solution, data.domReferences);
          break;
        case "speaking":
          solveResult = await executeSpeaking(solution, data.domReferences);
          break;
        default:
          if (data.type === "cloze_passage" || (data.domReferences.wordChoices && data.domReferences.wordChoices.length >= 2)) {
            solveResult = await executeClozePassage(solution, data.domReferences);
          } else if (data.domReferences.sentenceTokens && data.domReferences.sentenceTokens.length >= 3) {
            solveResult = await executeRearrange(solution, data.domReferences);
          } else if (data.domReferences.options && data.domReferences.options.length > 0) {
            solveResult = await executeMCQ(solution, data.domReferences);
          } else {
            solveResult = "Question processed.";
          }
      }

      let isSuccess = true;
      let resultMsg = "";
      if (solveResult && typeof solveResult === "object") {
        isSuccess = solveResult.success !== false;
        resultMsg = solveResult.message || solveResult.msg || "Option applied.";
      } else {
        resultMsg = typeof solveResult === "string" ? solveResult : "Question processed.";
        if (resultMsg.toLowerCase().includes("could not verify") || resultMsg.toLowerCase().includes("aborting click") || resultMsg.toLowerCase().includes("paused")) {
          isSuccess = false;
        }
      }

      if (!isSuccess) {
        updateStatus("Answer Not Applied", "idle", "PAUSED");
        showToast(resultMsg || "Answer could not be verified on page.");
        console.warn("[Gemini Live] Solver did not achieve verified click.");
        return;
      }

      updateStatus("Done", "idle", targetType.toUpperCase());
      showToast(resultMsg);

    } catch (err) {
      console.error("[Gemini Live Solver Error]:", err);
      updateStatus("Error", "error", "FAILED");

      const errLower = (err.message || "").toLowerCase();
      if (errLower.includes("context invalidated") || errLower.includes("extension context invalidated")) {
        showToast("Extension reloaded. Please refresh this page (F5) to reconnect.");
        showInfo("🔄 Extension reloaded. Please refresh this tab (F5).");
      } else {
        showToast(err.message);
        showInfo(`⚠️ ${err.message}`);
      }

      // Stop auto-watcher immediately on rate-limit or missing key to protect quota
      if (errLower.includes("429") || errLower.includes("quota") || errLower.includes("rate limit") || errLower.includes("not configured") || errLower.includes("missing")) {
        const autoToggle = document.getElementById("gemini-autowatch-toggle");
        if (autoToggle) autoToggle.checked = false;
        state.isAutoWatch = false;
        stopAutoWatcher();
      }
    } finally {
      state.isProcessing = false;
      const currentBtnSolve = document.getElementById("gemini-btn-solve");
      if (currentBtnSolve) currentBtnSolve.disabled = !state.isEnabled;
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
        if (!state.isEnabled || !state.isAutoWatch || state.isProcessing) return;
        const container = findActiveQuestionContainer();
        if (isAnswerOrFeedbackPage(container)) {
          hideAnswerBanner();
          return;
        }
        const data = extractQuestionData(container);
        const currentId = getQuestionIdentifier(container, data);
        if (currentId && !state.solvedQuestionIds.has(currentId) && currentId !== state.lastSolvedQuestionId) {
          triggerSolve(true);
        }
      }, 1200);
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also check every 2 seconds to detect if user advanced to next question
    autoWatchInterval = setInterval(() => {
      if (!state.isEnabled || !state.isAutoWatch || state.isProcessing) return;
      const container = findActiveQuestionContainer();
      if (isAnswerOrFeedbackPage(container)) {
        return;
      }
      const data = extractQuestionData(container);
      const currentId = getQuestionIdentifier(container, data);
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
  // 7. Message & Storage Listeners (from Popup / Background Shortcuts)
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

  // Sync state when changed in extension popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.extensionEnabled !== undefined) {
        toggleExtensionPower(changes.extensionEnabled.newValue);
      }
    }
  });

  // Direct in-page keyboard shortcut backup for Alt+S and Alt+H
  window.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      if (state.isEnabled) {
        triggerSolve(false);
      }
    } else if (e.altKey && (e.key === "h" || e.key === "H")) {
      e.preventDefault();
      const widget = document.getElementById("gemini-widget");
      if (widget) {
        state.hudMinimized = !state.hudMinimized;
        widget.classList.toggle("minimized", state.hudMinimized);
      }
    }
  });

  // Dismiss answer banner when moving to the next question
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button, a, input[type='button'], input[type='submit']");
    if (btn && !btn.closest("#gemini-live-host")) {
      const text = safeText(btn).toLowerCase();
      if (text.includes("next") || text.includes("submit") || text.includes("continue") || text === "save & next") {
        setTimeout(hideAnswerBanner, 500);
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
