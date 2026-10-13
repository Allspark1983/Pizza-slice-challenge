# Pizza Slice Rush — Version 3.3

> **Want to publish the game online?** See [DEPLOYMENT.md](DEPLOYMENT.md) for the Railway setup, persistent leaderboard storage, and security considerations.

**Repository:** [Allspark1983/Pizza-slice-challenge](https://github.com/Allspark1983/Pizza-slice-challenge), branch **`main`**.

A **solo 60-second game** built with HTML, CSS, plain JavaScript, and a Node.js REST API. Version 3.3 brings the **player name, score, timer, and pizzas into one arcade game screen**. Enter your name before starting, slice the pizzas arriving from the left, and see your name in the leaderboard after the minute ends. The API judges cuts, applies points and penalties, and decides the final result. Your Version 3.1 and Version 3.2 profiles and records continue in this update.

## One arcade screen

The game has three views inside the same stage:

| View | What the player sees and does |
| --- | --- |
| **Before the game** | Enter a player name and choose **Start 60-second rush**. A trimmed, case-insensitive matching name reuses a saved profile; a new name creates one. Returning players can also choose a saved name. |
| **During the game** | See your name, score, minute timer, and pizza board together, with the current level and batch timing nearby. Cut pizzas while the score display updates from confirmed API results. |
| **After the game** | See your name, final score, personal-best result, and leaderboard, then choose **Play again** or **Change player**. |

The game screen displays information returned by the API. You do not need to open separate API pages to see points, player details, or the result. **Players** opens the profile-management dialog, **How to play** opens the rules, and **Keyboard blade** expands the accessible cutting controls.

## How to play

1. Enter your player name and choose **Start 60-second rush**. Returning players can reuse their saved name and personal record.
2. Wait for **3, 2, 1**. The first pizza slides in near the end of preparation. At **Go**, one continuous **60-second** clock begins.
3. Make a full straight cut through a pizza's centre. **Your first cut sets its orientation**; add equally spaced cuts to make the required slices. There are no guide lines or hidden required first angles.
4. Use a mouse, touch, or pen to swipe across the board; one stroke can affect several pizzas. For keyboard play, open **Keyboard blade**, choose a target pizza and an angle, then choose **Make cut**.
5. Finish each pizza before the batch's **five-second** timer expires. Avoid any grenade until it disappears. If you clear the board early, wait for the next scheduled batch.
6. Keep playing for the full minute. At zero, your final score is compared with the personal best saved when the run started, and the results view loads the leaderboard with your name and position.

| Event | Score change | What happens next |
| --- | --- | --- |
| Complete all required cuts on a pizza. | **+10** | Completed-pizza count increases and that pizza is removed. |
| Make a wrong completed cut. | **−5** | That pizza is spoiled and removed. |
| Swipe through an active grenade. | **−10** | Grenade-hit count increases and that pizza is removed; there is no extra wrong-cut deduction. |
| Leave a pizza unfinished when its batch expires. | **−5** | Missed-pizza count increases and that pizza is removed. |

**Your score never goes below zero.** Penalties apply per pizza, and every outcome keeps the same minute running. A multi-pizza swipe processes affected pizzas in the server's stored order. Short/outside strokes and repeated correct cuts normally have no effect. Grenades are checked first, so a swipe through an active grenade can cost points even when it would otherwise be an incomplete or duplicate cut.

## Sliding arrivals

Each batch moves in from the left over **450 milliseconds (0.45 seconds)**, then stays in its usual board positions. Pizzas, size labels, grenades, and the blade share the same moving frame.

The first entrance uses the final 450 milliseconds of preparation. Later entrances use the first 450 milliseconds of their existing five-second waves. **During playing time, you can cut while pizzas arrive.** Pressing down holds the batch's visible position steady through the gesture and any pending confirmation, while both clocks keep running. Once the gesture and any pending confirmation are finished, movement resumes at its scheduled phase.

Refreshing or receiving another response for the same wave does not replay its entrance. With **reduced motion** enabled, pizzas appear at their destination immediately. The slide changes presentation; scoring, wave deadlines, and the full-minute run remain the same.

## Pizza sizes and equal slices

| Whole pizza | Equal slices required | Full diameter cuts |
| --- | --- | --- |
| **Small: 10 inches** | **4** | **2**, spaced 90° apart. |
| **Medium: 12 inches** | **6** | **3**, spaced 60° apart. |
| **Large: 14 inches** | **8** | **4**, spaced 45° apart. |

A **diameter** passes from one side through the centre to the opposite side. Four evenly spaced diameter cuts create eight equal wedges. The first accepted cut chooses the orientation for that pizza. For example, a 12-inch pizza first cut at 20° needs the other diameters at 80° and 140°. Only confirmed cuts and your current blade are drawn.

The pizzas have visibly different sizes. Their displayed diameters and circumferences scale **10:12:14**; their radii are **30, 36, and 42** board units. Each size has an equal chance of appearing at every level.

## Five-second waves and increasing difficulty

A batch is called a **wave** in the code. Waves arrive at playing times **0, 5, 10, …, 55 seconds**, on a fixed schedule. Resolving a pizza does not replace it within that wave or bring the next wave forward.

| Level | Playing time | Pizzas per wave | Pizzas offered in this level |
| --- | --- | --- | --- |
| **1** | 0 to before 20 seconds. | **1** | 4 waves × 1 = **4**. |
| **2** | 20 to before 40 seconds. | **2** | 4 waves × 2 = **8**. |
| **3** | 40 to before 60 seconds. | **3** | 4 waves × 3 = **12**. |

That is **24 pizzas offered over 12 waves** in a full minute. Difficulty rises through quantity. Angle tolerance stays **10°** and centre tolerance stays **0.18 of the pizza radius**. A complete stroke must extend at least 0.8 radius to each side of the centre projection; it can begin or end far outside a pizza, allowing a single swipe through several pizzas.

Each pizza has a **20% grenade chance**. A grenade lasts **1.8 seconds from the wave's start**, then becomes harmless. The first wave's grenades cannot become active before **Go**. You can work on another pizza or use a safe cutting direction while waiting. Stale wave actions, canceled gestures, preparation, and an expired run do not cause grenade damage.

Every unfinished pizza costs 5 points at its wave deadline, including the final wave at **exactly 60 seconds**. The server checks deadlines before cuts. A late request catches up missed waves using their original times; it never grants a fresh five seconds or another minute.

## Your personal-best result

The game shows your personal-best target, using your current best score when the run began, including records carried forward from Versions 3.1 and 3.2. The API reports:

- **Won:** your final score is **strictly higher** than that starting best.
- **Lost:** your final score is equal to or below it.

Beating the record during play does not end the run. Later penalties can reduce the final score. For example, if your best was 40, reaching 50 and then losing 10 points leaves 40: that tied final score does not beat the record.

The completed-pizza count is a separate statistic. `bestScore` and `bestPizzaCount` update independently after a run finishes; completing more pizzas does not automatically mean a higher score after penalties. A previous Version 3.0 best is shown separately and is not the target for this changed game.

## End-of-game leaderboard

The leaderboard lists **each player's personal best**, while the results view shows **the score from the run you just finished** separately. A lower-scoring replay does not replace a better personal record. A player becomes eligible after completing at least one run, including a run with a final score of **0**.

The table shows the **top 10 players** and highlights your row when you are among them. If your rank is below the top 10, **Your place** shows your name, rank, and record beneath the table. Both use your profile ID, so renaming a profile does not detach its records.

Ranking is deterministic:

1. Higher `bestScore` first.
2. If scores tie, higher `bestPizzaCount` first.
3. If both tie, trimmed, lowercased player name in Unicode code-point order.
4. If those names also tie, player ID decides the order.

Ranks are consecutive positions: 1, 2, 3, and so on. `bestPizzaCount` is an independent personal record; it need not come from the run that produced `bestScore`.

This is a scoreboard for profiles stored on **the same running server**. Another Codespace or a separate local copy has its own records and leaderboard. It does not connect separate servers into a global multiplayer service.

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

Refresh the browser and check the **3.3** version badge beside the game title. If the pull cannot fast-forward, review the branch difference before continuing. Version 3.3 keeps your existing profiles, scores, and runs in `.data/rush-3.1.json`; this update does not reset them. If that file does not yet exist, the existing Version 3.0 profile import from `.data/rush.json` still applies.

### Run a ZIP locally

With Node.js 22 or newer installed, extract the source ZIP and open a terminal in the folder containing `package.json` and `server.js`. Run `npm start`, then open `http://localhost:3000`. GitHub's **Code → Download ZIP** provides the files from the selected branch.

## Profiles provide the assignment's CRUD actions

The name-entry screen creates or reuses a profile before starting. A secondary profile-management dialog keeps the assignment's complete CRUD actions available without taking space from the active game.

| CRUD | User action | API |
| --- | --- | --- |
| **Create** | Add a profile. | `POST /api/players` |
| **Read** | View saved profiles and personal records. | `GET /api/players` |
| **Update** | Rename a profile. | `PATCH /api/players/:id` |
| **Delete** | Delete a profile and its associated runs. | `DELETE /api/players/:id` |

A public profile has `id`, `name`, `runsPlayed`, `runsWon`, `runsLost`, `bestScore`, `bestPizzaCount`, `totalPizzasCompleted`, and `previousBestScore`. The current records continue from Versions 3.1 and 3.2; `previousBestScore` holds the imported Version 3.0 best, or `null` for a new profile. Results and totals are settled once when a run ends. Name edits preserve identity and progress. Entering a name selects a local game profile; it is not account authentication.

## How the REST API works

The browser sends actions and displays the API's **`{ run, player, feedback }`** response. The server creates scheduled waves, chooses pizza sizes and hazards, checks time and geometry, applies score changes, and decides the final result. The browser cannot submit its own score, outcome, pizza size, or time.

| Method and path | Request body | Purpose |
| --- | --- | --- |
| `GET /api/players` | None. | Read solo profiles. |
| `GET /api/leaderboard` | None. | Read ranked personal records for profiles with at least one completed run. |
| `POST /api/players` | `{ "name": "Adzan" }` | Add a profile. |
| `PATCH /api/players/:id` | `{ "name": "Adzan M" }` | Rename a profile. |
| `DELETE /api/players/:id` | None. | Delete a profile and its runs. |
| `POST /api/runs` | `{ "playerId": "player-id", "requestId": "unique-start-id" }` | Start or resume an active run. |
| `GET /api/runs/:id` | None. | Read the current run and reconcile wave/run deadlines. |
| `POST /api/runs/:id/cuts` | `requestId`, `waveId`, `start: { x, y }`, `end: { x, y }`. | Submit one board stroke for the current wave. |

`GET /api/leaderboard` returns a separate **`{ entries, totalPlayers }`** response. Each entry has `rank`, `playerId`, `name`, `bestScore`, `bestPizzaCount`, and `runsPlayed`. `totalPlayers` counts the eligible ranked profiles, and `entries` contains the full ranking; the browser chooses the top 10 and the current player's separate position when needed. The endpoint reconciles expired waves and runs inside the existing storage transaction before reading records, so a run that has just expired is settled before its leaderboard is returned. It introduces no new data file or stored leaderboard table.

The **request ID** identifies an action for safe retry. The **wave ID** identifies the batch it belongs to. A delayed stroke from an earlier wave cannot cut or damage new arrivals. Retry an uncertain action using the identical request ID, wave ID, and body. The server can apply that stroke to several pizzas in the wave.

The API uses the same fixed **board coordinates** as Version 3.1. The SVG board spans x = −150 to 150 and y = −140 to 140; input x/y values must be finite numbers from **−200 to 200**. The server supplies each pizza's position and radius. Pointer input uses the moving batch group's inverse screen matrix, `getScreenCTM().inverse()`, to map the visible pizza back to those fixed coordinates. Keyboard input uses `strokeForPizza` for its selected pizza.

Before sending a stroke, `clipStrokeToBounds` clips the **whole straight segment** to the permitted coordinate square, preserving its direction and angle. It does not move the two endpoints independently. The cut body remains `{ requestId, waveId, start, end }`, and recovery retains the exact clipped body for retry.

Names contain 1–24 characters after trimming; request IDs contain 1–100. The server retains all active runs and the latest 100 finished runs, with up to 2,000 retained start/cut request IDs per run. Retry protection applies while that history remains. Reaching the request cap does not stop wave expiry or final settlement.

### Small request example

```javascript
async function sendCutExample(runId, waveId, requestId, start, end) {
  const response = await fetch(`/api/runs/${runId}/cuts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, waveId, start, end })
  });

  if (!response.ok) throw new Error("The action could not be checked.");
  return response.json();
}
```

`JSON.stringify()` converts the action to JSON text; `response.json()` reads the server's JSON as JavaScript data. The app contains the complete input, recovery, and rendering flow.

## Timing, recovery, and storage

The three-second preparation is outside the minute. Each wave shares the original run clock. Before accepting a cut, the server expires any due waves, applies missed-pizza penalties, and settles the run if its minute has ended. A cut processed at or after the run deadline cannot change the settled score. Network and server-queue delays affect when an action is processed.

Refreshing, switching tabs, or restarting the server does not pause or reset the saved run. Starting again for the same profile resumes its active run. After a connection problem, retry/recover the existing action and read the server's result. Version 3.3 keeps the compatible Version 3.1 recovery session key and action bodies, also used by Version 3.2. Profile changes are disabled while a run or uncertain action is active.

If a response is lost while creating a player, the start form retains that exact name and offers **Check player & start**. It reads the saved profiles again before proceeding, so retrying can find the profile that was already created. The server also enforces case-insensitive name uniqueness. A failed leaderboard read has its own **Retry leaderboard** button; your confirmed final result remains available and you can still play again.

Players and runs remain together in **`.data/rush-3.1.json`** through atomic updates. Existing scores, profile IDs, and runs continue through the new interface. The leaderboard is derived from those saved profiles. If that file is missing, the server imports valid profile IDs, names, and previous best scores from **`.data/rush.json`**, when available, with new current-mode records starting at zero. Version 3.0 runs are not imported, and the entire older file stays untouched.

The import is saved once, so a later rename or deletion is not undone by importing again. If neither data file exists, begin by creating a profile. Invalid saved data produces an error instead of silently resetting records.

Runtime data is excluded from Git. The same Codespace retains its data across restarts; another Codespace has separate records. Download the relevant data file before deleting a Codespace if you want to keep those records. This is a casual solo game, not an anti-cheat system.

## Files to read while learning

| File | What it does |
| --- | --- |
| `index.html` | Name entry, arcade stage and HUD, results, leaderboard, and secondary dialogs. |
| `style.css` | Arcade layout, feedback, hazard appearance, and reduced-motion/mobile styling. |
| `script.js` | Screen flow, name/profile selection, input, REST requests, recovery, and leaderboard rendering. |
| `motion.js` | Pure entrance-offset and whole-segment clipping helpers. |
| `game.js` | Scheduled waves, first-cut geometry, multi-pizza scoring, and grenade collision. |
| `game-rules.json` | Mode `arcade-3.1`, 60,000 ms run, 3,000 ms preparation, 5,000 ms waves, and the three pizza mappings. |
| `server.js` | API routes, leaderboard ranking, validation, atomic storage, and exactly-once result settlement. |
| `test/` | Automated motion, game-rule, leaderboard, and API/storage checks. |
| `ASSESSMENT.md` | Requirement mapping, browser checklist, and explanation practice. |

`SCORE_RULES` and `DIFFICULTY_LEVELS` are constants in `game.js`. The UI can read them for labels; the API awards points. The compatible scoring mode remains `arcade-3.1`; Version 3.2 introduced the entrance in `motion.js`, and Version 3.3 adds the arcade screen flow and leaderboard. The server loads and validates JSON settings at startup, so restart it after a permitted configuration change. Existing runs keep their rules and deadline snapshot.

## Verification and later code changes

**Version 3.3 verification:** `npm run check` passes for all four JavaScript files, and `npm test` passes **56 of 56 tests**: **7 motion, 30 shared game-rule, and 19 API/storage tests**, with **zero failures or skips**. The API tests include leaderboard eligibility, ties, persistence, profile changes, and settlement before ranking.

An additional **15 targeted name/recovery flow checks passed** against the actual controller functions using stubbed requests and state: **9 create/reuse checks and 6 reload regression checks**. These supplemental release checks are separate from the 56-test `npm test` suite. They do not render the DOM or verify browser layout, focus, or gestures.

Static checks cover **115 unique HTML IDs, 100 ID selectors, one class selector, and 101 element properties**. Labels, ARIA references, local assets, imported-module routes, and SVG URL references resolve. Source review checks the name/result panels outside board input, the fixed 300 × 280 clipping window around the moving batch and separate outcome effects, the unchanged canonical cut coordinates, and the absence of CSS transforms on the moving group. Viewport sizing was reviewed in the CSS source.

The user reported that **Version 3.2 plays well**; that report applies to the previous release. **Version 3.3 browser playtesting and layout checks have not been performed here.** Automated tests and static source review do not replace those observations.

Run these commands from the project folder:

```text
npm run check
npm test
```

After editing code, inspect and save the intended changes:

```text
git status
git add .
git commit -m "Improve Pizza Slice Rush Version 3.3"
git push origin main
```

Use the running Node server's URL to play. Opening `index.html` directly or using GitHub Pages alone cannot run this API. If port 3000 is busy, stop the earlier server with Ctrl+C before starting this one.
