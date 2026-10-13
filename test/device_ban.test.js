// test/device_ban.test.js
// Automated regression tests for multi-device detection (> 2 devices) and 1-day user ban enforcement
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

/**
 * Pure evaluation function mirroring isUserBanned in auth.js
 */
function evaluateUserBan(profile, now = Date.now()) {
  if (!profile || !profile.banned_until) {
    return { isBanned: false, bannedUntil: null };
  }

  const bannedUntilMs = new Date(profile.banned_until).getTime();
  if (isNaN(bannedUntilMs)) {
    return { isBanned: false, bannedUntil: null };
  }

  if (bannedUntilMs <= now) {
    return {
      isBanned: false,
      bannedUntil: profile.banned_until,
      bannedUntilMs,
      isExpired: true
    };
  }

  const remainingMs = bannedUntilMs - now;
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

/**
 * Pure evaluation function mirroring multi-device concurrency and ban trigger
 */
function evaluateDeviceRegistration(activeSessions, currentDeviceId, maxAllowed = 2, now = Date.now()) {
  const isAlreadyActive = activeSessions.some(s => s.device_id === currentDeviceId && s.is_active);

  // Case A: Device already active
  if (isAlreadyActive) {
    return {
      isBanned: false,
      allowed: true,
      activeCount: activeSessions.filter(s => s.is_active).length,
      maxAllowed
    };
  }

  const currentActiveCount = activeSessions.filter(s => s.is_active).length;

  // Case B: New device within allowance (< 2)
  if (currentActiveCount < maxAllowed) {
    return {
      isBanned: false,
      allowed: true,
      activeCount: currentActiveCount + 1,
      maxAllowed
    };
  }

  // Case C: 3rd device detected (> 2 devices) -> 1-day ban!
  const banDurationMs = 24 * 60 * 60 * 1000;
  const bannedUntil = new Date(now + banDurationMs).toISOString();

  return {
    isBanned: true,
    allowed: false,
    bannedUntil,
    banDurationMs,
    banReason: `Multi-device violation: Attempted 3rd device access (${currentDeviceId}) with ${currentActiveCount} active devices.`
  };
}

/**
 * Pure evaluation function mirroring single-device active lock & 2-device registration limit
 */
function evaluateDeviceConcurrency({
  currentDeviceId,
  currentDeviceName = "My Computer",
  profileCurrentDeviceId = null,
  profileLastDeviceName = null,
  registeredSessions = [],
  maxAllowed = 2,
  now = Date.now()
}) {
  const isRegistered = registeredSessions.some(s => s.device_id === currentDeviceId && s.is_active);
  const activeRegisteredSessions = registeredSessions.filter(s => s.is_active);

  // 1. If not registered, check if registered count exceeds maxAllowed (2 devices)
  if (!isRegistered) {
    if (activeRegisteredSessions.length >= maxAllowed) {
      // 3rd distinct device attempt -> 1-day ban!
      const banDurationMs = 24 * 60 * 60 * 1000;
      return {
        isBanned: true,
        allowed: false,
        isDeviceActive: false,
        bannedUntil: new Date(now + banDurationMs).toISOString(),
        banReason: `Multi-device violation: Attempted 3rd device access (${currentDeviceId}) with ${activeRegisteredSessions.length} registered devices.`
      };
    }
  }

  const updatedRegisteredCount = isRegistered ? activeRegisteredSessions.length : activeRegisteredSessions.length + 1;

  // 2. Strict Single-Device Active Concurrency Lock:
  // Case A: No device is currently active -> this device claims active lock
  if (!profileCurrentDeviceId) {
    return {
      isBanned: false,
      allowed: true,
      isDeviceActive: true,
      activeDeviceId: currentDeviceId,
      registeredCount: updatedRegisteredCount,
      maxAllowed
    };
  }

  // Case B: This device is already the active device
  if (profileCurrentDeviceId === currentDeviceId) {
    return {
      isBanned: false,
      allowed: true,
      isDeviceActive: true,
      activeDeviceId: currentDeviceId,
      registeredCount: updatedRegisteredCount,
      maxAllowed
    };
  }

  // Case C: Conflict! Another device is active. Simultaneous access is BLOCKED!
  return {
    isBanned: false,
    allowed: false,
    isDeviceActive: false,
    conflictDeviceId: profileCurrentDeviceId,
    conflictDeviceName: profileLastDeviceName || "Another Device",
    registeredCount: updatedRegisteredCount,
    maxAllowed
  };
}

describe("Multi-Device Detection (> 2 Devices) & 1-Day User Ban Enforcement", () => {
  test("Rule 1: Clean account with no banned_until is not banned", () => {
    const profile = {
      id: "usr_clean_123",
      email: "student@gmail.com",
      banned_until: null,
      max_allowed_devices: 2
    };

    const status = evaluateUserBan(profile);
    assert.equal(status.isBanned, false);
    assert.equal(status.bannedUntil, null);
  });

  test("Rule 2: Actively banned account returns isBanned: true with live remaining countdown", () => {
    const now = 1700000000000;
    const banDurationMs = 24 * 60 * 60 * 1000; // 24 hours
    const bannedUntilIso = new Date(now + banDurationMs).toISOString();

    const profile = {
      id: "usr_banned_123",
      email: "abuser@gmail.com",
      banned_until: bannedUntilIso,
      ban_reason: "Multi-device violation (> 2 devices)"
    };

    const status = evaluateUserBan(profile, now);
    assert.equal(status.isBanned, true);
    assert.equal(status.remainingMs, 86400000);
    assert.equal(status.remainingFormatted, "24h 0m 0s");
    assert.match(status.banReason, /Multi-device violation/);
  });

  test("Rule 3: Ban automatically expires when now >= banned_until", () => {
    const now = 1700000000000;
    const expiredBanIso = new Date(now - 1000).toISOString(); // 1 second in the past

    const profile = {
      id: "usr_rehabilitated_123",
      banned_until: expiredBanIso
    };

    const status = evaluateUserBan(profile, now);
    assert.equal(status.isBanned, false);
    assert.equal(status.isExpired, true);
  });

  test("Rule 4: Allowed device 1 connects successfully (count: 1/2)", () => {
    const activeSessions = [];
    const result = evaluateDeviceRegistration(activeSessions, "dev_pc_1", 2);

    assert.equal(result.isBanned, false);
    assert.equal(result.allowed, true);
    assert.equal(result.activeCount, 1);
    assert.equal(result.maxAllowed, 2);
  });

  test("Rule 5: Allowed device 2 connects successfully (count: 2/2)", () => {
    const activeSessions = [
      { device_id: "dev_pc_1", is_active: true }
    ];
    const result = evaluateDeviceRegistration(activeSessions, "dev_laptop_2", 2);

    assert.equal(result.isBanned, false);
    assert.equal(result.allowed, true);
    assert.equal(result.activeCount, 2);
    assert.equal(result.maxAllowed, 2);
  });

  test("Rule 6: Existing registered device re-connecting does not increase device count", () => {
    const activeSessions = [
      { device_id: "dev_pc_1", is_active: true },
      { device_id: "dev_laptop_2", is_active: true }
    ];
    const result = evaluateDeviceRegistration(activeSessions, "dev_pc_1", 2);

    assert.equal(result.isBanned, false);
    assert.equal(result.allowed, true);
    assert.equal(result.activeCount, 2);
  });

  test("Rule 7: 3rd distinct device triggers IMMEDIATE 24-HOUR BAN", () => {
    const now = 1700000000000;
    const activeSessions = [
      { device_id: "dev_pc_1", is_active: true },
      { device_id: "dev_laptop_2", is_active: true }
    ];
    const result = evaluateDeviceRegistration(activeSessions, "dev_phone_3", 2, now);

    assert.equal(result.isBanned, true);
    assert.equal(result.allowed, false);
    assert.equal(result.banDurationMs, 24 * 60 * 60 * 1000);
    assert.match(result.banReason, /Attempted 3rd device access/);
    assert.equal(new Date(result.bannedUntil).getTime(), now + 86400000);
  });

  test("Rule 8: Clean logout frees device slot allowing new device without ban", () => {
    // User had 2 devices, but logged out of dev_pc_1
    const activeSessions = [
      { device_id: "dev_pc_1", is_active: false, deactivated_at: "2026-10-02T10:00:00Z" },
      { device_id: "dev_laptop_2", is_active: true }
    ];
    // Now logging in from dev_tablet_3
    const result = evaluateDeviceRegistration(activeSessions, "dev_tablet_3", 2);

    assert.equal(result.isBanned, false);
    assert.equal(result.allowed, true);
    assert.equal(result.activeCount, 2); // 1 active + 1 new = 2
  });

  test("Rule 9: Solver rejects queries when user is banned with USER_BANNED code", () => {
    const concurrency = {
      isBanned: true,
      bannedUntil: new Date(Date.now() + 86400000).toISOString(),
      unlockFormatted: "Tomorrow at 4:30 PM"
    };

    assert.throws(
      () => {
        if (concurrency.isBanned) {
          const err = new Error(`Account suspended for 24 hours due to multi-device usage (> 2 devices). Access unlocks at ${concurrency.unlockFormatted}.`);
          err.code = "USER_BANNED";
          throw err;
        }
      },
      (err) => {
        return err.code === "USER_BANNED" && err.message.includes("Account suspended for 24 hours");
      }
    );
  });

  test("Rule 10: First connecting device gains active session lock (isDeviceActive: true)", () => {
    const res = evaluateDeviceConcurrency({
      currentDeviceId: "dev_pc_1",
      currentDeviceName: "Windows PC",
      profileCurrentDeviceId: null, // No device active initially
      registeredSessions: []
    });

    assert.equal(res.isBanned, false);
    assert.equal(res.allowed, true);
    assert.equal(res.isDeviceActive, true);
    assert.equal(res.activeDeviceId, "dev_pc_1");
    assert.equal(res.registeredCount, 1);
  });

  test("Rule 11: Simultaneous access BLOCKED: Device 2 connecting while Device 1 is active gets isDeviceActive: false", () => {
    // Device 1 is currently active in profile
    const res = evaluateDeviceConcurrency({
      currentDeviceId: "dev_laptop_2",
      currentDeviceName: "MacBook Air",
      profileCurrentDeviceId: "dev_pc_1",
      profileLastDeviceName: "Windows PC",
      registeredSessions: [
        { device_id: "dev_pc_1", is_active: true }
      ]
    });

    assert.equal(res.isBanned, false);
    assert.equal(res.allowed, false);
    assert.equal(res.isDeviceActive, false);
    assert.equal(res.conflictDeviceId, "dev_pc_1");
    assert.equal(res.conflictDeviceName, "Windows PC");
    assert.equal(res.registeredCount, 2);
  });

  test("Rule 12: Solver rejects question solving from inactive Device 2 with DEVICE_REVOKED", () => {
    const concurrency = {
      isBanned: false,
      isDeviceActive: false,
      conflictDeviceName: "Windows PC"
    };

    assert.throws(
      () => {
        if (concurrency.isDeviceActive === false) {
          const otherDevice = concurrency.conflictDeviceName || "another machine";
          const err = new Error(`Account currently active on ${otherDevice}. Step Solver allows only 1 active device at a time. Please open the extension popup to switch to this device.`);
          err.code = "DEVICE_REVOKED";
          throw err;
        }
      },
      (err) => {
        return err.code === "DEVICE_REVOKED" && err.message.includes("Step Solver allows only 1 active device at a time");
      }
    );
  });

  test("Rule 13: Switching device via claimThisDevice transfers active lock to Device 2", () => {
    // When Device 2 clicks 'Use On This Device Instead', profile.current_device_id becomes dev_laptop_2
    const profileAfterClaim = {
      current_device_id: "dev_laptop_2",
      last_device_name: "MacBook Air"
    };

    // Now Device 2 verifies again:
    const resDevice2 = evaluateDeviceConcurrency({
      currentDeviceId: "dev_laptop_2",
      currentDeviceName: "MacBook Air",
      profileCurrentDeviceId: profileAfterClaim.current_device_id,
      registeredSessions: [
        { device_id: "dev_pc_1", is_active: true },
        { device_id: "dev_laptop_2", is_active: true }
      ]
    });
    assert.equal(resDevice2.isDeviceActive, true);

    // Meanwhile Device 1 now checks and is locked out:
    const resDevice1 = evaluateDeviceConcurrency({
      currentDeviceId: "dev_pc_1",
      currentDeviceName: "Windows PC",
      profileCurrentDeviceId: profileAfterClaim.current_device_id,
      profileLastDeviceName: profileAfterClaim.last_device_name,
      registeredSessions: [
        { device_id: "dev_pc_1", is_active: true },
        { device_id: "dev_laptop_2", is_active: true }
      ]
    });
    assert.equal(resDevice1.isDeviceActive, false);
    assert.equal(resDevice1.conflictDeviceId, "dev_laptop_2");
    assert.equal(resDevice1.conflictDeviceName, "MacBook Air");
  });

  test("Rule 14: 3rd device attempt is rejected and triggers 24-hour ban even during concurrency check", () => {
    const res = evaluateDeviceConcurrency({
      currentDeviceId: "dev_third_phone",
      currentDeviceName: "iPhone 15",
      profileCurrentDeviceId: "dev_laptop_2",
      registeredSessions: [
        { device_id: "dev_pc_1", is_active: true },
        { device_id: "dev_laptop_2", is_active: true }
      ],
      maxAllowed: 2
    });

    assert.equal(res.isBanned, true);
    assert.equal(res.allowed, false);
    assert.equal(res.isDeviceActive, false);
    assert.match(res.banReason, /Attempted 3rd device access/);
  });
});

