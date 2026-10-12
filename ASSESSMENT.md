# Pizza Slice Rush — Version 3 assessment guide

**Repository:** [Allspark1983/Pizza-slice-challenge](https://github.com/Allspark1983/Pizza-slice-challenge), branch **`main`**. Follow `README.md` for Node.js 22, Codespaces, port 3000, and safe update instructions.

## Purpose and user experience

**Target user:** a solo player seeking a short challenge against their own saved record.

**Problem:** the player needs clear slicing rules, rising difficulty, understandable penalties, and a reliable personal-best result.

**Solution:** after three seconds of preparation, run one continuous 60-second game with one pizza at a time. The server judges cuts and hazards, updates points, replaces finished/spoiled pizzas, and compares the final score with the best saved when the run began. A secondary profile panel supplies CRUD.

The app uses plain HTML/CSS/JavaScript and a dependency-free Node REST API. It does not integrate an external SaaS service. Any separately required evidence of SaaS integration or the learner's generative-AI workflow still needs to be supplied.

## Explain the rules accurately

| Pizza | Equal slices | Full diameter cuts |
| --- | --- | --- |
| 14 inches | 8 | 4 at 45° spacing. |
| 10 inches | 6 | 3 at 60° spacing. |
| 8 inches | 4 | 2 at 90° spacing. |

A diameter crosses the centre from edge to opposite edge, following two opposite slice boundaries. Four equally spaced diameter cuts therefore create eight equal wedges.

| Event | Score | Continuing state |
| --- | --- | --- |
| Finish a pizza. | +10. | Increase `pizzasCompleted`; generate the next pizza. |
| Wrong completed cut. | −5, stopping at zero. | Increase `pizzasSpoiled`; replace the pizza. |
| Active grenade hit. | −10, stopping at zero. | Increase `grenadesHit`; replace the pizza without another wrong-cut deduction. |

The minute continues after every event. Short/outside strokes and duplicate correct cuts are normally ignored, but **grenade collision is checked first**. A valid swipe at least 0.15 normalized units long that intersects an active grenade can trigger it even without a full pizza cut. Stale pizza IDs, canceled gestures, preparation, and expired runs cannot trigger grenade damage.

New pizzas become harder at elapsed **20 seconds** and **40 seconds**: angle tolerance narrows from **10° → 8° → 6°**, grenades become more likely and last longer, and larger pizzas become more likely. Centre tolerance stays **0.12 radius**. Each pizza keeps the difficulty chosen when it appeared. A grenade blocks one guide temporarily, so another guide can be cut first or the player can wait.

The result is decided only at the end of the minute. **`score > bestBefore` wins; a tie or lower score loses.** `bestBefore` is the best score captured at run start; `targetScore` is the internal threshold `bestBefore + 1`. The screen presents **“Beat your best: N”**. Completed-pizza count is separate: `bestScore` and `bestPizzaCount` can improve independently when the result is settled.

## Requirement mapping

This maps the implementation to the supplied Module 2 **Agile Front End Development with JavaScript** requirements. It helps explain the work and does not guarantee an assessment result.

| Requirement | Evidence to show |
| --- | --- |
| Plain HTML, CSS, and JavaScript. | Explain the interface files and Node's built-in API/storage modules. |
| Usable GUI, target group, and problem. | Explain the solo personal-best goal and show the game and profile controls. |
| UI/UX and design thinking. | Explain preparation, guide lines, score feedback, the temporary hazard, and keyboard/reduced-motion support. |
| CRUD for one resource. | Create, view, rename, and delete a profile. |
| Responsive layout for a mobile device. | Check the board, input alignment, timer, and controls on a mobile-sized screen. |
| Three DOM properties across two elements. | In `script.js`, show `elements.playerName.value` in `renameProfile`, `elements.startRun.disabled` in `renderInterface`, and `elements.scoreFeedback.textContent` in `showPizzaFeedback`. These change three properties across three elements. |
| At least two event handlers. | Show the profile form's `submit` → `handlePlayerSubmit`, board `pointerdown`/`pointermove`/`pointerup` → `handlePointerDown`/`handlePointerMove`/`handlePointerUp`, and Make cut `click` → `submitKeyboardCut`. |
| Variables and operators. | Explain run state, score additions/deductions, zero clamping, and elapsed time. |
| Conditions and loops. | Trace grenade/geometry/duplicate checks and guide/profile rendering. |
| Functions. | Explain `createRun`, `advanceRun`, `applyRunCut`, `toPublicRun`, and `strokeForAngle`. |
| At least one array and one object. | Show profiles/guides arrays, current-pizza objects, and `pizzaCountsBySize`. |
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

Public profiles contain `runsPlayed`, `runsWon`, `runsLost`, `bestScore`, `bestPizzaCount`, and `totalPizzasCompleted` in addition to ID/name. The server settles these once per finished run. The browser cannot use a name PATCH to award points or choose an outcome.

## Follow an action through the API

1. `POST /api/runs` sends `{ playerId, requestId }`. The server creates a run or resumes that profile's active run and snapshots the best score.
2. Pointer or keyboard input produces a stroke for the **current `pizzaId`**.
3. `POST /api/runs/:id/cuts` sends `{ requestId, pizzaId, start, end }`.
4. The server advances the clock, rejects stale-pizza effects, checks grenade collision and geometry, and updates score/pizza state.
5. The response **`{ run, player, feedback }`** drives the display. `GET /api/runs/:id` can recover state and settle an expired run.

A retry reuses the identical request ID and body, including `pizzaId`. These IDs solve different problems: request IDs stop duplicate actions, while pizza IDs stop delayed strokes from affecting replacements. All active and the latest 100 completed runs are retained, with at most 2,000 start/cut request IDs per run. The deadline can still settle at that cap.

Server processing time controls the deadline, including network and queue delay. Refreshing or restarting does not grant another minute. New mode data is saved atomically in **`.data/rush.json`**; the older **`.data/game.json`** is kept separately. Runtime data is ignored by Git, and this mode begins with fresh profiles.

## Design-thinking explanation

| Stage | Project decision |
| --- | --- |
| Understand the player. | Assume a short solo run should have a clear goal, immediate feedback, and recoverable mistakes. Formal user interviews are not claimed. |
| Define the challenge. | Reward precise cuts and risk awareness while preserving the full minute after mistakes. |
| Choose the mechanics. | Use +10/−5/−10 scoring, a zero floor, timed difficulty, and temporarily blocked guides. |
| Build the interface. | Keep the game primary, profiles secondary, and provide pointer and keyboard controls. |
| Observe and improve. | Ask a player to explain a penalty, avoid a grenade, and describe the end result. Record findings after doing this. |

## Version 3 validation status

| Check | Recorded result |
| --- | --- |
| `npm run check`. | Passed for Version 3. |
| Shared game-rule tests. | 25 of 25 passed. |
| API/storage tests. | 17 of 17 passed. |
| Combined `npm test` suite. | 42 of 42 passed; zero failures and zero skipped tests. |
| HTTP smoke check. | Passed. |
| Static source/DOM checks. | 76 `document.querySelector` calls and 86 unique HTML IDs checked; all DOM/ARIA targets and local assets are present, and imports match the shared game exports. |
| Browser playtesting, mobile layout, touch, keyboard, and animations. | Not performed here. |

These are Version 3 results; earlier releases' counts are superseded. Automated and static checks do not establish that the browser experience has been playtested.

## Manual browser checklist

These checks are for a running browser. Record results only after performing them.

| Check | Expected result | Your result |
| --- | --- | --- |
| Profile CRUD. | Add/view/rename/delete works and persists. | Not recorded. |
| Begin a run. | Three seconds of preparation, then one 60-second clock. | Not recorded. |
| Complete pizzas of all three sizes. | 4/3/2 full cuts make 8/6/4 slices; each pizza adds 10 and is replaced. | Not recorded. |
| Make a wrong complete cut. | Lose 5, spoil/replace the pizza, and keep playing. | Not recorded. |
| Trigger a grenade. | Lose 10 once, count a hit, and replace the pizza without another penalty. | Not recorded. |
| Make mistakes at a low score. | Each deduction stops at zero. | Not recorded. |
| Avoid a grenade. | Other guides remain usable and the grenade disappears after its window. | Not recorded. |
| Cross 20 and 40 seconds. | New pizzas use the new level; the current pizza's guides/tolerance stay fixed. | Not recorded. |
| Incomplete/duplicate strokes away from grenades. | No score change or extra cut. | Not recorded. |
| Cancel a stroke or act on a replaced pizza. | No unintended cut, penalty, or grenade damage. | Not recorded. |
| Beat the best before time ends. | The run continues; only final score decides the result. | Not recorded. |
| Finish with score above, equal to, or below the starting best. | Only the strictly higher final score wins. | Not recorded. |
| Improve completed-pizza count despite penalties. | Best count and best score are evaluated independently. | Not recorded. |
| Refresh, lose connection, retry, or restart the server. | Recover the original run/deadline without duplicate scoring or result settlement. | Not recorded. |
| Use pointer, touch, and keyboard controls. | The API judges equivalent strokes for the current pizza. | Not recorded. |
| Use mobile width and reduced motion. | Controls fit, coordinates align, and animations respect the preference. | Not recorded. |

Use deterministic tests for exact deadlines, grenade expiry/segment collision, level thresholds and sampling, zero floors, request limits, and exactly-once storage. Human timing cannot reliably verify those boundaries.

## Practise explaining the code

“A cut handler posts a request ID, the current pizza ID, and two points. The server checks its clock and the pizza, then judges hazards and geometry. It sends back the updated run and feedback. The page renders the score from that response. At the end of the full minute, the server compares final score with the best saved at the start and settles profile records once.”

1. Why do four diameter cuts create eight equal slices?
2. Why is pizza count different from score?
3. How does the score stay at zero after a penalty that would make it negative?
4. Why can a short or duplicate swipe still trigger a grenade?
5. How do the level changes affect new pizzas without moving current guides?
6. Why does beating the record early not guarantee the final win?
7. Why must a tied score lose this personal-best challenge?
8. What are the four profile CRUD operations?
9. Where are arrays, objects, functions, conditions, and loops used?
10. In `renderProfiles(sortProfilesByName(players))`, what does the inner function return, and how does the renderer use it without changing the original array?
11. How are pointer coordinates converted to the normalized pizza space?
12. What roles do the request ID and pizza ID play in recovery?
13. Why does the browser display a server score instead of awarding its own points?
14. Why do refreshing and restarting not reset the minute?
15. What is stored in `.data/rush.json`, and what happens to `.data/game.json`?
16. Which checks are automated/static, and which still need browser observation?

## Submission preparation

Run `npm run check` and `npm test`, record fresh results, complete the browser checks, and commit/push the intended files to the existing repository's `main` branch. Verify the uploaded code and create a source ZIP excluding `.data` and `.git`. Submit the verified URL and ZIP through the LMS and practise explaining your own code. Tests and source files alone do not determine an assessor's result.
