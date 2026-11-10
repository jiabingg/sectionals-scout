// Writes the captain's game plan with the Claude API (only when ANTHROPIC_API_KEY is set).

function buildPrompt(teamName, brief) {
  const mine = brief && brief.myTeam;
  return `You are an experienced USTA league captain's assistant for Southern California sectionals. Using ONLY the scouting data below, write a concise, practical game plan in Markdown for the captain${mine ? " of " + mine.name : ""}.

Sections (use these ## headings):
## The read on ${teamName}
2-4 bullets: who they are, how they set line-ups, strengths and soft spots. Cite numbers (dynamic ratings, W-L, courts).
## Their likely line-up
Court by court with your confidence, and what changes in the stacked / loaded-bottom scenarios.
${mine ? `## Our line-up
Court by court: who we should play and why (use courtOdds and plannedLineup; suggest swaps if a better trade-off exists, considering only available players).
## If they surprise us
2-3 contingency moves.` : `## How to beat them
Line-up principles for a team facing them.`}
## Court notes
Short tactical notes per key opponent player or pair, drawn from data (close-set record, 3rd-set tiebreak record, singles experience, captain notes). Do not invent playing styles that are not in the notes.
## Sectionals logistics
2-3 bullets: multiple matches in a weekend, rest/rotation, tiebreak readiness.

Rules: dynamic ratings are TennisRecord estimates, say "est." once. Be direct, no filler, under 550 words. Use player names as given.

DATA:
${JSON.stringify(brief)}`;
}

async function writePlan(cfg, teamName, brief) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(120000),
    headers: { "content-type": "application/json", "x-api-key": cfg.anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: 2000, messages: [{ role: "user", content: buildPrompt(teamName, brief) }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Claude API error ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status === 429 ? 429 : 502 });
  }
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

module.exports = { writePlan, buildPrompt };
