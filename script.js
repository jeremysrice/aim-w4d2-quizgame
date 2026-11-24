// ===== Config =====
// Game-wide settings. Change these to tune scoring, timing and game length.
const POINTS = { easy: 10, medium: 20, hard: 30 }; // base points per correct answer
const DIFFICULTIES = ["easy", "medium", "hard"]; // the order questions are asked in
const LENGTHS = { short: 2, standard: 3, long: 4 }; // questions per difficulty, per player
const TIME_LIMIT = 15; // seconds per question
const MAX_SPEED_BONUS = 0.5; // up to +50% of base points
const LEADERBOARD_KEY = "quizClashLeaderboard"; // localStorage key for the top 5 list
const LEADERBOARD_SIZE = 5; // how many scores the leaderboard keeps
localStorage.removeItem("quizClashHighScore"); // retire the old single-score key

// ===== State =====
// Everything that changes during a game lives in this one object,
// so the UI can always be redrawn from it.
const state = {
  players: [], // { name, score, correct, byDifficulty: {easy:{right,total},...} }
  queue: [], // [{ playerIndex, difficulty, q, category, choices, answer }]
  current: 0, // index into queue of the question being shown
  answered: false, // true once the current question has been answered/timed out
  timeLeft: TIME_LIMIT, // seconds remaining on the current question
  timerId: null, // setInterval id for the countdown
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

// Returns a shuffled copy of an array (Fisher–Yates), leaving the original untouched.
function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Converts text into HTML-safe text so player names or answers can't inject markup.
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== Leaderboard =====
// Stored as an array of { id, name, score, length, date }, sorted best-first.
// Only the top LEADERBOARD_SIZE entries are kept; anything pushed below is deleted.

// Reads the leaderboard from localStorage. Returns [] if it's missing or corrupted.
function getLeaderboard() {
  try {
    const data = JSON.parse(localStorage.getItem(LEADERBOARD_KEY));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Writes the leaderboard array to localStorage.
function saveLeaderboard(board) {
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(board));
}

// Sorts entries in place: higher score first; on a tie, the more recent score ranks higher.
function sortBoard(board) {
  return board.sort((a, b) => b.score - a.score || b.date - a.date);
}

// Returns true if a score would earn a spot on the current leaderboard.
function qualifiesForLeaderboard(score) {
  const board = getLeaderboard();
  if (score <= 0) return false;
  if (board.length < LEADERBOARD_SIZE) return true;
  return score >= board[board.length - 1].score; // ties go to the newer score
}

// Adds new score entries, re-sorts, and trims to the top 5 (lower scores are deleted).
// Returns the ids of the new entries that made the cut, so they can be highlighted.
function addToLeaderboard(entries) {
  const board = getLeaderboard();
  const added = entries
    .filter((e) => e.score > 0)
    .map((e, i) => ({ ...e, id: `${Date.now()}-${i}`, date: Date.now() + i }));
  const updated = sortBoard([...board, ...added]).slice(0, LEADERBOARD_SIZE);
  saveLeaderboard(updated);
  const keptIds = new Set(updated.map((e) => e.id));
  return added.filter((e) => keptIds.has(e.id)).map((e) => e.id);
}

// Draws the leaderboard into the <ol> with the given id.
// Entries whose ids are in highlightIds get a "NEW" tag and a glow.
function renderLeaderboard(listId, highlightIds = []) {
  const board = getLeaderboard();
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
          <span class="lb-meta">${escapeHTML(e.length)} · ${date}</span>
          <span class="lb-score">${e.score}</span>
        </li>`;
    })
    .join("");
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

// Builds the ordered list of questions for a game.
// Each player gets their own unique questions (perDifficulty of each difficulty),
// ordered easy → medium → hard, with answer choices shuffled.
// In 2-player mode the turns are interleaved: P1, P2, P1, P2...
function buildQueue(playerCount, perDifficulty) {
  const perPlayer = Array.from({ length: playerCount }, () => []);
  const bank = getActiveBank(); // live questions if loaded, otherwise built-in

  // For each difficulty, shuffle the pool and hand each player a separate slice.
  DIFFICULTIES.forEach((difficulty) => {
    const pool = shuffle(bank[difficulty]);
    for (let p = 0; p < playerCount; p++) {
      const slice = pool.slice(p * perDifficulty, (p + 1) * perDifficulty);
      slice.forEach((item) => {
        // Shuffle choices too, tracking where the correct answer lands.
        const correctText = item.choices[item.answer];
        const choices = shuffle(item.choices);
        perPlayer[p].push({
          playerIndex: p,
          difficulty,
          q: item.q,
          category: item.category || "",
          choices,
          answer: choices.indexOf(correctText),
        });
      });
    }
  });

  // Interleave turns: P1, P2, P1, P2... (already ordered easy → medium → hard)
  const queue = [];
  for (let i = 0; i < perPlayer[0].length; i++) {
    for (let p = 0; p < playerCount; p++) queue.push(perPlayer[p][i]);
  }
  return queue;
}

// Starts a new game: resets every player's score and stats, builds the
// question queue, and shows the first question. Pass settings to replay
// with the same setup; otherwise they're read from the setup form.
function startGame(settings = readSettings()) {
  state.settings = settings;
  state.players = settings.names.map((name) => ({
    name,
    score: 0,
    correct: 0,
    byDifficulty: {
      easy: { right: 0, total: 0 },
      medium: { right: 0, total: 0 },
      hard: { right: 0, total: 0 },
    },
  }));
  state.queue = buildQueue(settings.playerCount, LENGTHS[settings.length]);
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

// Starts the per-question countdown, ticking every 0.1s.
// When it reaches zero the question is treated as unanswered (wrong).
function startTimer() {
  stopTimer();
  state.timeLeft = TIME_LIMIT;
  updateTimerBar();
  state.timerId = setInterval(() => {
    state.timeLeft = Math.max(0, state.timeLeft - 0.1);
    updateTimerBar();
    if (state.timeLeft <= 0) handleAnswer(null); // time's up
  }, 100);
}

// Stops the countdown (on answer, timeout or game end).
function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
}

// Shrinks the timer bar to match the time left and changes its color:
// green above 50%, amber at 50% or less, red at 20% or less.
function updateTimerBar() {
  const pct = (state.timeLeft / TIME_LIMIT) * 100;
  const fill = $("timer-fill");
  fill.style.width = `${pct}%`;
  fill.classList.toggle("warning", pct <= 50 && pct > 20);
  fill.classList.toggle("danger", pct <= 20);
}

// Works out the points for a correct answer: the difficulty's base points
// plus a speed bonus proportional to the time left (up to MAX_SPEED_BONUS).
function calculatePoints(difficulty, timeLeft) {
  const base = POINTS[difficulty];
  const bonus = Math.round(base * MAX_SPEED_BONUS * (timeLeft / TIME_LIMIT));
  return { base, bonus, total: base + bonus };
}

// Handles a player's answer (choiceIndex 0–3) or a timeout (choiceIndex null):
// locks the buttons, marks right/wrong, updates score and stats, shows feedback,
// and reveals the Next button. Ignores repeat calls for the same question.
function handleAnswer(choiceIndex) {
  if (state.answered) return;
  state.answered = true;
  stopTimer();

  const item = state.queue[state.current];
  const player = state.players[item.playerIndex];
  const buttons = $("answers").querySelectorAll(".answer-btn");
  const isCorrect = choiceIndex === item.answer;
  const feedback = $("feedback");

  // Disable all buttons; highlight the correct one green and a wrong pick red.
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === item.answer) btn.classList.add("correct");
    else if (i === choiceIndex) btn.classList.add("wrong");
  });

  player.byDifficulty[item.difficulty].total++;

  // Score the answer and show the matching message.
  if (isCorrect) {
    const pts = calculatePoints(item.difficulty, state.timeLeft);
    player.score += pts.total;
    player.correct++;
    player.byDifficulty[item.difficulty].right++;
    feedback.textContent = `Correct! +${pts.base}${pts.bonus > 0 ? ` (+${pts.bonus} speed bonus)` : ""}`;
    feedback.classList.add("good");
  } else if (choiceIndex === null) {
    feedback.textContent = `Time's up! The answer was "${item.choices[item.answer]}".`;
    feedback.classList.add("bad");
  } else {
    feedback.textContent = `Wrong! The answer was "${item.choices[item.answer]}".`;
    feedback.classList.add("bad");
  }

  // Update scores and show Next (or "See Results" on the last question).
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

// Ends the game: saves scores to the leaderboard, picks a title
// (high score / made the board / winner / tie), and shows each player's
// final score, accuracy and per-difficulty breakdown.
function showResults() {
  stopTimer();
  $("progress-fill").style.width = "100%";
  const players = state.players;
  let title;

  // Check before saving so the title reflects whether the score made the board.
  const prevTop = getLeaderboard()[0]?.score ?? 0;
  const madeBoard = players.some((p) => qualifiesForLeaderboard(p.score));
  const newIds = addToLeaderboard(
    players.map((p) => ({ name: p.name, score: p.score, length: state.settings.length }))
  );

  // 1 player: celebrate a high score or leaderboard spot. 2 players: name the winner.
  if (players.length === 1) {
    const p = players[0];
    if (p.score > prevTop) title = "New High Score!";
    else if (madeBoard) title = "You Made the Leaderboard!";
    else title = "Quiz Complete!";
  } else {
    const [a, b] = players;
    if (a.score > b.score) title = `${a.name} Wins!`;
    else if (b.score > a.score) title = `${b.name} Wins!`;
    else title = "It's a Tie!";
  }
  $("results-title").textContent = title;

  // One result card per player; in 2-player games the top scorer gets an outline.
  const topScore = Math.max(...players.map((p) => p.score));
  $("results-body").innerHTML = players
    .map((p, i) => {
      const answered = DIFFICULTIES.reduce((n, d) => n + p.byDifficulty[d].total, 0);
      const accuracy = answered ? Math.round((p.correct / answered) * 100) : 0;
      const isWinner = players.length > 1 && p.score === topScore;
      const rows = DIFFICULTIES.map((d) => {
        const { right, total } = p.byDifficulty[d];
        return `<li><span class="badge ${d}">${d}</span> ${right} / ${total}</li>`;
      }).join("");
      return `
        <div class="result-card p${i + 1} ${isWinner ? "winner" : ""}">
          <h3>${escapeHTML(p.name)}</h3>
          <p class="final-score">${p.score}<small> pts</small></p>
          <p class="accuracy">${p.correct} correct · ${accuracy}% accuracy</p>
          <ul class="breakdown">${rows}</ul>
        </div>`;
    })
    .join("");

  renderLeaderboard("leaderboard-results", newIds);
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
    localStorage.removeItem(LEADERBOARD_KEY);
    renderLeaderboard("leaderboard-setup");
  }
});

// Keyboard shortcuts during the quiz: A–D or 1–4 to answer.
// (Enter for Next works because the Next button gets focus after answering.)
document.addEventListener("keydown", (e) => {
  if (!screens.quiz.classList.contains("active")) return;
  if (!state.answered) {
    const map = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 };
    const idx = map[e.key.toLowerCase()];
    if (idx !== undefined) handleAnswer(idx);
  }
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
    text = `🌐 Live questions · updated ${formatMinutes(now - s.fetchedAt)} ago`;
    if (s.error) text += " · couldn't refresh, retrying soon";
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
  btn.disabled = s.loading;
}

// Redraw the status whenever the questions change, and every 30s so "x min ago" stays current.
onQuestionSourceChange(renderQuestionStatus);
setInterval(renderQuestionStatus, 30 * 1000);

// "Get new questions now" button: fetch a fresh set immediately.
$("refresh-questions-btn").addEventListener("click", () => refreshQuestions());

// ===== Startup =====
// Show the saved leaderboard and begin loading/refreshing live questions.
renderLeaderboard("leaderboard-setup");
startQuestionAutoRefresh();
