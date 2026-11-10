// Email magic-link sign-in. Only emails the admin has added (or ADMIN_EMAILS) can sign in.
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const COOKIE = "ss_session";
const LINK_MS = 20 * 60e3;
const SESSION_MS = 30 * 864e5;
const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

function createAuth(db, cfg) {
  const q = {
    user: db.prepare("SELECT email, role FROM users WHERE email = ?"),
    addUser: db.prepare("INSERT INTO users (email, role, added_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role"),
    delUser: db.prepare("DELETE FROM users WHERE email = ?"),
    listUsers: db.prepare("SELECT email, role, added_by, created_at, last_login FROM users ORDER BY role, email"),
    touch: db.prepare("UPDATE users SET last_login = ? WHERE email = ?"),
    putToken: db.prepare("INSERT INTO login_tokens (hash, email, expires_at) VALUES (?, ?, ?)"),
    getToken: db.prepare("SELECT email, expires_at, used FROM login_tokens WHERE hash = ?"),
    useToken: db.prepare("UPDATE login_tokens SET used = 1 WHERE hash = ? AND used = 0"),
    putSession: db.prepare("INSERT INTO sessions (hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)"),
    getSession: db.prepare("SELECT email, expires_at FROM sessions WHERE hash = ?"),
    delSession: db.prepare("DELETE FROM sessions WHERE hash = ?"),
    delUserSessions: db.prepare("DELETE FROM sessions WHERE email = ?"),
    purge: db.prepare("DELETE FROM login_tokens WHERE expires_at < ?"),
    purgeS: db.prepare("DELETE FROM sessions WHERE expires_at < ?"),
  };
  for (const e of cfg.adminEmails) q.addUser.run(e, "admin", "ADMIN_EMAILS", Date.now());
  setInterval(() => { q.purge.run(Date.now()); q.purgeS.run(Date.now()); }, 3600e3).unref();

  const transport = cfg.smtp.host ? nodemailer.createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure, auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined }) : null;
  const devLinks = cfg.devLoginLinks && cfg.isLocal;

  // simple rate limits
  const hits = new Map();
  const limited = (key, max, windowMs) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now); hits.set(key, arr);
    return arr.length > max;
  };

  const roleOf = (email) => {
    if (cfg.adminEmails.includes(email)) return "admin";
    const u = q.user.get(email);
    return u ? u.role : null;
  };

  async function sendMail(to, subject, text, html) {
    if (!transport) { console.log(`\n[mail not configured] To: ${to}\nSubject: ${subject}\n${text}\n`); return false; }
    await transport.sendMail({ from: cfg.smtp.from || cfg.smtp.user, to, subject, text, html });
    return true;
  }

  async function requestLink(rawEmail, ip) {
    const email = normEmail(rawEmail);
    if (!validEmail(email)) return { ok: false, error: "Enter a valid email address." };
    if (limited("ip:" + ip, 20, 15 * 60e3) || limited("em:" + email, 5, 15 * 60e3)) return { ok: false, error: "Too many sign-in requests. Wait a few minutes and try again." };
    const generic = { ok: true, message: "If that email is on the team list, a sign-in link is on its way. It works once and expires in 20 minutes." };
    if (!roleOf(email)) return generic;
    const token = crypto.randomBytes(32).toString("base64url");
    q.putToken.run(sha(token), email, Date.now() + LINK_MS);
    const link = `${cfg.baseUrl}/auth/verify?token=${token}`;
    const text = `Sign in to ${cfg.appName}:\n\n${link}\n\nThis link works once and expires in 20 minutes. If you didn't ask for it, ignore this email.`;
    const html = `<p>Sign in to <b>${cfg.appName}</b>:</p><p><a href="${link}" style="display:inline-block;background:#1d5c52;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Sign in</a></p><p style="color:#666;font-size:13px">This link works once and expires in 20 minutes. If you didn't ask for it, ignore this email.</p>`;
    try { await sendMail(email, `Your ${cfg.appName} sign-in link`, text, html); }
    catch (e) { console.error("[mail]", e.message); return { ok: false, error: "The sign-in email couldn't be sent. Ask the site admin to check the email settings." }; }
    return devLinks ? { ...generic, devLink: link } : generic;
  }

  // GET shows a button (mail scanners that prefetch links can't burn the token); POST signs in.
  function verifyPage(token) {
    const t = String(token || "").replace(/[^A-Za-z0-9_-]/g, "");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · ${cfg.appName}</title><link rel="stylesheet" href="/app.css"></head>
<body class="authpage"><form class="authcard" method="post" action="/auth/verify"><span class="ball" aria-hidden="true"></span><h1>${cfg.appName}</h1><p>Finish signing in on this device.</p><input type="hidden" name="token" value="${t}"><button class="btn primary" type="submit">Sign in</button></form></body></html>`;
  }

  function consume(token) {
    const h = sha(String(token || ""));
    const row = q.getToken.get(h);
    if (!row || row.used || row.expires_at < Date.now()) return null;
    if (q.useToken.run(h).changes !== 1) return null;
    if (!roleOf(row.email)) return null;
    const sid = crypto.randomBytes(32).toString("base64url");
    q.putSession.run(sha(sid), row.email, Date.now() + SESSION_MS, Date.now());
    q.touch.run(Date.now(), row.email);
    return sid;
  }

  const cookieHeader = (sid, maxAgeMs) => `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${cfg.secureCookies ? "; Secure" : ""}`;

  function readCookie(req) {
    const m = String(req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([A-Za-z0-9_-]+)"));
    return m ? m[1] : null;
  }

  function middleware(req, res, next) {
    req.user = null;
    const sid = readCookie(req);
    if (sid) {
      const s = q.getSession.get(sha(sid));
      if (s && s.expires_at > Date.now()) {
        const role = roleOf(s.email);
        if (role) req.user = { email: s.email, role };
      }
    }
    next();
  }

  function logout(req) { const sid = readCookie(req); if (sid) q.delSession.run(sha(sid)); }

  return {
    COOKIE, SESSION_MS, requestLink, verifyPage, consume, cookieHeader, middleware, logout, sendMail, roleOf,
    listUsers: () => q.listUsers.all().map((u) => ({ ...u, fromEnv: cfg.adminEmails.includes(u.email) })),
    addUser: (email, role, by) => { email = normEmail(email); if (!validEmail(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 }); q.addUser.run(email, role === "admin" ? "admin" : "member", by, Date.now()); return email; },
    removeUser: (email) => { email = normEmail(email); if (cfg.adminEmails.includes(email)) throw Object.assign(new Error("This admin is set by ADMIN_EMAILS on the server."), { status: 400 }); q.delUser.run(email); q.delUserSessions.run(email); },
    mailReady: !!transport,
  };
}

module.exports = { createAuth };
