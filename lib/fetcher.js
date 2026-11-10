// Polite HTTP client for TennisRecord: limited concurrency, a gap between requests,
// long timeouts (the site often takes 15-30 s per page), retries, and a page cache in SQLite.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Fetcher {
  constructor(db, opts) {
    this.db = db;
    this.base = opts.base;
    this.concurrency = opts.concurrency;
    this.gapMs = opts.gapMs;
    this.timeoutMs = opts.timeoutMs;
    this.userAgent = opts.userAgent;
    this.active = 0;
    this.waiters = [];
    this.lastStart = 0;
    this.getCache = db.prepare("SELECT body, fetched_at FROM pages WHERE url = ?");
    this.putCache = db.prepare("INSERT INTO pages (url, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at");
  }

  url(p) { return /^https?:/.test(p) ? p : this.base + p; }

  async _slot(signal) {
    while (this.active >= this.concurrency) {
      await new Promise((r) => this.waiters.push(r));
      if (signal && signal.aborted) throw abortErr();
    }
    this.active++;
    const wait = this.lastStart + this.gapMs - Date.now();
    this.lastStart = Math.max(Date.now(), this.lastStart + this.gapMs);
    if (wait > 0) await sleep(wait);
  }
  _release() { this.active--; const w = this.waiters.shift(); if (w) w(); }

  // cacheMs: 0 = always fetch (still stores), Infinity = never refetch once stored
  async request(path, { method = "GET", form = null, cacheMs = 0, signal } = {}) {
    const url = this.url(path);
    const body = form ? new URLSearchParams(form).toString() : null;
    const cacheKey = method === "GET" ? url : `${method} ${url} ${body}`;
    if (cacheMs > 0) {
      const hit = this.getCache.get(cacheKey);
      if (hit && Date.now() - hit.fetched_at < cacheMs) return hit.body;
    }
    if (signal && signal.aborted) throw abortErr();
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this._slot(signal);
      try {
        const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
        const res = await fetch(url, {
          method,
          body,
          signal: sig,
          redirect: "follow",
          headers: { "User-Agent": this.userAgent, Accept: "text/html", ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        });
        const text = await res.text();
        if (res.status >= 500 || res.status === 429) throw Object.assign(new Error(`TennisRecord answered ${res.status}`), { retry: true });
        if (res.status >= 400) throw new Error(`TennisRecord answered ${res.status} for ${path}`);
        this.putCache.run(cacheKey, text, Date.now());
        return text;
      } catch (e) {
        if (signal && signal.aborted) throw abortErr();
        lastErr = e.name === "TimeoutError" ? new Error(`TennisRecord took longer than ${Math.round(this.timeoutMs / 1000)} s to answer`) : e;
        if (!(e.retry || e.name === "TimeoutError" || e.name === "TypeError")) throw lastErr;
      } finally {
        this._release();
      }
      await sleep(attempt === 0 ? 3000 : 8000);
    }
    throw lastErr;
  }

  get(path, opts) { return this.request(path, opts); }
  postForm(path, form, opts) { return this.request(path, { ...opts, method: "POST", form }); }
}

function abortErr() { return Object.assign(new Error("Stopped"), { code: "cancelled" }); }

module.exports = { Fetcher };
