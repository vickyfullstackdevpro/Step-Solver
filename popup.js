// popup.js - Multi-API Key Pool, Supabase Auth, Single-Device Lock & UPI Lifetime Engine

document.addEventListener("DOMContentLoaded", async () => {
  const MAX_KEYS = 10;
  const BURNT_KEY = "AQ.Ab8RN6I1C1o7hEEyqfwMJUFw1TdSg-kRieVIS06703505QTCrQ";

  // Elements - Header & Views
  const statusBadge = document.getElementById("status-badge");
  const userAccountBar = document.getElementById("user-account-bar");
  const userEmailDisplay = document.getElementById("user-email-display");
  const btnSignOut = document.getElementById("btn-sign-out");

  const viewAuth = document.getElementById("view-auth");
  const viewVerify = document.getElementById("view-verify");
  const viewDeviceConflict = document.getElementById("view-device-conflict");
  const viewMain = document.getElementById("view-main");

  // Elements - Auth View
  const authTitle = document.getElementById("auth-title");
  const authSubtitle = document.getElementById("auth-subtitle");
  const tabSignIn = document.getElementById("tab-sign-in");
  const tabSignUp = document.getElementById("tab-sign-up");
  const authForm = document.getElementById("auth-form");
  const authNameGroup = document.getElementById("auth-name-group");
  const authNameInput = document.getElementById("auth-name");
  const authEmailInput = document.getElementById("auth-email");
  const authPasswordInput = document.getElementById("auth-password");
  const toggleAuthPasswordBtn = document.getElementById("toggle-auth-password");
  const btnAuthSubmit = document.getElementById("btn-auth-submit");
  const btnAuthText = document.getElementById("btn-auth-text");
  const authFeedback = document.getElementById("auth-feedback");

  // Elements - Verify View
  const verifyEmailDisplay = document.getElementById("verify-email-display");
  const verifyFeedback = document.getElementById("verify-feedback");
  const btnCheckVerified = document.getElementById("btn-check-verified");
  const btnResendVerification = document.getElementById("btn-resend-verification");
  const btnVerifySignout = document.getElementById("btn-verify-signout");

  // Elements - Conflict View
  const conflictFeedback = document.getElementById("conflict-feedback");
  const btnClaimDevice = document.getElementById("btn-claim-device");
  const btnConflictSignout = document.getElementById("btn-conflict-signout");

  // Elements - Main Settings Dashboard
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
  const btnRefreshKeys = document.getElementById("btn-refresh-keys");
  const refreshIcon = document.getElementById("refresh-icon");
  const refreshBtnText = document.getElementById("refresh-btn-text");

  // Elements - Subscription / Trial / UPI QR & Manual Verification
  const trialActiveView = document.getElementById("trial-active-view");
  const trialTimeBadge = document.getElementById("trial-time-badge");
  const trialExpiredView = document.getElementById("trial-expired-view");
  const qrPaymentSection = document.getElementById("qr-payment-section");
  const lifetimeActiveView = document.getElementById("lifetime-active-view");
  const btnGetLifetimeTrial = document.getElementById("btn-get-lifetime-trial");
  const btnCopyUpi = document.getElementById("btn-copy-upi");
  const upiIdText = document.getElementById("upi-id-text");
  const qrDetailEmail = document.getElementById("qr-detail-email");
  const qrDetailDevice = document.getElementById("qr-detail-device");
  const btnCopyEmail = document.getElementById("btn-copy-email");
  const btnCopyDevice = document.getElementById("btn-copy-device");
  const btnSendEmailLink = document.getElementById("btn-send-email-link");
  const linkSupportEmail = document.getElementById("link-support-email");
  const btnCheckManualStatus = document.getElementById("btn-check-manual-status");
  const checkStatusIcon = document.getElementById("check-status-icon");
  const checkStatusText = document.getElementById("check-status-text");
  const manualStatusFeedback = document.getElementById("manual-status-feedback");
  let authMode = "signin"; // "signin" | "signup"
  let countdownInterval = null;

  // -------------------------------------------------------------
  // 1. View Controller
  // -------------------------------------------------------------
  function switchView(viewName) {
    if (viewAuth) viewAuth.style.display = viewName === "auth" ? "flex" : "none";
    if (viewVerify) viewVerify.style.display = viewName === "verify" ? "flex" : "none";
    if (viewDeviceConflict) viewDeviceConflict.style.display = viewName === "conflict" ? "flex" : "none";
    if (viewMain) viewMain.style.display = viewName === "main" ? "flex" : "none";

    if (userAccountBar) {
      userAccountBar.style.display = (viewName === "main" || viewName === "conflict") ? "flex" : "none";
    }
  }

  // -------------------------------------------------------------
  // 2. Auth & Single-Device State Evaluator (Authoritative DB Truth)
  // -------------------------------------------------------------
  async function checkAuthAndDeviceState() {
    try {
      const session = await StepAuth.getStoredSession();
      if (!session || !session.access_token) {
        switchView("auth");
        updateHeaderStatus("Auth Required", "disconnected");
        return;
      }

      // Check session validity directly on Supabase server
      const authUser = await StepAuth.validateSessionOnServer(session);
      if (!authUser) {
        switchView("auth");
        updateHeaderStatus("Auth Required", "disconnected");
        return;
      }

      // Check user email confirmation status
      if (authUser.email_confirmed_at === null && !authUser.confirmed_at) {
        switchView("verify");
        if (verifyEmailDisplay) verifyEmailDisplay.innerText = authUser.email || session.user?.email || "";
        updateHeaderStatus("Verify Email", "disconnected");
        return;
      }

      const userEmail = authUser.email || session.user?.email || "";
      if (userEmailDisplay) userEmailDisplay.innerText = userEmail;
      if (verifyEmailDisplay) verifyEmailDisplay.innerText = userEmail;

      // Live Single-Device Concurrency Verification from Supabase Database
      const concurrency = await StepAuth.verifyDeviceConcurrency();

      if (!concurrency.isAuthenticated) {
        switchView("auth");
        updateHeaderStatus("Auth Required", "disconnected");
        return;
      }

      if (concurrency.isDeviceActive === false) {
        switchView("conflict");
        if (conflictFeedback) {
          const otherDevice = concurrency.conflictDeviceName || "another machine";
          conflictFeedback.innerText = `Account currently active on ${otherDevice}. Single-device lock enabled.`;
          conflictFeedback.className = "auth-feedback error";
          conflictFeedback.style.display = "block";
        }
        updateHeaderStatus("Conflict", "disconnected");
        return;
      }

      // Concurrency verified and active on this device!
      switchView("main");
      updateHeaderStatus("Ready", "connected");

      // 1. Sync authoritative cloud user profile from Supabase (payment_status, trial_started_at)
      await StepAuth.syncUserProfile(session);

      // 2. Check and update subscription & trial status
      await updateSubscriptionUI();

    } catch (err) {
      console.warn("[Popup] Auth check error:", err);
      switchView("auth");
      updateHeaderStatus("Error", "disconnected");
    }
  }

  function updateHeaderStatus(text, type) {
    if (!statusBadge) return;
    statusBadge.innerText = text;
    statusBadge.className = `status-badge ${type}`;
  }

  // -------------------------------------------------------------
  // 3. Auth Form Event Handlers (Sign In / Sign Up)
  // -------------------------------------------------------------
  if (tabSignIn && tabSignUp) {
    tabSignIn.addEventListener("click", () => setAuthMode("signin"));
    tabSignUp.addEventListener("click", () => setAuthMode("signup"));
  }

  function setAuthMode(mode) {
    authMode = mode;
    clearAuthFeedback();
    if (mode === "signin") {
      tabSignIn.classList.add("active");
      tabSignUp.classList.remove("active");
      if (authNameGroup) authNameGroup.style.display = "none";
      if (authTitle) authTitle.innerText = "Welcome to Step Solver";
      if (authSubtitle) authSubtitle.innerText = "Sign in to access your AI solver and active subscription.";
      if (btnAuthText) btnAuthText.innerText = "Sign In";
    } else {
      tabSignUp.classList.add("active");
      tabSignIn.classList.remove("active");
      if (authNameGroup) authNameGroup.style.display = "block";
      if (authTitle) authTitle.innerText = "Create Your Account";
      if (authSubtitle) authSubtitle.innerText = "Get a 30-minute free trial with full AI solving unlocked.";
      if (btnAuthText) btnAuthText.innerText = "Create Account & Start Trial";
    }
  }

  if (toggleAuthPasswordBtn && authPasswordInput) {
    toggleAuthPasswordBtn.addEventListener("click", () => {
      const isPassword = authPasswordInput.type === "password";
      authPasswordInput.type = isPassword ? "text" : "password";
      toggleAuthPasswordBtn.innerText = isPassword ? "🙈" : "👁️";
    });
  }

  if (authForm) {
    authForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = (authEmailInput?.value || "").trim();
      const password = (authPasswordInput?.value || "").trim();
      const fullName = (authNameInput?.value || "").trim();

      if (!email || !password) {
        showAuthFeedback("Please provide both email and password.", "error");
        return;
      }

      if (password.length < 6) {
        showAuthFeedback("Password must be at least 6 characters.", "error");
        return;
      }

      setAuthButtonLoading(true);
      clearAuthFeedback();

      if (authMode === "signin") {
        try {
          showAuthFeedback("Signing in and checking device session...", "info");
          await StepAuth.authSignIn(email, password);
          showAuthFeedback("✓ Signed in successfully!", "success");
          setTimeout(async () => {
            await checkAuthAndDeviceState();
          }, 600);
        } catch (err) {
          if (err.code === "EMAIL_NOT_CONFIRMED") {
            if (verifyEmailDisplay) verifyEmailDisplay.innerText = email;
            switchView("verify");
            showVerifyFeedback("Please verify your email address. We sent a link from support.vickydevsolutions@gmail.com.", "info");
          } else {
            showAuthFeedback(err.message || "Failed to sign in. Please check credentials.", "error");
          }
        } finally {
          setAuthButtonLoading(false);
        }
      } else {
        try {
          showAuthFeedback("Creating account & sending confirmation email...", "info");
          await StepAuth.authSignUp(email, password, fullName);
          
          if (verifyEmailDisplay) verifyEmailDisplay.innerText = email;
          switchView("verify");
          showVerifyFeedback("✓ Confirmation email sent! Please check your inbox (or spam) and click the link.", "success");
        } catch (err) {
          showAuthFeedback(err.message || "Sign up failed. Please try again.", "error");
        } finally {
          setAuthButtonLoading(false);
        }
      }
    });
  }

  function setAuthButtonLoading(isLoading) {
    if (!btnAuthSubmit || !btnAuthText) return;
    btnAuthSubmit.disabled = isLoading;
    btnAuthText.innerText = isLoading ? "Processing..." : (authMode === "signin" ? "Sign In" : "Create Account & Start Trial");
  }

  function showAuthFeedback(text, type) {
    if (!authFeedback) return;
    authFeedback.innerText = text;
    authFeedback.className = `auth-feedback ${type}`;
    authFeedback.style.display = "block";
  }

  function clearAuthFeedback() {
    if (!authFeedback) return;
    authFeedback.innerText = "";
    authFeedback.style.display = "none";
  }

  // -------------------------------------------------------------
  // 4. Verification View Event Handlers
  // -------------------------------------------------------------
  if (btnCheckVerified) {
    btnCheckVerified.addEventListener("click", async () => {
      btnCheckVerified.disabled = true;
      btnCheckVerified.innerText = "Verifying...";
      try {
        const email = verifyEmailDisplay?.innerText || authEmailInput?.value;
        const session = await StepAuth.getStoredSession();
        if (session) {
          const authUser = await StepAuth.validateSessionOnServer(session);
          if (authUser && (authUser.email_confirmed_at || authUser.confirmed_at)) {
            showVerifyFeedback("✓ Email confirmed! Loading solver...", "success");
            setTimeout(() => checkAuthAndDeviceState(), 800);
            return;
          }
        }
        
        // Otherwise switch to sign-in so user can enter password and log in
        showVerifyFeedback("Account ready! Please sign in to activate your session.", "info");
        setTimeout(() => {
          setAuthMode("signin");
          switchView("auth");
          if (authEmailInput && email) authEmailInput.value = email;
          if (authPasswordInput) authPasswordInput.focus();
        }, 1000);
      } catch (err) {
        showVerifyFeedback("Please check your email and click the confirmation link.", "error");
      } finally {
        btnCheckVerified.disabled = false;
        btnCheckVerified.innerText = "✓ I've Verified My Email";
      }
    });
  }

  if (btnResendVerification) {
    btnResendVerification.addEventListener("click", async () => {
      const email = verifyEmailDisplay?.innerText || authEmailInput?.value;
      if (!email) {
        showVerifyFeedback("Please enter your email to resend link.", "error");
        return;
      }
      btnResendVerification.disabled = true;
      btnResendVerification.innerText = "Sending...";
      try {
        await StepAuth.requestEmailConfirmationResend(email);
        showVerifyFeedback("✓ Confirmation email resent! Please check your inbox or spam.", "success");
      } catch (err) {
        const msg = (err.message && err.message.includes("only request this after"))
          ? "Please wait a few seconds before requesting another email."
          : (err.message || "Failed to resend email.");
        showVerifyFeedback(msg, "error");
      } finally {
        setTimeout(() => {
          btnResendVerification.disabled = false;
          btnResendVerification.innerText = "📨 Resend Verification Link";
        }, 2000);
      }
    });
  }

  if (btnVerifySignout) {
    btnVerifySignout.addEventListener("click", async () => {
      await StepAuth.authSignOut();
      switchView("auth");
    });
  }

  function showVerifyFeedback(text, type) {
    if (!verifyFeedback) return;
    verifyFeedback.innerText = text;
    verifyFeedback.className = `auth-feedback ${type}`;
    verifyFeedback.style.display = "block";
  }

  // -------------------------------------------------------------
  // 5. Single-Device Concurrency Conflict Handlers
  // -------------------------------------------------------------
  if (btnClaimDevice) {
    btnClaimDevice.addEventListener("click", async () => {
      btnClaimDevice.disabled = true;
      btnClaimDevice.innerText = "Claiming Device...";
      if (conflictFeedback) conflictFeedback.style.display = "none";

      try {
        await StepAuth.claimThisDevice();
        if (conflictFeedback) {
          conflictFeedback.innerText = "✓ This device is now registered as your active session!";
          conflictFeedback.className = "auth-feedback success";
          conflictFeedback.style.display = "block";
        }
        setTimeout(async () => {
          await checkAuthAndDeviceState();
        }, 800);
      } catch (err) {
        if (conflictFeedback) {
          conflictFeedback.innerText = err.message || "Failed to claim device lock.";
          conflictFeedback.className = "auth-feedback error";
          conflictFeedback.style.display = "block";
        }
      } finally {
        btnClaimDevice.disabled = false;
        btnClaimDevice.innerText = "🔒 Use On This Device Instead";
      }
    });
  }

  if (btnConflictSignout) {
    btnConflictSignout.addEventListener("click", async () => {
      await StepAuth.authSignOut();
      switchView("auth");
    });
  }

  if (btnSignOut) {
    btnSignOut.addEventListener("click", async () => {
      await StepAuth.authSignOut();
      switchView("auth");
      updateHeaderStatus("Auth Required", "disconnected");
    });
  }

  // -------------------------------------------------------------
  // 6. Subscription, 30-Min Trial & UPI QR Payment Engine
  // -------------------------------------------------------------
  async function updateSubscriptionUI() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "GET_SUBSCRIPTION_STATUS" });
      if (!response || !response.success) return;

      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }

      // Populate user details for QR verification instructions
      populateQrUserDetails();

      // Case 1: Lifetime Access Unlocked
      if (response.isLifetime) {
        if (trialActiveView) trialActiveView.style.display = "none";
        if (trialExpiredView) trialExpiredView.style.display = "none";
        if (qrPaymentSection) qrPaymentSection.style.display = "none";
        if (lifetimeActiveView) lifetimeActiveView.style.display = "flex";
        return;
      }

      // Case 2: Trial Expired -> Show Trial Expired Banner & UPI QR Code Section
      if (response.isTrialExpired) {
        if (trialActiveView) trialActiveView.style.display = "none";
        if (trialExpiredView) trialExpiredView.style.display = "flex";
        if (qrPaymentSection) qrPaymentSection.style.display = "flex";
        if (lifetimeActiveView) lifetimeActiveView.style.display = "none";
        return;
      }

      // Case 3: Free Trial Active (< 30 Minutes)
      if (trialActiveView) trialActiveView.style.display = "flex";
      if (trialExpiredView) trialExpiredView.style.display = "none";
      if (lifetimeActiveView) lifetimeActiveView.style.display = "none";

      let remainingMs = response.remainingMs || 0;

      function renderCountdown() {
        if (remainingMs <= 0) {
          if (trialActiveView) trialActiveView.style.display = "none";
          if (trialExpiredView) trialExpiredView.style.display = "flex";
          if (qrPaymentSection) qrPaymentSection.style.display = "flex";
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

  // Open Gmail web compose tab with prefilled recipient, subject, and details
  async function openGmailComposeTab() {
    try {
      const session = await StepAuth.getStoredSession();
      const userEmail = session?.user?.email || "customer@example.com";
      const deviceId = await StepAuth.getOrCreateDeviceId();

      const to = "support.vickydevsolutions@gmail.com";
      const subject = "Step Solver Lifetime Payment Verification";
      const body = `Hi Vicky,\n\nI have completed the ₹50 UPI payment for Step Solver Lifetime Access.\n\nMy Details:\n- Registered Email: ${userEmail}\n- Device ID: ${deviceId}\n\nPlease find attached my payment screenshot showing the Transaction / UTR ID.\n\nThank you!`;

      const gmailComposeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: gmailComposeUrl });
      } else {
        window.open(gmailComposeUrl, "_blank");
      }
    } catch (err) {
      console.warn("[Gmail] Open notice:", err);
    }
  }

  // Populate registered details for payment screenshot email
  async function populateQrUserDetails() {
    try {
      const session = await StepAuth.getStoredSession();
      const userEmail = session?.user?.email || "customer@example.com";
      const deviceId = await StepAuth.getOrCreateDeviceId();

      if (qrDetailEmail) qrDetailEmail.innerText = userEmail;
      if (qrDetailDevice) qrDetailDevice.innerText = deviceId;
    } catch (_) {}
  }

  // Bind Open in Gmail button
  if (btnSendEmailLink) {
    btnSendEmailLink.addEventListener("click", (e) => {
      e.preventDefault();
      openGmailComposeTab();
    });
  }

  // Bind support email link in Step 3
  if (linkSupportEmail) {
    linkSupportEmail.addEventListener("click", (e) => {
      e.preventDefault();
      openGmailComposeTab();
    });
  }

  // Toggle QR payment card during active free trial
  if (btnGetLifetimeTrial) {
    btnGetLifetimeTrial.addEventListener("click", () => {
      if (!qrPaymentSection) return;
      const isVisible = qrPaymentSection.style.display === "flex";
      qrPaymentSection.style.display = isVisible ? "none" : "flex";
      btnGetLifetimeTrial.innerText = isVisible ? "⭐ Upgrade to Lifetime Access (₹50)" : "▲ Hide Payment QR Code";
      if (!isVisible) {
        populateQrUserDetails();
        qrPaymentSection.scrollIntoView({ behavior: "smooth" });
      }
    });
  }

  // Copy UPI ID button
  if (btnCopyUpi) {
    btnCopyUpi.addEventListener("click", () => {
      const upi = upiIdText ? upiIdText.innerText.trim() : "vicky636501@oksbi";
      navigator.clipboard.writeText(upi).then(() => {
        const originalText = btnCopyUpi.innerText;
        btnCopyUpi.innerText = "✓ Copied!";
        setTimeout(() => { btnCopyUpi.innerText = originalText; }, 1800);
      }).catch(() => {});
    });
  }

  // Copy Registered Email button
  if (btnCopyEmail) {
    btnCopyEmail.addEventListener("click", () => {
      const email = qrDetailEmail ? qrDetailEmail.innerText.trim() : "";
      if (!email) return;
      navigator.clipboard.writeText(email).then(() => {
        btnCopyEmail.innerText = "✓";
        setTimeout(() => { btnCopyEmail.innerText = "📋"; }, 1800);
      }).catch(() => {});
    });
  }

  // Copy Device ID button
  if (btnCopyDevice) {
    btnCopyDevice.addEventListener("click", () => {
      const dev = qrDetailDevice ? qrDetailDevice.innerText.trim() : "";
      if (!dev) return;
      navigator.clipboard.writeText(dev).then(() => {
        btnCopyDevice.innerText = "✓";
        setTimeout(() => { btnCopyDevice.innerText = "📋"; }, 1800);
      }).catch(() => {});
    });
  }

  // Check Activation Status button
  if (btnCheckManualStatus) {
    btnCheckManualStatus.addEventListener("click", async () => {
      btnCheckManualStatus.disabled = true;
      if (checkStatusIcon) checkStatusIcon.style.animation = "spin 1s linear infinite";
      if (checkStatusText) checkStatusText.innerText = "Checking Database...";
      if (manualStatusFeedback) {
        manualStatusFeedback.style.display = "none";
        manualStatusFeedback.className = "manual-status-feedback";
      }

      try {
        const statusRes = await StepAuth.checkManualPaymentStatus();
        if (statusRes && statusRes.isPaid) {
          if (manualStatusFeedback) {
            manualStatusFeedback.className = "manual-status-feedback success";
            manualStatusFeedback.innerText = "✓ Lifetime Access Verified & Activated!";
            manualStatusFeedback.style.display = "block";
          }
          await chrome.storage.local.set({ isLifetimeActive: true });
          setTimeout(async () => {
            await updateSubscriptionUI();
          }, 1200);
        } else {
          if (manualStatusFeedback) {
            manualStatusFeedback.className = "manual-status-feedback pending";
            manualStatusFeedback.innerText = "⏳ Status: Unpaid / Pending Verification. If you have sent your screenshot to support.vickydevsolutions@gmail.com, please allow a few moments for approval.";
            manualStatusFeedback.style.display = "block";
          }
        }
      } catch (err) {
        if (manualStatusFeedback) {
          manualStatusFeedback.className = "manual-status-feedback pending";
          manualStatusFeedback.innerText = "Unable to reach verification server. Please check your internet connection.";
          manualStatusFeedback.style.display = "block";
        }
      } finally {
        btnCheckManualStatus.disabled = false;
        if (checkStatusIcon) checkStatusIcon.style.animation = "none";
        if (checkStatusText) checkStatusText.innerText = "Check Activation Status";
      }
    });
  }

  // -------------------------------------------------------------
  // 7. General Settings: Master Power, Pacing, Developer Link
  // -------------------------------------------------------------
  const toggleAnswerPopup = document.getElementById("toggle-answer-popup");
  const answerPopupBadge = document.getElementById("answer-popup-badge");
  const toggleAutoSubmit = document.getElementById("toggle-auto-submit");
  const autoSubmitBadge = document.getElementById("auto-submit-badge");
  const modalAutoSubmitWarning = document.getElementById("modal-auto-submit-warning");
  const btnCancelAutoSubmit = document.getElementById("btn-cancel-auto-submit");
  const btnConfirmAutoSubmit = document.getElementById("btn-confirm-auto-submit");

  const stored = await chrome.storage.local.get([
    "geminiApiKeys",
    "activeKeyIndex",
    "geminiApiKey",
    "geminiModel",
    "typingDelayMs",
    "extensionEnabled",
    "answerPopupEnabled",
    "autoSubmitEnabled"
  ]);

  const isEnabled = stored.extensionEnabled !== false;
  if (masterPowerToggle) {
    masterPowerToggle.checked = isEnabled;
    updatePowerUI(isEnabled);

    masterPowerToggle.addEventListener("change", async (e) => {
      const enabled = e.target.checked;
      updatePowerUI(enabled);
      await chrome.storage.local.set({ extensionEnabled: enabled });
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

  // Answer Popup Toggle (Default: ON / true)
  const isAnswerPopup = stored.answerPopupEnabled !== false;
  if (toggleAnswerPopup) {
    toggleAnswerPopup.checked = isAnswerPopup;
    updateAnswerPopupUI(isAnswerPopup);

    toggleAnswerPopup.addEventListener("change", async (e) => {
      const val = e.target.checked;
      updateAnswerPopupUI(val);
      await chrome.storage.local.set({ answerPopupEnabled: val });
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, {
            action: "ANSWER_POPUP_TOGGLED",
            enabled: val
          }).catch(() => {});
        });
      });
    });
  }

  function updateAnswerPopupUI(enabled) {
    if (!answerPopupBadge) return;
    if (enabled) {
      answerPopupBadge.innerText = "ON";
      answerPopupBadge.className = "badge-pill active";
    } else {
      answerPopupBadge.innerText = "OFF";
      answerPopupBadge.className = "badge-pill off";
    }
  }

  // Auto-Submit Toggle with Disclaimer Warning Modal (Default: OFF / false)
  let isAutoSubmit = stored.autoSubmitEnabled === true;
  if (toggleAutoSubmit) {
    toggleAutoSubmit.checked = isAutoSubmit;
    updateAutoSubmitUI(isAutoSubmit);

    toggleAutoSubmit.addEventListener("click", (e) => {
      const targetChecked = toggleAutoSubmit.checked;
      if (targetChecked) {
        // Turning ON: Must show warning confirmation modal
        e.preventDefault();
        toggleAutoSubmit.checked = false;
        if (modalAutoSubmitWarning) {
          modalAutoSubmitWarning.style.display = "flex";
        }
      } else {
        // Turning OFF: No modal needed
        isAutoSubmit = false;
        updateAutoSubmitUI(false);
        chrome.storage.local.set({ autoSubmitEnabled: false });
        notifyAutoSubmitToggled(false);
      }
    });
  }

  if (btnCancelAutoSubmit) {
    btnCancelAutoSubmit.addEventListener("click", () => {
      if (modalAutoSubmitWarning) modalAutoSubmitWarning.style.display = "none";
      if (toggleAutoSubmit) toggleAutoSubmit.checked = false;
      updateAutoSubmitUI(false);
    });
  }

  if (btnConfirmAutoSubmit) {
    btnConfirmAutoSubmit.addEventListener("click", async () => {
      if (modalAutoSubmitWarning) modalAutoSubmitWarning.style.display = "none";
      isAutoSubmit = true;
      if (toggleAutoSubmit) toggleAutoSubmit.checked = true;
      updateAutoSubmitUI(true);
      await chrome.storage.local.set({ autoSubmitEnabled: true });
      notifyAutoSubmitToggled(true);
      showFeedback("✓ Auto-Submit enabled with safety protections.", "success");
    });
  }

  function updateAutoSubmitUI(enabled) {
    if (!autoSubmitBadge) return;
    if (enabled) {
      autoSubmitBadge.innerText = "ON";
      autoSubmitBadge.className = "badge-pill active";
    } else {
      autoSubmitBadge.innerText = "OFF";
      autoSubmitBadge.className = "badge-pill off";
    }
  }

  function notifyAutoSubmitToggled(enabled) {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, {
          action: "AUTO_SUBMIT_TOGGLED",
          enabled: enabled
        }).catch(() => {});
      });
    });
  }

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

  const devPortfolioLink = document.getElementById("dev-portfolio-link");
  if (devPortfolioLink) {
    devPortfolioLink.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: "https://vignesh-fullstackdev-portfolio.vercel.app/" });
    });
  }

  // -------------------------------------------------------------
  // 8. Gemini API Key Pool Management (Max 10)
  // -------------------------------------------------------------
  if (toggleKeyVisibilityBtn && newKeyInput) {
    toggleKeyVisibilityBtn.addEventListener("click", () => {
      const isPassword = newKeyInput.type === "password";
      newKeyInput.type = isPassword ? "text" : "password";
      toggleKeyVisibilityBtn.innerText = isPassword ? "🙈" : "👁️";
    });
  }

  let keys = Array.isArray(stored.geminiApiKeys) ? [...stored.geminiApiKeys] : [];
  let activeIndex = typeof stored.activeKeyIndex === "number" ? stored.activeKeyIndex : 0;

  keys = keys.filter(k => k && k.key && k.key.trim() !== BURNT_KEY);

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

  if (activeIndex >= keys.length) {
    activeIndex = Math.max(0, keys.length - 1);
  }

  renderKeysList();

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

    if (keys.some(k => k.key === rawKey)) {
      showFeedback("This API key is already in your pool.", "error");
      return;
    }

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

  function renderKeysList() {
    if (!keysListContainer) return;
    keysListContainer.innerHTML = "";

    if (keyCountBadge) {
      keyCountBadge.innerText = `${keys.length} / ${MAX_KEYS}`;
      if (keys.length >= MAX_KEYS) {
        keyCountBadge.classList.add("limit-reached");
      } else {
        keyCountBadge.classList.remove("limit-reached");
      }
    }

    if (activeModelName) {
      if (keys.length > 0 && keys[activeIndex]) {
        activeModelName.innerText = keys[activeIndex].model || "Auto-Selected";
      } else {
        activeModelName.innerText = "None (Add Key)";
      }
    }

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

    keys.forEach((keyItem, index) => {
      const isCurrentActive = index === activeIndex;
      const rawStatus = keyItem.status || (isCurrentActive ? "active" : "standby");
      const itemStatus = (isCurrentActive && rawStatus !== "exhausted" && rawStatus !== "invalid") ? "active" : rawStatus;

      const itemEl = document.createElement("div");
      itemEl.className = `key-item ${itemStatus}${isCurrentActive ? " active" : ""}`;

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

      const btnActivate = itemEl.querySelector(".btn-key-activate");
      if (btnActivate) {
        btnActivate.addEventListener("click", async () => {
          await activateKey(index);
        });
      }

      const btnDelete = itemEl.querySelector(".btn-key-delete");
      if (btnDelete) {
        btnDelete.addEventListener("click", async () => {
          await deleteKey(index);
        });
      }

      keysListContainer.appendChild(itemEl);
    });
  }

  async function activateKey(index) {
    if (index < 0 || index >= keys.length) return;
    activeIndex = index;

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

  async function deleteKey(index) {
    if (index < 0 || index >= keys.length) return;

    keys.splice(index, 1);

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

      const { total, restored, ready, exhausted } = response.stats || {};
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

  // -------------------------------------------------------------
  // Initial Boot: Check Authentication & Single-Device State
  // -------------------------------------------------------------
  await checkAuthAndDeviceState();
});
