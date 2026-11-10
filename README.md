# Sectionals Scout (website)

Opponent scouting for USTA Southern California league captains. It reads team rosters, scorecards and player pages from TennisRecord.com, then builds:

- **Scouting report**: likely line-up, what stands out, biggest threats, courts to target
- **Roster & ratings**, **Lineup patterns** (who plays where, partnerships, match log)
- **Matchup**: your best line-up against theirs, with win chances by court
- **Game plan** written by Claude (optional, needs your Anthropic API key)

Teammates sign in with their email. Only admins scout teams and manage who has access.

---

## 1. Run it on your PC first

1. Install **Node.js 22 LTS or newer** from nodejs.org.
2. Open a terminal in this folder and run:
   ```
   npm install
   copy .env.example .env      (Mac/Linux: cp .env.example .env)
   ```
3. Edit `.env`: set `ADMIN_EMAILS` to your email. Leave `BASE_URL=http://localhost:3000` and `DEV_LOGIN_LINKS=1`.
4. Start it: `npm start`, then open http://localhost:3000.
5. Enter your email. Without email set up, the sign-in link appears on screen (local only) and in the terminal.

Search for a team and scout it. TennisRecord is slow: the search takes 20–30 seconds, and a full scout (team page, every scorecard, every player) takes a few minutes. Scorecards are cached, so refreshing a team later is faster.

## 2. Email (needed before teammates can sign in)

Sign-in links go out by email over SMTP. Two easy options:

| Service | Settings in `.env` |
|---|---|
| **Gmail** (personal account) | `SMTP_HOST=smtp.gmail.com` · `SMTP_PORT=465` · `SMTP_SECURE=1` · `SMTP_USER=you@gmail.com` · `SMTP_PASS=` a Google **app password** (Google Account → Security → 2-Step Verification → App passwords) |
| **Resend** (free tier, better deliverability) | `SMTP_HOST=smtp.resend.com` · `SMTP_PORT=465` · `SMTP_SECURE=1` · `SMTP_USER=resend` · `SMTP_PASS=` your Resend API key · `MAIL_FROM` must use a domain you verified in Resend |

Then add teammates: **Team access** (top right) → enter their email → **Add** (tick *Email them* to send an invite). They open the site, enter their email, and click the link they receive. Links work once and expire in 20 minutes; sessions last 30 days.

## 3. Put it online

Any host that runs Docker or Node and gives you a **persistent disk** works. The database is one SQLite file in `DATA_DIR`; without a persistent disk it is wiped on every redeploy.

**Railway** (simplest):
1. Push this folder to a private GitHub repo.
2. Railway → New Project → Deploy from GitHub repo (it uses the Dockerfile).
3. Add a **Volume** mounted at `/data`.
4. Variables: everything from `.env` except `DEV_LOGIN_LINKS`, with `BASE_URL=https://<your-app>.up.railway.app` and `DATA_DIR=/data`.
5. Settings → Networking → Generate domain.

**Render**: New → Web Service from your repo (Docker). Add a Disk mounted at `/data` (needs a paid instance; the free tier has no disk). Same variables.

**Fly.io**: `fly launch` (uses the Dockerfile), `fly volumes create data --size 1`, mount it at `/data` in `fly.toml`, `fly secrets set ...` for the variables.

Use the host's HTTPS address as `BASE_URL`. Cookies become `Secure` automatically.

## 4. Game plans (optional)

Set `ANTHROPIC_API_KEY` (console.anthropic.com) to turn on the Game plan tab. Usage is billed to that key. Each plan is a single request, a few cents at most. By default only admins can write plans (`PLANS_FOR=admins`); everyone can read saved plans. The model is set by `ANTHROPIC_MODEL`.

## What each role can do

| | Admin | Member |
|---|---|---|
| Read reports, roster, patterns, game plans | ✓ | ✓ |
| Add player notes (shared with the team) | ✓ | ✓ |
| Matchup: pick "my team", availability, line-ups (saved per person) | ✓ | ✓ |
| Search / scout / refresh / remove teams | ✓ | |
| Write game plans | ✓ | if `PLANS_FOR=members` |
| Team access list | ✓ | |

## Being a good guest on TennisRecord

TennisRecord's robots.txt allows crawling, but it's a small site and it's slow. This app:
- only fetches when an admin clicks something (no background crawling)
- runs at most 2 requests at once (`SCOUT_CONCURRENCY`), 1 second apart (`REQUEST_GAP_MS`)
- caches scorecards forever, player pages for 12 hours, searches for an hour

Please keep it that way, and read TennisRecord's terms before sharing the site widely. Ratings are TennisRecord's estimates; the site is not affiliated with the USTA or TennisRecord.

## If something breaks

- **Search or scout fails with a parse message**: TennisRecord changed its page layout. The parsers are in `lib/parse.js`, and `test/fixtures/pages.js` mirrors the markup they expect.
- **"took longer than 90 s"**: TennisRecord is slow or down. Try again later, or raise `REQUEST_TIMEOUT_MS`.
- **Requests blocked from the host**: some sites block cloud-provider addresses. If scouting works on your PC but not online, that's the likely cause.
- **Nobody gets sign-in emails**: check the SMTP settings; the server log shows the error.

## Project layout

```
server.js           Express app: auth, API, jobs
lib/parse.js        TennisRecord HTML parsers
lib/scout.js        search + scout pipelines, job runner
lib/fetcher.js      polite HTTP client with caching
lib/auth.js         email magic-link sign-in, sessions, team list
lib/plan.js         Claude API call for game plans
lib/db.js           SQLite schema
public/             the web page (core.js = analytics and line-up optimizer)
test/               parser tests + end-to-end test against a mock TennisRecord (npm test)
```
