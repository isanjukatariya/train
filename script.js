(function () {
      const root = document.documentElement;
      const body = document.body;
      const delhiClock = document.getElementById('delhiClock');
      const SPEED_MULT = 0.5; // Permanently slow
      body.setAttribute('data-speed', 'slow');
      const sunBadge = document.getElementById('sunOcclusionBadge');
      const sceneContainer = document.getElementById('sceneContainer');

      // Parallax Exterior Track Layers
      const extClouds   = document.getElementById('ext-layer-1-clouds');
      const extDistant  = document.getElementById('ext-layer-2-distant');
      const extMid      = document.getElementById('ext-layer-3-midground');
      const extRooftops = document.getElementById('ext-layer-4-rooftops-guardrail');
      const extPoles    = document.getElementById('ext-layer-5-poles-wires');

      const doorDistant   = document.getElementById('door-ext-layer-2-distant');
      const doorMid       = document.getElementById('door-ext-layer-3-midground');
      const doorGuardrail = document.getElementById('door-ext-layer-4-guardrail');
      const doorPoles     = document.getElementById('door-ext-layer-5-poles');

      // Cached CSS custom property values to avoid redundant full-DOM style recalculations
      const appliedVars = {
        sun: -1,
        sunSlide: -999,
        night: -1,
        dayExt: -1,
        nightExt: -1,
        streetFlash: -1,
        streetX: -999
      };

      function setRootVarIfChanged(key, cssVarName, val, threshold, unit) {
        if (Math.abs(val - appliedVars[key]) >= threshold) {
          appliedVars[key] = val;
          root.style.setProperty(cssVarName, unit ? val.toFixed(1) + unit : val.toFixed(3));
        }
      }

      // =========================================================================
      // TAB VISIBILITY PAUSE HANDLER (Pauses all CSS & JS animations when hidden)
      // =========================================================================
      let isTabHidden = document.hidden;
      if (isTabHidden) body.classList.add('tab-hidden');

      document.addEventListener('visibilitychange', function () {
        isTabHidden = document.hidden;
        body.classList.toggle('tab-hidden', isTabHidden);
      });

      // =========================================================================
      // SEQUENTIAL DAY / NIGHT FADE ENGINE (1s Day Out -> 1s Night In)
      // - Avoids double-exposed buildings halfway through the transition
      // - Interior lighting (--night) smoothly follows the transition
      // =========================================================================
      const dayNightBtn = document.getElementById('dayNightToggleBtn');
      const iconSun = document.getElementById('iconSun');
      const iconMoon = document.getElementById('iconMoon');
      const iconAutoDot = document.getElementById('iconAutoDot');

      const urlParams = new URLSearchParams(window.location.search);
      const timeParam = urlParams.get('time');
      let urlMinutesOverride = null;
      if (timeParam) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(timeParam.trim());
        if (m) {
          const hh = parseInt(m[1], 10);
          const mm = parseInt(m[2], 10);
          if (hh >= 0 && hh < 24 && mm >= 0 && mm < 60) {
            urlMinutesOverride = hh * 60 + mm;
          }
        }
      }

      function smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
      }

      function easeInOutSine(t) {
        return -(Math.cos(Math.PI * Math.max(0, Math.min(1, t))) - 1) / 2;
      }

      function getDelhiTimeParts() {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).formatToParts(new Date());

        const map = {};
        parts.forEach(function (p) { map[p.type] = p.value; });
        return {
          h: parseInt(map.hour, 10) % 24,
          m: parseInt(map.minute, 10),
          s: parseInt(map.second, 10)
        };
      }

      function updateDelhiClock() {
        if (!delhiClock) return;
        const t = getDelhiTimeParts();
        const period = t.h >= 12 ? 'PM' : 'AM';
        const h12 = t.h % 12 || 12;
        const hh = String(h12).padStart(2, '0');
        const mm = String(t.m).padStart(2, '0');
        delhiClock.textContent = `${hh}:${mm} ${period} · IST`;
      }

      updateDelhiClock();
      setInterval(updateDelhiClock, 10000);

      function getEffectiveMinutesOfDay() {
        if (urlMinutesOverride !== null) return urlMinutesOverride;
        const t = getDelhiTimeParts();
        return t.h * 60 + t.m + t.s / 60;
      }

      function computeAutoNightTarget() {
        const mins = getEffectiveMinutesOfDay();
        const dawnStart = 5 * 60 + 45;  // 05:45
        const dawnEnd   = 6 * 60 + 15;  // 06:15
        const duskStart = 17 * 60 + 45; // 17:45
        const duskEnd   = 18 * 60 + 15; // 18:15

        if (mins >= dawnEnd && mins < duskStart) return 0.0;
        if (mins >= duskEnd || mins < dawnStart) return 1.0;
        if (mins >= dawnStart && mins < dawnEnd) {
          return 1.0 - smoothstep(dawnStart, dawnEnd, mins);
        }
        return smoothstep(duskStart, duskEnd, mins);
      }

      const THEME_STORAGE_KEY = 'train-theme-mode';

      function getSavedTheme() {
        try { return localStorage.getItem(THEME_STORAGE_KEY); } catch (_) { return null; }
      }

      function saveTheme(mode) {
        try {
          if (mode === 'day' || mode === 'night') {
            localStorage.setItem(THEME_STORAGE_KEY, mode);
          } else {
            localStorage.removeItem(THEME_STORAGE_KEY);
          }
        } catch (_) {}
      }

      const savedTheme = getSavedTheme();
      const initialMode = (savedTheme === 'day' || savedTheme === 'night') ? savedTheme : 'auto';
      const initialRaw = initialMode === 'night' ? 1.0 : initialMode === 'day' ? 0.0 : computeAutoNightTarget();

      const FADE_DURATION = 2.0; // 1.0s fade out first scene + 1.0s fade in second scene
      const timeControl = {
        mode: initialMode,
        manualSequenceStep: initialMode === 'auto' ? 0 : 1,
        rawProgress: initialRaw, // 0.0 = Full Day, 1.0 = Full Night
        fadeStartRaw: initialRaw,
        fadeTargetRaw: initialRaw,
        fadeElapsed: FADE_DURATION,
        currentNight: 0
      };

      let lastIconNightState = null;
      let lastIconModeState = null;

      function updateToggleIconUI() {
        const isNightVisual = timeControl.rawProgress >= 0.5;
        if (isNightVisual === lastIconNightState && timeControl.mode === lastIconModeState) return;
        lastIconNightState = isNightVisual;
        lastIconModeState = timeControl.mode;

        body.classList.toggle('is-night-theme', isNightVisual);
        iconSun.style.display = isNightVisual ? 'none' : 'block';
        iconMoon.style.display = isNightVisual ? 'block' : 'none';
        iconAutoDot.style.opacity = timeControl.mode === 'auto' ? '0.85' : '0';

        const modeLabel = timeControl.mode === 'auto'
          ? `Auto (${isNightVisual ? 'Night' : 'Day'}) — Click to switch`
          : `Manual: ${timeControl.mode === 'night' ? 'Night' : 'Day'} — Click to switch`;
        dayNightBtn.setAttribute('title', modeLabel);
      }

      function startSmoothNightTransition(targetRaw) {
        timeControl.fadeStartRaw = timeControl.rawProgress;
        timeControl.fadeTargetRaw = targetRaw;
        timeControl.fadeElapsed = 0;
      }

      dayNightBtn.addEventListener('click', function () {
        if (timeControl.mode === 'auto') {
          const currentlyNight = timeControl.rawProgress >= 0.5;
          timeControl.mode = currentlyNight ? 'day' : 'night';
          timeControl.manualSequenceStep = 1;
          startSmoothNightTransition(timeControl.mode === 'night' ? 1.0 : 0.0);
        } else if (timeControl.manualSequenceStep === 1) {
          timeControl.mode = timeControl.mode === 'night' ? 'day' : 'night';
          timeControl.manualSequenceStep = 2;
          startSmoothNightTransition(timeControl.mode === 'night' ? 1.0 : 0.0);
        } else {
          timeControl.mode = 'auto';
          timeControl.manualSequenceStep = 0;
          startSmoothNightTransition(computeAutoNightTarget());
        }
        saveTheme(timeControl.mode);
        updateToggleIconUI();
      });

      let debugVisible = false;
      window.addEventListener('keydown', function (e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (e.key === 'd' || e.key === 'D') {
          debugVisible = !debugVisible;
          body.classList.toggle('debug-open', debugVisible);
        } else if (e.key === 'n' || e.key === 'N') {
          const targetMode = timeControl.rawProgress >= 0.5 ? 'day' : 'night';
          timeControl.mode = targetMode;
          timeControl.manualSequenceStep = 1;
          saveTheme(targetMode);
          startSmoothNightTransition(targetMode === 'night' ? 1.0 : 0.0);
          updateToggleIconUI();
        }
      });

      function applyDayNightVariables(raw) {
        // 1. First half (0.0 -> 0.5, ~1s): Day exterior scenery fades out completely (1 -> 0) while Night exterior stays at 0.
        // 2. Second half (0.5 -> 1.0, ~1s): Night exterior scenery fades in (0 -> 1) while Day exterior stays at 0.
        const dayExtLinear = Math.max(0, Math.min(1, (0.5 - raw) / 0.5));
        const nightExtLinear = Math.max(0, Math.min(1, (raw - 0.5) / 0.5));

        const dayExt = easeInOutSine(dayExtLinear);
        const nightExt = easeInOutSine(nightExtLinear);

        // Interior lighting follows smoothly behind the exterior sky shift
        const interiorNight = easeInOutSine(raw);
        timeControl.currentNight = interiorNight;

        setRootVarIfChanged('dayExt', '--day-ext', dayExt, 0.004, '');
        setRootVarIfChanged('nightExt', '--night-ext', nightExt, 0.004, '');
        setRootVarIfChanged('night', '--night', interiorNight, 0.004, '');
        updateToggleIconUI();
      }

      function updateNightFactor(dt) {
        if (timeControl.mode === 'auto') {
          timeControl.fadeTargetRaw = computeAutoNightTarget();
        }
        if (timeControl.fadeElapsed < FADE_DURATION) {
          timeControl.fadeElapsed = Math.min(FADE_DURATION, timeControl.fadeElapsed + dt);
          const linearP = timeControl.fadeElapsed / FADE_DURATION;
          timeControl.rawProgress = timeControl.fadeStartRaw + (timeControl.fadeTargetRaw - timeControl.fadeStartRaw) * linearP;
        } else {
          timeControl.rawProgress += (timeControl.fadeTargetRaw - timeControl.rawProgress) * Math.min(1, dt * 4);
        }
        timeControl.rawProgress = Math.max(0, Math.min(1, timeControl.rawProgress));
        applyDayNightVariables(timeControl.rawProgress);
      }

      // Initialize Day/Night CSS variables immediately on load
      applyDayNightVariables(timeControl.rawProgress);

      function updateNightStreetlightSweep(scrollPolesCurr) {
        if (timeControl.currentNight <= 0.005) {
          setRootVarIfChanged('streetFlash', '--street-flash', 0, 0.01, '');
          return;
        }
        const period = 800;
        const phase = ((scrollPolesCurr + 180) % period) / period;
        const center = 0.5;
        const halfWidth = 0.34;
        const dist = Math.abs(phase - center);
        let flash = 0;
        let sweepX = 0;
        if (dist < halfWidth) {
          const norm = (phase - (center - halfWidth)) / (halfWidth * 2);
          flash = Math.pow(Math.sin(norm * Math.PI), 1.35);
          sweepX = (0.5 - norm) * 420;
        }
        setRootVarIfChanged('streetFlash', '--street-flash', flash, 0.008, '');
        if (flash > 0.005) {
          setRootVarIfChanged('streetX', '--street-x', sweepX, 1.2, 'px');
        }
      }

      // =========================================================================
      // 2. STATEFUL RANDOM SUNLIGHT CYCLE ENGINE
      // =========================================================================
      function randRange(min, max) {
        return min + Math.random() * (max - min);
      }

      const sunCycle = {
        phase: 'ON',
        elapsed: 0,
        duration: randRange(4.8, 8.5),
        baseSun: 1.0,
        finalSun: 1.0,
        slideOffset: -14,
        slideSpeed: 3.6,
        dappledMode: false,
        poleFlickerTimer: 0,
        poleFlickerDuration: 0.14
      };

      function advanceSunStateMachine(dt, scrollPolesPrev, scrollPolesCurr, scrollMidCurr) {
        sunCycle.elapsed += dt;
        const p = Math.min(1, sunCycle.elapsed / Math.max(0.001, sunCycle.duration));

        if (sunCycle.phase === 'ON') {
          sunCycle.baseSun = 1.0;
          if (sunCycle.elapsed >= sunCycle.duration) {
            sunCycle.phase = 'FADE_OUT';
            sunCycle.elapsed = 0;
            sunCycle.duration = randRange(0.6, 1.5);
            sunCycle.dappledMode = Math.random() < 0.45;
          }
        } else if (sunCycle.phase === 'FADE_OUT') {
          sunCycle.baseSun = 1.0 - easeInOutSine(p);
          if (sunCycle.elapsed >= sunCycle.duration) {
            sunCycle.phase = 'SHADE';
            sunCycle.elapsed = 0;
            sunCycle.duration = randRange(1.5, 5.0);
            sunCycle.baseSun = 0.0;
          }
        } else if (sunCycle.phase === 'SHADE') {
          sunCycle.baseSun = 0.0;
          if (sunCycle.elapsed >= sunCycle.duration) {
            sunCycle.phase = 'FADE_IN';
            sunCycle.elapsed = 0;
            sunCycle.duration = randRange(0.8, 2.0);
            sunCycle.slideOffset = -16;
            sunCycle.slideSpeed = randRange(3.2, 5.2);
          }
        } else if (sunCycle.phase === 'FADE_IN') {
          sunCycle.baseSun = easeInOutSine(p);
          if (sunCycle.elapsed >= sunCycle.duration) {
            sunCycle.phase = 'ON';
            sunCycle.elapsed = 0;
            sunCycle.duration = randRange(4.0, 9.0);
            sunCycle.baseSun = 1.0;
            sunCycle.dappledMode = Math.random() < 0.35;
          }
        }

        const poleCheckA = (scrollPolesCurr + 400) % 800;
        const poleCheckPrev = (scrollPolesPrev + 400) % 800;
        if (poleCheckPrev > poleCheckA && sunCycle.baseSun > 0.35 && Math.random() < 0.45) {
          sunCycle.poleFlickerDuration = randRange(0.11, 0.18);
          sunCycle.poleFlickerTimer = sunCycle.poleFlickerDuration;
        }

        let mod = 1.0;
        if (sunCycle.poleFlickerTimer > 0) {
          sunCycle.poleFlickerTimer = Math.max(0, sunCycle.poleFlickerTimer - dt);
          const fp = 1.0 - (sunCycle.poleFlickerTimer / sunCycle.poleFlickerDuration);
          mod *= (1.0 - Math.sin(fp * Math.PI) * 0.38);
        }

        const midModX = scrollMidCurr % 1600;
        const inTreeCanopy = (midModX > 320 && midModX < 620) || sunCycle.dappledMode;
        if (inTreeCanopy && sunCycle.baseSun > 0.15) {
          mod *= (0.91 + 0.09 * Math.sin(performance.now() * 0.018) * Math.cos(performance.now() * 0.011));
        }

        sunCycle.finalSun = Math.max(0, Math.min(1, sunCycle.baseSun * mod));

        // Sunlight fades out in sync with the day exterior scene (--day-ext)
        const dayFactor = appliedVars.dayExt >= 0 ? appliedVars.dayExt : (1.0 - timeControl.currentNight);
        const effectiveSun = sunCycle.finalSun * dayFactor;

        if (effectiveSun > 0.02) {
          sunCycle.slideOffset += sunCycle.slideSpeed * dt;
          if (sunCycle.slideOffset > 22) sunCycle.slideOffset = -18;
          setRootVarIfChanged('sunSlide', '--sun-slide', sunCycle.slideOffset, 0.4, 'px');
        }

        setRootVarIfChanged('sun', '--sun', effectiveSun, 0.005, '');

        if (debugVisible) {
          sunBadge.textContent = `--sun: ${effectiveSun.toFixed(2)} | --day-ext: ${dayFactor.toFixed(2)} | --night: ${timeControl.currentNight.toFixed(2)}`;
        }
      }

      // =========================================================================
      // 3. REAL-TIME PARALLAX LOOP ENGINE (PAUSES WHEN TAB IS HIDDEN)
      // =========================================================================
      const MAIN_TILE_W = 1600;
      const DOOR_TILE_W = 600;

      const SPEEDS = {
        clouds:        MAIN_TILE_W / 50.0,
        distant:       MAIN_TILE_W / 20.0,
        mid:           MAIN_TILE_W / 6.5,
        rooftops:      MAIN_TILE_W / 2.2,
        poles:         MAIN_TILE_W / 0.95,
        doorDistant:   DOOR_TILE_W / 10.0,
        doorMid:       DOOR_TILE_W / 3.2,
        doorGuardrail: DOOR_TILE_W / 1.25,
        doorPoles:     DOOR_TILE_W / 0.85
      };

      const scrollX = {
        clouds: 0, distant: 0, mid: 0, rooftops: 0, poles: 0,
        doorDistant: 0, doorMid: 0, doorGuardrail: 0, doorPoles: 0
      };

      let lastTime = performance.now();

      function animateScene(now) {
        // When tab is hidden, freeze all JS state updates and reset lastTime
        if (isTabHidden) {
          lastTime = now;
          requestAnimationFrame(animateScene);
          return;
        }

        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;

        const speedMult = SPEED_MULT;

        if (speedMult > 0) {
          const prevPoles = scrollX.poles;

          scrollX.clouds        = (scrollX.clouds        + SPEEDS.clouds        * speedMult * dt) % MAIN_TILE_W;
          scrollX.distant       = (scrollX.distant       + SPEEDS.distant       * speedMult * dt) % MAIN_TILE_W;
          scrollX.mid           = (scrollX.mid           + SPEEDS.mid           * speedMult * dt) % MAIN_TILE_W;
          scrollX.rooftops      = (scrollX.rooftops      + SPEEDS.rooftops      * speedMult * dt) % MAIN_TILE_W;
          scrollX.poles         = (scrollX.poles         + SPEEDS.poles         * speedMult * dt) % MAIN_TILE_W;

          scrollX.doorDistant   = (scrollX.doorDistant   + SPEEDS.doorDistant   * speedMult * dt) % DOOR_TILE_W;
          scrollX.doorMid       = (scrollX.doorMid       + SPEEDS.doorMid       * speedMult * dt) % DOOR_TILE_W;
          scrollX.doorGuardrail = (scrollX.doorGuardrail + SPEEDS.doorGuardrail * speedMult * dt) % DOOR_TILE_W;
          scrollX.doorPoles     = (scrollX.doorPoles     + SPEEDS.doorPoles     * speedMult * dt) % DOOR_TILE_W;

          extClouds.style.transform   = `translate3d(${-scrollX.clouds.toFixed(1)}px, 0px, 0px)`;
          extDistant.style.transform  = `translate3d(${-scrollX.distant.toFixed(1)}px, 0px, 0px)`;
          extMid.style.transform      = `translate3d(${-scrollX.mid.toFixed(1)}px, 0px, 0px)`;
          extRooftops.style.transform = `translate3d(${-scrollX.rooftops.toFixed(1)}px, 0px, 0px)`;
          extPoles.style.transform    = `translate3d(${-scrollX.poles.toFixed(1)}px, 0px, 0px)`;

          doorDistant.style.transform   = `translate3d(${-scrollX.doorDistant.toFixed(1)}px, 0px, 0px)`;
          doorMid.style.transform       = `translate3d(${-scrollX.doorMid.toFixed(1)}px, 0px, 0px)`;
          doorGuardrail.style.transform = `translate3d(${-scrollX.doorGuardrail.toFixed(1)}px, 0px, 0px)`;
          doorPoles.style.transform     = `translate3d(${-scrollX.doorPoles.toFixed(1)}px, 0px, 0px)`;

          updateNightFactor(dt);
          updateNightStreetlightSweep(scrollX.poles);
          advanceSunStateMachine(dt * speedMult, prevPoles, scrollX.poles, scrollX.mid);
        } else {
          updateNightFactor(dt);
        }

        requestAnimationFrame(animateScene);
      }

      requestAnimationFrame(animateScene);

      // =========================================================================
      // 4. ULTRA-LIGHTWEIGHT TILED 128x128 FILM GRAIN
      // =========================================================================
      (function initLightweightFilmGrain() {
        const grainLayer = document.getElementById('grainLayer');
        const offCanvas = document.createElement('canvas');
        offCanvas.width = 128;
        offCanvas.height = 128;
        const ctx = offCanvas.getContext('2d');
        if (!ctx) return;

        const imgData = ctx.createImageData(128, 128);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const v = (Math.random() * 255) | 0;
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
          data[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        grainLayer.style.backgroundImage = `url(${offCanvas.toDataURL()})`;

        const offsets = [
          [0, 0], [-28, -18], [22, -32], [-16, 26],
          [30, 14], [-34, 12], [14, -22], [-20, -28]
        ];
        let step = 0;
        setInterval(function () {
          if (body.getAttribute('data-speed') !== 'paused' && !isTabHidden) {
            step = (step + 1) & 7;
            const pair = offsets[step];
            grainLayer.style.transform = `translate3d(${pair[0]}px, ${pair[1]}px, 0px)`;
          }
        }, 125);
      })();

      // 5. Periodic Smooth "Rail Joint" Suspension Dip
      function triggerRailJointJolt() {
        if (body.getAttribute('data-speed') !== 'paused' && !isTabHidden) {
          sceneContainer.classList.remove('jolt-active');
          void sceneContainer.offsetWidth;
          sceneContainer.classList.add('jolt-active');
        }
        const isSlow = body.getAttribute('data-speed') === 'slow';
        const baseDelay = 3600 + Math.random() * 1600;
        setTimeout(triggerRailJointJolt, isSlow ? baseDelay * 1.6 : baseDelay);
      }
      setTimeout(triggerRailJointJolt, 2200);



      // =========================================================================
      // 7. FLEXIBLE THREAD / WEBBING STRAP & HINGED HANDLE PHYSICS
      // =========================================================================
      const svgEl = document.getElementById('commuterTrainSvg');
      const STRAP_LEN = 80; // Distance from rail pivot (y=122) to handle buckle (y=202)

      const straps = [
        { id: 'hand-strap-1', pivotX: 555, pivotY: 122 },
        { id: 'hand-strap-2', pivotX: 701, pivotY: 122 },
        { id: 'hand-strap-3', pivotX: 837, pivotY: 122 }
      ].map(function (cfg) {
        const el = document.getElementById(cfg.id);
        return {
          el: el,
          bandMain: el ? el.querySelector('.strap-band-main') : null,
          bandEdge: el ? el.querySelector('.strap-band-edge') : null,
          bandStitch: el ? el.querySelector('.strap-band-stitch') : null,
          handleRing: el ? el.querySelector('.strap-handle-ring') : null,
          pivotX: cfg.pivotX,
          pivotY: cfg.pivotY,
          angle: 0,         // Main strap angle (rad)
          omega: 0,         // Main strap angular velocity
          ringAngle: 0,     // Independent lower handle wrist angle (rad)
          ringOmega: 0,     // Handle angular velocity
          stretch: 0,       // Slight elastic tension when pulled
          dragging: false,
          springActive: false,
          pointerId: null
        };
      });

      function clientToSvgPoint(clientX, clientY) {
        const pt = svgEl.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const ctm = svgEl.getScreenCTM();
        return ctm ? pt.matrixTransform(ctm.inverse()) : { x: clientX, y: clientY };
      }

      // Renders the curved quadratic Bezier thread/webbing and positions the hinged handle
      function renderFlexibleStrap(s) {
        if (!s.bandMain || !s.handleRing) return;

        const len = STRAP_LEN + s.stretch;
        const sinA = Math.sin(s.angle);
        const cosA = Math.cos(s.angle);

        // End of the flexible strap (where the buckle meets the triangle ring)
        const endX = s.pivotX - sinA * len;
        const endY = s.pivotY + cosA * len;

        // Control point sags downward with gravity + lags slightly with velocity for a whip/thread curve
        const gravitySagX = s.pivotX - sinA * (len * 0.42) + s.omega * 1.4;
        const gravitySagY = s.pivotY + cosA * (len * 0.56) + Math.abs(sinA) * 10;

        s.bandMain.setAttribute(
          'd',
          `M ${s.pivotX},${s.pivotY} Q ${gravitySagX.toFixed(1)},${gravitySagY.toFixed(1)} ${endX.toFixed(1)},${endY.toFixed(1)}`
        );
        s.bandEdge.setAttribute(
          'd',
          `M ${s.pivotX - 5},${s.pivotY + 2} Q ${(gravitySagX - 5 * cosA).toFixed(1)},${(gravitySagY - 5 * sinA).toFixed(1)} ${(endX - 5 * cosA).toFixed(1)},${(endY - 5 * sinA).toFixed(1)}`
        );
        s.bandStitch.setAttribute(
          'd',
          `M ${s.pivotX + 3},${s.pivotY + 2} Q ${(gravitySagX + 3 * cosA).toFixed(1)},${(gravitySagY + 3 * sinA).toFixed(1)} ${(endX + 3 * cosA).toFixed(1)},${(endY + 3 * sinA).toFixed(1)}`
        );

        // Translate the handle ring to the dynamic end of the thread and rotate around its buckle hinge
        const dx = endX - s.pivotX;
        const dy = endY - (s.pivotY + STRAP_LEN);
        const deg = (s.ringAngle * 180) / Math.PI;

        s.handleRing.setAttribute(
          'transform',
          `translate(${dx.toFixed(2)}, ${dy.toFixed(2)}) rotate(${deg.toFixed(2)}, ${s.pivotX}, ${s.pivotY + STRAP_LEN})`
        );
      }

      straps.forEach(function (s) {
        if (!s.el) return;

        s.el.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          e.stopPropagation();
          s.dragging = true;
          s.pointerId = e.pointerId;
          s.el.style.cursor = 'grabbing';
          if (s.el.setPointerCapture) s.el.setPointerCapture(e.pointerId);

          // Pause the whole-group CSS pendulum rotation so our curved thread geometry takes over
          s.el.style.animation = 'none';
          s.el.style.transform = 'none';
          s.omega = 0;
          s.ringOmega = 0;

          const p = clientToSvgPoint(e.clientX, e.clientY);
          const dx = p.x - s.pivotX;
          const dy = Math.max(25, p.y - s.pivotY);
          const dist = Math.hypot(dx, dy);

          s.angle = Math.max(-0.85, Math.min(0.85, Math.atan2(-dx, dy)));
          // Handle ring angles slightly further toward the pull direction
          s.ringAngle = s.angle * 1.28;
          s.stretch = Math.max(0, Math.min(10, (dist - 130) * 0.08));
          renderFlexibleStrap(s);
        });

        s.el.addEventListener('pointermove', function (e) {
          if (!s.dragging || e.pointerId !== s.pointerId) return;
          const p = clientToSvgPoint(e.clientX, e.clientY);
          const dx = p.x - s.pivotX;
          const dy = Math.max(25, p.y - s.pivotY);
          const dist = Math.hypot(dx, dy);

          const targetAngle = Math.max(-0.85, Math.min(0.85, Math.atan2(-dx, dy)));
          s.omega = (targetAngle - s.angle) * 16;
          s.angle = targetAngle;
          // Handle ring tilts with natural wrist lag + pull tension
          s.ringAngle = targetAngle * 1.25 - Math.max(-0.35, Math.min(0.35, s.omega * 0.04));
          s.stretch = Math.max(0, Math.min(12, (dist - 130) * 0.09));
          renderFlexibleStrap(s);
        });

        function endStrapDrag(e) {
          if (!s.dragging || (e && e.pointerId !== undefined && e.pointerId !== s.pointerId)) return;
          s.dragging = false;
          s.el.style.cursor = 'grab';
          if (e && s.el.releasePointerCapture) {
            try { s.el.releasePointerCapture(e.pointerId); } catch (_) {}
          }
          s.springActive = true;
        }

        s.el.addEventListener('pointerup', endStrapDrag);
        s.el.addEventListener('pointercancel', endStrapDrag);
      });

      let lastStrapTime = performance.now();
      function updateStrapPhysics(now) {
        const dt = Math.min((now - lastStrapTime) / 1000, 0.035);
        lastStrapTime = now;

        if (!isTabHidden && body.getAttribute('data-speed') !== 'paused') {
          for (let i = 0; i < straps.length; i++) {
            const s = straps[i];
            if (!s.springActive || s.dragging) continue;

            // 1. Primary flexible strap pendulum physics
            const accel = -30.0 * s.angle - 3.4 * s.omega;
            s.omega += accel * dt;
            s.angle += s.omega * dt;

            // 2. Secondary hinged handle ring wobble (lags & whips slightly at the bottom of the strap)
            const ringAccel = -42.0 * (s.ringAngle - s.angle) - 12.0 * s.ringAngle - 2.6 * s.ringOmega + accel * 0.35;
            s.ringOmega += ringAccel * dt;
            s.ringAngle += s.ringOmega * dt;

            // Relax elastic stretch back to 0
            s.stretch *= Math.pow(0.08, dt);

            if (
              Math.abs(s.angle) < 0.004 &&
              Math.abs(s.omega) < 0.015 &&
              Math.abs(s.ringAngle) < 0.006 &&
              Math.abs(s.ringOmega) < 0.02
            ) {
              s.angle = 0;
              s.omega = 0;
              s.ringAngle = 0;
              s.ringOmega = 0;
              s.stretch = 0;
              s.springActive = false;
              renderFlexibleStrap(s);
              s.handleRing.removeAttribute('transform');
              s.el.style.transform = '';
              s.el.style.animation = '';
            } else {
              renderFlexibleStrap(s);
            }
          }
        }

        requestAnimationFrame(updateStrapPhysics);
      }
      requestAnimationFrame(updateStrapPhysics);
       


     

      // =========================================================================
      // 6. BLACK CAT MICRO-ANIMATIONS (EAR TWITCH, TAIL FLICK, SLOW BLINK) & WORKS
      // =========================================================================
      const blackCat = document.getElementById('black-cat');
      const aboutCat = document.getElementById('about-cat');
      const worksBackdrop = document.getElementById('worksModalBackdrop');
      const worksCard = document.getElementById('worksModalCard');
      const worksCloseBtn = document.getElementById('worksCloseBtn');
      const workPanel = document.getElementById('work-panel');
      const aboutBackdrop = document.getElementById('aboutModalBackdrop');
      const aboutCard = document.getElementById('aboutModalCard');
      const aboutCloseBtn = document.getElementById('aboutCloseBtn');

      function scheduleEarTwitch() {
        setTimeout(function () {
          if (body.getAttribute('data-speed') !== 'paused' && !isTabHidden) {
            blackCat.classList.remove('ear-twitch-active');
            void blackCat.offsetWidth;
            blackCat.classList.add('ear-twitch-active');
          }
          scheduleEarTwitch();
        }, 4000 + Math.random() * 2000);
      }
      scheduleEarTwitch();

      function scheduleTailFlick() {
        setTimeout(function () {
          if (body.getAttribute('data-speed') !== 'paused' && !isTabHidden) {
            blackCat.classList.remove('tail-flick-active');
            void blackCat.offsetWidth;
            blackCat.classList.add('tail-flick-active');
          }
          scheduleTailFlick();
        }, 8000 + Math.random() * 2000);
      }
      scheduleTailFlick();

      function scheduleSlowBlink() {
        setTimeout(function () {
          if (body.getAttribute('data-speed') !== 'paused' && !isTabHidden) {
            blackCat.classList.remove('blink-active');
            void blackCat.offsetWidth;
            blackCat.classList.add('blink-active');
          }
          scheduleSlowBlink();
        }, 4800 + Math.random() * 3200);
      }
      scheduleSlowBlink();

      let idlePsstTimeout = null;
      let hidePsstTimeout = null;
      let isHoveringCat = false;

      function clearPsstTimers() {
        if (idlePsstTimeout) clearTimeout(idlePsstTimeout);
        if (hidePsstTimeout) clearTimeout(hidePsstTimeout);
        blackCat.classList.remove('psst-visible');
      }

      function armIdlePsstTimer() {
        clearPsstTimers();
        if (isHoveringCat || body.classList.contains('works-open') || body.classList.contains('about-open')) return;
        idlePsstTimeout = setTimeout(function () {
          if (!isHoveringCat && !body.classList.contains('works-open') && !body.classList.contains('about-open') && !isTabHidden) {
            blackCat.classList.add('psst-visible');
            hidePsstTimeout = setTimeout(function () {
              blackCat.classList.remove('psst-visible');
              armIdlePsstTimer();
            }, 2000);
          }
        }, 5000);
      }

      function triggerCatBlink() {
        if (body.getAttribute('data-speed') === 'paused' || isTabHidden) return;
        blackCat.classList.remove('blink-active');
        void blackCat.offsetWidth;
        blackCat.classList.add('blink-active');
      }

      function triggerCatTailFlick() {
        if (body.getAttribute('data-speed') === 'paused' || isTabHidden) return;
        blackCat.classList.remove('tail-flick-active');
        void blackCat.offsetWidth;
        blackCat.classList.add('tail-flick-active');
      }

      aboutCat.addEventListener('mouseenter', function () {
        isHoveringCat = true;
        clearPsstTimers();
        triggerCatBlink();
        triggerCatTailFlick();
      });

      aboutCat.addEventListener('mouseleave', function () {
        isHoveringCat = false;
        armIdlePsstTimer();
      });

      window.addEventListener('mouseover', function (e) {
        if (aboutCat.contains(e.target)) return;
        if (!blackCat.classList.contains('psst-visible')) {
          armIdlePsstTimer();
        }
      }, { passive: true });

      armIdlePsstTimer();

      function openWorksOverlay() {
        clearPsstTimers();
        body.classList.remove('about-open', 'side-projects-open');
        body.classList.add('works-open');
      }

      function closeWorksOverlay() {
        body.classList.remove('works-open');
        armIdlePsstTimer();
      }

      function openAboutOverlay() {
        clearPsstTimers();
        body.classList.remove('works-open', 'side-projects-open');
        body.classList.add('about-open');
      }

      function closeAboutOverlay() {
        body.classList.remove('about-open');
        armIdlePsstTimer();
      }

      aboutCat.addEventListener('click', function (e) {
        e.stopPropagation();
        openAboutOverlay();
      });

      aboutCat.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openAboutOverlay();
        }
      });

      aboutCloseBtn.addEventListener('click', closeAboutOverlay);

      aboutBackdrop.addEventListener('click', function (e) {
        if (!aboutCard.contains(e.target)) {
          closeAboutOverlay();
        }
      });

      window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && body.classList.contains('about-open')) {
          closeAboutOverlay();
        }
      });

      if (workPanel) {
        workPanel.addEventListener('click', function (e) {
          e.stopPropagation();
          openWorksOverlay();
        });

        workPanel.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            openWorksOverlay();
          }
        });
      }

      worksCloseBtn.addEventListener('click', closeWorksOverlay);

      worksBackdrop.addEventListener('click', function (e) {
        if (!worksCard.contains(e.target)) {
          closeWorksOverlay();
        }
      });

      window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && body.classList.contains('works-open')) {
          closeWorksOverlay();
        }
      });
    })();

    // =========================================================================

(function () {
  const sideProjectsPoster = document.getElementById('side-projects-poster');
  const spBackdrop        = document.getElementById('sideProjectsBackdrop');
  const spCard            = document.getElementById('sideProjectsCard');
  const spCloseBtn        = document.getElementById('sideProjectsCloseBtn');

  function openSideProjectsOverlay() {
    if (!spBackdrop) return;
    document.body.classList.remove('works-open', 'about-open');
    document.body.classList.add('side-projects-open');
    spBackdrop.classList.add('is-open');
  }

  function closeSideProjectsOverlay() {
    if (!spBackdrop) return;
    document.body.classList.remove('side-projects-open');
    spBackdrop.classList.remove('is-open');
  }

  if (spCloseBtn) {
    spCloseBtn.addEventListener('click', closeSideProjectsOverlay);
  }

  if (spBackdrop) {
    spBackdrop.addEventListener('click', function (e) {
      if (spCard && !spCard.contains(e.target)) {
        closeSideProjectsOverlay();
      }
    });
  }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && spBackdrop && spBackdrop.classList.contains('is-open')) {
      closeSideProjectsOverlay();
    }
  });

  if (sideProjectsPoster) {
    function triggerSideProjects(e) {
      e.stopPropagation();
      openSideProjectsOverlay();
    }

    sideProjectsPoster.addEventListener('click', triggerSideProjects);

    sideProjectsPoster.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerSideProjects(e);
      }
    });
  }
})();
