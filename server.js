// Sectionals Scout web server.
const path = require("path");
const express = require("express");
const cfg = require("./lib/config");
const { open } = require("./lib/db");
const { Fetcher } = require("./lib/fetcher");
const { createAuth } = require("./lib/auth");
const { searchTeams, scoutTeam, Jobs } = require("./lib/scout");
const { writePlan } = require("./lib/plan");

function createApp(options = {}) {
  const c = { ...cfg, ...options, tr: { ...cfg.tr, ...(options.tr || {}) } };
  const db = open(c.dataDir);
  const auth = createAuth(db, c);
  const fetcher = new Fetcher(db, c.tr);
  const jobs = new Jobs();
  const app = express();
  if (c.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  const Q = {
    teams: db.prepare("SELECT key, json FROM teams ORDER BY updated_at DESC"),
    putTeam: db.prepare("INSERT INTO teams (key, name, year, league, json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, year = excluded.year, league = excluded.league, json = excluded.json, updated_at = excluded.updated_at, updated_by = excluded.updated_by"),
    delTeam: db.prepare("DELETE FROM teams WHERE key = ?"),
    delPlan: db.prepare("DELETE FROM plans WHERE team_key = ?"),
    notes: db.prepare("SELECT player, text, updated_by, updated_at FROM notes"),
    putNote: db.prepare("INSERT INTO notes (player, text, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(player) DO UPDATE SET text = excluded.text, updated_by = excluded.updated_by, updated_at = excluded.updated_at"),
    delNote: db.prepare("DELETE FROM notes WHERE player = ?"),
    plans: db.prepare("SELECT team_key, text, my_name, by_email, at FROM plans"),
    putPlan: db.prepare("INSERT INTO plans (team_key, text, my_name, by_email, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(team_key) DO UPDATE SET text = excluded.text, my_name = excluded.my_name, by_email = excluded.by_email, at = excluded.at"),
    prefs: db.prepare("SELECT json FROM prefs WHERE email = ?"),
    putPrefs: db.prepare("INSERT INTO prefs (email, json) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET json = excluded.json"),
  };

  // security headers
  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false, limit: "8kb" }));
  app.use(auth.middleware);

  // CSRF: state-changing API calls must carry a custom header (cross-site forms can't set it).
  app.use("/api", (req, res, next) => {
    if (req.method !== "GET" && req.get("X-Scout") !== "1") return res.status(403).json({ error: "Missing request header." });
    next();
  });
  const need = (role) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Sign in first." });
    if (role === "admin" && req.user.role !== "admin") return res.status(403).json({ error: "Only the team admin can do that." });
    next();
  };
  const canPlan = (u) => !!c.anthropicKey && !!u && (u.role === "admin" || c.plansFor === "members");
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(e.status || 500).json({ error: e.message || "Server error" }); });

  // ---------- auth ----------
  app.post("/api/auth/request", wrap(async (req, res) => {
    const r = await auth.requestLink(req.body && req.body.email, req.ip);
    res.status(r.ok ? 200 : 400).json(r);
  }));
  app.get("/auth/verify", (req, res) => res.type("html").send(auth.verifyPage(req.query.token)));
  app.post("/auth/verify", (req, res) => {
    const sid = auth.consume(req.body && req.body.token);
    if (!sid) return res.redirect(303, "/?signin=expired");
    res.set("Set-Cookie", auth.cookieHeader(sid, auth.SESSION_MS));
    res.redirect(303, "/");
  });
  app.post("/api/auth/logout", (req, res) => { auth.logout(req); res.set("Set-Cookie", auth.cookieHeader("", 0)); res.json({ ok: true }); });

  app.get("/api/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Sign in first.", appName: c.appName });
    res.json({ email: req.user.email, role: req.user.role, appName: c.appName, section: c.section, features: { plans: canPlan(req.user), mail: auth.mailReady } });
  });

  // ---------- data ----------
  app.get("/api/state", need(), (req, res) => {
    const teams = Q.teams.all().map((r) => { try { const t = JSON.parse(r.json); t.key = r.key; return t; } catch (e) { return null; } }).filter(Boolean);
    const notes = Object.fromEntries(Q.notes.all().map((n) => [n.player, { player: n.player, text: n.text, by: n.updated_by, updatedAt: n.updated_at }]));
    const plans = Object.fromEntries(Q.plans.all().map((p) => [p.team_key, { text: p.text, myName: p.my_name, by: p.by_email, at: p.at }]));
    const pr = Q.prefs.get(req.user.email);
    res.json({ teams, notes, plans, prefs: pr ? JSON.parse(pr.json) : null });
  });
  app.put("/api/prefs", need(), (req, res) => {
    const p = req.body || {};
    const clean = { myKey: typeof p.myKey === "string" ? p.myKey.slice(0, 200) : null, oppKey: typeof p.oppKey === "string" ? p.oppKey.slice(0, 200) : null, avail: p.avail && typeof p.avail === "object" ? p.avail : {} };
    const json = JSON.stringify(clean);
    if (json.length > 100000) return res.status(400).json({ error: "Too large." });
    Q.putPrefs.run(req.user.email, json);
    res.json({ ok: true });
  });
  app.put("/api/notes/:player", need(), (req, res) => {
    const player = String(req.params.player).slice(0, 120);
    const text = String((req.body && req.body.text) || "").trim().slice(0, 2000);
    if (text) Q.putNote.run(player, text, req.user.email, Date.now()); else Q.delNote.run(player);
    res.json({ ok: true });
  });
  app.delete("/api/teams/:key", need("admin"), (req, res) => { Q.delTeam.run(req.params.key); Q.delPlan.run(req.params.key); res.json({ ok: true }); });

  // ---------- TennisRecord jobs (admin) ----------
  app.post("/api/search", need("admin"), (req, res) => {
    const q = String((req.body && req.body.q) || "").trim().slice(0, 80);
    const year = String((req.body && req.body.year) || "").replace(/\D/g, "").slice(0, 4);
    const league = String((req.body && req.body.league) || "").slice(0, 40);
    if (!q || !year) return res.status(400).json({ error: "Enter a team name and season." });
    const job = jobs.start("search", req.user.email, (h) => searchTeams(fetcher, { q, year, league, section: c.section }, h));
    res.json(jobs.view(job));
  });
  app.post("/api/scout", need("admin"), (req, res) => {
    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 160);
    const year = String(b.year || "").replace(/\D/g, "").slice(0, 4);
    if (!name || !year) return res.status(400).json({ error: "Missing team or season." });
    const by = req.user.email;
    const job = jobs.start("scout", by, async (h) => {
      const team = await scoutTeam(fetcher, { name, year, s: b.s ? String(b.s).slice(0, 8) : null, deep: b.deep !== false }, h);
      Q.putTeam.run(team.key, team.name, team.year, team.league || "", JSON.stringify(team), team.fetchedAt, by);
      return { key: team.key, name: team.name, players: team.roster.length, scorecards: team.matches.length, deep: Object.keys(team.deep).length > 0 };
    });
    res.json(jobs.view(job));
  });
  app.get("/api/jobs/:id", need("admin"), (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ error: "That job is gone. Start again." });
    res.json(jobs.view(j));
  });
  app.post("/api/jobs/:id/cancel", need("admin"), (req, res) => res.json(jobs.view(jobs.cancel(req.params.id)) || {}));

  // ---------- game plan ----------
  app.post("/api/plans/:key", need(), wrap(async (req, res) => {
    if (!canPlan(req.user)) return res.status(403).json({ error: "Game plans aren't turned on for your account." });
    const brief = req.body && req.body.brief;
    const teamName = String((req.body && req.body.teamName) || "").slice(0, 160);
    if (!brief || JSON.stringify(brief).length > 150000) return res.status(400).json({ error: "Missing or oversized scouting data." });
    const text = await writePlan(c, teamName, brief);
    const rec = { text, myName: brief.myTeam ? String(brief.myTeam.name).slice(0, 160) : null, by: req.user.email, at: Date.now() };
    Q.putPlan.run(req.params.key, rec.text, rec.myName, rec.by, rec.at);
    res.json(rec);
  }));

  // ---------- team access (admin) ----------
  app.get("/api/users", need("admin"), (req, res) => res.json({ users: auth.listUsers(), mail: auth.mailReady }));
  app.post("/api/users", need("admin"), wrap(async (req, res) => {
    const email = auth.addUser(req.body && req.body.email, req.body && req.body.role, req.user.email);
    let emailed = false;
    if (req.body && req.body.notify && auth.mailReady) {
      try { emailed = await auth.sendMail(email, `You're invited to ${c.appName}`, `${req.user.email} added you to ${c.appName}, the team's scouting reports.\n\nOpen ${c.baseUrl} and sign in with this email address.`, `<p>${req.user.email} added you to <b>${c.appName}</b>, the team's scouting reports.</p><p><a href="${c.baseUrl}">Open ${c.appName}</a> and sign in with this email address.</p>`); } catch (e) { console.error("[mail]", e.message); }
    }
    res.json({ ok: true, email, emailed, users: auth.listUsers() });
  }));
  app.delete("/api/users/:email", need("admin"), wrap(async (req, res) => {
    if (String(req.params.email).toLowerCase() === req.user.email) return res.status(400).json({ error: "You can't remove yourself." });
    auth.removeUser(req.params.email);
    res.json({ ok: true, users: auth.listUsers() });
  }));

  app.get("/healthz", (req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, "public"), { index: "index.html", maxAge: "1h" }));
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

  return { app, db, close: () => db.close() };
}

if (require.main === module) {
  if (!cfg.adminEmails.length) console.warn("WARNING: ADMIN_EMAILS is empty, so nobody can sign in. Set it in .env.");
  if (!cfg.smtp.host) console.warn(cfg.devLoginLinks && cfg.isLocal ? "Email not configured: sign-in links will show on screen (DEV_LOGIN_LINKS=1, localhost only)." : "Email not configured: sign-in links are printed in this console only.");
  const { app } = createApp();
  app.listen(cfg.port, () => console.log(`${cfg.appName} running at ${cfg.baseUrl} (port ${cfg.port})`));
}

module.exports = { createApp };
