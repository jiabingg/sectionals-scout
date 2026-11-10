// HTML parsers for TennisRecord pages. Output shapes match what the browser analytics (public/app.js) expect.
const cheerio = require("cheerio");

const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const qp = (href, key) => {
  if (!href) return null;
  try { return new URL(href, "https://x.invalid").searchParams.get(key); } catch (e) { return null; }
};
const isRating2 = (s) => /^\d\.\d\d$/.test(s);
const isNtrp = (s) => /^\d\.\d$/.test(s);
const isWL = (s) => /^\d+-\d+$/.test(s);
const root = ($) => ($("main").length ? $("main") : $("body"));

// ---------- team search ----------
function parseSearch(html) {
  const $ = cheerio.load(html);
  const text = clean(root($).text());
  const m = text.match(/(\d+) team\(s\) found/i);
  if (!m) throw Object.assign(new Error("TennisRecord's team search page didn't look as expected."), { code: "parse" });
  const teams = [];
  const seen = new Set();
  root($).find('a[href*="teamprofile.aspx"]').each((_, a) => {
    const href = $(a).attr("href");
    const name = qp(href, "teamname") || clean($(a).text());
    if (!name || seen.has(name)) return;
    seen.add(name);
    const tds = $(a).closest("tr").children("td").map((i, td) => clean($(td).text())).get();
    teams.push({ name, year: qp(href, "year"), s: qp(href, "s"), type: tds[1] || "", section: tds[2] || "", gender: tds[3] || "", level: tds[4] || "", start: /\d/.test(tds[5] || "") ? tds[5] : "" });
  });
  return { count: +m[1], teams };
}

// ---------- team profile ----------
function parseTeam(html) {
  const $ = cheerio.load(html);
  const R = root($);
  const team = { header: null, league: null, section: null, gender: null, level: null, flight: null, name: null, roster: [], schedule: [] };

  // header block: "Adult 18+ So California F 4.0", flight link, team name
  const cells = R.find("td").toArray();
  for (let i = 0; i < cells.length; i++) {
    const t = clean($(cells[i]).text());
    if (/^(Adult|Mixed|Tri-Level|Combo|Flex|Senior|Super|Junior)/.test(t) && /\d\.\d$/.test(t) && t.length < 80) {
      team.header = t;
      const m = t.match(/^(.*?\d\+|.*?\d+-\d+|\S+(?: \S+)?)\s+(.*)\s+([MFXC])\s+(\d+\.\d)$/);
      if (m) { team.league = m[1]; team.section = m[2]; team.gender = m[3]; team.level = m[4]; }
      let j = i + 1;
      const fl = $(cells[j]).find('a[href*="league.aspx"]');
      if (fl.length) { team.flight = clean(fl.text()); j++; }
      const nm = clean($(cells[j]).text());
      if (nm && !$(cells[j]).find("a").length) team.name = nm;
      break;
    }
  }

  // desktop tables live in .large (the .small copies are the phone layout)
  let tables = R.find(".large table").toArray();
  if (!tables.length) tables = R.find("table").toArray();

  const rosterTbl = tables.find((t) => clean($(t).find("th").first().text()) === "Name");
  if (rosterTbl) {
    const headers = $(rosterTbl).find("tr").first().children("th").map((i, th) => clean($(th).text()).toLowerCase().replace(/\s/g, "")).get();
    const seen = new Set();
    $(rosterTbl).find("tr").slice(1).each((_, tr) => {
      const a = $(tr).find('a[href*="playername="]').first();
      if (!a.length) return;
      const href = a.attr("href");
      const name = qp(href, "playername") || clean(a.text());
      if (seen.has(name)) return;
      seen.add(name);
      const tds = $(tr).children("td").map((i, td) => clean($(td).text())).get();
      const o = { name, s: qp(href, "s"), loc: null, ntrp: null, record: null, rating: null, localS: null, localD: null, postS: null, postD: null, ntrpType: null };
      tds.forEach((v, k) => {
        const h = headers[k] || "";
        if (h === "location") o.loc = v || null;
        else if (h === "ntrp") o.ntrp = v || null;
        else if (/^\d{4}record$/.test(h)) o.record = v || null;
        else if (h === "localsingles") o.localS = v;
        else if (h === "localdoubles") o.localD = v;
        else if (h === "postseasonsingles") o.postS = v;
        else if (h === "postseasondoubles") o.postD = v;
        else if (h === "rating") o.rating = isRating2(v) ? +v : null;
      });
      if (!o.ntrp) o.ntrp = tds.find(isNtrp) || null;
      if (o.rating == null) { const r = [...tds].reverse().find(isRating2); o.rating = r ? +r : null; }
      if (!o.record) o.record = tds.find(isWL) || null;
      team.roster.push(o);
    });
  }

  const mids = new Set();
  tables.forEach((t) => {
    const h = clean($(t).find("th").first().text());
    if (!/Schedule$/.test(h)) return;
    const section = h.replace(/\s*Schedule$/, "");
    $(t).find("tr").slice(1).each((_, tr) => {
      const res = $(tr).find('a[href*="matchresults.aspx"]').first();
      if (!res.length) return;
      const mid = qp(res.attr("href"), "mid");
      if (!mid || mids.has(mid)) return;
      mids.add(mid);
      const oppA = $(tr).find('a[href*="teamprofile.aspx"]').first();
      const dm = clean($(tr).text()).match(/\d\d\/\d\d\/\d{4}/);
      team.schedule.push({ mid, opp: oppA.length ? qp(oppA.attr("href"), "teamname") || clean(oppA.text()) : null, date: dm ? dm[0] : null, section, result: clean(res.text()) });
    });
  });
  return team;
}

// ---------- scorecard ----------
function parseMatch(html) {
  const $ = cheerio.load(html);
  const R = root($);
  const m = { date: null, type: null, header: null, home: null, visit: null, lines: [] };
  R.find("tr").each((_, tr) => {
    const tds = $(tr).children("td");
    if (tds.length < 2) return;
    const k = clean($(tds[0]).text()), v = clean($(tds[1]).text());
    if (k === "Scheduled Date:") m.date = v.slice(0, 10);
    else if (k === "Match Type:") m.type = v;
  });
  const hdr = R.find("td[colspan]").first();
  if (hdr.length) m.header = clean(hdr.text());
  // team table: first two teamprofile links (home team listed first)
  const teamLinks = R.find('a[href*="teamprofile.aspx"]').toArray().slice(0, 2).map((a) => qp($(a).attr("href"), "teamname") || clean($(a).text()));
  m.home = teamLinks[0] || null;
  m.visit = teamLinks[1] || null;

  R.find("div").each((_, div) => {
    const label = clean($(div).children("div").first().text());
    const lm = label.match(/^(Singles|Doubles) #(\d)$/);
    if (!lm) return;
    const box = $(div).nextAll().filter((i, el) => $(el).find("table").length > 0).first();
    const row = box.find("tr").toArray().find((tr) => $(tr).find('a[href*="playername="]').length);
    const line = { line: (lm[1] === "Singles" ? "S" : "D") + lm[2], home: [], visit: [], homeR: null, visitR: null, homeRs: [], visitRs: [], score: null, winner: null };
    if (row) {
      const tds = $(row).children("td").toArray();
      const playerTds = tds.filter((td) => $(td).find('a[href*="playername="]').length);
      const scoreIdx = tds.findIndex((td) => /\d+\s*-\s*\d+/.test($(td).text()) && !$(td).find("a").length);
      const sideOf = (td) => {
        const names = $(td).find('a[href*="playername="]').map((i, a) => qp($(a).attr("href"), "playername") || clean($(a).text())).get();
        const rs = (clean($(td).text()).match(/\((\d\.\d\d)\)/g) || []).map((x) => +x.slice(1, -1));
        return { names, rs };
      };
      if (playerTds[0]) { const s = sideOf(playerTds[0]); line.home = s.names; line.homeRs = s.rs; }
      if (playerTds[1]) { const s = sideOf(playerTds[1]); line.visit = s.names; line.visitRs = s.rs; }
      const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
      line.homeR = avg(line.homeRs); line.visitR = avg(line.visitRs);
      if (scoreIdx >= 0) {
        const parts = ($(tds[scoreIdx]).html() || "").split(/<br\s*\/?>/i).map((x) => clean(cheerio.load(x).text())).filter(Boolean);
        line.score = parts.map((p) => p.replace(/\s*-\s*/, "-")).join(" ");
        if (/[a-z]/i.test(line.score)) line.note = line.score;
      } else {
        const t = clean($(row).text());
        const note = t.match(/default|retire|forfeit|timed/i);
        if (note) line.note = note[0];
      }
      const winIdx = tds.findIndex((td) => $(td).find('img[alt="Winner"]').length);
      if (winIdx >= 0) {
        const ref = scoreIdx >= 0 ? scoreIdx : Math.floor(tds.length / 2);
        line.winner = winIdx < ref ? "home" : winIdx > ref ? "visit" : null;
      }
    }
    m.lines.push(line);
  });
  return m;
}

// ---------- player stats ----------
function parseStats(html) {
  const $ = cheerio.load(html);
  const R = root($);
  const o = { gender: null, ntrp: null, ntrpType: null, edr: null, record: null, streak: null, setTB: null, tb3: null, post: null, avgOpp: null };
  R.find("span").each((_, sp) => {
    const t = clean($(sp).text());
    if (!o.gender && /^(Male|Female)$/.test(t)) o.gender = t[0];
    const m = t.match(/^(\d\.\d)\s*([A-Z])?$/);
    if (m && !o.ntrp) { o.ntrp = m[1]; o.ntrpType = m[2] || null; }
  });
  const rows = {};
  R.find("tr").each((_, tr) => {
    const tds = $(tr).children("td");
    if (tds.length < 2) return;
    const k = clean($(tds[0]).text()).replace(/:$/, "");
    if (!(k in rows)) rows[k] = tds.toArray().slice(1).map((td) => clean($(td).text()));
  });
  const first = (k) => (rows[k] ? rows[k][0] : null);
  const edr = (first("Estimated Dynamic Rating") || "").match(/\d\.\d{2,4}/);
  o.edr = edr ? +edr[0] : null;
  o.record = first("Record");
  o.streak = first("Current W/L Streak");
  o.setTB = first("Set Tiebreak Record");
  o.tb3 = first("3rd Set Tiebreak Record");
  o.post = first("Postseason Record");
  const ao = first("Average Opponent Rating");
  o.avgOpp = ao && /^\d\.\d+$/.test(ao) ? +ao : null;
  const nums = (k) => (rows[k] && rows[k].length >= 4 && rows[k].every((x) => /^[\d.]+$/.test(x)) ? { s1: +rows[k][0], s2: +rows[k][1], s3: +rows[k][2], tot: +rows[k][3] } : null);
  o.gps = nums("Games Per Set");
  o.oppGps = nums("Opponent");
  return o;
}

module.exports = { parseSearch, parseTeam, parseMatch, parseStats, qp };
