# Pizza Slice Rush — Version 3.3 assessment guide

**Repository:** [Allspark1983/Pizza-slice-challenge](https://github.com/Allspark1983/Pizza-slice-challenge), branch **`main`**. Follow `README.md` for Node.js 22, Codespaces, port 3000, and safe update instructions.

## Purpose and user experience

**Target user:** a solo player seeking a short arcade challenge, a clear personal record, and a place on the same server's leaderboard.

**Problem:** the player needs to see their name, points, clock, and pizzas together, then understand the final result and find their name in the ranking.

**Solution:** Version 3.3 uses a name-entry view, a game view with a compact heads-up display (HUD), and a results view in one arcade stage. A returning name reuses its saved profile after trimming and case-insensitive matching; a new name creates a profile. After three seconds of preparation, the game runs for one continuous 60-second minute with scheduled five-second batches of one, two, then three pizzas. The left-side entrance and first-cut orientation from the earlier release continue. The server judges cuts, hazards, and missed pizzas, then settles the personal-best result. The results view shows the player's name and latest score alongside a personal-best leaderboard. Version 3.1 and Version 3.2 records continue, and secondary dialogs preserve full profile CRUD and supporting controls.

The app uses plain HTML/CSS/JavaScript and a dependency-free Node REST API. It does not integrate an external SaaS service. Any separately required evidence of SaaS integration or the learner's generative-AI workflow still needs to be supplied.

## Explain the rules accurately

| Pizza | Equal slices | Full diameter cuts |
| --- | --- | --- |
| Small: 10 inches | 4 | 2 at 90° spacing. |
| Medium: 12 inches | 6 | 3 at 60° spacing. |
| Large: 14 inches | 8 | 4 at 45° spacing. |

A diameter crosses the centre from edge to opposite edge. Four equally spaced diameter cuts therefore create eight equal wedges. The first accepted cut sets that pizza's orientation; subsequent cuts must form distinct, equally spaced diameters relative to it. There is no hidden random first angle. The public `cutAngles` array contains only confirmed cuts, so the interface draws no guides for future cuts.

The displayed pizza radii are 30, 36, and 42 board units. Diameters and circumferences therefore have the intended **10:12:14** ratio. One board-space stroke can cross several differently sized pizzas.

| Event | Score | Continuing state |
| --- | --- | --- |
| Finish a pizza. | +10. | Increase `pizzasCompleted`; remove that pizza. |
| Wrong completed cut. | −5, stopping at zero. | Increase `pizzasSpoiled`; remove that pizza. |
| Active grenade hit. | −10, stopping at zero. | Increase `grenadesHit`; remove that pizza without another wrong-cut deduction. |
| Unfinished pizza at wave expiry. | −5, stopping at zero. | Increase `pizzasMissed`; remove that pizza. |

The minute continues after every event. Multi-pizza strokes process pizzas in stable array order, applying each penalty's zero floor separately. A resolved pizza is not replaced within the current wave. A cleared board waits for the next scheduled batch.

Short/outside strokes and duplicate correct cuts are normally ignored, but **grenade collision is checked first** for each pizza. A valid stroke at least **3 board units** long that intersects an active grenade can trigger it even without a full pizza cut. Stale wave IDs, canceled gestures, preparation, and expired runs cannot trigger grenade damage.

Waves arrive at elapsed 0, 5, …, 55 seconds. The four waves before 20 seconds contain one pizza each; the next four contain two each; the final four contain three each. That offers **4 + 8 + 12 = 24 pizzas**. Difficulty rises through quantity. All levels keep angle tolerance **10°**, centre tolerance **0.18 radius**, equal size probabilities, and a **20% grenade chance lasting 1.8 seconds**.

A full stroke extends at least 0.8 radius to each side of a pizza's centre projection; endpoints may be far outside it. Missed-pizza penalties apply at every five-second deadline, including **exactly 60 seconds** for the final batch, before the run result is settled. A late read catches up every expired wave at its original timestamp.

The result is decided only at the end of the minute. **`score > bestBefore` wins; a tie or lower score loses.** `bestBefore` is the current best score captured at run start, including progress carried forward from Versions 3.1 and 3.2; `targetScore` is the internal threshold `bestBefore + 1`. The screen presents the player's personal-best target. Completed-pizza count is separate: `bestScore` and `bestPizzaCount` can improve independently when the result is settled. The imported Version 3.0 best is displayed separately and does not determine this target.

## Explain the arcade screen and leaderboard

The **HUD** is the information displayed alongside the playing area: player name, score, time remaining, and game progress. These values come from server state and the existing display clock. Showing them together is a front-end layout change; the player does not need to view raw API responses or visit a separate API page.

| Stage | Interface behavior | API work behind it |
| --- | --- | --- |
| Enter name. | Reuse a matching saved name or create a profile, then start. | Read profiles; create one if needed; POST the start request. |
| Play. | Keep the player name, score, timer, and pizzas together. | Submit cuts and read the current run; render confirmed scores and outcomes. |
| Finish. | Show the latest score, personal-best result, and leaderboard with the player's name and position identified. | Receive the settled run, then GET the derived leaderboard. |

`GET /api/leaderboard` returns **`{ entries, totalPlayers }`**. Every entry contains `rank`, `playerId`, `name`, `bestScore`, `bestPizzaCount`, and `runsPlayed`. Only profiles with at least one completed run appear, including a zero-score finish. `totalPlayers` is the number of eligible ranked profiles, not the number of every saved name.

The endpoint sorts by `bestScore` descending, then independent `bestPizzaCount` descending, then trimmed lowercase name in Unicode code-point order, then ID. Ranks are consecutive positions even when scores tie. The full ordered array comes from the API; the page shows the top 10 in a table and highlights the current player's row by `playerId`. When the player ranks below the top 10, a separate **Your place** paragraph shows their name, rank, and records beneath the table.

The leaderboard shows **personal records**, not a history of individual runs. A run's latest score is therefore labeled separately from its leaderboard best. The best pizza count may have been achieved in a different run from the best score.

Before ranking, the GET route uses the existing storage transaction to reconcile expired waves and settle expired runs. It then reads the updated profile records. There is no new leaderboard file, database table, or score migration. The scoreboard is shared by profiles on the same server; different Codespaces and local copies have separate data. Name entry identifies a local game profile and is not a sign-in system.

## Explain the sliding entrance

The pure `entranceOffset` helper in `motion.js` moves a shared SVG batch group from x = −300 to 0 over **450 ms**, slowing as it reaches the destination. Pizzas, labels, grenades, and the blade share that frame. The first entrance happens in the final 450 ms of preparation; later entrances take place inside the first 450 ms of their existing five-second waves.

Cuts remain available during arrivals in playing time. Pointer-down freezes the current batch offset through the gesture and pending confirmation, while both clocks continue. The group's inverse screen matrix maps visible points back to the API's fixed board coordinates. `clipStrokeToBounds` then clips the whole straight segment to ±200 while preserving its angle; independently clamping endpoints could change the cut.

The entrance resumes at its scheduled phase after the held gesture/action finishes. Same-wave responses and refreshes do not restart it. Reduced motion places pizzas at their destination immediately; changing that preference during a gesture cancels the gesture before changing its frame. Scoring, deadlines, and the saved `arcade-3.1` rules remain compatible.

## Requirement mapping

This maps the implementation to the supplied Module 2 **Agile Front End Development with JavaScript** requirements. It helps explain the work and does not guarantee an assessment result.

| Requirement | Evidence to show |
| --- | --- |
| Plain HTML, CSS, and JavaScript. | Explain the interface files and Node's built-in API/storage modules. |
| Usable GUI, target group, and problem. | Show name entry, the combined game/HUD, final score and personal leaderboard position, then the secondary profile controls. |
| UI/UX and design thinking. | Explain the single arcade stage, clear start/play/results flow, brief entrance, stable cutting frame, proportional sizes, two clocks, and reduced-motion behavior. |
| CRUD for one resource. | Create, view, rename, and delete a profile. |
| Responsive layout for a mobile device. | Check the stage, name/score/timer visibility, board input alignment, dialogs, and leaderboard on a mobile-sized screen. |
| Three DOM properties across two elements. | In `script.js`, show `elements.entryPlayerName.value` in `handleStartSubmit`, `elements.beginGame.disabled` in `renderSetup`, and `name.textContent = entry.name` in `renderLeaderboard`. These use three properties across the name input, start button, and a leaderboard cell. |
| At least two event handlers. | Show the start form's `submit` → `handleStartSubmit`, profile form's `submit` → `handlePlayerSubmit`, and board `pointerdown`/`pointermove`/`pointerup` → `handlePointerDown`/`handlePointerMove`/`handlePointerUp`. |
| Variables and operators. | Explain run state, score additions/deductions, zero clamping, and elapsed time used to compute the entrance offset. |
| Conditions and loops. | Trace expired-wave catch-up, multi-pizza grenade/geometry checks, name matching, and profile/pizza/leaderboard rendering. |
| Functions. | Explain server rules through `createRun`, `advanceRun`, and `applyRunCut`, then pure visual/input helpers `entranceOffset` and `clipStrokeToBounds` in `motion.js`. |
| At least one array and one object. | Show `pizzas`, `cutAngles`, and `lastEvents` arrays, plus a pizza object and `pizzaCountsBySize`. |
| A function's returned value passed into another function. | `renderProfiles(sortProfilesByName(players))` in `renderInterface`: the inner function returns an alphabetically sorted copy of the profiles array, which the outer function uses to populate the profile selector. |
| Asynchronous work and JSON. | Explain `fetch`, `async`/`await`, `JSON.stringify`, and reading the API response. |
| An AJAX GET request. | Inspect `GET /api/players`, `GET /api/runs/:id`, or the new `GET /api/leaderboard`. |
| An AJAX POST, PATCH, or PUT request. | Inspect POST run/cut requests and a PATCH name edit. |
| Repository URL and source ZIP through the LMS. | Verify the uploaded `main` code and current source ZIP before submission. |
| About 15 minutes of individual oral clarification. | Walk through a cut, penalty, retry, and final result in your own words. |

## Profile CRUD remains clear

The main setup form provides quick name entry before play. The profile-management dialog retains the explicit create, view, rename, and delete controls for the assignment. Name matching in the start flow trims spaces and ignores letter case so an existing player can continue their record.

The new form is `#start-form`; its handler is `handleStartSubmit`. It calls `getOrCreatePlayer`, which reads the current saved profiles and uses `findPlayerByName` before creating anything. After a duplicate-name conflict or uncertain creation response, it reads profiles again to find the same name. `pendingProfileName` preserves an unresolved creation attempt across refreshes, alongside the existing recovery information. The server's case-insensitive uniqueness check prevents a duplicate saved profile.

| Action | Request | Stored effect |
| --- | --- | --- |
| Create | `POST /api/players` with `{ "name": "Adzan" }`. | Add a profile with its own ID and initial records. |
| Read | `GET /api/players`. | Read solo profiles and personal records. |
| Update | `PATCH /api/players/:id` with a name. | Rename while retaining identity and progress. |
| Delete | `DELETE /api/players/:id`. | Remove the profile and its associated runs. |

Public profiles contain `runsPlayed`, `runsWon`, `runsLost`, `bestScore`, `bestPizzaCount`, `totalPizzasCompleted`, and `previousBestScore` in addition to ID/name. Current statistics continue from Versions 3.1 and 3.2 and are settled once per finished run. `previousBestScore` preserves an imported Version 3.0 best, or is `null` for a new profile. A name PATCH cannot award points, change that previous best, or choose an outcome. A rename is reflected in the next leaderboard read; deleting a profile removes it and its associated runs from the same store.

## Follow an action through the API

1. `POST /api/runs` sends `{ playerId, requestId }`. The server creates or resumes a run and snapshots the current best score.
2. Pointer input freezes and inverse-maps the moving batch; keyboard input uses `strokeForPizza`. The resulting **board-space stroke** is clipped as a whole segment and carries the current `waveId`.
3. `POST /api/runs/:id/cuts` sends `{ requestId, waveId, start, end }`.
4. The server advances the clocks, expires missed waves, ignores stale-wave effects, and checks each remaining pizza's grenade and geometry in order.
5. The response **`{ run, player, feedback }`** drives the display. Public `pizzas` contain positions, sizes, and completed `cutAngles`; `lastEvents` identifies confirmed outcomes. `GET /api/runs/:id` can recover state, advance waves, and settle an expired run.
6. After settlement, `GET /api/leaderboard` returns the ranked personal records. `loadLeaderboard` validates the response, and `renderLeaderboard` creates safe text cells for the top 10 and identifies the current player's position. The results screen labels the latest score separately.

`renderSetup` and `renderInterface` control the setup and result panels' `hidden` properties. The HUD and board belong to the same arcade stage; the result overlay is outside the board's gesture handlers. Leaderboard reads occur after a confirmed finish, on an explicit retry, or after relevant visible profile changes; the timer does not fetch it every tick. A request generation number and run ID prevent an older ranking response from replacing the screen after the player moves on.

A retry reuses the identical request ID and clipped body, including `waveId`. Version 3.3 retains the compatible Version 3.1 recovery session key also used by Version 3.2. Request IDs stop duplicate actions; wave IDs stop delayed strokes from affecting new batches. Event IDs prevent the interface from replaying the same outcome animation after recovery. All active and the latest 100 completed runs are retained, with at most 2,000 start/cut request IDs per run. Wave expiry and final settlement still work at that cap.

Input x/y coordinates remain finite board values from **−200 to 200**. The visible SVG covers x = −150 to 150 and y = −140 to 140. Using the **batch group's** `getScreenCTM().inverse()` accounts for both its entrance translation and screen size, preserving alignment with the unchanged server geometry.

Server processing time controls deadlines, including network and queue delay. Refreshing or restarting does not grant another minute or a fresh wave. Version 3.3 continues using **`.data/rush-3.1.json`**, preserving existing profile IDs, scores, and runs. The new ranking is derived from those existing records. If that file is missing, the existing import from **`.data/rush.json`** still copies IDs/names and previous best scores into new current-mode records; Version 3.0 runs are not imported and that older file remains untouched. The import is saved once so later rename/delete actions persist. Runtime data remains ignored by Git.

## Design-thinking explanation

| Stage | Project decision |
| --- | --- |
| Understand the player. | Use the player's request to bring name, points, clock, and pizza into one screen, with name entry before play and a leaderboard afterward. Formal user interviews are not claimed. |
| Define the challenge. | Keep the active game readable while rewarding equal slicing and quick decisions throughout the full minute. |
| Choose the mechanics. | Let the first cut set orientation; increase pizzas per scheduled wave; score completion, spoil, grenade, and missed outcomes with a zero floor. |
| Build the interface. | Use setup/play/results views in the same stage, a compact HUD, clear personal leaderboard placement, and secondary dialogs for profile management and instructions. Preserve the stable cutting frame and reduced-motion behavior. |
| Observe and improve. | Check that a player can enter their name, see the score and timer while slicing, and find their final score and leaderboard place. Record findings after doing this. |

## Version 3.3 validation status

| Check | Recorded result |
| --- | --- |
| `npm run check`. | Passed for Version 3.3: `server.js`, `script.js`, `game.js`, and `motion.js`. |
| Motion tests. | 7 of 7 passed. |
| Shared game-rule tests. | 30 of 30 passed. |
| API/storage and leaderboard tests. | 19 of 19 passed, including four new leaderboard tests. |
| Combined `npm test` suite. | 56 of 56 passed, with zero failures or skips. |
| Supplemental name/recovery flow checks. | 15 passed against actual controller functions using stubbed requests and state: 9 create/reuse checks and 6 reload regression checks. Separate from the `npm test` suite. |
| Static source/DOM checks. | 115 unique HTML IDs, 100 ID selectors, one class selector, and 101 element properties checked. Labels, ARIA, local assets, imported-module routes, and SVG URL references resolve. |
| Motion/input and screen-flow source review. | Setup and results are outside board input. A fixed 300 × 280 clipping window wraps the moving batch and separate outcome effects; cut input retains canonical coordinates. The motion group has no CSS transform. |
| Viewport sizing in CSS. | Source reviewed and sizing corrected; this is not a browser layout observation. |
| Browser playtesting, mobile layout, touch, keyboard, and animations. | Not performed here. |

These are fresh **Version 3.3** automated and static results. The 15 supplemental release checks use stubbed requests and state; they do not render the DOM or verify browser layout, focus, or gestures. The user has reported that **Version 3.2 plays well**; that feedback concerns the previous release. Version 3.3 browser playtesting remains unperformed here, and automated/source checks do not replace browser observations.

## Manual browser checklist

These checks are for a running browser. Record results only after performing them.

| Check | Expected result | Your result |
| --- | --- | --- |
| First visit and name entry. | The start view asks for a name before the countdown; blank/invalid names are explained. | Not recorded. |
| Return with the same name using different case or surrounding spaces. | The existing profile and its record are reused. | Not recorded. |
| Lose the response while creating a name. | Check player & start rechecks the same name and reuses a saved profile instead of duplicating it. | Not recorded. |
| Read the active game screen. | Player name, score, minute timer, and pizzas remain visible together. | Not recorded. |
| Use supporting dialogs. | Profile management, rules, and keyboard controls remain usable without replacing the game workflow. | Not recorded. |
| Profile CRUD. | Add/view/rename/delete works and persists. | Not recorded. |
| Update from Version 3.1 or 3.2. | Existing profiles, scores, runs, and compatible pending actions remain available. | Not recorded. |
| Open with only Version 3.0 data. | Names and IDs are imported; previous best stays separate from new current-mode records. | Not recorded. |
| Begin a run. | First entrance in the final 450 ms of preparation, then one 60-second clock. | Not recorded. |
| Watch a later arrival. | The batch slides in from the left within its existing five-second window. | Not recorded. |
| Cut while a batch arrives. | The batch holds still during the gesture/confirmation; cut positions align and both clocks continue. | Not recorded. |
| Resume or refresh during an entrance. | The scheduled phase is restored; the same wave does not replay its entrance. | Not recorded. |
| Inspect all three sizes. | 10/12/14-inch pizzas have proportional diameters and need 4/6/8 slices. | Not recorded. |
| Choose different first-cut angles. | A full centre cut establishes each pizza's orientation without hidden guides. | Not recorded. |
| Finish a pizza or clear a wave early. | Each completed pizza adds 10 and disappears; the next batch waits for its scheduled time. | Not recorded. |
| Swipe through several pizzas. | Each intersected pizza is judged in order; partial and untouched pizzas remain. | Not recorded. |
| Make a wrong complete cut. | Lose 5 per spoiled pizza, remove it, and keep playing. | Not recorded. |
| Trigger a grenade. | Lose 10 per hit pizza and remove it without another wrong-cut penalty. | Not recorded. |
| Make mistakes at a low score. | Each deduction stops at zero. | Not recorded. |
| Avoid a grenade. | It disappears after its 1.8-second window; other safe strokes remain available. | Not recorded. |
| Cross 20 and 40 seconds. | New batches contain two, then three pizzas; tolerance and grenade probability stay constant. | Not recorded. |
| Leave pizzas at a wave boundary. | Each unfinished pizza costs 5 and counts as missed; the next batch uses its original schedule. | Not recorded. |
| Leave pizzas in the final batch. | At 60 seconds, missed penalties apply before the final result. | Not recorded. |
| Incomplete/duplicate strokes away from grenades. | No score change or extra cut. | Not recorded. |
| Cancel a stroke or send an old wave's action. | No unintended cut or grenade damage to new arrivals. | Not recorded. |
| Beat the best before time ends. | The run continues; only final score decides the result. | Not recorded. |
| Finish with score above, equal to, or below the starting best. | Only the strictly higher final score wins. | Not recorded. |
| Improve completed-pizza count despite penalties. | Best count and best score are evaluated independently. | Not recorded. |
| Finish a first run with zero points. | The player's name appears in the leaderboard, with latest score and best score labeled separately. | Not recorded. |
| Finish above and below a previous personal best. | The latest result shows the run's score; the ranking retains the highest saved score. | Not recorded. |
| Finish with a rank below the top 10. | The screen shows the top 10 plus the player's name, actual rank, and record in Your place beneath the table. | Not recorded. |
| Rename or delete a ranked profile. | The next leaderboard read uses the new name or omits the deleted profile. | Not recorded. |
| Read the leaderboard after a run expires in another tab. | The server settles the expired run once before returning the ranking. | Not recorded. |
| Replay or change player after finishing. | Replay keeps the chosen identity; change player returns to name entry. | Not recorded. |
| Fail and retry the leaderboard request. | The settled run remains visible; retrying the ranking does not create or rescore a run. | Not recorded. |
| Refresh, lose connection, retry, or restart the server. | Catch up expired waves and recover the original deadline without duplicate effects or settlement. | Not recorded. |
| Use pointer, touch, and keyboard controls. | Board coordinates align; keyboard cuts use the chosen pizza and angle. | Not recorded. |
| Use mobile width and reduced motion. | Controls fit and cuts align; reduced motion gives instant arrival, and changing it cancels an active gesture safely. | Not recorded. |

Use deterministic tests for entrance offsets, angle-preserving segment clipping, exact wave/run deadlines, all 24 offered pizzas, grenade collision, stale waves, leaderboard tie ordering, zero-score eligibility, and storage/retry boundaries. Human timing cannot reliably verify exact deadlines; visual alignment and the screen flow still need browser observation.

## Practise explaining the code

“The start form reads the player name and reuses or creates a profile. The game view keeps the player, score, and timers next to the pizza board. Those displays use the server's game state. After the minute ends, the page requests the leaderboard and creates a row for each displayed player. It highlights my profile ID and distinguishes this run's score from my best-ever score in the current game mode.”

“The pointer handler holds the moving batch still and maps the gesture back to fixed board coordinates. It clips the straight segment and posts a request ID, wave ID, and two points. The server advances its clocks, applies any missed-pizza penalties, and judges hazards and cuts. The page displays the returned score and events. The slide never pauses either clock or changes the server's scoring rules.”

1. How does the first cut set orientation without a hidden required angle?
2. Why do 2/3/4 diameter cuts create 4/6/8 equal slices?
3. How do radii 30/36/42 preserve the requested size proportions?
4. How do the 12 waves offer exactly 24 pizzas?
5. Why does clearing the board early not start the next batch?
6. How can one stroke affect several pizzas, and why does scoring order matter near zero?
7. Why can a short or duplicate swipe still trigger a grenade?
8. What happens to unfinished pizzas at exactly 60 seconds?
9. Why do an early lead or a tied final score not guarantee a win?
10. What are the four profile CRUD operations?
11. Where are arrays, objects, functions, conditions, and loops used?
12. In `renderProfiles(sortProfilesByName(players))`, what does the inner function return, and how does the renderer use it without changing the original array?
13. Why does the pointer use the moving batch group's inverse screen matrix?
14. Why freeze the visible frame during a gesture while keeping both clocks running?
15. How does clipping the whole segment preserve an angle that endpoint clamping could change?
16. What distinct problems do request IDs, wave IDs, and event IDs solve?
17. Why does the entrance resume from scheduled time after a response or refresh?
18. How do late reads catch up expired waves without resetting either clock?
19. Why does Version 3.3 keep `.data/rush-3.1.json`, and when is `.data/rush.json` imported?
20. Which checks are automated/static, and which still need browser observation?
21. How can the screen display the player, points, timer, and pizzas together while the API still judges the game?
22. How does entering an existing name reuse the correct profile, and why is this not account authentication?
23. Why might the latest score differ from the leaderboard score?
24. How does the leaderboard order ties, and why can best pizza count come from a different run?
25. Why must a leaderboard read reconcile expired runs before returning records?
26. Why does a different Codespace have a separate leaderboard?

## Submission preparation

Run `npm run check` and `npm test`, record fresh results, complete the browser checks, and commit/push the intended files to the existing repository's `main` branch. Verify the uploaded code and create a source ZIP excluding `.data` and `.git`. Submit the verified URL and ZIP through the LMS and practise explaining your own code. Tests and source files alone do not determine an assessor's result.
