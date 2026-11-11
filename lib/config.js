// All settings come from environment variables (see .env.example).
const fs = require("fs");
const path = require("path");

// Minimal .env loader so `npm start` works locally without extra packages.
const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);

const port = +env("PORT", 3000);
const baseUrl = env("BASE_URL", `http://localhost:${port}`).replace(/\/+$/, "");

module.exports = {
  port,
  baseUrl,
  // Behind a hosting proxy (Railway, Render, Fly), trust it so visitor IPs are right.
  trustProxy: env("TRUST_PROXY", baseUrl.startsWith("https://") || process.env.RAILWAY_ENVIRONMENT || process.env.RENDER || process.env.FLY_APP_NAME ? "1" : "0") === "1",
  dataDir: path.resolve(env("DATA_DIR", path.join(__dirname, "..", "data"))),
  // Optional. When set, scouting, removing teams and writing game plans need this password. Viewing never does.
  adminPassword: env("ADMIN_PASSWORD", ""),
  appName: env("APP_NAME", "Sectionals Scout"),
  section: env("SECTION", "So California"),

  anthropicKey: env("ANTHROPIC_API_KEY", ""),
  anthropicModel: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
  
  tr: {
    base: env("TR_BASE_URL", "https://www.tennisrecord.com").replace(/\/+$/, ""),
    concurrency: Math.max(1, +env("SCOUT_CONCURRENCY", 2)),
    gapMs: +env("REQUEST_GAP_MS", 1000),
    timeoutMs: +env("REQUEST_TIMEOUT_MS", 90000),
    userAgent: env("USER_AGENT", "SectionalsScout/1.0 (USTA league captain scouting tool; low volume)"),
  },
};
