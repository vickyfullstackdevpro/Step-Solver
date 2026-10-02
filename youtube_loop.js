// youtube_loop.js - Direct in-frame loop & autoplay controller for YouTube embeds
(function() {
  if (window.__STEP_YOUTUBE_LOOP_INJECTED__) return;
  window.__STEP_YOUTUBE_LOOP_INJECTED__ = true;

  let autoLoop = false;
  let autoPlay = true;

  // 1. Load initial settings from extension storage
  try {
    chrome.storage.local.get(["autoLoopVideoEnabled", "autoPlayVideoEnabled"], (stored) => {
      if (chrome.runtime.lastError) return;
      if (stored) {
        autoLoop = stored.autoLoopVideoEnabled === true;
        if (stored.autoPlayVideoEnabled !== undefined) {
          autoPlay = stored.autoPlayVideoEnabled !== false;
        }
      }
      initPlayerObserver();
    });
  } catch (_) {
    initPlayerObserver();
  }

  // 2. React dynamically to toggle changes in popup
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        if (changes.autoLoopVideoEnabled !== undefined) {
          autoLoop = changes.autoLoopVideoEnabled.newValue === true;
          applyLoopState();
        }
        if (changes.autoPlayVideoEnabled !== undefined) {
          autoPlay = changes.autoPlayVideoEnabled.newValue !== false;
        }
      }
    });
  } catch (_) {}

  let videoElement = null;

  function initPlayerObserver() {
    videoElement = document.querySelector("video.html5-main-video") || document.querySelector("video");
    if (videoElement) {
      attachVideoListeners(videoElement);
    } else {
      const observer = new MutationObserver(() => {
        const v = document.querySelector("video.html5-main-video") || document.querySelector("video");
        if (v && v !== videoElement) {
          videoElement = v;
          attachVideoListeners(videoElement);
          observer.disconnect();
        }
      });
      observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    }

    // Periodic safety watchdog for Replay state
    setInterval(checkReplayWatchdog, 1000);
  }

  function attachVideoListeners(video) {
    if (!video || video.__hasStepLoopAttached) return;
    video.__hasStepLoopAttached = true;

    applyLoopState();

    // 1. Timeupdate check: rewind right before reaching the end to prevent end-screen stall
    video.addEventListener("timeupdate", () => {
      if (!autoLoop) return;
      if (video.duration > 0 && video.currentTime >= video.duration - 0.4) {
        console.log("[Step Solver YouTube] Reached end of video. Looping back to start...");
        restartVideo(video);
      }
    });

    // 2. Ended event
    video.addEventListener("ended", () => {
      if (!autoLoop) return;
      console.log("[Step Solver YouTube] Video ended event fired. Looping...");
      restartVideo(video);
    });

    // 3. Pause event: if paused near the end (the Replay state)
    video.addEventListener("pause", () => {
      if (!autoLoop) return;
      if (video.duration > 0 && Math.abs(video.currentTime - video.duration) < 1.5) {
        console.log("[Step Solver YouTube] Paused in Replay state. Looping...");
        restartVideo(video);
      }
    });

    // 4. Initial Autoplay if enabled
    if (autoPlay && video.paused) {
      setTimeout(() => {
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
          setTimeout(() => { video.muted = false; }, 800);
        });
      }, 500);
    }
  }

  function applyLoopState() {
    if (!videoElement) return;
    videoElement.loop = autoLoop;
  }

  async function restartVideo(video) {
    if (!video) return;
    try {
      video.currentTime = 0;
      await video.play();
    } catch (_) {
      try {
        video.muted = true;
        await video.play();
        setTimeout(() => { video.muted = false; }, 400);
      } catch (err) {
        // Fallback: click YouTube replay button
        const replayBtn = document.querySelector(".ytp-play-button, button[aria-label*='Replay' i], .ytp-large-play-button");
        if (replayBtn) replayBtn.click();
      }
    }
  }

  function checkReplayWatchdog() {
    if (!autoLoop) return;
    const v = videoElement || document.querySelector("video.html5-main-video") || document.querySelector("video");
    if (!v) return;

    // Check if ended or stuck in paused replay state near end
    const isAtEnd = v.ended || (v.duration > 0 && Math.abs(v.currentTime - v.duration) < 1.5 && v.paused);
    if (isAtEnd) {
      console.log("[Step Solver YouTube] Watchdog detected ended/replay state. Triggering loop...");
      restartVideo(v);
    }
  }
})();
