// Builds HTML pages with the same markup TennisRecord served in Nov 2026 (captured structure, fictional names).
// Used by the parser tests and by the mock TennisRecord server in the end-to-end test.

const shell = (inner) => `<!DOCTYPE html><html><head><title>TennisRecord.com - Estimated Tennis Ratings &amp; Stats</title><script>var ads=1;</script></head>
<body><header><a href="/index.aspx">home</a></header><main><div class="container-page">${inner}</div></main>
<div style="width:100%; text-align:center;">This site is not affiliated with the USTA.</div></body></html>`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const pl = (name, s) => `<a class="link" href="/adult/profile.aspx?playername=${esc(name)}${s ? "&amp;s=" + s : ""}">${esc(name)}</a>`;

function searchPage(q, teams) {
  const rows = teams.map((t, i) => `<tr style="height:45px;${i < teams.length - 1 ? " border-bottom:1px solid #ddd;" : ""}"><td style="text-align:left;" class="responsivewidth padding10"><a class="link" href="/adult/teamprofile.aspx?year=${t.year}&amp;teamname=${esc(t.name)}">${esc(t.name)}</a></td><td style="text-align:center;" class="hide">${t.type}</td><td style="text-align:center;" class="hide">So California</td><td style="text-align:center;">${t.gender}</td><td style="text-align:center;">${t.level}</td><td style="text-align:center;"> ---------- </td></tr>`).join("");
  return shell(`<div class="wrapper1000"><form method="post"><table class="responsive14"><tr><td>Team Name</td><td><input name="teamname" value="${esc(q)}"></td></tr></table></form></div>
<div class="wrapper1000" style="margin-top:16px;"><div style="text-align:left; padding-left:5px; font-size:12px;">${teams.length} team(s) found for ${esc(q)}.</div></div>
<div class="container1000" style="margin:0;"><table style="margin:auto; width:100%;" class="responsive14"><tbody><tr style="height:50px;"><th class="responsivewidth padding10">Team Name</th><th class="hide">Type</th><th class="hide">Section</th><th>Gender</th><th>Rating</th><th>Match Start</th></tr>${rows}</tbody></table></div>`);
}

function teamPage(t) {
  const hdr = `<div class="wrapper1000"><div class="container496"><table class="responsive14"><tbody><tr><td class="responsive18 padding10">Team Profile</td></tr></tbody></table><table class="responsive14"><tbody><tr><td class="padding10">${t.header}</td></tr><tr><td class="padding10"><a class="link" href="/adult/league.aspx?flightname=Men%27s 4.0 - Test&amp;year=${t.year}">${esc(t.flight)}</a></td></tr><tr><td class="padding10">${esc(t.name)}</td></tr></tbody></table></div>`;
  const big = `<div class="large"><div class="container1000"><table class="responsive14"><tbody><tr><th class="padding10">Name</th><th class="hide">Location</th><th>NTRP</th><th>${t.year}<br>Record</th><th>Local<br>Singles</th><th>Local<br>Doubles</th><th>Local<br>Record</th><th colspan="2">Rating</th></tr>${t.roster.map((p) => `<tr><td class="padding10">${pl(p.name, p.s)}</td><td class="hide">${p.loc || ""}</td><td>${p.ntrp}</td><td>${p.record}</td><td>${p.localS}</td><td>${p.localD}</td><td>0-0</td><td>${p.rating}</td><td></td></tr>`).join("")}</tbody></table></div></div>`;
  const small = `<div class="small"><div class="container496"><table class="responsive14"><tbody><tr><th class="padding10">Name</th><th class="hide">Location</th><th>NTRP</th><th>${t.year}<br>Record</th><th>Local<br>Record</th><th colspan="2">Rating</th></tr>${t.roster.map((p) => `<tr><td class="padding10">${pl(p.name, p.s)}</td><td class="hide">${p.loc || ""}</td><td>${p.ntrp}</td><td>${p.record}</td><td>0-0<br>0-0<br>0-0</td><td>${p.rating}</td><td></td></tr>`).join("")}</tbody></table></div></div>`;
  const sched = t.sections.map((sec) => `<div class="large"><div class="container1000"><table class="responsive14"><tbody><tr><th class="padding10">${sec.title}</th><th>Time</th><th>Opponent</th><th>Match Site</th><th class="padding10">Result</th></tr>${sec.matches.map((m) => `<tr><td class="padding10">${m.date}</td><td>3:00 PM</td><td><a class="link" href="/adult/teamprofile.aspx?teamname=${esc(m.opp)}&amp;year=${t.year}">${esc(m.opp)}</a></td><td>Test Racquet Club</td><td class="padding10">${m.mid ? `<a class="link" href="/adult/matchresults.aspx?year=${t.year}&amp;mid=${m.mid}">${m.result}</a>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`).join("");
  return shell(hdr + big + small + sched + "</div>");
}

function matchPage(m) {
  const lines = m.lines.map((l) => {
    const side = (ps) => ps.map((p) => `${pl(p[0])} (${p[1].toFixed(2)}) `).join("<br>");
    const score = l.score.split(" ").map((s) => s.replace("-", " - ")).join("<br>");
    const arrowL = l.winner === "home" ? `<img src="/images/arrowhead_right.png" alt="Winner">` : "";
    const arrowR = l.winner === "visit" ? `<img src="/images/arrowhead_left.png" alt="Winner">` : "";
    return `<div class="wrapper496"><div>${l.line}</div><div>Scoring: Tiebreak</div></div><div class="container496"><table class="responsive14"><tbody><tr><td class="padding10">Home Team</td><td></td><td></td><td>Score</td><td></td><td></td><td class="padding10">Visiting Team</td></tr><tr><td class="padding10">${side(l.home)}</td><td></td><td>${arrowL}</td><td>${score}</td><td>${arrowR}</td><td></td><td class="padding10">${side(l.visit)}</td></tr></tbody></table></div>`;
  }).join("");
  return shell(`<div class="wrapper496"><div class="container496"><table class="responsive14"><tbody><tr><td class="responsive18 padding10">Match Results</td></tr></tbody></table><table class="responsive14"><tbody><tr><td colspan="2" class="padding10">${m.header}</td></tr><tr><td>Scheduled Date:</td><td>${m.date}</td></tr><tr><td>Match Site:</td><td>Test Racquet Club</td></tr><tr><td>Match Criteria:</td><td>Team Wins</td></tr><tr><td>Match Type:</td><td>${m.type}</td></tr></tbody></table></div><div class="container496"><table class="responsive14"><tbody><tr><th class="padding10">Team Name</th><th>Courts Won</th><th>Sets Lost</th><th class="padding10">Games Lost</th></tr><tr><td class="padding10"><a class="link" href="/adult/teamprofile.aspx?teamname=${esc(m.home)}&amp;year=2026">${esc(m.home)}</a></td><td>3</td><td>2</td><td>33</td></tr><tr><td class="padding10"><a class="link" href="/adult/teamprofile.aspx?teamname=${esc(m.visit)}&amp;year=2026&amp;s=2">${esc(m.visit)}</a></td><td>2</td><td>7</td><td>46</td></tr></tbody></table></div>${lines}</div>`);
}

function statsPage(p) {
  return shell(`<div class="wrapper1000"><div class="container1000"><table class="responsive14"><tbody><tr><td class="responsive18 padding10">Player Stats</td><td class="padding10"><a class="link" href="/adult/playerstats.aspx?playername=${esc(p.name)}&amp;year=2026">View Advanced Player Stats</a></td></tr></tbody></table><div class="wrapper65"><table class="responsive14"><tbody><tr><td class="responsive16 leftright10">${pl(p.name)} (Test City, CA) <br><span class="responsive12">${p.gender}</span></td><td class="responsive16 leftright10"><span>${p.ntrp} ${p.type}</span><br><span class="responsive12">12/31/2025</span></td></tr><tr><td class="leftright10">Estimated Dynamic Rating</td><td class="responsive16 leftright10"><span>${p.edr} </span><br><span class="responsive12">11/5/2026</span></td></tr><tr><td class="leftright10">Projected Year End Rating</td><td class="responsive16 leftright10"> ------<br><span>----------</span></td></tr></tbody></table></div><div class="wrapper35"><div><span>4.0 Rating Meter</span><br><img src="/images/ratingmeter45.png" alt="Rating Meter"><br><span>3.5001 - 4.0000</span></div></div></div>
<div class="container1000"><table class="responsive14"><tbody><tr><th class="padding10">2026</th><th></th><th></th></tr><tr><td class="padding10">Record:</td><td class="padding10">${p.record}</td></tr><tr><td class="padding10">Current W/L Streak:</td><td class="padding10"><a class="link" href="#">W1</a></td></tr><tr><td class="padding10">Set Tiebreak Record:</td><td class="padding10"><a class="link" href="#">1-2</a> (33.3%)</td></tr><tr><td class="padding10">3rd Set Tiebreak Record:</td><td class="padding10"><a class="link" href="#">${p.tb3}</a> (37.5%)</td></tr><tr><td class="padding10">Postseason Record:</td><td class="padding10"><a class="link" href="#">1-1</a> (50.0%)</td></tr><tr><td class="padding10">Average Opponent Rating:</td><td class="padding10">3.7768</td></tr></tbody></table></div>
<div class="container1000"><table class="responsive14"><tbody><tr><th class="padding10">2026</th><th>1st</th><th>2nd</th><th>3rd</th><th class="padding10">Total</th></tr><tr><td class="padding10">Games Per Set:</td><td>4.48</td><td>4.87</td><td>2.25</td><td class="padding10">4.32</td></tr><tr><td class="padding10">Opponent:</td><td>4.23</td><td>3.99</td><td>3.75</td><td class="padding10">6.76</td></tr></tbody></table></div></div>`);
}

// ---- a small fictional league ----
const OUR = "Test - Harbor Hawks 4.0", OPP = "Test - Canyon Club 4.0";
const roster = [
  ["Avery Stone", "4.0", 3.98], ["Blake Rivera", "4.0", 3.94], ["Casey Moore", "4.0", 3.91], ["Drew Patel", "4.0", 3.88],
  ["Emery Cole", "4.0", 3.84], ["Finley Shaw", "4.0", 3.80], ["Gray Lopez", "3.5", 3.72], ["Harper Quinn", "3.5", 3.66],
].map(([name, ntrp, rating], i) => ({ name, ntrp, rating: rating.toFixed(2), record: `${8 - i}-${2 + i}`, localS: i < 2 ? "2-0" : "0-0", localD: "1-1", loc: "Test City, CA", s: i === 7 ? "3" : null }));
const opp = ["Opp One", "Opp Two", "Opp Three", "Opp Four", "Opp Five", "Opp Six", "Opp Seven", "Opp Eight"];
const R = (n) => [n, roster.find((p) => p.name === n).rating * 1];
const O = (n, r) => [n, r];
const matches = [
  { mid: "9001", date: "03/01/2026", type: "Local Match", home: OUR, visit: OPP, lines: [
    { line: "Singles #1", home: [R("Avery Stone")], visit: [O(opp[0], 3.9)], score: "6-4 6-3", winner: "home" },
    { line: "Singles #2", home: [R("Blake Rivera")], visit: [O(opp[1], 3.85)], score: "4-6 6-3 1-0", winner: "home" },
    { line: "Doubles #1", home: [R("Casey Moore"), R("Drew Patel")], visit: [O(opp[2], 3.9), O(opp[3], 3.8)], score: "6-7 4-6", winner: "visit" },
    { line: "Doubles #2", home: [R("Emery Cole"), R("Finley Shaw")], visit: [O(opp[4], 3.7), O(opp[5], 3.7)], score: "6-2 6-2", winner: "home" },
    { line: "Doubles #3", home: [R("Gray Lopez"), R("Harper Quinn")], visit: [O(opp[6], 3.6), O(opp[7], 3.5)], score: "3-6 6-4 0-1", winner: "visit" } ] },
  { mid: "9002", date: "03/15/2026", type: "Local Match", home: OPP, visit: OUR, lines: [
    { line: "Singles #1", home: [O(opp[0], 3.9)], visit: [R("Avery Stone")], score: "6-3 6-4", winner: "home" },
    { line: "Singles #2", home: [O(opp[1], 3.85)], visit: [R("Casey Moore")], score: "6-1 6-2", winner: "visit" },
    { line: "Doubles #1", home: [O(opp[2], 3.9), O(opp[3], 3.8)], visit: [R("Blake Rivera"), R("Drew Patel")], score: "7-5 6-4", winner: "visit" },
    { line: "Doubles #2", home: [O(opp[4], 3.7), O(opp[5], 3.7)], visit: [R("Emery Cole"), R("Finley Shaw")], score: "6-4 6-4", winner: "visit" },
    { line: "Doubles #3", home: [O(opp[6], 3.6), O(opp[7], 3.5)], visit: [R("Gray Lopez"), R("Harper Quinn")], score: "6-3 6-3", winner: "home" } ] },
  { mid: "9003", date: "07/18/2026", type: "Sectional Match", home: OUR, visit: "Test - Valley Aces 4.0", lines: [
    { line: "Singles #1", home: [R("Avery Stone")], visit: [O("Val One", 4.0)], score: "6-4 7-6", winner: "home" },
    { line: "Singles #2", home: [R("Blake Rivera")], visit: [O("Val Two", 3.9)], score: "2-6 6-4 1-0", winner: "home" },
    { line: "Doubles #1", home: [R("Casey Moore"), R("Drew Patel")], visit: [O("Val Three", 3.9), O("Val Four", 3.85)], score: "6-3 6-2", winner: "home" },
    { line: "Doubles #2", home: [R("Emery Cole"), R("Gray Lopez")], visit: [O("Val Five", 3.8), O("Val Six", 3.7)], score: "4-6 3-6", winner: "visit" },
    { line: "Doubles #3", home: [R("Finley Shaw"), R("Harper Quinn")], visit: [O("Val Seven", 3.7), O("Val Eight", 3.6)], score: "6-4 6-4", winner: "home" } ] },
];
const team = {
  name: OUR, year: "2026", header: "Adult 18+ So California M 4.0", flight: "2026 Adult 18 & Over - Test (Men's 4.0 - Test)", roster,
  sections: [
    { title: "Local Schedule", matches: [{ date: "03/01/2026", opp: OPP, mid: "9001", result: "3-2" }, { date: "03/15/2026", opp: OPP, mid: "9002", result: "3-2" }, { date: "04/05/2026", opp: OPP, mid: null }] },
    { title: "Sectional Schedule", matches: [{ date: "07/18/2026", opp: "Test - Valley Aces 4.0", mid: "9003", result: "4-1" }] },
  ],
};
const stats = Object.fromEntries(roster.map((p, i) => [p.name, { name: p.name, gender: "Male", ntrp: p.ntrp, type: i === 7 ? "S" : "C", edr: (p.rating * 1 + 0.0042).toFixed(4), record: "13-10 (56.5%)", tb3: `${3 - (i % 2)}-${i % 3}` }]));

const league = {
  OUR, OPP, team, matches, stats,
  search: (q) => [{ name: OUR, year: "2026", type: "Adult 18+", gender: "M", level: "4.0" }, { name: "Test - Harbor Hawks 3.5", year: "2026", type: "Adult 18+", gender: "M", level: "3.5" }].filter((t) => t.name.toLowerCase().includes(String(q).toLowerCase())),
};

module.exports = { searchPage, teamPage, matchPage, statsPage, league };
