// ===== Config =====
const POINTS = { easy: 10, medium: 20, hard: 30 };
const DIFFICULTIES = ["easy", "medium", "hard"];
const LENGTHS = { short: 2, standard: 3, long: 4 }; // questions per difficulty, per player
const TIME_LIMIT = 15; // seconds per question
const MAX_SPEED_BONUS = 0.5; // up to +50% of base points
const LEADERBOARD_KEY = "quizClashLeaderboard";
const LEADERBOARD_SIZE = 5;
localStorage.removeItem("quizClashHighScore"); // retire the old single-score key

// ===== State =====
const state = {
  players: [], // { name, score, correct, byDifficulty: {easy:{right,total},...} }
  queue: [], // [{ playerIndex, difficulty, q, choices, answer }]
  current: 0,
  answered: false,
  timeLeft: TIME_LIMIT,
  timerId: null,
  settings: { playerCount: 1, length: "standard", names: [] },
};

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const screens = {
  setup: $("setup-screen"),
  quiz: $("quiz-screen"),
  results: $("results-screen"),
};

// ===== Helpers =====
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
  window.scrollTo(0, 0);
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== Leaderboard =====
// Stored as an array of { id, name, score, length, date }, sorted best-first.
// Only the top LEADERBOARD_SIZE entries are kept; anything pushed below is deleted.
function getLeaderboard() {
  try {
    const data = JSON.parse(localStorage.getItem(LEADERBOARD_KEY));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveLeaderboard(board) {
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(board));
}

function sortBoard(board) {
  // Higher score first; on a tie, the more recent score ranks higher.
  return board.sort((a, b) => b.score - a.score || b.date - a.date);
}

function qualifiesForLeaderboard(score) {
  const board = getLeaderboard();
  if (score <= 0) return false;
  if (board.length < LEADERBOARD_SIZE) return true;
  return score >= board[board.length - 1].score; // ties go to the newer score
}

// Adds entries, re-sorts, and trims to the top 5. Returns ids that made the cut.
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
function readSettings() {
  const playerCount = Number(document.querySelector('input[name="players"]:checked').value);
  const length = document.querySelector('input[name="length"]:checked').value;
  const names = [
    $("p1-name").value.trim() || "Player 1",
    $("p2-name").value.trim() || "Player 2",
  ].slice(0, playerCount);
  return { playerCount, length, names };
}

function buildQueue(playerCount, perDifficulty) {
  // Each player gets unique questions; pool is shuffled per difficulty and split.
  const perPlayer = Array.from({ length: playerCount }, () => []);

  DIFFICULTIES.forEach((difficulty) => {
    const pool = shuffle(QUESTION_BANK[difficulty]);
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

function renderQuestion() {
  const item = state.queue[state.current];
  const player = state.players[item.playerIndex];
  state.answered = false;

  renderScoreboard();

  const total = state.queue.length;
  $("progress-text").textContent = `Question ${state.current + 1} of ${total}`;
  $("progress-fill").style.width = `${(state.current / total) * 100}%`;

  const badge = $("difficulty-badge");
  badge.className = `badge ${item.difficulty}`;
  badge.textContent = `${item.difficulty} · ${POINTS[item.difficulty]} pts`;

  const banner = $("turn-banner");
  if (state.players.length > 1) {
    banner.hidden = false;
    banner.className = `turn-banner p${item.playerIndex + 1}`;
    banner.textContent = `${player.name}'s turn`;
  } else {
    banner.hidden = true;
  }

  $("question-text").textContent = item.q;

  const answersEl = $("answers");
  answersEl.innerHTML = "";
  item.choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.innerHTML = `<span class="key">${"ABCD"[i]}</span><span>${escapeHTML(choice)}</span>`;
    btn.addEventListener("click", () => handleAnswer(i));
    answersEl.appendChild(btn);
  });

  $("feedback").textContent = "";
  $("feedback").className = "feedback";
  $("next-btn").hidden = true;

  startTimer();
}

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

function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
}

function updateTimerBar() {
  const pct = (state.timeLeft / TIME_LIMIT) * 100;
  const fill = $("timer-fill");
  fill.style.width = `${pct}%`;
  fill.classList.toggle("warning", pct <= 50 && pct > 20);
  fill.classList.toggle("danger", pct <= 20);
}

function calculatePoints(difficulty, timeLeft) {
  const base = POINTS[difficulty];
  const bonus = Math.round(base * MAX_SPEED_BONUS * (timeLeft / TIME_LIMIT));
  return { base, bonus, total: base + bonus };
}

function handleAnswer(choiceIndex) {
  if (state.answered) return;
  state.answered = true;
  stopTimer();

  const item = state.queue[state.current];
  const player = state.players[item.playerIndex];
  const buttons = $("answers").querySelectorAll(".answer-btn");
  const isCorrect = choiceIndex === item.answer;
  const feedback = $("feedback");

  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === item.answer) btn.classList.add("correct");
    else if (i === choiceIndex) btn.classList.add("wrong");
  });

  player.byDifficulty[item.difficulty].total++;

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

  renderScoreboard();
  const next = $("next-btn");
  next.textContent = state.current === state.queue.length - 1 ? "See Results" : "Next";
  next.hidden = false;
  next.focus({ preventScroll: true });
  // On short phone screens the Next button can sit below the fold.
  next.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function isGameOver() {
  return state.current >= state.queue.length;
}

function nextQuestion() {
  state.current++;
  if (isGameOver()) showResults();
  else renderQuestion();
}

// ===== Results =====
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
document.querySelectorAll('input[name="players"]').forEach((radio) =>
  radio.addEventListener("change", () => {
    $("p2-field").hidden = readSettings().playerCount !== 2;
  })
);

$("start-btn").addEventListener("click", () => startGame());
// Pressing "done"/Enter on the phone keyboard closes it instead of doing nothing.
["p1-name", "p2-name"].forEach((id) =>
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.target.blur();
  })
);
$("next-btn").addEventListener("click", nextQuestion);
$("replay-btn").addEventListener("click", () => startGame(state.settings));
$("menu-btn").addEventListener("click", () => {
  renderLeaderboard("leaderboard-setup");
  showScreen("setup");
});
$("clear-lb-btn").addEventListener("click", () => {
  if (confirm("Clear all leaderboard scores?")) {
    localStorage.removeItem(LEADERBOARD_KEY);
    renderLeaderboard("leaderboard-setup");
  }
});

// Keyboard shortcuts: A-D or 1-4 to answer, Enter for next.
document.addEventListener("keydown", (e) => {
  if (!screens.quiz.classList.contains("active")) return;
  if (!state.answered) {
    const map = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 };
    const idx = map[e.key.toLowerCase()];
    if (idx !== undefined) handleAnswer(idx);
  }
});

renderLeaderboard("leaderboard-setup");
