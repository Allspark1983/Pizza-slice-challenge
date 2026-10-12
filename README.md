# Pizza Slice Rush — Version 3.1

**Repository:** [Allspark1983/Pizza-slice-challenge](https://github.com/Allspark1983/Pizza-slice-challenge), branch **`main`**.

A **solo 60-second game** built with HTML, CSS, plain JavaScript, and a Node.js REST API. Slice up to three pizzas in each five-second batch, avoid temporary grenades, and try to beat your Version 3.1 personal best **score**. The API judges cuts, applies points and penalties, and decides the final result.

## How to play

1. Add or choose your solo profile and start a run.
2. Wait for **3, 2, 1**. At **Go**, one continuous **60-second** clock begins.
3. Make a full straight cut through a pizza's centre. **Your first cut sets its orientation**; add equally spaced cuts to make the required slices. There are no guide lines or hidden required first angles.
4. Use a mouse, touch, or pen to swipe across the board; one stroke can affect several pizzas. For keyboard play, choose a target pizza and an angle, then choose **Make cut**.
5. Finish each pizza before the batch's **five-second** timer expires. Avoid any grenade until it disappears. If you clear the board early, wait for the next scheduled batch.
6. Keep playing for the full minute. At zero, your final score is compared with the personal best saved when the run started.

| Event | Score change | What happens next |
| --- | --- | --- |
| Complete all required cuts on a pizza. | **+10** | Completed-pizza count increases and that pizza is removed. |
| Make a wrong completed cut. | **−5** | That pizza is spoiled and removed. |
| Swipe through an active grenade. | **−10** | Grenade-hit count increases and that pizza is removed; there is no extra wrong-cut deduction. |
| Leave a pizza unfinished when its batch expires. | **−5** | Missed-pizza count increases and that pizza is removed. |

**Your score never goes below zero.** Penalties apply per pizza, and every outcome keeps the same minute running. A multi-pizza swipe processes affected pizzas in the server's stored order. Short/outside strokes and repeated correct cuts normally have no effect. Grenades are checked first, so a swipe through an active grenade can cost points even when it would otherwise be an incomplete or duplicate cut.

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

The game shows **“Beat your best: N”**, where N is your Version 3.1 best score when the run began. The API reports:

- **Won:** your final score is **strictly higher** than that starting best.
- **Lost:** your final score is equal to or below it.

Beating the record during play does not end the run. Later penalties can reduce the final score. For example, if your best was 40, reaching 50 and then losing 10 points leaves 40: that tied final score does not beat the record.

The completed-pizza count is a separate statistic. `bestScore` and `bestPizzaCount` update independently after a run finishes; completing more pizzas does not automatically mean a higher score after penalties. A previous Version 3.0 best is shown separately and is not the target for this changed game.

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

Refresh the browser. If the pull cannot fast-forward, review the branch difference before continuing. Version 3.1 stores its records in `.data/rush-3.1.json`. On first use it imports existing profile IDs/names and their previous best from `.data/rush.json`, while keeping that older file untouched.

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

A public profile has `id`, `name`, `runsPlayed`, `runsWon`, `runsLost`, `bestScore`, `bestPizzaCount`, `totalPizzasCompleted`, and `previousBestScore`. The ordinary records belong to Version 3.1; `previousBestScore` holds the imported Version 3.0 best, or `null` for a new profile. Results and totals are settled once when a run ends. Name edits preserve identity and progress.

## How the REST API works

The browser sends actions and displays the API's **`{ run, player, feedback }`** response. The server creates scheduled waves, chooses pizza sizes and hazards, checks time and geometry, applies score changes, and decides the final result. The browser cannot submit its own score, outcome, pizza size, or time.

| Method and path | Request body | Purpose |
| --- | --- | --- |
| `GET /api/players` | None. | Read solo profiles. |
| `POST /api/players` | `{ "name": "Adzan" }` | Add a profile. |
| `PATCH /api/players/:id` | `{ "name": "Adzan M" }` | Rename a profile. |
| `DELETE /api/players/:id` | None. | Delete a profile and its runs. |
| `POST /api/runs` | `{ "playerId": "player-id", "requestId": "unique-start-id" }` | Start or resume an active run. |
| `GET /api/runs/:id` | None. | Read the current run and reconcile wave/run deadlines. |
| `POST /api/runs/:id/cuts` | `requestId`, `waveId`, `start: { x, y }`, `end: { x, y }`. | Submit one board stroke for the current wave. |

The **request ID** identifies an action for safe retry. The **wave ID** identifies the batch it belongs to. A delayed stroke from an earlier wave cannot cut or damage new arrivals. Retry an uncertain action using the identical request ID, wave ID, and body. The server can apply that stroke to several pizzas in the wave.

Coordinates use the **whole board**, not an individual pizza. The SVG board spans x = −150 to 150 and y = −140 to 140; input x/y values must be finite numbers from **−200 to 200**. The server supplies each pizza's position and radius. Pointer input uses the inverse SVG screen matrix to map the visible board to these coordinates; keyboard input uses `strokeForPizza` for its selected pizza.

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

Refreshing, switching tabs, or restarting the server does not pause or reset the saved run. Starting again for the same profile resumes its active run. After a connection problem, retry/recover the existing action and read the server's result. Profile changes are disabled while a run or uncertain action is active.

Players and runs are saved together in **`.data/rush-3.1.json`** through atomic updates. If that file is missing, the server imports valid profile IDs, names, and previous best scores from **`.data/rush.json`**, when available. New Version 3.1 records start at zero; older runs are not imported. The entire older file stays untouched.

The import is saved once, so a later rename or deletion is not undone by importing again. If neither data file exists, begin by creating a profile. Invalid saved data produces an error instead of silently resetting records.

Runtime data is excluded from Git. The same Codespace retains its data across restarts; another Codespace has separate records. Download the relevant data file before deleting a Codespace if you want to keep those records. This is a casual solo game, not an anti-cheat system.

## Files to read while learning

| File | What it does |
| --- | --- |
| `index.html` | Game board, score, run/wave timers, controls, and profile panel. |
| `style.css` | Layout, feedback, hazard appearance, and reduced-motion/mobile styling. |
| `script.js` | Input, REST requests, recovery, and rendering server state. |
| `game.js` | Scheduled waves, first-cut geometry, multi-pizza scoring, and grenade collision. |
| `game-rules.json` | Mode `arcade-3.1`, 60,000 ms run, 3,000 ms preparation, 5,000 ms waves, and the three pizza mappings. |
| `server.js` | API routes, validation, atomic storage, and exactly-once result settlement. |
| `test/` | Automated game-rule and API/storage checks. |
| `ASSESSMENT.md` | Requirement mapping, browser checklist, and explanation practice. |

`SCORE_RULES` and `DIFFICULTY_LEVELS` are constants in `game.js`. The UI can read them for labels; the API awards points. The server loads and validates JSON settings at startup, so restart it after a permitted configuration change. Existing runs keep their rules and deadline snapshot.

## Verification and later code changes

**Version 3.1 verification:** `npm run check` passes and `npm test` passes **45 of 45 tests**: **30 shared game-rule tests and 15 API/storage tests**, with **zero failures**. Static checks cover **78 ID selectors and 89 unique HTML IDs**; all ARIA, label, and local-asset references resolve. Browser playtesting and layout checks have not been performed here; automated and static checks do not replace those observations.

Run these commands from the project folder:

```text
npm run check
npm test
```

After editing code, inspect and save the intended changes:

```text
git status
git add .
git commit -m "Improve Pizza Slice Rush Version 3.1"
git push origin main
```

Use the running Node server's URL to play. Opening `index.html` directly or using GitHub Pages alone cannot run this API. If port 3000 is busy, stop the earlier server with Ctrl+C before starting this one.
