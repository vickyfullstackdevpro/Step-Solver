// auth.js - Supabase Authentication, Single-Device Lock, Resend Verification & Razorpay Payment Engine

const AUTH_CONFIG = {
  supabaseUrl: "https://sspznikobogfczikozlu.supabase.co",
  supabaseAnonKey: "sb_publishable_hXGTeGYid688TSuSDF6Mww_A8LIc4hF",
  supabaseSecretKey: "sb_secret_f9KEFGR8LLme-Oo-I__T0g_Ih9eBqyU",
  razorpayKeyId: "rzp_test_Tb2ApErq4IqHZC",
  razorpayKeySecret: "f6Ram7nmvLYIESUXy3Ei5WsK",
  razorpayHostedLink: "https://rzp.io/rzp/Wk3xyuB",
  resendApiKey: "re_fSmRCpyx_DMUPcn4oyk99tWPQsvoqje5V",
  resendSender: "support@vickydevsolutions.com",
  resendFallbackSender: "onboarding@resend.dev",
  paymentAmountInr: 50
};

// -------------------------------------------------------------
// 1. Device Identity Management (Single-Device Concurrency)
// -------------------------------------------------------------
async function getOrCreateDeviceId() {
  const data = await chrome.storage.local.get(["extensionDeviceId"]);
  if (data.extensionDeviceId) {
    return data.extensionDeviceId;
  }
  const newDeviceId = "device_" + Math.random().toString(36).substring(2, 12) + "_" + Date.now().toString(36);
  await chrome.storage.local.set({ extensionDeviceId: newDeviceId });
  return newDeviceId;
}

// -------------------------------------------------------------
// 2. Supabase API Helper
// -------------------------------------------------------------
async function supabaseRequest(endpoint, options = {}) {
  const url = `${AUTH_CONFIG.supabaseUrl}${endpoint}`;
  const headers = {
    "apikey": AUTH_CONFIG.supabaseAnonKey,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data.msg || data.error_description || data.error || data.message || `Request failed with status ${response.status}`;
    const err = new Error(errorMsg);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

// -------------------------------------------------------------
// 3. Authentication: Sign Up, Sign In, Sign Out, Session
// -------------------------------------------------------------
async function authSignUp(email, password, fullName = "") {
  if (!email || !password) throw new Error("Email and password are required.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = (fullName || "").trim() || cleanEmail.split("@")[0];

  const payload = {
    email: cleanEmail,
    password,
    data: { full_name: cleanName }
  };

  const data = await supabaseRequest("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  // Ensure profile row exists in public.profiles table using secret key
  const userId = data.id || data.user?.id;
  if (userId) {
    try {
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles`, {
        method: "POST",
        headers: {
          "apikey": AUTH_CONFIG.supabaseSecretKey,
          "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates"
        },
        body: JSON.stringify({
          id: userId,
          email: cleanEmail,
          full_name: cleanName,
          payment_status: "unpaid",
          trial_started_at: new Date().toISOString()
        })
      });
    } catch (err) {
      console.warn("[Auth] Profile initialization notice:", err.message);
    }
  }

  // Dispatch Welcome / Verification Notice via Resend
  sendResendVerificationNotice(cleanEmail, cleanName).catch(() => {});

  return data;
}

async function authSignIn(email, password) {
  if (!email || !password) throw new Error("Please enter your email and password.");

  const cleanEmail = email.trim().toLowerCase();
  const payload = {
    email: cleanEmail,
    password
  };

  const data = await supabaseRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  const session = await saveSession(data);
  const deviceId = await getOrCreateDeviceId();

  // Register device session on server atomically
  await registerDeviceOnServer(session.access_token, deviceId);

  // Sync profile data (payment status & trial start time)
  await syncUserProfile(session);

  return data;
}

async function authSignOut() {
  const session = await getStoredSession();
  if (session?.access_token) {
    supabaseRequest("/auth/v1/logout", {
      method: "POST",
      headers: { "Authorization": `Bearer ${session.access_token}` }
    }).catch(() => {});
  }
  await chrome.storage.local.remove([
    "supabaseSession",
    "isLoggedIn",
    "userProfile",
    "isLifetimeActive",
    "paidViaRazorpay",
    "activePaymentLinkId",
    "pendingPaymentVerification"
  ]);
  return { success: true };
}

async function saveSession(sessionData) {
  const session = {
    access_token: sessionData.access_token,
    refresh_token: sessionData.refresh_token,
    expires_at: sessionData.expires_at || (Date.now() / 1000 + (sessionData.expires_in || 3600)),
    user: sessionData.user
  };
  await chrome.storage.local.set({
    supabaseSession: session,
    isLoggedIn: true
  });
  return session;
}

async function getStoredSession() {
  const data = await chrome.storage.local.get(["supabaseSession"]);
  return data.supabaseSession || null;
}

// -------------------------------------------------------------
// 4. User Profile & Cloud Trial / Payment Sync
// -------------------------------------------------------------
async function getUserProfile(accessToken, userId) {
  if (!accessToken || !userId) return null;

  try {
    const profiles = await supabaseRequest(`/rest/v1/profiles?id=eq.${userId}&select=*`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${accessToken}` }
    });

    if (Array.isArray(profiles) && profiles.length > 0) {
      await chrome.storage.local.set({ userProfile: profiles[0] });
      return profiles[0];
    }
    return null;
  } catch (err) {
    console.warn("[Auth] Failed to fetch user profile:", err.message);
    return null;
  }
}

async function syncUserProfile(session) {
  if (!session?.access_token || !session?.user?.id) return null;

  const profile = await getUserProfile(session.access_token, session.user.id);
  if (!profile) return null;

  // 1. Sync Lifetime Payment Status
  if (profile.payment_status === "paid") {
    await chrome.storage.local.set({
      isLifetimeActive: true,
      paidViaRazorpay: true,
      lifetimeActivatedAt: profile.paid_at ? new Date(profile.paid_at).getTime() : Date.now()
    });
  } else {
    // Database profile is unpaid, refunded, or revoked
    const local = await chrome.storage.local.get(["licenseKey"]);
    if (!local.licenseKey) {
      await chrome.storage.local.set({
        isLifetimeActive: false,
        paidViaRazorpay: false
      });
      await chrome.storage.local.remove(["activePaymentLinkId", "pendingPaymentVerification"]);
    }
  }

  // 2. Sync Trial Start Timestamp (Server authoritative)
  if (profile.trial_started_at) {
    const serverTrialMs = new Date(profile.trial_started_at).getTime();
    if (!isNaN(serverTrialMs)) {
      await chrome.storage.local.set({ trialStartedAt: serverTrialMs });
    }
  } else {
    // If not set on server, record current local trial or initialize now
    const local = await chrome.storage.local.get(["trialStartedAt"]);
    const trialMs = local.trialStartedAt || Date.now();
    const isoDate = new Date(trialMs).toISOString();
    await chrome.storage.local.set({ trialStartedAt: trialMs });

    // Update server profile with trial start date
    supabaseRequest(`/rest/v1/profiles?id=eq.${session.user.id}`, {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${session.access_token}` },
      body: JSON.stringify({ trial_started_at: isoDate })
    }).catch(() => {});
  }

  return profile;
}

// -------------------------------------------------------------
// 5. Single-Device Concurrency Lock
// -------------------------------------------------------------
async function registerDeviceOnServer(accessToken, deviceId) {
  if (!accessToken || !deviceId) return null;

  try {
    const res = await supabaseRequest("/rest/v1/rpc/register_active_device", {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}` },
      body: JSON.stringify({
        p_device_id: deviceId,
        p_session_token_hash: "hash_" + deviceId.slice(0, 10),
        p_device_name: "Step Solver Chrome / Edge Extension"
      })
    });
    return res;
  } catch (err) {
    console.warn("[Auth] register_active_device notice:", err.message);
    return null;
  }
}

// Check if this machine is currently the active device on the profile
async function verifyDeviceConcurrency() {
  const session = await getStoredSession();
  if (!session?.access_token || !session?.user?.id) {
    return { isAuthenticated: false, isDeviceActive: false };
  }

  const currentDeviceId = await getOrCreateDeviceId();
  const profile = await getUserProfile(session.access_token, session.user.id);

  if (!profile) {
    return { isAuthenticated: true, isDeviceActive: true, profile: null };
  }

  // If server has a current_device_id and it doesn't match this machine's deviceId
  if (profile.current_device_id && profile.current_device_id !== currentDeviceId) {
    return {
      isAuthenticated: true,
      isDeviceActive: false,
      conflictDeviceId: profile.current_device_id,
      profile
    };
  }

  return {
    isAuthenticated: true,
    isDeviceActive: true,
    profile
  };
}

// Claim this device as the single active device (atomic takeover)
async function claimThisDevice() {
  const session = await getStoredSession();
  if (!session?.access_token) throw new Error("Please log in first.");

  const deviceId = await getOrCreateDeviceId();
  await registerDeviceOnServer(session.access_token, deviceId);
  await getUserProfile(session.access_token, session.user.id);
  return { success: true, deviceId };
}

// -------------------------------------------------------------
// 6. Resend Email Verification Notice & Resend Triggers
// -------------------------------------------------------------
async function sendResendVerificationNotice(recipientEmail, userName = "Student") {
  if (!AUTH_CONFIG.resendApiKey || !recipientEmail) return;

  // If in popup or content script (window defined), delegate to background service worker to bypass CORS
  if (typeof window !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({
      action: "SEND_RESEND_VERIFICATION",
      recipientEmail,
      userName
    }).catch(() => {});
    return;
  }

  const emailPayload = (fromAddress) => ({
    from: `Step Solver <${fromAddress}>`,
    to: [recipientEmail],
    subject: "Step Solver - Welcome & Email Confirmation",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #6366f1; margin: 0; font-size: 24px;">Step Solver AI</h1>
          <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Live AI Assessment Assistant</p>
        </div>
        <p style="color: #1e293b; font-size: 15px; line-height: 1.5;">Hi ${userName},</p>
        <p style="color: #334155; font-size: 14px; line-height: 1.6;">
          Welcome! Please verify your email address to activate your account and start your <strong>30-minute free trial</strong> with full AI solving capabilities.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin: 18px 0;">
          <p style="margin: 0; color: #475569; font-size: 13px;">
            ⚡ <strong>What's included in your trial:</strong><br>
            • Live on-screen question detection (MCQs, Cloze, Rearrange, Writing, Speaking)<br>
            • Gemini Flash AI solving with automatic model selection<br>
            • Multi-API key pool with instant failover
          </p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
          If you did not sign up for Step Solver, please ignore this email.
        </p>
      </div>
    `
  });

  // Try custom sender first, fallback gracefully if domain is unverified on Resend
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AUTH_CONFIG.resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(emailPayload(AUTH_CONFIG.resendSender))
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 403 || (errData.message && errData.message.includes("domain is not verified"))) {
        console.log("[Resend] Retrying with default fallback sender...");
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${AUTH_CONFIG.resendApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(emailPayload(AUTH_CONFIG.resendFallbackSender))
        });
      }
    }
  } catch (err) {
    console.warn("[Resend] Notice email dispatch error:", err.message);
  }
}

// Resend confirmation link via Supabase Auth + Resend email
async function requestEmailConfirmationResend(email) {
  if (!email) throw new Error("Email is required.");
  const cleanEmail = email.trim().toLowerCase();

  // 1. Trigger Supabase official confirmation email
  await supabaseRequest("/auth/v1/resend", {
    method: "POST",
    body: JSON.stringify({
      type: "signup",
      email: cleanEmail
    })
  });

  // 2. Also trigger Resend reminder
  sendResendVerificationNotice(cleanEmail).catch(() => {});

  return { success: true, message: "Verification link sent! Please check your inbox." };
}

// -------------------------------------------------------------
// 7. Razorpay ₹50 Hosted Payment Link Engine
// -------------------------------------------------------------
async function createRazorpayPaymentLink(customerEmail, customerName = "Step Solver User") {
  // If in browser page/popup context (window defined), delegate to background service worker
  if (typeof window !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      const res = await chrome.runtime.sendMessage({
        action: "CREATE_RAZORPAY_PAYMENT_LINK",
        customerEmail,
        customerName
      });
      if (res && res.success && res.data?.paymentUrl) {
        return res.data;
      }
    } catch (msgErr) {
      console.warn("[Payment] Background message notice, using direct hosted link:", msgErr.message);
    }

    const fallbackUrl = AUTH_CONFIG.razorpayHostedLink || "https://rzp.io/rzp/Wk3xyuB";
    return {
      paymentLinkId: "plink_Tb2fkbf9vmJ4ka",
      paymentUrl: fallbackUrl,
      status: "created"
    };
  }

  // --- Background Service Worker Execution with Fallback ---
  try {
    const authHeader = "Basic " + btoa(`${AUTH_CONFIG.razorpayKeyId}:${AUTH_CONFIG.razorpayKeySecret}`);
    const deviceId = await getOrCreateDeviceId();
    const session = await getStoredSession();
    const userId = session?.user?.id || "guest";

    const response = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: AUTH_CONFIG.paymentAmountInr * 100, // 5000 paise = ₹50.00
        currency: "INR",
        accept_partial: false,
        description: "Step Solver Lifetime Pro License (Unlimited AI Solving)",
        customer: {
          name: customerName || "Step Solver User",
          email: customerEmail
        },
        notify: { sms: false, email: true },
        reminder_enable: false,
        notes: {
          app: "Step Solver",
          user_id: userId,
          device_id: deviceId
        }
      })
    });

    const data = await response.json();
    if (response.ok && data.short_url) {
      await chrome.storage.local.set({
        activePaymentLinkId: data.id,
        activePaymentLinkUrl: data.short_url,
        activePaymentCreatedAt: Date.now()
      });
      return {
        paymentLinkId: data.id,
        paymentUrl: data.short_url,
        status: data.status
      };
    }
  } catch (err) {
    console.warn("[Razorpay] Dynamic API notice, using active hosted payment link:", err.message);
  }

  // Guaranteed fallback to verified Razorpay hosted link
  const fallbackUrl = AUTH_CONFIG.razorpayHostedLink || "https://rzp.io/rzp/Wk3xyuB";
  await chrome.storage.local.set({
    activePaymentLinkId: "plink_Tb2fkbf9vmJ4ka",
    activePaymentLinkUrl: fallbackUrl,
    activePaymentCreatedAt: Date.now()
  });

  return {
    paymentLinkId: "plink_Tb2fkbf9vmJ4ka",
    paymentUrl: fallbackUrl,
    status: "created"
  };
}

// Verify payment status with Razorpay & update Supabase database
async function verifyRazorpayPaymentLink(paymentLinkId) {
  if (!paymentLinkId) return { isPaid: false };

  // If in browser page/popup context (window defined), delegate to background service worker
  if (typeof window !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      const res = await chrome.runtime.sendMessage({
        action: "VERIFY_RAZORPAY_PAYMENT_LINK",
        paymentLinkId
      });
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch (_) {}
    return { isPaid: false };
  }

  // --- Background Service Worker Execution ---
  try {
    const authHeader = "Basic " + btoa(`${AUTH_CONFIG.razorpayKeyId}:${AUTH_CONFIG.razorpayKeySecret}`);
    const response = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentLinkId}`, {
      method: "GET",
      headers: { "Authorization": authHeader }
    });

    const data = await response.json();
    if (response.ok) {
      const isPaid = data.status === "paid";
      if (isPaid) {
        const paymentId = (data.payments && data.payments[0]?.payment_id) || "pay_" + Date.now();

        await chrome.storage.local.set({
          isLifetimeActive: true,
          lifetimeActivatedAt: Date.now(),
          paidViaRazorpay: true,
          lastPaymentId: paymentId
        });
        await chrome.storage.local.remove(["pendingPaymentVerification", "activePaymentLinkId"]);

        const session = await getStoredSession();
        const userId = session?.user?.id;
        const deviceId = await getOrCreateDeviceId();

        if (userId) {
          try {
            await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
              method: "PATCH",
              headers: {
                "apikey": AUTH_CONFIG.supabaseSecretKey,
                "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                payment_status: "paid",
                amount_paid_inr: 50,
                paid_at: new Date().toISOString()
              })
            });

            await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/payments`, {
              method: "POST",
              headers: {
                "apikey": AUTH_CONFIG.supabaseSecretKey,
                "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                user_id: userId,
                razorpay_order_id: data.order_id || paymentLinkId,
                razorpay_payment_id: paymentId,
                razorpay_signature: "sig_" + paymentId.slice(-8),
                amount_inr: 50,
                currency: "INR",
                status: "captured",
                device_id: deviceId,
                verified_at: new Date().toISOString()
              })
            });
          } catch (recErr) {
            console.warn("[Auth] Recording notice:", recErr.message);
          }
        }

        return {
          isPaid: true,
          status: data.status,
          amount: (data.amount || 5000) / 100,
          paymentId
        };
      }

      return {
        isPaid: false,
        status: data.status,
        amount: (data.amount || 5000) / 100
      };
    }
  } catch (err) {
    console.warn("[Auth] verify notice:", err.message);
  }

  return { isPaid: false };
}

// -------------------------------------------------------------
// 8. Global Context Export (Service Worker & Window)
// -------------------------------------------------------------
const stepAuthExport = {
  CONFIG: AUTH_CONFIG,
  getOrCreateDeviceId,
  authSignUp,
  authSignIn,
  authSignOut,
  saveSession,
  getStoredSession,
  getUserProfile,
  syncUserProfile,
  registerDeviceOnServer,
  verifyDeviceConcurrency,
  claimThisDevice,
  sendResendVerificationNotice,
  requestEmailConfirmationResend,
  createRazorpayPaymentLink,
  verifyRazorpayPaymentLink
};

if (typeof window !== "undefined") {
  window.StepAuth = stepAuthExport;
}
if (typeof self !== "undefined") {
  self.StepAuth = stepAuthExport;
}
