// Sectionals Scout web server. No accounts: anyone with the link can view reports.
// If ADMIN_PASSWORD is set, scouting, removing teams and writing game plans need it.
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cfg = require("./lib/config");
const { open } = require("./lib/db");
const { Fetcher } = require("./lib/fetcher");
const { searchTeams, scoutTeam, Jobs } = require("./lib/scout");
const { writePlan } = require("./lib/plan");

function createApp(options = {}) {
  const c = { ...cfg, ...options, tr: { ...cfg.tr, ...(options.tr || {}) } };
  const db = open(c.dataDir);
  const fetcher = new Fetcher(db, c.tr);
  const jobs = new Jobs();
  const app = express();
  if (c.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  const Q = {
    teams: db.prepare("SELECT key, json FROM teams ORDER BY updated_at DESC"),
    putTeam: db.prepare("INSERT INTO teams (key, name, year, league, json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, year = excluded.year, league = excluded.league, json = excluded.json, updated_at = excluded.updated_at"),
    delTeam: db.prepare("DELETE FROM teams WHERE key = ?"),
    delPlan: db.prepare("DELETE FROM plans WHERE team_key = ?"),
    notes: db.prepare("SELECT player, text, updated_at FROM notes"),
    putNote: db.prepare("INSERT INTO notes (player, text, updated_at) VALUES (?, ?, ?) ON CONFLICT(player) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at"),
    delNote: db.prepare("DELETE FROM notes WHERE player = ?"),
    plans: db.prepare("SELECT team_key, text, my_name, at FROM plans"),
    putPlan: db.prepare("INSERT INTO plans (team_key, text, my_name, at) VALUES (?, ?, ?, ?) ON CONFLICT(team_key) DO UPDATE SET text = excluded.text, my_name = excluded.my_name, at = excluded.at"),
  };

  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });
  app.use(express.json({ limit: "2mb" }));

  // Other sites can't make a visitor's browser change data here: writes need a custom header.
  app.use("/api", (req, res, next) => {
    if (req.method !== "GET" && req.get("X-Scout") !== "1") return res.status(403).json({ error: "Missing request header." });
    next();
  });

  const pw = Buffer.from(c.adminPassword || "");
  const isAdmin = (req) => {
    if (!pw.length) return true;
    const got = Buffer.from(String(req.get("X-Admin-Key") || ""));
    return got.length === pw.length && crypto.timingSafeEqual(got, pw);
  };
  // slow down password guessing
  const fails = new Map();
  const adminOnly = (req, res, next) => {
    if (isAdmin(req)) return next();
    const k = req.ip, now = Date.now();
    const arr = (fails.get(k) || []).filter((t) => now - t < 15 * 60e3);
    arr.push(now); fails.set(k, arr);
    setTimeout(() => res.status(403).json({ error: arr.length > 10 ? "Too many wrong passwords. Try again later." : "Admin password needed for that.", code: "admin" }), Math.min(arr.length, 10) * 300);
  };
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(e.status || 500).json({ error: e.message || "Server error" }); });

  app.get("/api/me", (req, res) => {
    const admin = isAdmin(req);
    res.json({ admin, passwordSet: pw.length > 0, appName: c.appName, section: c.section, features: { plans: !!c.anthropicKey && admin } });
  });

  // ---------- data (open to everyone with the link) ----------
  app.get("/api/state", (req, res) => {
    const teams = Q.teams.all().map((r) => { try { const t = JSON.parse(r.json); t.key = r.key; return t; } catch (e) { return null; } }).filter(Boolean);
    const notes = Object.fromEntries(Q.notes.all().map((n) => [n.player, { player: n.player, text: n.text, updatedAt: n.updated_at }]));
    const plans = Object.fromEntries(Q.plans.all().map((p) => [p.team_key, { text: p.text, myName: p.my_name, at: p.at }]));
    res.json({ teams, notes, plans });
  });
  app.put("/api/notes/:player", (req, res) => {
    const player = String(req.params.player).slice(0, 120);
    const text = String((req.body && req.body.text) || "").trim().slice(0, 2000);
    if (text) Q.putNote.run(player, text, Date.now()); else Q.delNote.run(player);
    res.json({ ok: true });
  });

  // ---------- admin ----------
  app.delete("/api/teams/:key", adminOnly, (req, res) => { Q.delTeam.run(req.params.key); Q.delPlan.run(req.params.key); res.json({ ok: true }); });

  const busy = () => [...jobs.map.values()].filter((j) => j.status === "running").length >= 3;
  app.post("/api/search", adminOnly, (req, res) => {
    const q = String((req.body && req.body.q) || "").trim().slice(0, 80);
    const year = String((req.body && req.body.year) || "").replace(/\D/g, "").slice(0, 4);
    const league = String((req.body && req.body.league) || "").slice(0, 40);
    if (!q || !year) return res.status(400).json({ error: "Enter a team name and season." });
    if (busy()) return res.status(429).json({ error: "Other lookups are still running. Try again in a minute." });
    res.json(jobs.view(jobs.start("search", req.ip, (h) => searchTeams(fetcher, { q, year, league, section: c.section }, h))));
  });
  app.post("/api/scout", adminOnly, (req, res) => {
    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 160);
    const year = String(b.year || "").replace(/\D/g, "").slice(0, 4);
    if (!name || !year) return res.status(400).json({ error: "Missing team or season." });
    if (busy()) return res.status(429).json({ error: "Other lookups are still running. Try again in a minute." });
    const job = jobs.start("scout", req.ip, async (h) => {
      const team = await scoutTeam(fetcher, { name, year, s: b.s ? String(b.s).slice(0, 8) : null, deep: b.deep !== false }, h);
      Q.putTeam.run(team.key, team.name, team.year, team.league || "", JSON.stringify(team), team.fetchedAt);
      return { key: team.key, name: team.name, players: team.roster.length, scorecards: team.matches.length, deep: Object.keys(team.deep).length > 0 };
    });
    res.json(jobs.view(job));
  });
  app.get("/api/jobs/:id", (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ error: "That lookup is gone. Start again." });
    res.json(jobs.view(j));
  });
  app.post("/api/jobs/:id/cancel", adminOnly, (req, res) => res.json(jobs.view(jobs.cancel(req.params.id)) || {}));

  app.post("/api/plans/:key", adminOnly, wrap(async (req, res) => {
    if (!c.anthropicKey) return res.status(400).json({ error: "Game plans need ANTHROPIC_API_KEY on the server." });
    const brief = req.body && req.body.brief;
    const teamName = String((req.body && req.body.teamName) || "").slice(0, 160);
    if (!brief || JSON.stringify(brief).length > 150000) return res.status(400).json({ error: "Missing or oversized scouting data." });
    const text = await writePlan(c, teamName, brief);
    const rec = { text, myName: brief.myTeam ? String(brief.myTeam.name).slice(0, 160) : null, at: Date.now() };
    Q.putPlan.run(req.params.key, rec.text, rec.myName, rec.at);
    res.json(rec);
  }));

  app.get("/healthz", (req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, "public"), { index: "index.html", maxAge: "1h" }));
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

  return { app, db, close: () => db.close() };
}

if (require.main === module) {
  if (!cfg.adminPassword) console.warn("Note: ADMIN_PASSWORD is not set, so anyone with the link can scout and remove teams.");
  const { app } = createApp();
  app.listen(cfg.port, () => console.log(`${cfg.appName} running on port ${cfg.port}`));
}

module.exports = { createApp };
