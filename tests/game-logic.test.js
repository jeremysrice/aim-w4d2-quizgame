// Unit tests for game-logic.js. Run with: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../game-logic.js");
const { QUESTION_BANK } = require("../questions.js");

// Repeatable "random" numbers so shuffles are the same every run.
function seededRandom(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Makes n simple valid questions for a difficulty.
function makeQuestions(prefix, n) {
  return Array.from({ length: n }, (_, i) => ({
    q: `${prefix} question ${i}`,
    choices: [`right ${i}`, `wrong a ${i}`, `wrong b ${i}`, `wrong c ${i}`],
    answer: 0,
  }));
}

function makeBank(n) {
  return { easy: makeQuestions("easy", n), medium: makeQuestions("medium", n), hard: makeQuestions("hard", n) };
}

// ----- calculatePoints -----
test("calculatePoints: base points plus up to +50% speed bonus", () => {
  assert.deepEqual(L.calculatePoints("easy", L.TIME_LIMIT), { base: 10, bonus: 5, total: 15 });
  assert.deepEqual(L.calculatePoints("medium", L.TIME_LIMIT / 2), { base: 20, bonus: 5, total: 25 });
  assert.deepEqual(L.calculatePoints("hard", 0), { base: 30, bonus: 0, total: 30 });
});

test("calculatePoints: unknown difficulty scores 0, not NaN", () => {
  assert.deepEqual(L.calculatePoints("impossible", 10), { base: 0, bonus: 0, total: 0 });
});

test("calculatePoints: clamps time left to 0..TIME_LIMIT", () => {
  assert.equal(L.calculatePoints("hard", 999).total, 45);
  assert.equal(L.calculatePoints("hard", -5).total, 30);
  assert.equal(L.calculatePoints("hard", NaN).total, 30);
});

// ----- timeRemaining (fix: timer uses real time, not tick counting) -----
test("timeRemaining: based on elapsed real time", () => {
  assert.equal(L.timeRemaining(1000, 1000), L.TIME_LIMIT);
  assert.equal(L.timeRemaining(1000, 6000), L.TIME_LIMIT - 5);
});

test("timeRemaining: a long gap (e.g. throttled background tab) still runs the clock out", () => {
  // Only one tick happened, but 20 real seconds passed: no time should be left.
  assert.equal(L.timeRemaining(0, 20000), 0);
});

test("timeRemaining: never above the limit, even if the clock looks backwards", () => {
  assert.equal(L.timeRemaining(5000, 1000), L.TIME_LIMIT);
});

// ----- scoreAnswer / applyAnswer (scoring separated from display) -----
const sampleItem = { difficulty: "medium", answer: 2, choices: ["a", "b", "c", "d"] };

test("scoreAnswer: correct answer earns points", () => {
  const r = L.scoreAnswer(sampleItem, 2, L.TIME_LIMIT);
  assert.equal(r.isCorrect, true);
  assert.equal(r.timedOut, false);
  assert.equal(r.total, 30);
});

test("scoreAnswer: wrong answer earns nothing", () => {
  const r = L.scoreAnswer(sampleItem, 1, 10);
  assert.deepEqual([r.isCorrect, r.timedOut, r.total], [false, false, 0]);
});

test("scoreAnswer: null choice is a timeout", () => {
  const r = L.scoreAnswer(sampleItem, null, 0);
  assert.deepEqual([r.isCorrect, r.timedOut, r.total], [false, true, 0]);
});

test("scoreAnswer: a correct answer that arrives after time is up counts as a timeout", () => {
  const r = L.scoreAnswer(sampleItem, 2, 0);
  assert.deepEqual([r.isCorrect, r.timedOut, r.total], [false, true, 0]);
});

test("applyAnswer: returns an updated copy and leaves the original alone", () => {
  const p = L.createPlayer("Sam");
  const outcome = L.scoreAnswer(sampleItem, 2, L.TIME_LIMIT);
  const p2 = L.applyAnswer(p, "medium", outcome);
  assert.equal(p.score, 0);
  assert.equal(p.byDifficulty.medium.total, 0);
  assert.equal(p2.score, 30);
  assert.equal(p2.correct, 1);
  assert.deepEqual(p2.byDifficulty.medium, { right: 1, total: 1 });
  const p3 = L.applyAnswer(p2, "hard", L.scoreAnswer({ difficulty: "hard", answer: 0 }, null, 0));
  assert.deepEqual(p3.byDifficulty.hard, { right: 0, total: 1 });
  assert.equal(L.accuracy(p3), 50);
});

// ----- decideResult -----
test("decideResult: single player titles", () => {
  const p = { ...L.createPlayer("A"), score: 50 };
  assert.equal(L.decideResult([p], { prevTopScore: 40 }).title, "New High Score!");
  assert.equal(L.decideResult([p], { prevTopScore: 90, madeBoard: true }).title, "You Made the Leaderboard!");
  assert.equal(L.decideResult([p], { prevTopScore: 90, madeBoard: false }).title, "Quiz Complete!");
  assert.equal(L.decideResult([{ ...p, score: 0 }], { prevTopScore: 0 }).title, "Quiz Complete!");
});

test("decideResult: winner and tie for multiple players", () => {
  const a = { ...L.createPlayer("Ann"), score: 70 };
  const b = { ...L.createPlayer("Bo"), score: 40 };
  assert.deepEqual(L.decideResult([a, b]), { title: "Ann Wins!", winners: [0] });
  assert.deepEqual(L.decideResult([a, { ...b, score: 70 }]), { title: "It's a Tie!", winners: [0, 1] });
  const c = { ...L.createPlayer("Cy"), score: 90 };
  assert.deepEqual(L.decideResult([a, b, c]), { title: "Cy Wins!", winners: [2] });
});

// ----- sortBoard -----
test("sortBoard: highest first, newer wins ties, input not modified", () => {
  const board = [
    { id: "a", name: "A", score: 50, date: 1 },
    { id: "b", name: "B", score: 90, date: 2 },
    { id: "c", name: "C", score: 50, date: 3 },
  ];
  const copy = JSON.parse(JSON.stringify(board));
  assert.deepEqual(L.sortBoard(board).map((e) => e.id), ["b", "c", "a"]);
  assert.deepEqual(board, copy);
});

// ----- mergeLeaderboard (addToLeaderboard's math) -----
function idSequence() {
  let n = 0;
  return () => `id${++n}`;
}

test("mergeLeaderboard: keeps the top 5 and drops the lowest", () => {
  let board = [];
  const idFn = idSequence();
  [50, 80, 30, 90, 60].forEach((score, i) => {
    board = L.mergeLeaderboard(board, [{ name: `p${score}`, score }], { now: i, idFn }).board;
  });
  assert.deepEqual(board.map((e) => e.score), [90, 80, 60, 50, 30]);

  const r = L.mergeLeaderboard(board, [{ name: "new", score: 70 }], { now: 10, idFn });
  assert.deepEqual(r.board.map((e) => e.score), [90, 80, 70, 60, 50]);
  assert.equal(r.newIds.length, 1);
});

test("mergeLeaderboard: a score too low to make it isn't reported as new", () => {
  const board = [90, 80, 70, 60, 50].map((score, i) => ({ id: `o${i}`, name: "x", score, date: i }));
  const r = L.mergeLeaderboard(board, [{ name: "low", score: 10 }], { now: 99, idFn: idSequence() });
  assert.deepEqual(r.newIds, []);
  assert.equal(r.board.length, 5);
});

test("mergeLeaderboard: tying 5th place pushes the older score off", () => {
  const board = [90, 80, 70, 60, 50].map((score, i) => ({ id: `o${i}`, name: "x", score, date: i }));
  const r = L.mergeLeaderboard(board, [{ name: "tie", score: 50 }], { now: 99, idFn: () => "new" });
  assert.deepEqual(r.newIds, ["new"]);
  assert.equal(r.board[4].id, "new");
});

test("mergeLeaderboard: ignores zero scores and drops damaged saved entries", () => {
  const damaged = [{ id: "ok", name: "A", score: 40, date: 1 }, { name: "no id", score: 99 }, null, { id: "x", name: "B", score: "lots", date: 2 }];
  const r = L.mergeLeaderboard(damaged, [{ name: "zero", score: 0 }, { name: "two", score: 20 }], { now: 5, idFn: idSequence() });
  assert.deepEqual(r.board.map((e) => e.score), [40, 20]);
  assert.equal(r.newIds.length, 1);
});

test("mergeLeaderboard: both players from one game can be added, with unique ids", () => {
  const r = L.mergeLeaderboard([], [{ name: "A", score: 40 }, { name: "B", score: 60 }]);
  assert.equal(r.newIds.length, 2);
  assert.notEqual(r.newIds[0], r.newIds[1]);
});

// ----- isValidQuestion -----
test("isValidQuestion: accepts good questions and rejects bad ones", () => {
  assert.equal(L.isValidQuestion({ q: "Q?", choices: ["a", "b", "c", "d"], answer: 3 }), true);
  assert.equal(L.isValidQuestion({ q: "", choices: ["a", "b"], answer: 0 }), false);
  assert.equal(L.isValidQuestion({ q: "Q?", choices: ["a", "A ", "c", "d"], answer: 0 }), false); // duplicate
  assert.equal(L.isValidQuestion({ q: "Q?", choices: ["a", "b", "c", "d", "e"], answer: 0 }), false); // too many
  assert.equal(L.isValidQuestion({ q: "Q?", choices: ["a", "b"], answer: 2 }), false); // bad index
  assert.equal(L.isValidQuestion(null), false);
});

test("every built-in question is valid, with enough for the longest 2-player game", () => {
  const longest = Math.max(...Object.values(L.LENGTHS)) * L.MAX_PLAYERS;
  L.DIFFICULTIES.forEach((d) => {
    assert.ok(QUESTION_BANK[d].every(L.isValidQuestion), `${d} has an invalid question`);
    assert.ok(QUESTION_BANK[d].length >= longest, `${d} has fewer than ${longest} questions`);
  });
});

// ----- buildQueue -----
test("buildQueue: 2-player standard game alternates turns, easy → hard, no shared questions", () => {
  const { queue, perDifficulty } = L.buildQueue(makeBank(12), 2, L.LENGTHS.standard, { random: seededRandom() });
  assert.equal(perDifficulty, 3);
  assert.equal(queue.length, 18);
  queue.forEach((item, i) => assert.equal(item.playerIndex, i % 2));

  const order = { easy: 0, medium: 1, hard: 2 };
  [0, 1].forEach((p) => {
    const mine = queue.filter((item) => item.playerIndex === p).map((item) => order[item.difficulty]);
    assert.deepEqual(mine, [...mine].sort((a, b) => a - b));
  });

  const p0 = new Set(queue.filter((x) => x.playerIndex === 0).map((x) => x.q));
  assert.ok(queue.filter((x) => x.playerIndex === 1).every((x) => !p0.has(x.q)));
});

test("buildQueue: the correct answer survives the choice shuffle", () => {
  const bank = makeBank(12);
  const { queue } = L.buildQueue(bank, 1, 4, { random: seededRandom(7) });
  queue.forEach((item) => {
    const n = item.q.match(/question (\d+)/)[1];
    assert.equal(item.choices[item.answer], `right ${n}`);
  });
});

test("buildQueue: short difficulty is topped up from the fallback bank", () => {
  const bank = makeBank(12);
  bank.hard = makeQuestions("hard", 3); // need 8 for a 2-player long game
  const fallback = { easy: [], medium: [], hard: makeQuestions("backup hard", 10) };
  const { queue, perDifficulty } = L.buildQueue(bank, 2, 4, { fallbackBank: fallback, random: seededRandom() });
  assert.equal(perDifficulty, 4);
  assert.equal(queue.filter((x) => x.difficulty === "hard").length, 8);
});

test("buildQueue: shortens the game evenly instead of crashing when questions run out", () => {
  const bank = makeBank(12);
  bank.medium = makeQuestions("medium", 5); // only 2 each for 2 players
  const { queue, perDifficulty } = L.buildQueue(bank, 2, 4, { random: seededRandom() });
  assert.equal(perDifficulty, 2);
  assert.equal(queue.length, 2 * 2 * 3);
  assert.ok(queue.every(Boolean), "queue has an empty slot");
});

test("buildQueue: skips invalid questions", () => {
  const bank = makeBank(4);
  bank.easy.push({ q: "broken", choices: ["same", "same"], answer: 0 });
  const { queue } = L.buildQueue(bank, 1, 4, { random: seededRandom() });
  assert.ok(!queue.some((x) => x.q === "broken"));
});

test("buildQueue: throws a clear error only when there are no questions at all", () => {
  assert.throws(() => L.buildQueue({ easy: [], medium: [], hard: [] }, 1, 3), /Not enough questions/);
});

test("buildQueue: real built-in bank supports every length for 2 players", () => {
  Object.values(L.LENGTHS).forEach((n) => {
    const { queue } = L.buildQueue(QUESTION_BANK, 2, n);
    assert.equal(queue.length, n * 3 * 2);
  });
});
