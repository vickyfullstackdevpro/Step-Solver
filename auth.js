const AUTH_CONFIG = {
  supabaseUrl: "https://sspznikobogfczikozlu.supabase.co",
  supabaseAnonKey: "sb_publishable_hXGTeGYid688TSuSDF6Mww_A8LIc4hF",
  supabaseSecretKey: "sb_publishable_hXGTeGYid688TSuSDF6Mww_A8LIc4hF",
  supportEmail: "support.vickydevsolutions@gmail.com",
  upiId: "vicky636501@oksbi",
  upiName: "Vicky",
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

  // Character filtering: Disallow < > and HTML/script injection tags
  if (/[<>]/.test(email) || /[<>]/.test(password) || /[<>]/.test(fullName)) {
    throw new Error("Invalid characters (<>) detected. Please use alphanumeric characters and standard punctuation.");
  }

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

  // 2. Ensure profile row exists in public.profiles table with device info
  if (userId) {
    try {
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles`, {
        method: "POST",
        headers: {
          "apikey": AUTH_CONFIG.supabaseAnonKey,
          "Authorization": `Bearer ${AUTH_CONFIG.supabaseAnonKey}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates"
        },
        body: JSON.stringify({
          id: userId,
          email: cleanEmail,
          full_name: cleanName,
          payment_status: "unpaid",
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

    // 4. Initialize trial remaining seconds (1800s = 30min), keeping trialStarted = false until 1st question
    const storedTrial = await chrome.storage.local.get(["trialStarted", "trialRemainingSeconds"]);
    const trialStarted = storedTrial.trialStarted === true;
    const trialRemainingSeconds = typeof storedTrial.trialRemainingSeconds === "number" ? storedTrial.trialRemainingSeconds : 1800;

    await chrome.storage.local.set({
      trialStarted,
      trialRemainingSeconds,
      userProfile: {
        id: userId,
        email: cleanEmail,
        full_name: cleanName,
        payment_status: "unpaid",
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

  // Character filtering: Disallow < > and HTML/script injection tags
  if (/[<>]/.test(email) || /[<>]/.test(password)) {
    throw new Error("Invalid characters (<>) detected. Please use alphanumeric characters and standard punctuation.");
  }

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
    const token = session.access_token || AUTH_CONFIG.supabaseAnonKey;
    const headers = {
      "apikey": AUTH_CONFIG.supabaseAnonKey,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    };

    try {
      // Clear current_device_id in profiles so the lock is cleanly released
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}&current_device_id=eq.${deviceId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ current_device_id: null })
      });

      // Mark this device session as inactive in device_sessions
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/device_sessions?user_id=eq.${session.user.id}&device_id=eq.${deviceId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ is_active: false })
      });
    } catch (_) {}

    if (session.access_token) {
      supabaseRequest("/auth/v1/logout", {
        method: "POST",
        headers: { "Authorization": `Bearer ${session.access_token}` }
      }).catch(() => {});
    }
  }

  // Clear local session and access flags, but retain extensionDeviceId and trial state
  await chrome.storage.local.remove([
    "supabaseSession",
    "isLoggedIn",
    "userProfile",
    "isLifetimeActive"
  ]);

  return { success: true };
}

async function saveSession(sessionData) {
  const existing = await chrome.storage.local.get(["supabaseSession"]);
  const prevUser = existing.supabaseSession?.user || null;
  const session = {
    access_token: sessionData.access_token || existing.supabaseSession?.access_token,
    refresh_token: sessionData.refresh_token || existing.supabaseSession?.refresh_token,
    expires_at: sessionData.expires_at || (Math.floor(Date.now() / 1000) + (sessionData.expires_in || 3600)),
    user: sessionData.user || prevUser
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

// Proactively refresh access token before it expires
async function ensureValidSession() {
  const session = await getStoredSession();
  if (!session || !session.access_token) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const isExpiringSoon = session.expires_at && (session.expires_at - nowSec < 300);

  if (isExpiringSoon && session.refresh_token) {
    try {
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
        const mergedUser = newSession.user || session.user;
        const updated = await saveSession({ ...newSession, user: mergedUser });
        return updated;
      }
    } catch (err) {
      console.warn("[Auth] Token auto-refresh notice:", err.message);
    }
  }

  return session;
}

// Check session validity directly on Supabase server with offline resilience
async function validateSessionOnServer(session) {
  if (!session || (!session.access_token && !session.user)) return null;

  try {
    if (session.access_token) {
      const res = await fetch(`${AUTH_CONFIG.supabaseUrl}/auth/v1/user`, {
        headers: {
          "apikey": AUTH_CONFIG.supabaseAnonKey,
          "Authorization": `Bearer ${session.access_token}`
        }
      });

      if (res.ok) {
        const user = await res.json();
        if (user && user.id) {
          session.user = user;
          await chrome.storage.local.set({ supabaseSession: session });
          return user;
        }
      }
    }

    // If access token expired or returned 401, attempt automatic refresh
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
        const mergedUser = newSession.user || session.user;
        await saveSession({ ...newSession, user: mergedUser });
        return mergedUser;
      }
    }

    // Resilient fallback: If user was previously authenticated and session user exists,
    // keep user signed in rather than forcing repeated login on restart or temporary network glitch
    if (session.user && session.user.id) {
      console.info("[Auth] Preserving stored authenticated session across restart/refresh.");
      return session.user;
    }

    return null;
  } catch (err) {
    console.warn("[Auth] validateSessionOnServer network warning:", err.message);
    // Offline resilience: never wipe session on network glitch or restart
    return session.user || null;
  }
}

// -------------------------------------------------------------
// 4. User Profile & Cloud Trial / Payment Sync (Authoritative)
// -------------------------------------------------------------
async function getUserProfile(accessToken, userId) {
  if (!userId) return null;

  try {
    const token = accessToken || AUTH_CONFIG.supabaseAnonKey;
    const profiles = await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=*`, {
      headers: {
        "apikey": AUTH_CONFIG.supabaseAnonKey,
        "Authorization": `Bearer ${token}`
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
      lifetimeActivatedAt: profile.paid_at ? new Date(profile.paid_at).getTime() : Date.now()
    });
  } else {
    // Database profile is unpaid, refunded, or revoked
    await chrome.storage.local.set({
      isLifetimeActive: false
    });
  }

  const token = session.access_token || AUTH_CONFIG.supabaseAnonKey;
  const authHeaders = {
    "apikey": AUTH_CONFIG.supabaseAnonKey,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  // 2. Sync Active Trial Seconds and Started State (NEVER reset to 1800 on refresh!)
  const stored = await chrome.storage.local.get(["trialStarted", "trialRemainingSeconds"]);
  let trialStarted = stored.trialStarted === true;
  let trialRemainingSeconds = typeof stored.trialRemainingSeconds === "number" ? stored.trialRemainingSeconds : 1800;

  // If server profile has trial_started, honor it
  if (profile.trial_started) {
    trialStarted = true;
  }
  if (typeof profile.trial_remaining_seconds === "number" && stored.trialRemainingSeconds === undefined) {
    trialRemainingSeconds = profile.trial_remaining_seconds;
  }

  await chrome.storage.local.set({
    trialStarted,
    trialRemainingSeconds,
    userProfile: profile
  });

  // Sync to server asynchronously without blocking
  fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({
      last_active_at: new Date().toISOString(),
      ...(trialStarted ? { trial_started: true, trial_remaining_seconds: trialRemainingSeconds } : {})
    })
  }).catch(() => {});

  return profile;
}

// -------------------------------------------------------------
// 5. Single-Device Concurrency Lock (Atomic & Deduplicated)
// -------------------------------------------------------------
async function registerDeviceOnServer(userId, deviceId, deviceName) {
  if (!userId || !deviceId) return null;
  const name = deviceName || getDeviceFriendlyName();
  const session = await getStoredSession();
  const token = session?.access_token || AUTH_CONFIG.supabaseAnonKey;
  const headers = {
    "apikey": AUTH_CONFIG.supabaseAnonKey,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  try {
    // 1. Update profiles table with current_device_id and friendly name
    await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        current_device_id: deviceId,
        last_device_name: name,
        last_active_at: new Date().toISOString()
      })
    });

    // 2. Mark other devices for this user as inactive in device_sessions
    await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/device_sessions?user_id=eq.${userId}&device_id=neq.${deviceId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        is_active: false
      })
    }).catch(() => {});

    // 3. Upsert session for this device (atomic merge)
    await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/device_sessions`, {
      method: "POST",
      headers: {
        ...headers,
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        user_id: userId,
        device_id: deviceId,
        device_info: name,
        is_active: true,
        last_active_at: new Date().toISOString()
      })
    });

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
// 7. Manual Payment Verification via Database & Support
// -------------------------------------------------------------
async function checkManualPaymentStatus() {
  const session = await getStoredSession();
  if (!session?.user?.id) {
    return { isPaid: false, message: "Please sign in to check payment status." };
  }

  const profile = await syncUserProfile(session);
  if (!profile) {
    return { isPaid: false, message: "Unable to reach database. Please check your connection." };
  }

  const isPaid = profile.payment_status === "paid";
  return {
    isPaid,
    paymentStatus: profile.payment_status || "unpaid",
    paidAt: profile.paid_at || null,
    profile
  };
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
  ensureValidSession,
  validateSessionOnServer,
  getUserProfile,
  syncUserProfile,
  registerDeviceOnServer,
  verifyDeviceConcurrency,
  claimThisDevice,
  requestEmailConfirmationResend,
  checkManualPaymentStatus
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

