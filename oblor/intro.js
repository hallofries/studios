(() => {
  "use strict";

  const BASE_WIDTH = 1920;
  const BASE_HEIGHT = 1080;
  const CORRECT_PASSCODE = "oblor11";
  const INTRO_COMPLETED_KEY = "oblor:intro-completed";
  const INTRO_COMPLETED_AT_KEY = "oblor:intro-completed-at";

  const PC = {
    x: 162,
    y: 197,
    width: 1578,
    height: 1052,
  };

  // The logical insertion zone is the LEFT HALF of the full PC image.
  const DROP_ZONE = {
    x: PC.x,
    y: PC.y,
    width: PC.width / 2,
    height: PC.height,
  };

  // Visual target near the open tray. Easy to tweak if your exported PC asset shifts.
  const TRAY_TARGET = {
    x: 310,
    y: 425,
  };

  const CD_SIZE = {
    width: 228,
    height: 231,
  };

  const stage = document.getElementById("introStage");
  const pcImage = document.getElementById("pcImage");
  const noteImage = document.getElementById("noteImage");
  const monitorUi = document.getElementById("passcodeForm");
  const passcodeContent = document.getElementById("passcodeContent");
  const passcodeInput = document.getElementById("passcodeInput");
  const passcodeMask = document.getElementById("passcodeMask");
  const loadingSpinner = document.getElementById("loadingSpinner");
  const oblorDiskButton = document.getElementById("oblorDiskButton");
  const floatingCd = document.getElementById("floatingCd");
  const fadeOverlay = document.getElementById("fadeOverlay");
  const skipIntroButton = document.getElementById("skipIntroButton");

  let stageScale = 1;
  let unlocked = false;
  let cdSpawned = false;
  let cdInserted = false;

  let cdMode = "hidden"; // hidden | floating | dragging | inserting | inserted
  let cdX = 0;
  let cdY = 0;
  let cdVx = -34;
  let cdVy = -23;
  let cdRotation = -4;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragPointerId = null;
  let lastAnimationTime = performance.now();
  let floatTime = 0;


  // ------------------------------------------------------------
  // RETURNING VISITOR MEMORY
  // localStorage survives closing/reopening the browser and later
  // visits on the same browser + domain, unless site data is cleared.
  // We only mark completion after the CD has actually been inserted.
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

    setTimeout(() => {
      window.location.href = "index.html";
    }, 520);
  }

  if (hasCompletedIntroBefore()) {
    skipIntroButton.hidden = false;
  }

  skipIntroButton.addEventListener("click", goToDesktop);

  // ------------------------------------------------------------
  // FULL VIEWPORT COVER SCALE
  // ------------------------------------------------------------
  function resizeStage() {
    const scaleX = window.innerWidth / BASE_WIDTH;
    const scaleY = window.innerHeight / BASE_HEIGHT;

    // Cover the viewport. Keep the composition mostly bottom-anchored,
    // but shift the crop 15% upward: 85% of any vertical overflow is
    // cropped from the top and 15% from the bottom. This keeps the desk
    // visible while revealing a little more of the upper room.
    stageScale = Math.max(scaleX, scaleY);
    const renderedWidth = BASE_WIDTH * stageScale;
    const renderedHeight = BASE_HEIGHT * stageScale;
    const stageLeft = (window.innerWidth - renderedWidth) / 2;
    const verticalOverflow = Math.max(0, renderedHeight - window.innerHeight);
    const stageBottom = -(verticalOverflow * 0.15);

    stage.style.setProperty("--stage-scale", stageScale);
    stage.style.setProperty("--stage-left", `${stageLeft}px`);
    stage.style.setProperty("--stage-bottom", `${stageBottom}px`);
  }

  resizeStage();
  window.addEventListener("resize", resizeStage);

  // ------------------------------------------------------------
  // PRELOAD INSTANT-SWAP ASSETS
  // ------------------------------------------------------------
  [
    "assets/intro/pc-cd-open.png",
    "assets/intro/note-state2.png",
    "assets/intro/floating-cd.png",
  ].forEach((src) => {
    const image = new Image();
    image.src = src;
  });

  // ------------------------------------------------------------
  // NOTE: state 1 -> state 2 ONCE, immediate swap, never toggles back.
  // ------------------------------------------------------------
  let noteRevealed = false;

  function revealNote() {
    if (noteRevealed) return;
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
  // PASSCODE
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
    if (unlocked || cdInserted) return;

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

    // Immediate PC replacement — intentionally no transition.
    // The note is independent and only changes when the user clicks it.
    pcImage.src = "assets/intro/pc-cd-open.png";
  }

  // ------------------------------------------------------------
  // CASE -> FLOATING CD
  // ------------------------------------------------------------
  oblorDiskButton.addEventListener("click", () => {
    if (cdSpawned || cdInserted) return;

    cdSpawned = true;
    oblorDiskButton.classList.add("is-used");

    // Start close to the OBLOR case, then let it drift around the room.
    cdX = 1544 + 131.5 - CD_SIZE.width / 2;
    cdY = 738 + 144 - CD_SIZE.height / 2;
    cdVx = -42;
    cdVy = -28;
    cdRotation = -5;
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
      cdX += cdVx * dt;
      cdY += cdVy * dt;

      const marginX = 65;
      const marginY = 65;
      const maxX = BASE_WIDTH - CD_SIZE.width - marginX;
      const maxY = BASE_HEIGHT - CD_SIZE.height - marginY;

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

    requestAnimationFrame(animateCd);
  }

  requestAnimationFrame(animateCd);

  // ------------------------------------------------------------
  // DRAGGING IN 1920x1080 DESIGN COORDINATES
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

    floatingCd.classList.add("is-dragging");
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
    return (
      x >= DROP_ZONE.x &&
      x <= DROP_ZONE.x + DROP_ZONE.width &&
      y >= DROP_ZONE.y &&
      y <= DROP_ZONE.y + DROP_ZONE.height
    );
  }

  function finishDrag(event) {
    if (cdMode !== "dragging" || event.pointerId !== dragPointerId) return;

    const cdCenterX = cdX + CD_SIZE.width / 2;
    const cdCenterY = cdY + CD_SIZE.height / 2;
    const insidePcLeftSide = pointIsInDropZone(cdCenterX, cdCenterY);

    floatingCd.classList.remove("is-dragging");

    try {
      floatingCd.releasePointerCapture(event.pointerId);
    } catch (_error) {}

    dragPointerId = null;

    if (insidePcLeftSide && unlocked) {
      insertCd();
      return;
    }

    // Wrong place OR CD-ROM still locked: just resume floating.
    // No extra UI copy is added; the open/closed tray already communicates state.
    cdMode = "floating";
    cdVx = cdVx === 0 ? -35 : cdVx;
    cdVy = cdVy === 0 ? -22 : cdVy;
    lastAnimationTime = performance.now();
  }

  floatingCd.addEventListener("pointerup", finishDrag);
  floatingCd.addEventListener("pointercancel", finishDrag);

  // ------------------------------------------------------------
  // INSERT CD -> SPINNER -> CURRENT index.html
  // ------------------------------------------------------------
  function insertCd() {
    if (cdInserted) return;

    cdInserted = true;
    cdMode = "inserting";
    floatingCd.style.pointerEvents = "none";

    const fromX = cdX;
    const fromY = cdY;
    const toX = TRAY_TARGET.x;
    const toY = TRAY_TARGET.y;

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
          transform: "rotate(-4deg) scale(0.58)",
          opacity: 0.2,
        },
      ],
      {
        duration: 380,
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
    // Reaching this point means the visitor actually completed the interaction:
    // correct passcode + successful CD insertion. Remember that for later visits.
    rememberIntroCompletion();

    // The passcode UI disappears the moment the CD has finished going in.
    passcodeContent.hidden = true;
    loadingSpinner.hidden = false;

    // Let the green XP-style spinner run briefly, then fade the whole room
    // to black and navigate to the separate desktop page.
    setTimeout(() => {
      goToDesktop();
    }, 1900);
  }
})();
