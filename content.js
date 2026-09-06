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

    // Exclude top-level page headers, navbars, progress indicators, breadcrumbs, footers
    // NOTE: Do NOT use generic [class*='header'] as that improperly excludes .question-header and .card-header
    if (el.closest("header, nav, footer, aside, [class*='top-bar' i], [class*='topbar' i], [class*='navbar' i], [class*='site-header' i], [class*='page-header' i], [class*='app-header' i], [class*='global-header' i], [class*='progress' i], [class*='breadcrumb' i]")) {
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

  function getCurrentQuestionMeta() {
    const fullText = document.body ? document.body.innerText : "";
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
        const t = el.innerText.trim();
        return /^\d+[\.\)]\s+[A-Za-z]/.test(t) || /^question\s*\d+/i.test(t);
      });
      if (headingEl) {
        const match = headingEl.innerText.trim().match(/^(\d+)[\.\)]/i) || headingEl.innerText.trim().match(/^question\s*(\d+)/i);
        if (match) currentNum = parseInt(match[1], 10);
      }
    }

    return { currentNum, totalNum };
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
        const t = el.innerText.trim();
        return (targetRegex.test(t) || altRegex.test(t)) && t.length > 5;
      });

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.innerText.trim().length - b.innerText.trim().length);
        targetHeader = candidates[0];
      }
    }

    // 3. Fallback: Find visible numbered headers in viewport
    if (!targetHeader) {
      const allHeaders = Array.from(document.querySelectorAll("h1, h2, h3, h4, p, div, span")).filter(el => {
        if (!isElementVisible(el) || isNavOrSystem(el)) return false;
        const t = el.innerText.trim();
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

        const hasOptionsOrControls = p.querySelector(
          "input, select, textarea, button, [class*='option' i], [class*='chip' i], [class*='choice' i]"
        );
        const hasSubstantialContent = p.innerText.trim().length > targetHeader.innerText.trim().length + 20;

        if (hasOptionsOrControls || hasSubstantialContent) {
          bestContainer = p;
        }

        if (
          p.classList.contains("question") ||
          p.classList.contains("question-card") ||
          p.classList.contains("quiz-card") ||
          p.classList.contains("exercise") ||
          p.getAttribute("role") === "region"
        ) {
          bestContainer = p;
          break;
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

  // Check if current question is a Sentence / Phrase Rearrangement question (Scoped strictly to current container)
  function checkIsRearrangeQuestion(container) {
    if (!container) return false;
    const pageText = (container.innerText || "").toLowerCase();
    const hasRearrangeKeywords = (
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
      pageText.includes("form a logical sentence")
    );

    // Reset button check: MUST be visible in the current container
    const hasVisibleResetBtn = Array.from(container.querySelectorAll("button, a, input[type='button'], div[role='button']"))
      .some(b => isElementVisible(b) && !isNavOrSystem(b) && (b.innerText || b.value || "").trim().toLowerCase().startsWith("reset"));

    if (hasRearrangeKeywords) return true;
    if (hasVisibleResetBtn && (pageText.includes("“") || pageText.includes("\"") || pageText.includes("sentence") || pageText.includes("phrase"))) {
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

    // Strategy 0: Find instruction anchor within the current question scope
    const allLabels = Array.from(scope.querySelectorAll("*")).filter(el => isElementVisible(el) && !isNavOrSystem(el));
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

      const allElements = Array.from(scope.querySelectorAll("*")).filter(isElementVisible);
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
  function findMCQOptions(container) {
    const scope = (container && container !== document.body) ? container : document.body;

    // CRITICAL: If this is a sentence rearrangement question, DO NOT hijack chips as MCQ options!
    if (checkIsRearrangeQuestion(scope)) {
      return [];
    }

    const options = [];
    const seenElements = new Set();

    function addOption(el, text) {
      if (!el || seenElements.has(el) || !isElementVisible(el) || isNavOrSystem(el)) return;
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

    // Strategy 1 (Highest Confidence for StepTest & standard exams):
    // Find phrase anchor ("Select the best answer", "Choose the correct", etc.) and scan candidate option cards up to Submit
    const allVisible = Array.from(scope.querySelectorAll("*")).filter(el => isElementVisible(el) && !isNavOrSystem(el));
    const matchingAnchors = allVisible.filter(el => {
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
      matchingAnchors.sort((a, b) => a.innerText.trim().length - b.innerText.trim().length);
      const anchor = matchingAnchors[0];
      const anchorIdx = allVisible.indexOf(anchor);

      if (anchorIdx !== -1) {
        // Find Submit/Next boundary
        const submitIdx = allVisible.findIndex((el, idx) => {
          if (idx <= anchorIdx) return false;
          const txt = (el.innerText || el.value || "").trim().toLowerCase();
          return el.matches("button, input[type='submit']") && (txt === "submit" || txt === "next" || txt === "save & next");
        });
        const endIdx = submitIdx !== -1 ? submitIdx : Math.min(allVisible.length, anchorIdx + 60);

        // Collect visible leaf option elements between anchor and submit
        for (let i = anchorIdx + 1; i < endIdx; i++) {
          const el = allVisible[i];
          const txt = (el.innerText || "").trim();
          if (txt.length >= 2 && txt.length <= 450) {
            const hasOptionChild = Array.from(el.children).some(c => {
              const cTxt = (c.innerText || "").trim();
              return cTxt.length >= 2 && cTxt.length <= 450 && isElementVisible(c);
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
        if (label && isElementVisible(label)) text = label.innerText.trim();
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
      const candidates = Array.from(scope.querySelectorAll(sel)).filter(el => {
        if (!isElementVisible(el) || isNavOrSystem(el)) return false;
        const txt = el.innerText.trim();
        return txt.length >= 2 && txt.length < 450 && !/^(submit|next|save|continue)\b/i.test(txt);
      });

      if (candidates.length >= 2 && candidates.length <= 10) {
        candidates.forEach(c => addOption(c, c.innerText));
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
        const txt = c.innerText.trim();
        return txt.length >= 2 && txt.length < 450 && !/^(submit|next|save|continue)\b/i.test(txt);
      });

      if (children.length >= 2 && children.length <= 8) {
        children.forEach(c => addOption(c, c.innerText));
        if (options.length >= 2) return options;
      }
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
    // 1. Identify Question Prompt Text (Strictly ignoring top header / navigation)
    let questionText = "";

    const questionHeaders = Array.from(container.querySelectorAll("h1, h2, h3, h4, p, div, span")).filter(el => {
      if (!isElementVisible(el) || isNavOrSystem(el)) return false;
      const t = el.innerText.trim();
      return (/^\d+[\.\)]\s+[A-Za-z]/i.test(t) || /^question\s*\d+/i.test(t)) && t.length > 10;
    });

    if (questionHeaders.length > 0) {
      questionHeaders.sort((a, b) => a.innerText.trim().length - b.innerText.trim().length);
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

    // 2. Check if this is a Sentence Rearrangement Question (Scoped strictly to active container)
    const isRearrange = checkIsRearrangeQuestion(container);
    let sentenceTokens = [];
    if (isRearrange) {
      sentenceTokens = findRearrangeTokens(container);
    }
    // Question is rearrangement ONLY if rearrange keywords/Reset exist AND at least 3 visible chips are found
    const finalIsRearrange = isRearrange && sentenceTokens.length >= 3;

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
    if (finalIsRearrange) {
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
        titlePart = headerEl.innerText.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      }
    }

    if (!titlePart && meta.currentNum) {
      const targetRegex = new RegExp(`(?:^|\\n)\\s*${meta.currentNum}[\\.\\)]\\s+([^\\n\\r]{6,80})`, "i");
      const match = (document.body ? document.body.innerText : "").match(targetRegex);
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
  function isQuestionAlreadyAnswered(data, container, questionId) {
    if (!data) return false;

    // 1. Explicitly marked as solved by extension
    if (container && container.getAttribute("data-gemini-solved") === "true") {
      return true;
    }
    if (questionId && (state.lastSolvedQuestionId === questionId || state.solvedQuestionIds.has(questionId))) {
      return true;
    }

    // 2. MCQ: Has any option in data.domReferences.options been checked or selected?
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
          opt.element.getAttribute("aria-checked") === "true"
        );
      });
      if (anyOptSelected) return true;
    }

    // 3. Rearrange: Have tokens already been moved or slot blanks filled?
    if (data.type === "rearrange_sentence" && container) {
      const slots = container.querySelectorAll("[class*='slot' i], [class*='blank' i], [class*='drop' i]");
      if (slots.length > 0) {
        const filledSlots = Array.from(slots).filter(s => isElementVisible(s) && s.innerText.trim().length > 0);
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
    let optionsList = domRefs && Array.isArray(domRefs.options) && domRefs.options.length > 0 ? domRefs.options : findMCQOptions(findActiveQuestionContainer());

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

    // Attempt 2 (FAILPROOF FULL-PAGE SEARCH): Search the visible DOM for elements containing the answer text
    if (clickedCount === 0 && answers.length > 0) {
      for (const ans of answers) {
        const targetClean = cleanString(ans);
        if (!targetClean || targetClean.length < 3) continue;

        const allCandidates = Array.from(document.querySelectorAll("div, p, span, li, button, label, td, tr"))
          .filter(el => {
            if (!isElementVisible(el) || isNavOrSystem(el)) return false;
            if (el.innerText.length > 600) return false; // Ignore large wrappers/passages
            const t = cleanString(el.innerText);
            return t === targetClean || t.includes(targetClean) || (targetClean.length > 15 && targetClean.includes(t) && t.length > 15);
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

    // Attempt 3: If indices specified and valid in optionsList
    if (clickedCount === 0 && indices.length > 0 && optionsList[indices[0]]) {
      simulateClick(optionsList[indices[0]].element);
      clickedCount++;
    }

    const answerLabel = answers.length > 0 ? answers.join(", ") : (optionsList[0]?.text || "Option");
    if (clickedCount > 0) {
      showAnswerBanner(answerLabel, solution.explanation || "Correct option selected on page", "MCQ Answer", 5000);
      return `Selected option: ${answerLabel}`;
    }

    // Attempt 4: If options were identified, click the first one as emergency fallback
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
    let tokens = domRefs && domRefs.sentenceTokens && domRefs.sentenceTokens.length > 0 ? domRefs.sentenceTokens : findRearrangeTokens(findActiveQuestionContainer());
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
    const data = extractQuestionData(container);

    // If page is between questions / transitioning / no question content yet, do not trigger
    if (!data.questionText && (!data.options || data.options.length === 0) && (!data.sentenceTokens || data.sentenceTokens.length === 0) && (!data.dropdowns || data.dropdowns.length === 0) && !data.domReferences.writingArea) {
      return;
    }

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

    console.log("%c[Gemini Live]%c Solving question: " + questionId, "color:#818cf8;font-weight:bold", "color:#fff");
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
        const currentId = getQuestionIdentifier(container);
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
      const currentId = getQuestionIdentifier(container);
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
      const text = (btn.innerText || btn.value || "").trim().toLowerCase();
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
