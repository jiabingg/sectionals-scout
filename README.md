# Sectionals Scout (website)

Opponent scouting for USTA Southern California league captains. It reads team rosters, scorecards and player pages from TennisRecord.com, then builds:

- **Scouting report**: likely line-up, what stands out, biggest threats, courts to target
- **Roster & ratings**, **Lineup patterns** (who plays where, partnerships, match log)
- **Matchup**: your best line-up against theirs, with win chances by court
- **Game plan** written by Claude (optional, needs your Anthropic API key)

There are no accounts. Anyone with the link can read the reports, add player notes and plan line-ups. "My team" and availability are remembered in each person's own browser.

**Recommended:** set `ADMIN_PASSWORD`. Then only someone who enters it (the **Admin** button, top right) can search TennisRecord, scout or remove teams, and write game plans. Each device remembers the password until you click **Lock**. Without it, anyone with the link can do all of that.

---

## 1. Run it on your PC

1. Install **Node.js 22 LTS or newer** from nodejs.org.
2. In this folder: `npm install`, then copy `.env.example` to `.env` (Windows: `copy .env.example .env`).
3. Optionally set `ADMIN_PASSWORD` in `.env`.
4. `npm start`, then open http://localhost:3000.

TennisRecord is slow: a search takes 20–30 seconds, and a full scout (team page, every scorecard, every player) takes a few minutes. Scorecards are cached, so refreshing a team later is faster.

## 2. Put it online (Railway)

1. Push this folder to a private GitHub repo (don't upload `node_modules`, `data` or `.env`).
2. Railway → New Project → Deploy from GitHub repo. It builds with the Dockerfile.
3. Add a **Volume** to the service (right-click the project canvas → Volume) with mount path `/data`.
4. Variables:
   - `DATA_DIR=/data`
   - `RAILWAY_RUN_UID=0` (Railway volumes are owned by root)
   - `ADMIN_PASSWORD=` something only you know
   - `ANTHROPIC_API_KEY=` (optional, for game plans)
   - Leave `PORT` unset; Railway sets it.
5. Service → Settings → Networking → **Generate Domain**. Share that link with your team.

Other hosts (Render, Fly.io) work the same way with the Dockerfile: mount a persistent disk at `/data`. Without one, data is wiped on every redeploy.

## 3. Game plans (optional)

Set `ANTHROPIC_API_KEY` (console.anthropic.com) to turn on the Game plan tab. Usage is billed to that key; each plan is one request. Only admins (people with the admin password) can write plans; everyone can read saved ones. The model is set by `ANTHROPIC_MODEL`.

## Being a good guest on TennisRecord

TennisRecord's robots.txt allows crawling, but it's a small, slow site. This app:
- only fetches when someone clicks (no background crawling), at most 3 lookups at a time
- runs at most 2 requests at once (`SCOUT_CONCURRENCY`), 1 second apart (`REQUEST_GAP_MS`)
- caches scorecards forever, player pages for 12 hours, searches for an hour

Setting `ADMIN_PASSWORD` keeps strangers who find the link from running lookups. Read TennisRecord's terms before sharing the site widely. Ratings are TennisRecord's estimates; the site is not affiliated with the USTA or TennisRecord.

## If something breaks

- **"unable to open database file"** on Railway: add `RAILWAY_RUN_UID=0` and check the volume is mounted at `/data`.
- **Search or scout fails with a parse message**: TennisRecord changed its page layout. The parsers are in `lib/parse.js`, and `test/fixtures/pages.js` mirrors the markup they expect.
- **"took longer than 90 s"**: TennisRecord is slow or down. Try again later, or raise `REQUEST_TIMEOUT_MS`.
- **Works on your PC but not online**: some sites block cloud-provider addresses.

## Project layout

```
server.js           Express app: API, admin password, jobs
lib/parse.js        TennisRecord HTML parsers
lib/scout.js        search + scout pipelines, job runner
lib/fetcher.js      polite HTTP client with caching
lib/plan.js         Claude API call for game plans
lib/db.js           SQLite schema
public/             the web page (core.js = analytics and line-up optimizer)
test/               parser tests + end-to-end tests against a mock TennisRecord (npm test)
```
