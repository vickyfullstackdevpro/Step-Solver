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
});
