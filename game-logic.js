// ===== Game logic =====
// The game's rules, with no page or storage access: config, shuffling,
// question checks, building a game, timing, scoring, results and the
// leaderboard math. Keeping these separate from the display code
// (script.js) means they can be unit tested in Node (see tests/).
// In the browser this loads as a normal script and its functions are global.

// ===== Config =====
// Change these to tune scoring, timing and game length.
const POINTS = { easy: 10, medium: 20, hard: 30 }; // base points per correct answer
const DIFFICULTIES = ["easy", "medium", "hard"]; // the order questions are asked in
const LENGTHS = { short: 2, standard: 3, long: 4 }; // questions per difficulty, per player
const MAX_PLAYERS = 2;
const TIME_LIMIT = 15; // seconds per question
const MAX_SPEED_BONUS = 0.5; // up to +50% of base points
const LEADERBOARD_SIZE = 5; // how many scores the leaderboard keeps

// ===== Helpers =====

// Returns a shuffled copy of an array (Fisher–Yates), leaving the original untouched.
// Pass your own random function (returning 0 to <1) for repeatable results in tests.
function shuffle(arr, random = Math.random) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Returns a new unique id for a leaderboard entry. Uses crypto.randomUUID when
// the browser allows it (it's only available on https/localhost pages).
function makeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ===== Questions =====

// True if a question is safe to play: non-empty text, 2–4 non-empty choices
// with no duplicates (ignoring case and spaces), and a valid correct-answer index.
function isValidQuestion(item) {
  if (!item || typeof item.q !== "string" || !item.q.trim()) return false;
  const { choices, answer } = item;
  if (!Array.isArray(choices) || choices.length < 2 || choices.length > 4) return false;
  if (!choices.every((c) => typeof c === "string" && c.trim())) return false;
  const unique = new Set(choices.map((c) => c.trim().toLowerCase()));
  if (unique.size !== choices.length) return false;
  return Number.isInteger(answer) && answer >= 0 && answer < choices.length;
}

// Builds the ordered list of questions for one game.
//   bank            { easy: [...], medium: [...], hard: [...] } questions to draw from
//   playerCount     1 or 2
//   perDifficulty   questions per difficulty for each player (from LENGTHS)
//   options.fallbackBank  extra questions used to top up a short difficulty
//   options.random        random function, for repeatable tests
// Each player gets their own questions, ordered easy → medium → hard, with
// the answer choices shuffled. Turns alternate P1, P2, P1, P2...
// If there still aren't enough questions after topping up, the game is
// shortened evenly for everyone instead of crashing.
// Returns { queue, perDifficulty } where perDifficulty is the count actually used.
// Throws only if there isn't even one question per player per difficulty.
function buildQueue(bank, playerCount, perDifficulty, { fallbackBank = null, random = Math.random } = {}) {
  const needed = playerCount * perDifficulty;

  // 1. Collect playable questions for each difficulty, topping up from the fallback bank.
  const pools = {};
  DIFFICULTIES.forEach((difficulty) => {
    const pool = shuffle(((bank && bank[difficulty]) || []).filter(isValidQuestion), random);
    if (pool.length < needed && fallbackBank) {
      const seen = new Set(pool.map((item) => item.q));
      const extras = shuffle(
        (fallbackBank[difficulty] || []).filter((item) => isValidQuestion(item) && !seen.has(item.q)),
        random
      );
      pool.push(...extras.slice(0, needed - pool.length));
    }
    pools[difficulty] = pool;
  });

  // 2. Every player must get the same number of each difficulty; shorten if needed.
  const count = Math.min(
    perDifficulty,
    ...DIFFICULTIES.map((d) => Math.floor(pools[d].length / playerCount))
  );
  if (count < 1) throw new Error("Not enough questions to start a game");

  // 3. Hand each player a separate slice, shuffling choices by position so
  //    the correct answer is tracked exactly (not by matching its text).
  const perPlayer = Array.from({ length: playerCount }, () => []);
  DIFFICULTIES.forEach((difficulty) => {
    for (let p = 0; p < playerCount; p++) {
      pools[difficulty].slice(p * count, (p + 1) * count).forEach((item) => {
        const order = shuffle(item.choices.map((_, i) => i), random);
        perPlayer[p].push({
          playerIndex: p,
          difficulty,
          q: item.q,
          category: item.category || "",
          choices: order.map((i) => item.choices[i]),
          answer: order.indexOf(item.answer),
        });
      });
    }
  });

  // 4. Interleave turns: P1, P2, P1, P2... (all lists are the same length).
  const queue = [];
  for (let i = 0; i < perPlayer[0].length; i++) {
    for (let p = 0; p < playerCount; p++) queue.push(perPlayer[p][i]);
  }
  return { queue, perDifficulty: count };
}

// ===== Timing and scoring =====

// Seconds left on a question, worked out from real elapsed time rather than
// by counting timer ticks, so slowed-down background tabs can't stretch it.
// startedAtMs and nowMs come from the same clock (performance.now() in the app).
function timeRemaining(startedAtMs, nowMs, limit = TIME_LIMIT) {
  const elapsed = (nowMs - startedAtMs) / 1000;
  return Math.min(limit, Math.max(0, limit - elapsed));
}

// Points for a correct answer: the difficulty's base points plus a speed bonus
// proportional to the time left (up to MAX_SPEED_BONUS). Unknown difficulties
// score 0 instead of NaN, and timeLeft is clamped to 0..TIME_LIMIT.
function calculatePoints(difficulty, timeLeft) {
  const base = POINTS[difficulty] || 0;
  const t = Math.min(TIME_LIMIT, Math.max(0, Number(timeLeft) || 0));
  const bonus = base && TIME_LIMIT > 0 ? Math.round(base * MAX_SPEED_BONUS * (t / TIME_LIMIT)) : 0;
  return { base, bonus, total: base + bonus };
}

// Scores one answer. choiceIndex is 0–3, or null when time ran out.
// An answer that arrives after the time is up counts as a timeout.
// Returns { isCorrect, timedOut, base, bonus, total }.
function scoreAnswer(item, choiceIndex, timeLeft) {
  const timedOut = choiceIndex === null || choiceIndex === undefined || !(timeLeft > 0);
  const isCorrect = !timedOut && choiceIndex === item.answer;
  const points = isCorrect ? calculatePoints(item.difficulty, timeLeft) : { base: 0, bonus: 0, total: 0 };
  return { isCorrect, timedOut, ...points };
}

// ===== Players =====

// Creates a player with a zero score and empty per-difficulty stats.
function createPlayer(name) {
  const byDifficulty = {};
  DIFFICULTIES.forEach((d) => (byDifficulty[d] = { right: 0, total: 0 }));
  return { name, score: 0, correct: 0, byDifficulty };
}

// Returns an updated copy of a player after one answer (the original isn't changed).
function applyAnswer(player, difficulty, outcome) {
  const prev = player.byDifficulty[difficulty] || { right: 0, total: 0 };
  const right = outcome.isCorrect ? 1 : 0;
  return {
    ...player,
    score: player.score + outcome.total,
    correct: player.correct + right,
    byDifficulty: {
      ...player.byDifficulty,
      [difficulty]: { right: prev.right + right, total: prev.total + 1 },
    },
  };
}

// Percentage of answered questions a player got right (0 if none answered).
function accuracy(player) {
  const answered = Object.values(player.byDifficulty).reduce((n, d) => n + d.total, 0);
  return answered ? Math.round((player.correct / answered) * 100) : 0;
}

// Picks the results title and the winner(s).
//   1 player:  "New High Score!", "You Made the Leaderboard!" or "Quiz Complete!"
//   2+ players: "<name> Wins!" or "It's a Tie!" (works for any number of players)
// Returns { title, winners } where winners is a list of player indexes.
function decideResult(players, { prevTopScore = 0, madeBoard = false } = {}) {
  if (players.length === 1) {
    const { score } = players[0];
    let title = "Quiz Complete!";
    if (score > 0 && score > prevTopScore) title = "New High Score!";
    else if (madeBoard) title = "You Made the Leaderboard!";
    return { title, winners: [] };
  }
  const top = Math.max(...players.map((p) => p.score));
  const winners = players.map((p, i) => (p.score === top ? i : -1)).filter((i) => i >= 0);
  const title = winners.length === 1 ? `${players[winners[0]].name} Wins!` : "It's a Tie!";
  return { title, winners };
}

// ===== Leaderboard math =====
// Entries look like { id, name, score, length, date }.

// True if a saved leaderboard entry has everything needed to sort and show it.
function isValidEntry(e) {
  return (
    !!e &&
    typeof e.id === "string" &&
    typeof e.name === "string" &&
    Number.isFinite(e.score) &&
    e.score > 0 &&
    Number.isFinite(e.date)
  );
}

// Returns a sorted copy: higher score first; on a tie, the more recent score ranks higher.
function sortBoard(board) {
  return [...board].sort((a, b) => b.score - a.score || b.date - a.date);
}

// Adds a game's scores to a leaderboard and keeps only the top `size`.
// Scores of 0 are ignored and invalid old entries are dropped.
// Returns { board, newIds }: the new top list, and the ids of new entries that made it.
function mergeLeaderboard(board, entries, { now = Date.now(), idFn = makeId, size = LEADERBOARD_SIZE } = {}) {
  const added = entries
    .filter((e) => Number.isFinite(e.score) && e.score > 0)
    .map((e) => ({ id: idFn(), name: String(e.name), score: e.score, length: e.length, date: now }));
  const updated = sortBoard([...board.filter(isValidEntry), ...added]).slice(0, size);
  const kept = new Set(updated.map((e) => e.id));
  return { board: updated, newIds: added.filter((e) => kept.has(e.id)).map((e) => e.id) };
}

// Lets the Node unit tests load this file; ignored in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    POINTS, DIFFICULTIES, LENGTHS, MAX_PLAYERS, TIME_LIMIT, MAX_SPEED_BONUS, LEADERBOARD_SIZE,
    shuffle, makeId, isValidQuestion, buildQueue, timeRemaining, calculatePoints, scoreAnswer,
    createPlayer, applyAnswer, accuracy, decideResult, isValidEntry, sortBoard, mergeLeaderboard,
  };
}
