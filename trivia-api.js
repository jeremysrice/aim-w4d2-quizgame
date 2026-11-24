// ===== Live question source =====
// Pulls fresh questions from the Open Trivia Database (https://opentdb.com, free, no key),
// caches them in localStorage, and refreshes them every 30 minutes.
// Falls back to the built-in QUESTION_BANK (questions.js) when offline or if the API fails.

const TRIVIA_API_URL = "https://opentdb.com/api.php";
const QUESTION_REFRESH_MS = 30 * 60 * 1000; // 30 minutes
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000; // try again in 5 min if a fetch fails
const QUESTIONS_PER_DIFFICULTY = 20;
const MIN_PER_DIFFICULTY = 8; // enough for a 2-player Long game (4 each)
const API_GAP_MS = 5500; // Open Trivia DB allows 1 request per 5 seconds per IP
const QUESTION_CACHE_KEY = "quizClashQuestionCache";

const questionSource = {
  bank: null, // { easy: [], medium: [], hard: [] } — null means "use built-in"
  source: "built-in", // "live" | "built-in"
  fetchedAt: 0,
  nextRefreshAt: 0,
  loading: false,
  error: null,
  listeners: [],
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function notifyQuestionListeners() {
  questionSource.listeners.forEach((fn) => fn(questionSource));
}

function onQuestionSourceChange(fn) {
  questionSource.listeners.push(fn);
}

// The bank the next game should use. Live questions are topped up with
// built-in ones if a difficulty came back short.
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

// ----- Cache -----
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

function saveQuestionCache() {
  localStorage.setItem(
    QUESTION_CACHE_KEY,
    JSON.stringify({ bank: questionSource.bank, fetchedAt: questionSource.fetchedAt })
  );
}

// ----- Fetching -----
function normalizeApiQuestion(item) {
  const decode = (s) => decodeURIComponent(s);
  return {
    q: decode(item.question),
    choices: [decode(item.correct_answer), ...item.incorrect_answers.map(decode)],
    answer: 0, // correct answer is first; buildQueue shuffles choices
    category: decode(item.category).replace(/^(Entertainment|Science): /, ""),
  };
}

async function fetchDifficulty(difficulty, attempt = 1) {
  const url = `${TRIVIA_API_URL}?amount=${QUESTIONS_PER_DIFFICULTY}&difficulty=${difficulty}&type=multiple&encode=url3986`;
  const res = await fetch(url);
  if (!res.ok && res.status !== 429) throw new Error(`HTTP ${res.status}`);
  const data = res.ok ? await res.json() : { response_code: 5 };

  // response_code 5 = rate limited: wait and retry once.
  if (data.response_code === 5 && attempt < 3) {
    await wait(API_GAP_MS);
    return fetchDifficulty(difficulty, attempt + 1);
  }
  if (data.response_code !== 0) throw new Error(`API response code ${data.response_code}`);
  return data.results.map(normalizeApiQuestion);
}

async function refreshQuestions() {
  if (questionSource.loading) return;
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

function checkQuestionRefresh() {
  if (!questionSource.loading && Date.now() >= questionSource.nextRefreshAt) {
    refreshQuestions();
  }
}

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
