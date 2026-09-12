// popup.js - Multi-API Key Pool (Max 10) & Automatic AI Model Detection

document.addEventListener("DOMContentLoaded", async () => {
  const MAX_KEYS = 10;
  const BURNT_KEY = "AQ.Ab8RN6I1C1o7hEEyqfwMJUFw1TdSg-kRieVIS06703505QTCrQ";

  // Elements
  const statusBadge = document.getElementById("status-badge");
  const masterPowerToggle = document.getElementById("master-power-toggle");
  const masterPowerStatus = document.getElementById("master-power-status");
  const keyCountBadge = document.getElementById("key-count-badge");
  const newKeyInput = document.getElementById("new-key-input");
  const toggleKeyVisibilityBtn = document.getElementById("toggle-key-visibility");
  const btnAddKey = document.getElementById("btn-add-key");
  const btnAddText = document.getElementById("btn-add-text");
  const apiStatusMsg = document.getElementById("api-status-msg");
  const keysListContainer = document.getElementById("keys-list");
  const activeModelName = document.getElementById("active-model-name");
  const speedSlider = document.getElementById("speed-slider");
  const speedValue = document.getElementById("speed-value");
  const btnOpenPlayground = document.getElementById("btn-open-playground");
  const btnRefreshKeys = document.getElementById("btn-refresh-keys");
  const refreshIcon = document.getElementById("refresh-icon");
  const refreshBtnText = document.getElementById("refresh-btn-text");

  // Subscription / Trial Elements
  const trialActiveView = document.getElementById("trial-active-view");
  const trialTimeBadge = document.getElementById("trial-time-badge");
  const trialExpiredView = document.getElementById("trial-expired-view");
  const lifetimeActiveView = document.getElementById("lifetime-active-view");
  const btnGetLifetime = document.getElementById("btn-get-lifetime");
  const btnToggleLicenseInput = document.getElementById("btn-toggle-license-input");
  const licenseInputContainer = document.getElementById("license-input-container");
  const licenseKeyInput = document.getElementById("license-key-input");
  const btnActivateLicense = document.getElementById("btn-activate-license");
  const licenseFeedback = document.getElementById("license-feedback");

  // 1. Load Initial State from chrome.storage.local
  const stored = await chrome.storage.local.get([
    "geminiApiKeys",
    "activeKeyIndex",
    "geminiApiKey",
    "geminiModel",
    "typingDelayMs",
    "extensionEnabled"
  ]);

  // Master ON/OFF Power Toggle
  const isEnabled = stored.extensionEnabled !== false;
  if (masterPowerToggle) {
    masterPowerToggle.checked = isEnabled;
    updatePowerUI(isEnabled);

    masterPowerToggle.addEventListener("change", async (e) => {
      const enabled = e.target.checked;
      updatePowerUI(enabled);
      await chrome.storage.local.set({ extensionEnabled: enabled });
      // Broadcast state to all tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, {
            action: "EXTENSION_POWER_TOGGLED",
            enabled: enabled
          }).catch(() => {});
        });
      });
    });
  }

  function updatePowerUI(enabled) {
    if (!masterPowerStatus) return;
    if (enabled) {
      masterPowerStatus.innerText = "Active & Ready";
      masterPowerStatus.className = "master-power-status active";
    } else {
      masterPowerStatus.innerText = "Paused (Disabled)";
      masterPowerStatus.className = "master-power-status disabled";
    }
  }

  // Pacing Slider
  if (stored.typingDelayMs !== undefined && speedSlider && speedValue) {
    speedSlider.value = stored.typingDelayMs;
    speedValue.innerText = `${stored.typingDelayMs} ms`;
  }
  if (speedSlider) {
    speedSlider.addEventListener("input", (e) => {
      if (speedValue) speedValue.innerText = `${e.target.value} ms`;
      chrome.storage.local.set({ typingDelayMs: parseInt(e.target.value, 10) });
    });
  }

  // Developer Portfolio Link
  const devPortfolioLink = document.getElementById("dev-portfolio-link");
  if (devPortfolioLink) {
    devPortfolioLink.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: "https://vignesh-fullstackdev-portfolio.vercel.app/" });
    });
  }

  // -------------------------------------------------------------
  // Subscription & 30-Min Free Trial Handler
  // -------------------------------------------------------------
  let countdownInterval = null;

  async function updateSubscriptionUI() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "GET_SUBSCRIPTION_STATUS" });
      if (!response || !response.success) return;

      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }

      // Case 1: Lifetime Unlocked
      if (response.isLifetime) {
        if (trialActiveView) trialActiveView.style.display = "none";
        if (trialExpiredView) trialExpiredView.style.display = "none";
        if (lifetimeActiveView) lifetimeActiveView.style.display = "flex";
        return;
      }

      // Case 2: Trial Expired
      if (response.isTrialExpired) {
        if (trialActiveView) trialActiveView.style.display = "none";
        if (trialExpiredView) trialExpiredView.style.display = "flex";
        if (lifetimeActiveView) lifetimeActiveView.style.display = "none";
        return;
      }

      // Case 3: Free Trial Active (< 30 minutes)
      if (trialActiveView) trialActiveView.style.display = "flex";
      if (trialExpiredView) trialExpiredView.style.display = "none";
      if (lifetimeActiveView) lifetimeActiveView.style.display = "none";

      let remainingMs = response.remainingMs || 0;

      function renderCountdown() {
        if (remainingMs <= 0) {
          if (trialActiveView) trialActiveView.style.display = "none";
          if (trialExpiredView) trialExpiredView.style.display = "flex";
          if (countdownInterval) clearInterval(countdownInterval);
          return;
        }

        const totalSeconds = Math.floor(remainingMs / 1000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;

        if (trialTimeBadge) {
          trialTimeBadge.innerText = mins > 0 ? `${mins}m ${secs}s Left` : `${secs}s Left`;
          if (mins < 5) {
            trialTimeBadge.classList.add("urgent");
          } else {
            trialTimeBadge.classList.remove("urgent");
          }
        }
      }

      renderCountdown();
      countdownInterval = setInterval(() => {
        remainingMs -= 1000;
        renderCountdown();
      }, 1000);

    } catch (err) {
      console.warn("[Step Solver] Subscription UI query error:", err);
    }
  }

  // Initialize Subscription UI
  updateSubscriptionUI();

  // Upgrade button (opens payment / portfolio page)
  if (btnGetLifetime) {
    btnGetLifetime.addEventListener("click", () => {
      chrome.tabs.create({ url: "https://vignesh-fullstackdev-portfolio.vercel.app/" });
    });
  }

  // Toggle activation key input visibility
  if (btnToggleLicenseInput && licenseInputContainer) {
    btnToggleLicenseInput.addEventListener("click", () => {
      const isHidden = licenseInputContainer.style.display === "none";
      licenseInputContainer.style.display = isHidden ? "flex" : "none";
      if (isHidden && licenseKeyInput) {
        licenseKeyInput.focus();
      }
    });
  }

  // Activate license key
  if (btnActivateLicense && licenseKeyInput) {
    btnActivateLicense.addEventListener("click", async () => {
      const rawKey = licenseKeyInput.value.trim();
      if (!rawKey) {
        showLicenseFeedback("Please enter your activation key.", "error");
        return;
      }

      btnActivateLicense.disabled = true;
      btnActivateLicense.innerText = "Verifying...";
      showLicenseFeedback("Validating activation key...", "info");

      try {
        const res = await chrome.runtime.sendMessage({
          action: "ACTIVATE_LICENSE_KEY",
          licenseKey: rawKey
        });

        if (!res || !res.success) {
          throw new Error(res?.error || "Invalid key. Please check your key.");
        }

        showLicenseFeedback("✓ Lifetime access unlocked successfully!", "success");
        setTimeout(() => {
          updateSubscriptionUI();
        }, 1200);

      } catch (err) {
        showLicenseFeedback(err.message, "error");
      } finally {
        btnActivateLicense.disabled = false;
        btnActivateLicense.innerText = "Activate";
      }
    });
  }

  function showLicenseFeedback(text, type) {
    if (!licenseFeedback) return;
    licenseFeedback.innerText = text;
    licenseFeedback.className = `license-feedback ${type}`;
    licenseFeedback.style.display = "block";
  }

  // Playground Button
  if (btnOpenPlayground) {
    btnOpenPlayground.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("playground.html") });
    });
  }

  // Toggle Visibility of New Key Input
  if (toggleKeyVisibilityBtn && newKeyInput) {
    toggleKeyVisibilityBtn.addEventListener("click", () => {
      const isPassword = newKeyInput.type === "password";
      newKeyInput.type = isPassword ? "text" : "password";
      toggleKeyVisibilityBtn.innerText = isPassword ? "🙈" : "👁️";
    });
  }

  // 2. Initialize Key Pool & Migrate Legacy Key
  let keys = Array.isArray(stored.geminiApiKeys) ? [...stored.geminiApiKeys] : [];
  let activeIndex = typeof stored.activeKeyIndex === "number" ? stored.activeKeyIndex : 0;

  // Filter out burned / invalid keys
  keys = keys.filter(k => k && k.key && k.key.trim() !== BURNT_KEY);

  // Backward compatibility: If no key pool exists but legacy geminiApiKey does, migrate it
  if (keys.length === 0 && stored.geminiApiKey && stored.geminiApiKey.trim() !== BURNT_KEY) {
    keys.push({
      key: stored.geminiApiKey.trim(),
      model: stored.geminiModel || "Auto-Selected",
      status: "active",
      addedAt: Date.now()
    });
    activeIndex = 0;
    await chrome.storage.local.set({
      geminiApiKeys: keys,
      activeKeyIndex: 0
    });
  }

  // Ensure activeIndex is in bounds
  if (activeIndex >= keys.length) {
    activeIndex = Math.max(0, keys.length - 1);
  }

  // Render Key Pool UI
  renderKeysList();

  // 3. Add Key & Refresh Handlers
  if (btnAddKey) {
    btnAddKey.addEventListener("click", async () => {
      await handleAddKey();
    });
  }

  if (btnRefreshKeys) {
    btnRefreshKeys.addEventListener("click", async () => {
      await handleRefreshAllKeys();
    });
  }

  if (newKeyInput) {
    newKeyInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        await handleAddKey();
      }
    });
  }

  async function handleAddKey() {
    const rawKey = newKeyInput.value.trim();

    if (!rawKey) {
      showFeedback("Please paste a valid Gemini API Key.", "error");
      return;
    }

    if (rawKey === BURNT_KEY) {
      showFeedback("That key is expired/invalid. Please provide a new key from Google AI Studio.", "error");
      return;
    }

    if (keys.length >= MAX_KEYS) {
      showFeedback(`Maximum of ${MAX_KEYS} API keys reached. Delete an existing key to add a new one.`, "error");
      return;
    }

    // Check for duplicates
    if (keys.some(k => k.key === rawKey)) {
      showFeedback("This API key is already in your pool.", "error");
      return;
    }

    // Test & auto-detect model via background script
    setAddButtonLoading(true);
    showFeedback("Testing key & auto-detecting optimal AI model...", "info");

    try {
      const response = await chrome.runtime.sendMessage({
        action: "TEST_API_KEY",
        apiKey: rawKey
      });

      if (!response || !response.success) {
        throw new Error(response?.error || "Key validation failed. Please verify the key in Google AI Studio.");
      }

      const detectedModel = response.detectedModel || "gemini-3.1-flash-lite-preview";
      const isFirstKey = keys.length === 0;

      const newKeyObj = {
        key: rawKey,
        model: detectedModel,
        status: isFirstKey ? "active" : "standby",
        addedAt: Date.now()
      };

      keys.push(newKeyObj);
      if (isFirstKey) {
        activeIndex = 0;
      }

      // Save to storage
      await chrome.storage.local.set({
        geminiApiKeys: keys,
        activeKeyIndex: activeIndex,
        geminiApiKey: keys[activeIndex].key,
        geminiModel: keys[activeIndex].model
      });

      newKeyInput.value = "";
      showFeedback(`✓ Key added successfully! Auto-selected model: ${detectedModel}`, "success");
      renderKeysList();

    } catch (err) {
      showFeedback(err.message, "error");
    } finally {
      setAddButtonLoading(false);
    }
  }

  function setAddButtonLoading(isLoading) {
    if (!btnAddKey || !btnAddText) return;
    btnAddKey.disabled = isLoading;
    btnAddText.innerText = isLoading ? "Verifying..." : "+ Add Key";
  }

  // 4. Render Keys List
  function renderKeysList() {
    if (!keysListContainer) return;
    keysListContainer.innerHTML = "";

    // Update count badge
    if (keyCountBadge) {
      keyCountBadge.innerText = `${keys.length} / ${MAX_KEYS}`;
      if (keys.length >= MAX_KEYS) {
        keyCountBadge.classList.add("limit-reached");
      } else {
        keyCountBadge.classList.remove("limit-reached");
      }
    }

    // Update Header Status Badge
    if (statusBadge) {
      if (keys.length > 0) {
        statusBadge.innerText = `Connected (${keys.length} Key${keys.length > 1 ? "s" : ""})`;
        statusBadge.className = "status-badge connected";
      } else {
        statusBadge.innerText = "Key Missing";
        statusBadge.className = "status-badge disconnected";
      }
    }

    // Update Active Model indicator
    if (activeModelName) {
      if (keys.length > 0 && keys[activeIndex]) {
        activeModelName.innerText = keys[activeIndex].model || "Auto-Selected";
      } else {
        activeModelName.innerText = "None (Add Key)";
      }
    }

    // If pool is empty, render friendly placeholder and hide refresh button
    if (keys.length === 0) {
      if (btnRefreshKeys) btnRefreshKeys.style.display = "none";
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "keys-empty-placeholder";
      emptyDiv.innerHTML = `No API keys in pool yet.<br><small style="color: #64748b;">Paste your Google AI Studio API key above and click "+ Add Key".</small>`;
      keysListContainer.appendChild(emptyDiv);
      return;
    }

    if (btnRefreshKeys) {
      btnRefreshKeys.style.display = "flex";
    }

    // Render each key card
    keys.forEach((keyItem, index) => {
      const isCurrentActive = index === activeIndex;
      const rawStatus = keyItem.status || (isCurrentActive ? "active" : "standby");
      const itemStatus = (isCurrentActive && rawStatus !== "exhausted" && rawStatus !== "invalid") ? "active" : rawStatus;

      const itemEl = document.createElement("div");
      itemEl.className = `key-item ${itemStatus}${isCurrentActive ? " active" : ""}`;

      // Mask key for safety: e.g. "AIzaSy...4X9Z"
      const masked = maskKey(keyItem.key);

      let pillText = itemStatus.toUpperCase();
      if (isCurrentActive && itemStatus !== "active") {
        pillText = `${itemStatus.toUpperCase()} (ACTIVE)`;
      }

      itemEl.innerHTML = `
        <div class="key-meta">
          <div class="key-row-top">
            <span class="key-num">#${index + 1}</span>
            <span class="key-mask" title="${keyItem.key}">${masked}</span>
            <span class="key-status-pill ${itemStatus}">${pillText}</span>
          </div>
          <div class="key-row-sub">
            <span class="key-model-tag">✨ ${keyItem.model || "Auto-Selected"}</span>
            ${keyItem.lastError ? `<span class="key-error-hint" title="${keyItem.lastError}">⚠️ Limit Error</span>` : ""}
          </div>
        </div>
        <div class="key-actions">
          ${!isCurrentActive && itemStatus !== "exhausted" && itemStatus !== "invalid" ? `<button class="btn-key-activate" data-index="${index}" title="Set as current active key">Use Now</button>` : ""}
          <button class="btn-key-delete" data-index="${index}" title="Remove this key">🗑️</button>
        </div>
      `;

      // Event: Activate Key
      const btnActivate = itemEl.querySelector(".btn-key-activate");
      if (btnActivate) {
        btnActivate.addEventListener("click", async () => {
          await activateKey(index);
        });
      }

      // Event: Delete Key
      const btnDelete = itemEl.querySelector(".btn-key-delete");
      if (btnDelete) {
        btnDelete.addEventListener("click", async () => {
          await deleteKey(index);
        });
      }

      keysListContainer.appendChild(itemEl);
    });
  }

  // Activate Key Action
  async function activateKey(index) {
    if (index < 0 || index >= keys.length) return;
    activeIndex = index;

    // Set statuses
    keys.forEach((k, idx) => {
      if (idx === activeIndex) {
        k.status = "active";
      } else if (k.status === "active") {
        k.status = "standby";
      }
    });

    await chrome.storage.local.set({
      geminiApiKeys: keys,
      activeKeyIndex: activeIndex,
      geminiApiKey: keys[activeIndex].key,
      geminiModel: keys[activeIndex].model
    });

    showFeedback(`Key #${activeIndex + 1} is now active (${keys[activeIndex].model}).`, "info");
    renderKeysList();
  }

  // Delete Key Action
  async function deleteKey(index) {
    if (index < 0 || index >= keys.length) return;

    const removed = keys.splice(index, 1)[0];

    // Adjust activeIndex if necessary
    if (activeIndex >= keys.length) {
      activeIndex = Math.max(0, keys.length - 1);
    }
    if (keys.length > 0) {
      keys[activeIndex].status = "active";
    }

    await chrome.storage.local.set({
      geminiApiKeys: keys,
      activeKeyIndex: activeIndex,
      geminiApiKey: keys[activeIndex] ? keys[activeIndex].key : "",
      geminiModel: keys[activeIndex] ? keys[activeIndex].model : ""
    });

    showFeedback(`Key #${index + 1} removed.`, "info");
    renderKeysList();
  }

  // 5. Refresh All API Keys Handler
  async function handleRefreshAllKeys() {
    if (keys.length === 0) {
      showFeedback("No API keys in pool to refresh. Add a key first.", "info");
      return;
    }

    setRefreshLoading(true);
    showFeedback("Testing all API keys to check if limits are restored...", "info");

    try {
      const response = await chrome.runtime.sendMessage({
        action: "REFRESH_ALL_KEYS"
      });

      if (!response || !response.success) {
        throw new Error(response?.error || "Failed to test API keys.");
      }

      keys = Array.isArray(response.keys) ? response.keys : keys;
      if (typeof response.activeKeyIndex === "number") {
        activeIndex = response.activeKeyIndex;
      }

      renderKeysList();

      const { total, restored, ready, exhausted, invalid } = response.stats || {};
      if (restored > 0) {
        showFeedback(`✓ Limits restored for ${restored} key(s)! (${ready} of ${total} keys ready to use)`, "success");
      } else if (ready > 0) {
        showFeedback(`✓ Verified: ${ready} of ${total} key(s) are ready to use.`, "success");
      } else if (exhausted > 0) {
        showFeedback(`⚠️ All ${exhausted} key(s) in pool are still rate-limited. Please wait 60s or add a new key.`, "error");
      } else {
        showFeedback(`Finished checking ${total} key(s).`, "info");
      }
    } catch (err) {
      showFeedback(`Refresh error: ${err.message}`, "error");
    } finally {
      setRefreshLoading(false);
    }
  }

  function setRefreshLoading(isLoading) {
    if (btnRefreshKeys) {
      btnRefreshKeys.disabled = isLoading;
    }
    if (refreshIcon) {
      if (isLoading) refreshIcon.classList.add("spinning");
      else refreshIcon.classList.remove("spinning");
    }
    if (refreshBtnText) {
      refreshBtnText.innerText = isLoading ? "Checking All API Limits..." : "Refresh All API Limits";
    }
  }

  // Keep popup synced if background rotates keys or updates storage
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      let shouldRerender = false;
      if (changes.geminiApiKeys) {
        keys = changes.geminiApiKeys.newValue || [];
        shouldRerender = true;
      }
      if (changes.activeKeyIndex) {
        activeIndex = changes.activeKeyIndex.newValue || 0;
        shouldRerender = true;
      }
      if (changes.isLifetimeActive || changes.trialStartedAt) {
        updateSubscriptionUI();
      }
      if (shouldRerender) {
        renderKeysList();
      }
    }
  });

  // Helper to mask key: "AQ.Ab8...71Xa"
  function maskKey(key) {
    if (!key) return "••••••••••••";
    const trimmed = key.trim();
    if (trimmed.length <= 12) return trimmed;
    return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
  }

  function showFeedback(text, type) {
    if (!apiStatusMsg) return;
    apiStatusMsg.innerText = text;
    apiStatusMsg.className = `api-feedback ${type}`;
    if (type === "success" || type === "info") {
      setTimeout(() => {
        if (apiStatusMsg.innerText === text) {
          apiStatusMsg.innerText = "";
          apiStatusMsg.className = "api-feedback";
        }
      }, 6000);
    }
  }
});
