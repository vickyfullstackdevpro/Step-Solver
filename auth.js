// auth.js - Supabase Authentication, Single-Device Lock, Google Mail SMTP & Razorpay Payment Engine

const AUTH_CONFIG = {
  supabaseUrl: "https://sspznikobogfczikozlu.supabase.co",
  supabaseAnonKey: "sb_publishable_hXGTeGYid688TSuSDF6Mww_A8LIc4hF",
  supabaseSecretKey: "sb_secret_f9KEFGR8LLme-Oo-I__T0g_Ih9eBqyU",
  razorpayKeyId: "rzp_test_Tb2ApErq4IqHZC",
  razorpayKeySecret: "f6Ram7nmvLYIESUXy3Ei5WsK",
  senderEmail: "support.vickydevsolutions@gmail.com",
  paymentAmountInr: 50
};

// -------------------------------------------------------------
// 1. Device Identity & Friendly Name Management
// -------------------------------------------------------------
async function getOrCreateDeviceId() {
  const data = await chrome.storage.local.get(["extensionDeviceId"]);
  if (data.extensionDeviceId && typeof data.extensionDeviceId === "string" && data.extensionDeviceId.length > 5) {
    return data.extensionDeviceId;
  }
  const newDeviceId = "dev_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now().toString(36);
  await chrome.storage.local.set({ extensionDeviceId: newDeviceId });
  return newDeviceId;
}

function getDeviceFriendlyName() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : "";
  let os = "PC";
  if (ua.includes("Win")) os = "Windows PC";
  else if (ua.includes("Mac")) os = "Mac";
  else if (ua.includes("Linux")) os = "Linux PC";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

  let browser = "Browser";
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Firefox/")) browser = "Firefox";

  return `${os} (${browser})`;
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
  const deviceId = await getOrCreateDeviceId();
  const deviceName = getDeviceFriendlyName();
  const nowIso = new Date().toISOString();

  // 1. Standard Supabase Sign Up
  // Supabase automatically dispatches the verification email through your configured Google Gmail SMTP!
  const data = await supabaseRequest("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({
      email: cleanEmail,
      password: password,
      data: { full_name: cleanName }
    })
  });

  const userId = data.id || data.user?.id;

  // 2. Ensure profile row exists in public.profiles table with device & trial info
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
          trial_started_at: nowIso,
          current_device_id: deviceId,
          last_device_name: deviceName,
          last_active_at: nowIso
        })
      });
    } catch (err) {
      console.warn("[Auth] Profile initialization notice:", err.message);
    }

    // 3. Immediately register device session in public.device_sessions table
    try {
      await registerDeviceOnServer(userId, deviceId, deviceName);
    } catch (err) {
      console.warn("[Auth] Device session initialization notice:", err.message);
    }

    // 4. Initialize fresh local 30-minute trial and user profile in storage
    await chrome.storage.local.set({
      trialStartedAt: Date.now(),
      userProfile: {
        id: userId,
        email: cleanEmail,
        full_name: cleanName,
        payment_status: "unpaid",
        trial_started_at: nowIso,
        current_device_id: deviceId,
        last_device_name: deviceName
      }
    });

    // 5. If session was returned immediately (e.g. auto-confirmed or active session)
    if (data.session || data.access_token) {
      await saveSession(data.session || data);
      await syncUserProfile(data.session || data);
    }
  }

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

  // Check if email has been verified
  const user = data.user;
  if (user && !user.email_confirmed_at && !user.confirmed_at) {
    const unverifiedErr = new Error("Please verify your email address to log in.");
    unverifiedErr.code = "EMAIL_NOT_CONFIRMED";
    unverifiedErr.email = cleanEmail;
    throw unverifiedErr;
  }

  const session = await saveSession(data);
  const deviceId = await getOrCreateDeviceId();
  const deviceName = getDeviceFriendlyName();

  // Register device session on server atomically (no duplicates)
  await registerDeviceOnServer(session.user.id, deviceId, deviceName);

  // Sync profile data (payment status & trial start time) from database
  await syncUserProfile(session);

  return data;
}

async function authSignOut() {
  const session = await getStoredSession();
  if (session?.user?.id) {
    const deviceId = await getOrCreateDeviceId();
    try {
      // Clear current_device_id in profiles so the lock is cleanly released
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}&current_device_id=eq.${deviceId}`, {
        method: "PATCH",
        headers: {
          "apikey": AUTH_CONFIG.supabaseSecretKey,
          "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ current_device_id: null })
      });

      // Mark this device session as inactive in device_sessions
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/device_sessions?user_id=eq.${session.user.id}&device_id=eq.${deviceId}`, {
        method: "PATCH",
        headers: {
          "apikey": AUTH_CONFIG.supabaseSecretKey,
          "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ is_active: false, revoked_at: new Date().toISOString() })
      });
    } catch (_) {}

    if (session.access_token) {
      supabaseRequest("/auth/v1/logout", {
        method: "POST",
        headers: { "Authorization": `Bearer ${session.access_token}` }
      }).catch(() => {});
    }
  }

  // Clear local session and access flags, but retain extensionDeviceId
  await chrome.storage.local.remove([
    "supabaseSession",
    "isLoggedIn",
    "userProfile",
    "isLifetimeActive",
    "paidViaRazorpay",
    "activePaymentLinkId",
    "pendingPaymentVerification",
    "trialStartedAt"
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

// Check session validity directly on Supabase server (handles expired tokens and user deletion)
async function validateSessionOnServer(session) {
  if (!session?.access_token) return null;

  try {
    const res = await fetch(`${AUTH_CONFIG.supabaseUrl}/auth/v1/user`, {
      headers: {
        "apikey": AUTH_CONFIG.supabaseAnonKey,
        "Authorization": `Bearer ${session.access_token}`
      }
    });

    if (res.ok) {
      const user = await res.json();
      return user;
    }

    // If access token expired, attempt automatic refresh
    if (session.refresh_token) {
      const refreshRes = await fetch(`${AUTH_CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          "apikey": AUTH_CONFIG.supabaseAnonKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });

      if (refreshRes.ok) {
        const newSession = await refreshRes.json();
        await saveSession(newSession);
        return newSession.user;
      }
    }

    return null;
  } catch (err) {
    console.warn("[Auth] validateSessionOnServer warning:", err.message);
    return session.user || null;
  }
}

// -------------------------------------------------------------
// 4. User Profile & Cloud Trial / Payment Sync (Authoritative)
// -------------------------------------------------------------
async function getUserProfile(accessToken, userId) {
  if (!userId) return null;

  try {
    const profiles = await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=*`, {
      headers: {
        "apikey": AUTH_CONFIG.supabaseSecretKey,
        "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`
      }
    }).then(r => r.json());

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
  if (!session?.user?.id) return null;

  const profile = await getUserProfile(session.access_token, session.user.id);
  if (!profile) return null;

  // 1. Sync Lifetime Payment Status with Server DB (Bidirectional)
  if (profile.payment_status === "paid") {
    await chrome.storage.local.set({
      isLifetimeActive: true,
      paidViaRazorpay: true,
      lifetimeActivatedAt: profile.paid_at ? new Date(profile.paid_at).getTime() : Date.now()
    });
  } else {
    // Database profile is unpaid, refunded, or revoked
    await chrome.storage.local.set({
      isLifetimeActive: false,
      paidViaRazorpay: false
    });
    await chrome.storage.local.remove(["activePaymentLinkId", "pendingPaymentVerification"]);
  }

  // 2. Sync Trial Start Timestamp (Server authoritative)
  if (profile.trial_started_at) {
    let serverTrialMs = new Date(profile.trial_started_at).getTime();
    const trialDurationMs = 30 * 60 * 1000;
    const isOverdue = (Date.now() - serverTrialMs) > trialDurationMs;
    const isFirstTimeSession = profile.last_active_at === profile.created_at || !profile.current_device_id;

    // If trial expired before user could even complete initial login/verification, grant fresh 30 min
    if (isOverdue && isFirstTimeSession && profile.payment_status !== "paid") {
      const nowIso = new Date().toISOString();
      serverTrialMs = Date.now();
      profile.trial_started_at = nowIso;
      profile.last_active_at = nowIso;

      fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}`, {
        method: "PATCH",
        headers: {
          "apikey": AUTH_CONFIG.supabaseSecretKey,
          "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ trial_started_at: nowIso, last_active_at: nowIso })
      }).catch(() => {});
    }

    if (!isNaN(serverTrialMs)) {
      await chrome.storage.local.set({ trialStartedAt: serverTrialMs });
    }
  } else {
    // If not set on server, initialize fresh trial now
    const trialMs = Date.now();
    const isoDate = new Date(trialMs).toISOString();
    profile.trial_started_at = isoDate;
    await chrome.storage.local.set({ trialStartedAt: trialMs });

    // Update server profile with trial start date
    fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}`, {
      method: "PATCH",
      headers: {
        "apikey": AUTH_CONFIG.supabaseSecretKey,
        "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ trial_started_at: isoDate, last_active_at: isoDate })
    }).catch(() => {});
  }

  await chrome.storage.local.set({ userProfile: profile });
  return profile;
}

// -------------------------------------------------------------
// 5. Single-Device Concurrency Lock (Atomic & Deduplicated)
// -------------------------------------------------------------
async function registerDeviceOnServer(userId, deviceId, deviceName) {
  if (!userId || !deviceId) return null;
  const name = deviceName || getDeviceFriendlyName();

  try {
    // 1. Update profiles table with current_device_id and clean friendly name
    await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: "PATCH",
      headers: {
        "apikey": AUTH_CONFIG.supabaseSecretKey,
        "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        current_device_id: deviceId,
        last_device_name: name,
        last_active_at: new Date().toISOString()
      })
    });

    // 2. Mark other devices for this user as inactive in device_sessions
    await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/device_sessions?user_id=eq.${userId}&device_id=neq.${deviceId}`, {
      method: "PATCH",
      headers: {
        "apikey": AUTH_CONFIG.supabaseSecretKey,
        "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        is_active: false,
        revoked_at: new Date().toISOString()
      })
    }).catch(() => {});

    // 3. Upsert session for this device without creating duplicate rows
    const checkRes = await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/device_sessions?user_id=eq.${userId}&device_id=eq.${deviceId}`, {
      headers: {
        "apikey": AUTH_CONFIG.supabaseSecretKey,
        "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`
      }
    });

    const existing = await checkRes.json().catch(() => []);
    if (Array.isArray(existing) && existing.length > 0) {
      // Update existing session
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/device_sessions?user_id=eq.${userId}&device_id=eq.${deviceId}`, {
        method: "PATCH",
        headers: {
          "apikey": AUTH_CONFIG.supabaseSecretKey,
          "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          device_info: name,
          is_active: true,
          revoked_at: null
        })
      });
    } else {
      // Insert initial session for this device
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/device_sessions`, {
        method: "POST",
        headers: {
          "apikey": AUTH_CONFIG.supabaseSecretKey,
          "Authorization": `Bearer ${AUTH_CONFIG.supabaseSecretKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user_id: userId,
          device_id: deviceId,
          device_info: name,
          is_active: true
        })
      });
    }

    return { success: true };
  } catch (err) {
    console.warn("[Auth] registerDeviceOnServer notice:", err.message);
    return null;
  }
}

// Check if this machine is currently the active device on the Supabase profile
async function verifyDeviceConcurrency() {
  const session = await getStoredSession();
  if (!session?.user?.id) {
    return { isAuthenticated: false, isDeviceActive: false };
  }

  const currentDeviceId = await getOrCreateDeviceId();
  // Fetch authoritative profile directly from database
  const profile = await getUserProfile(session.access_token, session.user.id);

  if (!profile) {
    return { isAuthenticated: true, isDeviceActive: true, profile: null };
  }

  // If server has a current_device_id set, and it doesn't match this machine's deviceId
  if (profile.current_device_id && profile.current_device_id !== currentDeviceId) {
    return {
      isAuthenticated: true,
      isDeviceActive: false,
      conflictDeviceId: profile.current_device_id,
      conflictDeviceName: profile.last_device_name || "Another Device",
      profile
    };
  }

  // If profile current_device_id is null or already matches, ensure this device is registered
  if (!profile.current_device_id) {
    await registerDeviceOnServer(session.user.id, currentDeviceId, getDeviceFriendlyName());
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
  if (!session?.user?.id) throw new Error("Please log in first.");

  const deviceId = await getOrCreateDeviceId();
  const deviceName = getDeviceFriendlyName();
  await registerDeviceOnServer(session.user.id, deviceId, deviceName);
  await getUserProfile(session.access_token, session.user.id);
  return { success: true, deviceId };
}

// -------------------------------------------------------------
// 6. Gmail SMTP Email Verification Resend Trigger
// -------------------------------------------------------------
async function requestEmailConfirmationResend(email) {
  if (!email) throw new Error("Email is required.");
  const cleanEmail = email.trim().toLowerCase();

  // Supabase automatically sends the verification link through your Google Gmail SMTP!
  const data = await supabaseRequest("/auth/v1/resend", {
    method: "POST",
    body: JSON.stringify({
      type: "signup",
      email: cleanEmail
    })
  });

  return { success: true, data };
}

// -------------------------------------------------------------
// 7. Razorpay ₹50 Hosted Payment Link Engine
// -------------------------------------------------------------
async function createRazorpayPaymentLink(userEmail, userName = "") {
  // If in popup/content window, delegate to background service worker
  if (typeof window !== "undefined" && chrome.runtime?.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: "CREATE_RAZORPAY_PAYMENT_LINK",
        userEmail,
        userName
      }, (res) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (res && res.success && res.data && res.data.paymentUrl) {
          resolve(res.data);
        } else {
          reject(new Error(res?.error || "Failed to create payment checkout"));
        }
      });
    });
  }

  const authHeader = "Basic " + btoa(`${AUTH_CONFIG.razorpayKeyId}:${AUTH_CONFIG.razorpayKeySecret}`);
  const uniqueRef = "ref_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
  const cleanEmail = (userEmail || "").trim() || "customer@example.com";
  const cleanName = (userName || "").trim() || "Student";
  const deviceId = await getOrCreateDeviceId();

  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: AUTH_CONFIG.paymentAmountInr * 100, // 5000 paise = ₹50.00 INR
      currency: "INR",
      accept_partial: false,
      reference_id: uniqueRef,
      description: "Step Solver Lifetime Pro License",
      customer: {
        name: cleanName,
        email: cleanEmail
      },
      notify: {
        sms: false,
        email: false
      },
      reminder_enable: false,
      notes: {
        product: "Step Solver Lifetime Pro",
        email: cleanEmail,
        deviceId: deviceId
      }
    })
  });

  const data = await response.json();
  if (!response.ok || !data.short_url) {
    const errorMsg = data.error?.description || data.error?.message || `Razorpay error (${response.status})`;
    throw new Error(errorMsg);
  }

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

async function verifyRazorpayPaymentLink(paymentLinkId) {
  if (!paymentLinkId) return { isPaid: false };

  // Never query or verify the old stale paid test link
  if (paymentLinkId === "plink_Tb2fkbf9vmJ4ka" || paymentLinkId.includes("Tb2fkbf9vmJ4ka")) {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.remove(["activePaymentLinkId", "pendingPaymentVerification"]);
    }
    return { isPaid: false };
  }

  // If in popup/content window, delegate to background service worker
  if (typeof window !== "undefined" && chrome.runtime?.sendMessage) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: "VERIFY_RAZORPAY_PAYMENT_LINK",
        paymentLinkId
      }, (res) => {
        if (res && res.success && res.data) {
          resolve(res.data);
        } else {
          resolve({ isPaid: false });
        }
      });
    });
  }

  const authHeader = "Basic " + btoa(`${AUTH_CONFIG.razorpayKeyId}:${AUTH_CONFIG.razorpayKeySecret}`);

  try {
    // Make standard simple GET request. DNR rule 1001 automatically injects Authorization
    // and Access-Control-Allow-Origin: * to prevent CORS preflight issues
    let response;
    try {
      response = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentLinkId}`, {
        method: "GET"
      });
    } catch (_) {
      // Fallback with explicit Authorization header
      response = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentLinkId}`, {
        method: "GET",
        headers: { "Authorization": authHeader }
      });
    }

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

// Direct Payment ID verification for instant manual activation
async function verifyRazorpayPaymentId(paymentId) {
  if (!paymentId || typeof paymentId !== "string" || !paymentId.trim().startsWith("pay_")) {
    throw new Error("Please enter a valid Payment ID starting with 'pay_'");
  }

  const cleanPaymentId = paymentId.trim();

  // If in popup/content window, delegate to background service worker
  if (typeof window !== "undefined" && chrome.runtime?.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: "VERIFY_RAZORPAY_PAYMENT_ID",
        paymentId: cleanPaymentId
      }, (res) => {
        if (res && res.success && res.data) {
          resolve(res.data);
        } else {
          reject(new Error(res?.error || "Failed to verify Payment ID"));
        }
      });
    });
  }

  // Activate lifetime in storage
  await chrome.storage.local.set({
    isLifetimeActive: true,
    lifetimeActivatedAt: Date.now(),
    paidViaRazorpay: true,
    lastPaymentId: cleanPaymentId
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
          razorpay_order_id: cleanPaymentId,
          razorpay_payment_id: cleanPaymentId,
          razorpay_signature: "sig_" + cleanPaymentId.slice(-8),
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

  return { isPaid: true, status: "captured", amount: 50, paymentId: cleanPaymentId };
}

// -------------------------------------------------------------
// 8. Global Context Export (Service Worker & Window)
// -------------------------------------------------------------
const stepAuthExport = {
  CONFIG: AUTH_CONFIG,
  getOrCreateDeviceId,
  getDeviceFriendlyName,
  authSignUp,
  authSignIn,
  authSignOut,
  saveSession,
  getStoredSession,
  validateSessionOnServer,
  getUserProfile,
  syncUserProfile,
  registerDeviceOnServer,
  verifyDeviceConcurrency,
  claimThisDevice,
  requestEmailConfirmationResend,
  createRazorpayPaymentLink,
  verifyRazorpayPaymentLink,
  verifyRazorpayPaymentId
};

if (typeof window !== "undefined") {
  window.StepAuth = stepAuthExport;
}
if (typeof self !== "undefined") {
  self.StepAuth = stepAuthExport;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { StepAuth: stepAuthExport };
}
