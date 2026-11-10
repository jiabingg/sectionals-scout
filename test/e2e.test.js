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

test("sign in, search, scout, read state, notes, prefs, access control", async () => {
  const tr = await mockTR();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "scout-"));
  const { createApp } = require("../server");
  const { app, close } = createApp({ dataDir, adminEmails: ["captain@example.com"], devLoginLinks: true, isLocal: true, baseUrl: "http://localhost", smtp: { host: "" }, tr: { base: tr.base, gapMs: 0, concurrency: 2 } });
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (p, opts = {}, cookie) => {
    const res = await fetch(base + p, { method: opts.method || "GET", redirect: "manual", headers: { "X-Scout": "1", ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, json, text, headers: res.headers };
  };
  const signIn = async (email) => {
    const r = await call("/api/auth/request", { method: "POST", body: { email } });
    assert.strictEqual(r.status, 200, r.text);
    if (!r.json.devLink) return null;
    const token = new URL(r.json.devLink).searchParams.get("token");
    const page = await call("/auth/verify?token=" + token);
    assert.match(page.text, /Finish signing in/); // GET alone doesn't sign in
    const v = await fetch(base + "/auth/verify", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=" + token });
    assert.strictEqual(v.status, 303);
    const again = await fetch(base + "/auth/verify", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=" + token });
    assert.match(again.headers.get("location"), /expired/); // single use
    return v.headers.get("set-cookie").split(";")[0];
  };
  const wait = async (job, cookie) => { while (job.status === "running") { await new Promise((r) => setTimeout(r, 100)); job = (await call("/api/jobs/" + job.id, {}, cookie)).json; } return job; };

  try {
    assert.strictEqual((await call("/api/state")).status, 401);
    assert.strictEqual(await signIn("stranger@example.com"), null); // not on the list: no link, same message
    const admin = await signIn("captain@example.com");
    const me = (await call("/api/me", {}, admin)).json;
    assert.strictEqual(me.role, "admin");

    // CSRF header required
    const noHdr = await fetch(base + "/api/prefs", { method: "PUT", headers: { Cookie: admin, "Content-Type": "application/json" }, body: "{}" });
    assert.strictEqual(noHdr.status, 403);

    let job = (await call("/api/search", { method: "POST", body: { q: "Test", year: "2026" } }, admin)).json;
    job = await wait(job, admin);
    assert.strictEqual(job.status, "done", JSON.stringify(job.error));
    assert.strictEqual(job.result.teams.length, 2);

    job = (await call("/api/scout", { method: "POST", body: { name: L.OUR, year: "2026", deep: true } }, admin)).json;
    job = await wait(job, admin);
    assert.strictEqual(job.status, "done", JSON.stringify(job.error));
    assert.deepStrictEqual([job.result.players, job.result.scorecards, job.result.deep], [8, 3, true]);

    const st = (await call("/api/state", {}, admin)).json;
    assert.strictEqual(st.teams.length, 1);
    const t = st.teams[0];
    assert.strictEqual(t.level, "4.0");
    assert.strictEqual(t.matches.filter((m) => !/local/i.test(m.type)).length, 1);
    assert.strictEqual(t.deep["Harper Quinn"].ntrpType, "S");

    // the browser analytics run on this exact JSON
    const core = fs.readFileSync(path.join(__dirname, "..", "public", "core.js"), "utf8");
    const TR = new Function(core + "; return TR;")();
    const A = TR.analyze(t);
    assert.deepStrictEqual(A.slots, ["S1", "S2", "D1", "D2", "D3"]);
    assert.strictEqual(A.nMatches, 3);
    const pred = TR.predict(t, A);
    assert.deepStrictEqual(pred.lineup.S1, ["Avery Stone"]);
    assert.deepStrictEqual([...pred.lineup.D1].sort(), ["Casey Moore", "Drew Patel"]);

    // scorecards are cached: a refresh refetches profile + players only
    const before = tr.hits.filter((h) => h.includes("matchresults")).length;
    job = await wait((await call("/api/scout", { method: "POST", body: { name: L.OUR, year: "2026", deep: true } }, admin)).json, admin);
    assert.strictEqual(job.status, "done");
    assert.strictEqual(tr.hits.filter((h) => h.includes("matchresults")).length, before);

    // add a member; member can read, note, save prefs, but not scout or manage users
    const add = await call("/api/users", { method: "POST", body: { email: "Teammate@Example.com", role: "member" } }, admin);
    assert.strictEqual(add.json.email, "teammate@example.com");
    const member = await signIn("teammate@example.com");
    assert.strictEqual((await call("/api/me", {}, member)).json.role, "member");
    assert.strictEqual((await call("/api/state", {}, member)).json.teams.length, 1);
    assert.strictEqual((await call("/api/scout", { method: "POST", body: { name: L.OUR, year: "2026" } }, member)).status, 403);
    assert.strictEqual((await call("/api/users", {}, member)).status, 403);
    assert.strictEqual((await call("/api/teams/" + t.key, { method: "DELETE" }, member)).status, 403);
    assert.strictEqual((await call("/api/notes/Avery%20Stone", { method: "PUT", body: { text: "Big lefty serve" } }, member)).status, 200);
    assert.strictEqual((await call("/api/prefs", { method: "PUT", body: { myKey: t.key, avail: { [t.key]: { "Gray Lopez": false } } } }, member)).status, 200);
    const mst = (await call("/api/state", {}, member)).json;
    assert.strictEqual(mst.notes["Avery Stone"].text, "Big lefty serve");
    assert.strictEqual(mst.prefs.avail[t.key]["Gray Lopez"], false);
    assert.strictEqual((await call("/api/state", {}, admin)).json.prefs, null); // prefs are per person

    // plans need an API key
    assert.strictEqual((await call("/api/plans/" + t.key, { method: "POST", body: { teamName: "x", brief: {} } }, admin)).status, 403);

    // removing a member ends their session
    await call("/api/users/teammate%40example.com", { method: "DELETE" }, admin);
    assert.strictEqual((await call("/api/state", {}, member)).status, 401);

    // logout
    await call("/api/auth/logout", { method: "POST", body: {} }, admin);
    assert.strictEqual((await call("/api/me", {}, admin)).status, 401);
  } finally {
    srv.close(); tr.srv.close(); close();
  }
});
