// End-to-end: a mock TennisRecord (fixture pages) + the real app server, driven over HTTP.
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const F = require("./fixtures/pages");
const L = F.league;

function mockTR() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    hits.push(req.method + " " + u.pathname);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "text/html");
      if (u.pathname === "/adult/teamsearch.aspx" && req.method === "POST") {
        const q = new URLSearchParams(body).get("teamname");
        return res.end(F.searchPage(q, L.search(q)));
      }
      if (u.pathname === "/adult/teamprofile.aspx") return res.end(F.teamPage(L.team));
      if (u.pathname === "/adult/matchresults.aspx") {
        const m = L.matches.find((x) => x.mid === u.searchParams.get("mid"));
        return m ? res.end(F.matchPage({ header: "2026 Adult 18+ So California Test M 4.0", ...m })) : (res.statusCode = 404, res.end("nope"));
      }
      if (u.pathname === "/adult/playerstats.aspx") {
        const p = L.stats[u.searchParams.get("playername")];
        return res.end(F.statsPage(p || { name: "x", gender: "Male", ntrp: "4.0", type: "C", edr: "3.9000", record: "1-1", tb3: "0-0" }));
      }
      res.statusCode = 404; res.end("not found");
    });
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, hits, base: `http://127.0.0.1:${srv.address().port}` })));
}

async function startApp(tr, adminPassword) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "scout-"));
  const { createApp } = require("../server");
  const { app, close } = createApp({ dataDir, adminPassword, tr: { base: tr.base, gapMs: 0, concurrency: 2 } });
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (p, opts = {}, key) => {
    const res = await fetch(base + p, { method: opts.method || "GET", headers: { "X-Scout": "1", ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(key ? { "X-Admin-Key": key } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, json, text };
  };
  const wait = async (job) => { while (job.status === "running") { await new Promise((r) => setTimeout(r, 100)); job = (await call("/api/jobs/" + job.id)).json; } return job; };
  return { call, wait, stop: () => { srv.close(); close(); } };
}

test("no password: anyone can view and scout", async () => {
  const tr = await mockTR();
  const { call, wait, stop } = await startApp(tr, "");
  try {
    const me = (await call("/api/me")).json;
    assert.deepStrictEqual([me.admin, me.passwordSet], [true, false]);
    let job = await wait((await call("/api/search", { method: "POST", body: { q: "Test", year: "2026" } })).json);
    assert.strictEqual(job.status, "done", JSON.stringify(job.error));
    assert.strictEqual(job.result.teams.length, 2);
    job = await wait((await call("/api/scout", { method: "POST", body: { name: L.OUR, year: "2026", deep: true } })).json);
    assert.strictEqual(job.status, "done", JSON.stringify(job.error));
    assert.deepStrictEqual([job.result.players, job.result.scorecards, job.result.deep], [8, 3, true]);

    const t = (await call("/api/state")).json.teams[0];
    assert.strictEqual(t.level, "4.0");
    assert.strictEqual(t.matches.filter((m) => !/local/i.test(m.type)).length, 1);
    assert.strictEqual(t.deep["Harper Quinn"].ntrpType, "S");

    // the browser analytics run on this exact JSON
    const core = fs.readFileSync(path.join(__dirname, "..", "public", "core.js"), "utf8");
    const TR = new Function(core + "; return TR;")();
    const A = TR.analyze(t);
    assert.deepStrictEqual(A.slots, ["S1", "S2", "D1", "D2", "D3"]);
    const pred = TR.predict(t, A);
    assert.deepStrictEqual(pred.lineup.S1, ["Avery Stone"]);
    assert.deepStrictEqual([...pred.lineup.D1].sort(), ["Casey Moore", "Drew Patel"]);

    // scorecards are cached: a refresh refetches profile + players only
    const before = tr.hits.filter((h) => h.includes("matchresults")).length;
    job = await wait((await call("/api/scout", { method: "POST", body: { name: L.OUR, year: "2026" } })).json);
    assert.strictEqual(job.status, "done");
    assert.strictEqual(tr.hits.filter((h) => h.includes("matchresults")).length, before);

    // notes are shared; a write without the custom header is refused
    assert.strictEqual((await call("/api/notes/Avery%20Stone", { method: "PUT", body: { text: "Big lefty serve" } })).status, 200);
    assert.strictEqual((await call("/api/state")).json.notes["Avery Stone"].text, "Big lefty serve");
    assert.strictEqual((await call("/api/plans/" + t.key, { method: "POST", body: { teamName: "x", brief: {} } })).status, 400); // no API key
  } finally { stop(); tr.srv.close(); }
});

test("with ADMIN_PASSWORD: viewing is open, scouting needs the password", async () => {
  const tr = await mockTR();
  const { call, wait, stop } = await startApp(tr, "ace-serve-42");
  try {
    let me = (await call("/api/me")).json;
    assert.deepStrictEqual([me.admin, me.passwordSet], [false, true]);
    assert.strictEqual((await call("/api/state")).status, 200);
    assert.strictEqual((await call("/api/search", { method: "POST", body: { q: "Test", year: "2026" } })).status, 403);
    assert.strictEqual((await call("/api/search", { method: "POST", body: { q: "Test", year: "2026" } }, "wrong")).status, 403);
    assert.strictEqual((await call("/api/teams/x", { method: "DELETE" })).status, 403);
    me = (await call("/api/me", {}, "ace-serve-42")).json;
    assert.strictEqual(me.admin, true);
    const job = await wait((await call("/api/scout", { method: "POST", body: { name: L.OUR, year: "2026", deep: false } }, "ace-serve-42")).json);
    assert.strictEqual(job.status, "done", JSON.stringify(job.error));
    assert.strictEqual((await call("/api/state")).json.teams.length, 1);
    assert.strictEqual((await call("/api/notes/Avery%20Stone", { method: "PUT", body: { text: "x" } })).status, 200); // notes stay open
  } finally { stop(); tr.srv.close(); }
});
