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

  // 3. Add Key Handler
  if (btnAddKey) {
    btnAddKey.addEventListener("click", async () => {
      await handleAddKey();
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

      const detectedModel = response.detectedModel || "gemini-3.6-flash";
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

    // If pool is empty, render friendly placeholder
    if (keys.length === 0) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "keys-empty-placeholder";
      emptyDiv.innerHTML = `No API keys in pool yet.<br><small style="color: #64748b;">Paste your Google AI Studio API key above and click "+ Add Key".</small>`;
      keysListContainer.appendChild(emptyDiv);
      return;
    }

    // Render each key card
    keys.forEach((keyItem, index) => {
      const isActive = index === activeIndex;
      const status = isActive ? "active" : (keyItem.status || "standby");

      const itemEl = document.createElement("div");
      itemEl.className = `key-item ${status}`;

      // Mask key for safety: e.g. "AIzaSy...4X9Z"
      const masked = maskKey(keyItem.key);

      itemEl.innerHTML = `
        <div class="key-meta">
          <div class="key-row-top">
            <span class="key-num">#${index + 1}</span>
            <span class="key-mask" title="${keyItem.key}">${masked}</span>
            <span class="key-status-pill ${status}">${status}</span>
          </div>
          <div class="key-row-sub">
            <span class="key-model-tag">✨ ${keyItem.model || "Auto-Selected"}</span>
          </div>
        </div>
        <div class="key-actions">
          ${!isActive ? `<button class="btn-key-activate" data-index="${index}" title="Set as current active key">Use Now</button>` : ""}
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

  // Helper to mask key: "AIzaSyDa...71Xa"
  function maskKey(key) {
    if (!key) return "••••••••••••";
    const trimmed = key.trim();
    if (trimmed.length <= 12) return trimmed;
    return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
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
