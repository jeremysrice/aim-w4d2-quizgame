// ===== Quiz Clash: page and display code =====
// Draws the screens and connects the buttons. The game rules (config,
// building a game, timing, scoring, results, leaderboard math) live in
// game-logic.js. Browser storage goes through safeStorage (storage.js),
// and live questions come from trivia-api.js.

// ===== Config =====
const LEADERBOARD_KEY = "quizClashLeaderboard"; // storage key for the top 5 list
safeStorage.remove("quizClashHighScore"); // retire the old single-score key

// ===== State =====
// Everything that changes during a game lives in this one object,
// so the UI can always be redrawn from it.
const state = {
  players: [], // see createPlayer in game-logic.js
  queue: [], // [{ playerIndex, difficulty, q, category, choices, answer }]
  current: 0, // index into queue of the question being shown
  answered: false, // true once the current question has been answered/timed out
  questionStartedAt: 0, // performance.now() when the current question appeared
  timerId: null, // setInterval id for the countdown display
  settings: { playerCount: 1, length: "standard", names: [] }, // last game's setup (for Play Again)
};

// ===== DOM =====
// Shorthand for document.getElementById.
const $ = (id) => document.getElementById(id);

// The three screens of the app; only one is visible at a time.
const screens = {
  setup: $("setup-screen"),
  quiz: $("quiz-screen"),
  results: $("results-screen"),
};

// ===== Helpers =====

// Hides every screen, shows the one named (setup, quiz or results), and scrolls to the top.
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
  window.scrollTo(0, 0);
}

// Converts text into HTML-safe text so player names or answers can't inject markup.
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Shows a message on the setup screen (or hides it when message is empty).
function showSetupError(message) {
  const el = $("setup-error");
  el.textContent = message;
  el.hidden = !message;
}

// ===== Leaderboard =====
// Saved through safeStorage, so blocked or full storage never crashes the game.
// The math (sorting, trimming to 5) is in game-logic.js.

// Reads the leaderboard from storage, dropping any damaged entries. Returns [] if none.
function getLeaderboard() {
  const data = safeStorage.get(LEADERBOARD_KEY, []);
  return Array.isArray(data) ? sortBoard(data.filter(isValidEntry)) : [];
}

// Adds a game's scores, keeps the top 5 and saves. Returns { board, newIds, saved }:
// saved is false if the scores could only be kept until the page closes.
function addToLeaderboard(entries) {
  const { board, newIds } = mergeLeaderboard(getLeaderboard(), entries);
  const saved = safeStorage.set(LEADERBOARD_KEY, board);
  return { board, newIds, saved };
}

// Draws a leaderboard into the <ol> with the given id.
// Entries whose ids are in highlightIds get a "NEW" tag and a glow.
function renderLeaderboard(listId, highlightIds = [], board = getLeaderboard()) {
  const list = $(listId);
  if (board.length === 0) {
    list.innerHTML = `<li class="empty">No scores yet — be the first!</li>`;
    return;
  }
  list.innerHTML = board
    .map((e, i) => {
      const date = new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const isNew = highlightIds.includes(e.id);
      return `
        <li class="${isNew ? "new-entry" : ""}">
          <span class="rank">${i + 1}</span>
          <span class="lb-name">${escapeHTML(e.name)}${isNew ? ' <span class="new-tag">NEW</span>' : ""}</span>
          <span class="lb-meta">${escapeHTML(e.length || "")} · ${date}</span>
          <span class="lb-score">${e.score}</span>
        </li>`;
    })
    .join("");
}

// If the browser won't let us save anything, say so under the setup leaderboard.
function renderStorageNote() {
  $("lb-storage-note").hidden = safeStorage.persistent;
}

// ===== Setup =====

// Reads the setup form: number of players, game length, and player names
// (blank names default to "Player 1" / "Player 2").
function readSettings() {
  const playerCount = Number(document.querySelector('input[name="players"]:checked').value);
  const length = document.querySelector('input[name="length"]:checked').value;
  const names = [
    $("p1-name").value.trim() || "Player 1",
    $("p2-name").value.trim() || "Player 2",
  ].slice(0, playerCount);
  return { playerCount, length, names };
}

// Starts a new game: builds the question list (topping up from the built-in
// questions, or shortening the game, if there aren't enough), resets every
// player, and shows the first question. Pass settings to replay with the
// same setup; otherwise they're read from the setup form.
function startGame(settings = readSettings()) {
  let built;
  try {
    built = buildQueue(getActiveBank(), settings.playerCount, LENGTHS[settings.length], {
      fallbackBank: QUESTION_BANK,
    });
  } catch (err) {
    console.error(err);
    showScreen("setup");
    showSetupError("Couldn't load enough questions to start a game. Please try again.");
    return;
  }

  showSetupError("");
  state.settings = settings;
  state.players = settings.names.map(createPlayer);
  state.queue = built.queue;
  state.current = 0;
  showScreen("quiz");
  renderQuestion();
}

// ===== Quiz =====

// Draws each player's name and score; outlines the player whose turn it is.
function renderScoreboard() {
  const activeIndex = state.queue[state.current]?.playerIndex;
  $("scoreboard").innerHTML = state.players
    .map(
      (p, i) => `
      <div class="score-card p${i + 1} ${i === activeIndex && !isGameOver() ? "active" : ""}">
        <span class="name">${escapeHTML(p.name)}</span>
        <span class="score">${p.score}</span>
      </div>`
    )
    .join("");
}

// Shows the current question: progress bar, difficulty badge, whose turn it is,
// category, question text and answer buttons. Then starts the countdown.
function renderQuestion() {
  const item = state.queue[state.current];
  const player = state.players[item.playerIndex];
  state.answered = false;

  renderScoreboard();

  // Progress: "Question X of Y" and the bar across the top.
  const total = state.queue.length;
  $("progress-text").textContent = `Question ${state.current + 1} of ${total}`;
  $("progress-fill").style.width = `${(state.current / total) * 100}%`;

  // Difficulty badge, colored by difficulty, with its point value.
  const badge = $("difficulty-badge");
  badge.className = `badge ${item.difficulty}`;
  badge.textContent = `${item.difficulty} · ${POINTS[item.difficulty]} pts`;

  // "Player X's turn" banner — only shown in 2-player games.
  const banner = $("turn-banner");
  if (state.players.length > 1) {
    banner.hidden = false;
    banner.className = `turn-banner p${item.playerIndex + 1}`;
    banner.textContent = `${player.name}'s turn`;
  } else {
    banner.hidden = true;
  }

  $("question-category").textContent = item.category;
  $("question-text").textContent = item.q;

  // One button per choice, labeled A–D.
  const answersEl = $("answers");
  answersEl.innerHTML = "";
  item.choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.innerHTML = `<span class="key">${"ABCD"[i]}</span><span>${escapeHTML(choice)}</span>`;
    btn.addEventListener("click", () => handleAnswer(i));
    answersEl.appendChild(btn);
  });

  // Clear the previous question's feedback and hide the Next button.
  $("feedback").textContent = "";
  $("feedback").className = "feedback";
  $("next-btn").hidden = true;

  startTimer();
}

// Seconds left on the current question, from the real clock (see timeRemaining).
function getTimeLeft() {
  return timeRemaining(state.questionStartedAt, performance.now());
}

// Starts the countdown for the current question. The start time is recorded
// and the time left is always worked out from the real clock, so browsers
// slowing down timers in background tabs can't stretch it.
function startTimer() {
  stopTimer();
  state.questionStartedAt = performance.now();
  updateTimerBar(TIME_LIMIT);
  state.timerId = setInterval(tickTimer, 100);
}

// One countdown tick: redraws the bar and ends the question when time is up.
function tickTimer() {
  if (state.answered) return;
  const timeLeft = getTimeLeft();
  updateTimerBar(timeLeft);
  if (timeLeft <= 0) handleAnswer(null); // time's up
}

// Stops the countdown (on answer, timeout or game end).
function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
}

// Shrinks the timer bar to match the time left and changes its color:
// green above 50%, amber at 50% or less, red at 20% or less.
function updateTimerBar(timeLeft) {
  const pct = (timeLeft / TIME_LIMIT) * 100;
  const fill = $("timer-fill");
  fill.style.width = `${pct}%`;
  fill.classList.toggle("warning", pct <= 50 && pct > 20);
  fill.classList.toggle("danger", pct <= 20);
}

// Handles a player's answer (choiceIndex 0–3) or a timeout (choiceIndex null).
// Scoring is done by game-logic.js (scoreAnswer, applyAnswer); this function
// then hands off to showAnswerFeedback for the display. Ignores repeat calls
// for the same question.
function handleAnswer(choiceIndex) {
  if (state.answered) return;
  const item = state.queue[state.current];
  // Ignore an answer that doesn't exist on this question (e.g. "D" when there are only 2 choices).
  if (choiceIndex !== null && !(Number.isInteger(choiceIndex) && choiceIndex >= 0 && choiceIndex < item.choices.length)) return;
  state.answered = true;
  stopTimer();

  const timeLeft = choiceIndex === null ? 0 : getTimeLeft();
  const outcome = scoreAnswer(item, choiceIndex, timeLeft);
  state.players[item.playerIndex] = applyAnswer(state.players[item.playerIndex], item.difficulty, outcome);

  updateTimerBar(timeLeft);
  showAnswerFeedback(item, choiceIndex, outcome);
}

// Display only: locks the answer buttons, colors the correct one green and a
// wrong pick red, shows the result message, updates the scoreboard and
// reveals Next (or "See Results" on the last question).
function showAnswerFeedback(item, choiceIndex, outcome) {
  const buttons = $("answers").querySelectorAll(".answer-btn");
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === item.answer) btn.classList.add("correct");
    else if (i === choiceIndex && !outcome.timedOut) btn.classList.add("wrong");
  });

  const feedback = $("feedback");
  if (outcome.isCorrect) {
    feedback.textContent = `Correct! +${outcome.base}${outcome.bonus > 0 ? ` (+${outcome.bonus} speed bonus)` : ""}`;
    feedback.classList.add("good");
  } else if (outcome.timedOut) {
    feedback.textContent = `Time's up! The answer was "${item.choices[item.answer]}".`;
    feedback.classList.add("bad");
  } else {
    feedback.textContent = `Wrong! The answer was "${item.choices[item.answer]}".`;
    feedback.classList.add("bad");
  }

  renderScoreboard();
  const next = $("next-btn");
  next.textContent = state.current === state.queue.length - 1 ? "See Results" : "Next";
  next.hidden = false;
  next.focus({ preventScroll: true });
  // On short phone screens the Next button can sit below the fold.
  next.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// True once every question in the queue has been played.
function isGameOver() {
  return state.current >= state.queue.length;
}

// Moves to the next question, or to the results screen after the last one.
function nextQuestion() {
  state.current++;
  if (isGameOver()) showResults();
  else renderQuestion();
}

// ===== Results =====

// Ends the game: saves scores to the leaderboard, picks a title (see
// decideResult), and shows each player's final score, accuracy and
// per-difficulty breakdown. Results always show, even if saving fails;
// a note explains when scores couldn't be saved permanently.
function showResults() {
  stopTimer();
  $("progress-fill").style.width = "100%";
  const players = state.players;

  const prevTopScore = getLeaderboard()[0]?.score ?? 0;
  const { board, newIds, saved } = addToLeaderboard(
    players.map((p) => ({ name: p.name, score: p.score, length: state.settings.length }))
  );
  const { title, winners } = decideResult(players, { prevTopScore, madeBoard: newIds.length > 0 });
  $("results-title").textContent = title;

  // One result card per player; in multiplayer games the top scorer(s) get an outline.
  $("results-body").innerHTML = players
    .map((p, i) => {
      const rows = DIFFICULTIES.map((d) => {
        const { right, total } = p.byDifficulty[d];
        return `<li><span class="badge ${d}">${d}</span> ${right} / ${total}</li>`;
      }).join("");
      return `
        <div class="result-card p${i + 1} ${winners.includes(i) ? "winner" : ""}">
          <h3>${escapeHTML(p.name)}</h3>
          <p class="final-score">${p.score}<small> pts</small></p>
          <p class="accuracy">${p.correct} correct · ${accuracy(p)}% accuracy</p>
          <ul class="breakdown">${rows}</ul>
        </div>`;
    })
    .join("");

  renderLeaderboard("leaderboard-results", newIds, board);

  // Tell the player if their score is only kept until the page closes.
  const note = $("results-note");
  note.hidden = saved;
  note.textContent = saved
    ? ""
    : "Heads up: this browser won't let the game save scores, so the leaderboard resets when you close the page.";

  showScreen("results");
}

// ===== Events =====
// Wires up every button and input to the functions above.

// Show the Player 2 name field only when "2 Players" is selected.
document.querySelectorAll('input[name="players"]').forEach((radio) =>
  radio.addEventListener("change", () => {
    $("p2-field").hidden = readSettings().playerCount !== 2;
  })
);

// Start Game: begin a new game using the setup form.
$("start-btn").addEventListener("click", () => startGame());

// Pressing "done"/Enter on the phone keyboard closes it instead of doing nothing.
["p1-name", "p2-name"].forEach((id) =>
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.target.blur();
  })
);

// Next: go to the next question (or results).
$("next-btn").addEventListener("click", nextQuestion);

// Play Again: same players and length, fresh questions.
$("replay-btn").addEventListener("click", () => startGame(state.settings));

// Main Menu: back to setup with an up-to-date leaderboard.
$("menu-btn").addEventListener("click", () => {
  renderLeaderboard("leaderboard-setup");
  showScreen("setup");
});

// Clear leaderboard: wipe all saved scores after confirming.
$("clear-lb-btn").addEventListener("click", () => {
  if (confirm("Clear all leaderboard scores?")) {
    safeStorage.remove(LEADERBOARD_KEY);
    renderLeaderboard("leaderboard-setup");
  }
});

// Keyboard shortcuts during the quiz: A–D or 1–4 to answer.
// (Enter for Next works because the Next button gets focus after answering.)
document.addEventListener("keydown", (e) => {
  if (!screens.quiz.classList.contains("active")) return;
  // Leave browser shortcuts (Ctrl+1, Cmd+2, Alt+…) alone, and ignore a held-down key.
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (!state.answered) {
    const map = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 };
    const idx = map[e.key.toLowerCase()];
    if (idx !== undefined) handleAnswer(idx);
  }
});

// When the player comes back to this tab, update the timer straight away
// (it kept running on the real clock while the tab was hidden).
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && screens.quiz.classList.contains("active")) tickTimer();
});

// ===== Question source status =====
// The status line on the setup screen showing where questions come from
// (live from the API or built-in) and when the next refresh happens.

// Turns a duration in milliseconds into friendly text like "12 min".
function formatMinutes(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return "less than a minute";
  return `${mins} min`;
}

// Timer that updates the refresh button's cool-down countdown.
let cooldownTimer = null;

// Updates the status line from questionSource (see trivia-api.js) and
// disables the "Get new questions now" button while a fetch is running.
function renderQuestionStatus() {
  const s = questionSource;
  const status = $("question-status");
  const btn = $("refresh-questions-btn");
  const now = Date.now();
  let text;

  if (s.loading) {
    text = "⏳ Fetching new questions…";
  } else if (s.source === "live") {
    text = `🌐 Live questions${s.partial ? " (partly updated)" : ""} · updated ${formatMinutes(now - s.fetchedAt)} ago`;
    if (s.error) text += " · couldn't refresh, retrying soon";
    else if (s.partial) text += ` · retrying the rest in ${formatMinutes(s.nextRefreshAt - now)}`;
    else text += ` · new set in ${formatMinutes(s.nextRefreshAt - now)}`;
  } else if (s.error === "offline") {
    text = "📴 Offline · using built-in questions";
  } else if (s.error) {
    text = "⚠️ Couldn't reach the question server · using built-in questions";
  } else {
    text = "📚 Using built-in questions";
  }

  status.textContent = text;
  status.classList.toggle("loading", s.loading);

  // The button is off while fetching and during the 1-minute cool-down after
  // a press, with a countdown that updates every second.
  const wait = manualRefreshWaitMs(now);
  btn.disabled = s.loading || wait > 0;
  btn.textContent = wait > 0 && !s.loading
    ? `↻ New questions in ${Math.ceil(wait / 1000)}s`
    : "↻ Get new questions now";
  clearTimeout(cooldownTimer);
  if (wait > 0) cooldownTimer = setTimeout(renderQuestionStatus, Math.min(1000, wait));
}

// Keep the "x min ago" text current.
setInterval(renderQuestionStatus, 30 * 1000);

// "Get new questions now" button: fetch a fresh set immediately.
$("refresh-questions-btn").addEventListener("click", () => refreshQuestions({ force: true }));

// ===== Startup =====
// Show the saved leaderboard, warn if storage is unavailable, and begin
// loading/refreshing live questions (the status line is registered first,
// so it never misses an update).
renderLeaderboard("leaderboard-setup");
renderStorageNote();
startQuestionAutoRefresh(renderQuestionStatus);
