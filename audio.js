(() => {
  if (window.__TRAIN_AUDIO_LOADED__) return;
  window.__TRAIN_AUDIO_LOADED__ = true;

  const AUDIO_SRC = new URL("./music/dissipate.mp3", window.location.href).href;
  const MUSIC_VOLUME = 0.4;
  const FADE_OUT_MS = 160;
  const KEY_ON = "train_audio_on";
  const KEY_TIME = "train_audio_time";
  const KEY_NAVIGATING = "train_audio_navigation";

  let sessionStorageAvailable = true;
  function readSessionValue(key) {
    if (!sessionStorageAvailable) return null;
    try {
      return window.sessionStorage.getItem(key);
    } catch (error) {
      sessionStorageAvailable = false;
      console.warn("Audio preferences cannot persist in this browser context.", error);
      return null;
    }
  }

  function writeSessionValue(key, value) {
    if (!sessionStorageAvailable) return;
    try {
      window.sessionStorage.setItem(key, value);
    } catch (error) {
      sessionStorageAvailable = false;
      console.warn("Audio preferences cannot persist in this browser context.", error);
    }
  }

  let isAudioOn = readSessionValue(KEY_ON) !== "false";
  let isInTunnel = false;
  let isNavigating = false;
  let fadeRaf = null;

  const musicAudio = new Audio(AUDIO_SRC);
  musicAudio.loop = true;
  musicAudio.preload = "auto";
  musicAudio.volume = 0;
  musicAudio.addEventListener("error", () => {
    console.error("Could not load audio file. Check that this exact path exists:", musicAudio.src);
  });

  function applySavedTime() {
    const savedTime = parseFloat(readSessionValue(KEY_TIME) || "0");
    if (!Number.isNaN(savedTime) && savedTime > 0) {
      const setPos = () => {
        if (musicAudio.duration && savedTime < musicAudio.duration) {
          musicAudio.currentTime = savedTime;
        }
      };
      if (musicAudio.readyState >= 1) setPos();
      else musicAudio.addEventListener("loadedmetadata", setPos, { once: true });
    }
  }

  function saveState() {
    writeSessionValue(KEY_ON, String(isAudioOn));
    if (!Number.isNaN(musicAudio.currentTime) && musicAudio.currentTime > 0) {
      writeSessionValue(KEY_TIME, String(musicAudio.currentTime));
    }
  }

  // Frame-smooth volume fade (prevents step-clicking during short transitions)
  function fadeVolume(target, duration = 220, onDone = null) {
    if (fadeRaf) cancelAnimationFrame(fadeRaf);
    const startVol = musicAudio.volume;
    const startTime = performance.now();

    function step(now) {
      const progress = Math.min(1, (now - startTime) / duration);
      // Ease-out curve for natural acoustic fade
      const eased = 1 - Math.pow(1 - progress, 2);
      musicAudio.volume = Math.max(0, Math.min(1, startVol + (target - startVol) * eased));

      if (progress < 1) {
        fadeRaf = requestAnimationFrame(step);
      } else {
        fadeRaf = null;
        if (onDone) onDone();
      }
    }

    if (duration <= 0) {
      musicAudio.volume = target;
      if (onDone) onDone();
      return;
    }
    fadeRaf = requestAnimationFrame(step);
  }

  function updateIconState() {
    const btn = document.getElementById("sound-toggle");
    if (!btn) return;
    btn.classList.toggle("is-muted", !isAudioOn);
    btn.setAttribute("aria-pressed", String(isAudioOn));
    btn.setAttribute("aria-label", isAudioOn ? "Turn music off" : "Turn music on");
  }

  function getTargetVolume() {
    return isInTunnel ? MUSIC_VOLUME * 0.65 : MUSIC_VOLUME;
  }

  function reportPlaybackError(error) {
    if (error && error.name === "NotAllowedError") {
      console.warn("Audio waiting for user interaction:", error.name);
      return;
    }
    console.error("Unable to play train music:", error);
  }

  async function startMusic(fadeMs = 300) {
    if (document.hidden || isNavigating) return false;
    try {
      await musicAudio.play();
      isAudioOn = true;
      saveState();
      updateIconState();
      fadeVolume(getTargetVolume(), fadeMs);
      return true;
    } catch (error) {
      reportPlaybackError(error);
      return false;
    }
  }

  function stopMusic(fadeMs = 220) {
    isAudioOn = false;
    saveState();
    updateIconState();
    fadeVolume(0, fadeMs, () => {
      if (!isAudioOn) musicAudio.pause();
    });
  }

  // Delegated click handler: works even if script loads before #sound-toggle
  document.addEventListener(
    "click",
    (e) => {
      const toggleBtn = e.target.closest("#sound-toggle");
      if (toggleBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (!isAudioOn || musicAudio.paused) {
          startMusic(300);
        } else {
          stopMusic(220);
        }
        return;
      }

      // Smoothly dip audio + page before navigating to internal pages
      const link = e.target.closest("a[href]");
      if (!link) return;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        link.target === "_blank" ||
        link.hasAttribute("download")
      ) {
        return;
      }

      const url = new URL(link.href, window.location.href);
      const isSameOrigin = url.origin === window.location.origin;
      const isHashOnly =
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash !== "";

      if (!isSameOrigin || isHashOnly) return;

      e.preventDefault();
      navigateSmoothly(url.href);
    },
    true
  );

  // Also usable if your project cards navigate via JS instead of <a> tags
  function navigateSmoothly(url) {
    if (isNavigating) return;
    isNavigating = true;
    writeSessionValue(KEY_NAVIGATING, "true");
    document.body.classList.add("page-leaving");

    if (isAudioOn && !musicAudio.paused) {
      fadeVolume(0, FADE_OUT_MS, () => {
        saveState();
        musicAudio.pause();
        window.location.href = url;
      });
    } else {
      saveState();
      setTimeout(() => {
        window.location.href = url;
      }, FADE_OUT_MS);
    }
  }
  window.navigateWithAudioFade = navigateSmoothly;

  // Unlock autoplay on first interaction anywhere EXCEPT the mute toggle
  function unlockOnFirstInteraction(e) {
    if (e.target && typeof e.target.closest === "function" && e.target.closest("#sound-toggle")) return;
    if (!isAudioOn) {
      removeUnlockListeners();
      return;
    }
    if (!musicAudio.paused || isNavigating) {
      removeUnlockListeners();
      return;
    }
    startMusic(450).then((started) => {
      if (started || !isAudioOn) removeUnlockListeners();
    });
  }

  function removeUnlockListeners() {
    window.removeEventListener("pointerdown", unlockOnFirstInteraction);
    window.removeEventListener("keydown", unlockOnFirstInteraction);
  }
  window.addEventListener("pointerdown", unlockOnFirstInteraction);
  window.addEventListener("keydown", unlockOnFirstInteraction);

  // Sync icon and start playback once DOM is ready
  function boot() {
    document.body.classList.remove("page-leaving");
    if (readSessionValue(KEY_NAVIGATING) === "true") {
      writeSessionValue(KEY_NAVIGATING, "false");
      document.body.classList.add("page-entering");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.body.classList.remove("page-entering");
        });
      });
    }
    updateIconState();
    applySavedTime();
    if (isAudioOn) {
      const resuming = parseFloat(readSessionValue(KEY_TIME) || "0") > 0;
      startMusic(resuming ? 240 : 550);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // Handle browser Back/Forward button (bfcache) cleanly
  window.addEventListener("pageshow", (e) => {
    isNavigating = false;
    document.body.classList.remove("page-leaving");
    document.body.classList.remove("page-entering");
    isAudioOn = readSessionValue(KEY_ON) !== "false";
    updateIconState();
    if (e.persisted) {
      applySavedTime();
      if (isAudioOn) startMusic(240);
      else musicAudio.pause();
    }
  });

  // Pause when switching tabs; resume on return
  document.addEventListener("visibilitychange", () => {
    if (!isAudioOn) return;
    if (document.hidden) {
      saveState();
      fadeVolume(0, 160, () => {
        if (document.hidden) musicAudio.pause();
      });
    } else if (!isNavigating) {
      musicAudio
        .play()
        .then(() => fadeVolume(getTargetVolume(), 300))
        .catch(reportPlaybackError);
    }
  });

  // Keep timestamp backed up in case user hits browser Back/Forward
  setInterval(() => {
    if (!musicAudio.paused && !isNavigating) saveState();
  }, 200);
  window.addEventListener("pagehide", saveState);

  // Tunnel hook for your train loop
  window.setTunnelAudio = function (inTunnel) {
    isInTunnel = inTunnel;
    if (isAudioOn && !musicAudio.paused && !isNavigating) {
      fadeVolume(getTargetVolume(), 450);
    }
  };
})();