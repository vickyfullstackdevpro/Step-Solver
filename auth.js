const AUTH_CONFIG = {
  supabaseUrl: "https://sspznikobogfczikozlu.supabase.co",
  supabaseAnonKey: "sb_publishable_hXGTeGYid688TSuSDF6Mww_A8LIc4hF",
  supabaseSecretKey: "sb_publishable_hXGTeGYid688TSuSDF6Mww_A8LIc4hF",
  supportEmail: "support.vickydevsolutions@gmail.com",
  upiId: "vicky636501@okaxis",
  upiName: "Vicky",
  paymentAmountInr: 20
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
  const gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;
  if (!gmailRegex.test(cleanEmail)) {
    throw new Error("Only personal @gmail.com accounts are allowed. Temporary or disposable emails are blocked.");
  }

  const cleanName = (fullName || "").trim();
  if (!cleanName || cleanName.length < 2) {
    throw new Error("Please enter your name. Full name is required to create an account.");
  }

  const deviceId = await getOrCreateDeviceId();
  const deviceName = getDeviceFriendlyName();
  const nowIso = new Date().toISOString();

  // 1. Standard Supabase Sign Up with direct verification redirect
  const redirectTarget = "https://english.steptest.in/?email_verified=true";
  const data = await supabaseRequest(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTarget)}`, {
    method: "POST",
    body: JSON.stringify({
      email: cleanEmail,
      password: password,
      data: { full_name: cleanName },
      options: { emailRedirectTo: redirectTarget }
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
          trial_started_at: null, // Free trial activates on first login after email confirmation
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

    // 4. Initialize user profile in storage (trial starts on first confirmed login)
    await chrome.storage.local.set({
      userProfile: {
        id: userId,
        email: cleanEmail,
        full_name: cleanName,
        payment_status: "unpaid",
        trial_started_at: null,
        current_device_id: deviceId,
        last_device_name: deviceName
      }
    });

    // 5. If session was returned immediately with confirmed email (e.g. auto-confirmed)
    if (data.session || data.access_token) {
      const authUser = data.user || data.session?.user;
      if (authUser && (authUser.email_confirmed_at || authUser.confirmed_at)) {
        await saveSession(data.session || data);
        await syncUserProfile(data.session || data);
      }
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

  // Register device session on server atomically
  await registerDeviceOnServer(session.user.id, deviceId, deviceName);

  // Live Concurrency & 1-Day Ban Verification
  const concurrency = await verifyDeviceConcurrency();
  if (concurrency.isBanned) {
    const banErr = new Error(`Account suspended for 24 hours due to multi-device usage (> 2 devices). Access unlocks at ${concurrency.unlockFormatted || concurrency.bannedUntil}.`);
    banErr.code = "USER_BANNED";
    banErr.bannedUntil = concurrency.bannedUntil;
    banErr.banReason = concurrency.banReason;
    throw banErr;
  }

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
      // Clear current_device_id in profiles if this was the device
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}&current_device_id=eq.${deviceId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ current_device_id: null })
      });

      // Mark this device session as inactive in device_sessions and record deactivated_at
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/device_sessions?user_id=eq.${session.user.id}&device_id=eq.${deviceId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          is_active: false,
          deactivated_at: new Date().toISOString()
        })
      });
    } catch (_) {}

    if (session.access_token) {
      supabaseRequest("/auth/v1/logout", {
        method: "POST",
        headers: { "Authorization": `Bearer ${session.access_token}` }
      }).catch(() => {});
    }
  }

  // Clear local session, access flags, and ban status, but retain extensionDeviceId
  await chrome.storage.local.remove([
    "supabaseSession",
    "isLoggedIn",
    "userProfile",
    "isLifetimeActive",
    "trialStartedAt",
    "deviceTrialStartedAt",
    "isAccountBanned",
    "bannedUntil",
    "bannedUntilMs",
    "banReason",
    "activeDeviceCount",
    "maxAllowedDevices"
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

  const token = accessToken || AUTH_CONFIG.supabaseAnonKey;
  const headers = {
    "apikey": AUTH_CONFIG.supabaseAnonKey,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  // 1. Try atomic SECURITY DEFINER RPC (bypasses RLS issues)
  try {
    const rpcRes = await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/rpc/get_user_profile`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_user_id: userId })
    });
    if (rpcRes.ok) {
      const rpcProfile = await rpcRes.json();
      if (rpcProfile && typeof rpcProfile === "object" && rpcProfile.id) {
        await chrome.storage.local.set({ userProfile: rpcProfile });
        return rpcProfile;
      }
    }
  } catch (_) {}

  // 2. Fallback to standard REST query
  try {
    const profiles = await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=*`, {
      headers
    }).then(r => r.json());

    if (Array.isArray(profiles) && profiles.length > 0) {
      await chrome.storage.local.set({ userProfile: profiles[0] });
      return profiles[0];
    }
  } catch (err) {
    console.warn("[Auth] Failed to fetch user profile:", err.message);
  }

  // 3. Fallback to locally cached userProfile if available
  try {
    const local = await chrome.storage.local.get(["userProfile"]);
    if (local.userProfile && local.userProfile.id === userId) {
      return local.userProfile;
    }
  } catch (_) {}

  return null;
}

async function syncUserProfile(session) {
  if (!session?.user?.id) return null;

  const stored = await getStoredSession();
  const token = stored?.access_token || session.access_token || AUTH_CONFIG.supabaseAnonKey;
  const userId = stored?.user?.id || session.user.id;

  const profile = await getUserProfile(token, userId);
  if (!profile) return null;

  // 1. Sync Lifetime Payment Status with Server DB
  if (profile.payment_status === "paid") {
    await chrome.storage.local.set({
      isLifetimeActive: true,
      lifetimeActivatedAt: profile.paid_at ? new Date(profile.paid_at).getTime() : Date.now(),
      userProfile: profile
    });
  } else {
    // Database profile is unpaid, refunded, or revoked
    await chrome.storage.local.set({
      isLifetimeActive: false,
      userProfile: profile
    });
  }

  const authHeaders = {
    "apikey": AUTH_CONFIG.supabaseAnonKey,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  // 2. Sync Trial Start Timestamp (Starts on first login after email confirmation)
  if (profile.trial_started_at) {
    const serverTrialMs = new Date(profile.trial_started_at).getTime();
    if (!isNaN(serverTrialMs) && serverTrialMs > 0) {
      await chrome.storage.local.set({
        trialStartedAt: serverTrialMs
      });
    }
  } else {
    // User is logged in with confirmed email, but server has no trial_started_at yet.
    // Check if trial was ALREADY started locally so we DO NOT reset countdown on refresh!
    const local = await chrome.storage.local.get(["trialStartedAt"]);
    let trialMs;
    if (typeof local.trialStartedAt === "number" && !isNaN(local.trialStartedAt) && local.trialStartedAt > 0) {
      trialMs = local.trialStartedAt;
    } else {
      trialMs = Date.now();
      await chrome.storage.local.set({ trialStartedAt: trialMs });
    }

    const isoDate = new Date(trialMs).toISOString();
    profile.trial_started_at = isoDate;

    // Update server profile with initial trial start date (non-blocking)
    fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ trial_started_at: isoDate, last_active_at: isoDate })
    }).catch((err) => {
      console.warn("[Auth] Failed to set initial trial_started_at on server:", err.message);
    });
  }

  await chrome.storage.local.set({ userProfile: profile });
  return profile;
}

// -------------------------------------------------------------
// 5. Multi-Device Detection (> 2 Devices) & 1-Day Ban Enforcement
// -------------------------------------------------------------

/**
 * Evaluates whether a user profile is currently actively banned.
 * @param {Object} profile - User profile from Supabase
 * @returns {Object} Ban status object
 */
function isUserBanned(profile) {
  if (!profile || !profile.banned_until) {
    return { isBanned: false, bannedUntil: null };
  }

  const bannedUntilMs = new Date(profile.banned_until).getTime();
  if (isNaN(bannedUntilMs)) {
    return { isBanned: false, bannedUntil: null };
  }

  const nowMs = Date.now();
  if (bannedUntilMs <= nowMs) {
    return {
      isBanned: false,
      bannedUntil: profile.banned_until,
      bannedUntilMs,
      isExpired: true
    };
  }

  const remainingMs = bannedUntilMs - nowMs;
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const remainingFormatted = `${hours}h ${minutes}m ${seconds}s`;

  return {
    isBanned: true,
    bannedUntil: profile.banned_until,
    bannedUntilMs,
    remainingMs,
    remainingFormatted,
    unlockFormatted: new Date(bannedUntilMs).toLocaleString(),
    banReason: profile.ban_reason || "Multi-device violation: More than 2 devices detected."
  };
}

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
    // 1. Update profiles table with current_device_id, friendly name, and last_active_at
    await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        current_device_id: deviceId,
        last_device_name: name,
        last_active_at: new Date().toISOString()
      })
    });

    // 2. Upsert session for this device (atomic merge, preserving up to 2 active devices)
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

// Check multi-device concurrency (limit <= 2) and 1-day ban status
async function verifyDeviceConcurrency() {
  const session = await getStoredSession();
  if (!session?.user?.id) {
    return { isAuthenticated: false, isDeviceActive: false, isBanned: false };
  }

  const currentDeviceId = await getOrCreateDeviceId();
  const currentDeviceName = getDeviceFriendlyName();
  const token = session.access_token || AUTH_CONFIG.supabaseAnonKey;
  const headers = {
    "apikey": AUTH_CONFIG.supabaseAnonKey,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  // 1. Fetch authoritative profile directly from database
  const profile = await getUserProfile(session.access_token, session.user.id);

  if (!profile) {
    return { isAuthenticated: true, isDeviceActive: true, isBanned: false, profile: null };
  }

  // 2. Check if user is actively banned (banned_until > now)
  const banStatus = isUserBanned(profile);
  if (banStatus.isBanned) {
    await chrome.storage.local.set({
      isAccountBanned: true,
      bannedUntil: banStatus.bannedUntil,
      bannedUntilMs: banStatus.bannedUntilMs,
      banReason: banStatus.banReason
    });
    return {
      isAuthenticated: true,
      isDeviceActive: false,
      isBanned: true,
      bannedUntil: banStatus.bannedUntil,
      bannedUntilMs: banStatus.bannedUntilMs,
      remainingFormatted: banStatus.remainingFormatted,
      unlockFormatted: banStatus.unlockFormatted,
      banReason: banStatus.banReason,
      profile
    };
  } else if (banStatus.isExpired) {
    // 24h ban duration has passed; automatically lift ban
    await chrome.storage.local.remove(["isAccountBanned", "bannedUntil", "bannedUntilMs", "banReason"]);
    fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ banned_until: null, ban_reason: null })
    }).catch(() => {});
  } else {
    await chrome.storage.local.remove(["isAccountBanned", "bannedUntil", "bannedUntilMs", "banReason"]);
  }

  const maxAllowed = profile.max_allowed_devices || 2;

  // 3. Stored Procedure check_and_register_device (Atomic RPC)
  try {
    const rpcRes = await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/rpc/check_and_register_device`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_user_id: session.user.id,
        p_device_id: currentDeviceId,
        p_device_info: currentDeviceName
      })
    });

    if (rpcRes.ok) {
      const data = await rpcRes.json();
      if (data && typeof data === "object") {
        if (data.is_banned) {
          const bUntilMs = new Date(data.banned_until).getTime();
          const remMs = Math.max(0, bUntilMs - Date.now());
          const remSec = Math.floor(remMs / 1000);
          const rFormatted = `${Math.floor(remSec / 3600)}h ${Math.floor((remSec % 3600) / 60)}m ${remSec % 60}s`;
          await chrome.storage.local.set({
            isAccountBanned: true,
            bannedUntil: data.banned_until,
            bannedUntilMs: bUntilMs,
            banReason: data.ban_reason
          });
          return {
            isAuthenticated: true,
            isDeviceActive: false,
            isBanned: true,
            bannedUntil: data.banned_until,
            bannedUntilMs: bUntilMs,
            remainingFormatted: rFormatted,
            unlockFormatted: new Date(bUntilMs).toLocaleString(),
            banReason: data.ban_reason,
            profile
          };
        }

        // Allowed on this device (1 or 2 devices active)
        const activeCount = data.active_count || 1;
        const maxDevices = data.max_devices || maxAllowed;
        await chrome.storage.local.set({
          activeDeviceCount: activeCount,
          maxAllowedDevices: maxDevices
        });

        return {
          isAuthenticated: true,
          isDeviceActive: true,
          isBanned: false,
          activeDeviceCount: activeCount,
          maxAllowedDevices: maxDevices,
          profile
        };
      }
    }
  } catch (rpcErr) {
    console.warn("[Auth] RPC check_and_register_device fallback to REST:", rpcErr.message);
  }

  // 4. Fallback: REST Concurrency & Multi-Device Ban Enforcement
  try {
    const sessionsRes = await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/device_sessions?user_id=eq.${session.user.id}&is_active=eq.true&select=device_id,device_info`, {
      headers
    });

    if (sessionsRes.ok) {
      const activeSessions = await sessionsRes.json();
      const sessionList = Array.isArray(activeSessions) ? activeSessions : [];
      const isAlreadyActive = sessionList.some(s => s.device_id === currentDeviceId);

      if (isAlreadyActive) {
        await registerDeviceOnServer(session.user.id, currentDeviceId, currentDeviceName);
        await chrome.storage.local.set({
          activeDeviceCount: sessionList.length,
          maxAllowedDevices: maxAllowed
        });
        return {
          isAuthenticated: true,
          isDeviceActive: true,
          isBanned: false,
          activeDeviceCount: sessionList.length,
          maxAllowedDevices: maxAllowed,
          profile
        };
      }

      // If new device and count is strictly within allowance (< 2)
      if (sessionList.length < maxAllowed) {
        await registerDeviceOnServer(session.user.id, currentDeviceId, currentDeviceName);
        const newCount = sessionList.length + 1;
        await chrome.storage.local.set({
          activeDeviceCount: newCount,
          maxAllowedDevices: maxAllowed
        });
        return {
          isAuthenticated: true,
          isDeviceActive: true,
          isBanned: false,
          activeDeviceCount: newCount,
          maxAllowedDevices: maxAllowed,
          profile
        };
      }

      // MULTI-DEVICE VIOLATION (> 2 devices detected):
      // 2 devices are already active, and this is a 3rd distinct device -> 1-DAY BAN!
      const banDurationMs = 24 * 60 * 60 * 1000;
      const bannedUntilDate = new Date(Date.now() + banDurationMs);
      const bannedUntilIso = bannedUntilDate.toISOString();
      const banReason = `Multi-device violation: Attempted 3rd device access (${currentDeviceId}) with 2 active devices.`;

      // 1. Update profiles table with 24-hour ban
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          banned_until: bannedUntilIso,
          ban_reason: banReason,
          ban_count: (profile.ban_count || 0) + 1
        })
      });

      // 2. Deactivate all active sessions for this user
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/device_sessions?user_id=eq.${session.user.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          is_active: false,
          deactivated_at: new Date().toISOString()
        })
      }).catch(() => {});

      // 3. Log incident in user_ban_logs
      await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/user_ban_logs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: session.user.id,
          banned_until: bannedUntilIso,
          reason: banReason,
          violating_device_id: currentDeviceId,
          violating_device_info: currentDeviceName,
          active_device_ids: sessionList.map(s => s.device_id)
        })
      }).catch(() => {});

      // 4. Save ban state locally
      await chrome.storage.local.set({
        isAccountBanned: true,
        bannedUntil: bannedUntilIso,
        bannedUntilMs: bannedUntilDate.getTime(),
        banReason: banReason
      });

      return {
        isAuthenticated: true,
        isDeviceActive: false,
        isBanned: true,
        bannedUntil: bannedUntilIso,
        bannedUntilMs: bannedUntilDate.getTime(),
        remainingFormatted: "24h 00m 00s",
        unlockFormatted: bannedUntilDate.toLocaleString(),
        banReason,
        profile
      };
    }
  } catch (restErr) {
    console.warn("[Auth] Fallback REST check notice:", restErr.message);
  }

  // Fallback: register this device
  await registerDeviceOnServer(session.user.id, currentDeviceId, currentDeviceName);
  return {
    isAuthenticated: true,
    isDeviceActive: true,
    isBanned: false,
    activeDeviceCount: 1,
    maxAllowedDevices: maxAllowed,
    profile
  };
}

// Claim this device (used if re-activating after ban expiry or replacing inactive session)
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
  if (isPaid) {
    await chrome.storage.local.set({
      isLifetimeActive: true,
      lifetimeActivatedAt: profile.paid_at ? new Date(profile.paid_at).getTime() : Date.now(),
      userProfile: profile
    });
  }
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
  validateSessionOnServer,
  getUserProfile,
  syncUserProfile,
  isUserBanned,
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

