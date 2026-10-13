# Deploy Pizza Slice Rush 3.3 to Railway

This is a **full-stack Node.js game**, not a static site. The Node server serves the webpage, controls rounds and cut scoring, and provides the player/leaderboard REST API. **GitHub Pages alone cannot host it.**

## Create the online service

1. Sign in to [Railway](https://railway.com/) and link your GitHub account.
2. Select **New Project → Deploy from GitHub Repo** and choose **Allspark1983/Pizza-slice-challenge**, branch **main**.
3. Railway should detect `package.json`. If asked for a start command, set **`npm start`**. This project needs **Node.js 22+** and has no third-party packages to install.
4. Add a **persistent volume** to the game service and set its mount path to **`/data`**. Do this before allowing public scores. Railway injects `RAILWAY_VOLUME_MOUNT_PATH`; `server.js` uses it automatically for `rush-3.1.json`. Without a volume, saved records are ephemeral and may disappear after a redeploy.
5. Under the service's **Settings → Networking**, choose **Generate Domain**. The resulting HTTPS URL is the game link to share. Keep the service to **one replica** because it uses one JSON file.
6. Visit the public URL; create a test player; play a complete round; confirm that the leaderboard updates. Redeploy and confirm that the records remain after restart.

Railway automatically supplies `PORT` and `RAILWAY_PROJECT_ID`. The server listens on `0.0.0.0` on Railway and on `127.0.0.1` locally by default. `HOST` overrides this, and `DATA_DIR` can override the storage directory if needed.

## Before an unrestricted public launch

- **The game has no player login or authorization.** Player names are *not* authenticated identities. In this version anyone with network access can select a profile and can potentially rename or delete records via the REST API. Use for a small, trusted test group only, not a competitive public leaderboard, until identity protection and abuse controls are added.
- The shared leaderboard contains **only records on this hosted instance**. Local Codespaces `.data/` records are **not copied automatically** to Railway. To migrate them, restore a validated `rush-3.1.json` into the volume before receiving new player data.
- Don't commit your `.data/` folder or secrets to GitHub. `.data/` is ignored by `.gitignore`.
- Hosting and storage may incur Railway charges. Review plan, usage and volume pricing before deploying. Back up the volume if scores matter.
- After editing and pushing code to `main`, a linked Railway GitHub service can redeploy the updated game.

## Quick health check

A successful load of `/` serves the game interface. `GET /api/leaderboard` should return JSON such as:

```json
{"entries":[],"totalPlayers":0}
```

Players will appear here after completing their first game.

## Run locally

```bash
npm run check
npm test
npm start
```

Open `http://localhost:3000` in your browser.
