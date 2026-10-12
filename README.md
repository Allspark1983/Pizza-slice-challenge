# Pizza Slice Rush — Version 3

**Repository:** [Allspark1983/Pizza-slice-challenge](https://github.com/Allspark1983/Pizza-slice-challenge), branch **`main`**.

A **solo 60-second game** built with HTML, CSS, plain JavaScript, and a Node.js REST API. Slice one pizza at a time, avoid temporary grenades, and try to beat your personal best **score**. The API judges cuts, applies points and penalties, and decides the final result.

## How to play

1. Add or choose your solo profile and start a run.
2. Wait for **3, 2, 1**. At **Go**, one continuous **60-second** clock begins.
3. Follow the guides with full straight cuts through the pizza's centre. Use a mouse, touch, or pen, or aim with the keyboard angle control and choose **Make cut**.
4. Complete the pizza to earn **10 points**. The next random pizza appears immediately, with no new preparation countdown.
5. Avoid the grenade when one appears. It temporarily blocks one guide: cut other guides first or wait until it disappears.
6. Keep playing for the full minute. At zero, your final score is compared with the personal best saved when the run started.

| Event | Score change | What happens next |
| --- | --- | --- |
| Complete all required cuts on a pizza. | **+10** | Completed-pizza count increases and a new pizza appears. |
| Make a wrong completed cut. | **−5** | That pizza is spoiled and replaced. |
| Swipe through an active grenade. | **−10** | Grenade-hit count increases and the pizza is replaced; there is no extra wrong-cut deduction. |

**Your score never goes below zero.** Every completion or penalty keeps the same minute running. Short/outside strokes and repeated correct cuts normally have no effect. Grenades are checked first, so a swipe through an active grenade can cost points even when it would otherwise be an incomplete or duplicate cut.

## Pizza sizes and equal slices

| Whole pizza | Equal slices required | Full diameter cuts |
| --- | --- | --- |
| **14 inches** | **8** | **4**, spaced 45° apart. |
| **10 inches** | **6** | **3**, spaced 60° apart. |
| **8 inches** | **4** | **2**, spaced 90° apart. |

A **diameter** passes from one side through the centre to the opposite side. Each full diameter follows two opposite slice boundaries, so four evenly spaced diameter cuts create eight equal wedges. The server chooses each pizza's size and guide rotation.

## Increasing difficulty

Difficulty changes for **new pizzas** at 20 and 40 seconds of playing time. A pizza already on screen keeps its original guides and tolerance until it is replaced.

| Level | Playing time when the pizza appears | Angle tolerance | Grenade chance per new pizza | Grenade visible for |
| --- | --- | --- | --- | --- |
| **1** | Before 20 seconds. | 10° | 15% | 1.6 seconds. |
| **2** | From 20 to before 40 seconds. | 8° | 30% | 1.9 seconds. |
| **3** | From 40 seconds onward. | 6° | 50% | 2.2 seconds. |

Level 1 gives each size an equal chance. At level 2, the probabilities for **14 / 10 / 8 inches** are **50% / 30% / 20%**; at level 3 they are **65% / 25% / 10%**. Larger pizzas need more cuts. Centre tolerance stays **0.12 of the pizza radius** at every level.

An active grenade sits on one guide and disappears after its short timer. The first pizza's grenade cannot become active before **Go**. A swipe that hits it is judged by the server's clock. Stale pizza actions, canceled gestures, preparation, and an expired run do not cause grenade damage.

## Your personal-best result

The game shows **“Beat your best: N”**, where N is your best score when the run began. The API reports:

- **Won:** your final score is **strictly higher** than that starting best.
- **Lost:** your final score is equal to or below it.

Beating the record during play does not end the run. Later penalties can reduce the final score. For example, if your best was 40, reaching 50 and then losing 10 points leaves 40: that tied final score does not beat the record.

The completed-pizza count is a separate statistic. `bestScore` and `bestPizzaCount` update independently after a run finishes; completing more pizzas does not automatically mean a higher score after penalties.

## Open and run in GitHub Codespaces

1. Open [Allspark1983/Pizza-slice-challenge](https://github.com/Allspark1983/Pizza-slice-challenge) on **`main`**.
2. Choose **Code → Codespaces → Create codespace on main** and wait for the editor.
3. Type this into the terminal and press Enter:

   ```text
   npm start
   ```

4. Leave the terminal running. Open **Ports → 3000 → Open in Browser**.

Keep the forwarded port **Private**, since the app has no sign-in system. **No `npm install` is needed.** The project uses built-in Node.js modules and browser features. It requires **Node.js 22 or newer**, supplied by the included Codespaces configuration. Press **Ctrl+C** to stop the server.

### Update your existing Codespace

Stop the server with **Ctrl+C**. Run `git status` and confirm you are in this repository, on **`main`**, with a clean working tree. Preserve and review any local changes before pulling.

With a clean working tree, run:

```text
git pull --ff-only origin main
npm start
```

Refresh the browser. If the pull cannot fast-forward, review the branch difference before continuing. Version 3 starts fresh Rush profiles in `.data/rush.json`; the earlier `.data/game.json` is retained separately.

### Run a ZIP locally

With Node.js 22 or newer installed, extract the source ZIP and open a terminal in the folder containing `package.json` and `server.js`. Run `npm start`, then open `http://localhost:3000`. GitHub's **Code → Download ZIP** provides the files from the selected branch.

## Profiles provide the assignment's CRUD actions

Profiles sit in a secondary panel so the solo game remains the main screen.

| CRUD | User action | API |
| --- | --- | --- |
| **Create** | Add a profile. | `POST /api/players` |
| **Read** | View saved profiles and personal records. | `GET /api/players` |
| **Update** | Rename a profile. | `PATCH /api/players/:id` |
| **Delete** | Delete a profile and its associated runs. | `DELETE /api/players/:id` |

A public profile has `id`, `name`, `runsPlayed`, `runsWon`, `runsLost`, `bestScore`, `bestPizzaCount`, and `totalPizzasCompleted`. Results and totals are settled once when a run ends. Name edits preserve the profile's identity and progress.

## How the REST API works

The browser sends actions and displays the API's **`{ run, player, feedback }`** response. The server chooses pizzas and hazards, checks time and geometry, applies score changes, and decides the final result. The browser cannot submit its own score, outcome, pizza size, or time.

| Method and path | Request body | Purpose |
| --- | --- | --- |
| `GET /api/players` | None. | Read solo profiles. |
| `POST /api/players` | `{ "name": "Adzan" }` | Add a profile. |
| `PATCH /api/players/:id` | `{ "name": "Adzan M" }` | Rename a profile. |
| `DELETE /api/players/:id` | None. | Delete a profile and its runs. |
| `POST /api/runs` | `{ "playerId": "player-id", "requestId": "unique-start-id" }` | Start or resume an active run. |
| `GET /api/runs/:id` | None. | Read the current run and reconcile its deadline. |
| `POST /api/runs/:id/cuts` | `requestId`, `pizzaId`, `start: { x, y }`, `end: { x, y }`. | Submit a stroke for the current pizza. |

The **request ID** identifies an action for safe retry. The **pizza ID** identifies which pizza that action belongs to. A delayed cut for a replaced pizza is ignored, so it cannot damage the next pizza. Retry an uncertain action using the identical request ID, pizza ID, and body.

Coordinates use centre **(0, 0)** and pizza radius **1**. Points are finite numbers from −3 to 3. Names contain 1–24 characters after trimming; request IDs contain 1–100. The server retains all active runs and the latest 100 finished runs, with up to 2,000 retained start/cut request IDs per run. Retry protection applies while that history remains. Reaching the request cap does not stop the clock or prevent final settlement.

### Small request example

```javascript
async function sendCutExample(runId, pizzaId, requestId, start, end) {
  const response = await fetch(`/api/runs/${runId}/cuts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, pizzaId, start, end })
  });

  if (!response.ok) throw new Error("The action could not be checked.");
  return response.json();
}
```

`JSON.stringify()` converts the action to JSON text; `response.json()` reads the server's JSON as JavaScript data. The app contains the complete input, recovery, and rendering flow.

## Timing, recovery, and storage

The three-second preparation is outside the minute. Completing or spoiling a pizza never restarts the clock. The server advances time **before** accepting a cut, so actions processed at or after the deadline cannot change the score. Network and server-queue delays affect when an action is processed.

Refreshing, switching tabs, or restarting the server does not pause or reset the saved run. Starting again for the same profile resumes its active run. After a connection problem, retry/recover the existing action and read the server's result. Profile changes are disabled while a run or uncertain action is active.

Players and runs are saved together in **`.data/rush.json`** through atomic updates. Version 3 does not overwrite or silently migrate the older **`.data/game.json`**. New Rush profiles and records begin fresh; the older game's file stays separate.

Runtime data is excluded from Git. The same Codespace retains its data across restarts; another Codespace has separate records. Download the relevant data file before deleting a Codespace if you want to keep those records. This is a casual solo game, not an anti-cheat system.

## Files to read while learning

| File | What it does |
| --- | --- |
| `index.html` | Game board, score, timer, controls, and profile panel. |
| `style.css` | Layout, feedback, hazard appearance, and reduced-motion/mobile styling. |
| `script.js` | Input, REST requests, recovery, and rendering server state. |
| `game.js` | Run rules, geometry, score penalties, grenade collision, and difficulty. |
| `game-rules.json` | 60,000 ms run, 3,000 ms preparation, and the three pizza mappings. |
| `server.js` | API routes, validation, atomic storage, and exactly-once result settlement. |
| `test/` | Automated game-rule and API/storage checks. |
| `ASSESSMENT.md` | Requirement mapping, browser checklist, and explanation practice. |

`SCORE_RULES` and `DIFFICULTY_LEVELS` are constants in `game.js`. The UI can read them for labels; the API awards points. The server loads and validates JSON settings at startup, so restart it after a permitted configuration change. Existing runs keep their rules and deadline snapshot.

## Verification and later code changes

**Version 3 verification:** `npm run check` passes and `npm test` passes **42 of 42 tests**: **25 shared game-rule tests and 17 API/storage tests**, with **zero failures and zero skipped tests**. An HTTP smoke check also passes. Static checks confirm the interface's DOM/ARIA targets, local assets, and imported game helpers are present. Browser playtesting and layout checks have not been performed here; automated and static checks do not replace those observations.

Run these commands from the project folder:

```text
npm run check
npm test
```

After editing code, inspect and save the intended changes:

```text
git status
git add .
git commit -m "Improve Pizza Slice Rush Version 3"
git push origin main
```

Use the running Node server's URL to play. Opening `index.html` directly or using GitHub Pages alone cannot run this API. If port 3000 is busy, stop the earlier server with Ctrl+C before starting this one.
