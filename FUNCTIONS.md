# Quiz Clash: Function and Section Reference

A plain-English guide to every section and function in the game's JavaScript. For each function it describes what the function does and where it could break. All the logic is in two files:

- **`script.js`**: the game (setup, questions, scoring, timer, results and leaderboard)
- **`trivia-api.js`**: live questions from the Open Trivia Database, including caching and the 30-minute refresh

`questions.js` contains only the built-in backup questions (data), so it isn't covered here.

> **Load order matters:** the page must load `questions.js`, then `trivia-api.js`, then `script.js`. Each file uses things defined in the files loaded before it.

---

## `script.js`

### Section: Config
Game-wide settings: points per difficulty, the order of difficulties, questions per game length, the timer length, the size of the speed bonus, and the leaderboard's storage key and size. On load it also deletes the old single-high-score key from earlier versions.

**Where it could break**
- If the browser blocks storage (some privacy modes, or cookies turned off), touching `localStorage` here throws an error. The whole script then stops, and the game never starts.
- Setting a game length higher than 4 needs more questions than the question bank is guaranteed to have (see `buildQueue`).
- If the time limit is set to 0, the scoring and timer-bar math divides by zero.

### Section: State
A single object holding everything that changes during a game: the players and their stats, the list of questions, which question is showing, whether it's been answered, the time left, the timer's id and the last game's settings.

**Where it could break**
- Any code can change it directly. Nothing checks it is still valid, so one bad update (for example, the current-question number going past the end of the list) leads to crashes later.

### Section: DOM
A shortcut for finding a page element by its id, plus references to the three screens: setup, quiz and results.

#### `$`
Looks up a page element by its id.
- **Could break:** if an id in `index.html` is renamed or removed, it returns `null`, and the next line that uses the element crashes with a "cannot read properties of null" error.

### Section: Helpers
Small general-purpose functions used throughout the game.

#### `showScreen`
Hides every screen, shows the named one and scrolls to the top.
- **Could break:** a misspelled screen name crashes. The jump to the top can also feel abrupt on long pages.

#### `shuffle`
Returns a randomly reordered copy of a list, leaving the original unchanged (a Fisher–Yates shuffle).
- **Could break:** the shuffling is pseudo-random, which is fine for a game but not secure. It won't break in normal use.

#### `escapeHTML`
Makes text safe to display, so player names and answers can't add their own HTML to the page.
- **Could break:** it's only safe for text that appears between HTML tags. If it were reused to build an HTML attribute value, quotation marks would not be escaped.

### Section: Leaderboard
Keeps a Top 5 list of `{ id, name, score, length, date }` in the browser's storage. Only the top 5 are kept; anything pushed below 5th place is deleted.

#### `getLeaderboard`
Reads the leaderboard from storage. Returns an empty list if it's missing or corrupted.
- **Could break:** it only checks that the saved data is a list. If the entries themselves are malformed (for example, edited by hand), a missing score or date makes sorting unreliable.

#### `saveLeaderboard`
Writes the leaderboard to storage.
- **Could break:** nothing catches errors here. If storage is full or blocked, the error escapes into `showResults`, and **the results screen never appears**.

#### `sortBoard`
Puts higher scores first; on a tie, the more recent score ranks higher.
- **Could break:** it reorders the list it's given instead of making a copy, which could surprise future code. Entries with a missing or non-numeric date make tied scores sort unpredictably.

#### `qualifiesForLeaderboard`
Says whether a score would earn a place on the current leaderboard. Ties with 5th place count, and the newer score wins.
- **Could break:** it judges each score against the old board on its own. In a two-player game, both players can "qualify" when only one place is left. This only affects the result title, not the saved data.

#### `addToLeaderboard`
Adds new scores, re-sorts, keeps the top 5 and deletes the rest. Returns which new entries made it, so they can be highlighted.
- **Could break:** new entries are identified and ordered by the device clock. If the clock is wrong or changes, tie-breaking order and highlighting can be off. It also inherits the storage problem described under `saveLeaderboard`.

#### `renderLeaderboard`
Draws the leaderboard on the page with rank circles, names, game length, dates and a NEW tag on just-added scores. Shows a placeholder when the list is empty.
- **Could break:** passing the wrong list id crashes it. Dates are formatted in the viewer's local style, so they look different on different devices.

### Section: Setup
Reads the setup form and builds a game from it.

#### `readSettings`
Reads the player count, game length and names from the setup screen. Blank names default to "Player 1" and "Player 2".
- **Could break:** if the HTML ever has no selected player-count or length option, it crashes. Names aren't checked for duplicates, so two players called "Sam" are hard to tell apart.

#### `buildQueue`
Builds the game's question list. Each player gets their own questions of each difficulty, in order from easy to hard, with the answer choices shuffled. In two-player games, turns alternate between the players.
- **Could break:**
  - It assumes there are enough questions. If a difficulty has fewer than (players × questions per difficulty), the second player comes up short, an empty slot gets into the list, and **the game crashes when it reaches that question**. Today a guaranteed minimum of 8 per difficulty protects against this, but raising the Long length or removing built-in questions would break it.
  - It finds the correct answer by its text after shuffling. If an API question had two identical choices, the wrong one could be marked correct.

#### `startGame`
Resets all scores and stats, builds the question list, switches to the quiz screen and shows the first question. Called with the previous settings, it replays the same setup.
- **Could break:** if it were attached directly to a button (without the wrapper the code uses now), the browser would pass the click event in as the "settings", and the game would crash.

### Section: Quiz
Shows questions, runs the timer and scores answers.

#### `renderScoreboard`
Draws each player's name and score, and outlines the player whose turn it is.
- **Could break:** very little; long names are cut off with "…" by the styling.

#### `renderQuestion`
Shows the current question: progress bar, difficulty badge, whose turn it is, category, question text and A–D answer buttons. Then starts the timer.
- **Could break:** if the current question slot is empty (see `buildQueue`), it crashes immediately. Questions with more than 4 choices would get blank letter labels, because only A–D exist.

#### `startTimer`
Starts the countdown, ticking every 0.1 seconds. Reaching zero counts as a wrong answer.
- **Could break:** the timer counts ticks instead of measuring real time. Browsers slow timers down in background tabs, so **a player can switch tabs to slow the clock and keep a bigger speed bonus**. Small rounding errors also build up over the 15 seconds.

#### `stopTimer`
Stops the countdown.
- **Could break:** safe to call repeatedly; no known issues.

#### `updateTimerBar`
Shrinks the timer bar to match the time left. It's green above 50%, amber at 50% or less, and red at 20% or less.
- **Could break:** if the timer-bar element is renamed in the HTML, it crashes on every tick.

#### `calculatePoints`
Base points for the difficulty, plus a speed bonus based on the time left (up to +50%).
- **Could break:** a difficulty missing from the points table gives `NaN` (not a number) points, which then spreads into the player's score.

#### `handleAnswer`
Handles a tap, click, key press or timeout. It locks the buttons, colours the right answer green and a wrong pick red, updates the score and stats, shows feedback, and reveals Next (or See Results on the last question). Repeat calls for the same question are ignored.
- **Could break:** everything depends on the "already answered" flag. If future code reset that flag in the wrong place, one answer could be scored twice. Older Safari versions ignore the smooth-scroll and focus options, which is harmless, but Next may not scroll into view there.

#### `isGameOver`
Returns true once every question has been played.
- **Could break:** no known issues.

#### `nextQuestion`
Moves to the next question, or to the results after the last one.
- **Could break:** it moves forward without checking whether the question was answered. Calling it some other way (a new shortcut, for example) could skip questions.

### Section: Results

#### `showResults`
Ends the game. It saves scores to the leaderboard, picks a title ("New High Score!", "You Made the Leaderboard!", a winner, or "It's a Tie!") and shows each player's score, accuracy and results by difficulty.
- **Could break:** if saving to storage fails, it stops before drawing anything (see `saveLeaderboard`). The two-player logic assumes exactly two players; it would need rewriting for three or more.

### Section: Events
Connects every button and input to the functions above. This covers showing or hiding the Player 2 name box, the Start, Next, Play Again, Main Menu and Clear leaderboard buttons, closing the phone keyboard with Enter, and the A–D and 1–4 keyboard shortcuts.

**Where it could break**
- The shortcuts don't ignore modifier keys, so pressing Ctrl+1 to switch browser tabs also answers "A".
- Some embedded browsers (inside other apps) block confirmation pop-ups, so "Clear leaderboard" silently does nothing there.

### Section: Question source status
The status line on the setup screen showing where questions come from (live or built-in) and when the next refresh is due.

#### `formatMinutes`
Turns a length of time into friendly text like "12 min" or "less than a minute".
- **Could break:** if the device clock changes, negative times show as "less than a minute" instead of something accurate.

#### `renderQuestionStatus`
Updates the status line from the live-question status in `trivia-api.js`, and disables "Get new questions now" while a fetch is running.
- **Could break:** it depends on `trivia-api.js` loading first. If the script order changes, it crashes on startup. If a fetch never finishes (see `fetchDifficulty`), the button stays disabled until the page is reloaded.

### Section: Startup
Shows the saved leaderboard and starts loading and refreshing live questions.

**Where it could break**
- The status-line listener must be registered before auto-refresh starts, or the first status update is missed. The current order is correct and should be kept.

---

## `trivia-api.js`

### Section: Live question source (file overview)
Gets fresh questions from the Open Trivia Database (free, no key), saves them in the browser and refreshes them every 30 minutes. Falls back to the built-in questions when offline or if the API fails.

### Section: Config
The API address, the 30-minute refresh interval, the 5-minute retry after a failure, the number of questions fetched per difficulty (20), the minimum needed for a game (8), the gap between requests (5.5 seconds) and the storage key.

**Where it could break**
- The 5.5-second gap assumes the API's current limit of one request every 5 seconds per IP address. If the API tightens that limit, every refresh fails.
- If the minimum is ever lower than what the longest two-player game needs, `buildQueue` can crash.

### Section: State
The live-question status: the current questions, where they came from, when they were fetched, when the next refresh is due, whether a fetch is running, the last error, and the functions to notify when anything changes.

**Where it could break**
- It's shared with `script.js` by name, so another script using the same name would overwrite it.

### Section: Helpers

#### `wait`
Pauses for a given time; used to space out requests to the API.
- **Could break:** no known issues.

#### `notifyQuestionListeners`
Tells every registered function that the question status changed.
- **Could break:** if one of those functions throws an error, the rest aren't notified. Because this also runs during the clean-up step of `refreshQuestions`, the error is reported as unhandled.

#### `onQuestionSourceChange`
Registers a function to be called whenever the question status changes.
- **Could break:** nothing stops the same function being registered twice, so it would run twice.

#### `getActiveBank`
Returns the questions the next game should use: the live set, topped up with built-in questions if any difficulty came back short, or the built-in set if nothing live is loaded.
- **Could break:** the top-up always uses the first few built-in questions, so those repeat more often. If `questions.js` fails to load, it crashes.

### Section: Cache

#### `loadQuestionCache`
Loads previously fetched questions from browser storage, so live questions are available as soon as the page opens. Deletes a corrupted cache.
- **Could break:** it only checks that the saved data has questions and a fetch time. A cache saved by an older version in a different format could get through; `getActiveBank` softens this by topping up. If the device clock is set backwards, an old cache can look fresh and stop refreshes.

#### `saveQuestionCache`
Saves the current live questions and their fetch time to browser storage.
- **Could break:** if storage is full or blocked, the error is caught by `refreshQuestions` and treated as a failed download. The new questions are already in use, but **the status line wrongly says the refresh failed** and retries in 5 minutes, causing unnecessary requests.

### Section: Fetching

#### `normalizeApiQuestion`
Converts one API question into the game's format: question, choices, correct answer and category. It decodes the API's URL-encoded text and shortens category names like "Entertainment: Film" to "Film".
- **Could break:** decoding throws an error on badly encoded text, and that error fails the **whole difficulty**, not just one question. If the API renames or drops a field, every question fails.

#### `fetchDifficulty`
Fetches 20 multiple-choice questions of one difficulty. If the API is busy with rate limiting, it waits and retries, up to 3 attempts in total. Any other error is passed on to `refreshQuestions`.
- **Could break:**
  - **No timeout.** If the API never responds, the fetch hangs forever, the "fetching" status never clears, the refresh button stays disabled, and no more refreshes happen until the page is reloaded.
  - If the API stops allowing requests from other websites, or changes its response codes, every fetch fails (the game falls back to the built-in questions).

#### `refreshQuestions`
Fetches new easy, medium and hard sets, one request at a time spaced 5.5 seconds apart. On success it switches to the new set, saves it and schedules the next refresh in 30 minutes. On failure or when offline, it keeps the current questions and retries in 5 minutes.
- **Could break:**
  - **All or nothing:** if hard questions fail after easy and medium succeeded, all three sets are thrown away.
  - **Rate limits are per IP address:** several tabs, or many players on one network (like a school or office), fetch at the same time and block each other. Some players get the built-in questions until a retry succeeds. This happened during testing.
  - The browser's "online" flag only means a network is connected, not that the API can be reached.

### Section: Auto-refresh

#### `checkQuestionRefresh`
Starts a fetch if the next refresh time has passed and no fetch is running.
- **Could break:** it depends on the device clock. Changing the clock can trigger an early refresh or delay one.

#### `startQuestionAutoRefresh`
Runs once on page load. It loads cached questions and fetches new ones if the cache is missing or more than 30 minutes old. After that it checks every minute, when the tab becomes visible again, and when the device comes back online.
- **Could break:** calling it more than once would double up all the checks. It must run after the status line has been registered as a listener, or the first update is missed.

---

## Highest-risk issues

| Risk | Where | Effect |
| --- | --- | --- |
| Browser storage blocked or full | Config, `saveLeaderboard`, `saveQuestionCache` | The game doesn't start, results never appear, or a false "refresh failed" message |
| No timeout on API requests | `fetchDifficulty` | Live questions stop refreshing; the refresh button stays disabled |
| Timer counts ticks, not real time | `startTimer` | Players can switch tabs to slow the clock and get a bigger speed bonus |
| Not enough questions for the game length | `buildQueue` | Crash partway through a game |
| Rate limit shared per IP address | `refreshQuestions` | Players on one network fall back to the built-in questions |
| All-or-nothing refresh | `refreshQuestions` | One failed difficulty throws away the other two new sets |
