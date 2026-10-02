# Architecture & Implementation Plan: Multi-Device Detection (> 2 Devices) & 1-Day User Ban Enforcement

## Executive Summary
This document specifies the technical architecture, database schema migrations, server/client check logic, and user interface enhancements to enforce a strict **2-Device Limit per User Account**. If a **3rd device (`> 2 devices`)** is detected attempting to access or query the system, the user account is automatically placed on an immediate **24-Hour (1-Day) Account Ban**, completely restricting AI solving across all machines and displaying live suspension timers and warning notices.

---

## 1. Context Analysis & Current Mechanism Audit

### 1.1 Current Architecture in `Extension/auth.js`
- **Device Identity:**
  - Each browser installation generates a persistent client ID: `extensionDeviceId` (`dev_<random>_<timestamp>`) stored in `chrome.storage.local`.
  - Device friendly name is derived via `getDeviceFriendlyName()` (e.g. `Windows PC (Edge)`, `Mac (Chrome)`).
- **Current Concurrency Lock (1-Device Lock):**
  - Table `public.profiles` has column `current_device_id`.
  - When `registerDeviceOnServer(userId, deviceId, deviceName)` executes, it writes `profiles.current_device_id = deviceId` and marks all other devices in `public.device_sessions` as `is_active = false`.
  - `verifyDeviceConcurrency()` checks if `profile.current_device_id !== currentDeviceId`. If true, the session is marked as `isDeviceActive: false`, showing `view-device-conflict` ("Account Active on Another Device") and allowing the user to steal the lock by clicking "Use On This Device Instead" (`claimThisDevice()`).
- **Gaps for Multi-Device (>2) & Ban Requirement:**
  1. The system only supports a binary 1-device lock; it has no concept of a 2-device allowance.
  2. No ban status or ban timestamp (`banned_until`) exists in the database schema or client state.
  3. No automatic ban penalty is triggered when an account is shared across 3 or more devices.
  4. The login dashboard (`view-auth`) does not warn users about device limits and ban penalties before sign-in.

---

## 2. Target Architecture: Multi-Device Detection & 1-Day Ban Policy

```mermaid
flowchart TD
    A[User Action: Login / Solve / Heartbeat] --> B[StepAuth.verifyDeviceConcurrency]
    B --> C{Is User Account Banned?<br>banned_until > now}
    C -->|YES - Actively Banned| D[Block AI Solving & Lock Extension]
    D --> E[Show Dedicated 24h Ban Screen with Live Countdown]
    C -->|NO / Expired| F{Is Device Already Active?}
    F -->|YES - Device 1 or 2| G[Update last_active_at & Allow Full Access]
    F -->|NO - New Device| H{Count Active Devices for User}
    H -->|Count < 2 (0 or 1 active)| I[Register New Device as Active<br>Total = 1 or 2]
    I --> G
    H -->|Count >= 2 (Already 2 active)| J[TRIGGER 1-DAY USER BAN!<br>banned_until = now + 24h]
    J --> K[Deactivate All Device Sessions]
    K --> L[Record Ban in user_ban_logs]
    L --> D
```

### Policy Rules:
1. **Allowed Devices:** Maximum of **2 devices** (Device A and Device B) can be concurrently registered and active for any account.
2. **Violation Trigger:** If an account is already active on 2 devices, and a **3rd distinct device** logs in or attempts to query the solver:
   - The account is immediately flagged for account sharing abuse.
   - An automatic **24-hour (1-day) ban** is applied: `banned_until = now() + interval '1 day'`.
   - All active device sessions for this user are deactivated.
3. **Ban Enforcement:**
   - **AI Solving (`background.js`):** `handleSolveQuestion()` immediately throws `USER_BANNED` with expiration timestamp; zero Gemini tokens are consumed.
   - **UI (`popup.html`):** The popup locks all controls and transitions to a dedicated **`view-banned`** screen showing a real-time countdown timer to ban expiration.
   - **Extension Controls (`content.js`):** Solver HUD and shortcut keys are completely deactivated while the ban is active.
4. **Auto-Expiry:** Once the 24-hour window passes (`now() >= banned_until`), the ban automatically expires on the next request, resetting the account to a clean state.

---

## 3. Database Schema Updates (Supabase / PostgreSQL)

### 3.1 Migration SQL Script (`supabase_migration_multi_device_ban.sql`)

```sql
-- ====================================================================
-- STEP SOLVER - MULTI-DEVICE (>2) DETECTION & 1-DAY BAN ENFORCEMENT
-- ====================================================================

-- 1. Update public.profiles table with ban and device configuration fields
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS banned_until timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ban_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ban_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_allowed_devices int DEFAULT 2;

-- 2. Update public.device_sessions table for auditing and tracking
ALTER TABLE public.device_sessions 
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz DEFAULT NULL;

-- Index for instant concurrent device counting
CREATE INDEX IF NOT EXISTS idx_device_sessions_user_active 
  ON public.device_sessions (user_id, is_active);

-- 3. Create public.user_ban_logs audit table
CREATE TABLE IF NOT EXISTS public.user_ban_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  banned_at timestamptz DEFAULT now(),
  banned_until timestamptz NOT NULL,
  reason text NOT NULL,
  violating_device_id text NOT NULL,
  violating_device_info text,
  active_device_ids text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on audit table
ALTER TABLE public.user_ban_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own ban logs" ON public.user_ban_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 4. Atomic Stored Procedure: Device Registration, Count & Ban Trigger
CREATE OR REPLACE FUNCTION public.check_and_register_device(
  p_user_id uuid,
  p_device_id text,
  p_device_info text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile record;
  v_active_count int;
  v_active_devices text[];
  v_is_already_active boolean;
  v_ban_duration interval := interval '1 day';
  v_banned_until timestamptz;
BEGIN
  -- 1. Lock profile row for atomic concurrency inspection
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;

  -- 2. Check active ban status
  IF v_profile.banned_until IS NOT NULL THEN
    IF v_profile.banned_until > now() THEN
      RETURN jsonb_build_object(
        'is_banned', true,
        'banned_until', v_profile.banned_until,
        'ban_reason', v_profile.ban_reason,
        'allowed', false
      );
    ELSE
      -- Ban duration elapsed; automatically lift ban
      UPDATE public.profiles 
      SET banned_until = NULL, ban_reason = NULL 
      WHERE id = p_user_id;
    END IF;
  END IF;

  -- 3. Inspect active devices for this user
  SELECT 
    count(*), 
    coalesce(array_agg(device_id), '{}'),
    bool_or(device_id = p_device_id)
  INTO 
    v_active_count, 
    v_active_devices, 
    v_is_already_active
  FROM public.device_sessions
  WHERE user_id = p_user_id AND is_active = true;

  -- Case A: This device is already one of the active registered devices
  IF v_is_already_active THEN
    UPDATE public.device_sessions 
    SET last_active_at = now(), device_info = coalesce(p_device_info, device_info)
    WHERE user_id = p_user_id AND device_id = p_device_id;

    RETURN jsonb_build_object(
      'is_banned', false,
      'allowed', true,
      'active_count', v_active_count,
      'max_devices', coalesce(v_profile.max_allowed_devices, 2),
      'active_devices', v_active_devices
    );
  END IF;

  -- Case B: New device, and active device count is strictly within allowance (< 2)
  IF v_active_count < coalesce(v_profile.max_allowed_devices, 2) THEN
    INSERT INTO public.device_sessions (user_id, device_id, device_info, is_active, last_active_at)
    VALUES (p_user_id, p_device_id, p_device_info, true, now())
    ON CONFLICT (user_id, device_id) 
    DO UPDATE SET is_active = true, last_active_at = now(), device_info = EXCLUDED.device_info;

    RETURN jsonb_build_object(
      'is_banned', false,
      'allowed', true,
      'active_count', v_active_count + 1,
      'max_devices', coalesce(v_profile.max_allowed_devices, 2)
    );
  END IF;

  -- Case C: MULTI-DEVICE VIOLATION (> 2 devices detected)
  -- 2 devices are already active, and a 3rd distinct device attempted access
  v_banned_until := now() + v_ban_duration;

  UPDATE public.profiles
  SET 
    banned_until = v_banned_until,
    ban_reason = format('Multi-device violation: Attempted 3rd device access (%s) with active devices: %s', p_device_id, array_to_string(v_active_devices, ', ')),
    ban_count = coalesce(ban_count, 0) + 1
  WHERE id = p_user_id;

  -- Deactivate all device sessions
  UPDATE public.device_sessions
  SET is_active = false, deactivated_at = now()
  WHERE user_id = p_user_id;

  -- Record audit log
  INSERT INTO public.user_ban_logs (user_id, banned_until, reason, violating_device_id, violating_device_info, active_device_ids)
  VALUES (p_user_id, v_banned_until, 'Multi-device violation (> 2 devices)', p_device_id, p_device_info, v_active_devices);

  RETURN jsonb_build_object(
    'is_banned', true,
    'banned_until', v_banned_until,
    'ban_reason', 'Multi-device violation: More than 2 devices detected on this account.',
    'allowed', false,
    'active_count', v_active_count + 1,
    'max_devices', coalesce(v_profile.max_allowed_devices, 2)
  );
END;
$$;
```

---

## 4. Server & Background Check Logic

### 4.1 Modifications in `Extension/auth.js`
1. **Ban Verification Helper (`isUserBanned`)**:
   - Parses `profile.banned_until`.
   - Returns boolean `true` if `new Date(profile.banned_until).getTime() > Date.now()`.
   - Calculates remaining milliseconds, formatted hours/minutes, and human-readable unlock date.
2. **Device Concurrency & Ban Verification (`verifyDeviceConcurrency`)**:
   - Executes `check_and_register_device` RPC (with transparent REST fallback).
   - If `is_banned` is true:
     - Saves ban state to `chrome.storage.local`: `{ isAccountBanned: true, bannedUntil: ..., banReason: ... }`.
     - Returns `{ isAuthenticated: true, isBanned: true, bannedUntil, banReason }`.
   - If allowed:
     - Saves active count: `{ activeDeviceCount: res.active_count, maxAllowedDevices: 2 }`.
     - Returns `{ isAuthenticated: true, isBanned: false, isDeviceActive: true }`.
3. **Session Revocation on Sign-Out**:
   - Explicitly deactivates the current device session in `device_sessions` so users who cleanly log out free up their device slot without triggering false bans.

### 4.2 Modifications in `Extension/background.js`
1. **Solving Interception (`handleSolveQuestion`)**:
   - Checks `concurrency = await StepAuth.verifyDeviceConcurrency();` before calling Gemini.
   - If `concurrency.isBanned`:
     - Throws error with code `"USER_BANNED"`.
     - Message: `"Account suspended for 24 hours due to multi-device usage (> 2 devices). Access unlocks at [Time]."`
     - Disables power toggle: `chrome.storage.local.set({ extensionEnabled: false })`.
2. **Subscription Status Sync (`getSubscriptionStatus`)**:
   - Returns `isBanned`, `bannedUntil`, and `banReason` to keep popup and content scripts in sync.

---

## 5. UI Handling & Visual Enhancements

### 5.1 Login Dashboard Warning Box (`popup.html` -> `view-auth`)
Add a dedicated, unmissable Security Notice directly above the Sign In / Sign Up tabs:

```html
<!-- Multi-Device Security Warning Banner -->
<div class="auth-security-warning">
  <div class="security-warning-icon">⚠️</div>
  <div class="security-warning-content">
    <div class="security-warning-title">Account Security & Device Limit</div>
    <p class="security-warning-desc">
      Each account is strictly limited to a <strong>maximum of 2 devices</strong>. Logging in on a 3rd device will trigger an <strong>automatic 24-hour account suspension</strong> across all devices. Account sharing is strictly prohibited.
    </p>
  </div>
</div>
```

**CSS Styling (`popup.css`):**
- Dark crimson / amber warning background: `linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(245, 158, 11, 0.12))`
- Crisp warning border: `1px solid rgba(239, 68, 68, 0.35)`
- Clear typographic hierarchy with bold emphasis on **2 devices** and **24-hour account suspension**.

### 5.2 Dedicated 24-Hour Ban View (`popup.html` -> `view-banned`)
When an account is flagged for `> 2 devices`, the popup automatically transitions to `view-banned`:

```html
<!-- VIEW 5: ACCOUNT SUSPENDED (24-Hour Multi-Device Ban) -->
<div id="view-banned" class="popup-view" style="display: none;">
  <section class="settings-card ban-card">
    <div class="ban-icon-wrap">
      <span class="ban-icon">🚫</span>
    </div>
    <div class="ban-status-badge">Account Suspended</div>
    <h2 class="ban-title">24-Hour Device Ban Active</h2>
    <p class="ban-desc">
      Your account was suspended because <strong>more than 2 devices</strong> were detected accessing this account concurrently.
    </p>

    <!-- Real-time Countdown Box -->
    <div class="ban-timer-card">
      <span class="ban-timer-label">ACCESS RESTORES IN</span>
      <div id="ban-countdown-timer" class="ban-countdown-timer">23h 58m 14s</div>
      <div id="ban-unlock-timestamp" class="ban-unlock-timestamp">Tomorrow at 4:30 PM</div>
    </div>

    <div class="ban-info-row">
      <span class="info-label">Violation:</span>
      <span class="info-val">Multi-Device Policy (&gt; 2 Devices)</span>
    </div>
    <div class="ban-info-row">
      <span class="info-label">Registered Devices:</span>
      <span id="ban-devices-list" class="info-val">3 Devices Detected</span>
    </div>

    <div class="ban-actions">
      <button id="btn-ban-signout" class="btn-auth-primary">
        <span>Sign Out / Switch Account</span>
      </button>
      <a href="mailto:support.vickydevsolutions@gmail.com?subject=Ban%20Appeal%20-%20Step%20Solver" class="btn-auth-secondary" style="text-align:center; text-decoration:none;">
        <span>Contact Support</span>
      </a>
    </div>
  </section>
</div>
```

### 5.3 Active Device Indicator in Authenticated View (`view-main`)
In the top account bar (`user-account-bar`), update the device pill dynamically:
- If 1 device registered: `🔒 1/2 Devices` (Emerald green pill).
- If 2 devices registered: `⚠️ 2/2 Devices (Max)` (Amber pill with hover tooltip: *"Maximum devices reached. Logging in on a 3rd device will trigger a 24h ban."*).

---

## 6. Implementation Steps & Sequencing

| Phase | Tasks | Target Files |
| :--- | :--- | :--- |
| **Phase 1: DB Schema & Migration** | Document and prepare PostgreSQL migration script for `profiles`, `device_sessions`, `user_ban_logs`, and `check_and_register_device` function. | `plans/supabase_migration_multi_device_ban.sql` |
| **Phase 2: Auth Logic** | Implement `isUserBanned()`, multi-device check (`>2 devices`), ban timestamp calculation, and 2-device concurrency verification. | `Extension/auth.js` |
| **Phase 3: Background Enforcement** | Intercept `SOLVE_QUESTION` with `USER_BANNED` guard, disable solver power toggle when banned, include ban status in `GET_SUBSCRIPTION_STATUS`. | `Extension/background.js` |
| **Phase 4: UI Updates** | Add warning banner to `view-auth`, build `view-banned` with live countdown, update `device-status-display` to `1/2` and `2/2 Devices`. | `Extension/popup.html`<br>`Extension/popup.css`<br>`Extension/popup.js` |
| **Phase 5: Automated Testing** | Add unit tests verifying: 1 & 2 devices allowed, 3rd device triggers 1-day ban, ban countdown accurately expires after 24h, solver blocks queries when banned. | `Extension/test/device_ban.test.js` |
| **Phase 6: Verification & Release** | Run `npm test`, `npm run verify`, and `npm run package` to package `step-solver-edge-v1.0.5.zip`. | Release artifacts |

---

## 7. Open Review Questions for User
1. **Grace Period for Clean Logouts:** When a user explicitly clicks "Sign Out" on Device 1, that device slot is immediately freed so they can log in on a new device without counting toward the limit. Does this match your intended workflow?
2. **Ban Duration:** Confirmed as 24 hours (1 day) from the moment the 3rd device connects. If repeated violations occur, should subsequent bans remain 24 hours or escalate? (Default: 24 hours per violation).
3. **Allowed Limit:** Strictly up to 2 devices allowed; ban triggers on device 3. Confirmed.
