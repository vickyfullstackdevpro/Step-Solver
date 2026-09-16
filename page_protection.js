// page_protection.js - Main World Anti-Tab-Switching & Active Session Shield
// Executes directly in the web page execution context (world: "MAIN")

(function () {
  "use strict";

  if (window.__STEP_PAGE_PROTECTION_INITIALIZED__) return;
  window.__STEP_PAGE_PROTECTION_INITIALIZED__ = true;

  // Active Protection Settings (Synchronized from extension storage via postMessage)
  const protectionState = {
    antiTabSwitchEnabled: true,
    keepWebsiteActiveEnabled: true
  };

  // Try to restore last known settings from sessionStorage if available
  try {
    const cached = sessionStorage.getItem("__step_solver_protection_state__");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (typeof parsed.antiTabSwitchEnabled === "boolean") protectionState.antiTabSwitchEnabled = parsed.antiTabSwitchEnabled;
      if (typeof parsed.keepWebsiteActiveEnabled === "boolean") protectionState.keepWebsiteActiveEnabled = parsed.keepWebsiteActiveEnabled;
    }
  } catch (_) {}

  // -------------------------------------------------------------
  // 1. Anti-Tab-Switching: Override Document Visibility & Focus APIs
  // -------------------------------------------------------------
  try {
    // Override Document.prototype.visibilityState
    const docProto = Document.prototype;
    const origVisState = Object.getOwnPropertyDescriptor(docProto, "visibilityState") ||
                         Object.getOwnPropertyDescriptor(document, "visibilityState");

    Object.defineProperty(document, "visibilityState", {
      get: function () {
        if (protectionState.antiTabSwitchEnabled) {
          return "visible";
        }
        return origVisState && origVisState.get ? origVisState.get.call(this) : "visible";
      },
      configurable: true,
      enumerable: true
    });

    // Override Document.prototype.hidden
    const origHidden = Object.getOwnPropertyDescriptor(docProto, "hidden") ||
                       Object.getOwnPropertyDescriptor(document, "hidden");

    Object.defineProperty(document, "hidden", {
      get: function () {
        if (protectionState.antiTabSwitchEnabled) {
          return false;
        }
        return origHidden && origHidden.get ? origHidden.get.call(this) : false;
      },
      configurable: true,
      enumerable: true
    });

    // Override document.hasFocus()
    const origHasFocus = docProto.hasFocus || document.hasFocus;
    document.hasFocus = function () {
      if (protectionState.antiTabSwitchEnabled) {
        return true;
      }
      return origHasFocus ? origHasFocus.call(this) : true;
    };
  } catch (err) {
    console.warn("[Step Solver Shield] Failed to patch visibility properties:", err);
  }

  // -------------------------------------------------------------
  // 2. Intercept & Suppress Tab-Switching and Window Blur Events
  // -------------------------------------------------------------
  const guardedEvents = [
    "visibilitychange",
    "webkitvisibilitychange",
    "mozvisibilitychange",
    "msvisibilitychange",
    "blur",
    "focusout",
    "pagehide"
  ];

  guardedEvents.forEach(evtName => {
    // Capture phase on window
    window.addEventListener(evtName, (e) => {
      if (protectionState.antiTabSwitchEnabled) {
        e.stopImmediatePropagation && e.stopImmediatePropagation();
        e.stopPropagation && e.stopPropagation();
      }
    }, true);

    // Capture phase on document
    document.addEventListener(evtName, (e) => {
      if (protectionState.antiTabSwitchEnabled) {
        e.stopImmediatePropagation && e.stopImmediatePropagation();
        e.stopPropagation && e.stopPropagation();
      }
    }, true);
  });

  // Patch inline handler properties (e.g. window.onblur = ..., document.onvisibilitychange = ...)
  try {
    let internalOnBlur = null;
    Object.defineProperty(window, "onblur", {
      get: () => internalOnBlur,
      set: (fn) => {
        if (typeof fn === "function") {
          internalOnBlur = function (e) {
            if (protectionState.antiTabSwitchEnabled) return;
            return fn.apply(this, arguments);
          };
        } else {
          internalOnBlur = null;
        }
      },
      configurable: true
    });

    let internalOnVisChange = null;
    Object.defineProperty(document, "onvisibilitychange", {
      get: () => internalOnVisChange,
      set: (fn) => {
        if (typeof fn === "function") {
          internalOnVisChange = function (e) {
            if (protectionState.antiTabSwitchEnabled) return;
            return fn.apply(this, arguments);
          };
        } else {
          internalOnVisChange = null;
        }
      },
      configurable: true
    });
  } catch (_) {}

  // -------------------------------------------------------------
  // 3. Keep Website Active: Anti-Idle Heartbeat & Background Audio Keep-Alive
  // -------------------------------------------------------------
  let audioContext = null;

  function ensureBackgroundKeepAlive() {
    if (!protectionState.keepWebsiteActiveEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx && !audioContext) {
        audioContext = new AudioCtx();
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        // Set gain to near-zero (inaudible) so Chrome treats tab as active audio playback
        gain.gain.value = 0.00001;
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start();
      }
      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
    } catch (_) {}
  }

  // Periodic synthetic interaction pulse to prevent platform idle/timeout detectors
  let activePulseTimer = null;
  function startActivePulse() {
    if (activePulseTimer) clearInterval(activePulseTimer);
    activePulseTimer = setInterval(() => {
      if (!protectionState.keepWebsiteActiveEnabled) return;

      try {
        // Dispatch micro-movement event to keep platform idle timers active
        const evt = new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: Math.floor(Math.random() * 20) + 5,
          clientY: Math.floor(Math.random() * 20) + 5
        });
        document.dispatchEvent(evt);
      } catch (_) {}

      // Keep audio context awake
      ensureBackgroundKeepAlive();
    }, 20000); // Pulse every 20 seconds
  }

  // -------------------------------------------------------------
  // 4. Communication Channel with Extension Content Script
  // -------------------------------------------------------------
  window.addEventListener("message", (e) => {
    if (!e || !e.data || e.data.source !== "STEP_SOLVER_CONTENT") return;

    if (e.data.type === "SYNC_PROTECTION_SETTINGS") {
      const s = e.data.settings;
      if (s) {
        if (typeof s.antiTabSwitchEnabled === "boolean") {
          protectionState.antiTabSwitchEnabled = s.antiTabSwitchEnabled;
        }
        if (typeof s.keepWebsiteActiveEnabled === "boolean") {
          protectionState.keepWebsiteActiveEnabled = s.keepWebsiteActiveEnabled;
          if (protectionState.keepWebsiteActiveEnabled) {
            ensureBackgroundKeepAlive();
          }
        }
        try {
          sessionStorage.setItem("__step_solver_protection_state__", JSON.stringify(protectionState));
        } catch (_) {}
      }
    }
  });

  // Start active heartbeat
  startActivePulse();

  // Listen for user gesture to enable AudioContext if suspended by browser
  window.addEventListener("click", ensureBackgroundKeepAlive, { once: true });
  window.addEventListener("keydown", ensureBackgroundKeepAlive, { once: true });

  console.log("%c[Step Solver Shield]%c Anti-Tab-Switching & Active Keep-Alive active.", "color:#10b981;font-weight:bold", "color:#fff");
})();
