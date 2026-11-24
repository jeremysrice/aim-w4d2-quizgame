// ===== Live question source =====
// Pulls fresh questions from the Open Trivia Database (https://opentdb.com, free, no key),
// caches them in localStorage, and refreshes them every 30 minutes.
// Falls back to the built-in QUESTION_BANK (questions.js) when offline or if the API fails.

// ===== Config =====
const TRIVIA_API_URL = "https://opentdb.com/api.php";
const QUESTION_REFRESH_MS = 30 * 60 * 1000; // 30 minutes
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000; // try again in 5 min if a fetch fails
const QUESTIONS_PER_DIFFICULTY = 20; // how many to fetch per difficulty (API max is 50)
const MIN_PER_DIFFICULTY = 8; // enough for a 2-player Long game (4 each)
const API_GAP_MS = 5500; // Open Trivia DB allows 1 request per 5 seconds per IP
const QUESTION_CACHE_KEY = "quizClashQuestionCache"; // localStorage key for cached questions

// ===== State =====
// Current status of the live questions. script.js reads this to show the status line.
const questionSource = {
  bank: null, // { easy: [], medium: [], hard: [] } — null means "use built-in"
  source: "built-in", // "live" | "built-in"
  fetchedAt: 0, // when the current live set was fetched (ms timestamp)
  nextRefreshAt: 0, // when the next fetch is due (ms timestamp)
  loading: false, // true while a fetch is in progress
  error: null, // null | "offline" | "failed"
  listeners: [], // functions to call whenever any of the above changes
};

// ===== Helpers =====

// Returns a promise that resolves after ms milliseconds (used to space out API calls).
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Calls every registered listener so the UI can update after a change.
function notifyQuestionListeners() {
  questionSource.listeners.forEach((fn) => fn(questionSource));
}

// Registers a function to be called whenever the question source changes.
function onQuestionSourceChange(fn) {
  questionSource.listeners.push(fn);
}

// Returns the question bank the next game should use: live questions if
// loaded (topped up with built-in ones if a difficulty came back short),
// otherwise the built-in QUESTION_BANK.
function getActiveBank() {
  const live = questionSource.bank;
  if (!live) return QUESTION_BANK;
  const bank = {};
  ["easy", "medium", "hard"].forEach((d) => {
    const list = live[d] || [];
    bank[d] = list.length >= MIN_PER_DIFFICULTY
      ? list
      : [...list, ...QUESTION_BANK[d].slice(0, MIN_PER_DIFFICULTY - list.length)];
  });
  return bank;
}

// ===== Cache =====

// Loads previously fetched questions from localStorage (if any) so the game
// can use live questions immediately on page load. Clears a corrupted cache.
function loadQuestionCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(QUESTION_CACHE_KEY));
    if (cache && cache.bank && cache.fetchedAt) {
      questionSource.bank = cache.bank;
      questionSource.fetchedAt = cache.fetchedAt;
      questionSource.nextRefreshAt = cache.fetchedAt + QUESTION_REFRESH_MS;
      questionSource.source = "live";
    }
  } catch {
    localStorage.removeItem(QUESTION_CACHE_KEY);
  }
}

// Saves the current live questions and their fetch time to localStorage.
function saveQuestionCache() {
  localStorage.setItem(
    QUESTION_CACHE_KEY,
    JSON.stringify({ bank: questionSource.bank, fetchedAt: questionSource.fetchedAt })
  );
}

// ===== Fetching =====

// Converts one API question into the game's format: { q, choices, answer, category }.
// The API text is URL-encoded, so each field is decoded. "Entertainment: " and
// "Science: " prefixes are trimmed from category names to keep them short.
function normalizeApiQuestion(item) {
  const decode = (s) => decodeURIComponent(s);
  return {
    q: decode(item.question),
    choices: [decode(item.correct_answer), ...item.incorrect_answers.map(decode)],
    answer: 0, // correct answer is first; buildQueue shuffles choices
    category: decode(item.category).replace(/^(Entertainment|Science): /, ""),
  };
}

// Fetches QUESTIONS_PER_DIFFICULTY multiple-choice questions of one difficulty.
// If the API says we're rate-limited, waits and retries (up to 3 attempts total).
// Throws on any other error so refreshQuestions can fall back.
async function fetchDifficulty(difficulty, attempt = 1) {
  const url = `${TRIVIA_API_URL}?amount=${QUESTIONS_PER_DIFFICULTY}&difficulty=${difficulty}&type=multiple&encode=url3986`;
  const res = await fetch(url);
  if (!res.ok && res.status !== 429) throw new Error(`HTTP ${res.status}`);
  const data = res.ok ? await res.json() : { response_code: 5 };

  // response_code 5 (or HTTP 429) = rate limited: wait, then try again.
  if (data.response_code === 5 && attempt < 3) {
    await wait(API_GAP_MS);
    return fetchDifficulty(difficulty, attempt + 1);
  }
  if (data.response_code !== 0) throw new Error(`API response code ${data.response_code}`);
  return data.results.map(normalizeApiQuestion);
}

// Fetches a fresh set of easy, medium and hard questions (one request each,
// spaced API_GAP_MS apart) and makes it the active bank. On success, caches it
// and schedules the next refresh in 30 minutes. On failure (or when offline),
// keeps the current questions and schedules a retry in 5 minutes.
async function refreshQuestions() {
  if (questionSource.loading) return; // a fetch is already running
  if (navigator.onLine === false) {
    questionSource.error = "offline";
    questionSource.nextRefreshAt = Date.now() + RETRY_AFTER_FAILURE_MS;
    notifyQuestionListeners();
    return;
  }

  questionSource.loading = true;
  questionSource.error = null;
  notifyQuestionListeners();

  try {
    // Fetch one difficulty at a time to stay under the API's rate limit.
    const fresh = {};
    const difficulties = ["easy", "medium", "hard"];
    for (let i = 0; i < difficulties.length; i++) {
      if (i > 0) await wait(API_GAP_MS);
      fresh[difficulties[i]] = await fetchDifficulty(difficulties[i]);
    }
    questionSource.bank = fresh;
    questionSource.source = "live";
    questionSource.fetchedAt = Date.now();
    questionSource.nextRefreshAt = questionSource.fetchedAt + QUESTION_REFRESH_MS;
    saveQuestionCache();
  } catch (err) {
    console.warn("Could not fetch new questions:", err);
    questionSource.error = "failed";
    questionSource.nextRefreshAt = Date.now() + RETRY_AFTER_FAILURE_MS;
    // Keep whatever bank we already had (cached live questions or built-in).
  } finally {
    questionSource.loading = false;
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

// Called once on page load: loads cached questions, fetches new ones if the
// cache is missing or 30+ minutes old, then keeps checking every minute,
// when the tab becomes visible again, and when the device comes back online.
function startQuestionAutoRefresh() {
  loadQuestionCache();
  notifyQuestionListeners();
  checkQuestionRefresh(); // fetch now if there's no cache or it's 30+ min old
  setInterval(checkQuestionRefresh, 60 * 1000);
  // Browsers throttle timers in background tabs, so re-check when the tab comes back.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkQuestionRefresh();
  });
  window.addEventListener("online", checkQuestionRefresh);
}
