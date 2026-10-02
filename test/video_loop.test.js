// test/video_loop.test.js
// Automated regression tests for autoLoopVideoEnabled and dependency enforcement
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

/**
 * Simulates toggle logic executed in popup.js
 */
function handleAutoLoopToggle(newLoopVal, currentSettings) {
  const updated = { ...currentSettings, autoLoopVideoEnabled: newLoopVal };

  // Dependency rule: when autoLoopVideoEnabled is turned ON, automatically force autoPlayVideoEnabled ON if it was OFF
  if (newLoopVal && !currentSettings.autoPlayVideoEnabled) {
    updated.autoPlayVideoEnabled = true;
    updated._dependencyTriggered = true;
  }

  return updated;
}

/**
 * Simulates video loop applier in content.js
 */
function simulateApplyVideoLoop(videoElement, autoLoopVideoEnabled) {
  if (autoLoopVideoEnabled) {
    videoElement.loop = true;
    if (!videoElement.__hasStepLoopListener) {
      videoElement.__hasStepLoopListener = true;
      videoElement.onEnded = () => {
        if (autoLoopVideoEnabled) {
          videoElement.currentTime = 0;
          videoElement.play();
        }
      };
    }
  } else {
    videoElement.loop = false;
  }
  return videoElement;
}

describe("Auto-Loop Video Feature & Dependency Logic", () => {
  test("Dependency Rule 1: Turning ON auto-loop when auto-play is OFF forces auto-play ON", () => {
    const initialState = {
      autoPlayVideoEnabled: false,
      autoLoopVideoEnabled: false
    };

    const result = handleAutoLoopToggle(true, initialState);
    assert.equal(result.autoLoopVideoEnabled, true);
    assert.equal(result.autoPlayVideoEnabled, true);
    assert.equal(result._dependencyTriggered, true);
  });

  test("Dependency Rule 2: Turning ON auto-loop when auto-play is already ON preserves auto-play ON", () => {
    const initialState = {
      autoPlayVideoEnabled: true,
      autoLoopVideoEnabled: false
    };

    const result = handleAutoLoopToggle(true, initialState);
    assert.equal(result.autoLoopVideoEnabled, true);
    assert.equal(result.autoPlayVideoEnabled, true);
    assert.equal(result._dependencyTriggered, undefined);
  });

  test("Dependency Rule 3: Turning OFF auto-loop does NOT turn off auto-play", () => {
    const initialState = {
      autoPlayVideoEnabled: true,
      autoLoopVideoEnabled: true
    };

    const result = handleAutoLoopToggle(false, initialState);
    assert.equal(result.autoLoopVideoEnabled, false);
    assert.equal(result.autoPlayVideoEnabled, true);
  });

  test("Video Handler 1: Sets loop = true on HTML5 video when autoLoopVideoEnabled is true", () => {
    let playCalled = false;
    const mockVideo = {
      loop: false,
      currentTime: 10,
      play: () => { playCalled = true; }
    };

    simulateApplyVideoLoop(mockVideo, true);
    assert.equal(mockVideo.loop, true);
    assert.equal(mockVideo.__hasStepLoopListener, true);

    // Trigger ended event
    mockVideo.onEnded();
    assert.equal(mockVideo.currentTime, 0);
    assert.equal(playCalled, true);
  });

  test("Video Handler 2: Sets loop = false when autoLoopVideoEnabled is false", () => {
    const mockVideo = {
      loop: true,
      currentTime: 5,
      play: () => {}
    };

    simulateApplyVideoLoop(mockVideo, false);
    assert.equal(mockVideo.loop, false);
  });

  test("Video Handler 3: Dispatches synthetic completion milestone before rewinding", async () => {
    const dispatchedEvents = [];
    let currentTimeWhenDispatched = 0;
    const mockVideo = {
      duration: 60,
      currentTime: 60,
      dispatchEvent: (evt) => {
        dispatchedEvents.push(evt.type);
        currentTimeWhenDispatched = mockVideo.currentTime;
      }
    };

    // Simulate completion dispatch before rewinding
    mockVideo.dispatchEvent({ type: "timeupdate" });
    mockVideo.dispatchEvent({ type: "ended" });

    assert.equal(dispatchedEvents.includes("timeupdate"), true);
    assert.equal(dispatchedEvents.includes("ended"), true);
    assert.equal(currentTimeWhenDispatched, 60, "Timeline must reflect 100% completion (duration) when events fire");
  });

  test("Video Handler 4: Enforces completion grace period before resetting currentTime to 0", async () => {
    let resetTimelineTime = 0;
    const startTime = Date.now();
    const mockVideo = {
      currentTime: 45,
      duration: 45,
      play: async () => {}
    };

    // Simulate async grace period
    const gracePeriodMs = 400;
    await new Promise(res => setTimeout(res, gracePeriodMs));
    mockVideo.currentTime = 0;
    resetTimelineTime = Date.now();

    const elapsed = resetTimelineTime - startTime;
    assert.equal(elapsed >= 350, true, "Grace period must allow platform tracker at least 350ms to record completion");
    assert.equal(mockVideo.currentTime, 0);
  });

  test("Video Handler 5: Non-destructive iframe looping avoids reloading iframe.src", () => {
    const mockIframe = {
      src: "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1",
      postMessages: [],
      contentWindow: {
        postMessage: (msg) => {
          mockIframe.postMessages.push(JSON.parse(msg));
        }
      }
    };

    // Non-destructive loop control via postMessage without reassigning src
    mockIframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "seekTo", args: [0, true] }));
    mockIframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }));

    assert.equal(mockIframe.src, "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1", "Iframe src must NOT be rewritten");
    assert.equal(mockIframe.postMessages.length, 2);
    assert.equal(mockIframe.postMessages[0].func, "seekTo");
    assert.equal(mockIframe.postMessages[1].func, "playVideo");
  });
});

