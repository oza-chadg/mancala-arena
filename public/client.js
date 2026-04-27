const socket = io();
const params = new URLSearchParams(window.location.search);
const initialGameId = params.get("gameId");

let gameState = null;
let localPlayer = null;
let playerToken = null;
let animationTimers = [];
let copyFeedbackTimer = null;
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const SOW_STEP_DELAY_MS = 180;
const SOW_ANIMATION_MS = 680;
const LAST_STONE_ANIMATION_MS = 900;
const CAPTURE_DELAY_AFTER_LAST_MS = 260;
const CAPTURE_ANIMATION_MS = 1200;
const STORE_ANIMATION_MS = 1250;
const EXTRA_TURN_DELAY_AFTER_LAST_MS = 220;
const botDifficultyDescriptions = {
  easy: "Random legal moves",
  normal: "Tactical moves",
  hard: "Looks ahead"
};

const elements = {
  board: document.querySelector("#board"),
  boardWrap: document.querySelector("#boardWrap"),
  botDifficultyDescription: document.querySelector("#botDifficultyDescription"),
  botDifficultySelect: document.querySelector("#botDifficultySelect"),
  connectionLabel: document.querySelector("#connectionLabel"),
  createBotGameButton: document.querySelector("#createBotGameButton"),
  createGameButton: document.querySelector("#createGameButton"),
  copyInviteButton: document.querySelector("#copyInviteButton"),
  copyStatus: document.querySelector("#copyStatus"),
  historyCount: document.querySelector("#historyCount"),
  historyPanel: document.querySelector("#historyPanel"),
  historyToggle: document.querySelector("#historyToggle"),
  invitePanel: document.querySelector("#invitePanel"),
  inviteLink: document.querySelector("#inviteLink"),
  localPlayer: document.querySelector("#localPlayer"),
  message: document.querySelector("#message"),
  moveHistoryList: document.querySelector("#moveHistoryList"),
  rematchButton: document.querySelector("#rematchButton"),
  resultPanel: document.querySelector("#resultPanel"),
  resultScore: document.querySelector("#resultScore"),
  resultStats: document.querySelector("#resultStats"),
  resultTitle: document.querySelector("#resultTitle"),
  statusLabel: document.querySelector("#statusLabel"),
  turnBanner: document.querySelector("#turnBanner"),
  turnBannerDetail: document.querySelector("#turnBannerDetail"),
  turnBannerTitle: document.querySelector("#turnBannerTitle"),
  turnLabel: document.querySelector("#turnLabel")
};

function tokenStorageKey(gameId) {
  return `mancala:${gameId}:playerToken`;
}

function getStoredToken(gameId) {
  return window.localStorage.getItem(tokenStorageKey(gameId));
}

function clearStoredToken(gameId) {
  window.localStorage.removeItem(tokenStorageKey(gameId));
}

function saveToken(gameId, token) {
  window.localStorage.setItem(tokenStorageKey(gameId), token);
}

function setMessage(text) {
  elements.message.textContent = text;
}

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: reducedMotionQuery.matches ? "auto" : "smooth"
  });
}

function showCopyFeedback() {
  if (copyFeedbackTimer) {
    window.clearTimeout(copyFeedbackTimer);
  }

  elements.copyInviteButton.textContent = "Copied";
  elements.copyInviteButton.classList.add("is-copied");
  elements.copyStatus.textContent = "Link copied";
  copyFeedbackTimer = window.setTimeout(() => {
    elements.copyInviteButton.textContent = "Copy";
    elements.copyInviteButton.classList.remove("is-copied");
    elements.copyStatus.textContent = "";
    copyFeedbackTimer = null;
  }, 1800);
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function hasHoverInput() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "";
}

function clearAnimationTimers() {
  animationTimers.forEach((timerId) => window.clearTimeout(timerId));
  animationTimers = [];
}

function clearPreview() {
  elements.board
    .querySelectorAll(".is-preview-origin, .is-preview-path, .is-preview-last, .is-preview-capture, .is-preview-store")
    .forEach((slot) => {
      slot.classList.remove(
        "is-preview-origin",
        "is-preview-path",
        "is-preview-last",
        "is-preview-capture",
        "is-preview-store"
      );
    });

  renderTurnBanner();
}

function normalizeGameUrl(gameId) {
  const url = new URL(window.location.href);
  url.searchParams.set("gameId", gameId);
  window.history.replaceState({}, "", url);
}

function clearGameUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("gameId");
  window.history.replaceState({}, "", url);
}

function updateBotDifficultyDescription() {
  const difficulty = elements.botDifficultySelect.value;
  elements.botDifficultyDescription.textContent = botDifficultyDescriptions[difficulty] ?? botDifficultyDescriptions.normal;
}

function updateInviteVisibility() {
  const shouldShowInvite = gameState?.mode !== "bot" && gameState?.status === "waiting" && localPlayer === "one";
  elements.invitePanel.classList.toggle("hidden", !shouldShowInvite);
}

function receiveSeat({ state, token, player }) {
  gameState = state;
  playerToken = token;
  localPlayer = player;
  saveToken(gameState.id, playerToken);
  normalizeGameUrl(gameState.id);
  render();
}

function canClickPit(pitIndex) {
  if (!gameState || gameState.status !== "in_progress") {
    return false;
  }

  if (gameState.currentPlayer !== localPlayer) {
    return false;
  }

  if (localPlayer === "one") {
    return pitIndex >= 0 && pitIndex <= 5 && gameState.board.pits[pitIndex] > 0;
  }

  return pitIndex >= 7 && pitIndex <= 12 && gameState.board.pits[pitIndex] > 0;
}

function playerLabel(player) {
  if (!player) {
    return "Waiting";
  }

  if (gameState?.players[player]?.isBot) {
    return "Bot";
  }

  return player === localPlayer ? `${player} (you)` : player;
}

function playerDisplayName(player) {
  if (!player) {
    return "Player";
  }

  if (gameState?.players[player]?.isBot) {
    return "Bot";
  }

  return player === localPlayer ? "You" : `Player ${player}`;
}

function connectionTextFor(player) {
  const seat = gameState?.players[player];
  if (!seat) {
    return `${player}: waiting`;
  }

  if (seat.isBot) {
    return "bot: ready";
  }

  return `${player}: ${seat.connected ? "online" : "offline"}`;
}

function connectionText() {
  if (!gameState) {
    return "No players seated";
  }

  return `${connectionTextFor("one")} | ${connectionTextFor("two")}`;
}

function statusText() {
  if (!gameState) {
    return "Idle";
  }

  if (gameState.status === "waiting") {
    return "Waiting for opponent";
  }

  if (gameState.mode === "bot") {
    return `${capitalize(gameState.botDifficulty ?? "normal")} bot`;
  }

  if (gameState.status === "completed") {
    return "Completed";
  }

  return "In progress";
}

function turnText() {
  if (!gameState) {
    return "Create or join a game";
  }

  if (gameState.status === "waiting") {
    return "Waiting";
  }

  if (gameState.status === "completed") {
    return "Game over";
  }

  return playerLabel(gameState.currentPlayer);
}

function moveSummary() {
  if (!gameState?.lastMove) {
    return "";
  }

  const extras = [];
  if (gameState.lastMove.wasCapture) {
    extras.push("capture");
  }
  if (gameState.lastMove.wasExtraTurn) {
    extras.push("extra turn");
  }

  return `Last move: ${playerDisplayName(gameState.lastMove.player)} chose pit ${getPitNumber(gameState.lastMove.pitIndex)}${extras.length ? ` (${extras.join(", ")})` : ""}.`;
}

function outcomeText() {
  if (!gameState || gameState.status !== "completed") {
    return null;
  }

  if (gameState.winner === "draw") {
    return "The game ended in a draw.";
  }

  return gameState.winner === localPlayer ? "You won." : `Player ${gameState.winner} won.`;
}

function turnBannerContent() {
  if (!gameState) {
    return {
      tone: "idle",
      title: "Ready to play",
      detail: "Create a game, then send the invite link to another player."
    };
  }

  if (gameState.status === "waiting") {
    return {
      tone: "waiting",
      title: "Waiting for opponent",
      detail: "Share the invite link to fill the second seat."
    };
  }

  if (gameState.status === "completed") {
    return {
      tone: "complete",
      title: "Game over",
      detail: resultSummary()
    };
  }

  const isYourTurn = gameState.currentPlayer === localPlayer;
  return {
    tone: isYourTurn ? "your-turn" : "opponent-turn",
    title: isYourTurn ? "Your turn" : "Opponent's turn",
    detail: isYourTurn ? "Choose a non-empty pit." : `${playerDisplayName(gameState.currentPlayer)} chooses a non-empty pit.`
  };
}

function resultSummary() {
  if (!gameState) {
    return "";
  }

  const oneScore = gameState.board.pits[6];
  const twoScore = gameState.board.pits[13];
  if (gameState.winner === "draw") {
    return `Draw, ${oneScore} to ${twoScore}.`;
  }

  return `${playerDisplayName(gameState.winner)} won, ${oneScore} to ${twoScore}.`;
}

function renderTurnBanner() {
  const content = turnBannerContent();
  elements.turnBanner.className = `turn-banner ${content.tone}`;
  elements.turnBannerTitle.textContent = content.title;
  elements.turnBannerDetail.textContent = content.detail;
}

function renderResultPanel() {
  const isCompleted = gameState?.status === "completed";
  elements.resultPanel.classList.toggle("hidden", !isCompleted);

  if (!isCompleted) {
    elements.resultStats.replaceChildren();
    return;
  }

  elements.resultTitle.textContent =
    gameState.winner === "draw"
      ? "Draw"
      : gameState.winner === localPlayer
        ? "You won"
        : `${playerDisplayName(gameState.winner)} won`;
  elements.resultScore.textContent = `Final score: Player one ${gameState.board.pits[6]}, Player two ${gameState.board.pits[13]}.`;
  renderResultStats();
}

function createStatCard(label, value) {
  const item = document.createElement("div");
  item.className = "result-stat";
  const statLabel = document.createElement("span");
  statLabel.textContent = label;
  const statValue = document.createElement("strong");
  statValue.textContent = value;
  item.append(statLabel, statValue);
  return item;
}

function renderResultStats() {
  elements.resultStats.replaceChildren();
  const review = gameState?.gameReview;
  if (!review) {
    return;
  }

  const biggestGain = review.biggestStoreGain;
  const biggestGainText = biggestGain
    ? `${playerDisplayName(biggestGain.player)} +${biggestGain.gain} from pit ${getPitNumber(biggestGain.pitIndex)}`
    : "No store gains";

  elements.resultStats.append(
    createStatCard("Captures", `${review.captures.one}-${review.captures.two}`),
    createStatCard("Extra turns", `${review.extraTurns.one}-${review.extraTurns.two}`),
    createStatCard("Biggest gain", biggestGainText)
  );
}

function moveHistoryLabel(entry) {
  const pitNumber = getPitNumber(entry.pitIndex);
  const tags = [];
  if (entry.wasCapture) {
    tags.push("capture");
  }
  if (entry.wasExtraTurn) {
    tags.push("extra turn");
  }

  const tagText = tags.length ? ` (${tags.join(", ")})` : "";
  return `${playerDisplayName(entry.player)} chose pit ${pitNumber}${tagText}. Stores: ${entry.stores.one}-${entry.stores.two}.`;
}

function renderMoveHistory() {
  const history = gameState?.moveHistory ?? [];
  elements.historyCount.textContent = String(history.length);
  elements.moveHistoryList.replaceChildren();

  if (history.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "No moves yet";
    elements.moveHistoryList.append(emptyItem);
    return;
  }

  history
    .slice()
    .reverse()
    .slice(0, 10)
    .forEach((entry) => {
      const item = document.createElement("li");
      if (entry.wasCapture) {
        item.classList.add("history-capture");
      }
      if (entry.wasExtraTurn) {
        item.classList.add("history-extra-turn");
      }
      item.textContent = moveHistoryLabel(entry);
      elements.moveHistoryList.append(item);
    });
}

function updateHistoryDisclosure() {
  const isCollapsed = elements.historyPanel.classList.contains("is-collapsed");
  elements.historyToggle.setAttribute("aria-expanded", String(!isCollapsed));
}

function updateRematchButton() {
  const canRematch = gameState?.status === "completed" && localPlayer;
  elements.rematchButton.classList.toggle("hidden", !canRematch);

  if (!canRematch) {
    elements.rematchButton.disabled = false;
    elements.rematchButton.textContent = "Rematch";
    return;
  }

  const requests = gameState.rematchRequests ?? { one: false, two: false };
  const localRequested = requests[localPlayer];
  const opponent = localPlayer === "one" ? "two" : "one";
  const opponentRequested = requests[opponent];

  elements.rematchButton.disabled = Boolean(localRequested);
  if (localRequested && opponentRequested) {
    elements.rematchButton.textContent = "Starting rematch";
  } else if (localRequested) {
    elements.rematchButton.textContent = "Waiting for opponent";
  } else if (opponentRequested) {
    elements.rematchButton.textContent = "Accept rematch";
  } else {
    elements.rematchButton.textContent = "Request rematch";
  }
}

function rematchStatusText() {
  if (gameState?.status !== "completed" || !localPlayer) {
    return "";
  }

  const requests = gameState.rematchRequests ?? { one: false, two: false };
  const opponent = localPlayer === "one" ? "two" : "one";
  if (requests[localPlayer] && requests[opponent]) {
    return "Starting rematch...";
  }
  if (requests[localPlayer]) {
    return "Rematch requested. Waiting for opponent.";
  }
  if (requests[opponent]) {
    return "Opponent requested a rematch.";
  }
  return "";
}

function getStoreIndex(player) {
  return player === "one" ? 6 : 13;
}

function getOpponentStoreIndex(player) {
  return player === "one" ? 13 : 6;
}

function getOppositePitIndex(pitIndex) {
  return 12 - pitIndex;
}

function simulateMovePreview(player, pitIndex) {
  const pits = [...gameState.board.pits];
  const path = [];
  let stones = pits[pitIndex];
  let currentIndex = pitIndex;
  pits[pitIndex] = 0;

  while (stones > 0) {
    currentIndex = (currentIndex + 1) % pits.length;

    if (currentIndex === getOpponentStoreIndex(player)) {
      continue;
    }

    pits[currentIndex] += 1;
    path.push(currentIndex);
    stones -= 1;
  }

  const storeIndex = getStoreIndex(player);
  const wasExtraTurn = currentIndex === storeIndex;
  const oppositePitIndex = getOppositePitIndex(currentIndex);
  const wasCapture =
    !wasExtraTurn &&
    getPitOwner(currentIndex) === player &&
    pits[currentIndex] === 1 &&
    pits[oppositePitIndex] > 0;

  return {
    path,
    lastSlot: path.at(-1),
    wasCapture,
    wasExtraTurn,
    oppositePitIndex,
    storeIndex
  };
}

function getPitOwner(pitIndex) {
  if (pitIndex >= 0 && pitIndex <= 5) {
    return "one";
  }

  if (pitIndex >= 7 && pitIndex <= 12) {
    return "two";
  }

  return null;
}

function getPitNumber(pitIndex) {
  return pitIndex <= 5 ? pitIndex + 1 : pitIndex - 6;
}

function getBoardLayout() {
  if (localPlayer === "two") {
    return {
      leftStore: { index: 6, player: "one" },
      rightStore: { index: 13, player: "two" },
      topPits: [5, 4, 3, 2, 1, 0],
      bottomPits: [7, 8, 9, 10, 11, 12]
    };
  }

  return {
    leftStore: { index: 13, player: "two" },
    rightStore: { index: 6, player: "one" },
    topPits: [12, 11, 10, 9, 8, 7],
    bottomPits: [0, 1, 2, 3, 4, 5]
  };
}

function playerSideLabel(player) {
  if (player === localPlayer) {
    return "Your";
  }

  return `Player ${player}`;
}

function renderGems(stoneCount, limit = 48) {
  const visibleGemCount = Math.min(stoneCount, limit);
  const gems = Array.from(
    { length: visibleGemCount },
    (_, index) => `<i class="gem gem-${index % 5}"></i>`
  );
  const hiddenGemCount = stoneCount - visibleGemCount;

  if (hiddenGemCount > 0) {
    gems.push(`<b class="gem-overflow">+${hiddenGemCount}</b>`);
  }

  return gems.join("");
}

function renderStoneContents(stoneCount, label = "", gemLimit = 48) {
  const labelMarkup = label ? `<small>${label}</small>` : "";
  return `
    <span class="stone-count">${stoneCount}</span>
    <span class="gem-cluster" aria-hidden="true">${renderGems(stoneCount, gemLimit)}</span>
    ${labelMarkup}
  `;
}

function renderPit(pitIndex) {
  const owner = getPitOwner(pitIndex);
  const button = document.createElement("button");
  const classNames = ["pit"];
  if (owner === localPlayer) {
    classNames.push("pit-local");
  }
  if (gameState.status === "in_progress" && owner === gameState.currentPlayer) {
    classNames.push("active-side");
  }
  button.className = classNames.join(" ");
  button.type = "button";
  button.disabled = !canClickPit(pitIndex);
  button.dataset.pitIndex = String(pitIndex);
  button.dataset.slotIndex = String(pitIndex);
  button.setAttribute(
    "aria-label",
    `${playerSideLabel(owner)} pit ${getPitNumber(pitIndex)} with ${gameState.board.pits[pitIndex]} stones`
  );
  button.innerHTML = renderStoneContents(gameState.board.pits[pitIndex], "", isMobileViewport() ? 8 : 24);
  if (hasHoverInput()) {
    button.addEventListener("mouseenter", () => showMovePreview(pitIndex));
    button.addEventListener("mouseleave", clearPreview);
  }
  button.addEventListener("focus", () => showMovePreview(pitIndex));
  button.addEventListener("blur", clearPreview);
  button.addEventListener("click", () => {
    clearPreview();
    socket.emit("makeMove", {
      gameId: gameState.id,
      playerToken,
      pitIndex
    });
  });
  return button;
}

function previewSummary(preview) {
  const pitCount = preview.path.length;
  const destination = preview.wasExtraTurn ? "your store" : "the highlighted pit";
  const extras = [];
  if (preview.wasCapture) {
    extras.push("capture");
  }
  if (preview.wasExtraTurn) {
    extras.push("extra turn");
  }

  return `Preview: sow ${pitCount} stones, ending in ${destination}${extras.length ? ` (${extras.join(", ")})` : ""}.`;
}

function showMovePreview(pitIndex) {
  if (!canClickPit(pitIndex)) {
    return;
  }

  clearPreview();
  const preview = simulateMovePreview(localPlayer, pitIndex);
  getSlotElement(pitIndex)?.classList.add("is-preview-origin");

  preview.path.forEach((slotIndex) => {
    getSlotElement(slotIndex)?.classList.add("is-preview-path");
  });

  if (preview.lastSlot !== undefined) {
    getSlotElement(preview.lastSlot)?.classList.add("is-preview-last");
  }

  if (preview.wasCapture) {
    getSlotElement(preview.lastSlot)?.classList.add("is-preview-capture");
    getSlotElement(preview.oppositePitIndex)?.classList.add("is-preview-capture");
    getSlotElement(preview.storeIndex)?.classList.add("is-preview-store");
  }

  if (preview.wasExtraTurn) {
    getSlotElement(preview.storeIndex)?.classList.add("is-preview-store");
  }

  elements.turnBannerDetail.textContent = previewSummary(preview);
}

function renderBoard() {
  elements.board.replaceChildren();

  if (!gameState) {
    elements.board.innerHTML = '<div class="empty-board">No game loaded</div>';
    return;
  }

  const layout = getBoardLayout();
  const leftStore = document.createElement("div");
  leftStore.className = `store store-left${layout.leftStore.player === gameState.currentPlayer && gameState.status === "in_progress" ? " active-side" : ""}`;
  leftStore.dataset.slotIndex = String(layout.leftStore.index);
  leftStore.innerHTML = renderStoneContents(
    gameState.board.pits[layout.leftStore.index],
    `${playerSideLabel(layout.leftStore.player)} store`,
    isMobileViewport() ? 18 : 48
  );

  const rightStore = document.createElement("div");
  rightStore.className = `store store-right${layout.rightStore.player === gameState.currentPlayer && gameState.status === "in_progress" ? " active-side" : ""}`;
  rightStore.dataset.slotIndex = String(layout.rightStore.index);
  rightStore.innerHTML = renderStoneContents(
    gameState.board.pits[layout.rightStore.index],
    `${playerSideLabel(layout.rightStore.player)} store`,
    isMobileViewport() ? 18 : 48
  );

  const topRow = document.createElement("div");
  topRow.className = "pit-row pit-row-top";
  layout.topPits.forEach((pitIndex) => topRow.append(renderPit(pitIndex)));

  const bottomRow = document.createElement("div");
  bottomRow.className = "pit-row pit-row-bottom";
  layout.bottomPits.forEach((pitIndex) => bottomRow.append(renderPit(pitIndex)));

  elements.board.append(leftStore, topRow, bottomRow, rightStore);
}

function getSlotElement(slotIndex) {
  return elements.board.querySelector(`[data-slot-index="${slotIndex}"]`);
}

function addTemporaryClass(slotIndex, className, delay = 0, duration = 420) {
  const timerId = window.setTimeout(() => {
    const slot = getSlotElement(slotIndex);
    if (!slot) {
      return;
    }

    slot.classList.add(className);
    const removeTimerId = window.setTimeout(() => {
      slot.classList.remove(className);
    }, duration);
    animationTimers.push(removeTimerId);
  }, delay);

  animationTimers.push(timerId);
}

function computeSowingPath(previousState, move) {
  const stones = previousState.board.pits[move.pitIndex];
  const path = [];
  let currentIndex = move.pitIndex;

  for (let remaining = stones; remaining > 0; ) {
    currentIndex = (currentIndex + 1) % previousState.board.pits.length;

    if (currentIndex === getOpponentStoreIndex(move.player)) {
      continue;
    }

    path.push(currentIndex);
    remaining -= 1;
  }

  return path;
}

function animateChangedSlots(previousState, nextState) {
  nextState.board.pits.forEach((stoneCount, slotIndex) => {
    if (previousState.board.pits[slotIndex] !== stoneCount) {
      addTemporaryClass(slotIndex, "is-changed", 0, 520);
    }
  });
}

function animateStateTransition(previousState, nextState) {
  clearAnimationTimers();

  if (reducedMotionQuery.matches || !previousState || previousState.id !== nextState.id) {
    return;
  }

  animateChangedSlots(previousState, nextState);

  const move = nextState.lastMove;
  if (!move || (previousState.moveHistory?.length ?? 0) === (nextState.moveHistory?.length ?? 0)) {
    return;
  }

  const path = computeSowingPath(previousState, move);
  path.forEach((slotIndex, stepIndex) => {
    addTemporaryClass(slotIndex, "is-sowing", stepIndex * SOW_STEP_DELAY_MS, SOW_ANIMATION_MS);
  });

  const lastSlot = path.at(-1);
  if (lastSlot !== undefined) {
    addTemporaryClass(lastSlot, "is-last-stone", path.length * SOW_STEP_DELAY_MS, LAST_STONE_ANIMATION_MS);
  }

  if (move.wasCapture && lastSlot !== undefined) {
    const captureDelay = path.length * SOW_STEP_DELAY_MS + CAPTURE_DELAY_AFTER_LAST_MS;
    addTemporaryClass(lastSlot, "is-capture", captureDelay, CAPTURE_ANIMATION_MS);
    addTemporaryClass(getOppositePitIndex(lastSlot), "is-capture", captureDelay, CAPTURE_ANIMATION_MS);
    addTemporaryClass(getStoreIndex(move.player), "is-capture-store", captureDelay, STORE_ANIMATION_MS);
  }

  if (move.wasExtraTurn) {
    addTemporaryClass(
      getStoreIndex(move.player),
      "is-extra-turn",
      path.length * SOW_STEP_DELAY_MS + EXTRA_TURN_DELAY_AFTER_LAST_MS,
      STORE_ANIMATION_MS
    );
  }
}

function applyRemoteState(nextState, { animate = true } = {}) {
  const previousState = gameState;
  gameState = nextState;
  render();

  if (animate) {
    animateStateTransition(previousState, nextState);
  }
}

function render() {
  elements.localPlayer.textContent = localPlayer ? `Player ${localPlayer}` : "Not seated";
  elements.statusLabel.textContent = statusText();
  elements.turnLabel.textContent = turnText();
  elements.connectionLabel.textContent = connectionText();
  updateInviteVisibility();
  updateRematchButton();
  renderTurnBanner();
  renderResultPanel();
  renderMoveHistory();

  renderBoard();

  const outcome = outcomeText();
  if (outcome) {
    setMessage(`${outcome} ${rematchStatusText() || moveSummary()}`.trim());
    return;
  }

  if (gameState?.status === "waiting") {
    setMessage("Waiting for another player to join.");
    return;
  }

  if (gameState) {
    setMessage(moveSummary() || "Game ready.");
  }
}

elements.createGameButton.addEventListener("click", () => {
  socket.emit("createGame");
});

elements.createBotGameButton.addEventListener("click", () => {
  socket.emit("createBotGame", {
    difficulty: elements.botDifficultySelect.value
  });
});

elements.botDifficultySelect.addEventListener("change", updateBotDifficultyDescription);
updateBotDifficultyDescription();

elements.historyToggle.addEventListener("click", () => {
  if (!isMobileViewport()) {
    return;
  }

  elements.historyPanel.classList.toggle("is-collapsed");
  updateHistoryDisclosure();
});

window.addEventListener("resize", () => {
  if (!isMobileViewport()) {
    elements.historyPanel.classList.remove("is-collapsed");
  }
  updateHistoryDisclosure();
  renderBoard();
});

if (isMobileViewport()) {
  elements.historyPanel.classList.add("is-collapsed");
}
updateHistoryDisclosure();

elements.copyInviteButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements.inviteLink.value);
    showCopyFeedback();
    setMessage("Invite link copied.");
  } catch {
    elements.inviteLink.select();
    elements.copyStatus.textContent = "Link selected";
    setMessage("Copy permission was blocked. The invite link is selected.");
  }
});

elements.rematchButton.addEventListener("click", () => {
  if (!gameState || !playerToken) {
    return;
  }

  scrollToTop();
  socket.emit("requestRematch", {
    gameId: gameState.id,
    playerToken
  });
});

socket.on("gameCreated", ({ gameId, playerToken: token, player = "one", joinUrl, gameState: state }) => {
  elements.inviteLink.value = joinUrl;
  receiveSeat({ state, token, player });
  if (state.status !== "waiting") {
    scrollToTop();
  }
  setMessage(state.status === "waiting" ? `Game ${gameId} created. Share the invite link.` : "Rematch started.");
});

socket.on("gameJoined", ({ gameState: state, playerToken: token, player }) => {
  receiveSeat({ state, token, player });
  setMessage(state.status === "waiting" ? "Reconnected. Waiting for opponent." : "Joined game.");
});

socket.on("gameUpdated", ({ gameState: state }) => {
  applyRemoteState(state);
});

socket.on("gameCompleted", ({ gameState: state }) => {
  applyRemoteState(state);
});

socket.on("playerDisconnected", ({ gameState: state }) => {
  applyRemoteState(state, { animate: false });
  if (state.status !== "completed") {
    setMessage("A player disconnected. They can rejoin with their saved browser token.");
  }
});

socket.on("playerReconnected", ({ gameState: state }) => {
  applyRemoteState(state, { animate: false });
});

socket.on("invalidMove", ({ reason }) => {
  setMessage(reason);
});

socket.on("gameExpired", ({ reason }) => {
  if (gameState?.id) {
    clearStoredToken(gameState.id);
  }
  gameState = null;
  localPlayer = null;
  playerToken = null;
  clearGameUrl();
  render();
  setMessage(reason);
});

if (initialGameId) {
  const storedToken = getStoredToken(initialGameId);
  if (storedToken) {
    socket.emit("requestGameState", {
      gameId: initialGameId,
      playerToken: storedToken
    });
  } else {
    socket.emit("joinGame", {
      gameId: initialGameId
    });
  }
}

render();
