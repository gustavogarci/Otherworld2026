(async () => {
  // iOS standalone PWAs do not always match CSS display-mode queries
  // consistently, so expose the launch mode as a root class for safe-area
  // fixes that must only apply outside regular Safari.
  (function bindStandaloneAppClass() {
    const root = document.documentElement;
    const standaloneQuery = window.matchMedia?.("(display-mode: standalone)");
    const fullscreenQuery = window.matchMedia?.("(display-mode: fullscreen)");
    const isStandalone = () =>
      window.navigator?.standalone === true ||
      standaloneQuery?.matches === true ||
      fullscreenQuery?.matches === true;
    const update = () => {
      root.classList.toggle("is-standalone-app", isStandalone());
    };
    const bind = query => {
      if (!query) return;
      if (typeof query.addEventListener === "function") query.addEventListener("change", update);
      else if (typeof query.addListener === "function") query.addListener(update);
    };
    update();
    bind(standaloneQuery);
    bind(fullscreenQuery);
  })();

  // ── Easter egg: long-press the MOIST logo → "Sandstorm" ──────────
  // Mobile-only. Press-and-hold the logo (~600ms) to play the Sandstorm
  // clip and wash a light "wet" overlay over the screen ("moist"). A
  // normal tap still navigates home instantly — long-press never fights
  // the link. Audio prefers a real MP3 (AUDIO_SRC) and falls back to a
  // synthesized riff if the file is missing. Fully self-contained: it
  // only watches the logo and manages an overlay it creates.
  (function initMoistEasterEgg() {
    // Only on touch devices. On desktop the logo link works natively.
    const isMobile = window.matchMedia?.("(pointer: coarse)")?.matches === true;
    if (!isMobile) return;

    const link = document.querySelector(".logo-h1 a");
    if (!link) return;

    // Drop a sandstorm.mp3 in the project root and it plays automatically
    // (and add it to SHELL_ASSETS in sw.js). Until then we fall back to
    // the in-browser synth. Set to null to force the synth.
    const AUDIO_SRC = "sandstorm.mp3";
    const CLIP_SECONDS = 30;    // how long the overlay runs with the MP3
    const AUDIO_VOL = 0.9;      // playback volume
    // Which "wet" visual to show: 1 = water drops, 2 = ripples. Drops is
    // the keeper; ripples stays in the code to switch back to later.
    const FX_VERSION = 1;
    const HOLD_MS = 600;        // press-and-hold duration to trigger
    const MOVE_TOL = 12;        // px of finger drift that cancels the hold
    const BPM = 136;            // Sandstorm tempo (drives the beat pulse)
    const beatSec = 60 / BPM;

    let holdTimer = null;
    let suppressClick = false;  // swallow the click that follows a hold
    let startX = 0, startY = 0;
    let active = false;         // guards against overlapping triggers

    const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };

    link.addEventListener("pointerdown", e => {
      if (e.pointerType === "mouse") return; // touch/pen only
      startX = e.clientX;
      startY = e.clientY;
      cancelHold();
      holdTimer = setTimeout(() => {
        suppressClick = true;
        fire();
      }, HOLD_MS);
    });
    link.addEventListener("pointermove", e => {
      if (Math.abs(e.clientX - startX) > MOVE_TOL ||
          Math.abs(e.clientY - startY) > MOVE_TOL) cancelHold();
    });
    link.addEventListener("pointerup", cancelHold);
    link.addEventListener("pointercancel", cancelHold);
    link.addEventListener("pointerleave", cancelHold);
    // iOS shows a save-image / link-preview callout on long-press; block
    // it (CSS also sets -webkit-touch-callout:none on the logo).
    link.addEventListener("contextmenu", e => e.preventDefault());
    link.addEventListener("click", e => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick = false;
      }
    });

    function fire() {
      if (active) return;
      active = true;
      const version = FX_VERSION; // drops by default (ripples still available)
      const { seconds, stop } = startAudio();
      const fx = showMoistOverlay(version, seconds);

      let done = false;
      let swallowClick = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(endTimer);
        document.removeEventListener("pointerdown", onTouch, true);
        stop();         // fade the audio out
        fx.dismiss();   // fade + remove the overlay
        setTimeout(() => { active = false; }, 800);
      };
      // Tapping anywhere on the screen dismisses it early. The tap must
      // ONLY dismiss — swallow it so it doesn't also open a card/button
      // underneath. We cancel the pointer event in the capture phase and
      // then eat the click it would synthesize. Deferred a beat so the
      // long-press's own gesture doesn't instantly cancel it.
      const onTouch = e => {
        e.preventDefault();
        e.stopPropagation();
        swallowClick = ev => {
          ev.preventDefault();
          ev.stopPropagation();
          document.removeEventListener("click", swallowClick, true);
          swallowClick = null;
        };
        document.addEventListener("click", swallowClick, true);
        // Safety net: stop swallowing if no click ever materializes.
        setTimeout(() => {
          if (swallowClick) {
            document.removeEventListener("click", swallowClick, true);
            swallowClick = null;
          }
        }, 800);
        finish();
      };
      setTimeout(() => {
        document.addEventListener("pointerdown", onTouch, true);
      }, 250);
      // Otherwise it ends on its own when the clip finishes.
      const endTimer = setTimeout(finish, seconds * 1000);
    }

    // ── Audio: real MP3 if present, otherwise the synth fallback ────
    // Returns { seconds, stop } — stop() halts playback so a screen tap
    // (or the natural end) can cut it short.
    function startAudio() {
      if (AUDIO_SRC) {
        try {
          const a = new Audio(AUDIO_SRC);
          a.preload = "auto";
          a.volume = AUDIO_VOL;
          const p = a.play();
          // If the file is missing or playback is blocked, fall back to
          // the synth so the egg still does *something*.
          if (p && typeof p.catch === "function") {
            p.catch(() => { try { playSandstorm(); } catch (e) {} });
          }
          return {
            seconds: CLIP_SECONDS,
            stop: () => { try { a.pause(); } catch (e) {} },
          };
        } catch (e) {
          // fall through to synth
        }
      }
      return playSandstorm();
    }

    // ── Audio: synthesize the Sandstorm lead riff (fallback) ───────
    // The signature: a fast gallop of seven staccato notes per bar,
    // changing pitch each bar to climb the B-minor melody. A sine
    // "kick" lands on every beat for the rave feel.
    function playSandstorm() {
      const noop = { seconds: CLIP_SECONDS, stop: () => {} };
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return noop;

      let ctx;
      try { ctx = new Ctx(); } catch (e) { return noop; }
      if (ctx.state === "suspended") ctx.resume?.();

      const master = ctx.createGain();
      master.gain.value = 0.18; // keep it modest
      master.connect(ctx.destination);

      // B-minor pitches (Hz, equal temperament).
      const N = {
        A4: 440.0, B4: 493.88, Cs5: 554.37, D5: 587.33,
        E5: 659.25, Fs5: 739.99,
      };
      // One entry per bar = the pitch its seven gallop notes play.
      // Builds on B, then climbs the melodic contour and resolves.
      const bars = [
        N.B4, N.B4, N.D5, N.B4,
        N.D5, N.E5, N.Fs5, N.B4,
      ];

      const sixteenth = beatSec / 2;     // two notes per beat in the gallop
      const start = ctx.currentTime + 0.05;
      let t = start;

      bars.forEach(freq => {
        // Seven quick notes then a rest — the Sandstorm gallop.
        for (let i = 0; i < 7; i++) {
          playNote(ctx, master, freq, t, sixteenth * 0.85);
          t += sixteenth;
        }
        t += sixteenth; // rest slot
      });

      // Four-on-the-floor kick under the whole thing.
      const totalBeats = Math.ceil((t - start) / beatSec);
      for (let b = 0; b < totalBeats; b++) {
        playKick(ctx, master, start + b * beatSec);
      }

      const total = t - ctx.currentTime + 0.3;
      const closeTimer = setTimeout(() => { try { ctx.close(); } catch (e) {} }, total * 1000 + 200);
      const stop = () => {
        clearTimeout(closeTimer);
        try {
          const now = ctx.currentTime;
          master.gain.cancelScheduledValues(now);
          master.gain.setValueAtTime(master.gain.value, now);
          master.gain.linearRampToValueAtTime(0, now + 1.0);
        } catch (e) {}
        setTimeout(() => { try { ctx.close(); } catch (e) {} }, 1100);
      };
      return { seconds: total, stop };
    }

    function playNote(ctx, dest, freq, at, dur) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      // Short attack/release so notes don't click.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.9, at + 0.006);
      gain.gain.linearRampToValueAtTime(0, at + dur);
      osc.connect(gain).connect(dest);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    }

    function playKick(ctx, dest, at) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, at);
      osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      gain.gain.setValueAtTime(0.9, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
      osc.connect(gain).connect(dest);
      osc.start(at);
      osc.stop(at + 0.2);
    }

    // ── Visual: two interchangeable "wet" overlays ─────────────────
    // version 1 = water droplets running down the glass (the keeper).
    // version 2 = raindrops hitting water, concentric ripple rings —
    // kept available; flip FX_VERSION to 2 to use it instead.
    function showMoistOverlay(version, seconds) {
      const fx = document.createElement("div");
      fx.id = "moist-fx";
      fx.className = version === 2 ? "moist-fx--ripples" : "moist-fx--drops";
      fx.setAttribute("aria-hidden", "true");

      const sheen = document.createElement("div");
      sheen.className = "moist-sheen";
      // Pulse the sheen in time with the beat (we own the tempo).
      sheen.style.setProperty("--beat", beatSec.toFixed(3) + "s");
      fx.appendChild(sheen);

      if (version === 2) addRipples(fx, seconds);
      else addDrops(fx, seconds);

      document.body.appendChild(fx);

      // fire() drives the lifetime so it can also be dismissed early by
      // a screen tap. dismiss() fades out then removes the element.
      let removed = false;
      const dismiss = () => {
        if (removed) return;
        removed = true;
        fx.classList.add("moist-fx-out");
        setTimeout(() => fx.remove(), 600);
      };
      return { el: fx, dismiss };
    }

    function addDrops(fx, seconds) {
      const DROPS = 14;
      for (let i = 0; i < DROPS; i++) {
        const drop = document.createElement("span");
        drop.className = "moist-drop";
        drop.style.left = Math.round(Math.random() * 100) + "%";
        drop.style.animationDelay = (Math.random() * seconds * 0.7).toFixed(2) + "s";
        drop.style.animationDuration = (1.6 + Math.random() * 1.6).toFixed(2) + "s";
        drop.style.setProperty("--scale", (0.6 + Math.random() * 0.9).toFixed(2));
        fx.appendChild(drop);
      }
    }

    function addRipples(fx, seconds) {
      const RINGS = 18;
      for (let i = 0; i < RINGS; i++) {
        const ring = document.createElement("span");
        ring.className = "moist-ripple";
        ring.style.left = Math.round(Math.random() * 100) + "%";
        ring.style.top = Math.round(Math.random() * 100) + "%";
        ring.style.animationDelay = (Math.random() * seconds * 0.85).toFixed(2) + "s";
        ring.style.animationDuration = (1.6 + Math.random() * 1.2).toFixed(2) + "s";
        ring.style.setProperty("--scale", (4 + Math.random() * 5).toFixed(1));
        fx.appendChild(ring);
      }
    }
  })();

  // Register the service worker for offline support. Deferred to
  // window.load so it never competes with the critical-path
  // events.json fetch on the first visit. Silent update model —
  // a new SW activates on the next reload, no user-facing toast.
  // See sw.js for the cache strategies.
  //
  // Skip on localhost: the cache-first shell makes saved edits show
  // up a reload late (or not at all), which is miserable in dev. We
  // also actively unregister any SW + nuke its caches so a previously
  // installed one stops shadowing the dev server.
  // Treat localhost, *.local, AND private-LAN IPs (192.168.x.x,
  // 10.x.x.x, 172.16–31.x.x) as dev. The LAN ranges matter for
  // previewing on a phone over Wi-Fi (http://192.168…:8000): without
  // them the service worker would shadow fresh edits with cached code.
  // Production only ever runs on public domains, so this never affects
  // real users.
  const isLocalDev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
    || location.hostname.endsWith(".local")
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(location.hostname)
    || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(location.hostname)
    || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(location.hostname);
  if ("serviceWorker" in navigator) {
    if (isLocalDev) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => regs.forEach(r => r.unregister()))
        .catch(() => {});
      if (window.caches && caches.keys) {
        caches.keys()
          .then(names => names
            .filter(n => n.startsWith("otherworld-"))
            .forEach(n => caches.delete(n)))
          .catch(() => {});
      }
    } else {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      });
    }
  }

  // Use the HTTP cache with default heuristic freshness. The static
  // server sends Last-Modified on these files, which is enough for
  // the browser to short-circuit re-downloads — events.json is ~800
  // KB, so re-fetching the full body on every load (the old
  // `no-store`) was a visible cold-start tax. When the cron updates
  // events.json the new Last-Modified invalidates the cached copy
  // automatically; until then the browser serves it from disk.
  let _aliasResp = null;
  try {
    let _eventsResp;
    [_eventsResp, _aliasResp] = await Promise.all([
      fetch('./events.json'),
      fetch('./camp-aliases.json').catch(() => null),
    ]);
    if (!_eventsResp.ok) throw new Error('Failed to load events.json: ' + _eventsResp.status);
    window.OTHERWORLD_DATA = await _eventsResp.json();
  } catch (err) {
    // First-load failure (offline with nothing cached yet, network
    // error, or malformed JSON). Without this the page would just sit
    // blank with no explanation. Show a friendly, on-brand empty state
    // with a retry instead. Once the schedule has been loaded once,
    // the service worker serves it from cache so this path won't fire.
    const view = document.getElementById('view');
    if (view) {
      view.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">Couldn't load the schedule</div>
          <div class="empty-sub">Check your connection and try again. Once it's loaded once, it stays available offline.</div>
        </div>`;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'empty-retry';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => location.reload());
      view.querySelector('.empty-state')?.appendChild(retry);
    }
    return;
  }
  const _aliasData = (_aliasResp && _aliasResp.ok) ? await _aliasResp.json().catch(() => null) : null;

  // Defensive dedupe: collapse entries whose names canonicalize to the
  // same key (so "Orcar" and "Orcar Camp" / "Magic Stick" and "The Magic
  // Stick" fold together) AND apply the typo-alias map from
  // camp-aliases.json so misspelled camp names ("The Saloon Saloon")
  // merge with their canonical version. Also collapses same
  // (title,day,startTime) events within each entry. The reconcile cron
  // used to leak duplicates for claimed camps; that's fixed at the
  // source, but this is the belt-and-suspenders so the page never shows
  // stale dups.
  //
  // Keep in sync with admin/reconcile-sheet.php::canonical() and
  // scripts/dedupe-events.php::canonical(), and with the alias map.
  (function dedupe(data, aliasData) {
    if (!data || !Array.isArray(data.entries)) return;
    const canonical = name => {
      if (!name) return "";
      let s = String(name).trim().toLowerCase();
      // Strip accents.
      s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      s = s.replace(/^the\s+/, "");
      s = s.replace(/,?\s*the\s*$/, "");
      s = s.replace(/\s+camp\s*$/, "");
      s = s.replace(/[^a-z0-9]+/g, "");
      return s;
    };
    // Build alias map: canonical(typo) -> canonical(target).
    const aliasMap = new Map();
    const rawAliases = (aliasData && aliasData.aliases) || {};
    for (const [from, to] of Object.entries(rawAliases)) {
      const k = canonical(from);
      if (k && typeof to === "string") aliasMap.set(k, canonical(to));
    }
    const resolveKey = name => {
      const c = canonical(name);
      return aliasMap.get(c) || c;
    };
    const evKey = e => (e.title || "").trim().toLowerCase()
                     + "|" + (e.day || "").trim()
                     + "|" + (e.startTime || "").trim();
    const groups = new Map(); // canonicalKey -> array of {entry, index}
    data.entries.forEach((entry, index) => {
      const k = resolveKey(entry.name || "");
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ entry, index });
    });
    const out = [];
    for (const list of groups.values()) {
      // Primary: claimed wins, otherwise lowest index.
      list.sort((a, b) => {
        const ac = a.entry.claimed ? 0 : 1;
        const bc = b.entry.claimed ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return a.index - b.index;
      });
      const primary = list[0].entry;
      // If the primary's name is itself an aliased (typo'd) variant,
      // rewrite to the canonical display name from the alias map.
      const primaryCanon = canonical(primary.name || "");
      for (const [from, to] of Object.entries(rawAliases)) {
        if (canonical(from) === primaryCanon) { primary.name = to; break; }
      }
      // Dedupe primary's own events (first-wins), then append any net-new
      // events from the other dupes in the group.
      const seen = new Set();
      primary.events = (primary.events || []).filter(ev => {
        const k = evKey(ev);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      for (let i = 1; i < list.length; i++) {
        for (const ev of (list[i].entry.events || [])) {
          const k = evKey(ev);
          if (seen.has(k)) continue;
          seen.add(k);
          primary.events.push(ev);
        }
      }
      out.push(primary);
    }
    data.entries = out;
  })(window.OTHERWORLD_DATA, _aliasData);

  const DATA = window.OTHERWORLD_DATA;
  const MAP = window.OTHERWORLD_MAP || { pins: [] };
  const PIN_BY_NAME = new Map(
    (MAP.pins || []).filter(p => p && p.name).map(p => [p.name, p])
  );

  // Lazy-load + localStorage cache the map image. The WebP is ~2.4 MB;
  // we only fetch it the first time something requests it (map tab open
  // or first event modal), then keep a base64 data URL in localStorage
  // keyed by the parser's `version` so re-runs of parse-map invalidate
  // the cache automatically. Falls back to a direct <img src> if fetch
  // is blocked (file://) or localStorage is full.
  const MapImage = (() => {
    const IMG_PATH = MAP.imagePath || "map.webp";
    const VERSION = MAP.version || "0";
    const KEY = "otherworld:map:" + VERSION;
    let cachedSrc = null;
    let inflight = null;
    let triedCache = false;

    function readCache() {
      try { return localStorage.getItem(KEY); } catch { return null; }
    }
    function writeCache(dataUrl) {
      try {
        // Clear stale versions before writing.
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith("otherworld:map:") && k !== KEY) localStorage.removeItem(k);
        }
        localStorage.setItem(KEY, dataUrl);
      } catch { /* quota exceeded — browser HTTP cache still helps */ }
    }
    async function fetchAsDataUrl() {
      const resp = await fetch(IMG_PATH, { cache: "force-cache" });
      if (!resp.ok) throw new Error("map fetch " + resp.status);
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    }

    // Returns a Promise<src> usable as <img src>. Always resolves —
    // falls back to the plain path if anything goes wrong.
    function get() {
      if (cachedSrc) return Promise.resolve(cachedSrc);
      if (!triedCache) {
        triedCache = true;
        const cached = readCache();
        if (cached) { cachedSrc = cached; return Promise.resolve(cached); }
      }
      if (inflight) return inflight;
      inflight = fetchAsDataUrl()
        .then(src => { cachedSrc = src; writeCache(src); inflight = null; return src; })
        .catch(() => { inflight = null; return IMG_PATH; });
      return inflight;
    }

    // Optimistic synchronous src: returns cached data URL if already
    // available, otherwise null (caller should attach .get().then()).
    function syncSrc() {
      if (cachedSrc) return cachedSrc;
      if (!triedCache) {
        triedCache = true;
        const cached = readCache();
        if (cached) { cachedSrc = cached; return cached; }
      }
      return null;
    }

    return { get, syncSrc };
  })();
  const DAY_ORDER = ["Thursday", "Friday", "Saturday", "Sunday", "Monday"];
  // Each event's `day` is the calendar day its startTime falls on (a
  // "Saturday 02:00" event is 2am Saturday morning, before Saturday noon).
  // So the By Day list runs in natural calendar order, 00:00 → 23:00 — an
  // earlier start hour would push genuine early-morning events to the
  // bottom, making them look like they happen the next day.
  const FESTIVAL_START_HOUR = 0;
  const HOURS_IN_DAY = 24;

  const ALL_EVENTS = [];
  for (const entry of DATA.entries) {
    for (const ev of entry.events) ALL_EVENTS.push({ ...ev, _entry: entry });
  }

  // ── Favorites (localStorage-backed) ───────────────────
  // Stable per-event key. Intentionally tolerant — built from the
  // canonicalised camp name + day + a normalised title (lowercase, no
  // accents/emoji/punctuation, collapsed whitespace). startTime is
  // deliberately NOT in the key so that a camp tweaking their schedule
  // ("14:00 → 14:30") doesn't silently un-favorite the event for
  // everyone who already starred it. Same for title edits like adding
  // a 🍵 emoji or fixing punctuation.
  //
  // Risk in the other direction: if a camp has two recurring events on
  // the same day with the same normalised title (rare, since the title
  // is usually descriptive enough), they collapse to one favorite.
  // We accept that tradeoff — losing favorites silently is worse than
  // collapsing a true duplicate.
  const FAV_KEY = "otherworld:favorites:v1";
  // Companion store holding original camp/title/day/starredAt metadata
  // for each favorite key. Written in parallel with FAV_KEY so older
  // app.js readers continue to see the canonical list of keys under
  // FAV_KEY while newer readers also get the rich metadata that
  // powers the fuzzy fallback when upstream renames a camp or title.
  // Shape: Array<[key, {camp, title, day, starredAt}]>
  const FAV_META_KEY = "otherworld:favorites:meta:v1";
  // Bookkeeping keys for the data-loss hardening (nags, persistence
  // requests, install hint, corrupt-blob stashes). All independent
  // so each can be cleared in isolation without affecting the
  // favorites set itself.
  const FAV_CORRUPT_PREFIX = "otherworld:favorites:corrupt:";
  const FAV_BACKED_UP_AT_KEY = "otherworld:favorites:backed-up-at";
  const FAV_FIRST_ADDED_AT_KEY = "otherworld:favorites:first-added-at";
  const FAV_NAG_DISMISSED_AT_KEY = "otherworld:favorites:nag-dismissed-at";
  const FAV_PERSIST_REQUESTED_KEY = "otherworld:favorites:persist-requested";
  const FAV_IOS_HINT_DISMISSED_KEY = "otherworld:favorites:ios-hint-dismissed";
  // Cross-call flag set by defensive load when JSON.parse fails on
  // either FAV_KEY or FAV_RED_KEY. The Settings UI surfaces a banner
  // pointing at the stashed otherworld:favorites:corrupt:* keys so a
  // user can manually recover the raw text instead of silently
  // starting from an empty set on the next toggle.
  const _favLoadIssues = [];
  function normalizeTitleForKey(s) {
    if (!s) return "";
    let t = String(s).toLowerCase();
    t = t.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); // strip accents
    t = t.replace(/[^a-z0-9]+/g, " ").trim();                // emoji/punct → space
    return t;
  }
  function normalizeCampForKey(s) {
    if (!s) return "";
    let t = String(s).toLowerCase();
    t = t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    t = t.replace(/^the\s+/, "");
    t = t.replace(/,?\s*the\s*$/, "");
    t = t.replace(/\s+camp\s*$/, "");
    t = t.replace(/[^a-z0-9]+/g, "");
    return t;
  }
  function eventFavKey(ev) {
    return [
      normalizeCampForKey((ev._entry && ev._entry.name) || ev.owner || ""),
      (ev.day || "").trim().toLowerCase(),
      normalizeTitleForKey(ev.title || ""),
    ].join("|");
  }
  // Stash a corrupt JSON blob into otherworld:favorites:corrupt:<ts>
  // so the next toggle can't silently overwrite it. Bounded to the
  // last 3 corrupt stashes per key to keep storage from filling up.
  function stashCorrupt(sourceKey, raw) {
    if (raw == null) return;
    try {
      const ts = Date.now();
      const k = FAV_CORRUPT_PREFIX + sourceKey + ":" + ts;
      localStorage.setItem(k, String(raw));
      _favLoadIssues.push({ sourceKey, storageKey: k, ts });
      // GC older stashes for this same sourceKey.
      const all = [];
      for (let i = 0; i < localStorage.length; i++) {
        const lk = localStorage.key(i);
        if (lk && lk.startsWith(FAV_CORRUPT_PREFIX + sourceKey + ":")) all.push(lk);
      }
      all.sort();
      while (all.length > 3) {
        const drop = all.shift();
        try { localStorage.removeItem(drop); } catch {}
      }
    } catch {}
  }
  // List currently stashed corrupt blobs (across both favorites keys),
  // newest first. Used by the Settings recovery banner.
  function listCorruptStashes() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(FAV_CORRUPT_PREFIX)) continue;
        const tail = k.slice(FAV_CORRUPT_PREFIX.length);
        const m = tail.match(/^(.+):(\d+)$/);
        if (!m) continue;
        out.push({ storageKey: k, sourceKey: m[1], ts: Number(m[2]) });
      }
    } catch {}
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }
  function readCorruptStash(storageKey) {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  }
  function deleteCorruptStash(storageKey) {
    try { localStorage.removeItem(storageKey); } catch {}
  }

  // Load the meta companion store. Tolerant — missing or malformed
  // returns an empty Map and never throws.
  function loadFavoritesMeta() {
    try {
      const raw = localStorage.getItem(FAV_META_KEY);
      if (!raw) return new Map();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return new Map();
      const out = new Map();
      for (const entry of arr) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const [k, meta] = entry;
        if (typeof k !== "string" || !meta || typeof meta !== "object") continue;
        out.set(k, {
          camp: typeof meta.camp === "string" ? meta.camp : null,
          title: typeof meta.title === "string" ? meta.title : null,
          day: typeof meta.day === "string" ? meta.day : null,
          startTime: typeof meta.startTime === "string" ? meta.startTime : null,
          starredAt: typeof meta.starredAt === "number" ? meta.starredAt : null,
        });
      }
      return out;
    } catch {
      try {
        const raw = localStorage.getItem(FAV_META_KEY);
        if (raw) stashCorrupt(FAV_META_KEY, raw);
      } catch {}
      return new Map();
    }
  }
  // Returns a Map<key, meta>. Defensive: a corrupt FAV_KEY blob is
  // stashed via stashCorrupt() and surfaced through the Settings
  // recovery banner — we never silently fall back to an empty set
  // because that's exactly the path that lets the next toggle wipe
  // recoverable bytes.
  function loadFavorites() {
    let raw = null;
    try { raw = localStorage.getItem(FAV_KEY); } catch { raw = null; }
    const meta = loadFavoritesMeta();
    if (!raw) return new Map();
    let arr;
    try {
      arr = JSON.parse(raw);
    } catch {
      stashCorrupt(FAV_KEY, raw);
      return new Map();
    }
    if (!Array.isArray(arr)) {
      stashCorrupt(FAV_KEY, raw);
      return new Map();
    }
    const keys = migrateLegacyFavoriteKeys(arr);
    const out = new Map();
    for (const k of keys) out.set(k, meta.get(k) || null);
    return out;
  }
  // Migrate any v1 keys saved with the old 4-part shape
  // (camp|day|startTime|title) by stripping the third segment and
  // normalising title + camp. Idempotent: keys already in the new
  // 3-part shape pass through unchanged.
  //
  // Returns a Set<string> of normalised keys. The Map<key, meta>
  // wrapper that the rest of the app uses gets built in loadFavorites.
  function migrateLegacyFavoriteKeys(arr) {
    const out = new Set();
    let migrated = false;
    for (const k of arr) {
      if (typeof k !== "string") continue;
      const parts = k.split("|");
      if (parts.length === 4) {
        // Legacy: camp|day|startTime|title → drop startTime, normalise.
        const [camp, day, , title] = parts;
        out.add([
          normalizeCampForKey(camp),
          (day || "").trim().toLowerCase(),
          normalizeTitleForKey(title),
        ].join("|"));
        migrated = true;
      } else {
        out.add(k);
      }
    }
    if (migrated) {
      try { localStorage.setItem(FAV_KEY, JSON.stringify([...out])); } catch {}
    }
    return out;
  }
  // Back-compat alias used by the Restore flow which passes arrays
  // of raw keys (from a pasted backup). Returns a Set<string>.
  function migrateLegacyFavorites(arr) { return migrateLegacyFavoriteKeys(arr); }
  // Persist both the canonical key list (FAV_KEY, what older builds
  // read) and the rich metadata (FAV_META_KEY, used by the fuzzy
  // fallback). Accepts either a Map<key, meta> (the new shape) or a
  // Set<key> (defensive — older callers).
  function saveFavorites(favs) {
    try {
      const keys = favs instanceof Map ? [...favs.keys()] : [...favs];
      localStorage.setItem(FAV_KEY, JSON.stringify(keys));
      if (favs instanceof Map) {
        const meta = [];
        for (const [k, m] of favs) {
          if (m) meta.push([k, m]);
        }
        if (meta.length) localStorage.setItem(FAV_META_KEY, JSON.stringify(meta));
        else localStorage.removeItem(FAV_META_KEY);
      }
    } catch {}
  }

  // ── Can't-miss favorites (red tier) ───────────────────────
  // Stored as a separate localStorage key so older cached app.js
  // builds keep seeing all favorites under FAV_KEY and don't lose
  // anything if a user has the old code in another tab. Invariant:
  // favoritesRed ⊆ favorites (enforced on load + every toggle).
  const FAV_RED_KEY = "otherworld:favorites:red:v1";
  function loadRedFavorites() {
    let raw = null;
    try { raw = localStorage.getItem(FAV_RED_KEY); } catch { raw = null; }
    if (!raw) return new Set();
    let arr;
    try { arr = JSON.parse(raw); }
    catch {
      stashCorrupt(FAV_RED_KEY, raw);
      return new Set();
    }
    if (!Array.isArray(arr)) {
      stashCorrupt(FAV_RED_KEY, raw);
      return new Set();
    }
    // Lift through the same normaliser so any legacy 4-part keys
    // restored from a pre-migration backup match the current shape.
    return migrateLegacyFavoriteKeys(arr);
  }
  function saveRedFavorites(set) {
    try {
      if (!set || set.size === 0) localStorage.removeItem(FAV_RED_KEY);
      else localStorage.setItem(FAV_RED_KEY, JSON.stringify([...set]));
    } catch {}
  }

  // ── Pinned camps (By-Camp view) ───────────────────────────
  // A personal "float to the top" flag for entries in the By-Camp
  // list. Keyed by type + normalised name (no stable id exists on
  // entries) so a pin survives upstream re-parses and minor name
  // tweaks the same way favorites do.
  const PINNED_KEY = "otherworld:pinned-camps:v1";
  function campPinKey(entry) {
    return (entry.type || "camp") + "|" + normalizeCampForKey(entry.name || "");
  }
  function loadPinnedCamps() {
    let raw = null;
    try { raw = localStorage.getItem(PINNED_KEY); } catch { raw = null; }
    if (!raw) return new Set();
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? new Set(arr) : new Set();
    } catch {
      stashCorrupt(PINNED_KEY, raw);
      return new Set();
    }
  }
  function savePinnedCamps(set) {
    try {
      if (!set || set.size === 0) localStorage.removeItem(PINNED_KEY);
      else localStorage.setItem(PINNED_KEY, JSON.stringify([...set]));
    } catch {}
  }

  // Encoded payload used by the Backup modal. Hoisted out of
  // bindFavoritesBackup() so it stays in module scope.
  function encodeFavoritesBlob(favMap, redSet) {
    const favs = favMap instanceof Map ? [...favMap.keys()] : [...favMap];
    const meta = [];
    if (favMap instanceof Map) {
      for (const [k, m] of favMap) if (m) meta.push([k, m]);
    }
    const red = redSet ? [...redSet] : [];
    const hasRed = red.length > 0;
    const hasMeta = meta.length > 0;
    let payload;
    if (hasMeta) {
      // v=3 carries rich per-favorite metadata so a future device
      // (or this device after a wipe) can self-heal upstream renames.
      // Legacy v=1/v=2 readers ignore unknown fields and still
      // pick up the canonical key list from `favs`.
      payload = { v: 3, t: "otherworld-favs", favs, red, meta };
    } else if (hasRed) {
      payload = { v: 2, t: "otherworld-favs", favs, red };
    } else {
      payload = { v: 1, t: "otherworld-favs", favs };
    }
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  // ── Per-event favorite metadata ───────────────────────────
  // Captures the camp + title + day a favorite was originally
  // starred with so that if upstream later rewrites the title
  // (or the user lands on a device with a corrupt favorites
  // map), the fuzzy resolver below can re-attach the favorite to
  // the new event by same-camp-same-day + title similarity.
  function buildFavoriteMeta(ev) {
    if (!ev) return null;
    return {
      camp: ((ev._entry && ev._entry.name) || ev.owner || "").trim() || null,
      title: (ev.title || "").trim() || null,
      day: (ev.day || "").trim() || null,
      startTime: (ev.startTime || "").trim() || null,
      starredAt: Date.now(),
    };
  }

  // ── Persistent storage request ────────────────────────────
  // Chrome / Firefox / Edge / Android Chrome can grant Persistent
  // Storage which exempts the origin from quota eviction. Safari iOS
  // doesn't implement the API but ignores the call silently — the
  // real ITP mitigation there is Add to Home Screen, which the
  // Settings hint nudges users toward separately.
  let _persistRequestInflight = false;
  async function maybeRequestPersistedStorage() {
    if (_persistRequestInflight) return;
    if (!navigator.storage || typeof navigator.storage.persist !== "function") return;
    let alreadyAsked = false;
    try { alreadyAsked = localStorage.getItem(FAV_PERSIST_REQUESTED_KEY) === "1"; } catch {}
    _persistRequestInflight = true;
    try {
      let persisted = false;
      try { persisted = !!(await navigator.storage.persisted?.()); } catch {}
      if (persisted) {
        try { localStorage.setItem(FAV_PERSIST_REQUESTED_KEY, "1"); } catch {}
        return;
      }
      // Don't spam the browser if we've asked before and were denied.
      if (alreadyAsked) return;
      try { await navigator.storage.persist(); } catch {}
      try { localStorage.setItem(FAV_PERSIST_REQUESTED_KEY, "1"); } catch {}
    } finally {
      _persistRequestInflight = false;
    }
  }

  const state = {
    mode: "day",
    // Placeholder — overwritten by initialDay() once devNowOverride
    // is initialized below. initialDay() depends on getNow() which
    // reads devNowOverride, so we can't call it here without a TDZ.
    day: discoverDefaultDay(),
    search: "",
    type: "all",
    tags: new Set(),
    neighbourhoods: new Set(),
    // Time-bucket quick chips: "now" | "next". OR semantics within the
    // set (Happening now ∪ Up next reads naturally as "soon"), AND-
    // combined with every other filter group.
    quick: new Set(),
    // Favorites is its own facet — a personal flag, not a time bucket —
    // so it AND-combines with everything else (including "now"/"next").
    // Lived in state.quick previously, which surprised users who
    // expected "Favorites + Happening now" to intersect, not union.
    favoritesOnly: false,
    // Second stage of the header Favorites filter, reachable only when
    // cantMissEnabled is on: off → all favorites → red ("can't miss")
    // only → off. Always a subset of favoritesOnly being true.
    favoritesRedOnly: false,
    // Time-of-day chips ("morning" | "afternoon" | "evening" | "late").
    // Multi-select, OR semantics across selected periods AND-combined
    // with other filters.
    timesOfDay: new Set(),
    // Duration buckets ("short" | "medium" | "long"). Multi-select with
    // OR semantics, AND-combined with other filters.
    durations: new Set(),
    favorites: loadFavorites(),
    // Subset of `favorites` flagged as red ("can't miss"). Only
    // reachable when the Settings toggle `cantMissEnabled` is on,
    // but the data is preserved either way so disabling/re-enabling
    // the feature doesn't lose user intent.
    favoritesRed: loadRedFavorites(),
    // Camps pinned to the top of the By-Camp list. Personal ordering
    // preference, persisted across sessions.
    pinnedCamps: loadPinnedCamps(),
  };

  // Enforce favoritesRed ⊆ favorites. Defensive: prevents a stale
  // red key (e.g. one removed from favorites by an older app.js in
  // another tab) from resurrecting a deleted favorite on render.
  for (const _k of [...state.favoritesRed]) {
    if (!state.favorites.has(_k)) state.favoritesRed.delete(_k);
  }
  saveRedFavorites(state.favoritesRed);

  // Map a time-of-day key to a predicate that takes an event's start
  // hour (0..23) and returns true if it falls in that period. Mirrors
  // hourPeriodLabel() so chips visibly map to the timeline labels.
  const TIME_OF_DAY = {
    morning:   h => h >= 6 && h < 12,
    afternoon: h => h >= 12 && h < 17,
    evening:   h => h >= 17 && h < 21,
    late:      h => h >= 21 || h < 6,
  };
  // Duration buckets split at the natural cliffs in the dataset: most
  // events end by 2h (median 1.5h); 2–6h covers parties / workshops;
  // >6h is mostly "camp is always open" ambient entries. Boundaries
  // are inclusive on the upper end so a clean "2h" event lands in
  // short and a clean "6h" event lands in medium.
  const DURATION_BUCKET = {
    short:  d => d > 0 && d <= 2,
    medium: d => d > 2 && d <= 6,
    long:   d => d > 6,
  };
  function eventStartHour(ev) {
    if (!ev.startTime) return null;
    return Number(ev.startTime.split(":")[0]);
  }

  // Discovered from the data so the filter row stays in sync with whatever
  // the spreadsheet currently uses. Ordered by frequency (most-tagged first)
  // so the common categories are easiest to spot.
  const ALL_TAGS = (() => {
    const counts = new Map();
    for (const ev of ALL_EVENTS) {
      for (const t of ev.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  })();

  // Neighbourhood lives on the entry (camp), not on events. Sort by
  // camp-count so the populated neighbourhoods float to the top.
  const ALL_NEIGHBOURHOODS = (() => {
    const counts = new Map();
    for (const entry of DATA.entries) {
      const n = entry.neighbourhood;
      if (!n) continue;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  })();

  // ── Happening Now / Up Next ────────────────────────────
  // "Today" is the festival day matching the current weekday WITHIN
  // the festival window. Outside the festival, returns null and the
  // empty-state copy kicks in.
  const UP_NEXT_WINDOW_MIN = 120; // events starting in the next 2 hours
  const FESTIVAL_START = new Date(2026, 5, 4);  // Thu Jun 4 2026
  const FESTIVAL_END_EXCLUSIVE = new Date(2026, 5, 9);  // Tue Jun 9 (Mon Jun 8 inclusive)

  // Dev override: when set, every "what time is it?" check inside the
  // schedule (Today / Happening Now / Up Next / festival window) uses
  // this value instead of the wall clock. Stored as a "YYYY-MM-DDTHH:mm"
  // string (matches <input type="datetime-local">) so reloads persist.
  // The "last updated" relative-time string deliberately keeps using
  // the real clock — that's about data freshness, not the festival.
  const DEV_NOW_KEY = "ow_dev_now";
  function loadDevNow() {
    try { return localStorage.getItem(DEV_NOW_KEY) || ""; } catch { return ""; }
  }
  function saveDevNow(v) {
    try {
      if (v) localStorage.setItem(DEV_NOW_KEY, v);
      else localStorage.removeItem(DEV_NOW_KEY);
    } catch {}
  }

  // Display-preference toggles in Settings. Stored as "1" / absent so a
  // missing localStorage value cleanly defaults to false (= show everything).
  const HIDE_DESC_KEY = "ow_hide_desc";
  const HIDE_ONGOING_KEY = "ow_hide_ongoing";
  const MAP_PINS_HIDDEN_KEY = "ow_map_pins_hidden";
  // Opt-in "can't miss" favorite tier. When off, the star is a binary
  // toggle (☆ ↔ ★) and any pre-existing red flags render as regular
  // favorites — but the data stays put in localStorage so flipping
  // this back on restores them.
  const CANT_MISS_KEY = "ow_cant_miss_enabled";

  // Theme picker. Each entry's `id` matches a CSS block in themes.css:
  // the default theme lives in :root, every other id is a
  // [data-theme="<id>"] block. To add a new theme:
  //   1. Add a [data-theme="<id>"] { … } block to themes.css.
  //   2. If it uses a new font, add the family to the Google Fonts
  //      <link> in index.html so it's available before swap.
  //   3. Push { id, label } into THEMES below.
  // The inline FOUC script in index.html reads ow_theme from
  // localStorage before stylesheets resolve, so initial paint
  // already reflects the saved choice.
  const THEME_KEY = "ow_theme";
  const DEFAULT_THEME_ID = "isaias";
  // Order in this array = order in the Settings dropdown. Roughly
  // arranged calm → intense so the picker feels like a vibe spectrum.
  const THEMES = [
    { id: "isaias",      label: "Isaiiaas" },
    { id: "mother-tree", label: "Mother Tree" },
    { id: "healing",     label: "Healing" },
    { id: "ripple",      label: "Ripple" },
    { id: "sky",         label: "Sky" },
    { id: "circus",      label: "Circus" },
    { id: "thirrrst",    label: "Thirrrst" },
    { id: "spin",        label: "Spin" },
    { id: "kink",        label: "Kink" },
    { id: "cosmic",      label: "Cosmic" },
  ];
  function loadThemePref() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v && THEMES.some(t => t.id === v)) return v;
      // Saved value is for a theme that no longer exists (e.g. an
      // older draft that was removed). Clean it up so the inline
      // FOUC script in index.html stops setting a dead attribute.
      if (v) localStorage.removeItem(THEME_KEY);
    } catch {}
    return DEFAULT_THEME_ID;
  }
  function saveThemePref(id) {
    try {
      if (id && id !== DEFAULT_THEME_ID) localStorage.setItem(THEME_KEY, id);
      else localStorage.removeItem(THEME_KEY);
    } catch {}
  }
  // Apply by toggling <html data-theme>. Default theme = no attribute,
  // so :root in themes.css wins. Any other id sets the attribute and
  // its [data-theme="<id>"] block in themes.css overrides :root.
  function applyTheme(id) {
    const root = document.documentElement;
    if (!id || id === DEFAULT_THEME_ID) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", id);
  }
  function loadBoolPref(k) {
    try { return localStorage.getItem(k) === "1"; } catch { return false; }
  }
  // Like loadBoolPref but defaults to true when the user hasn't chosen yet.
  function loadBoolPrefDefaultTrue(k) {
    try { return localStorage.getItem(k) !== "0"; } catch { return true; }
  }
  function saveBoolPref(k, v) {
    try {
      if (v) localStorage.setItem(k, "1");
      else localStorage.removeItem(k);
    } catch {}
  }
  // Persists both states explicitly so an intentional "off" survives a
  // default-true preference (where a missing key means "on").
  function saveBoolPrefExplicit(k, v) {
    try { localStorage.setItem(k, v ? "1" : "0"); } catch {}
  }
  function loadMapPinsHiddenPref() {
    try {
      const raw = localStorage.getItem(MAP_PINS_HIDDEN_KEY);
      return raw === null ? true : raw === "1";
    } catch {
      return true;
    }
  }
  function saveMapPinsHiddenPref(v) {
    try { localStorage.setItem(MAP_PINS_HIDDEN_KEY, v ? "1" : "0"); } catch {}
  }
  let hideDescriptions = loadBoolPref(HIDE_DESC_KEY);
  let hideOngoing = loadBoolPrefDefaultTrue(HIDE_ONGOING_KEY);
  let cantMissEnabled = loadBoolPref(CANT_MISS_KEY);
  let activeThemeId = loadThemePref();
  let mapPinsHidden = loadMapPinsHiddenPref();
  // Apply on boot. The inline <head> script already set the attribute
  // synchronously to avoid FOUC; this re-assertion keeps things tidy
  // if the inline script ever fails (e.g. localStorage blocked).
  applyTheme(activeThemeId);
  let devNowOverride = (() => {
    const v = loadDevNow();
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d) ? null : d;
  })();
  function getNow() {
    return devNowOverride ? new Date(devNowOverride) : new Date();
  }
  // Now that devNowOverride is settled, pick the live "today" if the
  // festival is active. See initialDay() below.
  state.day = initialDay();

  function isFestivalActive(now = getNow()) {
    return now >= FESTIVAL_START && now < FESTIVAL_END_EXCLUSIVE;
  }
  function getToday() {
    const now = getNow();
    if (!isFestivalActive(now)) return null;
    const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
    return DAY_ORDER.includes(weekday) ? weekday : null;
  }
  function daysUntilFestival(now = getNow()) {
    const ms = FESTIVAL_START - now;
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }
  function festivalEmptyMessage() {
    const now = getNow();
    if (isFestivalActive(now)) return null;
    if (now < FESTIVAL_START) {
      const days = daysUntilFestival(now);
      if (days <= 0) return "Otherworld starts today — see you there.";
      if (days === 1) return "Otherworld starts tomorrow (Thursday June 4).";
      return `Otherworld starts in ${days} days (Thursday June 4).`;
    }
    return "Otherworld has wrapped — until next year.";
  }
  function eventIsHappeningNow(ev) {
    const today = getToday();
    if (!today || ev.day !== today) return false;
    if (!ev.startTime || !ev.endTime) return false;
    const now = getNow();
    const nowFest = festivalMinutes(
      String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0")
    );
    const start = festivalMinutes(ev.startTime);
    const end = festivalMinutes(ev.endTime);
    if (end <= start) return false; // skip malformed
    return nowFest >= start && nowFest < end;
  }
  function eventIsUpNext(ev) {
    const today = getToday();
    if (!today || ev.day !== today) return false;
    if (!ev.startTime) return false;
    const now = getNow();
    const nowFest = festivalMinutes(
      String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0")
    );
    const start = festivalMinutes(ev.startTime);
    const delta = start - nowFest;
    return delta > 0 && delta <= UP_NEXT_WINDOW_MIN;
  }
  function eventIsFavorite(ev) {
    return state.favorites.has(eventFavKey(ev));
  }
  // Tier-2 ("can't miss") membership. Only meaningful when
  // cantMissEnabled is true — callers should still gate visual
  // treatment on the flag so disabled-but-data-present users see
  // their reds render as regular favorites.
  function eventIsRedFav(ev) {
    return state.favoritesRed.has(eventFavKey(ev));
  }

  function discoverDefaultDay() {
    const counts = Object.fromEntries(DAY_ORDER.map(d => [d, 0]));
    for (const e of ALL_EVENTS) if (counts[e.day] !== undefined) counts[e.day]++;
    const present = DAY_ORDER.filter(d => counts[d] > 0);
    return present[0] || DAY_ORDER[0];
  }

  // Prefer today during the festival window so a refresh lands on the
  // live day instead of always the first festival day. Falls back to
  // discoverDefaultDay() outside the window. getToday() reads getNow()
  // so dev-now simulation flows through naturally.
  function initialDay() {
    const today = getToday();
    if (today && ALL_EVENTS.some(e => e.day === today)) return today;
    return discoverDefaultDay();
  }

  // Scroll the page so .now-line sits just below the header. Smooth
  // for explicit user gestures (re-click By Day); instant on first
  // load to avoid a 1–2s pan fighting the scroll-hide header on iOS.
  function scrollToNowLine({ smooth = true } = {}) {
    const el = document.querySelector(".now-line");
    if (!el) return false;
    const header = document.querySelector("header");
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const y = el.getBoundingClientRect().top + window.scrollY - headerH - 16;
    window.scrollTo({ top: Math.max(0, y), behavior: smooth ? "smooth" : "auto" });
    return true;
  }

  // Snap to today + scroll to the now-line. Re-collapses the Earlier
  // Today section so the user lands on a clean, focused view of right
  // now. No-op outside the festival window.
  function jumpToNow({ smooth = true } = {}) {
    if (!isFestivalActive()) return;
    const today = getToday();
    if (!today) return;
    state.mode = "day";
    state.day = today;
    state._expandPast = false;
    renderAll();
    requestAnimationFrame(() => scrollToNowLine({ smooth }));
  }

  // Subtle lime dot on the active By Day tab, shown only when
  // re-clicking would actually do something visible — i.e. the
  // now-line exists on the page but is off-screen. Self-teaching
  // affordance for the otherwise hidden re-click gesture. Cheap:
  // one getBoundingClientRect; safe to call from scroll handlers.
  function updateNowCue() {
    const btn = document.querySelector('#mode-tabs .tab[data-mode="day"]');
    if (!btn) return;
    let on = false;
    if (isFestivalActive() && state.mode === "day") {
      const line = document.querySelector(".now-line");
      if (line) {
        const r = line.getBoundingClientRect();
        const inView = r.top < window.innerHeight - 80 && r.bottom > 80;
        on = !inView;
      }
    }
    btn.classList.toggle("has-now-cue", on);
  }

  // Keep the schedule honest as the clock advances: re-render the
  // day view every minute so the now-line, current-hour highlight,
  // and "Earlier today" boundary track real time without a manual
  // refresh. Only fires when relevant (visible tab, day mode, today),
  // so other views (Camp / Map) don't pay for the tick. Also catches
  // up immediately on visibilitychange in case the tab was hidden
  // across an hour boundary.
  let _liveTickHandle = null;
  function startLiveTick() {
    function tick() {
      if (document.visibilityState !== "visible") return;
      if (state.mode !== "day") return;
      if (state.day !== getToday()) return;
      renderDayView();
      renderDayTabs();
      updateNowCue();
    }
    if (!_liveTickHandle) {
      _liveTickHandle = setInterval(tick, 60_000);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") tick();
    });
  }

  function toMinutes(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
  function festivalMinutes(t) {
    const min = toMinutes(t);
    const start = FESTIVAL_START_HOUR * 60;
    return min >= start ? min - start : (HOURS_IN_DAY * 60 - start) + min;
  }
  const HOUR_ORDER = (() => {
    const out = [];
    for (let i = 0; i < HOURS_IN_DAY; i++) out.push((FESTIVAL_START_HOUR + i) % HOURS_IN_DAY);
    return out;
  })();
  function fmtHour(h) { return String(h).padStart(2, "0") + ":00"; }
  function hourPeriodLabel(h) {
    if (h >= 6 && h < 12) return "Morning";
    if (h >= 12 && h < 17) return "Afternoon";
    if (h >= 17 && h < 21) return "Evening";
    if (h >= 21 || h < 2) return "Night";
    return "Late night";
  }
  function fmtDuration(hours) {
    if (hours == null) return "";
    const totalMins = Math.round(hours * 60);
    if (totalMins < 60) return totalMins + "m";
    const h = Math.floor(totalMins / 60), m = totalMins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  function typeLabel(t) {
    return ({ camp: "Camp", art_installation: "Art", sound_stage: "Stage", mutant_vehicle: "Vehicle" })[t] || t;
  }

  function eventMatchesTags(ev) {
    if (state.tags.size === 0) return true;
    const evTags = ev.tags || [];
    // OR semantics: an event matches if it carries any of the selected tags.
    // Most natural for browsing by interest ("show me music OR food").
    for (const t of evTags) if (state.tags.has(t)) return true;
    return false;
  }
  function eventMatchesNeighbourhood(ev) {
    if (state.neighbourhoods.size === 0) return true;
    const n = ev._entry && ev._entry.neighbourhood;
    return n ? state.neighbourhoods.has(n) : false;
  }
  function eventMatchesQuick(ev) {
    if (state.quick.size === 0) return true;
    // OR semantics across the time-bucket chips ("now" / "next") only.
    // Favorites used to live here too, but that turned the whole group
    // into a union ("Favorites OR Happening now") which felt broken.
    // See state.favoritesOnly + eventMatchesEventLevelFilters().
    if (state.quick.has("now") && eventIsHappeningNow(ev)) return true;
    if (state.quick.has("next") && eventIsUpNext(ev)) return true;
    return false;
  }
  function eventMatchesTimeOfDay(ev) {
    if (state.timesOfDay.size === 0) return true;
    const h = eventStartHour(ev);
    if (h == null) return false;
    for (const k of state.timesOfDay) {
      const pred = TIME_OF_DAY[k];
      if (pred && pred(h)) return true;
    }
    return false;
  }
  function eventMatchesDuration(ev) {
    if (state.durations.size === 0) return true;
    const d = ev.durationHours;
    if (typeof d !== "number") return false;
    for (const k of state.durations) {
      const pred = DURATION_BUCKET[k];
      if (pred && pred(d)) return true;
    }
    return false;
  }
  // All filters that operate on a single event (as opposed to
  // entry/camp-level facets like neighbourhood or owner type).
  // Centralising this lets entryMatchesFilters require ONE event to
  // satisfy every event-level facet at once — instead of each facet
  // being satisfied by a different event in the camp, which was the
  // old bug. renderCampView uses the same predicate to trim the
  // events shown inside each expanded camp.
  function eventMatchesEventLevelFilters(ev) {
    if (state.favoritesOnly) {
      if (!eventIsFavorite(ev)) return false;
      // Second stage: red-only. Gated on cantMissEnabled so a stale
      // flag can't silently hide everything if the feature is off.
      if (state.favoritesRedOnly && cantMissEnabled && !eventIsRedFav(ev)) return false;
    }
    if (!eventMatchesTags(ev)) return false;
    if (!eventMatchesQuick(ev)) return false;
    if (!eventMatchesTimeOfDay(ev)) return false;
    if (!eventMatchesDuration(ev)) return false;
    return true;
  }
  function hasAnyEventLevelFilter() {
    return state.favoritesOnly
      || state.tags.size > 0
      || state.quick.size > 0
      || state.timesOfDay.size > 0
      || state.durations.size > 0;
  }
  function eventMatchesFilters(ev) {
    if (state.type !== "all" && ev.ownerType !== state.type) return false;
    if (!eventMatchesNeighbourhood(ev)) return false;
    if (!eventMatchesEventLevelFilters(ev)) return false;
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return (
      (ev.title || "").toLowerCase().includes(q) ||
      (ev._entry.name || "").toLowerCase().includes(q) ||
      (ev.description || "").toLowerCase().includes(q)
    );
  }
  function entryMatchesFilters(entry) {
    if (state.type !== "all" && entry.type !== state.type) return false;
    if (state.neighbourhoods.size > 0
        && (!entry.neighbourhood || !state.neighbourhoods.has(entry.neighbourhood))) {
      return false;
    }
    // Require a SINGLE event in this camp to satisfy every event-level
    // facet simultaneously (favorites + tag + quick + time-of-day +
    // duration). Previously each facet was checked independently via
    // entry.events.some(...), so a camp with one workshop event and
    // one unrelated event happening now would pass "workshops + now"
    // even though no single event was both.
    if (hasAnyEventLevelFilter() && !entry.events.some(eventMatchesEventLevelFilters)) {
      return false;
    }
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    if ((entry.name || "").toLowerCase().includes(q)) return true;
    return entry.events.some(ev =>
      (ev.title || "").toLowerCase().includes(q) ||
      (ev.description || "").toLowerCase().includes(q)
    );
  }

  function activeFilterCount() {
    // Favorites is intentionally excluded — it's its own boolean
    // surfaced by the header star, not a chip-style filter facet.
    return (state.type !== "all" ? 1 : 0)
      + state.tags.size
      + state.neighbourhoods.size
      + state.quick.size
      + state.timesOfDay.size
      + state.durations.size;
  }
  function totalVisibleEventCount() {
    return ALL_EVENTS.filter(eventMatchesFilters).length;
  }

  // ── By Day view ─────────────────────────────────────────
  function renderDayView() {
    const view = document.getElementById("view");
    view.innerHTML = "";

    const dayEvents = ALL_EVENTS.filter(e => e.day === state.day && eventMatchesFilters(e));
    if (dayEvents.length === 0) {
      // Friendlier empty state when the user has Now or Up next on
      // but the festival hasn't started — otherwise the "no matches"
      // text feels broken.
      const wantsTimeNow = state.quick.has("now") || state.quick.has("next");
      const offSeasonMsg = wantsTimeNow ? festivalEmptyMessage() : null;
      if (offSeasonMsg) {
        view.innerHTML = `
          <div class="empty-state">
            <div class="empty-title">${offSeasonMsg}</div>
            <div class="empty-sub">“Happening now” &amp; “Up next” light up during the festival.</div>
          </div>`;
      } else {
        view.innerHTML = `<div class="empty-state">No events match your filters on ${state.day}.</div>`;
      }
      return;
    }

    const byHour = new Map();
    for (const h of HOUR_ORDER) byHour.set(h, { starting: [], ongoing: [] });

    for (const ev of dayEvents) {
      if (!ev.startTime) continue;
      const startBucket = Math.floor(toMinutes(ev.startTime) / 60);
      if (byHour.has(startBucket)) byHour.get(startBucket).starting.push(ev);
      if (!ev.endTime) continue;
      // Settings toggle: skip spreading long events into every hour they
      // overlap. They still show up in their starting hour above.
      if (hideOngoing) continue;
      const startFest = festivalMinutes(ev.startTime);
      const endFest = festivalMinutes(ev.endTime);
      if (endFest <= startFest) continue;
      for (let i = 0; i < HOUR_ORDER.length; i++) {
        const h = HOUR_ORDER[i];
        if (h === startBucket) continue;
        const hourFestStart = i * 60;
        const hourFestEnd = hourFestStart + 60;
        if (startFest < hourFestEnd && endFest > hourFestStart) {
          byHour.get(h).ongoing.push(ev);
        }
      }
    }

    for (const bucket of byHour.values()) {
      bucket.starting.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
      bucket.ongoing.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    }

    // If we're rendering today's day in the festival window, find the
    // current wall-clock hour bucket so we can drop a "now" line just
    // before that row in the DOM.
    const today = getToday();
    const showNow = today && today === state.day;
    let nowHour = null, nowMinuteFraction = 0, nowPos = -1;
    if (showNow) {
      const now = getNow();
      nowHour = now.getHours();
      nowMinuteFraction = now.getMinutes() / 60;
      nowPos = HOUR_ORDER.indexOf(nowHour);
    }
    let nowLinePlaced = false;

    // Skip empty hours entirely AND collapse consecutive runs into a
    // single "Quiet HH:00 → HH:00" row so the timeline doesn't waste
    // a screen of dashes between events on slow days.
    let quietRun = null;
    function flushQuietRun() {
      if (!quietRun) return;
      const row = document.createElement("div");
      row.className = "hour-row quiet-run";
      row.innerHTML = `
        <div class="hour-label">
          <div class="time"></div>
        </div>
        <div class="hour-events">
          <div class="quiet-pill"></div>
        </div>
      `;
      const fromLabel = fmtHour(quietRun.from);
      const toLabel = fmtHour((quietRun.to + 1) % HOURS_IN_DAY);
      row.querySelector(".hour-label .time").textContent = fromLabel;
      row.querySelector(".quiet-pill").textContent =
        quietRun.from === quietRun.to
          ? `Quiet · ${fromLabel}`
          : `Quiet · ${fromLabel} → ${toLabel}`;
      view.appendChild(row);
      quietRun = null;
    }

    function maybeAppendNowLine(h) {
      if (!showNow || nowHour !== h || nowLinePlaced) return;
      const line = document.createElement("div");
      line.className = "now-line";
      view.appendChild(line);
      nowLinePlaced = true;
    }

    // Render a single hour row (or extend the quietRun if empty).
    // Extracted so the past-collapse fallback can replay hours
    // through the same rendering path as the main loop.
    function renderHourRow(h) {
      const bucket = byHour.get(h);
      const isEmpty = bucket.starting.length === 0 && bucket.ongoing.length === 0;
      if (isEmpty) {
        if (!quietRun) quietRun = { from: h, to: h };
        else quietRun.to = h;
        return;
      }
      flushQuietRun();
      maybeAppendNowLine(h);
      const row = document.createElement("div");
      row.className = "hour-row";
      // Lit-up time label for the current hour — calmer than a pulse,
      // pairs with the .now-line bar a few rows above. No animation.
      if (showNow && h === nowHour) row.classList.add("is-now-hour");
      row.innerHTML = `
      <div class="hour-label">
        <div class="time">${fmtHour(h)}</div>
        <span class="period">${hourPeriodLabel(h)}</span>
      </div>
      <div class="hour-events">
        <div class="event-grid"></div>
      </div>
    `;
      const grid = row.querySelector(".event-grid");
      for (const ev of bucket.starting) grid.appendChild(eventCard(ev, false));
      for (const ev of bucket.ongoing) grid.appendChild(eventCard(ev, true));

      view.appendChild(row);
    }

    // "Earlier today" collapse — on today's day, hours before the
    // current hour fold into a single expandable pill so finished
    // events don't visually compete with what's happening now. Only
    // collapses when ≥2 past hours have events; below that, replay
    // through the normal row renderer.
    const collapsePast = showNow && !state._expandPast;
    let pastHours = collapsePast ? [] : null;
    let pastEventCount = 0;
    let pastEventfulCount = 0;

    function flushPastRun() {
      if (!pastHours) return;
      const hours = pastHours;
      pastHours = null;
      if (pastEventfulCount >= 2 && pastEventCount >= 1) {
        const fromH = hours[0];
        const label = `Show ${pastEventCount} earlier event${pastEventCount === 1 ? "" : "s"} from today`;
        const row = document.createElement("div");
        row.className = "hour-row past-run";
        row.innerHTML = `
          <div class="hour-label">
            <div class="time">${fmtHour(fromH)}</div>
          </div>
          <div class="hour-events">
            <button type="button" class="past-pill" aria-expanded="false">
              <span class="past-pill-caret">▸</span>
              Earlier today — ${pastEventCount} event${pastEventCount === 1 ? "" : "s"} hidden
            </button>
          </div>
        `;
        const pill = row.querySelector(".past-pill");
        pill.setAttribute("aria-label", label);
        pill.addEventListener("click", () => {
          state._expandPast = true;
          renderAll();
        });
        view.appendChild(row);
      } else {
        for (const h of hours) renderHourRow(h);
      }
    }

    // When the past section is explicitly expanded, drop a small
    // "Hide earlier" affordance above the schedule so the user can
    // collapse it back without scrolling.
    if (showNow && state._expandPast) {
      const anyPastEvents = HOUR_ORDER
        .slice(0, Math.max(0, nowPos))
        .some(h => byHour.get(h).starting.length > 0);
      if (anyPastEvents) {
        const row = document.createElement("div");
        row.className = "hour-row past-run is-expanded";
        row.innerHTML = `
          <div class="hour-label"><div class="time"></div></div>
          <div class="hour-events">
            <button type="button" class="past-pill" aria-expanded="true" aria-label="Hide earlier events from today">
              <span class="past-pill-caret">▾</span>
              Hide earlier today
            </button>
          </div>
        `;
        row.querySelector(".past-pill").addEventListener("click", () => {
          state._expandPast = false;
          renderAll();
        });
        view.appendChild(row);
      }
    }

    for (let i = 0; i < HOUR_ORDER.length; i++) {
      const h = HOUR_ORDER[i];
      if (collapsePast && i < nowPos) {
        pastHours.push(h);
        const startingN = byHour.get(h).starting.length;
        pastEventCount += startingN;
        if (startingN > 0) pastEventfulCount += 1;
        continue;
      }
      if (pastHours) flushPastRun();
      renderHourRow(h);
    }
    if (pastHours) flushPastRun();
    // Edge case: current hour (and possibly the rest of the day)
    // has no events. The main loop's maybeAppendNowLine never fires
    // in that case, so drop a now-line marker here BEFORE flushing
    // any trailing quiet run — that way the "you are here" signal
    // appears above the "Quiet …" pill rather than below it.
    if (showNow && !nowLinePlaced) {
      const line = document.createElement("div");
      line.className = "now-line";
      view.appendChild(line);
      nowLinePlaced = true;
    }
    flushQuietRun();
  }

  function eventCard(ev, ongoing) {
    const card = document.createElement("article");
    card.className = "event-card" + (ongoing ? " is-ongoing" : "");
    card.dataset.type = ev.ownerType || "camp";
    card.dataset.favKey = eventFavKey(ev);

    const flags = (ev.normalizationFlags || []).length
      ? `<div class="flags">⚠ ${ev.normalizationFlags.join(", ")}</div>`
      : "";
    const cross = ev.crossesMidnight
      ? `<span class="cross-midnight" title="Ends the next day">⁺¹</span>`
      : "";
    const dur = ev.durationHours != null ? `<span class="duration">${fmtDuration(ev.durationHours)}</span>` : "";
    const tag = ongoing ? `<span class="ongoing-tag">ongoing</span>` : "";
    // ⁺¹ superscript sits inline next to the end time, no extra row.

    const desc = (ev.description || "").trim();
    // Only show the full description on starting events — ongoing cards stay
    // compact so the eye is drawn to what's beginning at this hour. The
    // hideDescriptions Settings toggle suppresses it everywhere when on.
    const showDesc = !ongoing && desc && !hideDescriptions;
    const descNeedsClamp = desc.length > 320;

    // Tags are constrained to a small set of known labels from the
    // spreadsheet ("19+", "Workshop / Class", etc.) — none contain HTML, so
    // direct interpolation is safe and stays consistent with the rest of
    // this template.
    const tags = (ev.tags || []);
    const tagsHtml = tags.length
      ? `<div class="tags">${tags.map(t => `<span class="tag-chip" data-tag="${t}">${t}</span>`).join("")}</div>`
      : "";

    const isFav = eventIsFavorite(ev);
    // Red tier is purely visual — gated on the Settings flag, never
    // changes the favorites filter behaviour upstream.
    const isRed = isFav && cantMissEnabled && eventIsRedFav(ev);
    card.innerHTML = `
    <button class="fav-btn${isFav ? " is-fav" : ""}${isRed ? " is-red" : ""}" aria-label="${isFav ? "Unfavorite" : "Favorite"}" aria-pressed="${isFav ? "true" : "false"}">${isFav ? "★" : "☆"}</button>
    <div class="meta-row">
      <span class="time">${ev.startTime}–${ev.endTime}${cross}</span>
      <span class="meta-right">${tag}${tag ? " · " : ""}${typeLabel(ev.ownerType)}${dur ? " · " : ""}${dur}</span>
    </div>
    <h3 class="title"></h3>
    <div class="owner"><span class="dot"></span><span class="n"></span></div>
    ${showDesc ? `<p class="description${descNeedsClamp ? " is-clamped" : ""}"></p>` : ""}
    ${tagsHtml}
    ${flags}
  `;
    const favBtn = card.querySelector(".fav-btn");
    favBtn.addEventListener("click", e => {
      e.stopPropagation();
      toggleFavorite(ev, favBtn);
    });
    card.querySelector(".title").textContent = ev.title || "(untitled)";
    card.querySelector(".owner .n").textContent = ev._entry.name;
    if (ev._entry.neighbourhood) {
      const nb = document.createElement("span");
      nb.className = "neighbourhood-chip";
      nb.title = "Neighbourhood";
      nb.textContent = ev._entry.neighbourhood;
      card.querySelector(".owner").appendChild(nb);
    }
    if (ev._entry.claimed) {
      const pill = document.createElement("span");
      pill.className = "verified-pill";
      pill.title = "Verified — managed by the camp owner";
      pill.setAttribute("aria-label", "Verified — managed by the camp owner");
      // Just the checkmark on cards — full label lives in By-Camp + modal.
      pill.textContent = "✓";
      card.querySelector(".owner").appendChild(pill);
    }
    if (showDesc) card.querySelector(".description").textContent = desc;
    card.addEventListener("click", () => showModal(ev));
    return card;
  }

  // ── By Camp view ────────────────────────────────────────
  function renderCampView() {
    const view = document.getElementById("view");
    // Capture which camps are expanded BEFORE clearing, so a pin
    // toggle (which re-renders) doesn't collapse an open camp.
    const openPinKeys = new Set(
      Array.from(view.querySelectorAll(".camp-block[open]"))
        .map(el => el.dataset.pinKey)
        .filter(Boolean)
    );
    view.innerHTML = "";

    const entries = DATA.entries.filter(entryMatchesFilters);
    if (entries.length === 0) {
      view.innerHTML = `<div class="empty-state">No entries match your filters.</div>`;
      return;
    }

    // Sort by type-group (camps → sound stages → art → mutant vehicles),
    // then alphabetically by name. The raw `DATA.entries` order is parse
    // order: PDF-parsed camps first, then stages, MVs, art, with any
    // sheet-reconciled camps appended at the end — which surfaces as a
    // second "camps" block after art in the UI.
    const TYPE_ORDER = { camp: 0, sound_stage: 1, art_installation: 2, mutant_vehicle: 3 };
    entries.sort((a, b) => {
      // Pinned camps float above everything else, keeping their own
      // type → name order within the pinned group.
      const pa = state.pinnedCamps.has(campPinKey(a)) ? 0 : 1;
      const pb = state.pinnedCamps.has(campPinKey(b)) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const ta = TYPE_ORDER[a.type] ?? 99;
      const tb = TYPE_ORDER[b.type] ?? 99;
      if (ta !== tb) return ta - tb;
      return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
    });

    const filterEvents = hasAnyEventLevelFilter();
    // Tracks the pinned→unpinned boundary so we can drop a thin divider
    // between the pinned group and the rest exactly once.
    let dividerDone = false;
    for (const entry of entries) {
      const events = entry.events.filter(ev => {
        // Hide events that don't match the current event-level filters
        // so the camp shows only what the user actually asked for
        // (e.g. just the workshops happening now, not the whole
        // schedule). The entry-level filter already guaranteed at
        // least one event passes.
        if (filterEvents && !eventMatchesEventLevelFilters(ev)) return false;
        if (!state.search) return true;
        const q = state.search.toLowerCase();
        if ((entry.name || "").toLowerCase().includes(q)) return true;
        return (
          (ev.title || "").toLowerCase().includes(q) ||
          (ev.description || "").toLowerCase().includes(q)
        );
      });

      const byDay = new Map();
      for (const ev of events) {
        const k = ev.day || "Unknown";
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(ev);
      }
      const dayKeys = Array.from(byDay.keys()).sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));

      const pinKey = campPinKey(entry);
      const isPinned = state.pinnedCamps.has(pinKey);

      // First unpinned entry after one or more pinned ones → divider.
      if (!isPinned && !dividerDone && view.querySelector(".camp-block")) {
        const div = document.createElement("div");
        div.className = "camp-divider";
        view.appendChild(div);
        dividerDone = true;
      }
      if (!isPinned) dividerDone = true;

      const block = document.createElement("details");
      block.className = "camp-block";
      block.dataset.pinKey = pinKey;
      if (state.search && events.length > 0) block.open = true;
      else if (openPinKeys.has(pinKey)) block.open = true;
      block.innerHTML = `
      <summary>
        <span class="name" title=""></span>
        ${entry.neighbourhood ? `<span class="neighbourhood-chip"></span>` : ""}
        ${entry.claimed ? `<span class="verified-pill" title="Verified — managed by the camp owner" aria-label="Verified — managed by the camp owner">✓</span>` : ""}
        <span class="type-pill" data-type="${entry.type}">${typeLabel(entry.type)}</span>
        <span class="count">${events.length}</span>
        <button class="pin-btn${isPinned ? " is-pinned" : ""}" type="button" aria-pressed="${isPinned ? "true" : "false"}" aria-label="${isPinned ? "Unpin camp" : "Pin camp to top"}" title="${isPinned ? "Unpin" : "Pin to top"}">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3Z"/></svg>
        </button>
      </summary>
      <div class="body"></div>
    `;
      const nameEl = block.querySelector(".name");
      nameEl.textContent = entry.name;
      nameEl.title = entry.name;
      if (entry.neighbourhood) {
        block.querySelector(".neighbourhood-chip").textContent = entry.neighbourhood;
      }

      const pinBtn = block.querySelector(".pin-btn");
      pinBtn.addEventListener("click", e => {
        // Stop the click from toggling the <details> open/closed.
        e.preventDefault();
        e.stopPropagation();
        if (state.pinnedCamps.has(pinKey)) state.pinnedCamps.delete(pinKey);
        else state.pinnedCamps.add(pinKey);
        savePinnedCamps(state.pinnedCamps);
        renderCampView();
      });

      const body = block.querySelector(".body");
      if (events.length === 0) {
        const note = document.createElement("div");
        note.className = "camp-empty";
        note.textContent = "No scheduled events listed in the PDF.";
        body.appendChild(note);
      } else {
        for (const day of dayKeys) {
          const sec = document.createElement("div");
          sec.className = "camp-day";
          const h3 = document.createElement("h3");
          h3.textContent = day;
          sec.appendChild(h3);
          const dayEvs = byDay.get(day).slice().sort(
            (a, b) => toMinutes(a.startTime || "00:00") - toMinutes(b.startTime || "00:00")
          );
          for (const ev of dayEvs) {
            const row = document.createElement("div");
            row.className = "camp-day-event";
            const cross = ev.crossesMidnight
              ? `<span class="cross-midnight" title="Ends the next day">⁺¹</span>`
              : "";
            row.innerHTML = `<span class="time">${ev.startTime}–${ev.endTime}${cross}</span><span class="title"></span>`;
            row.querySelector(".title").textContent = ev.title || "(untitled)";
            row.addEventListener("click", () => showModal({ ...ev, _entry: entry }));
            sec.appendChild(row);
          }
          body.appendChild(sec);
        }
      }
      view.appendChild(block);
    }
  }

  function renderDayTabs() {
    const wrap = document.getElementById("day-tabs");
    wrap.style.display = state.mode === "day" ? "" : "none";
    wrap.innerHTML = "";
    const counts = Object.fromEntries(DAY_ORDER.map(d => [d, 0]));
    for (const e of ALL_EVENTS) if (eventMatchesFilters(e) && counts[e.day] !== undefined) counts[e.day]++;
    const present = DAY_ORDER.filter(d => counts[d] > 0);
    if (!present.length) {
      wrap.innerHTML = `<div style="color:var(--moss-3);padding:12px 0;font-size:13px;">No days match filters.</div>`;
      return;
    }
    if (!present.includes(state.day)) state.day = present[0];
    for (const d of present) {
      const btn = document.createElement("button");
      btn.className = "tab" + (d === state.day ? " active" : "");
      btn.innerHTML = `${d}<span class="count">${counts[d]}</span>`;
      btn.addEventListener("click", () => {
        state.day = d;
        state._expandPast = false;
        renderAll();
      });
      wrap.appendChild(btn);
    }
  }

  // ── Native <dialog> helpers ───────────────────────────────
  // All six modals are top-layer <dialog> elements opened via
  // showModal(). The browser handles ESC, focus trap, ::backdrop
  // paint, and (modern Safari) lets two dialogs stack — the Settings
  // → Backup nested flow relies on that.
  //
  // We toggle html.modal-open from these helpers so a tiny CSS rule
  // (overflow:hidden + overscroll-behavior:none on <html>) can lock
  // the page scroll on iOS Safari, which does NOT auto-lock body
  // scroll for top-layer dialogs. The class clears only after the
  // LAST open dialog closes — important for Settings → Backup.
  //
  // _closingDialog: Safari/WebKit fires a cancelable `cancel` event on
  // dialog.close(). Our cancel handlers call preventDefault() to run
  // revert logic for Esc/backdrop; without this flag that also blocks
  // programmatic closes (Done / X), leaving dialog.open stuck true so
  // the next header tap is a no-op in openDialog().
  let _closingDialog = false;
  function openDialog(dialog) {
    if (!dialog) return;
    if (dialog.open) return;
    document.documentElement.classList.add("modal-open");
    dialog.showModal();
    // showModal() focuses the first focusable child; blur so iOS
    // Safari doesn't flash a blue pre-selection ring on ★ / ✕ / Copy.
    const focused = document.activeElement;
    if (focused && focused !== dialog && dialog.contains(focused)) {
      focused.blur();
    }
  }
  function closeDialog(dialog) {
    if (!dialog || !dialog.open) return;
    _closingDialog = true;
    dialog.close();
    _closingDialog = false;
    // Closing a stacked dialog (Backup over Settings) restores focus
    // to the dialog underneath — often the whole <dialog> or the
    // control that opened it. Blur so iOS doesn't ring the sheet.
    const clearFocusUnderOpenDialog = () => {
      const stillOpen = document.querySelector("dialog[open]");
      if (!stillOpen) return;
      const el = document.activeElement;
      if (el && (el === stillOpen || stillOpen.contains(el))) {
        el.blur();
      }
    };
    clearFocusUnderOpenDialog();
    requestAnimationFrame(clearFocusUnderOpenDialog);
  }
  // One delegated listener per dialog. A click whose target is the
  // dialog itself originated either from the ::backdrop pseudo or
  // from the dialog's own padding area — both count as outside the
  // visible card, so we close. onClose is optional (used by the
  // search / filters modals to route through cancel-revert paths).
  function bindDialogBackdropClose(dialog, onClose) {
    if (!dialog) return;
    dialog.addEventListener("click", e => {
      if (e.target === dialog) (onClose || (() => closeDialog(dialog)))();
    });
    dialog.addEventListener("close", () => {
      if (!document.querySelector("dialog[open]")) {
        document.documentElement.classList.remove("modal-open");
      }
    });
  }

  // Copy helpers — sync paths run inside the click handler so iOS keeps
  // the user-gesture. navigator.clipboard.writeText often *resolves* but
  // leaves the pasteboard empty inside stacked <dialog>s, so it is last.
  function copyFromElement(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") {
      const text = el.value;
      if (!text) return false;
      el.focus({ preventScroll: true });
      el.select();
      el.setSelectionRange(0, text.length);
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { /* ignore */ }
      return ok;
    }
    const prevEditable = el.getAttribute("contenteditable");
    el.setAttribute("contenteditable", "true");
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    if (!sel) {
      if (prevEditable == null) el.removeAttribute("contenteditable");
      else el.setAttribute("contenteditable", prevEditable);
      return false;
    }
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    sel.removeAllRanges();
    if (prevEditable == null) el.removeAttribute("contenteditable");
    else el.setAttribute("contenteditable", prevEditable);
    return ok;
  }
  function copyTextFallback(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "width:2em",
      "height:2em",
      "padding:0",
      "border:0",
      "outline:none",
      "box-shadow:none",
      "background:transparent",
    ].join(";");
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    document.body.removeChild(ta);
    return ok;
  }
  function copyText(text, sourceEl) {
    const str = String(text || "");
    if (!str) return Promise.resolve(false);
    if (sourceEl && copyFromElement(sourceEl)) return Promise.resolve(true);
    if (copyTextFallback(str)) return Promise.resolve(true);
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(str).then(() => true).catch(() => false);
    }
    return Promise.resolve(false);
  }

  // ── Event modal ──────────────────────────────────────────
  let _modalEvent = null;
  function showModal(ev) {
    // Opening a detail view ends the undo window so the toast doesn't
    // float over the dialog; the removal is already committed.
    favUndo.commit();
    _modalEvent = ev;
    document.getElementById("m-title").textContent = ev.title || "(untitled)";
    document.getElementById("m-owner").textContent = `${ev._entry.name} · ${typeLabel(ev.ownerType)}`;
    document.getElementById("m-day").textContent = ev.day || "?";
    const mTime = document.getElementById("m-time");
    mTime.textContent = `${ev.startTime || "?"}–${ev.endTime || "?"}`;
    if (ev.crossesMidnight) {
      const sup = document.createElement("span");
      sup.className = "cross-midnight";
      sup.title = "Ends the next day";
      sup.textContent = "⁺¹";
      mTime.appendChild(sup);
    }
    const mFav = document.getElementById("m-fav");
    const isFav = eventIsFavorite(ev);
    applyFavBtnState(mFav, isFav, eventIsRedFav(ev));
    const nbEl = document.getElementById("m-neighbourhood");
    nbEl.innerHTML = "";
    if (ev._entry.neighbourhood) {
      const chip = document.createElement("span");
      chip.className = "neighbourhood-chip";
      chip.textContent = ev._entry.neighbourhood;
      nbEl.appendChild(chip);
    }
    document.getElementById("m-desc").textContent = ev.description || "";

    const tagsEl = document.getElementById("m-tags");
    tagsEl.innerHTML = "";
    for (const t of (ev.tags || [])) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.dataset.tag = t;
      chip.textContent = t;
      tagsEl.appendChild(chip);
    }
    tagsEl.style.display = (ev.tags || []).length ? "" : "none";

    const flagsEl = document.getElementById("m-flags");
    if ((ev.normalizationFlags || []).length) {
      flagsEl.textContent = "⚠ Flags: " + ev.normalizationFlags.join(", ");
      flagsEl.style.display = "";
    } else {
      flagsEl.style.display = "none";
    }
    renderModalMapPreview(ev._entry);
    openDialog(document.getElementById("modal"));
  }
  function hideModal() { closeDialog(document.getElementById("modal")); }

  function renderModalMapPreview(entry) {
    const el = document.getElementById("m-map-preview");
    const pin = PIN_BY_NAME.get(entry.name);
    el.innerHTML = "";
    if (!pin) {
      el.classList.add("empty");
      el.textContent = "Location not yet mapped for this camp.";
      el.onclick = null;
      return;
    }
    el.classList.remove("empty");
    const img = document.createElement("img");
    img.alt = "Map";
    const sync = MapImage.syncSrc();
    if (sync) {
      img.src = sync;
    } else {
      el.classList.add("loading");
      MapImage.get().then(src => {
        img.src = src;
        el.classList.remove("loading");
      });
    }
    el.appendChild(img);
    const marker = document.createElement("div");
    marker.className = "marker " + pin.type;
    marker.style.left = (pin.x * 100) + "%";
    marker.style.top = (pin.y * 100) + "%";
    el.appendChild(marker);
    const hint = document.createElement("div");
    hint.className = "open-hint";
    hint.textContent = "Open map";
    el.appendChild(hint);
    el.onclick = () => {
      hideModal();
      switchMode("map");
      mapView.focusOn(pin);
    };
  }

  function switchMode(mode) {
    // Capture where the user was in the outgoing schedule so a round
    // trip through the Map (or another tab) returns them to the same
    // spot instead of snapping to the top. Closing the event modal
    // already preserves scroll because it's an overlay with no
    // re-render; switching modes rebuilds #view from scratch, which
    // resets window scroll to 0 unless we restore it ourselves.
    const prev = state.mode;
    if (prev === "day" || prev === "camp") {
      state._scrollMemory = { mode: prev, day: state.day, y: window.scrollY };
    }

    state.mode = mode;
    for (const b of document.querySelectorAll("#mode-tabs .tab")) {
      b.classList.toggle("active", b.dataset.mode === mode);
    }
    applyFullscreenMode();
    renderAll();

    // Restore the captured scroll when coming back to the same view we
    // left. Day mode is keyed by day too, so switching the active day
    // while away correctly starts at the top instead of a stale offset.
    if (mode === "day" || mode === "camp") {
      const mem = state._scrollMemory;
      if (mem && mem.mode === mode && (mode !== "day" || mem.day === state.day)) {
        const y = mem.y;
        requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "auto" }));
      }
    }
  }

  // Map mode is edge-to-edge fullscreen: hides header/footer.
  // The Back-to-schedule pill is the only navigation surface — the
  // mode tabs stay inside the (hidden) header until the user returns.
  function applyFullscreenMode() {
    const wantFullscreen = state.mode === "map";
    document.body.classList.toggle("map-fullscreen", wantFullscreen);
    // Re-show the header in case auto-hide had it hidden when the
    // user entered map mode.
    const headerEl = document.querySelector("header");
    if (headerEl && !wantFullscreen) headerEl.classList.remove("header-hidden");
  }

  function bindUi() {
    for (const btn of document.querySelectorAll("#mode-tabs .tab")) {
      btn.addEventListener("click", () => {
        const target = btn.dataset.mode;
        // Re-clicking the already-active By Day tab is the
        // jump-to-now gesture (see updateNowCue() for the affordance).
        if (target === "day" && state.mode === "day") {
          jumpToNow({ smooth: true });
          return;
        }
        switchMode(target);
      });
    }

    // Header Favorites toggle — quickest path to filter by favorites.
    // With can't-miss enabled it cycles off → all favorites → reds only
    // → off; otherwise it stays a binary on/off.
    document.getElementById("fav-toggle").addEventListener("click", () => {
      if (cantMissEnabled) {
        if (!state.favoritesOnly) {
          state.favoritesOnly = true;
          state.favoritesRedOnly = false;
        } else if (!state.favoritesRedOnly) {
          state.favoritesRedOnly = true;
        } else {
          state.favoritesOnly = false;
          state.favoritesRedOnly = false;
        }
      } else {
        state.favoritesOnly = !state.favoritesOnly;
        state.favoritesRedOnly = false;
      }
      renderAll();
    });

    // Search modal — typing only updates a *pending* value plus the
    // result-count baked into the Search button label. Nothing is
    // applied to the underlying schedule until the user explicitly
    // confirms (Search button or Return on the iOS keyboard), which
    // avoids per-keystroke re-renders that cause iOS UI jank under
    // the on-screen keyboard. Cancel paths (X / backdrop / Esc)
    // discard pending edits.
    const searchInput = document.getElementById("search");
    let pendingSearch = state.search;

    const updateSearchCountOnly = () => {
      const committed = state.search;
      state.search = pendingSearch;
      const total = totalVisibleEventCount();
      state.search = committed;
      const sr = document.getElementById("search-results");
      if (sr) {
        sr.textContent = total === 0
          ? "Search · no matches"
          : `Search · ${total} event${total === 1 ? "" : "s"}`;
      }
    };

    const commitSearch = () => {
      state.search = pendingSearch;
      renderAll();
      hideSearchModal();
    };

    const cancelSearch = () => {
      pendingSearch = state.search;
      searchInput.value = state.search;
      hideSearchModal();
    };

    searchInput.addEventListener("input", e => {
      pendingSearch = e.target.value.trim();
      updateSearchCountOnly();
    });
    searchInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitSearch();
      }
    });
    const searchDialog = document.getElementById("search-modal");
    document.getElementById("search-open").addEventListener("click", () => {
      searchInput.value = state.search;
      pendingSearch = state.search;
      updateSearchCountOnly();
      if (searchDialog.open) {
        requestAnimationFrame(() => {
          searchInput.focus({ preventScroll: true });
        });
        return;
      }
      openDialog(searchDialog);
      // preventScroll stops iOS from also panning the visual viewport to
      // the input — that pan stacks on top of --keyboard-inset and
      // shoves the card under the status bar.
      requestAnimationFrame(() => {
        searchInput.focus({ preventScroll: true });
      });
    });
    document.getElementById("search-close").addEventListener("click", cancelSearch);
    document.getElementById("search-done").addEventListener("click", commitSearch);
    document.getElementById("search-clear").addEventListener("click", () => {
      pendingSearch = "";
      state.type = "all";
      searchInput.value = "";
      updateSearchCountOnly();
      renderTypeChips();
    });
    bindDialogBackdropClose(searchDialog, cancelSearch);
    // ESC on a <dialog> fires a cancel event before close. Intercept
    // it so Esc reverts the pending search (matches X / backdrop
    // semantics) instead of committing whatever was typed.
    searchDialog.addEventListener("cancel", e => {
      if (_closingDialog) return;
      e.preventDefault();
      pendingSearch = state.search;
      searchInput.value = state.search;
      closeDialog(searchDialog);
    });

    // iOS keyboard handling — without this, the search card stays
    // centered in the layout viewport and the bottom half (Clear /
    // Search button) ends up hidden behind the on-screen keyboard.
    // We expose the keyboard height as --keyboard-inset on the
    // search dialog; CSS uses it to lift the card above the keyboard.
    const vv = window.visualViewport;
    if (vv) {
      const updateKeyboardInset = () => {
        if (!searchDialog.open) return;
        // Match the old full-screen backdrop formula: layout viewport
        // height vs the visible visual viewport, minus any pan iOS
        // applied to keep the focused field in view.
        const viewH = document.documentElement.clientHeight
          || window.innerHeight;
        const inset = Math.max(0, viewH - vv.height - vv.offsetTop);
        searchDialog.style.setProperty("--keyboard-inset", inset + "px");
      };
      vv.addEventListener("resize", updateKeyboardInset);
      vv.addEventListener("scroll", updateKeyboardInset);
      searchInput.addEventListener("focus", () => {
        updateKeyboardInset();
        requestAnimationFrame(updateKeyboardInset);
      });
      // No blur reset: on iOS the tap sequence for Done is
      // touchend → input blur → click. A synchronous reset of
      // --keyboard-inset here drops the dialog by ~½ the keyboard
      // height before the click resolves, so the click lands on the
      // backdrop and routes to cancelSearch — eating the query.
      // visualViewport.resize already zeroes the inset as the
      // keyboard animates away, and the close listener below handles
      // dialog dismissal.
      searchDialog.addEventListener("close", () => {
        searchDialog.style.setProperty("--keyboard-inset", "0px");
      });
    }

    // Type chip group (replaces the old <select>)
    const typeChips = document.getElementById("type-chips");
    typeChips.addEventListener("click", e => {
      const btn = e.target.closest(".chip[data-type]");
      if (!btn) return;
      state.type = btn.dataset.type;
      renderAll();
    });

    // Filters modal — chip taps mutate state directly for pending
    // editing (so the existing chip renderers, which read state.*
    // for active-class, work unchanged), but the underlying
    // schedule is NOT re-rendered while the modal is open. A
    // snapshot taken on open lets us revert on cancel (X /
    // backdrop / Esc). Done commits by calling renderAll().
    const filtersDialog = document.getElementById("filters-modal");
    document.getElementById("filters-open").addEventListener("click", () => {
      filtersSnapshot = {
        quick: new Set(state.quick),
        timesOfDay: new Set(state.timesOfDay),
        durations: new Set(state.durations),
        tags: new Set(state.tags),
        neighbourhoods: new Set(state.neighbourhoods),
      };
      openDialog(filtersDialog);
      renderFiltersModalOnly();
    });
    document.getElementById("filters-close").addEventListener("click", cancelFilters);
    document.getElementById("filters-done").addEventListener("click", commitFilters);
    document.getElementById("filters-clear").addEventListener("click", e => {
      state.tags.clear();
      state.neighbourhoods.clear();
      state.quick.clear();
      state.timesOfDay.clear();
      state.durations.clear();
      renderFiltersModalOnly();
      // Release focus so iOS doesn't keep :hover stuck on this ghost btn.
      e.currentTarget.blur();
    });
    bindDialogBackdropClose(filtersDialog, cancelFilters);
    filtersDialog.addEventListener("cancel", e => {
      if (_closingDialog) return;
      e.preventDefault();
      if (filtersSnapshot) {
        state.quick = filtersSnapshot.quick;
        state.timesOfDay = filtersSnapshot.timesOfDay;
        state.durations = filtersSnapshot.durations;
        state.tags = filtersSnapshot.tags;
        state.neighbourhoods = filtersSnapshot.neighbourhoods;
        filtersSnapshot = null;
      }
      closeDialog(filtersDialog);
    });
    document.getElementById("quick-chips").addEventListener("click", e => {
      const btn = e.target.closest(".chip[data-quick]");
      if (!btn) return;
      const q = btn.dataset.quick;
      if (state.quick.has(q)) state.quick.delete(q);
      else state.quick.add(q);
      renderFiltersModalOnly();
    });

    document.getElementById("time-of-day-chips").addEventListener("click", e => {
      const btn = e.target.closest(".chip[data-tod]");
      if (!btn) return;
      const k = btn.dataset.tod;
      if (state.timesOfDay.has(k)) state.timesOfDay.delete(k);
      else state.timesOfDay.add(k);
      renderFiltersModalOnly();
    });

    document.getElementById("duration-chips").addEventListener("click", e => {
      const btn = e.target.closest(".chip[data-dur]");
      if (!btn) return;
      const k = btn.dataset.dur;
      if (state.durations.has(k)) state.durations.delete(k);
      else state.durations.add(k);
      renderFiltersModalOnly();
    });

    // Event modal
    const eventDialog = document.getElementById("modal");
    bindDialogBackdropClose(eventDialog);
    document.getElementById("m-close").addEventListener("click", hideModal);
    document.getElementById("m-fav").addEventListener("click", e => {
      if (_modalEvent) toggleFavorite(_modalEvent, e.currentTarget);
    });

    // Camp modal
    const campDialog = document.getElementById("camp-modal");
    bindDialogBackdropClose(campDialog);
    document.getElementById("cm-close").addEventListener("click", hideCampModal);

    // Map fullscreen: back-to-schedule pill returns to By Day.
    const backPill = document.getElementById("map-back");
    if (backPill) backPill.addEventListener("click", () => switchMode("day"));

    // Settings modal
    const settingsDialog = document.getElementById("settings-modal");
    document.getElementById("settings-open").addEventListener("click", () => {
      openDialog(settingsDialog);
    });
    bindDialogBackdropClose(settingsDialog, hideSettingsModal);
    document.getElementById("settings-close").addEventListener("click", hideSettingsModal);
    document.getElementById("settings-close-btn").addEventListener("click", hideSettingsModal);
  }

  function hideSettingsModal() {
    closeDialog(document.getElementById("settings-modal"));
  }

  function bindSettings() {
    bindFavoritesBackup();
    bindDisplaySettings();
    bindDevNow();
    bindCorruptRecovery();
    // Initial paint of the in-settings state — runs every time the
    // Settings modal is opened so counts / hints stay fresh.
    document.getElementById("settings-open")?.addEventListener("click", () => {
      renderSettingsNotifications();
      renderCorruptRecovery();
    });
  }

  // ── Dev tool: pretend it's a different moment ─────────────
  // Lives in the Settings modal so it's discoverable but out of the
  // way. Writes to localStorage via saveDevNow() and to the module
  // scoped `devNowOverride` so all the festival time helpers pick
  // it up on the next render. Format matches <input type="datetime-local">
  // ("YYYY-MM-DDTHH:mm") which is parsed as local time by Date.
  function bindDevNow() {
    const input = document.getElementById("dev-now-input");
    const clearBtn = document.getElementById("dev-now-clear");
    if (!input || !clearBtn) return;

    const stored = loadDevNow();
    if (stored) input.value = stored;

    input.addEventListener("change", () => {
      const v = input.value;
      if (!v) { devNowOverride = null; saveDevNow(""); renderAll(); return; }
      const d = new Date(v);
      if (isNaN(d)) return;
      devNowOverride = d;
      saveDevNow(v);
      renderAll();
    });

    clearBtn.addEventListener("click", () => {
      input.value = "";
      devNowOverride = null;
      saveDevNow("");
      renderAll();
    });
  }

  // ── Display-preference toggles ────────────────────────────
  // Wire the display preference checkboxes in Settings. Each one flips
  // a module-scoped flag, persists to localStorage, and
  // re-renders so the change shows up immediately.
  function bindDisplaySettings() {
    const hideDescEl = document.getElementById("setting-hide-desc");
    const hideOngoingEl = document.getElementById("setting-hide-ongoing");
    const cantMissEl = document.getElementById("setting-cant-miss");
    if (!hideDescEl || !hideOngoingEl || !cantMissEl) return;
    hideDescEl.checked = hideDescriptions;
    hideOngoingEl.checked = hideOngoing;
    cantMissEl.checked = cantMissEnabled;
    hideDescEl.addEventListener("change", () => {
      hideDescriptions = hideDescEl.checked;
      saveBoolPref(HIDE_DESC_KEY, hideDescriptions);
      renderAll();
    });
    hideOngoingEl.addEventListener("change", () => {
      hideOngoing = hideOngoingEl.checked;
      saveBoolPrefExplicit(HIDE_ONGOING_KEY, hideOngoing);
      renderAll();
    });
    cantMissEl.addEventListener("change", () => {
      cantMissEnabled = cantMissEl.checked;
      saveBoolPref(CANT_MISS_KEY, cantMissEnabled);
      // The reds-only filter stage is unreachable without the feature;
      // drop it so we don't leave a hidden filter narrowing the list.
      if (!cantMissEnabled) state.favoritesRedOnly = false;
      // Re-render so every visible star reflects the new rules
      // (off: any reds render as regular green; on: they pop again).
      // Also repaint an open modal star — applyFavBtnState gates
      // is-red on the live flag, so this is the cheapest sync path.
      if (_modalEvent) {
        const mFav = document.getElementById("m-fav");
        if (mFav) applyFavBtnState(mFav, eventIsFavorite(_modalEvent), eventIsRedFav(_modalEvent));
      }
      renderAll();
    });

    // Theme picker. Populated from THEMES so adding a new entry to
    // that array (and a [data-theme="…"] block in themes.css) is
    // all that's needed to surface a new option here.
    const themeEl = document.getElementById("setting-theme");
    if (themeEl) {
      themeEl.innerHTML = "";
      THEMES.forEach(({ id, label }) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = label;
        themeEl.appendChild(opt);
      });
      themeEl.value = activeThemeId;
      themeEl.addEventListener("change", () => {
        activeThemeId = themeEl.value;
        saveThemePref(activeThemeId);
        applyTheme(activeThemeId);
        // No renderAll() needed — themes are pure CSS-variable swaps,
        // the DOM doesn't change.
      });
    }
  }

  // ── In-Settings notification cards + gear dot ─────────────
  // Replaces the older home-page banner. Two notification cards may
  // appear at the very top of the Settings sheet; whenever either is
  // active a small lime dot sits on the gear icon so users notice
  // there's something to see without anything intruding on the
  // schedule itself.
  //
  // Thresholds:
  //   - Add-to-Home-Screen hint   → favorites.size >= 10 (iOS only)
  //   - Back-up-your-favorites    → favorites.size >= 20 (any browser)
  // The lower threshold for the iOS hint reflects how dangerous the
  // 7-day ITP wipe is for non-installed Safari users — that's the
  // first thing we want them to fix.
  const IOS_HINT_THRESHOLD = 10;
  const BACKUP_NAG_THRESHOLD = 20;

  function shouldShowBackupNotif() {
    if (!state.favorites || state.favorites.size < BACKUP_NAG_THRESHOLD) return false;
    let backedUp = null;
    let dismissed = null;
    try {
      backedUp = localStorage.getItem(FAV_BACKED_UP_AT_KEY);
      dismissed = localStorage.getItem(FAV_NAG_DISMISSED_AT_KEY);
    } catch {}
    if (backedUp) return false;
    if (dismissed) {
      const ageMs = Date.now() - Number(dismissed);
      if (ageMs < 30 * 24 * 60 * 60 * 1000) return false;
    }
    return true;
  }
  function shouldShowIosHintNotif() {
    if (!isIosSafariNotStandalone()) return false;
    if (!state.favorites || state.favorites.size < IOS_HINT_THRESHOLD) return false;
    let dismissed = null;
    try { dismissed = localStorage.getItem(FAV_IOS_HINT_DISMISSED_KEY); } catch {}
    if (dismissed) {
      const ageMs = Date.now() - Number(dismissed);
      if (ageMs < 30 * 24 * 60 * 60 * 1000) return false;
    }
    return true;
  }
  function hasActiveNotifications() {
    return shouldShowBackupNotif() || shouldShowIosHintNotif();
  }

  function renderSettingsBadge() {
    const dot = document.getElementById("settings-badge");
    if (!dot) return;
    dot.hidden = !hasActiveNotifications();
  }

  // Build one notification card. Returns the root DOM node.
  function makeNotifCard({ title, body, primaryLabel, onPrimary, onDismiss }) {
    const wrap = document.createElement("div");
    wrap.className = "settings-notif";
    const content = document.createElement("div");
    content.className = "settings-notif-content";
    const titleEl = document.createElement("div");
    titleEl.className = "settings-notif-title";
    titleEl.textContent = title;
    const bodyEl = document.createElement("div");
    bodyEl.className = "settings-notif-body";
    bodyEl.textContent = body;
    content.appendChild(titleEl);
    content.appendChild(bodyEl);
    const actions = document.createElement("div");
    actions.className = "settings-notif-actions";
    if (primaryLabel && onPrimary) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-notif-action";
      btn.textContent = primaryLabel;
      btn.addEventListener("click", onPrimary);
      actions.appendChild(btn);
    }
    if (onDismiss) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "settings-notif-dismiss";
      x.setAttribute("aria-label", "Dismiss");
      x.textContent = "✕";
      x.addEventListener("click", onDismiss);
      actions.appendChild(x);
    }
    wrap.appendChild(content);
    wrap.appendChild(actions);
    return wrap;
  }

  function renderSettingsNotifications() {
    const panel = document.getElementById("settings-notifications");
    if (!panel) return;
    panel.innerHTML = "";
    const cards = [];
    if (shouldShowIosHintNotif()) {
      cards.push(makeNotifCard({
        title: "Add to Home Screen",
        body: "Tap Share \u2192 Add to Home Screen so Safari can't wipe your favorites.",
        primaryLabel: null,
        onPrimary: null,
        onDismiss: () => {
          try { localStorage.setItem(FAV_IOS_HINT_DISMISSED_KEY, String(Date.now())); } catch {}
          renderSettingsNotifications();
          renderSettingsBadge();
        },
      }));
    }
    if (shouldShowBackupNotif()) {
      cards.push(makeNotifCard({
        title: "Back up your favorites",
        body: "So your browser can't lose them later.",
        primaryLabel: "Back up",
        onPrimary: () => {
          // Trigger the existing Backup flow via its button so all the
          // bookkeeping (backed-up-at, clipboard, persist request)
          // runs through one canonical path.
          const btn = document.getElementById("fav-backup");
          if (btn) btn.click();
        },
        onDismiss: () => {
          try { localStorage.setItem(FAV_NAG_DISMISSED_AT_KEY, String(Date.now())); } catch {}
          renderSettingsNotifications();
          renderSettingsBadge();
        },
      }));
    }
    if (!cards.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    for (const c of cards) panel.appendChild(c);
  }

  // ── Settings: corrupt-data recovery banner (Tier 1.1 UI) ──
  // Shown only when stashCorrupt() actually preserved something on
  // load. Lets the user copy the raw text out of the stash and then
  // dismiss it. This is intentionally minimal — last-resort path.
  function bindCorruptRecovery() {
    const dismissAll = document.getElementById("fav-corrupt-dismiss");
    if (dismissAll) {
      dismissAll.addEventListener("click", () => {
        for (const s of listCorruptStashes()) deleteCorruptStash(s.storageKey);
        renderCorruptRecovery();
      });
    }
  }
  function renderCorruptRecovery() {
    const wrap = document.getElementById("fav-corrupt-block");
    if (!wrap) return;
    const stashes = listCorruptStashes();
    if (!stashes.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const listEl = wrap.querySelector(".fav-corrupt-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    for (const s of stashes) {
      const row = document.createElement("div");
      row.className = "fav-corrupt-row";
      const when = new Date(s.ts);
      const label = document.createElement("div");
      label.className = "fav-corrupt-label";
      label.textContent = s.sourceKey.replace(/^otherworld:/, "") + " · " +
        when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      row.appendChild(label);
      const actions = document.createElement("div");
      actions.className = "fav-corrupt-actions";
      const copyB = document.createElement("button");
      copyB.type = "button";
      copyB.className = "backup-btn btn-ghost";
      copyB.textContent = "Copy raw";
      copyB.addEventListener("click", () => {
        const raw = readCorruptStash(s.storageKey) || "";
        void copyText(raw);
        copyB.textContent = "Copied";
        setTimeout(() => { copyB.textContent = "Copy raw"; }, 1200);
      });
      const dropB = document.createElement("button");
      dropB.type = "button";
      dropB.className = "backup-btn btn-ghost";
      dropB.textContent = "Discard";
      dropB.addEventListener("click", () => {
        deleteCorruptStash(s.storageKey);
        renderCorruptRecovery();
      });
      actions.appendChild(copyB);
      actions.appendChild(dropB);
      row.appendChild(actions);
      listEl.appendChild(row);
    }
  }

  // ── iOS detection helper ──────────────────────────────────
  // Used by shouldShowIosHintNotif() above; isolated here so the
  // notification renderer above can reference it without forward-
  // reference gymnastics. The actual iOS hint UI is now a card
  // injected into #settings-notifications, not a standalone block.
  function isIosSafariNotStandalone() {
    const ua = navigator.userAgent || "";
    const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    if (!isIos) return false;
    const standalone = window.navigator.standalone === true
      || window.matchMedia?.("(display-mode: standalone)")?.matches === true
      || window.matchMedia?.("(display-mode: fullscreen)")?.matches === true;
    return !standalone;
  }

  // ── Self-heal favorites against upstream renames (Tier 3.1) ──
  // After ALL_EVENTS is built and state.favorites is loaded, walk
  // every favorite whose stored key has no matching event. If the
  // favorite has metadata (camp + day + title) try to find a same-
  // camp same-day event with a close-enough title and re-key the
  // favorite under the new event's key. Run once at startup.
  function titleDistance(a, b) {
    // Cheap Levenshtein with early-out. Titles are short (<60 chars)
    // so we don't need the row-swap trick. Returns Infinity if the
    // length delta alone exceeds 60% of the longer string — that's
    // already past the fuzzy threshold so we can skip the matrix.
    if (a === b) return 0;
    if (!a || !b) return Math.max((a || "").length, (b || "").length);
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > Math.max(la, lb) * 0.6) return Infinity;
    const prev = new Array(lb + 1);
    const curr = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      curr[0] = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost,
        );
      }
      for (let j = 0; j <= lb; j++) prev[j] = curr[j];
    }
    return prev[lb];
  }
  function selfHealFavorites() {
    if (!state.favorites || state.favorites.size === 0) return;
    // Lookup tables we'll consult per favorite.
    const eventByKey = new Map();
    const eventsByCampDay = new Map(); // "campNorm|day" → Event[]
    for (const ev of ALL_EVENTS) {
      const k = eventFavKey(ev);
      if (!eventByKey.has(k)) eventByKey.set(k, ev);
      const campNorm = normalizeCampForKey((ev._entry && ev._entry.name) || ev.owner || "");
      const day = (ev.day || "").trim().toLowerCase();
      const bucket = campNorm + "|" + day;
      if (!eventsByCampDay.has(bucket)) eventsByCampDay.set(bucket, []);
      eventsByCampDay.get(bucket).push(ev);
    }

    const rekeys = []; // {oldKey, newKey, meta}
    for (const [k, meta] of state.favorites) {
      if (eventByKey.has(k)) continue;
      if (!meta || !meta.camp || !meta.title || !meta.day) continue;
      const bucket = normalizeCampForKey(meta.camp) + "|" + meta.day.trim().toLowerCase();
      const candidates = eventsByCampDay.get(bucket);
      if (!candidates || !candidates.length) continue;
      const normTarget = normalizeTitleForKey(meta.title);
      let best = null;
      let bestDist = Infinity;
      for (const ev of candidates) {
        const normCand = normalizeTitleForKey(ev.title || "");
        const d = titleDistance(normTarget, normCand);
        if (d < bestDist) { bestDist = d; best = ev; }
      }
      if (!best) continue;
      const lenRef = Math.max(normTarget.length, normalizeTitleForKey(best.title).length, 1);
      // Accept the match only when the edit distance is < 30% of the
      // longer normalised title. Empirically catches typo fixes,
      // emoji adds/removes, and the common " Daily" / " Workshop"
      // suffix additions without false-positives across same-day
      // events from the same camp.
      if (bestDist / lenRef > 0.3) continue;
      const newKey = eventFavKey(best);
      if (newKey === k) continue;
      if (state.favorites.has(newKey)) continue; // already starred
      rekeys.push({ oldKey: k, newKey, meta });
    }
    if (!rekeys.length) return;
    for (const r of rekeys) {
      state.favorites.delete(r.oldKey);
      state.favorites.set(r.newKey, r.meta);
      if (state.favoritesRed.has(r.oldKey)) {
        state.favoritesRed.delete(r.oldKey);
        state.favoritesRed.add(r.newKey);
      }
    }
    saveFavorites(state.favorites);
    saveRedFavorites(state.favoritesRed);
  }

  // ── Favorites backup / restore ────────────────────────────
  // Two-button UI in the Settings modal. Backup serialises the favorites
  // set into a compact base64 JSON blob and (a) tries to copy it to the
  // clipboard, (b) shows it inline as a fallback. Restore parses a
  // pasted blob back into the set, merging with whatever's already
  // there (set union — never destroys existing favs).
  //
  // The blob includes a small header so a future schema change can
  // detect old payloads. Round-trips through `eventFavKey` are not
  // needed — the keys ARE the payload.
  function bindFavoritesBackup() {
    const backupBtn = document.getElementById("fav-backup");
    const restoreBtn = document.getElementById("fav-restore");
    const countEl = document.getElementById("fav-backup-count");
    const statusEl = document.getElementById("fav-backup-status");
    const backupDialog = document.getElementById("backup-modal");
    const closeBtn = document.getElementById("backup-modal-close");
    const hintEl = document.getElementById("fav-backup-hint");
    const codeEl = document.getElementById("fav-backup-code");
    const copyBtn = document.getElementById("fav-backup-copy");
    if (!backupBtn || !restoreBtn || !statusEl) return;
    const DEFAULT_HINT = "Keep a copy of this code (or save it as a file) so you can restore later.";
    let copyResetTimer = null;

    function refreshCount() {
      const n = state.favorites.size;
      if (countEl) countEl.textContent = n ? "(" + n + ")" : "";
    }
    refreshCount();
    // Refresh the (N) badge each time the Settings modal opens.
    // The settings-open click handler fires before showModal(), so
    // count is fresh by the time the dialog paints.
    document.getElementById("settings-open")
      .addEventListener("click", refreshCount);

    function hideStatus() {
      statusEl.hidden = true;
      statusEl.innerHTML = "";
    }
    function showStatus(html, kind) {
      statusEl.hidden = false;
      statusEl.className = "backup-status" + (kind ? " " + kind : "");
      statusEl.innerHTML =
        '<span class="backup-status-text">' + html + "</span>" +
        '<button type="button" class="backup-status-dismiss" aria-label="Dismiss">✕</button>';
      const dismissBtn = statusEl.querySelector(".backup-status-dismiss");
      if (dismissBtn) dismissBtn.addEventListener("click", hideStatus);
    }
    // Clear any lingering restore/backup status when Settings closes
    // (button, backdrop, or ESC — they all fire the dialog's native
    // close event), so reopening Settings starts clean.
    const settingsDialogEl = document.getElementById("settings-modal");
    if (settingsDialogEl) settingsDialogEl.addEventListener("close", hideStatus);
    // Thin alias around the hoisted writer so callers in this scope
    // keep their original name.
    function encodeBlob(set, redSet) {
      return encodeFavoritesBlob(set, redSet);
    }
    // decodeBlob accepts either the canonical base64 form OR the
    // raw JSON dropped onto the page as a file (Tier 2.1 file-based
    // restore). Tries JSON.parse on the trimmed string first, falls
    // back to atob+decode. Returns { favs, red, meta: Map<key,meta> }.
    function decodeBlob(str) {
      const trimmed = String(str || "").trim();
      if (!trimmed) throw new Error("Empty code");
      let payload = null;
      // Raw-JSON path (downloaded backup file).
      if (trimmed.startsWith("{")) {
        try { payload = JSON.parse(trimmed); }
        catch { /* fall through to base64 path */ }
      }
      if (!payload) {
        const compact = trimmed.replace(/\s+/g, "");
        let json;
        try {
          const binary = atob(compact);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          json = new TextDecoder().decode(bytes);
        } catch {
          throw new Error("That doesn't look like a valid backup code.");
        }
        try { payload = JSON.parse(json); }
        catch { throw new Error("Backup code is corrupted."); }
      }
      if (!payload || payload.t !== "otherworld-favs" || !Array.isArray(payload.favs)) {
        throw new Error("Backup code is for something else.");
      }
      const meta = new Map();
      if (Array.isArray(payload.meta)) {
        for (const row of payload.meta) {
          if (!Array.isArray(row) || row.length < 2) continue;
          const [k, m] = row;
          if (typeof k !== "string" || !m || typeof m !== "object") continue;
          meta.set(k, {
            camp: typeof m.camp === "string" ? m.camp : null,
            title: typeof m.title === "string" ? m.title : null,
            day: typeof m.day === "string" ? m.day : null,
            startTime: typeof m.startTime === "string" ? m.startTime : null,
            starredAt: typeof m.starredAt === "number" ? m.starredAt : null,
          });
        }
      }
      return {
        favs: payload.favs.filter(k => typeof k === "string"),
        red: Array.isArray(payload.red)
          ? payload.red.filter(k => typeof k === "string")
          : [],
        meta,
      };
    }

    function resetCopyBtn() {
      if (!copyBtn) return;
      copyBtn.classList.remove("copied");
      const label = copyBtn.querySelector(".label");
      if (label) label.textContent = "Copy";
    }
    function flashCopied() {
      if (!copyBtn) return;
      copyBtn.classList.add("copied");
      const label = copyBtn.querySelector(".label");
      if (label) label.textContent = "Copied";
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(resetCopyBtn, 1500);
    }
    function selectBackupCode() {
      if (!codeEl) return;
      if (codeEl.tagName === "TEXTAREA" || codeEl.tagName === "INPUT") {
        codeEl.focus({ preventScroll: true });
        codeEl.select();
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
    }
    function onManualCopyResult(ok) {
      if (ok) {
        if (hintEl) hintEl.textContent = DEFAULT_HINT;
        flashCopied();
        return;
      }
      selectBackupCode();
      if (hintEl) {
        hintEl.textContent = "Couldn't copy automatically — the code is selected; long-press and choose Copy.";
      }
    }

    // Stacks on top of the still-open Settings dialog via a second
    // showModal() call. Modern Safari (17+) supports two top-layer
    // dialogs at once; closing the backup leaves Settings intact with
    // its scroll position preserved.
    function openBackupModal() {
      openDialog(backupDialog);
    }
    function closeBackupModal() {
      closeDialog(backupDialog);
    }

    // Common merge path used by paste-restore and file-restore.
    // `parsed` is the output of decodeBlob (or any equivalent
    // shape). Returns a status string for the UI.
    function applyRestorePayload(parsed) {
      const before = state.favorites.size;
      const normalised = migrateLegacyFavorites(parsed.favs || []);
      const normalisedRed = migrateLegacyFavorites(parsed.red || []);
      const restoredMeta = parsed.meta instanceof Map ? parsed.meta : new Map();
      for (const k of normalised) {
        if (state.favorites.has(k)) continue;
        state.favorites.set(k, restoredMeta.get(k) || null);
      }
      for (const k of normalisedRed) {
        if (state.favorites.has(k)) state.favoritesRed.add(k);
      }
      const added = state.favorites.size - before;
      saveFavorites(state.favorites);
      saveRedFavorites(state.favoritesRed);
      refreshCount();
      renderSettingsBadge();
      if (typeof renderAll === "function") renderAll();
      const total = normalised.size;
      return "Restored " + total + " favorite" + (total === 1 ? "" : "s") +
        " (" + added + " new).";
    }

    backupBtn.addEventListener("click", async () => {
      const n = state.favorites.size;
      if (n === 0) {
        showStatus("No favorites to back up yet — tap the ★ on any event first.", "err");
        return;
      }
      statusEl.hidden = true;
      const code = encodeBlob(state.favorites, state.favoritesRed);
      if (codeEl) codeEl.value = code;
      if (hintEl) hintEl.textContent = DEFAULT_HINT;
      resetCopyBtn();
      openBackupModal();
      // Best-effort clipboard on open — no button/hint feedback; the
      // user hasn't tapped Copy yet.
      void copyText(code, codeEl);
      // Track that the user has at least seen the backup code so the
      // Tier 2.2 nag doesn't keep hammering them, and try to grab
      // persistent storage now (cheap, no-op on Safari iOS).
      try { localStorage.setItem(FAV_BACKED_UP_AT_KEY, String(Date.now())); } catch {}
      void maybeRequestPersistedStorage();
      renderSettingsBadge();
    });

    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const code = codeEl ? codeEl.value : "";
        if (!code) return;
        void copyText(code, codeEl).then(onManualCopyResult);
      });
    }

    // Download-as-file (Tier 2.1). A .json file saved to Files /
    // Downloads survives Safari ITP eviction and even reinstall
    // because it lives outside the website's storage sandbox —
    // strictly better than the clipboard on iOS.
    const downloadBtn = document.getElementById("fav-backup-download");
    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        const code = codeEl ? codeEl.value : "";
        if (!code) return;
        try {
          // Decode the base64 blob back to its JSON form so the file
          // is human-inspectable AND restore-able by the same path.
          const binary = atob(code);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          const now = new Date();
          const stamp = now.getFullYear() + "-"
            + String(now.getMonth() + 1).padStart(2, "0") + "-"
            + String(now.getDate()).padStart(2, "0");
          a.download = "otherworld-favorites-" + stamp + ".json";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          if (hintEl) hintEl.textContent = "Saved. Keep that file somewhere safe — Files / Drive / email to yourself.";
          try { localStorage.setItem(FAV_BACKED_UP_AT_KEY, String(Date.now())); } catch {}
          renderSettingsBadge();
        } catch {
          if (hintEl) hintEl.textContent = "Couldn't save the file — try the Copy button instead.";
        }
      });
    }

    if (closeBtn) closeBtn.addEventListener("click", closeBackupModal);
    bindDialogBackdropClose(backupDialog, closeBackupModal);
    // ESC on the backup dialog only closes it (native top-layer
    // semantics: cancel applies to the topmost open dialog), so the
    // Settings dialog underneath stays open with its scroll position
    // intact. No global keydown dispatcher needed.

    // Restore now opens a small chooser dialog (paste OR file) instead
    // of going straight to window.prompt — the file path is the iOS
    // ITP-survivable one and needs an <input type="file"> click.
    const restoreDialog = document.getElementById("restore-modal");
    const restorePasteBtn = document.getElementById("fav-restore-paste");
    const restoreFileBtn = document.getElementById("fav-restore-file");
    const restoreFileInput = document.getElementById("fav-restore-file-input");
    const restoreCloseBtn = document.getElementById("restore-modal-close");
    function openRestoreModal() { if (restoreDialog) openDialog(restoreDialog); }
    function closeRestoreModal() { if (restoreDialog) closeDialog(restoreDialog); }
    restoreBtn.addEventListener("click", () => {
      if (restoreDialog) {
        openRestoreModal();
        return;
      }
      // Fallback for old cached HTML that doesn't have the modal yet.
      doRestoreFromPrompt();
    });
    function doRestoreFromPrompt() {
      const input = window.prompt(
        "Paste your backup code below.\n\nRestoring merges with any favorites you already have on this device — nothing is deleted."
      );
      if (input == null) return;
      let parsed;
      try { parsed = decodeBlob(input); }
      catch (err) { showStatus(err.message, "err"); return; }
      showStatus(applyRestorePayload(parsed), "ok");
    }
    if (restorePasteBtn) {
      restorePasteBtn.addEventListener("click", () => {
        closeRestoreModal();
        doRestoreFromPrompt();
      });
    }
    if (restoreFileBtn && restoreFileInput) {
      restoreFileBtn.addEventListener("click", () => {
        restoreFileInput.value = ""; // re-pick same file works
        restoreFileInput.click();
      });
      restoreFileInput.addEventListener("change", async () => {
        const file = restoreFileInput.files && restoreFileInput.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = decodeBlob(text);
          closeRestoreModal();
          showStatus(applyRestorePayload(parsed), "ok");
        } catch (err) {
          closeRestoreModal();
          showStatus(err && err.message ? err.message : "Couldn't read that file.", "err");
        }
      });
    }
    if (restoreCloseBtn) restoreCloseBtn.addEventListener("click", closeRestoreModal);
    bindDialogBackdropClose(restoreDialog, closeRestoreModal);
  }

  // ── Auto-hide header on scroll-down, reveal on scroll-up ──
  // The header is position:fixed and overlays content. We use two
  // mirrored accumulators (downAccum, upAccum) so neither direction
  // can be flipped by a single jitter pixel — important deeper into
  // the page where trailing inertia events used to immediately
  // re-hide the header right after a clean upward swipe.
  //
  // Rules:
  //   - At the very top: always show, reset both accumulators.
  //   - Past HIDE_AFTER, downward delta accumulates; crossing
  //     HIDE_DELTA triggers hide() and resets upAccum.
  //   - Upward delta accumulates; crossing REVEAL_DELTA triggers
  //     reveal() and resets downAccum.
  //   - Direction change resets the *opposite* accumulator so
  //     intent is captured cleanly (you can't "carry forward" old
  //     downward distance into a new upward gesture).
  //
  // We also expose the live header height as --header-h so body's
  // padding-top reservation always matches (active-filters and
  // day-tabs change the header's height dynamically).
  function bindHeaderAutoHide() {
    const headerEl = document.querySelector("header");
    if (!headerEl) return;
    const HIDE_AFTER = 120;   // px scrolled before we ever hide
    const HIDE_DELTA = 10;    // cumulative downward px before hide
    const REVEAL_DELTA = 4;   // cumulative upward px before reveal
    let lastY = window.scrollY;
    let downAccum = 0;
    let upAccum = 0;

    function reveal() { headerEl.classList.remove("header-hidden"); }
    function hide()   { headerEl.classList.add("header-hidden"); }

    // Keep --header-h in sync with the live header height.
    function syncHeaderHeight() {
      const h = headerEl.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--header-h", h + "px");
    }
    syncHeaderHeight();
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(syncHeaderHeight).observe(headerEl);
    } else {
      window.addEventListener("resize", syncHeaderHeight, { passive: true });
    }

    window.addEventListener("scroll", () => {
      const y = window.scrollY;
      // Toggle the floating shadow once content sits under the header.
      document.body.classList.toggle("is-scrolled", y > 4);

      if (y <= 4) {
        reveal();
        downAccum = 0;
        upAccum = 0;
      } else if (y < lastY) {
        // Upward: reset opposite, accumulate, fire on threshold.
        downAccum = 0;
        upAccum += (lastY - y);
        if (upAccum >= REVEAL_DELTA) reveal();
      } else if (y > lastY && y > HIDE_AFTER) {
        // Downward past the safe zone: reset opposite, accumulate.
        upAccum = 0;
        downAccum += (y - lastY);
        if (downAccum >= HIDE_DELTA) hide();
      }
      lastY = y;
      updateNowCue();
    }, { passive: true });

    // Touching the very top edge of the viewport while the header is
    // hidden also reveals it — a thumb-friendly escape hatch when you
    // want the filters back without scrolling.
    document.addEventListener("touchstart", e => {
      if (!headerEl.classList.contains("header-hidden")) return;
      const t = e.touches && e.touches[0];
      if (t && t.clientY <= 30) reveal();
    }, { passive: true });
  }

  function hideSearchModal() {
    closeDialog(document.getElementById("search-modal"));
  }
  function hideFiltersModal() {
    closeDialog(document.getElementById("filters-modal"));
  }

  // ── Filters modal pending-edit machinery ─────────────────────
  // Chip taps inside the filters modal mutate state.* directly so
  // the existing chip renderers (which derive their .active class
  // from state) work without changes. While the modal is open we
  // call renderFiltersModalOnly() instead of renderAll(), so the
  // schedule beneath the backdrop is not re-rendered. On open we
  // snapshot the four filter Sets so cancel paths can revert.
  let filtersSnapshot = null;

  function renderFiltersModalOnly() {
    renderQuickChips();
    renderTimeOfDayChips();
    renderDurationChips();
    renderTagChips();
    renderNeighbourhoodChips();
    renderModalResultCounts();
  }

  function commitFilters() {
    filtersSnapshot = null;
    renderAll();
    hideFiltersModal();
  }

  function cancelFilters() {
    if (filtersSnapshot) {
      state.quick = filtersSnapshot.quick;
      state.timesOfDay = filtersSnapshot.timesOfDay;
      state.durations = filtersSnapshot.durations;
      state.tags = filtersSnapshot.tags;
      state.neighbourhoods = filtersSnapshot.neighbourhoods;
      filtersSnapshot = null;
    }
    hideFiltersModal();
  }

  // ── Favorites ───────────────────────────────────────────
  // toggleFavorite does the MINIMUM DOM work needed to feel correct:
  //   1. Update the source button (star + class + pop animation)
  //   2. Update the header badge count + bump animation
  //   3. Only re-render the schedule if the change actually changes
  //      visible content (favorites filter on, or favorites count
  //      shown elsewhere).
  // This keeps tapping stars feeling instant even on Friday's 345-event
  // timeline.
  function toggleFavorite(ev, srcEl) {
    const k = eventFavKey(ev);
    const wasFav = state.favorites.has(k);
    const wasRed = state.favoritesRed.has(k);
    // Snapshot the existing meta before any mutation so an Undo can
    // restore the original starredAt rather than a fresh timestamp.
    const priorMeta = state.favorites.get(k) || null;

    // State machine:
    //   cantMissEnabled OFF → binary ☆ ↔ ★ (original behaviour).
    //   cantMissEnabled ON  → ☆ → ★ → ★red → ☆ on each tap.
    // Invariant kept everywhere: favoritesRed ⊆ favorites. When the
    // feature is off and the user demotes a star that happens to be
    // red in storage, we drop the red flag too so the data stays
    // consistent with what's visible.
    let nextFav, nextRed;
    if (!cantMissEnabled) {
      nextFav = !wasFav;
      nextRed = false;
    } else if (!wasFav) {
      nextFav = true;
      nextRed = false;
    } else if (!wasRed) {
      nextFav = true;
      nextRed = true;
    } else {
      nextFav = false;
      nextRed = false;
    }

    if (nextFav) {
      // Preserve the existing meta on re-favorite if any so the
      // starredAt timestamp survives a tier-bump round trip. Only
      // build fresh meta if we don't already have something.
      const existing = state.favorites.get(k);
      state.favorites.set(k, existing || buildFavoriteMeta(ev));
    } else {
      state.favorites.delete(k);
    }
    if (nextRed) state.favoritesRed.add(k);
    else state.favoritesRed.delete(k);
    saveFavorites(state.favorites);
    saveRedFavorites(state.favoritesRed);

    // First-ever favorite milestone — track when we crossed zero
    // so the backup nag (Tier 2.2) gets a sane "wait 24h before
    // pestering" floor and the "Add to Home Screen on iOS" hint
    // has a stable anchor too.
    if (nextFav && !wasFav) {
      try {
        if (!localStorage.getItem(FAV_FIRST_ADDED_AT_KEY)) {
          localStorage.setItem(FAV_FIRST_ADDED_AT_KEY, String(Date.now()));
        }
      } catch {}
      // Best-effort: ask the browser to keep our storage. No-op on
      // Safari iOS (no API); on everything else this is the cheapest
      // win against quota-pressure eviction.
      void maybeRequestPersistedStorage();
    }
    // Surface the nag / iOS hint now that the favorites count
    // changed. Cheap (just hides/shows existing DOM).
    renderSettingsBadge();

    // 1. Update the source button in place — no re-render needed.
    if (srcEl) {
      applyFavBtnState(srcEl, nextFav, nextRed);
      // Pop animation only on tier *increases* (off→1, 1→2).
      // Demotions (red→off) feel better as a quiet color change.
      const increased = (nextFav && !wasFav) || (nextRed && !wasRed);
      if (increased) {
        srcEl.classList.remove("just-favorited");
        void srcEl.offsetWidth; // restart animation if re-tapped fast
        srcEl.classList.add("just-favorited");
      }
    }

    // 1b. Sync every other on-screen card for this same event. Long
    // events render duplicate "ongoing" cards (one per overlapping
    // hour), each with its own star — they'd otherwise stay stale until
    // a full re-render. Cheap: a single scoped querySelectorAll.
    document
      .querySelectorAll(`.event-card[data-fav-key="${CSS.escape(k)}"] .fav-btn`)
      .forEach(btn => { if (btn !== srcEl) applyFavBtnState(btn, nextFav, nextRed); });

    // 2. Mirror to the modal star (if open on this event and not the
    // element we just updated above).
    if (_modalEvent && eventFavKey(_modalEvent) === k) {
      const mFav = document.getElementById("m-fav");
      if (mFav && mFav !== srcEl) applyFavBtnState(mFav, nextFav, nextRed);
    }

    // A manual re-favorite cancels any still-pending undo for this key.
    if (nextFav && !wasFav) favUndo.dropKey(k);

    // 3. Full schedule re-render ONLY if it would actually change what's
    // on screen. That's: favorites-only filter is active.
    if (state.favoritesOnly) {
      renderAll();
      // The card just left the filtered view — offer a reversal window.
      if (wasFav && !nextFav) {
        favUndo.push({ key: k, meta: priorMeta, wasRed });
      }
    }
  }

  // Single source of truth for what a star button should look like
  // for a given (isFav, isRed) pair. Used by toggleFavorite for live
  // updates and by the setting toggle to repaint open modals.
  // Visual gating: is-red only paints when the Settings flag is on,
  // so disabling the feature gracefully reverts existing reds to
  // regular favorites without touching their storage.
  function applyFavBtnState(el, isFav, isRed) {
    el.textContent = isFav ? "★" : "☆";
    el.classList.toggle("is-fav", isFav);
    el.classList.toggle("is-red", !!(isFav && isRed && cantMissEnabled));
    el.setAttribute("aria-pressed", isFav ? "true" : "false");
    el.setAttribute("aria-label", isFav ? "Unfavorite" : "Favorite");
  }

  // ── Favorites "Undo" toast ────────────────────────────────
  // When the Favorites filter is on, unfavoriting drops the card out
  // of view instantly. This is a short, reversible window: a single
  // bottom-center toast that lets you put removals back, newest-first
  // (LIFO), each Undo tap restoring one and resetting the timer.
  //
  // The removal itself is committed to storage immediately — the toast
  // is purely a reversal buffer, so what's on screen always reflects
  // the real favorites set. Letting the timer expire (or navigating
  // into the modal) just finalises whatever's left in the stack.
  const favUndo = (() => {
    const el = document.getElementById("fav-toast");
    const msgEl = el && el.querySelector(".fav-toast-msg");
    const btn = el && el.querySelector(".fav-toast-undo");
    const DURATION_MS = 5000;
    // Stack of { key, meta, wasRed }, captured at removal time so a
    // restore reinstates the exact prior state (original starredAt
    // meta + can't-miss red tier), not a generic favorite.
    let stack = [];
    let timer = null;

    function render() {
      if (!msgEl) return;
      const n = stack.length;
      msgEl.innerHTML = n > 1
        ? `<span class="count">${n}</span> removed from favorites`
        : "Removed from favorites";
    }
    function restartTimer() {
      clearTimeout(timer);
      timer = setTimeout(commit, DURATION_MS);
    }
    function hide() {
      if (el) el.classList.remove("is-visible");
    }
    // Drop the undo window; the removals stay (already persisted).
    function commit() {
      clearTimeout(timer);
      stack = [];
      hide();
    }
    // Record a removal and (re)show the toast, resetting the clock.
    function push(entry) {
      if (!el) return;
      stack.push(entry);
      render();
      el.classList.add("is-visible");
      restartTimer();
    }
    // A manual re-favorite of a still-pending key makes its undo entry
    // moot — drop it so the count stays truthful.
    function dropKey(k) {
      const before = stack.length;
      stack = stack.filter(e => e.key !== k);
      if (stack.length === before) return;
      if (stack.length === 0) commit();
      else render();
    }
    // Restore the most recent removal (LIFO), then keep the toast up
    // with a refreshed timer if there's more to walk back.
    function undoOne() {
      const entry = stack.pop();
      if (!entry) { commit(); return; }
      state.favorites.set(entry.key, entry.meta || null);
      if (entry.wasRed) state.favoritesRed.add(entry.key);
      saveFavorites(state.favorites);
      saveRedFavorites(state.favoritesRed);
      renderSettingsBadge();
      renderAll();
      if (stack.length > 0) { render(); restartTimer(); }
      else commit();
    }

    if (btn) {
      btn.addEventListener("click", e => { e.stopPropagation(); undoOne(); });
    }
    if (el) {
      // Pause the countdown while the pointer rests on the toast so it
      // can't expire mid-reach (desktop; mobile has no hover).
      el.addEventListener("mouseenter", () => clearTimeout(timer));
      el.addEventListener("mouseleave", () => { if (stack.length) restartTimer(); });
    }

    return { push, dropKey, commit };
  })();

  // ── Camp modal (events for a camp, opened from a map pin) ──
  function showCampModal(entry) {
    document.getElementById("cm-title").textContent = entry.name;
    document.getElementById("cm-meta").textContent =
      `${typeLabel(entry.type)} · ${entry.events.length} event${entry.events.length === 1 ? "" : "s"}`
      + (entry.neighbourhood ? ` · 📍 ${entry.neighbourhood}` : "");
    const list = document.getElementById("cm-events");
    list.innerHTML = "";
    if (!entry.events.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "No scheduled events.";
      list.appendChild(e);
    } else {
      const byDay = new Map();
      for (const ev of entry.events) {
        if (!byDay.has(ev.day)) byDay.set(ev.day, []);
        byDay.get(ev.day).push(ev);
      }
      for (const day of DAY_ORDER) {
        if (!byDay.has(day)) continue;
        for (const ev of byDay.get(day)) {
          const row = document.createElement("div");
          row.className = "event-row";
          const cross = ev.crossesMidnight
            ? `<span class="cross-midnight" title="Ends the next day">⁺¹</span>`
            : "";
          row.innerHTML = `<span class="day"></span><span class="time"></span><span class="title"></span>`;
          row.children[0].textContent = day;
          row.children[1].innerHTML = `${ev.startTime}–${ev.endTime}${cross}`;
          row.children[2].textContent = ev.title || "(untitled)";
          row.addEventListener("click", () => {
            hideCampModal();
            showModal({ ...ev, _entry: entry });
          });
          list.appendChild(row);
        }
      }
    }
    openDialog(document.getElementById("camp-modal"));
  }
  function hideCampModal() {
    closeDialog(document.getElementById("camp-modal"));
  }

  // ── Map view ──────────────────────────────────────────────
  const mapView = (() => {
    let root = null, canvas = null, stage = null, zoomReadout = null;
    let zoom = 1, pan = { x: 0, y: 0 };
    let panning = false, panStart = null;
    let pendingFocus = null;
    // Handle for the deferred fit() scheduled by mount(). A focus
    // request (Open-map-from-event) cancels it so the generic
    // "fit to screen" can't fire a frame later and clobber the
    // pin-centering transform.
    let mountFitRaf = null;
    // Transient "you are here" ring drawn around the pin when the map
    // is opened from an event. Lives in canvas space (glued to the
    // geographic point, independent of whether pins/labels show) and
    // fades on the first map interaction. Tracked so we can cancel its
    // auto-fade timer and remove a stale ring on the next focus.
    let focusRingEl = null;
    let focusRingTimer = null;
    // Hoisted so renderPins() can check whether a multi-touch
    // gesture is active and skip firing pin taps in that case.
    const pointers = new Map();
    let pinchStart = null;
    // Set true as soon as a 2nd finger arrives. Pins read this on
    // pointerup to refuse firing showCampModal when the touch was
    // actually the start of a pinch.
    let pinchActive = false;

    function ensureNode() {
      if (root) return root;
      root = document.createElement("div");
      root.className = "map-view";
      if (!MAP.pins || !MAP.pins.length) {
        root.innerHTML = `
        <div class="empty-state">
          No camp locations have been placed yet.<br>
          Open <code>map-annotate.html</code> to place pins, then run
          <code>node parse-map.js</code> to update <code>map-data.js</code>.
        </div>`;
        return root;
      }
      root.innerHTML = `
      <div class="stage">
        <div class="canvas"><img alt="Map"></div>
        <div class="loading-shade"><span>Loading map…</span></div>
        <div class="legend">
          <span class="swatch"><span class="dot camp"></span>Camps</span>
          <span class="swatch"><span class="dot sound_stage"></span>Stages</span>
          <span class="swatch"><span class="dot art_installation"></span>Art</span>
        </div>
        <div class="controls-overlay">
          <button data-act="out" title="Zoom out" aria-label="Zoom out">−</button>
          <span class="zoom-readout">100%</span>
          <button data-act="in" title="Zoom in" aria-label="Zoom in">+</button>
          <button data-act="fit" title="Fit to screen" aria-label="Fit to screen">⤢</button>
          <button data-act="pins" title="Hide pins" aria-label="Toggle pins" class="pins-toggle">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5"/>
            </svg>
          </button>
        </div>
      </div>`;
      stage = root.querySelector(".stage");
      canvas = root.querySelector(".canvas");
      zoomReadout = root.querySelector(".zoom-readout");
      const shade = root.querySelector(".loading-shade");

      const img = canvas.querySelector("img");
      img.addEventListener("load", () => {
        if (shade) shade.classList.add("hidden");
        // Size the canvas to the image's natural pixel dimensions so
        // the browser rasterizes the image at full source resolution.
        // Without this, mobile Safari rasterizes at CSS-pixel viewport
        // width (e.g. 393px) and transform-zoom just upscales that
        // tiny bitmap. With it, transforms scale a full-res bitmap.
        if (img.naturalWidth && img.naturalHeight) {
          canvas.style.width  = img.naturalWidth  + "px";
          canvas.style.height = img.naturalHeight + "px";
        }
        fit();
        if (pendingFocus) { focusOn(pendingFocus); pendingFocus = null; }
      });
      const sync = MapImage.syncSrc();
      if (sync) {
        img.src = sync;
      } else {
        MapImage.get().then(src => { img.src = src; });
      }

      root.querySelector('[data-act="in"]').addEventListener("click", () => setZoom(zoom * 1.3));
      root.querySelector('[data-act="out"]').addEventListener("click", () => setZoom(zoom / 1.3));
      root.querySelector('[data-act="fit"]').addEventListener("click", fit);
      const pinsBtn = root.querySelector('[data-act="pins"]');
      function syncPinsToggle() {
        root.classList.toggle("pins-hidden", mapPinsHidden);
        pinsBtn.classList.toggle("active", mapPinsHidden);
        pinsBtn.title = mapPinsHidden ? "Show pins" : "Hide pins";
        pinsBtn.setAttribute("aria-pressed", mapPinsHidden ? "true" : "false");
      }
      syncPinsToggle();
      pinsBtn.addEventListener("click", () => {
        mapPinsHidden = !mapPinsHidden;
        saveMapPinsHiddenPref(mapPinsHidden);
        syncPinsToggle();
      });

      stage.addEventListener("wheel", e => {
        e.preventDefault();
        setZoom(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      }, { passive: false });

      // Unified pointer events: handles mouse, trackpad, touch, pen.
      // For touch (mobile), we track 1 pointer = pan, 2 pointers = pinch.
      // `pointers` + `pinchStart` are declared in the outer IIFE so
      // renderPins() can see them too.
      //
      // We deliberately track pointers that start on .pin elements
      // too — otherwise a pinch with a finger on a pin would only
      // ever see one pointer in our Map and never trigger the
      // pinch path. Pins decide tap-vs-not on their own pointerup
      // using the shared `pointers` / `pinchActive` state.
      function shouldIgnoreForTracking(target) {
        return target.closest(".controls-overlay")
          || target.closest(".legend")
          || target.closest(".map-back-pill");
      }

      function cancelArmedPins() {
        if (!canvas) return;
        canvas.querySelectorAll(".pin.pin-armed").forEach(p => {
          p.classList.remove("pin-armed");
          p._tapCancelled = true;
        });
      }

      stage.addEventListener("pointerdown", e => {
        if (shouldIgnoreForTracking(e.target)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const onPin = !!e.target.closest(".pin");
        if (pointers.size === 1) {
          // Only enter pan mode if the touch started on background.
          // A touch that starts on a pin stays "ambiguous" until
          // either it moves (→ pan) or a 2nd finger arrives (→ pinch)
          // or it ends (→ tap, handled by pin's own pointerup).
          // We also skip setPointerCapture for pin-rooted touches —
          // capturing would steal the subsequent pointermove/up from
          // the pin and break tap detection.
          if (!onPin) {
            try { stage.setPointerCapture(e.pointerId); } catch (_) {}
            panning = true;
            panStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            stage.classList.add("panning");
          }
        } else if (pointers.size === 2) {
          // Pinch confirmed — capture this pointer for robust
          // tracking off the stage. The other pointer (if it
          // started on a pin) still bubbles up to us naturally.
          try { stage.setPointerCapture(e.pointerId); } catch (_) {}
          panning = false;
          pinchActive = true;
          stage.classList.remove("panning");
          cancelArmedPins();
          const pts = [...pointers.values()];
          const dx = pts[1].x - pts[0].x;
          const dy = pts[1].y - pts[0].y;
          pinchStart = {
            dist: Math.hypot(dx, dy),
            midX: (pts[0].x + pts[1].x) / 2,
            midY: (pts[0].y + pts[1].y) / 2,
            zoom,
          };
        }
      });

      stage.addEventListener("pointermove", e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2 && pinchStart) {
          const pts = [...pointers.values()];
          const dx = pts[1].x - pts[0].x;
          const dy = pts[1].y - pts[0].y;
          const dist = Math.hypot(dx, dy);
          const newZoom = pinchStart.zoom * (dist / pinchStart.dist);
          setZoom(newZoom, pinchStart.midX, pinchStart.midY);
        } else if (panning && pointers.size === 1) {
          pan.x = e.clientX - panStart.x;
          pan.y = e.clientY - panStart.y;
          applyTransform();
        }
      });

      function endPointer(e) {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStart = null;
        if (pointers.size === 0) {
          panning = false;
          pinchActive = false;
          stage.classList.remove("panning");
        } else if (pointers.size === 1) {
          // One finger lifted mid-pinch — promote remaining to pan.
          const [pt] = [...pointers.values()];
          panning = true;
          panStart = { x: pt.x - pan.x, y: pt.y - pan.y };
        }
      }
      stage.addEventListener("pointerup", endPointer);
      stage.addEventListener("pointercancel", endPointer);
      stage.addEventListener("pointerleave", endPointer);

      // Any direct interaction with the map (touch, drag, wheel)
      // dismisses the focus ring so it's never in the way once the
      // user starts exploring — panning, pinching, toggling pins, etc.
      stage.addEventListener("pointerdown", dismissFocusRing);
      stage.addEventListener("wheel", dismissFocusRing, { passive: true });

      renderPins();
      return root;
    }

    function renderPins() {
      if (!canvas) return;
      canvas.querySelectorAll(".pin").forEach(n => n.remove());
      const entriesByName = new Map(DATA.entries.map(e => [e.name, e]));
      // Tap-vs-gesture discrimination — pins are passive observers.
      // The stage owns pointer tracking (so pinch always sees both
      // fingers, even when one lands on a pin). On pointerup the pin
      // decides "this was a tap" iff:
      //   - same pointer id we armed with
      //   - movement stayed within TAP_MOVE_TOL
      //   - no 2nd finger ever joined (pinchActive is false)
      //   - all other pointers are released
      const TAP_MOVE_TOL = 8;
      for (const pin of MAP.pins) {
        const entry = entriesByName.get(pin.name);
        const dim = entry && !entryMatchesFilters(entry);
        const el = document.createElement("div");
        el.className = "pin " + pin.type + (dim ? " dim" : "");
        el.style.left = (pin.x * 100) + "%";
        el.style.top = (pin.y * 100) + "%";
        el.title = pin.name + (entry ? ` (${entry.events.length} events)` : "");

        let armedPointerId = null;
        let startPt = null;

        el.addEventListener("pointerdown", e => {
          // Do NOT stopPropagation — the stage needs to track this
          // pointer too so pinch detection works.
          if (armedPointerId !== null) return; // already tracking a finger on this pin
          armedPointerId = e.pointerId;
          startPt = { x: e.clientX, y: e.clientY };
          el._tapCancelled = false;
          el.classList.add("pin-armed");
        });

        el.addEventListener("pointermove", e => {
          if (e.pointerId !== armedPointerId || el._tapCancelled) return;
          const dx = e.clientX - startPt.x;
          const dy = e.clientY - startPt.y;
          if (Math.hypot(dx, dy) > TAP_MOVE_TOL) {
            el._tapCancelled = true;
            el.classList.remove("pin-armed");
          }
        });

        el.addEventListener("pointerup", e => {
          if (e.pointerId !== armedPointerId) return;
          const cancelled = el._tapCancelled;
          el.classList.remove("pin-armed");
          armedPointerId = null;
          startPt = null;
          // After our pointer comes up the stage will also remove it
          // from `pointers`. We fire the tap only if no pinch was
          // ever active and no other fingers remain down.
          const otherPointersDown = pointers
            ? Array.from(pointers.keys()).some(id => id !== e.pointerId)
            : false;
          if (!cancelled && !pinchActive && !otherPointersDown && entry) {
            showCampModal(entry);
          }
        });

        const cancel = () => {
          el._tapCancelled = true;
          el.classList.remove("pin-armed");
          armedPointerId = null;
          startPt = null;
        };
        el.addEventListener("pointercancel", cancel);
        canvas.appendChild(el);
      }
    }

    function applyTransform() {
      if (!canvas) return;
      // Canvas is sized to the image's natural pixel dimensions, so
      // we need a "base scale" (stage-width / canvas-width) to bring
      // it down to fit the stage at logical zoom=1. `zoom` keeps its
      // existing semantics: zoom=1 means "image fits stage width".
      const img = canvas.querySelector("img");
      const stageRect = stage && stage.getBoundingClientRect();
      const baseScale = (img && img.naturalWidth && stageRect && stageRect.width)
        ? stageRect.width / img.naturalWidth
        : 1;
      const scale = baseScale * zoom;
      canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
      // Inverse-scale pins (clamped) so they don't blanket the art
      // at high zoom — at zoom 1 pins are 14px, at zoom 4 they're ~7px.
      // The 1/baseScale factor compensates for the canvas being natural-
      // size: at zoom=1 a raw 14px pin would render at 14*baseScale (tiny);
      // multiplying by 1/baseScale brings it back to ~14 screen pixels.
      const pinDamp = Math.max(0.35, Math.min(1, 1 / Math.sqrt(zoom)));
      const pinScale = pinDamp / baseScale;
      canvas.style.setProperty("--pin-scale", pinScale.toFixed(3));
      if (zoomReadout) zoomReadout.textContent = Math.round(zoom * 100) + "%";
    }

    function setZoom(z, clientX, clientY) {
      z = Math.max(0.3, Math.min(9, z));
      const rect = stage.getBoundingClientRect();
      const ax = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const ay = (clientY ?? rect.top + rect.height / 2) - rect.top;
      const imgX = (ax - pan.x) / zoom;
      const imgY = (ay - pan.y) / zoom;
      zoom = z;
      pan.x = ax - imgX * zoom;
      pan.y = ay - imgY * zoom;
      applyTransform();
    }

    function fit() {
      // In fullscreen mode (or any time the stage is much taller than
      // wide-aspect map at zoom 1), zoom to fill the smaller dimension
      // so the map uses the whole viewport. Centers the result.
      const img = canvas && canvas.querySelector("img");
      const rect = stage && stage.getBoundingClientRect();
      if (img && rect && img.naturalWidth && img.naturalHeight && rect.width && rect.height) {
        const imgAR = img.naturalWidth / img.naturalHeight;
        const stageAR = rect.width / rect.height;
        // At zoom=1, image renders at rect.width × (rect.width / imgAR).
        // Scale that to fill rect height (cover) or fit fully (contain).
        // We use cover so the map fills the screen — pan to explore.
        const naturalHeightAtZoom1 = rect.width / imgAR;
        zoom = stageAR < imgAR
          ? rect.height / naturalHeightAtZoom1   // portrait stage: scale up to fill height
          : 1;                                    // landscape/wide enough: width already fills
        const scaledW = rect.width * zoom;
        const scaledH = naturalHeightAtZoom1 * zoom;
        pan = {
          x: (rect.width - scaledW) / 2,
          y: (rect.height - scaledH) / 2,
        };
      } else {
        zoom = 1;
        pan = { x: 0, y: 0 };
      }
      applyTransform();
    }

    function focusOn(pin) {
      const img = canvas && canvas.querySelector("img");
      // Need the loaded image's natural size to know the rendered
      // height. If the stage or image isn't ready, defer — the img
      // load handler replays pendingFocus once dimensions exist.
      if (!stage || !img || !img.naturalWidth || !img.naturalHeight) {
        pendingFocus = pin;
        return;
      }
      const rect = stage.getBoundingClientRect();
      // Open the map zoomed in tight on the pin (550%) so the camp's
      // immediate surroundings are legible. Only this Open-map-from-
      // event flow uses focusOn(); the Map tab itself opens at fit.
      zoom = 5.5;
      // applyTransform() sizes the canvas to the image's natural pixels
      // and scales by baseScale = rect.width / naturalWidth. So at
      // zoom=1 the image renders rect.width wide and (rect.width / AR)
      // tall — NOT rect.height. Centering must use that rendered
      // height, otherwise the pin lands off-center vertically whenever
      // the stage aspect ratio differs from the image's (e.g. the
      // tall fullscreen viewport).
      const renderedH = rect.width * img.naturalHeight / img.naturalWidth;
      const px = pin.x * rect.width * zoom;
      const py = pin.y * renderedH * zoom;
      // Center horizontally. Vertically, center within the band BELOW
      // the top controls/status-bar chrome — in fullscreen the stage
      // spans under the status bar, so centering on the true middle
      // leaves the pin sitting visually high. topPad pushes the target
      // down by half the occluded top strip, and auto-adapts to the
      // device safe-area inset (the controls sit at safe-area-inset-top).
      const controls = root && root.querySelector(".controls-overlay");
      const topPad = controls
        ? Math.max(0, controls.getBoundingClientRect().bottom - rect.top)
        : 0;
      pan.x = rect.width / 2 - px;
      pan.y = topPad + (rect.height - topPad) / 2 - py;
      applyTransform();
      showFocusRing(pin);
    }

    // ── Focus ring ("you are here" target) ───────────────────
    // A short-lived circle drawn around the pin we just centered on,
    // appended into canvas space so it tracks the exact geographic
    // point (works whether or not pins/labels are visible). It draws
    // itself on, breathes a couple times, then fades — either on the
    // first map interaction (see the stage listeners) or after a
    // timeout if the user just looks without touching.
    function clearFocusRing() {
      if (focusRingTimer) { clearTimeout(focusRingTimer); focusRingTimer = null; }
      if (focusRingEl) { focusRingEl.remove(); focusRingEl = null; }
    }
    function dismissFocusRing() {
      if (!focusRingEl) return;
      const el = focusRingEl;
      focusRingEl = null;
      if (focusRingTimer) { clearTimeout(focusRingTimer); focusRingTimer = null; }
      el.classList.add("is-leaving");
      // Remove after the fade. Fallback timeout covers the cases where
      // transitionend never fires (detached node, reduced-motion).
      const done = () => el.remove();
      el.addEventListener("transitionend", done, { once: true });
      setTimeout(done, 500);
    }
    function showFocusRing(pin) {
      if (!canvas) return;
      clearFocusRing();
      const ring = document.createElement("div");
      ring.className = "map-focus-ring";
      ring.style.left = (pin.x * 100) + "%";
      ring.style.top = (pin.y * 100) + "%";
      ring.innerHTML =
        '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
        + '<circle cx="50" cy="50" r="42"/></svg>';
      canvas.appendChild(ring);
      focusRingEl = ring;
      // Auto-fade if untouched (desktop "just looking") so it never
      // lingers indefinitely.
      focusRingTimer = setTimeout(dismissFocusRing, 7000);
    }

    return {
      mount(container) {
        container.appendChild(ensureNode());
        // Re-evaluate dimming on every mount (filters may have changed).
        renderPins();
        // Drop any leftover focus ring; a focusOn() in this same tick
        // (Open-map-from-event) re-adds a fresh one after this.
        clearFocusRing();
        // Stage dimensions change between regular and fullscreen
        // viewports — re-fit so the map fills whatever space we have.
        // Tracked so a focusOn() in the same tick can cancel it (see
        // below) — otherwise this fit would overwrite the pin centering.
        if (mountFitRaf) cancelAnimationFrame(mountFitRaf);
        mountFitRaf = requestAnimationFrame(() => { mountFitRaf = null; fit(); });
      },
      focusOn(pin) {
        ensureNode();
        // Opening the map centered on a specific pin: cancel mount()'s
        // pending generic fit so it can't clobber the focus a frame
        // later. focusOn() (or its deferred replay once the image
        // loads) now owns the transform.
        if (mountFitRaf) { cancelAnimationFrame(mountFitRaf); mountFitRaf = null; }
        focusOn(pin);
      },
      refreshDim: renderPins,
    };
  })();

  function renderMapView() {
    const view = document.getElementById("view");
    view.innerHTML = "";
    mapView.mount(view);
  }

  function renderStats() {
    const events = DATA.metadata.eventCount;
    const entries = DATA.metadata.entryCount;
    const updated = formatRelativeUpdated(DATA.metadata.lastReconciledAt);
    const parts = [`${events} events`, `${entries} entries`];
    if (updated) parts.push(updated);
    document.getElementById("stats").textContent = parts.join(" · ");
  }
  // Short relative time for the Settings modal stats line — must stay
  // compact ("3h ago", "2d ago") so the whole line fits on one row on
  // mobile. Falls back to a short date for anything older than a week.
  function formatRelativeUpdated(iso) {
    if (!iso) return "";
    const then = new Date(iso);
    if (isNaN(then)) return "";
    const diffMs = Date.now() - then.getTime();
    if (diffMs < 0) return "just now";
    const m = Math.floor(diffMs / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24);
    if (d < 7) return d + "d ago";
    return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // ── Filters-modal chip groups ───────────────────────────
  function renderTagChips() {
    const wrap = document.getElementById("tag-chips");
    wrap.innerHTML = "";
    if (!ALL_TAGS.length) { wrap.parentElement.style.display = "none"; return; }
    for (const t of ALL_TAGS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (state.tags.has(t) ? " active" : "");
      btn.dataset.tag = t;
      btn.textContent = t;
      btn.addEventListener("click", () => {
        if (state.tags.has(t)) state.tags.delete(t); else state.tags.add(t);
        renderFiltersModalOnly();
      });
      wrap.appendChild(btn);
    }
  }

  function renderNeighbourhoodChips() {
    const wrap = document.getElementById("neighbourhood-chips");
    const section = document.getElementById("neighbourhoods-section");
    if (!ALL_NEIGHBOURHOODS.length) { section.style.display = "none"; return; }
    section.style.display = "";
    wrap.innerHTML = "";
    for (const n of ALL_NEIGHBOURHOODS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (state.neighbourhoods.has(n) ? " active" : "");
      btn.dataset.neighbourhood = n;
      btn.textContent = n;
      btn.addEventListener("click", () => {
        if (state.neighbourhoods.has(n)) state.neighbourhoods.delete(n);
        else state.neighbourhoods.add(n);
        renderFiltersModalOnly();
      });
      wrap.appendChild(btn);
    }
  }

  function renderTypeChips() {
    for (const btn of document.querySelectorAll("#type-chips .chip[data-type]")) {
      btn.classList.toggle("active", btn.dataset.type === state.type);
    }
  }

  function renderTimeOfDayChips() {
    for (const k of Object.keys(TIME_OF_DAY)) {
      const btn = document.querySelector(`#time-of-day-chips .chip[data-tod="${k}"]`);
      if (!btn) continue;
      btn.classList.toggle("active", state.timesOfDay.has(k));
    }
  }

  function renderQuickChips() {
    for (const q of ["now", "next"]) {
      const btn = document.querySelector(`#quick-chips .chip[data-quick="${q}"]`);
      if (!btn) continue;
      btn.classList.toggle("active", state.quick.has(q));
    }
  }

  function renderDurationChips() {
    for (const k of Object.keys(DURATION_BUCKET)) {
      const btn = document.querySelector(`#duration-chips .chip[data-dur="${k}"]`);
      if (!btn) continue;
      btn.classList.toggle("active", state.durations.has(k));
    }
  }

  // ── CTA badges + active filter pill row + live result counts ──
  function renderCtaBadges() {
    const fc = activeFilterCount();
    const fb = document.getElementById("filters-badge");
    fb.hidden = fc === 0;
    fb.textContent = fc || "";
    document.getElementById("filters-open").classList.toggle("has-active", fc > 0);

    const sb = document.getElementById("search-badge");
    const hasSearch = !!state.search;
    sb.hidden = !hasSearch;
    sb.textContent = hasSearch ? "•" : "";
    document.getElementById("search-open").classList.toggle("has-active", hasSearch);

    // Header Favorites star — active when the favorites-only flag is on,
    // and tinted red in the second (reds-only) stage so the three states
    // are visually distinct.
    const favOn = state.favoritesOnly;
    const redOnly = favOn && state.favoritesRedOnly && cantMissEnabled;
    const favBtn = document.getElementById("fav-toggle");
    favBtn.classList.toggle("has-active", favOn);
    favBtn.classList.toggle("is-red-only", redOnly);
    favBtn.setAttribute("aria-pressed", favOn ? "true" : "false");
    const favLabel = favBtn.querySelector(".label");
    if (favLabel) favLabel.textContent = redOnly ? "Can’t-miss" : "Favorites";
    favBtn.setAttribute(
      "aria-label",
      !favOn
        ? "Show favorites only"
        : redOnly
          ? "Showing can’t-miss favorites only. Activate to show all events."
          : cantMissEnabled
            ? "Showing all favorites. Activate to show can’t-miss only."
            : "Showing favorites only"
    );
    // No notification-style count badge on this button — the day-tab
    // strip already shows "Friday 3" when filtered, which is enough.
  }

  function renderActiveFilters() {
    const wrap = document.getElementById("active-filters");
    wrap.innerHTML = "";
    const pills = [];
    // Favorites isn't rendered as a pill — toggling it lives on the
    // header star, and Clear all here doesn't touch it either.
    if (state.quick.size > 0) {
      const labels = { now: "Happening now", next: "Up next" };
      for (const q of state.quick) {
        pills.push({ label: labels[q] || q, clear: () => state.quick.delete(q) });
      }
    }
    if (state.timesOfDay.size > 0) {
      const labels = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", late: "Late night" };
      for (const k of state.timesOfDay) {
        pills.push({ label: labels[k] || k, clear: () => state.timesOfDay.delete(k) });
      }
    }
    if (state.durations.size > 0) {
      const labels = { short: "Up to 2h", medium: "2–6h", long: "Over 6h" };
      for (const k of state.durations) {
        pills.push({ label: labels[k] || k, clear: () => state.durations.delete(k) });
      }
    }
    if (state.type !== "all") {
      pills.push({ label: typeLabel(state.type) + "s", clear: () => { state.type = "all"; } });
    }
    for (const n of state.neighbourhoods) {
      pills.push({ label: "📍 " + n, clear: () => state.neighbourhoods.delete(n) });
    }
    for (const t of state.tags) {
      pills.push({ label: t, clear: () => state.tags.delete(t) });
    }
    if (state.search) {
      pills.push({ label: `“${state.search}”`, clear: () => {
        state.search = "";
        const si = document.getElementById("search");
        if (si) si.value = "";
      } });
    }
    if (pills.length === 0) { wrap.hidden = true; return; }
    wrap.hidden = false;
    for (const p of pills) {
      const el = document.createElement("span");
      el.className = "active-filter-pill";
    el.innerHTML = `<span></span><button type="button"></button>`;
    el.querySelector("span").textContent = p.label;
    const removeBtn = el.querySelector("button");
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `Remove filter: ${p.label}`);
    removeBtn.addEventListener("click", () => { p.clear(); renderAll(); });
      wrap.appendChild(el);
    }
    if (pills.length > 1) {
      const clearAll = document.createElement("button");
      clearAll.type = "button";
      clearAll.className = "active-filter-pill clear-all";
      clearAll.textContent = "Clear all";
      clearAll.addEventListener("click", e => {
        // Deliberately leaves state.favoritesOnly alone — favorites
        // is owned by the header star, not the filter chrome.
        state.tags.clear();
        state.neighbourhoods.clear();
        state.quick.clear();
        state.timesOfDay.clear();
        state.durations.clear();
        state.type = "all";
        state.search = "";
        const si = document.getElementById("search");
        if (si) si.value = "";
        renderAll();
        e.currentTarget.blur();
      });
      wrap.appendChild(clearAll);
    }
  }

  function renderModalResultCounts() {
    const total = totalVisibleEventCount();
    const fr = document.getElementById("filters-results");
    if (fr) {
      fr.textContent = total === 0
        ? "Done · no matches"
        : `Done · ${total} event${total === 1 ? "" : "s"}`;
    }
    const sr = document.getElementById("search-results");
    if (sr) {
      sr.textContent = total === 0
        ? "Search · no matches"
        : `Search · ${total} event${total === 1 ? "" : "s"}`;
    }
  }

  function renderAll() {
    renderTagChips();
    renderNeighbourhoodChips();
    renderQuickChips();
    renderTimeOfDayChips();
    renderDurationChips();
    renderTypeChips();
    renderActiveFilters();
    renderCtaBadges();
    renderModalResultCounts();
    renderDayTabs();
    renderStats();
    if (state.mode === "day") renderDayView();
    else if (state.mode === "camp") renderCampView();
    else if (state.mode === "map") renderMapView();
    updateNowCue();
    renderSettingsBadge();
  }

  // Run self-heal once now that ALL_EVENTS and state.favorites are
  // both available — rekeys any favorites whose stored key no
  // longer matches the current data due to upstream title/camp
  // edits (Tier 3.1 fuzzy fallback).
  selfHealFavorites();

  bindUi();
  bindHeaderAutoHide();
  bindSettings();
  renderAll();

  // First-load snap to now. Instant scroll (no smooth) so we don't
  // pan during initial paint, which fights the scroll-hide header
  // and stutters on iOS Safari. Guarded by _didInitialScroll so
  // later re-renders (filter changes etc.) don't yank the user.
  if (!state._didInitialScroll
      && state.mode === "day"
      && state.day === getToday()) {
    requestAnimationFrame(() => {
      if (scrollToNowLine({ smooth: false })) {
        state._didInitialScroll = true;
      }
    });
  }

  startLiveTick();

  // ── Refresh data when the app is resumed ─────────────────────────
  // iOS home-screen (standalone) PWAs freeze the page and resume it
  // from memory instead of doing a fresh navigation, so events.json is
  // fetched exactly once — at startup — and can sit stale for as long
  // as the session stays alive (easily many hours). When the app
  // becomes visible again, check upstream for a newer reconcile; if
  // there is one, prime the SW data cache with the fresh body and
  // reload so the next paint shows current data. Priming first is what
  // avoids the stale-while-revalidate "one step behind" that a plain
  // reload would otherwise hit (the SW would serve the old cached copy
  // and only refresh in the background).
  (function setupResumeRefresh() {
    const MIN_INTERVAL_MS = 60_000;   // throttle: at most one check / min
    const RELOAD_GUARD_KEY = "ow_resume_reload_for"; // dedupe reload target
    let lastCheck = 0;
    let checking = false;

    function nudgeServiceWorker() {
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.getRegistration()
        .then(reg => { if (reg) reg.update(); })
        .catch(() => {});
    }

    async function checkForFreshData() {
      const now = Date.now();
      if (checking || now - lastCheck < MIN_INTERVAL_MS) return;
      lastCheck = now;
      checking = true;
      nudgeServiceWorker();
      try {
        // Cache-bust the query string so this request bypasses BOTH the
        // HTTP cache and the SW's stale-while-revalidate handler (which
        // keys on the full URL incl. query) and actually hits the
        // network for a current copy.
        const resp = await fetch("./events.json?_resume=" + now, { cache: "no-store" });
        if (!resp || !resp.ok) return;
        const fresh = await resp.clone().json().catch(() => null);
        const freshAt = fresh && fresh.metadata && fresh.metadata.lastReconciledAt;
        const currentAt = DATA && DATA.metadata && DATA.metadata.lastReconciledAt;
        if (!freshAt || freshAt === currentAt) return; // nothing new

        // Guard against reload loops: if we already reloaded targeting
        // this exact timestamp (e.g. cache priming failed and the
        // startup fetch still served stale), don't bounce again.
        let alreadyTried = false;
        try { alreadyTried = sessionStorage.getItem(RELOAD_GUARD_KEY) === freshAt; } catch {}
        if (alreadyTried) return;

        // Prime the canonical /events.json entry in the SW data cache so
        // the reload's startup fetch serves the fresh body immediately.
        // Coupled to sw.js's DATA_CACHE name on purpose — keep in sync.
        try {
          if (window.caches) {
            const cache = await caches.open("otherworld-data");
            await cache.put("/events.json", resp.clone());
          }
        } catch {}

        try { sessionStorage.setItem(RELOAD_GUARD_KEY, freshAt); } catch {}
        location.reload();
      } catch {
        // Offline or upstream hiccup — leave the current data in place.
      } finally {
        checking = false;
      }
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForFreshData();
    });
    // pageshow with persisted=true fires on bfcache restore, a common
    // iOS resume path that doesn't always emit visibilitychange.
    window.addEventListener("pageshow", e => {
      if (e.persisted) checkForFreshData();
    });
  })();
})();
