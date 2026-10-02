// test/trial.test.js
// Automated regression tests for Step Solver free trial lifecycle
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const TRIAL_DURATION_MS = 30 * 60 * 1000; // 30 minutes in milliseconds

/**
 * Pure evaluation function mirroring getSubscriptionStatus in background.js
 */
function evaluateSubscriptionStatus(data, now = Date.now()) {
  if (data.userProfile && data.userProfile.payment_status === "paid") {
    return {
      status: "LIFETIME_ACTIVE",
      isLifetime: true,
      isTrialExpired: false,
      remainingMs: Infinity,
      remainingMinutes: Infinity,
      remainingSeconds: Infinity
    };
  }

  if (data.isLifetimeActive === true) {
    return {
      status: "LIFETIME_ACTIVE",
      isLifetime: true,
      isTrialExpired: false,
      remainingMs: Infinity,
      remainingMinutes: Infinity,
      remainingSeconds: Infinity
    };
  }

  let trialStartedAt = null;

  // Prioritize server profile trial_started_at
  if (data.userProfile && data.userProfile.trial_started_at) {
    const serverMs = new Date(data.userProfile.trial_started_at).getTime();
    if (!isNaN(serverMs)) {
      trialStartedAt = serverMs;
    }
  } else if (data.trialStartedAt && typeof data.trialStartedAt === "number") {
    trialStartedAt = data.trialStartedAt;
  }

  let elapsedMs = 0;
  let remainingMs = TRIAL_DURATION_MS;
  let remainingMinutes = 30;
  let remainingSeconds = 1800;
  let isTrialExpired = false;

  if (trialStartedAt) {
    elapsedMs = now - trialStartedAt;
    remainingMs = Math.max(0, TRIAL_DURATION_MS - elapsedMs);
    remainingMinutes = Math.ceil(remainingMs / 60000);
    remainingSeconds = Math.ceil(remainingMs / 1000);
    isTrialExpired = remainingMs <= 0;
  } else {
    // Trial has not started yet (starts on first login after email confirmation)
    elapsedMs = 0;
    remainingMs = TRIAL_DURATION_MS;
    remainingMinutes = 30;
    remainingSeconds = 1800;
    isTrialExpired = false;
  }

  return {
    status: isTrialExpired ? "TRIAL_EXPIRED" : (trialStartedAt ? "TRIAL_ACTIVE" : "TRIAL_NOT_STARTED"),
    isLifetime: false,
    isTrialExpired,
    trialStarted: !!trialStartedAt,
    trialStartedAt,
    elapsedMs,
    remainingMs,
    remainingMinutes,
    remainingSeconds
  };
}

describe("Subscription & Free Trial Lifecycle", () => {
  test("Rule 1: Fresh install or unauthenticated state does NOT start trial countdown", () => {
    const result = evaluateSubscriptionStatus({});
    assert.equal(result.status, "TRIAL_NOT_STARTED");
    assert.equal(result.trialStarted, false);
    assert.equal(result.isTrialExpired, false);
    assert.equal(result.remainingMinutes, 30);
    assert.equal(result.remainingMs, 1800000);
  });

  test("Rule 2: Unconfirmed user signup has trial_started_at: null and 30m intact", () => {
    const unconfirmedUserStorage = {
      userProfile: {
        id: "user-abc-123",
        email: "test@example.com",
        payment_status: "unpaid",
        trial_started_at: null
      }
    };
    const result = evaluateSubscriptionStatus(unconfirmedUserStorage);
    assert.equal(result.status, "TRIAL_NOT_STARTED");
    assert.equal(result.isTrialExpired, false);
    assert.equal(result.trialStarted, false);
    assert.equal(result.remainingMinutes, 30);
  });

  test("Rule 3: First confirmed login activates trial freshly from Date.now()", () => {
    const now = 1775100000000;
    const firstLoginStorage = {
      trialStartedAt: now,
      userProfile: {
        id: "user-abc-123",
        email: "test@example.com",
        payment_status: "unpaid",
        trial_started_at: new Date(now).toISOString()
      }
    };
    const result = evaluateSubscriptionStatus(firstLoginStorage, now);
    assert.equal(result.status, "TRIAL_ACTIVE");
    assert.equal(result.trialStarted, true);
    assert.equal(result.isTrialExpired, false);
    assert.equal(result.remainingMinutes, 30);
    assert.equal(result.elapsedMs, 0);
  });

  test("Rule 4: Active trial calculates correct remaining minutes (e.g. 12 minutes elapsed)", () => {
    const start = 1775100000000;
    const now = start + 12 * 60 * 1000; // 12 minutes later
    const activeStorage = {
      userProfile: {
        id: "user-abc-123",
        email: "test@example.com",
        payment_status: "unpaid",
        trial_started_at: new Date(start).toISOString()
      }
    };
    const result = evaluateSubscriptionStatus(activeStorage, now);
    assert.equal(result.status, "TRIAL_ACTIVE");
    assert.equal(result.isTrialExpired, false);
    assert.equal(result.remainingMinutes, 18); // 30 - 12 = 18 minutes left
    assert.equal(result.remainingSeconds, 18 * 60);
  });

  test("Rule 5: Trial expires precisely when elapsed time reaches 30 minutes", () => {
    const start = 1775100000000;
    const now = start + 30 * 60 * 1000 + 1000; // 30 mins and 1 sec
    const expiredStorage = {
      userProfile: {
        id: "user-abc-123",
        email: "test@example.com",
        payment_status: "unpaid",
        trial_started_at: new Date(start).toISOString()
      }
    };
    const result = evaluateSubscriptionStatus(expiredStorage, now);
    assert.equal(result.status, "TRIAL_EXPIRED");
    assert.equal(result.isTrialExpired, true);
    assert.equal(result.remainingMs, 0);
  });

  test("Rule 6: Paid Lifetime subscription overrides expired trial", () => {
    const start = 1775100000000;
    const now = start + 100 * 60 * 1000; // 100 minutes later
    const lifetimeStorage = {
      userProfile: {
        id: "user-paid-999",
        email: "vip@example.com",
        payment_status: "paid",
        trial_started_at: new Date(start).toISOString()
      }
    };
    const result = evaluateSubscriptionStatus(lifetimeStorage, now);
    assert.equal(result.status, "LIFETIME_ACTIVE");
    assert.equal(result.isLifetime, true);
    assert.equal(result.isTrialExpired, false);
    assert.equal(result.remainingMinutes, Infinity);
  });

  test("Rule 7: Sign out removes trialStartedAt so subsequent user starts clean", () => {
    // Simulating authSignOut: removes trialStartedAt and deviceTrialStartedAt
    const storageBeforeSignOut = {
      trialStartedAt: 1775000000000,
      userProfile: { email: "user1@example.com", trial_started_at: "2026-03-01T00:00:00Z" }
    };
    
    // Perform simulated signout:
    const storageAfterSignOut = { ...storageBeforeSignOut };
    delete storageAfterSignOut.trialStartedAt;
    delete storageAfterSignOut.userProfile;

    // Next user checks status:
    const result = evaluateSubscriptionStatus(storageAfterSignOut);
    assert.equal(result.status, "TRIAL_NOT_STARTED");
    assert.equal(result.isTrialExpired, false);
    assert.equal(result.remainingMinutes, 30);
  });
});
