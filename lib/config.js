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
const list = (s) => String(s || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

const port = +env("PORT", 3000);
const baseUrl = env("BASE_URL", `http://localhost:${port}`).replace(/\/+$/, "");
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(baseUrl);

module.exports = {
  port,
  baseUrl,
  isLocal,
  secureCookies: baseUrl.startsWith("https://"),
  trustProxy: env("TRUST_PROXY", baseUrl.startsWith("https://") ? "1" : "0") === "1",
  dataDir: path.resolve(env("DATA_DIR", path.join(__dirname, "..", "data"))),
  adminEmails: list(env("ADMIN_EMAILS", "")),
  appName: env("APP_NAME", "Sectionals Scout"),
  section: env("SECTION", "So California"),

  smtp: {
    host: env("SMTP_HOST", ""),
    port: +env("SMTP_PORT", 587),
    secure: env("SMTP_SECURE", "0") === "1",
    user: env("SMTP_USER", ""),
    pass: env("SMTP_PASS", ""),
    from: env("MAIL_FROM", ""),
  },
  // Local testing without email: the sign-in link is shown on screen. Only honored when BASE_URL is localhost.
  devLoginLinks: env("DEV_LOGIN_LINKS", "0") === "1",

  anthropicKey: env("ANTHROPIC_API_KEY", ""),
  anthropicModel: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
  plansFor: env("PLANS_FOR", "admins"), // "admins" or "members"

  tr: {
    base: env("TR_BASE_URL", "https://www.tennisrecord.com").replace(/\/+$/, ""),
    concurrency: Math.max(1, +env("SCOUT_CONCURRENCY", 2)),
    gapMs: +env("REQUEST_GAP_MS", 1000),
    timeoutMs: +env("REQUEST_TIMEOUT_MS", 90000),
    userAgent: env("USER_AGENT", "SectionalsScout/1.0 (USTA league captain scouting tool; low volume)"),
  },
};
