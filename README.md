# Quiz Clash

A quiz game for one or two players, built with plain HTML, CSS and JavaScript (no frameworks). Questions go from easy to medium to hard, and harder questions are worth more points.

**▶ Play it live: https://jeremysrice.github.io/aim-w4d2-quizgame/**

## Features

- **Live questions that refresh every 30 minutes:** new questions come from the free [Open Trivia Database](https://opentdb.com) (no API key). They're cached in the browser and swapped for a new set every 30 minutes, or right away with the **Get new questions now** button. A game in progress isn't affected; new questions start with the next game. If the device is offline or the API can't be reached, the game uses the built-in questions in `questions.js`.
- **Difficulty-weighted scoring:** easy questions are worth 10 points, medium 20 and hard 30. Each game goes from easy to hard.
- **Speed bonus:** each question has a 60-second timer. Answering faster earns up to 50% bonus points. Running out of time counts as a wrong answer.
- **1 or 2 players:** in two-player mode, players take turns on one device, and each player gets different questions.
- **Score tracking:** a live scoreboard during play, and results showing each player's accuracy at each difficulty.
- **Top 5 leaderboard:** saved in the browser with `localStorage`. Higher scores push lower ones off the board, and dropped scores are deleted.
- **Game lengths:** Short (6 questions per player), Standard (9) or Long (12).
- **Phone and tablet friendly:** large touch targets, support for notched screens, and layouts for small phones, phones in landscape and tablets.
- **Keyboard shortcuts:** press `A`–`D` or `1`–`4` to answer and `Enter` to go to the next question. Browser shortcuts like Ctrl+1 are left alone.

## Run locally

No build step or install is needed. Clone the repo and open `index.html` in a browser:

```bash
git clone https://github.com/jeremysrice/aim-w4d2-quizgame.git
cd aim-w4d2-quizgame
```

## Project structure

| File | Purpose |
| --- | --- |
| `index.html` | Markup for the setup, quiz and results screens |
| `style.css` | Theme, responsive layout and phone/tablet breakpoints |
| `storage.js` | Safe wrapper for browser storage. If storage is blocked or full, the game keeps working instead of crashing |
| `questions.js` | Built-in backup questions, sorted into easy, medium and hard |
| `game-logic.js` | Game rules with no page code: settings, building a game, timing, scoring, results and leaderboard math |
| `trivia-api.js` | Fetches live questions from Open Trivia DB with request timeouts, partial results and cross-tab coordination; caches them and refreshes every 30 minutes |
| `script.js` | Page and display code: screens, buttons, timer display, results and leaderboard |
| `tests/` | Unit tests for the game rules, storage and live-question code |

The page loads the scripts in this order: `storage.js`, `questions.js`, `game-logic.js`, `trivia-api.js`, then `script.js`. Each file uses things defined in the ones loaded before it.

## Tests

The tests use Node's built-in test runner, so there's nothing to install. Node 18 or later is required. From the project folder, run:

```bash
npm test
```

You can also run `node --test` directly. The tests use fake network responses, so they never call the real trivia API.

## Customizing

- **Change point values:** edit `POINTS` in `game-logic.js`.
- **Turn off the speed bonus:** set `MAX_SPEED_BONUS = 0` in `game-logic.js`.
- **Change the timer:** edit `TIME_LIMIT` (in seconds) in `game-logic.js`.
- **Change the game lengths:** edit `LENGTHS` in `game-logic.js`. If a difficulty runs short of questions, the game is shortened evenly for everyone.
- **Make live questions harder or easier:** edit `apiDifficulty` in `TRIVIA_CONFIG` in `trivia-api.js`. By default each game tier uses one level easier from Open Trivia DB (easy and medium use its "easy" questions, hard uses its "medium" questions). Set it to `{ easy: "easy", medium: "medium", hard: "hard" }` for the original difficulty.
- **Change the refresh interval:** edit `refreshMs` in `TRIVIA_CONFIG` in `trivia-api.js`.
- **Add backup questions:** add entries to the `easy`, `medium` or `hard` lists in `questions.js`. Each entry looks like `{ q, choices: [2–4 options], answer: indexOfCorrectChoice }`. Choices must not repeat. Each difficulty should have at least 8 questions so a two-player Long game never has to be shortened; a test checks this.
