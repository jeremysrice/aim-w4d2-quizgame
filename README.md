# Quiz Clash

A quiz game for one or two players, built with plain HTML, CSS and JavaScript (no frameworks). Questions go from easy to medium to hard, and harder questions are worth more points.

**▶ Play it live: https://jeremysrice.github.io/aim-w4d2-quizgame/**

## Features

- **Live questions that refresh every 30 minutes:** new questions come from the free [Open Trivia Database](https://opentdb.com) (no API key). They're cached in the browser and swapped for a new set every 30 minutes, or right away with the **Get new questions now** button. A game in progress isn't affected; new questions start with the next game. If the device is offline or the API can't be reached, the game uses the built-in questions in `questions.js`.
- **Difficulty-weighted scoring:** easy questions are worth 10 points, medium 20 and hard 30. Each game goes from easy to hard.
- **Speed bonus:** each question has a 15-second timer. Answering faster earns up to 50% bonus points. Running out of time counts as a wrong answer.
- **1 or 2 players:** in two-player mode, players take turns on one device, and each player gets different questions.
- **Score tracking:** a live scoreboard during play, and results showing each player's accuracy at each difficulty.
- **Top 5 leaderboard:** saved in the browser with `localStorage`. Higher scores push lower ones off the board, and dropped scores are deleted.
- **Game lengths:** Short (6 questions per player), Standard (9) or Long (12).
- **Phone and tablet friendly:** large touch targets, support for notched screens, and layouts for small phones, phones in landscape and tablets.
- **Keyboard shortcuts:** press `A`–`D` or `1`–`4` to answer and `Enter` to go to the next question.

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
| `questions.js` | Built-in backup questions, sorted into easy, medium and hard |
| `trivia-api.js` | Fetches live questions from Open Trivia DB, caches them and refreshes every 30 minutes |
| `script.js` | Game state, turn order, scoring, timer and leaderboard |

## Customizing

- **Change the refresh interval:** edit `QUESTION_REFRESH_MS` in `trivia-api.js`.
- **Add backup questions:** add entries to the `easy`, `medium` or `hard` lists in `questions.js`. Each entry looks like `{ q, choices: [4 options], answer: indexOfCorrectChoice }`. Each difficulty needs at least 8 questions for a two-player Long game.
- **Change point values:** edit `POINTS` in `script.js`.
- **Turn off the speed bonus:** set `MAX_SPEED_BONUS = 0` in `script.js`.
- **Change the timer:** edit `TIME_LIMIT` (in seconds) in `script.js`.
