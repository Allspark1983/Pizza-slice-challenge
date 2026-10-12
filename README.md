# Pizza Slice Challenge

**GitHub repository:** [Allspark1983/Pizza-slice-challenge](https://github.com/Allspark1983/Pizza-slice-challenge), branch **`main`**.

A game built with **HTML, CSS, plain JavaScript, and a Node.js REST API**. A whole pizza appears, and you cut it into the requested number of equal slices. The server checks each cut and decides whether you win or lose.

## How to play

1. Add or choose a player and start a round.
2. The server randomly chooses the pizza size and rotates its guide lines. Get ready for **3, 2, 1**.
3. At **Go**, you have **20 seconds** to complete all the required cuts.
4. Draw a straight line from one side of the pizza, through its centre, to the opposite side, following a guide. Use a mouse, touch, or pen. You can also choose an angle with the keyboard control and press **Make cut**.
5. Complete every required guide before the deadline to win. The REST API returns the result, and the page displays it.

| Whole pizza size | Equal slices required | Full cuts through the centre |
| --- | --- | --- |
| **14 inches** | **8 slices** | **4 cuts**, spaced 45° apart. |
| **10 inches** | **6 slices** | **3 cuts**, spaced 60° apart. |
| **8 inches** | **4 slices** | **2 cuts**, spaced 90° apart. |

A **diameter** goes all the way across a circle through its centre. Each complete diameter follows two opposite slice boundaries. Four evenly spaced diameter cuts therefore make eight equal wedges. Rotating the guides changes where to cut while preserving the spacing.

A completed cut outside the permitted guide/centre tolerance loses the round. An incomplete stroke or a stroke outside the pizza is ignored. Repeating a correct cut already accepted does not add another cut or cause a loss.

The geometry check allows some drawing inaccuracy: **up to 10°** from a guide and **0.12 of the pizza radius** from the centre. An accepted stroke counts as that guide's diameter cut.

The preparation countdown is excluded from your finish time. The server owns the 20-second deadline: a cut processed by the server at or after it loses. Refreshing or switching tabs does not reset or pause that deadline. Returning to the same player's active round resumes its existing state.

## Player profiles and leaderboards

Players keep their own wins, losses, and best winning times. **Each pizza size has its own leaderboard**, so an 8-inch result is compared with other 8-inch results. Lower successful times rank first; players without a best time for that size follow. Ties use more total wins, then fewer total losses, then player name.

The public player record includes `id`, `name`, `roundsWon`, `roundsLost`, and `bestTimesBySize`. That last object has keys `"8"`, `"10"`, and `"14"`; each value is a best finish in milliseconds or `null` if there is no winning time for that size.

This is a casual game for people using the same server's records. Times use when a cut is **processed by the server**, so network and server-queue delays are included. The server checks submitted geometry and its own deadline; the game is not an anti-cheat system.

| CRUD action | What the user does |
| --- | --- |
| **Create** | Add a player. |
| **Read** | View players, results, and a pizza size's leaderboard. |
| **Update** | Edit a player's name. The server also updates progress after judging a round. |
| **Delete** | Remove a player and their stored progress. |

All four assessment CRUD actions operate on **player records**.

## Open and run in GitHub Codespaces

1. Open [Allspark1983/Pizza-slice-challenge](https://github.com/Allspark1983/Pizza-slice-challenge) and select **`main`**.
2. Choose **Code → Codespaces → Create codespace on main**. Wait for the editor and terminal.
3. Type this command into the terminal and press Enter:

   ```text
   npm start
   ```

4. Leave that terminal running. Open **Ports**, find **3000**, and choose **Open in Browser**.

Keep the forwarded port **Private**, since the app has no sign-in system. **No `npm install` is needed**: the project uses built-in Node.js modules and browser features. It requires **Node.js 22 or newer**; the included development-container configuration sets up the intended Codespaces environment.

Press **Ctrl+C** in the terminal to stop the server.

### Run from a ZIP on your computer

Install Node.js 22 or newer, extract the project ZIP, and open a terminal in the folder containing `package.json` and `server.js`. Run `npm start`, then visit `http://localhost:3000`. On GitHub, **Code → Download ZIP** on `main` provides a source copy. Extract it before running the files.

### Update this project's existing Codespace

Stop the server with **Ctrl+C**. Run `git status` and confirm that you are in **pizza-slice-challenge**, on **`main`**, with a clean working tree. Preserve and review any local changes before pulling.

With a clean working tree, run:

```text
git pull --ff-only origin main
npm start
```

Refresh the browser. If the pull cannot fast-forward, review the branch difference before continuing. The ignored `.data/game.json` remains in the same Codespace.

## Files and their jobs

| File or folder | Purpose |
| --- | --- |
| `index.html` | Player form, pizza board, controls, countdown, verdict, and leaderboards. |
| `style.css` | Layout, colours, guides, feedback, and mobile styling. |
| `script.js` | Pointer/keyboard input, drawing, rendering, and asynchronous API requests. |
| `game.js` | Rule validation, round state, time checks, cut geometry, and leaderboard sorting. |
| `game-rules.json` | Pizza sizes/slices, 3,000 ms preparation, and a 20,000 ms playing limit. |
| `server.js` | REST routes, server-chosen rounds, validation, and game-state storage. |
| `package.json` | `npm start`, `npm test`, and `npm run check` commands. |
| `test/` | Automated game-rule and API tests. |
| `ASSESSMENT.md` | Requirement mapping, manual checks, and oral practice. |
| `.devcontainer/devcontainer.json` | The Codespaces development environment. |
| `.gitignore` | Excludes runtime data and other files that should not be committed. |

For learning, read **`index.html` → `style.css` → `script.js` → `game.js` → `server.js`**. Follow one user action through the files before studying another.

In `script.js`, `handlePlayerSubmit` handles the player form. `handlePointerDown`, `handlePointerMove`, and `handlePointerUp` capture drawing; `submitKeyboardCut` converts the chosen angle into a stroke. `performRoundAction` handles round API actions, while `renderClock` updates the countdown and controls and `renderPizza` displays the pizza and guides. The leaderboard uses `renderPlayers(sortPlayersByBestTime(players, leaderboardSize))`.

The server validates `game-rules.json` at startup and serves that same settings snapshot to the browser. After editing game settings, restart the server to apply them consistently. Existing saved rounds retain their original preparation period and deadline.

## How the REST API decides the result

The browser sends **actions**: create a round or submit a cut's start and end points. The server chooses the pizza and guides, records the round's start/deadline, checks geometry and time, and returns **`{ round, player, feedback }`**. The browser displays that response.

The browser does not submit its own win, loss, finish time, or pizza size. Player PATCH requests edit the name only; they cannot award wins or change best times. A returned round's `status` is `countdown`, `playing`, `won`, or `lost`.

### Routes

Replace `:id` with an actual player or round ID, as appropriate.

| Method and path | Purpose | Request body |
| --- | --- | --- |
| `GET /api/players` | Read players and progress. | None. |
| `POST /api/players` | Add a player. | `{ "name": "Adzan" }` |
| `PATCH /api/players/:id` | Edit a name. | `{ "name": "Adzan M" }` |
| `DELETE /api/players/:id` | Delete a player. | None. |
| `POST /api/rounds` | Start a round or resume the player's active round. | `{ "playerId": "player-id", "requestId": "unique-start-request-id" }` |
| `GET /api/rounds/:id` | Read the server's current round state and verdict. | None. |
| `POST /api/rounds/:id/cuts` | Submit a cut for judging. | `requestId`, `start: { x, y }`, and `end: { x, y }`. |

Every new start/cut action uses a unique **request ID**. A retry reuses that ID and the original payload so that a request is not applied twice. Starting again for a player with an active round resumes it instead of granting another deadline. The server retains all active rounds and the latest **100 finished rounds**; retry protection applies while the relevant history is retained.

Coordinates use the pizza centre as **(0, 0)** and its radius as **1**. Point values must be finite numbers from **−3 to 3**. Names are trimmed and contain **1–24 characters**; request IDs contain **1–100 characters** after trimming.

A new round returns **201**; a resumed/retried round, round read, or cut response returns **200**. Errors return `{ "error": "message" }`: **400** for invalid input, **404** for a missing resource, and **409** for a duplicate name, a start-request ID reused for another player, or a retained cut-request ID reused on another round. The API also bounds body size and request history; exceeding the round's 500 retained request IDs returns **429**.

### A small cut-request example

Here, `start` and `end` are coordinate objects produced by drawing or the angle controls. The app handles the complete interaction and error flow.

```javascript
async function sendCutExample(roundId, requestId, start, end) {
  const response = await fetch(`/api/rounds/${roundId}/cuts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, start, end })
  });

  if (!response.ok) {
    throw new Error("The cut could not be checked.");
  }

  return response.json();
}
```

`JSON.stringify()` turns an action object into JSON text. `response.json()` reads the server's response as JavaScript data, including the round, player progress, and feedback to display.

## Where data is saved

The server stores **players and rounds together in `.data/game.json`**. Updates are saved atomically, so the related round state and player result are written together. This runtime file is excluded from Git commits.

This separate project starts with **fresh player data**. It does not automatically import the earlier Pizza Collector leaderboard. In the same Codespace, saved players, results, and rounds survive a server restart. An active round retains its original deadline; time spent away still counts.

Git commits save source code, not `.data/game.json`. A different Codespace has separate data. Download that file before deleting a Codespace if you want to keep its game records.

## Checks and common issues

Run these commands from the project folder:

```text
npm run check
npm test
```

**Slice Challenge validation:** `npm run check` passed with exit code 0. `npm test` passed all **29 tests**: **15 shared game-rule tests and 14 API/storage tests**, with **0 failures and 0 skipped**. Source checks also resolved all **55 DOM selectors** without duplicate IDs or broken labels/ARIA references. Browser gameplay, pointer/touch controls, keyboard controls, and mobile rendering have **not been checked manually here**.

| What you see | What to check |
| --- | --- |
| The page or API does not load. | Confirm `npm start` is running and open forwarded port 3000. |
| `package.json` cannot be found. | Use the folder containing `package.json`. |
| The port is already in use. | Stop the earlier server with Ctrl+C and start the intended project. |
| A cut is ignored. | Check that playing has started and the stroke crosses the whole pizza. |
| A complete cut loses. | Follow a guide through the centre and finish before the server deadline. |
| A request fails. | Restore the connection, retry the same action with its original request ID, and check the server's current state. |
| Refreshing does not provide another 20 seconds. | The existing round retains its server-recorded deadline. |
| Opening `index.html` directly does not run the game. | Start Node and use its URL. GitHub Pages alone cannot run this API. |

## Save later changes to GitHub

From this repository's `main` branch, check and save your changes:

```text
npm run check
npm test
git status
git add .
git commit -m "Improve Pizza Slice Challenge"
git push origin main
```

Read `git status` before committing to confirm the branch and changed files. If nothing changed, no new commit is needed. GitHub handles authentication in Codespaces.

## Useful GitHub documentation

- [Set up a Node.js project for Codespaces](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/setting-up-your-nodejs-project-for-codespaces)
- [Forward ports in a Codespace](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)
