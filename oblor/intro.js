(() => {
  "use strict";

  const DESKTOP = {
    width: 1920,
    height: 1080,
    pc: { x: 162, y: 197, width: 1578, height: 1052 },
    dropZone: { x: 162, y: 197, width: 789, height: 1052 },
    trayTarget: { x: 310, y: 425 },
    cdSize: { width: 228, height: 231 },
    spawn: { x: 1544 + 131.5 - 114, y: 738 + 144 - 115.5 },
  };

  const MOBILE_PORTRAIT = {
    width: 390,
    height: 844,
    // Open tray target in the 390 x 844 portrait Figma frame.
    dropZone: { x: 0, y: 315, width: 135, height: 105 },
    trayTarget: { x: -7, y: 315 },
    cdSize: { width: 126, height: 127 },
    spawn: { x: 231, y: 461 },
  };

  const MOBILE_LANDSCAPE = {
    width: 844,
    height: 390,
    // Same physical tray, remapped to the 844 x 390 landscape composition.
    dropZone: { x: 170, y: 170, width: 138, height: 108 },
    trayTarget: { x: 145, y: 172 },
    cdSize: { width: 111, height: 113 },
    // Figma gives the disc size; this position matches the supplied landscape frame.
    spawn: { x: 620, y: 126 },
  };

  const CORRECT_PASSCODE = "oblor11";
  const INTRO_COMPLETED_KEY = "oblor:intro-completed";
  const INTRO_COMPLETED_AT_KEY = "oblor:intro-completed-at";

  const mobileLandscapeQuery = window.matchMedia(
    "(orientation: landscape) and (max-width: 950px) and (max-height: 520px)",
  );

  const cssMobileMode =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--oblor-mobile")
      .trim() === "1";

  const isMobile =
    mobileLandscapeQuery.matches ||
    cssMobileMode ||
    document.documentElement.classList.contains("mobile-layout") ||
    window.matchMedia("(max-width: 768px)").matches ||
    window.matchMedia("(pointer: coarse)").matches ||
    navigator.maxTouchPoints > 0 ||
    document.documentElement.clientWidth <= 768 ||
    window.innerWidth <= 768;

  if (isMobile) document.documentElement.classList.add("mobile-layout");

  let layout = isMobile
    ? mobileLandscapeQuery.matches
      ? MOBILE_LANDSCAPE
      : MOBILE_PORTRAIT
    : DESKTOP;

  const stage = document.getElementById("introStage");
  const pcImage = document.getElementById("pcImage");
  const noteImage = document.getElementById("noteImage");
  const monitorUi = document.getElementById("passcodeForm");
  const passcodeContent = document.getElementById("passcodeContent");
  const mobileMonitorPrompt = document.getElementById("mobileMonitorPrompt");
  const passcodeInput = document.getElementById("passcodeInput");
  const passcodeMask = document.getElementById("passcodeMask");
  const loadingSpinner = document.getElementById("loadingSpinner");
  const oblorDiskButton = document.getElementById("oblorDiskButton");
  const floatingCd = document.getElementById("floatingCd");
  const fadeOverlay = document.getElementById("fadeOverlay");
  const skipIntroButton = document.getElementById("skipIntroButton");

  let stageScale = 1;
  let unlocked = isMobile;
  let cdSpawned = false;
  let cdInserted = false;

  let cdMode = "hidden"; // hidden | floating | dragging | inserting | inserted
  let cdX = 0;
  let cdY = 0;
  let cdVx = isMobile ? 0 : -34;
  let cdVy = isMobile ? 0 : -23;
  let cdRotation = -4;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragPointerId = null;
  let lastAnimationTime = performance.now();
  let floatTime = 0;

  // ------------------------------------------------------------
  // RETURNING VISITOR MEMORY
  // ------------------------------------------------------------
  function hasCompletedIntroBefore() {
    try {
      return localStorage.getItem(INTRO_COMPLETED_KEY) === "1";
    } catch (_error) {
      return false;
    }
  }

  function rememberIntroCompletion() {
    try {
      localStorage.setItem(INTRO_COMPLETED_KEY, "1");
      localStorage.setItem(INTRO_COMPLETED_AT_KEY, new Date().toISOString());
    } catch (_error) {
      // The intro still works if storage is blocked.
    }
  }

  function goToDesktop() {
    skipIntroButton.hidden = true;
    fadeOverlay.classList.add("is-active");

    // Tell index.html this is a fresh entrance from the room so it can replay
    // the welcome sequence and reveal OBLOR.exe a few seconds later.
    try {
      sessionStorage.setItem("oblorDesktopEntrance", "1");
    } catch (_error) {}

    setTimeout(() => {
      window.location.href = "index.html";
    }, 520);
  }

  if (hasCompletedIntroBefore()) {
    skipIntroButton.hidden = false;
  }

  skipIntroButton.addEventListener("click", goToDesktop);

  // ------------------------------------------------------------
  // MOBILE START STATE
  // No passcode on phones: the open tray is visible immediately.
  // ------------------------------------------------------------
  if (isMobile) {
    pcImage.src = "assets/intro/pc-cd-open.png";
    noteImage.hidden = true;
    passcodeContent.hidden = true;
    mobileMonitorPrompt.hidden = false;
    monitorUi.classList.add("is-unlocked");
  } else {
    mobileMonitorPrompt.hidden = true;
  }

  // ------------------------------------------------------------
  // RESPONSIVE STAGE SCALE
  // ------------------------------------------------------------
  function resizeStage() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (isMobile) {
      const landscape = mobileLandscapeQuery.matches;
      const nextLayout = landscape ? MOBILE_LANDSCAPE : MOBILE_PORTRAIT;
      const orientationChanged = layout !== nextLayout;
      layout = nextLayout;

      document.documentElement.classList.toggle("mobile-landscape", landscape);
      document.documentElement.classList.toggle("mobile-portrait", !landscape);

      const scaleX = viewportWidth / layout.width;
      const scaleY = viewportHeight / layout.height;

      // Both Figma compositions fill the phone viewport. Small aspect-ratio
      // differences are cropped at the outer edge rather than letterboxed.
      stageScale = Math.max(scaleX, scaleY);

      const renderedWidth = layout.width * stageScale;
      const renderedHeight = layout.height * stageScale;
      const stageLeft = (viewportWidth - renderedWidth) / 2;
      const stageTop = (viewportHeight - renderedHeight) / 2;

      stage.style.setProperty("--stage-scale", stageScale);
      stage.style.setProperty("--stage-left", `${stageLeft}px`);
      stage.style.setProperty("--stage-top", `${stageTop}px`);

      // If the phone rotates after the disc was spawned, move the floating disc
      // to the corresponding Figma position in the new coordinate system.
      if (orientationChanged && cdSpawned && cdMode === "floating") {
        cdX = layout.spawn.x;
        cdY = layout.spawn.y;
        renderCd();
      }
      return;
    }

    const scaleX = viewportWidth / DESKTOP.width;
    const scaleY = viewportHeight / DESKTOP.height;

    // Desktop keeps the established cover crop with the slight upward shift.
    stageScale = Math.max(scaleX, scaleY);
    const renderedWidth = DESKTOP.width * stageScale;
    const renderedHeight = DESKTOP.height * stageScale;
    const stageLeft = (viewportWidth - renderedWidth) / 2;
    const verticalOverflow = Math.max(0, renderedHeight - viewportHeight);
    const stageBottom = -(verticalOverflow * 0.15);

    stage.style.setProperty("--stage-scale", stageScale);
    stage.style.setProperty("--stage-left", `${stageLeft}px`);
    stage.style.setProperty("--stage-bottom", `${stageBottom}px`);
  }

  resizeStage();
  window.addEventListener("resize", resizeStage);
  window.visualViewport?.addEventListener("resize", resizeStage);

  // ------------------------------------------------------------
  // PRELOAD INSTANT-SWAP ASSETS
  // ------------------------------------------------------------
  [
    "assets/intro/pc-cd-open.png",
    "assets/intro/note-state2.png",
    "assets/intro/floating-cd.png",
    "assets/intro/mobile-bg.png",
  ].forEach((src) => {
    const image = new Image();
    image.src = src;
  });

  // ------------------------------------------------------------
  // DESKTOP NOTE: state 1 -> state 2 ONCE
  // ------------------------------------------------------------
  let noteRevealed = false;

  function revealNote() {
    if (isMobile || noteRevealed) return;
    noteRevealed = true;
    noteImage.src = "assets/intro/note-state2.png";
    noteImage.classList.add("is-revealed");
    noteImage.removeAttribute("tabindex");
    noteImage.setAttribute("aria-label", "Passcode revealed");
  }

  noteImage.addEventListener("click", revealNote);
  noteImage.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      revealNote();
    }
  });

  // ------------------------------------------------------------
  // DESKTOP PASSCODE
  // ------------------------------------------------------------
  function updatePasscodeMask() {
    passcodeMask.textContent = "*".repeat(passcodeInput.value.length);
  }

  function clearPasscodeError() {
    if (!monitorUi.classList.contains("is-error")) return;
    monitorUi.classList.remove("is-error");
  }

  passcodeInput.addEventListener("input", () => {
    updatePasscodeMask();
    clearPasscodeError();
  });

  monitorUi.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isMobile || unlocked || cdInserted) return;

    const value = passcodeInput.value.trim().toLowerCase();

    if (value !== CORRECT_PASSCODE) {
      monitorUi.classList.add("is-error");
      updatePasscodeMask();
      passcodeInput.focus();
      passcodeInput.select();
      return;
    }

    unlockCdRom();
  });

  function unlockCdRom() {
    unlocked = true;
    monitorUi.classList.remove("is-error");
    monitorUi.classList.add("is-unlocked");
    passcodeInput.disabled = true;
    pcImage.src = "assets/intro/pc-cd-open.png";
  }

  // ------------------------------------------------------------
  // CASE -> FLOATING CD
  // ------------------------------------------------------------
  oblorDiskButton.addEventListener("click", () => {
    if (cdSpawned || cdInserted) return;

    cdSpawned = true;
    oblorDiskButton.classList.add("is-used");

    cdX = layout.spawn.x;
    cdY = layout.spawn.y;
    cdVx = isMobile ? 0 : -42;
    cdVy = isMobile ? 0 : -28;
    cdRotation = isMobile ? -4 : -5;
    floatTime = 0;
    lastAnimationTime = performance.now();

    floatingCd.hidden = false;
    cdMode = "floating";
    renderCd();
  });

  // ------------------------------------------------------------
  // FLOATING MOVEMENT
  // ------------------------------------------------------------
  function renderCd(extraY = 0, extraRotation = 0) {
    floatingCd.style.left = `${cdX}px`;
    floatingCd.style.top = `${cdY + extraY}px`;
    floatingCd.style.transform = `rotate(${cdRotation + extraRotation}deg)`;
  }

  function animateCd(now) {
    const dt = Math.min(0.04, (now - lastAnimationTime) / 1000);
    lastAnimationTime = now;

    if (cdMode === "floating") {
      floatTime += dt;

      if (isMobile) {
        // Keep the disc where the Figma composition puts it; only a tiny bob says
        // "this is draggable" without making touch interaction frustrating.
        const bob = Math.sin(floatTime * 2.2) * 2.2;
        const rotate = Math.sin(floatTime * 1.35) * 1.5;
        renderCd(bob, rotate);
      } else {
        cdX += cdVx * dt;
        cdY += cdVy * dt;

        const marginX = 65;
        const marginY = 65;
        const maxX = DESKTOP.width - DESKTOP.cdSize.width - marginX;
        const maxY = DESKTOP.height - DESKTOP.cdSize.height - marginY;

        if (cdX <= marginX) {
          cdX = marginX;
          cdVx = Math.abs(cdVx);
        } else if (cdX >= maxX) {
          cdX = maxX;
          cdVx = -Math.abs(cdVx);
        }

        if (cdY <= marginY) {
          cdY = marginY;
          cdVy = Math.abs(cdVy);
        } else if (cdY >= maxY) {
          cdY = maxY;
          cdVy = -Math.abs(cdVy);
        }

        const bob = Math.sin(floatTime * 2.2) * 7;
        const rotate = Math.sin(floatTime * 1.45) * 4;
        renderCd(bob, rotate);
      }
    }

    requestAnimationFrame(animateCd);
  }

  requestAnimationFrame(animateCd);

  // ------------------------------------------------------------
  // DRAGGING IN CURRENT DESIGN COORDINATES
  // ------------------------------------------------------------
  function clientToStage(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / stageScale,
      y: (clientY - rect.top) / stageScale,
    };
  }

  floatingCd.addEventListener("pointerdown", (event) => {
    if (cdMode !== "floating") return;

    event.preventDefault();

    const point = clientToStage(event.clientX, event.clientY);

    cdMode = "dragging";
    dragPointerId = event.pointerId;
    dragOffsetX = point.x - cdX;
    dragOffsetY = point.y - cdY;

    floatingCd.classList.add("is-dragging", "grabbing");
    floatingCd.setPointerCapture(event.pointerId);
    renderCd();
  });

  floatingCd.addEventListener("pointermove", (event) => {
    if (cdMode !== "dragging" || event.pointerId !== dragPointerId) return;

    const point = clientToStage(event.clientX, event.clientY);
    cdX = point.x - dragOffsetX;
    cdY = point.y - dragOffsetY;
    cdRotation = 0;
    renderCd();
  });

  function pointIsInDropZone(x, y) {
    const zone = layout.dropZone;
    return (
      x >= zone.x &&
      x <= zone.x + zone.width &&
      y >= zone.y &&
      y <= zone.y + zone.height
    );
  }

  function finishDrag(event) {
    if (cdMode !== "dragging" || event.pointerId !== dragPointerId) return;

    const cdCenterX = cdX + layout.cdSize.width / 2;
    const cdCenterY = cdY + layout.cdSize.height / 2;
    const insideTrayArea = pointIsInDropZone(cdCenterX, cdCenterY);

    floatingCd.classList.remove("is-dragging", "grabbing");

    try {
      floatingCd.releasePointerCapture(event.pointerId);
    } catch (_error) {}

    dragPointerId = null;

    if (insideTrayArea && unlocked) {
      insertCd();
      return;
    }

    cdMode = "floating";
    if (!isMobile) {
      cdVx = cdVx === 0 ? -35 : cdVx;
      cdVy = cdVy === 0 ? -22 : cdVy;
    }
    lastAnimationTime = performance.now();
  }

  floatingCd.addEventListener("pointerup", finishDrag);
  floatingCd.addEventListener("pointercancel", finishDrag);

  // ------------------------------------------------------------
  // INSERT CD -> SPINNER -> DESKTOP
  // ------------------------------------------------------------
  function insertCd() {
    if (cdInserted) return;

    cdInserted = true;
    cdMode = "inserting";
    floatingCd.style.pointerEvents = "none";

    const fromX = cdX;
    const fromY = cdY;
    const toX = layout.trayTarget.x;
    const toY = layout.trayTarget.y;

    const animation = floatingCd.animate(
      [
        {
          left: `${fromX}px`,
          top: `${fromY}px`,
          transform: "rotate(0deg) scale(1)",
          opacity: 1,
        },
        {
          left: `${toX}px`,
          top: `${toY}px`,
          transform: `rotate(-4deg) scale(${isMobile ? 0.46 : 0.58})`,
          opacity: 0.18,
        },
      ],
      {
        duration: isMobile ? 420 : 380,
        easing: "cubic-bezier(.2,.8,.2,1)",
        fill: "forwards",
      },
    );

    animation.finished
      .catch(() => {})
      .finally(() => {
        cdMode = "inserted";
        floatingCd.hidden = true;
        showLoadingState();
      });
  }

  function showLoadingState() {
    rememberIntroCompletion();

    passcodeContent.hidden = true;
    mobileMonitorPrompt.hidden = true;
    loadingSpinner.hidden = false;

    setTimeout(() => {
      goToDesktop();
    }, 1900);
  }
})();
