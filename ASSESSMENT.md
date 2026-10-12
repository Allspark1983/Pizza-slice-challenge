# Pizza Slice Rush — Version 3.2 assessment guide

**Repository:** [Allspark1983/Pizza-slice-challenge](https://github.com/Allspark1983/Pizza-slice-challenge), branch **`main`**. Follow `README.md` for Node.js 22, Codespaces, port 3000, and safe update instructions.

## Purpose and user experience

**Target user:** a solo player seeking a short challenge against their own saved record.

**Problem:** the player needs clear slicing rules, rising difficulty, understandable penalties, and a reliable personal-best result.

**Solution:** after three seconds of preparation, run one continuous 60-second game with scheduled five-second batches of one, two, then three pizzas. Version 3.2 slides each batch in from the left. The player chooses each pizza's first-cut orientation without guide lines. The server judges multi-pizza strokes, hazards, and missed pizzas, then compares the final score with the current best saved at run start. Version 3.1 records continue, and a secondary profile panel supplies CRUD.

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

The result is decided only at the end of the minute. **`score > bestBefore` wins; a tie or lower score loses.** `bestBefore` is the current best score captured at run start, including progress carried forward from Version 3.1; `targetScore` is the internal threshold `bestBefore + 1`. The screen presents **“Beat your best: N”**. Completed-pizza count is separate: `bestScore` and `bestPizzaCount` can improve independently when the result is settled. The imported Version 3.0 best is displayed separately and does not determine this target.

## Explain the sliding entrance

The pure `entranceOffset` helper in `motion.js` moves a shared SVG batch group from x = −300 to 0 over **450 ms**, slowing as it reaches the destination. Pizzas, labels, grenades, and the blade share that frame. The first entrance happens in the final 450 ms of preparation; later entrances take place inside the first 450 ms of their existing five-second waves.

Cuts remain available during arrivals in playing time. Pointer-down freezes the current batch offset through the gesture and pending confirmation, while both clocks continue. The group's inverse screen matrix maps visible points back to the API's fixed board coordinates. `clipStrokeToBounds` then clips the whole straight segment to ±200 while preserving its angle; independently clamping endpoints could change the cut.

The entrance resumes at its scheduled phase after the held gesture/action finishes. Same-wave responses and refreshes do not restart it. Reduced motion places pizzas at their destination immediately; changing that preference during a gesture cancels the gesture before changing its frame. Scoring, deadlines, and the saved `arcade-3.1` rules remain compatible.

## Requirement mapping

This maps the implementation to the supplied Module 2 **Agile Front End Development with JavaScript** requirements. It helps explain the work and does not guarantee an assessment result.

| Requirement | Evidence to show |
| --- | --- |
| Plain HTML, CSS, and JavaScript. | Explain the interface files and Node's built-in API/storage modules. |
| Usable GUI, target group, and problem. | Explain the solo personal-best goal and show the game and profile controls. |
| UI/UX and design thinking. | Explain the brief entrance, stable cutting frame, first-cut orientation, proportional sizes, two clocks, and instant arrival with reduced motion. |
| CRUD for one resource. | Create, view, rename, and delete a profile. |
| Responsive layout for a mobile device. | Check the board, input alignment, timer, and controls on a mobile-sized screen. |
| Three DOM properties across two elements. | In `script.js`, show `elements.playerName.value` in `renameProfile`, `elements.startRun.disabled` in `renderInterface`, and `elements.scoreFeedback.textContent` in `showPizzaFeedback`. These change three properties across three elements; feedback comes from confirmed `lastEvents`. |
| At least two event handlers. | Show the profile form's `submit` → `handlePlayerSubmit`, board `pointerdown`/`pointermove`/`pointerup` → `handlePointerDown`/`handlePointerMove`/`handlePointerUp`, and Make cut `click` → `submitKeyboardCut`. |
| Variables and operators. | Explain run state, score additions/deductions, zero clamping, and elapsed time used to compute the entrance offset. |
| Conditions and loops. | Trace expired-wave catch-up, multi-pizza grenade/geometry checks, and profile/pizza rendering. |
| Functions. | Explain server rules through `createRun`, `advanceRun`, and `applyRunCut`, then pure visual/input helpers `entranceOffset` and `clipStrokeToBounds` in `motion.js`. |
| At least one array and one object. | Show `pizzas`, `cutAngles`, and `lastEvents` arrays, plus a pizza object and `pizzaCountsBySize`. |
| A function's returned value passed into another function. | `renderProfiles(sortProfilesByName(players))` in `renderInterface`: the inner function returns an alphabetically sorted copy of the profiles array, which the outer function uses to populate the profile selector. |
| Asynchronous work and JSON. | Explain `fetch`, `async`/`await`, `JSON.stringify`, and reading the API response. |
| An AJAX GET request. | Inspect `GET /api/players` or `GET /api/runs/:id`. |
| An AJAX POST, PATCH, or PUT request. | Inspect POST run/cut requests and a PATCH name edit. |
| Repository URL and source ZIP through the LMS. | Verify the uploaded `main` code and current source ZIP before submission. |
| About 15 minutes of individual oral clarification. | Walk through a cut, penalty, retry, and final result in your own words. |

## Profile CRUD remains clear

| Action | Request | Stored effect |
| --- | --- | --- |
| Create | `POST /api/players` with `{ "name": "Adzan" }`. | Add a profile with its own ID and initial records. |
| Read | `GET /api/players`. | Read solo profiles and personal records. |
| Update | `PATCH /api/players/:id` with a name. | Rename while retaining identity and progress. |
| Delete | `DELETE /api/players/:id`. | Remove the profile and its associated runs. |

Public profiles contain `runsPlayed`, `runsWon`, `runsLost`, `bestScore`, `bestPizzaCount`, `totalPizzasCompleted`, and `previousBestScore` in addition to ID/name. Current statistics continue from Version 3.1 and are settled once per finished run. `previousBestScore` preserves an imported Version 3.0 best, or is `null` for a new profile. A name PATCH cannot award points, change that previous best, or choose an outcome.

## Follow an action through the API

1. `POST /api/runs` sends `{ playerId, requestId }`. The server creates or resumes a run and snapshots the current best score.
2. Pointer input freezes and inverse-maps the moving batch; keyboard input uses `strokeForPizza`. The resulting **board-space stroke** is clipped as a whole segment and carries the current `waveId`.
3. `POST /api/runs/:id/cuts` sends `{ requestId, waveId, start, end }`.
4. The server advances the clocks, expires missed waves, ignores stale-wave effects, and checks each remaining pizza's grenade and geometry in order.
5. The response **`{ run, player, feedback }`** drives the display. Public `pizzas` contain positions, sizes, and completed `cutAngles`; `lastEvents` identifies confirmed outcomes. `GET /api/runs/:id` can recover state, advance waves, and settle an expired run.

A retry reuses the identical request ID and clipped body, including `waveId`. Version 3.2 retains the compatible Version 3.1 recovery session key. Request IDs stop duplicate actions; wave IDs stop delayed strokes from affecting new batches. Event IDs prevent the interface from replaying the same outcome animation after recovery. All active and the latest 100 completed runs are retained, with at most 2,000 start/cut request IDs per run. Wave expiry and final settlement still work at that cap.

Input x/y coordinates remain finite board values from **−200 to 200**. The visible SVG covers x = −150 to 150 and y = −140 to 140. Using the **batch group's** `getScreenCTM().inverse()` accounts for both its entrance translation and screen size, preserving alignment with the unchanged server geometry.

Server processing time controls deadlines, including network and queue delay. Refreshing or restarting does not grant another minute or a fresh wave. Version 3.2 continues using **`.data/rush-3.1.json`**, preserving existing profile IDs, scores, and runs. If that file is missing, the existing import from **`.data/rush.json`** still copies IDs/names and previous best scores into new current-mode records; Version 3.0 runs are not imported and that older file remains untouched. The import is saved once so later rename/delete actions persist. Runtime data remains ignored by Git.

## Design-thinking explanation

| Stage | Project decision |
| --- | --- |
| Understand the player. | Assume a short solo run should have a clear goal, immediate feedback, and recoverable mistakes. Formal user interviews are not claimed. |
| Define the challenge. | Reward equal slicing and quick decisions while preserving the full minute after mistakes. |
| Choose the mechanics. | Let the first cut set orientation; increase pizzas per scheduled wave; score completion, spoil, grenade, and missed outcomes with a zero floor. |
| Build the interface. | Slide each batch in briefly, keep visible pizzas and cutting coordinates together, and offer instant arrival for reduced motion. |
| Observe and improve. | Check whether a player can cut an arriving batch accurately, then explain the first-cut rule and a missed-pizza penalty. Record findings after doing this. |

## Version 3.2 validation status

| Check | Recorded result |
| --- | --- |
| `npm run check`. | Passed for Version 3.2. |
| Motion tests. | 7 of 7 passed. |
| Shared game-rule tests. | 30 of 30 passed. |
| API/storage tests. | 15 of 15 passed. |
| Combined `npm test` suite. | 52 of 52 passed; zero failures. |
| Static source/DOM checks. | 79 ID selectors, 90 unique HTML IDs, and 80 element properties checked; ARIA, label, local-asset, and imported-module server routes resolve. |
| Motion/input source review. | Live pizzas, labels, grenades, and blade share the moving frame; effects stay separate. Input freezes before inverse mapping, retries keep canonical coordinates, keyboard input remains compatible, clocks continue, and the entrance does not rewind. |
| Browser playtesting, mobile layout, touch, keyboard, and animations. | Not performed here. |

These are fresh Version 3.2 automated and static results. The user's earlier report that Version 3.1 worked concerns that earlier release. Version 3.2 browser playtesting remains unperformed; automated and source checks do not replace browser observation.

## Manual browser checklist

These checks are for a running browser. Record results only after performing them.

| Check | Expected result | Your result |
| --- | --- | --- |
| Profile CRUD. | Add/view/rename/delete works and persists. | Not recorded. |
| Update from Version 3.1. | Existing profiles, scores, runs, and compatible pending actions remain available. | Not recorded. |
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
| Refresh, lose connection, retry, or restart the server. | Catch up expired waves and recover the original deadline without duplicate effects or settlement. | Not recorded. |
| Use pointer, touch, and keyboard controls. | Board coordinates align; keyboard cuts use the chosen pizza and angle. | Not recorded. |
| Use mobile width and reduced motion. | Controls fit and cuts align; reduced motion gives instant arrival, and changing it cancels an active gesture safely. | Not recorded. |

Use deterministic tests for entrance offsets, angle-preserving segment clipping, exact wave/run deadlines, all 24 offered pizzas, grenade collision, stale waves, and storage/retry boundaries. Human timing cannot reliably verify those boundaries; visual alignment still needs browser observation.

## Practise explaining the code

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
19. Why does Version 3.2 keep `.data/rush-3.1.json`, and when is `.data/rush.json` imported?
20. Which checks are automated/static, and which still need browser observation?

## Submission preparation

Run `npm run check` and `npm test`, record fresh results, complete the browser checks, and commit/push the intended files to the existing repository's `main` branch. Verify the uploaded code and create a source ZIP excluding `.data` and `.git`. Submit the verified URL and ZIP through the LMS and practise explaining your own code. Tests and source files alone do not determine an assessor's result.
