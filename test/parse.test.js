const test = require("node:test");
const assert = require("node:assert");
const P = require("../lib/parse");
const F = require("./fixtures/pages");
const L = F.league;

test("search results", () => {
  const r = P.parseSearch(F.searchPage("Test", L.search("Test")));
  assert.strictEqual(r.count, 2);
  assert.deepStrictEqual(r.teams.map((t) => t.name), [L.OUR, "Test - Harbor Hawks 3.5"]);
  assert.strictEqual(r.teams[0].type, "Adult 18+");
  assert.strictEqual(r.teams[0].gender, "M");
  assert.strictEqual(r.teams[0].level, "4.0");
});

test("search with no matches still parses; unexpected page throws", () => {
  assert.strictEqual(P.parseSearch(F.searchPage("zzz", [])).count, 0);
  assert.throws(() => P.parseSearch("<html><body>Server busy</body></html>"));
});

test("team profile: header, roster (desktop table only), schedule sections", () => {
  const t = P.parseTeam(F.teamPage(L.team));
  assert.strictEqual(t.league, "Adult 18+");
  assert.strictEqual(t.section, "So California");
  assert.strictEqual(t.gender, "M");
  assert.strictEqual(t.level, "4.0");
  assert.strictEqual(t.name, L.OUR);
  assert.match(t.flight, /Men's 4.0/);
  assert.strictEqual(t.roster.length, 8);
  const a = t.roster[0];
  assert.deepStrictEqual([a.name, a.ntrp, a.rating, a.record, a.localS, a.localD, a.loc], ["Avery Stone", "4.0", 3.98, "8-2", "2-0", "1-1", "Test City, CA"]);
  assert.strictEqual(t.roster[7].s, "3");
  assert.deepStrictEqual(t.schedule.map((s) => [s.mid, s.section, s.date]), [["9001", "Local", "03/01/2026"], ["9002", "Local", "03/15/2026"], ["9003", "Sectional", "07/18/2026"]]);
  assert.strictEqual(t.schedule[0].opp, L.OPP);
});

test("scorecard: players, ratings, scores, winner side", () => {
  const m = P.parseMatch(F.matchPage({ header: "2026 Adult 18+ So California Test M 4.0", ...L.matches[0] }));
  assert.strictEqual(m.date, "03/01/2026");
  assert.strictEqual(m.type, "Local Match");
  assert.strictEqual(m.home, L.OUR);
  assert.strictEqual(m.visit, L.OPP);
  assert.deepStrictEqual(m.lines.map((l) => l.line), ["S1", "S2", "D1", "D2", "D3"]);
  assert.deepStrictEqual(m.lines.map((l) => l.winner), ["home", "home", "visit", "home", "visit"]);
  assert.deepStrictEqual(m.lines[2].home, ["Casey Moore", "Drew Patel"]);
  assert.deepStrictEqual(m.lines[2].visitRs, [3.9, 3.8]);
  assert.strictEqual(m.lines[1].score, "4-6 6-3 1-0");
  assert.strictEqual(m.lines[0].homeR, 3.98);
});

test("player stats", () => {
  const s = P.parseStats(F.statsPage(L.stats["Harper Quinn"]));
  assert.strictEqual(s.gender, "M");
  assert.strictEqual(s.ntrp, "3.5");
  assert.strictEqual(s.ntrpType, "S");
  assert.strictEqual(s.edr, 3.6642);
  assert.strictEqual(s.record, "13-10 (56.5%)");
  assert.strictEqual(s.streak, "W1");
  assert.strictEqual(s.post, "1-1 (50.0%)");
  assert.strictEqual(s.avgOpp, 3.7768);
  assert.deepStrictEqual(s.gps, { s1: 4.48, s2: 4.87, s3: 2.25, tot: 4.32 });
});
