// ===== Sectionals Scout website UI =====
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f2 = (v) => (v == null || isNaN(v) ? "–" : (+v).toFixed(2));
const pct = (p) => (p == null ? "–" : Math.round(p * 100) + "%");
const slug = (s) => String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, "_").slice(0, 180);
const short = (n) => { const p = String(n).trim().split(/\s+/); return p.length > 1 ? p[0] + " " + p[p.length - 1][0] + "." : n; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const S = { teams: {}, cfg: { myKey: null, oppKey: null, avail: {} }, notes: {}, plans: {}, tab: "overview", scen: "pred", custom: null, mine: null, example: false, busy: false };
let ME = null, currentJob = null, lastHits = null;
const isAdmin = () => !!ME && ME.admin;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} },
};


// ---------- API ----------
async function api(path, opts) {
  opts = opts || {};
  const key = store.get("ss_admin");
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: Object.assign({ "X-Scout": "1" }, key ? { "X-Admin-Key": key } : {}, opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    if (data.code === "admin" && ME && ME.admin) { store.set("ss_admin", null); ME.admin = false; applyRole(); }
    throw Object.assign(new Error(data.error || "Request failed (" + res.status + ")"), { status: res.status, data });
  }
  return data;
}

// Runs a server job (search or scout) and reports its progress until it finishes.
async function runJob(path, body) {
  let j = await api(path, { method: "POST", body });
  currentJob = j.id;
  try {
    while (j.status === "running") {
      progress(esc(j.message || "Working…"), j.progress);
      await sleep(1500);
      j = await api("/api/jobs/" + j.id);
    }
  } finally { currentJob = null; }
  if (j.status === "done") return j.result;
  throw Object.assign(new Error((j.error && j.error.message) || "The lookup failed."), { code: j.status === "cancelled" ? "user_cancel" : (j.error && j.error.code) || "error" });
}

// ---------- boot ----------
(function seasons() {
  const y = new Date().getFullYear(), sel = $("#yearSel");
  sel.innerHTML = [y + 1, y, y - 1, y - 2, y - 3].map((v) => `<option ${v === y ? "selected" : ""}>${v}</option>`).join("");
})();
async function boot() {
  try { ME = await api("/api/me"); } catch (e) { return fatal(e); }
  applyRole();
  render();
  await loadState();
}

// Shows or hides the scouting controls for this viewer.
function applyRole() {
  const admin = isAdmin();
  $("#controls").hidden = !admin;
  const b = $("#adminBtn");
  b.hidden = !ME.passwordSet;
  b.textContent = admin ? "Lock" : "Admin";
  b.title = admin ? "Forget the admin password on this device" : "Enter the admin password to scout teams";
  setLive(admin ? "Scouting on" : "View only", admin ? "You can search TennisRecord and scout teams." : "Reports are read-only. Player notes and line-up planning still work.");
  if (S.tab) render();
}

async function loadState() {
  let st;
  try { st = await api("/api/state"); } catch (e) { return fatal(e); }
  const teams = {};
  (st.teams || []).forEach((t) => (teams[t.key] = t));
  S.notes = {}; Object.entries(st.notes || {}).forEach(([player, n]) => (S.notes[slug(player)] = n));
  S.plans = st.plans || {};
  if (Object.keys(teams).length) {
    S.example = false; S.teams = teams;
    let saved = {};
    try { saved = JSON.parse(store.get("ss_cfg") || "{}") || {}; } catch (e) {}
    S.cfg = Object.assign({ myKey: null, oppKey: null, avail: {} }, saved);
    if (S.cfg.myKey && !teams[S.cfg.myKey]) S.cfg.myKey = null;
    if (S.cfg.oppKey && !teams[S.cfg.oppKey]) S.cfg.oppKey = null;
  } else { S.teams = {}; loadExample(); }
  render();
}

function fatal(e) { $("#report").innerHTML = `<div class="notice err">${esc(e.message || "Couldn't reach the server.")} <a href="/">Try again</a></div>`; }

// ---------- admin password ----------
function openAdmin() {
  if (isAdmin()) { store.set("ss_admin", null); ME.admin = false; applyRole(); showMsg("Locked. This device no longer has the admin password."); return; }
  const dlg = $("#adminDlg");
  $("#adminPw").value = ""; $("#adminErr").textContent = "";
  dlg.showModal();
  $("#adminForm").onsubmit = async (ev) => {
    ev.preventDefault();
    store.set("ss_admin", $("#adminPw").value);
    try { ME = await api("/api/me"); } catch (e) {}
    if (ME && ME.admin) { dlg.close(); applyRole(); showMsg("Scouting unlocked on this device.", "ok"); return; }
    store.set("ss_admin", null);
    $("#adminErr").textContent = "That password didn't work.";
  };
}

function setLive(t, title) { const el = $("#liveState"); el.textContent = t; el.title = title || ""; }
async function saveCfg(patch) {
  Object.assign(S.cfg, patch);
  if (!S.example) store.set("ss_cfg", JSON.stringify({ myKey: S.cfg.myKey, oppKey: S.cfg.oppKey, avail: S.cfg.avail || {} }));
  render();
}

function explain(e) {
  const c = e && e.code;
  if (c === "user_cancel") return "Stopped. Anything already saved is still on the board.";
  return esc((e && e.message) || "Something interrupted the lookup. Try again in a moment.");
}
function showMsg(html, kind) { $("#msg").innerHTML = html ? `<div class="notice ${kind || ""}" style="margin-top:10px">${html}</div>` : ""; }
function progress(text, frac) {
  const st = $("#status");
  if (text == null) { st.hidden = true; return; }
  st.hidden = false; $("#statusText").innerHTML = text + ` <button class="btn small" id="stopBtn" type="button" style="margin-left:8px">Stop</button>`;
  $("#statusBar").style.width = Math.round((frac || 0) * 100) + "%";
  $("#stopBtn").onclick = () => { if (currentJob) api("/api/jobs/" + currentJob + "/cancel", { method: "POST", body: {} }).catch(() => {}); };
}

// ---------- search ----------
$("#searchForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const q = $("#teamInput").value.trim(); const year = $("#yearSel").value; const league = $("#leagueSel").value;
  if (!q || S.busy) return;
  $("#results").innerHTML = ""; showMsg("");
  S.busy = true; $("#searchBtn").disabled = true;
  try {
    const r = await runJob("/api/search", { q, year, league });
    progress(null);
    const hits = r.teams || [];
    if (!hits.length) showMsg(`No ${esc(year)} ${esc(ME.section)} teams match “${esc(q)}”. Try a shorter piece of the name (a club or captain), another league type, or another season.`);
    else if (hits.length === 1) await scout(hits[0], year);
    else showHits(hits, year);
  } catch (e) { progress(null); showMsg(explain(e), "err"); }
  finally { S.busy = false; $("#searchBtn").disabled = false; }
});

function showHits(hits, year) {
  lastHits = { hits, year };
  const info = (h) => [h.type, h.gender && h.level ? h.gender + " " + h.level : h.level].filter(Boolean).join(" · ");
  $("#results").innerHTML = `<span class="eyebrow" style="align-self:center">${hits.length} teams · pick one</span>` + hits.slice(0, 60).map((h, i) => `<button type="button" data-i="${i}">${esc(h.name)} <span class="muted">${esc(info(h))}</span></button>`).join("");
  $("#results").querySelectorAll("button").forEach((b) => (b.onclick = async () => {
    if (S.busy) return;
    S.busy = true; showMsg("");
    try { await scout(hits[+b.dataset.i], year); $("#results").innerHTML = ""; }
    catch (e) { showMsg(explain(e), "err"); }
    finally { S.busy = false; progress(null); }
  }));
}

// ---------- scout ----------
async function scout(hit, year, opts) {
  opts = opts || {};
  const deep = opts.deep != null ? opts.deep : $("#deepChk").checked;
  progress(`Loading team page · ${esc(hit.name)}`, 0.02);
  const r = await runJob("/api/scout", { name: hit.name, s: hit.s || null, year, deep });
  progress(null);
  if (S.example) { S.example = false; S.teams = {}; S.cfg = { avail: {}, myKey: null, oppKey: null }; }
  await loadState();
  const amMine = opts.asMine || S.cfg.myKey === r.key;
  await saveCfg(amMine ? { myKey: r.key } : { oppKey: r.key });
  if (!amMine) { S.tab = "overview"; S.custom = null; S.mine = null; }
  showMsg(`Scouted <b>${esc(r.name)}</b>: ${r.players} players, ${r.scorecards} scorecards${r.deep ? ", player deep scan" : ""}.`, "ok");
  render();
}


// ---------- example data (fictional) ----------
function loadExample() {
  const mk = (name, base, names, seed) => {
    let x = seed; const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
    const roster = names.map((n, i) => ({ name: n, ntrp: i === names.length - 1 ? "3.5" : "4.0", rating: +(base - i * 0.035 + (rnd() - 0.5) * 0.04).toFixed(2), record: "", localS: i < 3 ? "3-1" : "0-0", localD: "2-1" }));
    const R = roster.map((r) => r.name);
    const matches = [];
    for (let k = 0; k < 9; k++) {
      const post = k >= 7;
      const d3 = [R[6 + (k % 3)], R[9 + (k % 2)]];
      const lines = [
        { line: "S1", home: [R[k % 4 === 3 ? 2 : 0]], visit: ["Opp A"] }, { line: "S2", home: [R[k % 4 === 3 ? 0 : 2]], visit: ["Opp B"] },
        { line: "D1", home: [R[1], R[3]], visit: ["Opp C", "Opp D"] }, { line: "D2", home: post ? [R[4], R[7]] : [R[4], R[5]], visit: ["Opp E", "Opp F"] }, { line: "D3", home: post ? [R[5], R[6]] : d3, visit: ["Opp G", "Opp H"] }];
      lines.forEach((l) => { l.winner = rnd() < 0.62 ? "home" : "visit"; l.score = rnd() < 0.3 ? "6-4 3-6 1-0" : "6-3 7-5"; });
      matches.push({ mid: name + k, date: (post ? "09/0" + (k - 4) : "0" + (k + 1) + "/1" + (k % 9)) + "/2026", type: post ? "Sectional Match" : "Local Match", section: post ? "Sectional" : "Local", home: name, visit: "Example Opp " + (k + 1), lines });
    }
    const deep = {}; roster.forEach((r, i) => (deep[r.name] = { edr: r.rating + 0.0012 * i, ntrpType: i === 8 ? "S" : "C", tb3: i % 3 ? "2-1 (66.7%)" : "1-3 (25.0%)", post: "2-1 (66.7%)", gender: "M" }));
    return { name, year: "2026", league: "Adult 40+", section: "So California", gender: "M", level: "4.0", header: "Adult 40+ So California M 4.0", flight: "Example flight (fictional)", roster, matches, deep, fetchedAt: Date.now(), example: true };
  };
  const opp = mk("Example: Harbor Racquet 4.0", 4.08, ["Dan Ortega", "Ken Mori", "Rob Velez", "Tom Haas", "Ali Navarro", "Sam Pike", "Joe Lund", "Ray Kim", "Ben Cho", "Max Ruiz", "Lee Park", "Jim Ford"], 7);
  const me = mk("Example: My Team 4.0", 4.03, ["Chris Lam", "Eric Wu", "Tony Reyes", "Mark Bell", "Paul Diaz", "Nick Tran", "Gary Holt", "Ian Shaw", "Will Ng", "Hugo Ramos", "Dave Ito", "Kyle Bates", "Sean Moss"], 3);
  opp.key = "ex-opp"; me.key = "ex-me";
  S.example = true; S.teams = { "ex-opp": opp, "ex-me": me }; S.cfg = { myKey: "ex-me", oppKey: "ex-opp", avail: {} };
}

// ---------- render ----------
function teamList() { return Object.values(S.teams).sort((a, b) => (b.fetchedAt || 0) - (a.fetchedAt || 0)); }
const AN = new Map();
function analysis(t) { const sig = t.key + ":" + t.fetchedAt; if (!AN.has(sig)) AN.set(sig, TR.analyze(t)); return AN.get(sig); }
function postRec(A) { let w = 0, l = 0; A.matches.filter((m) => m.post).forEach((m) => { m.w > m.l ? w++ : l++; }); return [w, l]; }
function matchRec(A, post) { let w = 0, l = 0; A.matches.filter((m) => !!m.post === !!post).forEach((m) => { m.w > m.l ? w++ : l++; }); return [w, l]; }

function render() {
  // my team select
  const ts = teamList();
  $("#mySel").innerHTML = `<option value="">— choose your team —</option>` + ts.map((t) => `<option value="${esc(t.key)}" ${S.cfg.myKey === t.key ? "selected" : ""}>${esc(t.name)} (${esc(t.year)})</option>`).join("");
  $("#mySel").onchange = (e) => saveCfg({ myKey: e.target.value || null });
  // board
  const my = S.teams[S.cfg.myKey];
  $("#boardList").innerHTML = ts.length ? ts.map((t) => {
    const A = analysis(t); const [lw, ll] = matchRec(A, false); const [pw, pl] = matchRec(A, true);
    let vs = "";
    if (my && t.key !== my.key && TR.slotsOf(A.fmt).length === analysis(my).slots.length) { const p = quickOdds(my, t); if (p != null) vs = `<span class="pill num" title="Projected team-match win chance with your best available lineup">You ${pct(p)}</span>`; }
    return `<button class="tcard ${S.cfg.oppKey === t.key ? "sel" : ""}" data-k="${esc(t.key)}">
      <span class="meta">${t.key === S.cfg.myKey ? '<span class="tag mine">Mine</span>' : ""}${t.example ? '<span class="tag ex">Example</span>' : ""}<span>${esc(t.league || "")} ${esc(t.gender || "")} ${esc(t.level || "")} · ${esc(t.year)}</span></span>
      <span class="nm">${esc(t.name)}</span>
      <span class="meta num"><span>Core ${f2(A.coreAvg)}</span><span>Local ${lw}-${ll}</span>${pw + pl ? `<span>Post ${pw}-${pl}</span>` : ""}${vs}</span></button>`;
  }).join("") : `<p class="muted">Teams you scout land here, so you can flip between sectionals opponents without reloading.</p>`;
  $("#boardList").querySelectorAll(".tcard").forEach((b) => (b.onclick = () => { S.custom = null; S.mine = null; saveCfg({ oppKey: b.dataset.k }); }));
  renderReport();
}

const ODDS = new Map();
function quickOdds(my, opp) {
  const sig = my.key + my.fetchedAt + "|" + opp.key + opp.fetchedAt + "|" + JSON.stringify(S.cfg.avail || {});
  if (ODDS.has(sig)) return ODDS.get(sig);
  const mA = analysis(my), oA = analysis(opp);
  const sc = TR.scenarios(opp, oA);
  const o = TR.optimize(my, mA, availNames(my), opp, oA, sc, { restarts: 8 });
  let p = null; if (o) { p = 0; sc.forEach((s) => (p += s.weight * TR.evalLineup(my, mA, o.lineup, opp, oA, s.lineup).team)); }
  ODDS.set(sig, p); return p;
}
function availNames(my) { const a = (S.cfg.avail || {})[my.key] || {}; return my.roster.map((p) => p.name).filter((n) => a[n] !== false); }

function renderReport() {
  const el = $("#report");
  const t = S.teams[S.cfg.oppKey] || (teamList().find((x) => x.key !== S.cfg.myKey)) || teamList()[0];
  if (!t) { el.innerHTML = emptyState(); return; }
  const A = analysis(t);
  const isMine = t.key === S.cfg.myKey;
  const [lw, ll] = matchRec(A, false), [pw, pl] = matchRec(A, true);
  const tabs = [["overview", "Scouting report"], ["roster", "Roster & ratings"], ["patterns", "Lineup patterns"], ["matchup", "Matchup"], ["plan", "Game plan"]];
  el.innerHTML = `
    ${S.example ? `<div class="exbanner">Example data: two fictional teams so you can see the report. ${isAdmin() ? "Search for a real team above and these disappear." : "They'll be replaced once your admin scouts real teams."}</div>` : ""}
    <div class="hdr"><div style="min-width:0"><div class="eyebrow">${esc(t.flight || t.header || "")}</div><h2>${esc(t.name)}</h2>
      <div class="legend" style="margin-top:6px"><span class="pill">${esc(t.league || "")} ${esc(t.gender || "")} ${esc(t.level || "")}</span><span class="pill num">${t.roster.length} players</span><span class="pill num">${A.nMatches} scorecards</span><span class="muted">Updated ${new Date(t.fetchedAt).toLocaleDateString()}</span></div></div>
      <div class="acts">${!t.example && isAdmin() ? `<button class="btn small" id="refreshBtn">Refresh from TennisRecord</button>` : ""}
        ${isMine ? "" : `<button class="btn small" id="mineBtn">This is my team</button>`}
        ${!t.example && isAdmin() ? `<button class="btn small" id="delBtn">Remove</button>` : ""}</div></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" data-tab="${k}">${l}</button>`).join("")}</div>
    <div class="panel" id="panel"></div>`;
  el.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; renderReport(); }));
  const rb = $("#refreshBtn"); if (rb) rb.onclick = async () => { if (S.busy) return; S.busy = true; try { await scout({ name: t.name, s: t.s }, t.year, { asMine: isMine }); } catch (e) { progress(null); showMsg(explain(e), "err"); } finally { S.busy = false; } };
  const mb = $("#mineBtn"); if (mb) mb.onclick = () => saveCfg({ myKey: t.key, oppKey: (teamList().find((x) => x.key !== t.key) || {}).key || null });
  const dbt = $("#delBtn"); if (dbt) dbt.onclick = () => confirmDelete(t, dbt);
  const P = $("#panel");
  if (S.tab === "overview") P.innerHTML = overview(t, A, lw, ll, pw, pl);
  else if (S.tab === "roster") renderRoster(P, t, A);
  else if (S.tab === "patterns") P.innerHTML = patterns(t, A);
  else if (S.tab === "matchup") renderMatchup(P, t, A);
  else if (S.tab === "plan") renderPlan(P, t, A);
}
function confirmDelete(t, btn) {
  if (btn.dataset.armed) { (async () => { try { await api("/api/teams/" + encodeURIComponent(t.key), { method: "DELETE" }); } catch (e) { showMsg(explain(e), "err"); return; } delete S.teams[t.key]; if (S.cfg.oppKey === t.key) await saveCfg({ oppKey: null }); render(); })(); return; }
  btn.dataset.armed = "1"; btn.textContent = "Click again to remove"; setTimeout(() => { if (btn.isConnected) { btn.textContent = "Remove"; delete btn.dataset.armed; } }, 4000);
}

function emptyState() {
  if (!isAdmin()) return `<div class="empty"><div class="eyebrow">Nothing scouted yet</div><h2>No reports yet</h2><p class="muted" style="margin:0">Your team admin scouts opponents on TennisRecord. Reports show up here as soon as they do.</p></div>`;
  return `<div class="empty"><div class="eyebrow">Get started</div><h2>Scout your first opponent</h2>
  <ol><li>Type part of an opponent's team name above and press <b>Find team</b>. The server reads TennisRecord for you (its search takes 20–30 seconds).</li>
  <li>It pulls the roster, every scorecard (who played S1, S2, D1–D3), and each player's estimated dynamic rating.</li>
  <li>Scout your own team too and mark it <b>This is my team</b>. The Matchup tab then builds your best lineup against theirs.</li></ol></div>`;
}

// ---------- overview ----------
function lineupRows(t, lu, conf) {
  return Object.keys(lu || {}).length ? analysis(t).slots.map((s) => {
    const who = lu[s];
    const r = who ? (who.length === 2 ? TR.pairRating(t, who) : TR.ratingOf(t, who[0])) : null;
    return `<tr><td class="court">${s}</td><td class="who">${who ? who.map(esc).join(" &amp; ") : '<span class="muted">No history</span>'}<small class="num">${who ? (who.length === 2 ? "pair avg " : "rating ") + f2(r) : ""}</small></td>
      ${conf ? `<td class="conf"><div class="meter" title="How often this exact choice appears at this court (recent and postseason weighted)"><i style="width:${Math.round((conf[s] || 0) * 100)}%"></i></div><div class="muted num" style="font-size:11px;margin-top:2px">${pct(conf[s] || 0)} of history</div></td>` : ""}</tr>`;
  }).join("") : "";
}
function insights(t, A) {
  const out = [];
  const lv = +t.level;
  const lp = A.lineProf;
  const dsl = A.slots.filter((s) => s[0] === "D" && lp[s].avgR != null);
  if (dsl.length >= 2) out.push(["Shape", `${A.style}. Average pair rating runs ${dsl.map((s) => s + " " + f2(lp[s].avgR)).join(" · ")}.`]);
  const best = A.pairs.filter((p) => p.w + p.l >= 3).sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l))[0];
  if (best) out.push(["Pair", `${esc(best.a.join(" & "))} are ${best.w}-${best.l} together, mostly at ${best.mainLine}${best.post ? ` (${best.post} postseason)` : ""}.`]);
  A.slots.filter((s) => s[0] === "S").forEach((s) => {
    const ps = Object.values(A.players).filter((p) => p.lines[s]).sort((a, b) => b.lines[s].n - a.lines[s].n);
    if (ps.length) out.push(["Singles", `${s} is ${esc(ps[0].name)} in ${ps[0].lines[s].n} of ${lp[s].n} matches (${ps[0].lines[s].w}-${ps[0].lines[s].l})${ps.length > 2 ? `; ${ps.length} different players have taken it` : ""}.`]);
  });
  const last = A.slots[A.slots.length - 1];
  const rot = new Set(A.lines.filter((x) => x.line === last).map((x) => x.us.slice().sort().join("+"))).size;
  if (rot >= 4) out.push(["Rotation", `${last} is their rotation court: ${rot} different line-ups in ${lp[last].n} matches.`]);
  const postL = A.lines.filter((x) => x.post);
  if (postL.length) {
    const changed = A.slots.filter((s) => { const a = postL.filter((x) => x.line === s).map((x) => x.us.join("+")); const b = A.lines.filter((x) => !x.post && x.line === s).map((x) => x.us.join("+")); return a.length && b.length && !a.some((v) => b.includes(v)); });
    out.push(["Playoffs", `${postL.length / A.slots.length >= 1 ? Math.round(postL.length / A.slots.length) : postL.length} postseason scorecards on record. ${changed.length ? "New faces at " + changed.join(", ") + " once the playoffs started." : "Mostly the same line-up they used in local play."}`]);
  }
  if (lv && lv < 6) {
    const hot = Object.values(A.players).filter((p) => p.rating != null && p.rating >= lv - 0.02 && !p.offRoster).sort((a, b) => b.rating - a.rating);
    if (hot.length) out.push(["Ratings", `${hot.length} player${hot.length > 1 ? "s" : ""} at or above the ${t.level} line: ${hot.slice(0, 4).map((p) => esc(p.name) + " " + f2(p.rating)).join(", ")}. Expect them on the top courts.`]);
  }
  const selfR = Object.entries(t.deep || {}).filter(([, d]) => d.ntrpType === "S").map(([n]) => n);
  if (selfR.length) out.push(["Unknowns", `Self-rated (S): ${selfR.map(esc).join(", ")}. Their ratings have little match data behind them.`]);
  const ghosts = Object.values(A.players).filter((p) => !p.offRoster && p.played <= 1 && p.rating != null && p.rating >= (A.coreAvg || 0)).slice(0, 3);
  if (ghosts.length) out.push(["Watch", `${ghosts.map((p) => esc(p.name) + " (" + f2(p.rating) + ")").join(", ")} rate high but have played ${ghosts.length > 1 ? "at most once" : "once or never"} for this team. They could show up at sectionals.`]);
  const closeW = A.lines.filter((x) => x.close && x.won === true).length, closeL = A.lines.filter((x) => x.close && x.won === false).length;
  if (closeW + closeL >= 4) out.push(["Close sets", `They are ${closeW}-${closeL} in courts that went to a third set or a tight set (7-5, 7-6).`]);
  return out;
}
function overview(t, A, lw, ll, pw, pl) {
  const pred = TR.predict(t, A);
  const strongest = Object.values(A.players).filter((p) => !p.offRoster && p.rating != null).sort((a, b) => b.rating - a.rating);
  const used = Object.values(A.players).filter((p) => !p.offRoster && p.played >= 2 && p.rating != null).sort((a, b) => a.rating - b.rating);
  return `<div class="tiles">
    <div class="tile"><span class="eyebrow">Core strength</span><span class="v">${f2(A.coreAvg)}</span><span class="s">Avg dynamic rating of top ${A.fmt.singles + A.fmt.doubles * 2}</span></div>
    <div class="tile"><span class="eyebrow">Local record</span><span class="v">${lw}-${ll}</span><span class="s">Team matches</span></div>
    <div class="tile"><span class="eyebrow">Postseason</span><span class="v">${pw + pl ? pw + "-" + pl : "–"}</span><span class="s">${pw + pl ? "Playoffs / sectionals" : "None on record"}</span></div>
    <div class="tile"><span class="eyebrow">Line-up shape</span><span class="v" style="font-size:22px">${esc(A.style)}</span><span class="s">From pair ratings by court</span></div></div>
  <div class="two">
    <div class="sec"><h3>Most likely line-up</h3><div class="card"><table class="lu">${lineupRows(t, pred.lineup, pred.conf)}</table></div>
      <p class="muted" style="margin:0;font-size:12.5px">Built from their scorecards, with recent matches and postseason matches counted more heavily.</p></div>
    <div class="sec"><h3>What stands out</h3><ul class="insights">${insights(t, A).map(([k, v]) => `<li><b class="k">${k}</b><span>${v}</span></li>`).join("") || '<li><span class="muted">Not enough scorecards yet.</span></li>'}</ul></div>
  </div>
  <div class="two">
    <div class="sec"><h3>Biggest threats</h3><div class="tbl-wrap"><table class="t"><tr><th>Player</th><th>Dynamic</th><th>W-L here</th><th>Usual court</th></tr>
      ${strongest.slice(0, 5).map((p) => `<tr><td>${esc(p.name)}</td><td class="rt">${f2(p.rating)}</td><td>${p.w}-${p.l}</td><td>${topLines(p)}</td></tr>`).join("")}</table></div></div>
    <div class="sec"><h3>Courts to target</h3><div class="tbl-wrap"><table class="t"><tr><th>Player</th><th>Dynamic</th><th>W-L here</th><th>Usual court</th></tr>
      ${used.slice(0, 5).map((p) => `<tr><td>${esc(p.name)}</td><td class="rt">${f2(p.rating)}</td><td>${p.w}-${p.l}</td><td>${topLines(p)}</td></tr>`).join("")}</table></div></div>
  </div>`;
}
function topLines(p) { return Object.entries(p.lines).sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([l, v]) => `<span class="chip">${l}×${v.n}</span>`).join("") || '<span class="muted">–</span>'; }

// ---------- roster ----------
function renderRoster(P, t, A) {
  const lv = +t.level;
  const rows = t.roster.map((r) => ({ r, p: A.players[r.name], d: (t.deep || {})[r.name] || {} })).sort((a, b) => (b.p.rating || 0) - (a.p.rating || 0));
  const lo = Math.min(...rows.map((x) => x.p.rating || 9)) - 0.05, hi = Math.max(...rows.map((x) => x.p.rating || 0)) + 0.05;
  P.innerHTML = `<div class="sec"><h3>Roster & ratings</h3>
   <p class="muted" style="margin:0;max-width:75ch">NTRP is the USTA year-end level (C computer, S self, A appeal). Dynamic is TennisRecord's estimate of the hidden USTA dynamic rating${Object.keys(t.deep || {}).length ? ", to four decimals from the player deep scan" : ""}. ${lv && lv < 6 ? `A dynamic rating above ${t.level} means the player is playing like the next level up.` : ""}</p>
   <div class="tbl-wrap"><table class="t"><tr><th>Player</th><th>NTRP</th><th>Dynamic</th><th></th><th>Season W-L</th><th>Here S</th><th>Here D</th><th>Courts</th><th>3rd-set TB</th><th>Post</th><th>Your notes</th></tr>
   ${rows.map(({ r, p, d }) => {
     const x = p.rating == null ? 0 : (p.rating - lo) / (hi - lo);
     const note = S.notes[slug(r.name)];
     return `<tr><td>${esc(r.name)}${r.loc ? `<div class="muted" style="font-size:11.5px">${esc(r.loc)}</div>` : ""}</td>
      <td>${esc(r.ntrp || "–")}<span class="ntype">${esc(d.ntrpType || "")}</span></td>
      <td class="rt ${lv && lv < 6 && p.rating >= lv ? "hot" : ""}">${d.edr ? d.edr.toFixed(4) : f2(p.rating)}</td>
      <td><svg width="70" height="10" aria-hidden="true"><rect x="0" y="4" width="70" height="2" rx="1" fill="var(--line)"/><circle cx="${4 + x * 62}" cy="5" r="4" fill="var(--them)"/></svg></td>
      <td>${esc(d.record ? d.record.replace(/\s*\(.*/, "") : r.record || "–")}</td>
      <td>${p.sw + p.sl ? `${p.sw}-${p.sl}` : "–"}</td><td>${p.dw + p.dl ? `${p.dw}-${p.dl}` : "–"}</td><td>${topLines(p)}</td>
      <td>${esc(d.tb3 ? d.tb3.replace(/\s*\(.*/, "") : "–")}</td><td>${esc(d.post ? d.post.replace(/\s*\(.*/, "") : r.postD || "–")}</td>
      <td class="wrapc"><span class="note">${note ? esc(note.text) : ""}</span> <button class="notebtn" data-n="${esc(r.name)}">${note ? "Edit" : "Add note"}</button></td></tr>`;
   }).join("")}</table></div></div>`;
  P.querySelectorAll(".notebtn").forEach((b) => (b.onclick = () => editNote(b, b.dataset.n)));
}
function editNote(btn, name) {
  const td = btn.parentElement; const cur = (S.notes[slug(name)] || {}).text || "";
  td.innerHTML = `<textarea id="note-${slug(name)}" placeholder="Lefty, big serve, lobs a lot…">${esc(cur)}</textarea><div style="display:flex;gap:6px;margin-top:4px"><button class="btn small primary">Save note</button><button class="btn small">Cancel</button></div>`;
  const [save, cancel] = td.querySelectorAll("button");
  cancel.onclick = () => renderReport();
  save.onclick = async () => {
    const text = td.querySelector("textarea").value.trim();
    S.notes[slug(name)] = { player: name, text, updatedAt: Date.now() };
    if (!S.example) { try { await api("/api/notes/" + encodeURIComponent(name), { method: "PUT", body: { text } }); } catch (e) { showMsg(explain(e), "err"); } }
    if (!text) delete S.notes[slug(name)];
    renderReport();
  };
}

// ---------- patterns ----------
function patterns(t, A) {
  const ps = Object.values(A.players).filter((p) => p.played).sort((a, b) => { const fa = A.slots.findIndex((s) => a.lines[s]), fb = A.slots.findIndex((s) => b.lines[s]); return fa - fb || b.played - a.played; });
  const maxN = Math.max(1, ...ps.flatMap((p) => Object.values(p.lines).map((l) => l.n)));
  const heat = `<div class="tbl-wrap"><table class="t heat"><tr><th>Player</th><th>Dyn.</th>${A.slots.map((s) => `<th style="text-align:center">${s}</th>`).join("")}<th>Total</th></tr>
    ${ps.map((p) => `<tr><td>${esc(p.name)}${p.offRoster ? ' <span class="muted">(off roster)</span>' : ""}</td><td class="rt">${f2(p.rating)}</td>${A.slots.map((s) => { const l = p.lines[s]; if (!l) return `<td class="c"></td>`; const a = 0.12 + 0.6 * (l.n / maxN); return `<td class="c"><div class="cell" style="background:rgba(var(--heat),${a.toFixed(2)})" title="${esc(p.name)} at ${s}: ${l.n} matches, ${l.w}-${l.l}">${l.w}-${l.l}</div></td>`; }).join("")}<td>${p.w}-${p.l}</td></tr>`).join("")}</table></div>`;
  const pairs = `<div class="tbl-wrap"><table class="t"><tr><th>Pair</th><th>Pair avg</th><th>Together</th><th>Courts</th><th>Postseason</th></tr>
    ${A.pairs.slice(0, 14).map((p) => `<tr><td>${esc(p.a.join(" & "))}</td><td class="rt">${f2(p.rating)}</td><td><span class="${p.w >= p.l ? "wl-w" : "wl-l"}">${p.w}-${p.l}</span></td><td>${Object.entries(p.lines).map(([l, n]) => `<span class="chip">${l}×${n}</span>`).join("")}</td><td>${p.post || ""}</td></tr>`).join("")}</table></div>`;
  const log = `<div class="tbl-wrap"><table class="t"><tr><th>Date</th><th>Opponent</th><th>Result</th>${A.slots.map((s) => `<th>${s}</th>`).join("")}</tr>
    ${A.matches.slice().reverse().map((m) => `<tr><td>${esc(m.date)}${m.post ? ' <span class="tag opp">Post</span>' : ""}</td><td>${esc(m.opp || "")}</td><td><span class="${m.w > m.l ? "wl-w" : "wl-l"}">${m.w > m.l ? "W" : "L"} ${m.w}-${m.l}</span></td>
      ${A.slots.map((s) => { const x = m.lines.find((y) => y.line === s); return `<td>${x ? `<span class="${x.won ? "wl-w" : "wl-l"}">${x.won ? "W" : "L"}</span> ${x.us.map(short).map(esc).join(" / ")}<div class="muted" style="font-size:11px">${esc(x.score || "")}</div>` : '<span class="muted">–</span>'}</td>`; }).join("")}</tr>`).join("")}</table></div>`;
  return `<div class="sec"><h3>Who plays where</h3><p class="muted" style="margin:0">Each cell is that player's win-loss at the court; darker means more appearances.</p>${heat}</div>
    <div class="sec"><h3>Doubles partnerships</h3>${pairs}</div>
    <div class="sec"><h3>Match-by-match line-ups</h3>${log}</div>`;
}

// ---------- matchup ----------
function renderMatchup(P, opp, oA) {
  const my = S.teams[S.cfg.myKey];
  if (!my || my.key === opp.key) {
    P.innerHTML = `<div class="empty"><h2>Pick your own team</h2><p class="muted" style="margin:0">Scout your team the same way, then choose it under <b>My team</b> on the left (or open it and press <b>This is my team</b>). The matchup then sets your best line-up against this opponent.</p></div>`; return;
  }
  const mA = analysis(my);
  if (mA.slots.join() !== oA.slots.join()) { P.innerHTML = `<div class="notice">Your team plays ${mA.slots.join(", ")} and this team plays ${oA.slots.join(", ")}. Pick a team from the same league to compare.</div>`; return; }
  const sc = TR.scenarios(opp, oA);
  if (!S.custom) S.custom = JSON.parse(JSON.stringify(sc[0].lineup));
  const scenList = sc.concat([{ key: "custom", label: "My guess", lineup: S.custom, weight: 0 }]);
  const cur = scenList.find((s) => s.key === S.scen) || scenList[0];
  const avail = availNames(my);
  if (!S.mine) { const o = TR.optimize(my, mA, avail, opp, oA, sc); S.mine = o ? o.lineup : {}; }
  const ev = TR.evalLineup(my, mA, S.mine, opp, oA, cur.lineup);
  const weighted = sc.reduce((a, s) => a + s.weight * TR.evalLineup(my, mA, S.mine, opp, oA, s.lineup).team, 0);
  const used = new Set(Object.values(S.mine).flat());
  const opt = (team, names, sel, usedSet) => `<option value="">—</option>` + names.map((n) => `<option value="${esc(n)}" ${n === sel ? "selected" : ""}>${esc(n)} · ${f2(TR.ratingOf(team, n))}${usedSet && usedSet.has(n) && n !== sel ? " (in line-up)" : ""}</option>`).join("");
  const myNames = my.roster.map((r) => r.name).sort((a, b) => (TR.ratingOf(my, b) || 0) - (TR.ratingOf(my, a) || 0));
  const opNames = opp.roster.map((r) => r.name).sort((a, b) => (TR.ratingOf(opp, b) || 0) - (TR.ratingOf(opp, a) || 0));
  const editable = cur.key === "custom";
  const myAv = (S.cfg.avail || {})[my.key] || {};
  P.innerHTML = `
   <div class="tiles">
     <div class="tile"><span class="eyebrow">Win chance vs ${esc(cur.label.toLowerCase())}</span><span class="v">${pct(ev.team)}</span><span class="s num">Expected courts ${ev.exp.toFixed(1)} of ${oA.slots.length}</span></div>
     <div class="tile"><span class="eyebrow">Across their options</span><span class="v">${pct(weighted)}</span><span class="s">Most likely 60% · stacked 25% · loaded bottom 15%</span></div>
     <div class="tile"><span class="eyebrow">Core strength</span><span class="v num" style="font-size:24px"><span style="color:var(--us)">${f2(mA.coreAvg)}</span> <span class="muted" style="font-size:16px">vs</span> <span style="color:var(--them)">${f2(oA.coreAvg)}</span></span><span class="s">${esc(short2(my.name))} vs ${esc(short2(opp.name))}</span></div>
   </div>
   <div class="sec"><h3>Their line-up</h3><div class="scen" role="group" aria-label="Opponent line-up">${scenList.map((s) => `<button aria-pressed="${s.key === cur.key}" data-sc="${s.key}">${esc(s.label)}</button>`).join("")}</div></div>
   <div class="sec"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between"><h3>Court by court</h3>
     <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn small primary" id="optBtn">Optimize my line-up</button></div></div>
     <div class="legend"><span><i style="background:var(--us)"></i>${esc(my.name)}</span><span><i style="background:var(--them)"></i>${esc(opp.name)}</span></div>
     <div class="tbl-wrap"><table class="t mu"><tr><th>Court</th><th>Your players</th><th></th><th style="text-align:center">Win</th><th>Their players</th></tr>
     ${oA.slots.map((s) => {
       const per = ev.per[s]; const n = s[0] === "S" ? 1 : 2; const mine = S.mine[s] || [], th = cur.lineup[s] || [];
       const mySel = Array.from({ length: n }, (_, i) => `<select data-my="${s}" data-i="${i}" aria-label="Your ${s} player ${i + 1}">${opt(my, myNames, mine[i], used)}</select>`).join("");
       const thSel = editable ? Array.from({ length: n }, (_, i) => `<select data-th="${s}" data-i="${i}" aria-label="Their ${s} player ${i + 1}">${opt(opp, opNames, th[i])}</select>`).join("") : `<div class="who">${th.length ? th.map(esc).join(" &amp; ") : '<span class="muted">Unknown</span>'}</div>`;
       return `<tr><td class="court">${s}</td><td><div class="sel2">${mySel}</div><div class="muted num" style="font-size:11.5px;margin-top:3px">${per.a != null ? "strength " + f2(per.a) : ""}</div></td>
        <td><div class="pbar" title="${pct(per.p)} for you"><i class="u" style="width:${Math.round(per.p * 100)}%"></i><i class="t" style="width:${100 - Math.round(per.p * 100)}%"></i></div></td>
        <td class="prob" style="color:${per.p >= 0.55 ? "var(--good)" : per.p <= 0.45 ? "var(--bad)" : "var(--ink)"}">${pct(per.p)}</td>
        <td><div class="sel2">${thSel}</div><div class="muted num" style="font-size:11.5px;margin-top:3px">${per.b != null ? "strength " + f2(per.b) : ""}</div></td></tr>`;
     }).join("")}</table></div>
     <p class="muted" style="margin:0;font-size:12.5px;max-width:80ch">Win chance per court comes from the rating gap (0.10 ≈ 68%, 0.20 ≈ 82%). Doubles strength is the pair average, nudged by how the pair has done together; a player with no singles on record gives up a little at singles. The optimizer maximizes the chance of winning the team match, so it will sometimes concede one court to win the others.</p></div>
   <div class="sec"><h3>Who's available</h3><div class="avail">${my.roster.map((r) => `<label class="${myAv[r.name] === false ? "off" : ""}"><input type="checkbox" data-av="${esc(r.name)}" ${myAv[r.name] === false ? "" : "checked"}> ${esc(r.name)} <span class="muted num">${f2(TR.ratingOf(my, r.name))}</span></label>`).join("")}</div></div>
   <div class="sec"><h3>Strength ladder</h3><div class="legend"><span><i style="background:var(--us)"></i>${esc(my.name)}</span><span><i style="background:var(--them)"></i>${esc(opp.name)}</span></div><div class="chart" id="ladder"></div></div>`;
  P.querySelectorAll("[data-sc]").forEach((b) => (b.onclick = () => { S.scen = b.dataset.sc; renderReport(); }));
  P.querySelectorAll("[data-my]").forEach((sel) => (sel.onchange = () => { const s = sel.dataset.my, i = +sel.dataset.i; const v = sel.value; Object.keys(S.mine).forEach((k) => (S.mine[k] = (S.mine[k] || []).map((x) => (x === v && !(k === s) ? "" : x)))); S.mine[s] = S.mine[s] || []; S.mine[s][i] = v; renderReport(); }));
  P.querySelectorAll("[data-th]").forEach((sel) => (sel.onchange = () => { const s = sel.dataset.th, i = +sel.dataset.i; S.custom[s] = S.custom[s] || []; S.custom[s][i] = sel.value; renderReport(); }));
  $("#optBtn").onclick = () => { const o = TR.optimize(my, mA, availNames(my), opp, oA, cur.key === "custom" ? [{ lineup: S.custom, weight: 1 }] : sc); if (o) S.mine = o.lineup; renderReport(); };
  P.querySelectorAll("[data-av]").forEach((c) => (c.onchange = () => { const av = Object.assign({}, S.cfg.avail || {}); av[my.key] = Object.assign({}, av[my.key] || {}); if (c.checked) delete av[my.key][c.dataset.av]; else av[my.key][c.dataset.av] = false; S.mine = null; saveCfg({ avail: av }); }));
  drawLadder($("#ladder"), my, opp);
}
const short2 = (n) => (n.length > 26 ? n.slice(0, 25) + "…" : n);

function drawLadder(el, my, opp) {
  const pts = [];
  my.roster.forEach((r) => { const v = TR.ratingOf(my, r.name); if (v != null) pts.push({ side: 0, n: r.name, v }); });
  opp.roster.forEach((r) => { const v = TR.ratingOf(opp, r.name); if (v != null) pts.push({ side: 1, n: r.name, v }); });
  if (!pts.length) return;
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  lo = Math.floor(lo * 10) / 10 - 0.05; hi = Math.ceil(hi * 10) / 10 + 0.05;
  const W = Math.max(560, el.clientWidth || 560), H = 150, L = 110, R = 16;
  const x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const ticks = []; for (let v = Math.ceil(lo * 10) / 10; v <= hi + 1e-9; v += 0.1) ticks.push(+v.toFixed(1));
  const rowY = [48, 102];
  const lvl = +opp.level;
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="Dynamic ratings of both rosters on one scale">`;
  ticks.forEach((v) => (s += `<line x1="${x(v)}" x2="${x(v)}" y1="22" y2="${H - 22}" stroke="var(--line)" stroke-width="1"/><text x="${x(v)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--ink3)" class="num">${v.toFixed(1)}</text>`));
  if (lvl && lvl < 6 && lvl >= lo && lvl <= hi) s += `<line x1="${x(lvl)}" x2="${x(lvl)}" y1="14" y2="${H - 22}" stroke="var(--ink2)" stroke-dasharray="3 3"/><text x="${x(lvl) + 4}" y="14" font-size="11" fill="var(--ink2)">${opp.level} line</text>`;
  ["Your team", "Opponent"].forEach((lab, i) => (s += `<text x="0" y="${rowY[i] + 4}" font-size="12" fill="var(--ink2)" font-weight="600">${lab}</text>`));
  pts.forEach((p, i) => { const jitter = ((i * 7) % 5 - 2) * 3; s += `<circle cx="${x(p.v)}" cy="${rowY[p.side] + jitter}" r="5.5" fill="var(${p.side ? "--them" : "--us"})" stroke="var(--surface)" stroke-width="2" data-tip="${esc(p.n)} · ${p.v.toFixed(2)}"/>`; });
  s += `</svg>`;
  el.innerHTML = s;
  const tip = $("#tip");
  el.querySelectorAll("[data-tip]").forEach((c) => {
    c.addEventListener("pointerenter", (e) => { tip.hidden = false; tip.textContent = c.dataset.tip; });
    c.addEventListener("pointermove", (e) => { tip.style.left = e.clientX + 12 + "px"; tip.style.top = e.clientY + 12 + "px"; });
    c.addEventListener("pointerleave", () => (tip.hidden = true));
  });
}

// ---------- game plan ----------
function md(src) {
  const lines = esc(src).split(/\n/); let h = "", list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, "$1<i>$2</i>");
  const close = () => { if (list) { h += `</${list}>`; list = null; } };
  lines.forEach((l) => {
    let m;
    if ((m = l.match(/^(#{1,3})\s+(.*)/))) { close(); const n = Math.min(3, m[1].length + 1); h += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (list !== "ul") { close(); h += "<ul>"; list = "ul"; } h += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); h += "<ol>"; list = "ol"; } h += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) close();
    else { close(); h += `<p>${inline(l)}</p>`; }
  });
  close(); return h;
}
function planBrief(opp, oA) {
  const my = S.teams[S.cfg.myKey]; const mA = my && my.key !== opp.key ? analysis(my) : null;
  const sc = TR.scenarios(opp, oA);
  const pl = (t, A) => Object.values(A.players).filter((p) => !p.offRoster).map((p) => { const d = (t.deep || {})[p.name] || {}; return { name: p.name, ntrp: p.ntrp + (d.ntrpType || ""), dyn: p.rating != null ? +p.rating.toFixed(3) : null, here: `${p.w}-${p.l}`, singles: `${p.sw}-${p.sl}`, courts: Object.fromEntries(Object.entries(p.lines).map(([k, v]) => [k, `${v.w}-${v.l}`])), tb3: d.tb3 || null, postseason: d.post || null, note: (S.notes[slug(p.name)] || {}).text || undefined }; });
  const brief = {
    league: `${opp.league} ${opp.gender} ${opp.level}`, format: oA.slots.join(", "),
    opponent: { name: opp.name, coreStrength: +oA.coreAvg.toFixed(3), style: oA.style, players: pl(opp, oA), pairs: oA.pairs.slice(0, 10).map((p) => ({ pair: p.a.join(" & "), wl: `${p.w}-${p.l}`, courts: p.lines, avg: p.rating && +p.rating.toFixed(3) })), scenarios: sc.map((s) => ({ label: s.label, weight: s.weight, lineup: s.lineup })), recentMatches: oA.matches.slice(-6).map((m) => ({ date: m.date, opp: m.opp, post: m.post, result: `${m.w}-${m.l}`, lines: m.lines.map((x) => `${x.line} ${x.us.join("/")} ${x.won ? "W" : "L"} ${x.score || ""}`) })) },
  };
  if (mA) {
    const mine = S.mine || (TR.optimize(my, mA, availNames(my), opp, oA, sc) || {}).lineup || {};
    brief.myTeam = { name: my.name, coreStrength: +mA.coreAvg.toFixed(3), available: availNames(my), players: pl(my, mA), plannedLineup: mine,
      courtOdds: Object.fromEntries(sc.map((s) => [s.label, Object.fromEntries(Object.entries(TR.evalLineup(my, mA, mine, opp, oA, s.lineup).per).map(([k, v]) => [k, Math.round(v.p * 100) + "%"]))])) };
  }
  return brief;
}
function renderPlan(P, t, A) {
  const saved = S.plans[t.key];
  const my = S.teams[S.cfg.myKey];
  const can = ME && ME.features && ME.features.plans && !S.example && !t.example;
  const why = !(ME && ME.features && ME.features.plans) ? (isAdmin() ? "Writing plans needs an Anthropic API key on the server (see README → Game plans)." : "Plans are written by whoever has the admin password.") : (S.example || t.example) ? "Plans are written for real scouted teams." : "";
  P.innerHTML = `<div class="sec"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between"><h3>Game plan</h3>
    ${can ? `<button class="btn primary" id="genBtn">${saved ? "Rewrite game plan" : "Write game plan with Claude"}</button>` : ""}</div>
    <p class="muted" style="margin:0;max-width:80ch">Claude reads this scouting data${my && my.key !== t.key ? ", your roster, your availability and the line-up on the Matchup tab" : ""}, plus the team's player notes, and writes a captain's plan. Everyone with the link sees the saved plan. ${esc(why)}</p>
    <div id="planOut">${saved ? `<div class="plan">${md(saved.text)}</div><p class="muted" style="font-size:12px">Written ${new Date(saved.at).toLocaleString()}${saved.myName ? " for " + esc(saved.myName) : ""}${saved.by ? " by " + esc(saved.by) : ""}.</p>` : ""}</div></div>`;
  const gb = $("#genBtn");
  if (gb) gb.onclick = async () => {
    gb.disabled = true; const out = $("#planOut"); out.innerHTML = `<div class="plan"><p class="muted">Thinking through the matchup… (usually 20–40 seconds)</p></div>`;
    try {
      const rec = await api("/api/plans/" + encodeURIComponent(t.key), { method: "POST", body: { teamName: t.name, brief: planBrief(t, A) } });
      S.plans[t.key] = rec;
      renderReport();
    } catch (e) {
      out.innerHTML = `<div class="notice err">The plan couldn't be written: ${esc(e.message)}</div>`;
      gb.disabled = false;
    }
  };
}

$("#adminBtn").onclick = openAdmin;
$("#adminCancel").onclick = () => $("#adminDlg").close();
boot();
