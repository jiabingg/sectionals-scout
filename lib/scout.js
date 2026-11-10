// Search and scout pipelines + an in-memory job runner with progress and cancel.
const crypto = require("crypto");
const P = require("./parse");

const DAY = 864e5;
const enc = encodeURIComponent;
const teamPath = (name, year, s) => `/adult/teamprofile.aspx?year=${enc(year)}&teamname=${enc(name)}${s ? "&s=" + enc(s) : ""}`;
const matchPath = (mid, year) => `/adult/matchresults.aspx?year=${enc(year)}&mid=${enc(mid)}`;
const statsPath = (name, year, s) => `/adult/playerstats.aspx?playername=${enc(name)}${s ? "&s=" + enc(s) : ""}&year=${enc(year)}`;
const slug = (s) => String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, "_").slice(0, 180);

async function searchTeams(fetcher, { q, year, league, section }, job) {
  job.update(0.2, `Searching TennisRecord for “${q}” (${year}). Their team search usually takes 20–30 seconds…`);
  const html = await fetcher.postForm("/adult/teamsearch.aspx", { yearnum: year, leaguetypename: league || "", sectionname: section, teamname: q }, { cacheMs: 3600e3, signal: job.signal });
  return P.parseSearch(html);
}

async function scoutTeam(fetcher, { name, year, s, deep }, job) {
  job.update(0.03, `Loading team page · ${name}`);
  const team = P.parseTeam(await fetcher.get(teamPath(name, year, s), { cacheMs: 0, signal: job.signal }));
  if (!team.roster.length) throw Object.assign(new Error(`TennisRecord has no ${year} roster for “${name}”. Check the season, or search again.`), { code: "not_found" });
  team.name = team.name || name;
  team.year = String(year);
  team.matches = [];
  team.deep = {};
  const isMixed = /Mixed/i.test(team.league || team.header || "");
  const doDeep = deep || isMixed; // mixed needs genders for legal pairs
  const total = team.schedule.length + (doDeep ? team.roster.length : 0) + 1;
  let done = 1;
  const tick = (msg) => { done++; job.update(done / (total + 1), msg); };

  // Scorecards never change once played: cache forever. Fetcher limits concurrency.
  const cards = await Promise.all(team.schedule.map(async (sc) => {
    const m = P.parseMatch(await fetcher.get(matchPath(sc.mid, year), { cacheMs: Infinity, signal: job.signal }));
    tick(`Scorecards: ${sc.date || ""} vs ${sc.opp || ""}`);
    m.mid = sc.mid; m.section = sc.section; m.date = m.date || sc.date; m.type = m.type || sc.section + " Match";
    return m;
  }));
  team.matches = cards.filter((m) => m.lines.length);

  if (doDeep) {
    await Promise.all(team.roster.map(async (p) => {
      try {
        team.deep[p.name] = P.parseStats(await fetcher.get(statsPath(p.name, year, p.s), { cacheMs: 0.5 * DAY, signal: job.signal }));
      } catch (e) {
        if (e.code === "cancelled") throw e;
      }
      tick(`Player pages: ${p.name}`);
    }));
  }
  team.fetchedAt = Date.now();
  delete team.schedule;
  team.key = slug(year + "-" + team.name);
  team.s = s || null;
  return team;
}

// ---------- jobs ----------
class Jobs {
  constructor() { this.map = new Map(); setInterval(() => this.gc(), 10 * 60e3).unref(); }
  start(kind, by, fn) {
    const id = crypto.randomBytes(9).toString("base64url");
    const ctrl = new AbortController();
    const job = { id, kind, by, status: "running", progress: 0, message: "Starting…", result: null, error: null, createdAt: Date.now(), updatedAt: Date.now(), ctrl };
    const handle = {
      signal: ctrl.signal,
      update: (p, msg) => { job.progress = Math.max(job.progress, Math.min(1, p)); if (msg) job.message = msg; job.updatedAt = Date.now(); },
    };
    this.map.set(id, job);
    Promise.resolve().then(() => fn(handle)).then(
      (r) => { job.status = "done"; job.progress = 1; job.result = r; job.updatedAt = Date.now(); },
      (e) => { job.status = e && e.code === "cancelled" ? "cancelled" : "error"; job.error = { code: (e && e.code) || "error", message: (e && e.message) || String(e) }; job.updatedAt = Date.now(); if (job.status === "error") console.error(`[job ${kind}]`, e); }
    );
    return job;
  }
  get(id) { return this.map.get(id); }
  view(j) { return j && { id: j.id, kind: j.kind, status: j.status, progress: j.progress, message: j.message, result: j.result, error: j.error }; }
  cancel(id) { const j = this.map.get(id); if (j && j.status === "running") j.ctrl.abort(); return j; }
  gc() { const cut = Date.now() - 3600e3; for (const [k, j] of this.map) if (j.status !== "running" && j.updatedAt < cut) this.map.delete(k); }
}

module.exports = { searchTeams, scoutTeam, Jobs, slug, teamPath, matchPath, statsPath };
