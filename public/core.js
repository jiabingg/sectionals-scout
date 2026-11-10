// Sectionals Scout analytics: pure functions shared by the report, matchup and optimizer.
// Ported unchanged from the original Claude artifact.
const TR = {};

// ---------- analytics ----------
const WL = (s) => { const m = String(s || "").match(/(\d+)-(\d+)/); return m ? [+m[1], +m[2]] : [0, 0]; };
TR.WL = WL;

TR.formatOf = (team) => {
  const lg = (team.league || "") + " " + (team.header || "");
  const lines = new Set();
  (team.matches || []).forEach((m) => m.lines.forEach((l) => lines.add(l.line)));
  if (lines.size) {
    const s = [...lines].filter((x) => x[0] === "S").length, d = [...lines].filter((x) => x[0] === "D").length;
    if (s || d) return { singles: s, doubles: d, mixed: /Mixed/i.test(lg), combined: +team.level >= 5.5 };
  }
  if (/Mixed/i.test(lg)) return { singles: 0, doubles: 3, mixed: true, combined: +team.level >= 5.5 };
  if (/55\+|65\+|70\+|Tri-Level|Combo/i.test(lg)) return { singles: 0, doubles: 3, mixed: false, combined: +team.level >= 5.5 };
  return { singles: 2, doubles: 3, mixed: false, combined: false };
};
TR.slotsOf = (fmt) => {
  const s = []; for (let i = 1; i <= fmt.singles; i++) s.push("S" + i); for (let i = 1; i <= fmt.doubles; i++) s.push("D" + i); return s;
};

// Normalize each team match from the team's own perspective
TR.norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
TR.teamLines = (team) => {
  const out = [];
  const me = TR.norm(team.name);
  (team.matches || []).forEach((m) => {
    const isHome = TR.norm(m.home) === me ? true : TR.norm(m.visit) === me ? false : null;
    if (isHome == null) return;
    m.lines.forEach((l) => {
      const us = isHome ? l.home : l.visit, them = isHome ? l.visit : l.home;
      if (!us.length) return;
      const won = l.winner == null ? null : (l.winner === "home") === isHome;
      out.push({ date: m.date, mid: m.mid, post: !/local/i.test(m.type || m.section || "local"), stage: m.type || m.section, opp: isHome ? m.visit : m.home,
        line: l.line, us, them, won, score: l.score, close: TR.isClose(l.score), usR: isHome ? l.homeR : l.visitR, themR: isHome ? l.visitR : l.homeR });
    });
  });
  return out.sort((a, b) => TR.dnum(a.date) - TR.dnum(b.date));
};
TR.dnum = (d) => { const m = String(d || "").match(/(\d\d)\/(\d\d)\/(\d{4})/); return m ? +(m[3] + m[1] + m[2]) : 0; };
TR.isClose = (score) => { if (!score) return false; const sets = score.split(" "); if (sets.length >= 3) return true; return sets.some((s) => { const [a, b] = s.split("-").map(Number); return Math.abs(a - b) <= 2 && Math.max(a, b) >= 6; }); };

TR.ratingOf = (team, name) => {
  const d = team.deep && team.deep[name];
  if (d && d.edr) return d.edr;
  const p = team.roster.find((r) => r.name === name);
  if (p && p.rating) return p.rating;
  if (p && p.ntrp) return +p.ntrp - 0.25;
  return null;
};

TR.analyze = (team) => {
  const L = TR.teamLines(team);
  const fmt = TR.formatOf(team);
  const slots = TR.slotsOf(fmt);
  const lastDate = L.length ? TR.dnum(L[L.length - 1].date) : 0;
  const players = {};
  team.roster.forEach((p) => { players[p.name] = { name: p.name, ntrp: p.ntrp, rating: TR.ratingOf(team, p.name), lines: {}, w: 0, l: 0, sw: 0, sl: 0, dw: 0, dl: 0, played: 0, postPlayed: 0, closeW: 0, closeL: 0, last: null }; });
  const ensure = (n) => players[n] || (players[n] = { name: n, ntrp: null, rating: TR.ratingOf(team, n), lines: {}, w: 0, l: 0, sw: 0, sl: 0, dw: 0, dl: 0, played: 0, postPlayed: 0, closeW: 0, closeL: 0, last: null, offRoster: true });
  const pairs = {};
  const nMatches = new Set(L.map((x) => x.mid)).size;
  const matchIdx = {}; [...new Set(L.map((x) => x.mid))].forEach((mid, i) => (matchIdx[mid] = i));
  L.forEach((x) => {
    const recency = nMatches > 1 ? 0.5 + 0.5 * (matchIdx[x.mid] / (nMatches - 1)) : 1; // 0.5 .. 1.0
    const wgt = recency * (x.post ? 2 : 1);
    x.us.forEach((n) => {
      const p = ensure(n);
      p.lines[x.line] = p.lines[x.line] || { n: 0, w: 0, l: 0, wt: 0 };
      p.lines[x.line].n++; p.lines[x.line].wt += wgt;
      if (x.won === true) { p.w++; p.lines[x.line].w++; x.line[0] === "S" ? p.sw++ : p.dw++; if (x.close) p.closeW++; }
      if (x.won === false) { p.l++; p.lines[x.line].l++; x.line[0] === "S" ? p.sl++ : p.dl++; if (x.close) p.closeL++; }
      p.played++; if (x.post) p.postPlayed++; p.last = x.date;
    });
    if (x.us.length === 2) {
      const k = [...x.us].sort().join(" + ");
      const pr = pairs[k] || (pairs[k] = { key: k, a: [...x.us].sort(), n: 0, w: 0, l: 0, lines: {}, wt: 0, post: 0 });
      pr.n++; pr.wt += wgt; if (x.won === true) pr.w++; if (x.won === false) pr.l++; pr.lines[x.line] = (pr.lines[x.line] || 0) + 1; if (x.post) pr.post++;
    }
  });
  Object.values(pairs).forEach((pr) => { pr.rating = TR.pairRating(team, pr.a); pr.mainLine = Object.entries(pr.lines).sort((a, b) => b[1] - a[1])[0][0]; });
  // line profile
  const lineProf = {};
  slots.forEach((s) => {
    const xs = L.filter((x) => x.line === s);
    const rs = xs.map((x) => (x.us.length === 2 ? TR.pairRating(team, x.us) : TR.ratingOf(team, x.us[0]))).filter((v) => v != null);
    lineProf[s] = { n: xs.length, w: xs.filter((x) => x.won === true).length, l: xs.filter((x) => x.won === false).length, avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
      postN: xs.filter((x) => x.post).length, postW: xs.filter((x) => x.post && x.won === true).length };
  });
  // matches summary
  const byMatch = {};
  L.forEach((x) => { const m = byMatch[x.mid] || (byMatch[x.mid] = { mid: x.mid, date: x.date, opp: x.opp, post: x.post, stage: x.stage, w: 0, l: 0, lines: [] }); if (x.won === true) m.w++; if (x.won === false) m.l++; m.lines.push(x); });
  const matches = Object.values(byMatch).sort((a, b) => TR.dnum(a.date) - TR.dnum(b.date));
  // style
  const top = slots.filter((s) => lineProf[s].avgR != null);
  let style = "Balanced";
  const dl = slots.filter((s) => s[0] === "D" && lineProf[s].avgR != null).map((s) => lineProf[s].avgR);
  if (dl.length >= 2) {
    const diff = dl[0] - dl[dl.length - 1];
    if (diff > 0.12) style = "Stacks the top"; else if (diff < -0.06) style = "Loads the bottom"; else style = "Spreads strength evenly";
  }
  const rated = team.roster.map((p) => TR.ratingOf(team, p.name)).filter((v) => v != null).sort((a, b) => b - a);
  const nCore = fmt.singles + fmt.doubles * 2;
  const coreAvg = rated.slice(0, nCore).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(nCore, rated.length));
  return { lines: L, fmt, slots, players, pairs: Object.values(pairs).sort((a, b) => b.n - a.n || b.w - a.w), lineProf, matches, style, coreAvg, nMatches, lastDate };
};

TR.pairRating = (team, two) => {
  const r = two.map((n) => TR.ratingOf(team, n));
  if (r.some((v) => v == null)) { const k = r.filter((v) => v != null); return k.length ? k[0] - 0.1 : null; }
  return (r[0] + r[1]) / 2;
};

// most likely lineup: greedy by weighted frequency, postseason x2, recency
TR.predict = (team, A) => {
  A = A || TR.analyze(team);
  const cand = [];
  A.slots.forEach((s) => {
    if (s[0] === "S") Object.values(A.players).forEach((p) => { const l = p.lines[s]; if (l) cand.push({ slot: s, who: [p.name], score: l.wt }); });
    else A.pairs.forEach((pr) => { const c = pr.lines[s]; if (c) cand.push({ slot: s, who: pr.a, score: pr.wt * (c / pr.n) }); });
  });
  cand.sort((a, b) => b.score - a.score);
  const used = new Set(), out = {};
  cand.forEach((c) => { if (out[c.slot] || c.who.some((n) => used.has(n))) return; out[c.slot] = c.who; c.who.forEach((n) => used.add(n)); });
  // fill holes with best remaining by rating
  const pool = Object.values(A.players).filter((p) => !used.has(p.name) && p.rating != null && !p.offRoster).sort((a, b) => b.rating - a.rating);
  A.slots.forEach((s) => {
    if (out[s]) return;
    const need = s[0] === "S" ? 1 : 2; const pick = pool.splice(0, need).map((p) => p.name);
    if (pick.length === need) out[s] = pick;
  });
  // confidence per slot
  const conf = {};
  A.slots.forEach((s) => {
    const tot = cand.filter((c) => c.slot === s).reduce((a, c) => a + c.score, 0);
    const mine = cand.find((c) => c.slot === s && out[s] && c.who.join() === out[s].join());
    conf[s] = tot ? (mine ? mine.score / tot : 0) : 0;
  });
  return { lineup: out, conf };
};

// alternative scenarios for opponent
TR.scenarios = (team, A) => {
  A = A || TR.analyze(team);
  const pred = TR.predict(team, A);
  const avail = Object.values(A.players).filter((p) => p.rating != null && !p.offRoster && p.played > 0);
  const pool0 = (avail.length >= A.slots.length * 2 ? avail : Object.values(A.players).filter((p) => p.rating != null)).sort((a, b) => b.rating - a.rating);
  const build = (order) => {
    const used = new Set(), out = {};
    const singlesFirst = A.slots.filter((s) => s[0] === "S");
    const singlesCand = pool0.filter((p) => p.sw + p.sl > 0).concat(pool0.filter((p) => p.sw + p.sl === 0));
    singlesFirst.forEach((s) => { const p = singlesCand.find((x) => !used.has(x.name)); if (p) { out[s] = [p.name]; used.add(p.name); } });
    const dbl = A.slots.filter((s) => s[0] === "D");
    const rem = pool0.filter((p) => !used.has(p.name));
    const prs = [];
    // prefer known pairs among the top players
    A.pairs.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0)).forEach((pr) => { if (prs.length < dbl.length && pr.a.every((n) => rem.find((p) => p.name === n) && !used.has(n))) { prs.push(pr.a); pr.a.forEach((n) => used.add(n)); } });
    const rest = rem.filter((p) => !used.has(p.name));
    while (prs.length < dbl.length && rest.length >= 2) { const a = rest.shift(), b = rest.shift(); prs.push([a.name, b.name]); }
    prs.sort((a, b) => TR.pairRating(team, b) - TR.pairRating(team, a));
    if (order === "bottom") prs.reverse();
    dbl.forEach((s, i) => { if (prs[i]) out[s] = prs[i]; });
    return out;
  };
  return [
    { key: "pred", label: "Most likely (history)", lineup: pred.lineup, conf: pred.conf, weight: 0.6 },
    { key: "stack", label: "Stacked top", lineup: build("top"), weight: 0.25 },
    { key: "bottom", label: "Loaded bottom", lineup: build("bottom"), weight: 0.15 },
  ];
};

// ---------- win probability + optimizer ----------
TR.K = 7.5;
TR.pWin = (d) => 1 / (1 + Math.exp(-TR.K * d));
TR.teamWinProb = (ps) => {
  // Poisson-binomial; need majority
  let dist = [1];
  ps.forEach((p) => { const nd = new Array(dist.length + 1).fill(0); dist.forEach((v, k) => { nd[k] += v * (1 - p); nd[k + 1] += v * p; }); dist = nd; });
  const need = Math.floor(ps.length / 2) + 1;
  return dist.slice(need).reduce((a, b) => a + b, 0);
};

// strength of a unit (one of my lineup slots) incl. chemistry + singles experience
TR.unitStrength = (team, A, who, slot) => {
  if (!who || !who.length) return null;
  if (slot[0] === "S") {
    const r = TR.ratingOf(team, who[0]); if (r == null) return null;
    const p = A.players[who[0]]; const exp = p ? p.sw + p.sl : 0;
    return r - (exp === 0 ? 0.04 : 0);
  }
  const r = TR.pairRating(team, who); if (r == null) return null;
  const k = [...who].sort().join(" + ");
  const pr = A.pairs.find((x) => x.key === k);
  let chem = 0;
  if (pr) { const n = pr.w + pr.l; if (n) chem = Math.max(-0.03, Math.min(0.04, ((pr.w - pr.l) / n) * 0.02 * Math.min(n, 3))); chem += 0.01; }
  return r + chem;
};

TR.evalLineup = (my, myA, mine, opp, oppA, theirs) => {
  const per = {}; const ps = [];
  myA.slots.forEach((s) => {
    const a = TR.unitStrength(my, myA, mine[s], s);
    const b = theirs[s] ? TR.unitStrength(opp, oppA, theirs[s], s) : null;
    let p;
    if (a == null) p = 0; else if (b == null) p = 0.95; else p = TR.pWin(a - b);
    per[s] = { a, b, p }; ps.push(p);
  });
  return { per, team: TR.teamWinProb(ps), exp: ps.reduce((x, y) => x + y, 0) };
};

TR.legalPair = (team, fmt, who, genders) => {
  if (who.length !== 2) return true;
  if (fmt.mixed && genders) { const g = who.map((n) => genders[n]); if (g[0] && g[1] && g[0] === g[1]) return false; }
  if (fmt.combined && team.level) {
    const nt = who.map((n) => { const p = team.roster.find((r) => r.name === n); return p && p.ntrp ? +p.ntrp : 0; });
    if (nt[0] + nt[1] > +team.level + 1e-9) return false;
  }
  return true;
};

// optimize my lineup vs weighted opponent scenarios
TR.optimize = (my, myA, availNames, opp, oppA, scen, opts) => {
  opts = opts || {};
  const slots = myA.slots;
  const genders = {}; Object.entries(my.deep || {}).forEach(([n, d]) => (genders[n] = d.gender));
  const units = []; slots.forEach((s) => { const n = s[0] === "S" ? 1 : 2; for (let i = 0; i < n; i++) units.push(s); });
  const pool = availNames.filter((n) => TR.ratingOf(my, n) != null);
  if (pool.length < units.length) return null;
  const toLineup = (arr) => { const out = {}; units.forEach((s, i) => { (out[s] = out[s] || []).push(arr[i]); }); return out; };
  const score = (arr) => {
    const lu = toLineup(arr);
    for (const s of slots) if (s[0] === "D" && !TR.legalPair(my, myA.fmt, lu[s], genders)) return -1;
    let t = 0, e = 0;
    scen.forEach((sc) => { const r = TR.evalLineup(my, myA, lu, opp, oppA, sc.lineup); t += sc.weight * r.team; e += sc.weight * r.exp; });
    return t + 0.02 * e;
  };
  let best = null, bestS = -2;
  const restarts = opts.restarts || 60;
  for (let r = 0; r < restarts; r++) {
    let arr = pool.slice().sort(() => Math.random() - 0.5);
    if (r === 0) arr = pool.slice().sort((a, b) => TR.ratingOf(my, b) - TR.ratingOf(my, a));
    let cur = score(arr.slice(0, units.length).concat(arr.slice(units.length)));
    let improved = true, guard = 0;
    while (improved && guard++ < 60) {
      improved = false;
      for (let i = 0; i < units.length; i++) for (let j = i + 1; j < arr.length; j++) {
        if (j < units.length && units[i] === units[j]) continue;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        const s = score(arr);
        if (s > cur + 1e-9) { cur = s; improved = true; } else [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    if (cur > bestS) { bestS = cur; best = arr.slice(); }
  }
  const lineup = toLineup(best);
  slots.forEach((s) => { if (lineup[s] && lineup[s].length === 2) lineup[s].sort((a, b) => TR.ratingOf(my, b) - TR.ratingOf(my, a)); });
  return { lineup, score: bestS, bench: best.slice(units.length) };
};

