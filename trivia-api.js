// ===== Live question source =====
// Pulls fresh questions from the Open Trivia Database (https://opentdb.com, free, no key),
// caches them in browser storage, and refreshes them every 30 minutes.
// Falls back to the built-in QUESTION_BANK (questions.js) when offline or if the API fails.
// Depends on: storage.js (safeStorage), questions.js (QUESTION_BANK),
// game-logic.js (DIFFICULTIES, isValidQuestion).

// ===== Config =====
// Kept in one object so tests can shorten the waits.
const TRIVIA_CONFIG = {
  apiUrl: "https://opentdb.com/api.php",
  refreshMs: 30 * 60 * 1000, // fetch a new set every 30 minutes
  retryAfterFailureMs: 5 * 60 * 1000, // try again in 5 min if a fetch fails (or only partly works)
  waitForOtherTabMs: 60 * 1000, // re-check after 1 min if another tab is already fetching
  questionsPerDifficulty: 20, // how many to fetch per difficulty (API max is 50)
  apiGapMs: 5500, // Open Trivia DB allows 1 request per 5 seconds per IP
  requestTimeoutMs: 10 * 1000, // give up on a request after 10 seconds
  maxAttempts: 3, // tries per difficulty when rate-limited
  cacheKey: "quizClashQuestionCache", // storage key for cached questions
  cacheVersion: 2, // bump when the cache format changes; older caches are ignored
  lockName: "quizClash-question-refresh", // cross-tab lock so only one tab fetches at a time
};

// ===== State =====
// Current status of the live questions. script.js reads this to show the status line.
const questionSource = {
  bank: null, // { easy: [], medium: [], hard: [] } — null means "use built-in"
  source: "built-in", // "live" | "built-in"
  fetchedAt: 0, // when the current live set was fetched (ms timestamp)
  nextRefreshAt: 0, // when the next fetch is due (ms timestamp)
  loading: false, // true while this tab is fetching
  error: null, // null | "offline" | "failed"
  partial: false, // true if the last refresh only got some difficulties
  started: false, // true once startQuestionAutoRefresh has run
  listeners: [], // functions to call whenever any of the above changes
};

// ===== Helpers =====

// Returns a promise that resolves after ms milliseconds (used to space out API calls).
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Calls every registered listener so the UI can update after a change.
// Each listener is isolated, so one failing can't stop the others.
function notifyQuestionListeners() {
  questionSource.listeners.forEach((fn) => {
    try {
      fn(questionSource);
    } catch (err) {
      console.error("Question status listener failed:", err);
    }
  });
}

// Registers a function to be called whenever the question source changes.
// Registering the same function twice has no effect.
function onQuestionSourceChange(fn) {
  if (!questionSource.listeners.includes(fn)) questionSource.listeners.push(fn);
}

// Returns the questions the next game should use: the live list for each
// difficulty that has one, otherwise the built-in list. buildQueue tops up
// any difficulty that's still short from the built-in questions.
function getActiveBank() {
  const live = questionSource.bank || {};
  const bank = {};
  DIFFICULTIES.forEach((d) => {
    bank[d] = live[d] && live[d].length ? live[d] : QUESTION_BANK[d];
  });
  return bank;
}

// ===== Cache =====

// Loads previously fetched questions from storage (if any) so the game can
// use live questions immediately on page load. Ignores (and deletes) caches
// that are corrupted, from an older version, or dated in the future.
// Returns true if a usable cache was loaded.
function loadQuestionCache() {
  const cache = safeStorage.get(TRIVIA_CONFIG.cacheKey);
  if (!cache) return false;

  const now = Date.now();
  const looksValid =
    cache.version === TRIVIA_CONFIG.cacheVersion &&
    Number.isFinite(cache.fetchedAt) &&
    cache.fetchedAt <= now + 60 * 1000 && // a future date means the clock changed: treat as stale
    cache.bank &&
    typeof cache.bank === "object";

  // Keep only well-formed questions, per difficulty.
  const bank = {};
  if (looksValid) {
    DIFFICULTIES.forEach((d) => {
      const list = Array.isArray(cache.bank[d]) ? cache.bank[d].filter(isValidQuestion) : [];
      if (list.length) bank[d] = list;
    });
  }
  if (!Object.keys(bank).length) {
    safeStorage.remove(TRIVIA_CONFIG.cacheKey);
    return false;
  }

  questionSource.bank = bank;
  questionSource.source = "live";
  questionSource.fetchedAt = cache.fetchedAt;
  questionSource.partial = !!cache.partial;
  questionSource.error = null;
  questionSource.nextRefreshAt =
    cache.fetchedAt + (cache.partial ? TRIVIA_CONFIG.retryAfterFailureMs : TRIVIA_CONFIG.refreshMs);
  return true;
}

// Saves the current live questions to storage. If storage is full or blocked
// this only logs a warning: the new questions are already in use either way,
// so it must not be treated as a failed refresh. Returns true if saved.
function saveQuestionCache() {
  const saved = safeStorage.set(TRIVIA_CONFIG.cacheKey, {
    version: TRIVIA_CONFIG.cacheVersion,
    bank: questionSource.bank,
    fetchedAt: questionSource.fetchedAt,
    partial: questionSource.partial,
  });
  if (!saved) console.warn("Questions loaded, but couldn't be saved for next time (storage full or blocked).");
  return saved;
}

// ===== Fetching =====

// Converts one API question into the game's format: { q, choices, answer, category }.
// The API text is URL-encoded, so each field is decoded. "Entertainment: " and
// "Science: " prefixes are trimmed from category names to keep them short.
// Returns null for a question that can't be decoded or isn't playable
// (for example duplicate choices), so one bad question doesn't sink the rest.
function normalizeApiQuestion(item) {
  try {
    const decode = (s) => decodeURIComponent(s);
    const question = {
      q: decode(item.question),
      choices: [decode(item.correct_answer), ...item.incorrect_answers.map(decode)],
      answer: 0, // correct answer is first; buildQueue shuffles choices
      category: decode(item.category || "").replace(/^(Entertainment|Science): /, ""),
    };
    return isValidQuestion(question) ? question : null;
  } catch {
    return null;
  }
}

// Fetches a URL and reads its JSON body, giving up after ms milliseconds.
// The timeout covers both the response and reading the body, so a stalled
// connection can't hang forever. Returns { ok, status, data }.
async function fetchJsonWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = res.ok ? await res.json() : null;
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// Fetches multiple-choice questions of one difficulty. If the API says we're
// rate-limited, waits (a little longer each time) and retries, up to
// maxAttempts in total. Throws on timeouts and other errors.
async function fetchDifficulty(difficulty, attempt = 1) {
  const url =
    `${TRIVIA_CONFIG.apiUrl}?amount=${TRIVIA_CONFIG.questionsPerDifficulty}` +
    `&difficulty=${difficulty}&type=multiple&encode=url3986`;
  const { ok, status, data } = await fetchJsonWithTimeout(url, TRIVIA_CONFIG.requestTimeoutMs);

  // HTTP 429 or response_code 5 = rate limited: wait, then try again.
  const rateLimited = status === 429 || (data && data.response_code === 5);
  if (rateLimited && attempt < TRIVIA_CONFIG.maxAttempts) {
    await wait(TRIVIA_CONFIG.apiGapMs * attempt);
    return fetchDifficulty(difficulty, attempt + 1);
  }
  if (!ok) throw new Error(`HTTP ${status}`);
  if (!data || data.response_code !== 0) throw new Error(`API response code ${data && data.response_code}`);

  const questions = (data.results || []).map(normalizeApiQuestion).filter(Boolean);
  if (!questions.length) throw new Error("No usable questions in response");
  return questions;
}

// Fetches each difficulty in turn (spaced apiGapMs apart to respect the rate
// limit). A failure on one difficulty doesn't stop the others.
// Returns { fetched: { difficulty: questions }, failed: [difficulty, ...] }.
async function fetchAllDifficulties() {
  const fetched = {};
  const failed = [];
  for (let i = 0; i < DIFFICULTIES.length; i++) {
    const difficulty = DIFFICULTIES[i];
    if (i > 0) await wait(TRIVIA_CONFIG.apiGapMs);
    try {
      fetched[difficulty] = await fetchDifficulty(difficulty);
    } catch (err) {
      console.warn(`Could not fetch ${difficulty} questions:`, err);
      failed.push(difficulty);
    }
  }
  return { fetched, failed };
}

// Runs task only if no other tab is refreshing right now, using the browser's
// Web Locks API. Returns true if the task ran, false if another tab holds the
// lock. Runs the task without coordination when Web Locks can't be used:
// older browsers, pages opened straight from disk (file://, where Chrome's
// lock request never answers), or if the lock request throws.
async function withRefreshLock(task) {
  const locks = globalThis.navigator && globalThis.navigator.locks;
  const fromDisk = globalThis.location && globalThis.location.protocol === "file:";
  if (!locks || typeof locks.request !== "function" || fromDisk) {
    await task();
    return true;
  }

  let started = false;
  try {
    return await locks.request(TRIVIA_CONFIG.lockName, { ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      started = true;
      await task();
      return true;
    });
  } catch (err) {
    if (started) throw err; // the task itself failed; don't run it twice
    console.warn("Web Locks unavailable, refreshing without cross-tab coordination:", err);
    await task();
    return true;
  }
}

// Fetches a fresh set of questions and makes it the active bank.
//   - Only one tab fetches at a time; other tabs pick up its results through
//     the shared cache (see handleStorageEvent).
//   - Unless force is true (the "Get new questions now" button), it first
//     checks whether another tab already refreshed, and uses that instead.
//   - Difficulties that fetch successfully are kept even if others fail;
//     a partial refresh retries in 5 minutes to fill the gaps.
//   - If nothing could be fetched (or the device is offline), the current
//     questions stay and it retries in 5 minutes.
async function refreshQuestions({ force = false } = {}) {
  if (questionSource.loading) return; // this tab is already fetching
  if (globalThis.navigator && globalThis.navigator.onLine === false) {
    questionSource.error = "offline";
    questionSource.nextRefreshAt = Date.now() + TRIVIA_CONFIG.retryAfterFailureMs;
    notifyQuestionListeners();
    return;
  }

  const ran = await withRefreshLock(async () => {
    // Another tab may have just refreshed: use its questions instead of fetching again.
    if (!force && loadQuestionCache() && Date.now() < questionSource.nextRefreshAt) {
      notifyQuestionListeners();
      return;
    }

    questionSource.loading = true;
    questionSource.error = null;
    notifyQuestionListeners();

    try {
      const { fetched, failed } = await fetchAllDifficulties();
      const now = Date.now();
      if (!Object.keys(fetched).length) {
        questionSource.error = "failed";
        questionSource.nextRefreshAt = now + TRIVIA_CONFIG.retryAfterFailureMs;
        return;
      }
      // Keep new sets; difficulties that failed keep their previous live set (if any).
      questionSource.bank = { ...(questionSource.bank || {}), ...fetched };
      questionSource.source = "live";
      questionSource.fetchedAt = now;
      questionSource.partial = failed.length > 0;
      questionSource.nextRefreshAt =
        now + (failed.length ? TRIVIA_CONFIG.retryAfterFailureMs : TRIVIA_CONFIG.refreshMs);
      saveQuestionCache();
    } catch (err) {
      console.warn("Could not refresh questions:", err);
      questionSource.error = "failed";
      questionSource.nextRefreshAt = Date.now() + TRIVIA_CONFIG.retryAfterFailureMs;
    } finally {
      questionSource.loading = false;
      notifyQuestionListeners();
    }
  });

  // Another tab is fetching right now. Its results arrive through the shared
  // cache; check back in a minute in case that tab closes before finishing.
  if (!ran) {
    questionSource.nextRefreshAt = Date.now() + TRIVIA_CONFIG.waitForOtherTabMs;
    notifyQuestionListeners();
  }
}

// ===== Auto-refresh =====

// Fetches new questions if the next refresh time has passed and no fetch is running.
function checkQuestionRefresh() {
  if (!questionSource.loading && Date.now() >= questionSource.nextRefreshAt) {
    refreshQuestions();
  }
}

// When another tab saves new questions to the shared cache, use them here too.
function handleStorageEvent(event) {
  if (event.key === TRIVIA_CONFIG.cacheKey && loadQuestionCache()) {
    notifyQuestionListeners();
  }
}

// Called on page load. Registers onChange (if given) before anything else so
// it never misses the first update, loads cached questions, fetches new ones
// if the cache is missing or 30+ minutes old, then keeps checking every minute,
// when the tab becomes visible again, and when the device comes back online.
// Safe to call more than once: later calls only add the listener.
function startQuestionAutoRefresh(onChange) {
  if (onChange) onQuestionSourceChange(onChange);
  if (questionSource.started) return;
  questionSource.started = true;

  loadQuestionCache();
  notifyQuestionListeners();
  checkQuestionRefresh(); // fetch now if there's no cache or it's 30+ min old
  setInterval(checkQuestionRefresh, 60 * 1000);
  // Browsers throttle timers in background tabs, so re-check when the tab comes back.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkQuestionRefresh();
  });
  window.addEventListener("online", checkQuestionRefresh);
  window.addEventListener("storage", handleStorageEvent);
}

// Lets the Node unit tests load this file; ignored in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TRIVIA_CONFIG, questionSource, onQuestionSourceChange, getActiveBank,
    loadQuestionCache, saveQuestionCache, normalizeApiQuestion, fetchDifficulty,
    fetchAllDifficulties, refreshQuestions, handleStorageEvent,
  };
}
