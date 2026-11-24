// Unit tests for trivia-api.js, using a fake fetch (no real network calls).
// Run with: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSafeStorage } = require("../storage.js");
const gameLogic = require("../game-logic.js");
const { QUESTION_BANK } = require("../questions.js");

// trivia-api.js expects these as globals, like in the browser.
Object.assign(globalThis, gameLogic, { QUESTION_BANK });
let fakeNavigator = { onLine: true };
Object.defineProperty(globalThis, "navigator", { get: () => fakeNavigator, configurable: true });

function fakeLocalStorage({ failWrites = false } = {}) {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (failWrites && !k.startsWith("__quizClash")) throw new Error("QuotaExceededError");
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
  };
}
globalThis.safeStorage = createSafeStorage(() => fakeLocalStorage());

const api = require("../trivia-api.js");
const { TRIVIA_CONFIG, questionSource } = api;

// Failure-path tests log expected warnings; keep the test output clean.
console.warn = () => {};

// No real waiting in tests.
TRIVIA_CONFIG.apiGapMs = 0;
TRIVIA_CONFIG.requestTimeoutMs = 50;
// Most tests ask the API for the same level as the game tier; the
// easier-mapping test below sets its own.
const EASIER_MAPPING = TRIVIA_CONFIG.apiDifficulty;
TRIVIA_CONFIG.apiDifficulty = { easy: "easy", medium: "medium", hard: "hard" };

// An API question, URL-encoded like the real API sends it.
function apiQuestion(text) {
  const enc = encodeURIComponent;
  return {
    category: enc("Entertainment: Film"),
    question: enc(text),
    correct_answer: enc(`${text} right`),
    incorrect_answers: [enc(`${text} w1`), enc(`${text} w2`), enc(`${text} w3`)],
  };
}

// A fake fetch. `behavior(difficulty)` returns "ok", "error", "ratelimit" or "hang".
function installFetch(behavior) {
  const calls = [];
  globalThis.fetch = (url, { signal } = {}) => {
    const difficulty = new URL(url).searchParams.get("difficulty");
    calls.push(difficulty);
    const mode = behavior(difficulty, calls.length);
    if (mode === "hang") {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }
    if (mode === "error") return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    if (mode === "ratelimit") return Promise.resolve({ ok: true, status: 200, json: async () => ({ response_code: 5, results: [] }) });
    const results = Array.from({ length: 5 }, (_, i) => apiQuestion(`${difficulty} ${i}`));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ response_code: 0, results }) });
  };
  return calls;
}

function reset({ storage = fakeLocalStorage() } = {}) {
  Object.assign(questionSource, {
    bank: null, source: "built-in", fetchedAt: 0, nextRefreshAt: 0,
    loading: false, error: null, partial: false,
  });
  globalThis.safeStorage = createSafeStorage(() => storage);
  fakeNavigator = { onLine: true };
}

// ----- normalizeApiQuestion -----
test("normalizeApiQuestion: decodes text and shortens the category", () => {
  const q = api.normalizeApiQuestion(apiQuestion("What's 2 + 2?"));
  assert.equal(q.q, "What's 2 + 2?");
  assert.equal(q.choices[q.answer], "What's 2 + 2? right");
  assert.equal(q.category, "Film");
});

test("normalizeApiQuestion: badly encoded or duplicate-choice questions are skipped, not fatal", () => {
  assert.equal(api.normalizeApiQuestion({ ...apiQuestion("x"), question: "%E0%A4%A" }), null);
  assert.equal(api.normalizeApiQuestion({ ...apiQuestion("x"), incorrect_answers: ["x%20right", "a", "b"] }), null);
  assert.equal(api.normalizeApiQuestion({ question: "no answers" }), null);
});

// ----- Fix 2: request timeout -----
test("fetchDifficulty: a request that never answers times out instead of hanging", async () => {
  reset();
  installFetch(() => "hang");
  const started = Date.now();
  await assert.rejects(api.fetchDifficulty("easy"), /aborted/);
  assert.ok(Date.now() - started < 1000, "took too long to time out");
});

test("refreshQuestions: a hung request doesn't leave the app stuck in 'fetching'", async () => {
  reset();
  installFetch(() => "hang");
  await api.refreshQuestions();
  assert.equal(questionSource.loading, false);
  assert.equal(questionSource.error, "failed");
  assert.ok(questionSource.nextRefreshAt > Date.now(), "a retry should be scheduled");
});

test("fetchDifficulty: retries when rate-limited, then succeeds", async () => {
  reset();
  const calls = installFetch((d, n) => (n === 1 ? "ratelimit" : "ok"));
  const questions = await api.fetchDifficulty("easy");
  assert.equal(calls.length, 2);
  assert.equal(questions.length, 5);
});

// ----- Easier questions -----
test("refreshQuestions: game tiers use easier API levels, without repeating a question", async () => {
  reset();
  TRIVIA_CONFIG.apiDifficulty = EASIER_MAPPING;
  // The easy and medium tiers both ask for "easy"; the second answer repeats two questions.
  const answers = [["easy 0", "easy 1", "easy 2"], ["easy 0", "easy 1", "new 0", "new 1"], ["medium 0", "medium 1"]];
  const requested = [];
  globalThis.fetch = (url) => {
    requested.push(new URL(url).searchParams.get("difficulty"));
    const results = answers[requested.length - 1].map(apiQuestion);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ response_code: 0, results }) });
  };
  try {
    await api.refreshQuestions();
  } finally {
    TRIVIA_CONFIG.apiDifficulty = { easy: "easy", medium: "medium", hard: "hard" };
  }
  assert.deepEqual(requested, ["easy", "easy", "medium"]);
  assert.deepEqual(questionSource.bank.medium.map((x) => x.q), ["new 0", "new 1"]);
  assert.equal(questionSource.partial, false);
});

test("built-in questions: every tier still has at least 8 questions", () => {
  ["easy", "medium", "hard"].forEach((d) => assert.ok(QUESTION_BANK[d].length >= 8, d));
});

// ----- Fix 5a: keep partial results -----
test("refreshQuestions: keeps the difficulties that succeeded when one fails", async () => {
  reset();
  installFetch((d) => (d === "hard" ? "error" : "ok"));
  await api.refreshQuestions();
  assert.equal(questionSource.source, "live");
  assert.equal(questionSource.partial, true);
  assert.equal(questionSource.error, null);
  assert.equal(questionSource.bank.easy.length, 5);
  assert.equal(questionSource.bank.medium.length, 5);
  assert.equal(questionSource.bank.hard, undefined);
  // The failed difficulty falls back to built-in questions, and a retry comes sooner.
  assert.equal(api.getActiveBank().hard, QUESTION_BANK.hard);
  assert.ok(questionSource.nextRefreshAt - Date.now() <= TRIVIA_CONFIG.retryAfterFailureMs);
});

test("refreshQuestions: a failed difficulty keeps its previous live set", async () => {
  reset();
  installFetch(() => "ok");
  await api.refreshQuestions();
  const oldHard = questionSource.bank.hard;
  installFetch((d) => (d === "hard" ? "error" : "ok"));
  await api.refreshQuestions({ force: true });
  assert.equal(questionSource.bank.hard, oldHard);
});

test("refreshQuestions: full success is not partial and schedules the 30-minute refresh", async () => {
  reset();
  installFetch(() => "ok");
  await api.refreshQuestions();
  assert.equal(questionSource.partial, false);
  assert.ok(questionSource.nextRefreshAt - Date.now() > TRIVIA_CONFIG.retryAfterFailureMs);
});

test("refreshQuestions: total failure keeps built-in questions and schedules a retry", async () => {
  reset();
  installFetch(() => "error");
  await api.refreshQuestions();
  assert.equal(questionSource.source, "built-in");
  assert.equal(questionSource.error, "failed");
  assert.equal(api.getActiveBank().easy, QUESTION_BANK.easy);
});

// ----- Fix 1 (in this file): full storage isn't reported as a failed refresh -----
test("refreshQuestions: questions still load when storage is full, without a false 'failed' status", async () => {
  reset({ storage: fakeLocalStorage({ failWrites: true }) });
  installFetch(() => "ok");
  await api.refreshQuestions();
  assert.equal(questionSource.source, "live");
  assert.equal(questionSource.error, null);
});

// ----- Fix 5b: coordinate between tabs -----
test("refreshQuestions: skips fetching while another tab holds the refresh lock", async () => {
  reset();
  fakeNavigator = { onLine: true, locks: { request: (name, opts, cb) => cb(null) } }; // lock taken
  const calls = installFetch(() => "ok");
  await api.refreshQuestions();
  assert.equal(calls.length, 0);
  const wait = questionSource.nextRefreshAt - Date.now();
  assert.ok(wait > 0 && wait <= TRIVIA_CONFIG.waitForOtherTabMs);
});

test("refreshQuestions: still fetches if the Web Locks API throws", async () => {
  reset();
  fakeNavigator = { onLine: true, locks: { request: () => Promise.reject(new Error("SecurityError")) } };
  const calls = installFetch(() => "ok");
  await api.refreshQuestions();
  assert.equal(calls.length, 3);
  assert.equal(questionSource.source, "live");
});

test("refreshQuestions: skips Web Locks on file:// pages (Chrome never answers there)", async () => {
  reset();
  globalThis.location = { protocol: "file:" };
  fakeNavigator = { onLine: true, locks: { request: () => new Promise(() => {}) } }; // would hang forever
  const calls = installFetch(() => "ok");
  try {
    await api.refreshQuestions();
  } finally {
    delete globalThis.location;
  }
  assert.equal(calls.length, 3);
  assert.equal(questionSource.source, "live");
});

test("refreshQuestions: uses another tab's fresh questions instead of fetching again", async () => {
  const storage = fakeLocalStorage();
  reset({ storage });
  // Another tab saved a fresh set a moment ago.
  storage.setItem(TRIVIA_CONFIG.cacheKey, JSON.stringify({
    version: TRIVIA_CONFIG.cacheVersion,
    fetchedAt: Date.now() - 1000,
    partial: false,
    bank: { easy: [{ q: "from other tab", choices: ["a", "b", "c", "d"], answer: 0 }] },
  }));
  fakeNavigator = { onLine: true, locks: { request: (name, opts, cb) => cb({ name }) } }; // lock free
  const calls = installFetch(() => "ok");
  await api.refreshQuestions();
  assert.equal(calls.length, 0);
  assert.equal(questionSource.bank.easy[0].q, "from other tab");
});

test("handleStorageEvent: picks up questions another tab just saved", () => {
  const storage = fakeLocalStorage();
  reset({ storage });
  storage.setItem(TRIVIA_CONFIG.cacheKey, JSON.stringify({
    version: TRIVIA_CONFIG.cacheVersion,
    fetchedAt: Date.now(),
    bank: { hard: [{ q: "shared", choices: ["a", "b", "c", "d"], answer: 1 }] },
  }));
  api.handleStorageEvent({ key: TRIVIA_CONFIG.cacheKey });
  assert.equal(questionSource.source, "live");
  assert.equal(questionSource.bank.hard[0].q, "shared");
});

test("loadQuestionCache: ignores old-format, future-dated or empty caches", () => {
  const storage = fakeLocalStorage();
  reset({ storage });
  const good = { version: TRIVIA_CONFIG.cacheVersion, fetchedAt: Date.now(), bank: { easy: [{ q: "q", choices: ["a", "b"], answer: 0 }] } };
  [
    { ...good, version: 1 },
    { ...good, fetchedAt: Date.now() + 24 * 60 * 60 * 1000 },
    { ...good, bank: { easy: [{ q: "bad", choices: ["a", "a"], answer: 0 }] } },
  ].forEach((cache) => {
    storage.setItem(TRIVIA_CONFIG.cacheKey, JSON.stringify(cache));
    assert.equal(api.loadQuestionCache(), false);
  });
  storage.setItem(TRIVIA_CONFIG.cacheKey, JSON.stringify(good));
  assert.equal(api.loadQuestionCache(), true);
});

test("refreshQuestions: offline skips the fetch and schedules a retry", async () => {
  reset();
  fakeNavigator = { onLine: false };
  const calls = installFetch(() => "ok");
  await api.refreshQuestions();
  assert.equal(calls.length, 0);
  assert.equal(questionSource.error, "offline");
});
