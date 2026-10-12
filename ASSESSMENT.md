# Pizza Slice Challenge: assessment and learning guide

**GitHub repository:** [Allspark1983/Pizza-slice-challenge](https://github.com/Allspark1983/Pizza-slice-challenge), branch **`main`**. `README.md` explains how to run the project locally and in Codespaces.

## Project purpose

**Target users:** people taking turns in a casual pizza-slicing game and learners practising an interactive JavaScript application.

**Problem:** players need clear slicing instructions, a consistent judge for cuts and time limits, and separate saved progress.

**Solution:** give each player a randomly selected whole pizza with guide lines. After three seconds of preparation, the player has 20 seconds to make the required full cuts. The REST API checks geometry and the deadline, returns a win/loss verdict, and updates player progress. Best times are compared separately for each pizza size.

The interface uses **plain HTML, CSS, and JavaScript**. The supporting server uses **Node.js built-in modules**, with no third-party framework or package.

## Explain the slicing rules

| Whole pizza | Equal slices | Diameter cuts |
| --- | --- | --- |
| 14 inches | 8 | 4, spaced 45° apart. |
| 10 inches | 6 | 3, spaced 60° apart. |
| 8 inches | 4 | 2, spaced 90° apart. |

A diameter cut travels from one side through the centre to the opposite side. Each diameter forms two opposite slice boundaries. The equally spaced guides show how four full cuts make eight slices. The server chooses the pizza size and guide rotation.

Preparation is excluded from the 20-second playing time. A wrong completed cut loses; an incomplete/outside stroke is ignored; a repeated correct cut has no additional effect. Completing all distinct required cuts before the server deadline wins. At or after the deadline, the round is lost.

To make drawing practical, the accepted line can be within **10° of a guide** and **0.12 pizza radii of the centre**. The normalized pizza centre is `(0, 0)` and radius is `1`; an accepted stroke is counted against its matching guide.

Mouse, touch, and pen drawing submit start/end coordinates. The keyboard angle control and **Make cut** button submit the same kind of stroke. Both use the server's judging rules.

## Requirement mapping

This maps the project to the supplied Module 2 **Agile Front End Development with JavaScript** requirements. It supports review and explanation; it does not guarantee an assessment result.

**Scope:** JSON and AJAX use the project's **local Node REST API**. There is no external SaaS integration. The source and this mapping do not document a separate generative-AI learning activity; supply specifically required evidence of that work separately.

| Requirement | Project evidence | What to explain or demonstrate |
| --- | --- | --- |
| Plain HTML, CSS, and JavaScript. | HTML/CSS/JS interface; Node built-ins for the API. | Explain each file's role and the absence of third-party frameworks. |
| A usable graphical interface. | Player form, pizza board, guides, countdown, controls, and verdict. | Add a player, start a round, make a cut, and show feedback. |
| A specific target group and problem. | The project-purpose section. | Explain why players need consistent judging and separate progress. |
| UI/UX and design thinking. | Preparation, visible guides, keyboard alternative, and feedback. | Connect a design choice with a player's need. |
| CRUD for at least one resource. | Player creation, list, name editing, and deletion. | Perform all four actions on player records. |
| Responsive design for a mobile device. | Responsive CSS and input mapped to game coordinates. | Check layout and touch controls at mobile width. |
| Three DOM properties across two elements. | `elements.cutsDisplay.textContent`, `elements.cutAngle.disabled`, and `elements.timerProgress.value`. | `renderInterface` updates accepted-cut text; `renderClock` enables/disables Make cut and updates the remaining-time bar. |
| At least two event handlers. | `handlePlayerSubmit`, `handlePointerDown`/`handlePointerMove`/`handlePointerUp`, and `submitKeyboardCut`. | Explain the form-submit, pointer, and Make cut events and the data each handler reads. |
| Variables and operators. | Round state, accepted cuts, angles, and time calculations. | Explain a stored value and a calculation using it. |
| Branching and loops. | Cut classification and rendering guides/player lists. | Distinguish ignored, valid, duplicate, and losing cuts. |
| Functions. | Rule helpers such as `applyCut` and `strokeForAngle`; UI functions `performRoundAction`, `renderClock`, and `renderPizza`. | Explain a helper's inputs/return value and how a UI function uses state to send an action or update the page. |
| At least one array and one object. | Player/guide arrays and player, round, point, and `bestTimesBySize` objects. | Explain the size keys `8`, `10`, and `14` and their best-time/null values. |
| One function's return value passed into another. | `renderPlayers(sortPlayersByBestTime(players, leaderboardSize))`. | The inner function returns players ranked for the selected size; `renderPlayers` receives and displays that array. |
| An asynchronous call and fetching JSON. | `fetch` for players, rounds, and cuts. | Explain `async`, `await`, request JSON, and response JSON. |
| An AJAX GET request. | `GET /api/players` and `GET /api/rounds/:id`. | Inspect a request and response in the Network panel. |
| An AJAX POST, PATCH, or PUT request. | POST players/rounds/cuts; PATCH player names. | Explain a request body and its resulting response. |
| GitHub link and source ZIP through the LMS. | Submission steps below. | Verify the actual repository and final ZIP. |
| Individual oral clarification, about 15 minutes. | Practice prompts below. | Explain one complete browser-to-server interaction. |

## Clear CRUD evidence

| CRUD | User action | Request | Effect |
| --- | --- | --- | --- |
| Create | Add a player. | `POST /api/players` | Creates a unique player record. |
| Read | View players or a size's leaderboard. | `GET /api/players` | Retrieves stored progress. |
| Update | Edit a name. | `PATCH /api/players/:id` | Changes the name while preserving identity and progress. |
| Delete | Delete a test player. | `DELETE /api/players/:id` | Removes the player and their associated progress. |

Round actions provide additional API examples. The browser posts strokes to `/api/rounds/:id/cuts`; the **server** updates wins, losses, and best times after judging a result. A name PATCH cannot award wins or submit a client-chosen outcome.

## How the server judges a round

1. `POST /api/rounds` sends the chosen player ID and a unique request ID.
2. The server selects the pizza and guides and sets the preparation period/deadline. An existing active round for that player is resumed.
3. A pointer or keyboard action creates two points. The browser posts `start`, `end`, and a request ID to the cuts endpoint.
4. The server checks time and geometry and returns **`{ round, player, feedback }`**.
5. The browser renders the returned state and verdict. It does not choose the result to save.

A retry reuses the **same request ID and payload** to avoid applying an action twice. This protection lasts while the relevant round is retained: all active rounds plus the latest 100 finished rounds. Refreshing and resuming the same player's round keeps its deadline. Players and rounds are saved together in **`.data/game.json`**, excluded from Git. This separate project starts with fresh data.

Times use when a cut is **processed by the server**, including network and server-queue delays. This is a casual game, not an anti-cheat system. Separate leaderboards keep four-cut and two-cut rounds in their own comparisons.

## Design-thinking explanation

| Stage | Application |
| --- | --- |
| Understand the user. | Players need to see where to cut, understand mistakes, and retain progress. These are design assumptions; formal interviews have not been claimed. |
| Define the problem. | Drawing needs clear judging rules, while different slice counts need separate rankings. |
| Choose an idea. | Use full-diameter guides, server judging, and one leaderboard per size. |
| Build the interaction. | Add preparation, pointer drawing, an angle-control alternative, and visible API feedback. |
| Try and improve. | Ask someone to play each size, explain a loss, and try the keyboard control. Record observed difficulties after doing this. |

## Validation status

| Check | Recorded result |
| --- | --- |
| Slice Challenge syntax: `npm run check`. | Passed with exit code 0. |
| Combined Slice Challenge game/API tests: `npm test`. | All 29 passed: 15 shared game-rule tests and 14 API/storage tests; 0 failures, 0 skipped; exit code 0. |
| Source/DOM reference check. | All 55 selectors resolve; no duplicate IDs or broken label/ARIA references. |
| Browser drawing, countdown, verdicts, keyboard, and mobile layout. | Manual checks have not been performed here. |

These results apply to the slicing implementation. Automated rules/API tests and source checks do not establish that browser interaction or layout has been checked.

## Manual browser checklist

Use the running Node server. Record a result only after observing it.

| Check | Expected result | Your result |
| --- | --- | --- |
| Add, view, rename, and delete test players. | CRUD works and changes remain after refresh. | Not recorded. |
| Submit an empty or invalid name. | Understandable validation feedback appears. | Not recorded. |
| Start a round. | A server-selected pizza and guides appear, then preparation and the playing period. | Not recorded. |
| Cut during preparation. | The cut does not count. | Not recorded. |
| Play a 14-inch round. | Four distinct correct cuts make eight equal slices and win before the deadline. | Not recorded. |
| Play a 10-inch round. | Three distinct correct cuts make six equal slices and win before the deadline. | Not recorded. |
| Play an 8-inch round. | Two distinct correct cuts make four equal slices and win before the deadline. | Not recorded. |
| Make a completed cut away from the required guides. | The server returns a loss once. | Not recorded. |
| Make a short or outside stroke. | It is ignored and does not add a cut. | Not recorded. |
| Repeat a correct cut. | Progress does not increase again and no loss is added. | Not recorded. |
| Let the deadline expire. | The server reports a loss; further cuts cannot change it into a win. | Not recorded. |
| Refresh or switch tabs during a round. | Resuming retains the state and original deadline. | Not recorded. |
| Start again for a player with an active round. | The existing round resumes with its original deadline. | Not recorded. |
| Interrupt and retry a request. | The same request ID does not duplicate a round, cut, or result. | Not recorded. |
| Compare different pizza sizes. | Each leaderboard uses that size's successful times. | Not recorded. |
| Restart the server in the same Codespace. | Records remain and active rounds keep their deadlines. | Not recorded. |
| Try mouse, touch, and keyboard angle/Make cut input. | Each submits the same kind of stroke for judging. | Not recorded. |
| Use a viewport such as 390 × 844 pixels. | Controls fit, touch coordinates align, and the page needs no horizontal scrolling. | Not recorded. |
| Inspect Network requests and feedback. | GET reads state; POST creates rounds/submits cuts; responses supply the displayed verdict. | Not recorded. |

Use deterministic automated tests for exact geometry tolerances, duplicate requests, and deadline boundaries; hand-drawn strokes cannot check those precisely.

## Practise explaining the code

### Example: submitting a cut

“The pointer or keyboard handler creates a start point and an end point. JavaScript posts the points and a request ID. The server checks the deadline and whether the line follows a required diameter. It saves round and player changes together, then returns JSON. The browser displays the accepted cut or win/loss message.”

### Questions to answer in your own words

1. Why do four full cuts create eight equal slices?
2. What does the server choose when it creates a round?
3. Why is preparation excluded from the finish time?
4. How do wrong completed cuts, incomplete strokes, and duplicate correct cuts differ?
5. What are the four player CRUD actions?
6. Why does a player need an ID as well as a name?
7. Where are arrays and objects used?
8. What do `document.querySelector()` and `appendChild()` do here?
9. How are pointer positions converted to the coordinates sent to the API?
10. How does the keyboard control produce the same kind of stroke?
11. What do `async`, `await`, `fetch`, and `response.json()` do?
12. Why does the browser send coordinates instead of “I won”?
13. Why must retries reuse the same request ID?
14. Why does refreshing not reset the deadline?
15. Why are best times compared separately for each size?
16. Which function returns a sorted array, and which function renders it?
17. What is in `.data/game.json`, and is it included in Git commits?
18. Which checks need a browser, and which use fixed coordinates and times?

Follow **the event, request, server decision, and rendered response** for one action at a time. Check actual function names and comments as you practise.

## Submission preparation

1. Run `npm run check` and `npm test`; resolve failures and record fresh results.
2. Complete the browser checks, including mobile and keyboard controls.
3. Commit and push to **`main`** in `Allspark1983/Pizza-slice-challenge`.
4. Open the actual repository and verify the final code is present.
5. Create a source ZIP with project/configuration files; exclude runtime `.data` and Git's `.git` folder.
6. Submit the verified repository URL and source ZIP through the LMS as instructed.
7. Prepare to explain CRUD, DOM changes, events, geometry, REST requests, server judging, and responsiveness during the individual oral clarification.

Keep checked results, assumptions, and unfinished work identified. Source files and automated tests alone do not determine an assessor's result.
