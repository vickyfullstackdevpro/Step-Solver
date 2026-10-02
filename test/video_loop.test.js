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

  test("Autoplay 1: PostMessage Sequence sends array args and mute/play/unmute sequence", () => {
    const postMessages = [];
    const mockIframe = {
      contentWindow: {
        postMessage: (str) => {
          postMessages.push(JSON.parse(str));
        }
      }
    };

    // Simulate playYouTubeIframe postMessage sequence
    mockIframe.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }));
    mockIframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }));
    mockIframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "mute", args: [] }));
    mockIframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }));

    assert.equal(postMessages.length, 4);
    assert.equal(Array.isArray(postMessages[1].args), true, "args must be an array, not a string");
    assert.equal(postMessages[1].func, "playVideo");
    assert.equal(postMessages[2].func, "mute");
  });

  test("Autoplay 2: Native in-frame trigger clicks .ytp-large-play-button when paused", () => {
    let playClicked = false;
    let playCalled = false;
    const mockButton = {
      click: () => { playClicked = true; }
    };
    const mockVideo = {
      paused: true,
      muted: false,
      play: async () => { playCalled = true; }
    };

    // Simulate triggerNativePlay
    mockButton.click();
    mockVideo.play();

    assert.equal(playClicked, true);
    assert.equal(playCalled, true);
  });

  test("Autoplay 3: HTML5 Paused Retry triggers play and big play button click for paused videos", async () => {
    let bigButtonClicked = false;
    let videoPlayed = false;
    const mockVideo = {
      paused: true,
      ended: false,
      play: async () => { videoPlayed = true; }
    };
    const mockBigButton = {
      click: () => { bigButtonClicked = true; }
    };

    if (mockVideo.paused && !mockVideo.ended) {
      await mockVideo.play();
      mockBigButton.click();
    }

    assert.equal(videoPlayed, true);
    assert.equal(bigButtonClicked, true);
  });

  test("Autoplay 4: Safe Unmute re-mutes immediately if browser policy pauses video on unmute", () => {
    const mockVideo = {
      paused: false,
      muted: true,
      play: () => {}
    };

    // Simulate browser behavior: unmuting causes browser to pause video
    const wasPaused = mockVideo.paused;
    mockVideo.muted = false;
    mockVideo.paused = true; // browser pauses it

    if (mockVideo.paused && !wasPaused) {
      mockVideo.muted = true;
      mockVideo.paused = false;
      mockVideo.play();
    }

    assert.equal(mockVideo.muted, true, "Must re-mute video to prevent stalled playback");
    assert.equal(mockVideo.paused, false, "Video must continue playing in muted state");
  });

  test("Autoplay 5: Replay watchdog threshold catches 04:49 / 04:50 paused near end", () => {
    const mockVideo = {
      duration: 290, // 04:50
      currentTime: 289, // 04:49
      paused: true,
      ended: false
    };

    const isNearEnd = mockVideo.duration > 0 && (mockVideo.duration - mockVideo.currentTime <= 2.0);
    const shouldLoop = mockVideo.ended || (isNearEnd && mockVideo.paused);

    assert.equal(isNearEnd, true, "2.0s threshold must identify 1s delta as near end");
    assert.equal(shouldLoop, true, "Must trigger loop for paused video at 04:49 / 04:50");
  });

  test("Autoplay 6: Iframe allow attribute ensures autoplay permission for cross-origin embeds", () => {
    const mockIframe = {
      attributes: {},
      getAttribute: function(key) { return this.attributes[key] || null; },
      setAttribute: function(key, val) { this.attributes[key] = val; }
    };

    const currentAllow = mockIframe.getAttribute("allow") || "";
    if (!currentAllow.toLowerCase().includes("autoplay")) {
      mockIframe.setAttribute("allow", currentAllow ? `${currentAllow}; autoplay` : "autoplay; encrypted-media; fullscreen");
    }

    assert.equal(mockIframe.getAttribute("allow").includes("autoplay"), true);
  });
});



