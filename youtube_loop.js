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
          if (autoPlay && videoElement && videoElement.paused) {
            startAutoplayWatcher(videoElement);
          }
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
    setInterval(checkReplayWatchdog, 800);
  }

  function clickElement(el) {
    if (!el) return;
    try {
      el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      if (typeof el.click === "function") el.click();
    } catch (_) {}
  }

  function attachVideoListeners(video) {
    if (!video || video.__hasStepLoopAttached) return;
    video.__hasStepLoopAttached = true;

    applyLoopState();

    // 1. Ended event: allow full playback completion before looping
    video.addEventListener("ended", () => {
      if (!autoLoop) return;
      console.log("[Step Solver YouTube] Video ended event fired. Looping after completion grace period...");
      restartVideo(video);
    });

    // 2. Pause event: if paused near the end (the Replay state)
    video.addEventListener("pause", () => {
      if (!autoLoop) return;
      const isNearEnd = video.duration > 0 && (video.duration - video.currentTime <= 2.0);
      const hasReplayBtn = !!document.querySelector(".ytp-play-button[title*='Replay' i], .ytp-play-button[aria-label*='Replay' i], button[aria-label*='Replay' i]");
      if ((isNearEnd || hasReplayBtn) && !video.__isRestartingLoop) {
        console.log("[Step Solver YouTube] Paused in Replay state near end. Looping...");
        restartVideo(video);
      }
    });

    // 3. Initial Autoplay: aggressively trigger native play button and poll until playing
    if (autoPlay) {
      startAutoplayWatcher(video);
      video.addEventListener("canplay", () => {
        if (autoPlay && video.paused) startAutoplayWatcher(video);
      }, { once: true });
    }

    // 4. One-time user interaction listener to unmute video once user interacts
    const unmuteOnInteraction = () => {
      try {
        if (video && video.muted) {
          video.muted = false;
          if (video.paused) video.play().catch(() => {});
        }
      } catch (_) {}
    };
    window.addEventListener("click", unmuteOnInteraction, { capture: true, once: true });
    window.addEventListener("keydown", unmuteOnInteraction, { capture: true, once: true });
  }

  function triggerNativePlay(video) {
    if (!video) return;

    // 1. Click native YouTube play button / thumbnail overlay
    try {
      const playBtn = document.querySelector(".ytp-large-play-button, .ytp-play-button, .ytp-cued-thumbnail-overlay");
      if (playBtn) clickElement(playBtn);
    } catch (_) {}

    // 2. Direct HTML5 play with muted autoplay bypass & safe unmuting
    try {
      if (video.paused) {
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            // Unmuted play blocked by browser policy; fall back to muted play
            video.muted = true;
            video.play().catch(() => {
              const playBtn = document.querySelector(".ytp-large-play-button, .ytp-play-button");
              if (playBtn) clickElement(playBtn);
            });

            // Safe unmute check: only stay unmuted if Chromium doesn't halt playback
            setTimeout(() => {
              try {
                const wasPaused = video.paused;
                video.muted = false;
                if (video.paused && !wasPaused) {
                  // Browser halted playback upon unmuting; restore muted state so it continues playing
                  video.muted = true;
                  video.play().catch(() => {});
                }
              } catch (_) {
                video.muted = true;
                video.play().catch(() => {});
              }
            }, 800);
          });
        }
      }
    } catch (_) {}
  }

  let autoplayWatcherInterval = null;
  function startAutoplayWatcher(video) {
    if (!autoPlay || !video) return;
    triggerNativePlay(video);

    if (autoplayWatcherInterval) clearInterval(autoplayWatcherInterval);
    let attempts = 0;
    autoplayWatcherInterval = setInterval(() => {
      attempts++;
      if (!autoPlay || !video || attempts >= 30) {
        clearInterval(autoplayWatcherInterval);
        autoplayWatcherInterval = null;
        return;
      }
      if (video.paused && !video.ended && !video.__isRestartingLoop) {
        triggerNativePlay(video);
      }
    }, 500);
  }

  function applyLoopState() {
    if (!videoElement) return;
    videoElement.loop = autoLoop;
  }

  async function restartVideo(video) {
    if (!video || video.__isRestartingLoop) return;
    video.__isRestartingLoop = true;

    try {
      // 1. Dispatch synthetic completion milestone so hosting platform registers 100% completion
      try {
        video.dispatchEvent(new Event("timeupdate", { bubbles: true, cancelable: true }));
        video.dispatchEvent(new Event("ended", { bubbles: true, cancelable: true }));
      } catch (_) {}

      // 2. Completion grace period (400ms) for platform tracking script to process completion
      await new Promise(res => setTimeout(res, 400));

      // 3. Replay via native replay button first (smoothest for YouTube embeds)
      const replayBtn = document.querySelector(".ytp-play-button[title*='Replay' i], .ytp-play-button[aria-label*='Replay' i], button[aria-label*='Replay' i], .ytp-large-play-button");
      if (replayBtn) {
        clickElement(replayBtn);
      }

      video.currentTime = 0;
      await video.play().catch(async () => {
        video.muted = true;
        await video.play().catch(() => {});
        setTimeout(() => {
          try {
            const wasPaused = video.paused;
            video.muted = false;
            if (video.paused && !wasPaused) {
              video.muted = true;
              video.play().catch(() => {});
            }
          } catch (_) {}
        }, 500);
      });
    } catch (_) {
      try {
        video.currentTime = 0;
        const replayBtn = document.querySelector(".ytp-play-button, button[aria-label*='Replay' i], .ytp-large-play-button");
        if (replayBtn) clickElement(replayBtn);
      } catch (_) {}
    } finally {
      setTimeout(() => {
        video.__isRestartingLoop = false;
      }, 500);
    }
  }

  function checkReplayWatchdog() {
    if (!autoLoop) return;
    const v = videoElement || document.querySelector("video.html5-main-video") || document.querySelector("video");
    if (!v || v.__isRestartingLoop) return;

    // Check if ended or stuck in paused replay state near end (e.g. 04:49 / 04:50)
    const isNearEnd = v.duration > 0 && (v.duration - v.currentTime <= 2.0);
    const hasReplayBtn = !!document.querySelector(".ytp-play-button[title*='Replay' i], .ytp-play-button[aria-label*='Replay' i], button[aria-label*='Replay' i]");

    if (v.ended || (isNearEnd && v.paused) || hasReplayBtn) {
      console.log("[Step Solver YouTube] Watchdog detected ended/replay state. Triggering loop...");
      restartVideo(v);
    }
  }
})();
