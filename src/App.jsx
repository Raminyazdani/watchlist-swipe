import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { storage } from "./storage";

/* ------------------------------------------------------------------ */
/*  داده‌ی اولیه: لیست تمیزشده و بدون تکرار                            */
/*  k: نوع (movie / series / anime / game) — فقط جایی که مطمئن بودم    */
/* ------------------------------------------------------------------ */
const RAW = [
  { t: "Example Movie", k: "movie" },
  { t: "Example Series", k: "series" },
  { t: "Example Game", k: "game" },
];

/* ------------------------------------------------------------------ */
/*  توکن‌های طراحی                                                     */
/* ------------------------------------------------------------------ */
const C = {
  ink: "#0E121B",
  ink2: "#161C29",
  line: "#2A3346",
  paper: "#F3EEE2",
  paperEdge: "#DCD3C0",
  amber: "#E3A72C",
  teal: "#3FA79E",
  violet: "#8C7BC4",
  rust: "#C6503C",
  rose: "#D4708F",
  dim: "#7E8AA3",
};

const BUCKETS = {
  seen:    { fa: "دیدم",            color: C.amber,  dir: "راست" },
  wish:    { fa: "می‌خوام ببینم",   color: C.rose,   dir: "بالا" },
  want:    { fa: "ندیدم",           color: C.teal,   dir: "چپ" },
  unsure:  { fa: "نمی‌دونم",        color: C.violet, dir: "دکمه" },
  removed: { fa: "حذف",             color: C.rust,   dir: "پایین" },
};
const ORDER = ["seen", "wish", "want", "unsure", "removed"];
const KIND_FA = { movie: "فیلم", series: "سریال", anime: "انیمه", game: "بازی" };

const STORE_KEY = "watchlist:v1";
const POSTER_KEY = "watchlist:posters:v1";
const EDITS_KEY = "watchlist:edits:v1";
const APIKEY_KEY = "watchlist:tmdbkey:v1";

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";
const IMG_S = "https://image.tmdb.org/t/p/w92";
/* کلید TMDB. هر وقت خواستی از پنل «پوسترها» عوضش کن. */
const DEFAULT_TMDB_KEY =
  import.meta.env.VITE_TMDB_KEY || "";

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, "-").replace(/^-|-$/g, "");
const fa = (n) => String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);

const ITEMS = RAW.map((r, i) => ({ ...r, id: slug(r.t) || `item-${i}` }));

/* ------------------------------------------------------------------ */
/*  TMDB                                                               */
/* ------------------------------------------------------------------ */
const cleanQuery = (t) =>
  t.replace(/\(.*?\)/g, " ").replace(/[*#]/g, "").replace(/\s+/g, " ").trim();

/** چند نامزد اول جست‌وجو — برای وقتی که تطبیق اشتباه است */
async function tmdbSearch(item, key) {
  const q = cleanQuery(item.t);
  if (!q) return [];
  const type =
    item.k === "series" || item.k === "anime" ? "tv" : item.k === "movie" ? "movie" : "multi";
  const url =
    `${TMDB}/search/${type}?api_key=${encodeURIComponent(key)}` +
    `&language=en-US&include_adult=true&query=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("TMDB " + res.status);
  const data = await res.json();
  return (data.results || [])
    .filter((r) => r.media_type !== "person")
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      mt: r.media_type === "tv" || r.media_type === "movie" ? r.media_type : type === "multi" ? "movie" : type,
      t: r.title || r.name || "",
      y: (r.release_date || r.first_air_date || "").slice(0, 4) || null,
      p: r.poster_path || null,
    }));
}

/** اطلاعات کامل یک رکورد TMDB */
async function tmdbDetails(id, mt, key) {
  const res = await fetch(`${TMDB}/${mt}/${id}?api_key=${encodeURIComponent(key)}&language=en-US`);
  if (!res.ok) throw new Error("TMDB " + res.status);
  const d = await res.json();
  return {
    id: d.id,
    mt,
    p: d.poster_path || null,
    t: d.title || d.name || null,
    ot: d.original_title || d.original_name || null,
    y: (d.release_date || d.first_air_date || "").slice(0, 4) || null,
    v: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    vc: d.vote_count || null,
    pop: d.popularity ? Math.round(d.popularity) : null,
    g: (d.genres || []).map((x) => x.name).slice(0, 4),
    rt: d.runtime || (d.episode_run_time || [])[0] || null,
    sn: d.number_of_seasons || null,
    ep: d.number_of_episodes || null,
    st: d.status || null,
    lang: d.original_language || null,
    ov: (d.overview || "").slice(0, 700) || null,
  };
}

async function fetchMeta(item, key) {
  const alts = await tmdbSearch(item, key);
  if (!alts.length) return { none: 1, alts: [] };
  const det = await tmdbDetails(alts[0].id, alts[0].mt, key);
  return { ...det, alts };
}

/* ------------------------------------------------------------------ */

export default function WatchlistSwipe() {
  const [decisions, setDecisions] = useState({});
  const [edits, setEdits] = useState({});
  const [meta, setMeta] = useState({});
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState("loading");
  const [view, setView] = useState("swipe");
  const [tab, setTab] = useState("seen");
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [flying, setFlying] = useState(null);
  const [toast, setToast] = useState("");
  const [apiKey, setApiKey] = useState(DEFAULT_TMDB_KEY);
  const [keyDraft, setKeyDraft] = useState(DEFAULT_TMDB_KEY);
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [posterErr, setPosterErr] = useState("");
  const [bulk, setBulk] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [showAlts, setShowAlts] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false); // فقط موبایل
  const [busy, setBusy] = useState(false);

  const start = useRef(null);
  const touched = useRef({});
  const fetching = useRef(new Set());
  const bulkStop = useRef(false);

  /* --- بارگذاری --- */
  useEffect(() => {
    let alive = true;
    (async () => {
      const load = async (k) => {
        try {
          const r = await storage.get(k);
          return r ? JSON.parse(r.value) : null;
        } catch {
          return null;
        }
      };
      const [s, m, e] = await Promise.all([load(STORE_KEY), load(POSTER_KEY), load(EDITS_KEY)]);
      if (!alive) return;
      if (s?.decisions) setDecisions(s.decisions);
      if (m) setMeta(m);
      if (e) setEdits(e);
      try {
        const r = await storage.get(APIKEY_KEY);
        if (alive && r?.value) { setApiKey(r.value); setKeyDraft(r.value); }
      } catch { /* کلیدی ذخیره نشده */ }
      if (alive) setStatus("ready");
    })();
    return () => { alive = false; };
  }, []);

  /* --- ذخیره --- */
  const persist = (key, value, flag) => {
    if (status === "loading" || !touched.current[flag]) return;
    storage.set(key, JSON.stringify(value)).catch(() => setStatus("offline"));
  };
  useEffect(() => {
    const id = setTimeout(() => persist(STORE_KEY, { decisions, at: Date.now() }, "d"), 350);
    return () => clearTimeout(id);
  }, [decisions, status]);
  useEffect(() => {
    const id = setTimeout(() => persist(EDITS_KEY, edits, "e"), 350);
    return () => clearTimeout(id);
  }, [edits, status]);
  useEffect(() => {
    if (!Object.keys(meta).length) return;
    const id = setTimeout(() => {
      storage.set(POSTER_KEY, JSON.stringify(meta)).catch(() => {});
    }, 800);
    return () => clearTimeout(id);
  }, [meta]);

  /* --- آیتم‌ها با اعمال ویرایش‌های کاربر --- */
  const items = useMemo(
    () => ITEMS.map((it) => (edits[it.id] ? { ...it, ...edits[it.id] } : it)),
    [edits]
  );
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const queue = useMemo(() => items.filter((it) => !decisions[it.id]), [items, decisions]);
  const current = queue[0];
  const next = queue[1];
  const decided = items.length - queue.length;
  const focus = (focusId && byId[focusId]) || current;

  const counts = useMemo(() => {
    const c = { seen: 0, wish: 0, want: 0, unsure: 0, removed: 0 };
    Object.values(decisions).forEach((v) => { if (c[v] != null) c[v]++; });
    return c;
  }, [decisions]);

  /* --- فرم ویرایش با تغییر رکورد فعال هم‌گام می‌شود --- */
  useEffect(() => {
    if (!focus) { setDraft(null); return; }
    setDraft({ t: focus.t, k: focus.k || "", note: focus.note || "" });
    setShowAlts(false);
  }, [focus?.id]);

  /* --- گرفتن اطلاعات سه کارت بعدی --- */
  useEffect(() => {
    if (!apiKey || bulk) return;
    let alive = true;
    (async () => {
      for (const it of queue.slice(0, 3)) {
        if (!alive) return;
        if (meta[it.id] || fetching.current.has(it.id)) continue;
        fetching.current.add(it.id);
        try {
          const r = await fetchMeta(it, apiKey);
          if (!alive) return;
          setMeta((p) => ({ ...p, [it.id]: r }));
          setPosterErr("");
        } catch (e) {
          if (!alive) return;
          setPosterErr(
            String(e.message).includes("401")
              ? "کلید TMDB پذیرفته نشد."
              : "اطلاعات TMDB لود نشد — احتمالاً دسترسی شبکه بسته است."
          );
          fetching.current.delete(it.id);
          return;
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    return () => { alive = false; };
  }, [queue, apiKey, meta, bulk]);

  /* --- گرفتن اطلاعات همه‌ی عنوان‌ها --- */
  const prefetchAll = async () => {
    if (bulk) { bulkStop.current = true; return; }
    if (!apiKey.trim()) {
      setPosterErr("برای دریافت پوسترها ابتدا کلید TMDB خودت را وارد کن.");
      setShowKeyPanel(true);
      return;
    }
    const missing = items.filter((it) => !meta[it.id]);
    if (!missing.length) { setPosterErr(""); return; }
    bulkStop.current = false;
    setPosterErr("");
    setBulk({ done: 0, total: missing.length });
    const acc = {};
    for (let i = 0; i < missing.length; i++) {
      if (bulkStop.current) break;
      try {
        acc[missing[i].id] = await fetchMeta(missing[i], apiKey);
      } catch (e) {
        setPosterErr("متوقف شد: " + e.message);
        break;
      }
      if (i % 10 === 9) setMeta((p) => ({ ...p, ...acc }));
      setBulk({ done: i + 1, total: missing.length });
      await new Promise((r) => setTimeout(r, 90));
    }
    setMeta((p) => ({ ...p, ...acc }));
    setBulk(null);
  };

  const saveKey = async () => {
    const k = keyDraft.trim();
    setApiKey(k);
    setShowKeyPanel(false);
    setPosterErr("");
    try { await storage.set(APIKEY_KEY, k); } catch { /* ذخیره نشد */ }
  };

  /* --- ویرایش رکورد --- */
  const saveDraft = async ({ refetch } = {}) => {
    if (!focus || !draft) return;
    const id = focus.id;
    const clean = {
      t: draft.t.trim() || focus.t,
      k: draft.k || undefined,
      note: draft.note.trim() || undefined,
    };
    const titleChanged = clean.t !== focus.t || clean.k !== focus.k;
    touched.current.e = 1;
    setEdits((e) => ({ ...e, [id]: clean }));
    setToast("ذخیره شد");
    setTimeout(() => setToast(""), 1600);
    if (titleChanged || refetch) {
      setMeta((m) => { const n = { ...m }; delete n[id]; return n; });
      fetching.current.delete(id);
      if (apiKey) {
        setBusy(true);
        try {
          const r = await fetchMeta({ ...focus, ...clean }, apiKey);
          setMeta((m) => ({ ...m, [id]: r }));
          setPosterErr("");
        } catch (e) {
          setPosterErr("TMDB جواب نداد: " + e.message);
        }
        setBusy(false);
      }
    }
  };

  /** انتخاب دستی یکی از نتایج دیگر TMDB */
  const pickAlt = async (alt) => {
    if (!focus || !apiKey) return;
    setBusy(true);
    try {
      const det = await tmdbDetails(alt.id, alt.mt, apiKey);
      setMeta((m) => ({ ...m, [focus.id]: { ...det, alts: m[focus.id]?.alts || [] } }));
      setShowAlts(false);
      setPosterErr("");
    } catch (e) {
      setPosterErr("TMDB جواب نداد: " + e.message);
    }
    setBusy(false);
  };

  /* --- تصمیم‌ها --- */
  const commit = useCallback((bucket) => {
    if (!current) return;
    touched.current.d = 1;
    setFlying(bucket);
    const id = current.id;
    setTimeout(() => {
      setDecisions((d) => ({ ...d, [id]: bucket }));
      setHistory((h) => [...h, { id }].slice(-100));
      setFlying(null);
      setFocusId(null);
      setDrag({ x: 0, y: 0, active: false });
    }, 200);
  }, [current]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      touched.current.d = 1;
      setDecisions((d) => { const n = { ...d }; delete n[last.id]; return n; });
      return h.slice(0, -1);
    });
  }, []);

  const move = (id, bucket) => {
    touched.current.d = 1;
    setDecisions((d) => {
      const n = { ...d };
      if (bucket) n[id] = bucket; else delete n[id];
      return n;
    });
  };

  /* --- کیبورد --- */
  useEffect(() => {
    const h = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (view !== "swipe") return;
      const map = { ArrowRight: "seen", ArrowLeft: "want", ArrowUp: "wish", ArrowDown: "removed" };
      if (map[e.key]) { e.preventDefault(); commit(map[e.key]); }
      if (e.key === "?" || e.key === " ") { e.preventDefault(); commit("unsure"); }
      if (e.key === "Backspace") { e.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [commit, undo, view]);

  /* --- درگ --- */
  const onDown = (e) => {
    if (flying) return;
    start.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ x: 0, y: 0, active: true });
  };
  const onMove = (e) => {
    if (!start.current) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, active: true });
  };
  const onUp = () => {
    if (!start.current) return;
    const { x, y } = drag;
    start.current = null;
    const horiz = Math.abs(x) > Math.abs(y);
    if (horiz && Math.abs(x) > 90) commit(x > 0 ? "seen" : "want");
    else if (!horiz && Math.abs(y) > 95) commit(y < 0 ? "wish" : "removed");
    else setDrag({ x: 0, y: 0, active: false });
  };

  const stamp = (() => {
    if (flying) return { b: flying, o: 1 };
    const { x, y } = drag;
    if (Math.abs(x) > Math.abs(y)) {
      if (Math.abs(x) > 25) return { b: x > 0 ? "seen" : "want", o: Math.min(1, Math.abs(x) / 90) };
    } else if (Math.abs(y) > 25) {
      return { b: y < 0 ? "wish" : "removed", o: Math.min(1, Math.abs(y) / 95) };
    }
    return null;
  })();

  const flyTransform = flying
    ? { seen: "translate(520px,-40px) rotate(18deg)", want: "translate(-520px,-40px) rotate(-18deg)",
        wish: "translate(0,-700px)", unsure: "scale(.7)", removed: "translate(0,700px)" }[flying]
    : null;

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(label + " کپی شد");
    } catch {
      setToast("کپی نشد — متن را دستی انتخاب کن");
    }
    setTimeout(() => setToast(""), 2200);
  };

  const listOf = (b) => items.filter((it) => decisions[it.id] === b);
  const undecided = items.filter((it) => !decisions[it.id]);

  /* ---------------------------------------------------------------- */
  return (
    <div dir="rtl" className="w-full min-h-screen flex flex-col items-center"
      style={{ background: C.ink, color: C.paper,
        fontFamily: "'Vazirmatn', 'Tahoma', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;900&family=Instrument+Serif:ital@0;1&display=swap');
        *{box-sizing:border-box}
        .lat{font-family:'Instrument Serif',Georgia,serif}
        button:focus-visible{outline:2px solid ${C.amber};outline-offset:2px}
        @media (prefers-reduced-motion: reduce){.anim{transition:none !important}}
        .noscroll{overscroll-behavior:contain;touch-action:none}
        .thin::-webkit-scrollbar{width:6px}
        .thin::-webkit-scrollbar-thumb{background:${C.line};border-radius:3px}
      `}</style>

      <div className="pointer-events-none absolute top-0 w-full h-64"
        style={{ background: `radial-gradient(60% 100% at 50% 0%, ${C.amber}22, transparent 70%)` }} />

      {/* هدر */}
      <header className="w-full max-w-5xl px-5 pt-5 z-10">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-black tracking-tight">لیست تماشا</h1>
          <span className="text-xs" style={{ color: C.dim }}>
            {fa(decided)} از {fa(items.length)}
          </span>
        </div>
        <div className="mt-2 h-1 w-full rounded-full overflow-hidden" style={{ background: C.line }}>
          <div className="h-full anim" style={{ width: `${(decided / items.length) * 100}%`,
            background: C.amber, transition: "width .3s ease" }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {ORDER.map((b) => (
            <span key={b} className="px-2 py-1 rounded"
              style={{ background: C.ink2, color: BUCKETS[b].color, border: `1px solid ${C.line}` }}>
              {BUCKETS[b].fa} {fa(counts[b])}
            </span>
          ))}
          <button onClick={() => setShowKeyPanel((s) => !s)}
            className="mr-auto px-2 py-1 rounded font-medium"
            style={{ background: C.ink2, border: `1px solid ${C.line}`, color: apiKey ? C.amber : C.dim }}>
            TMDB
          </button>
          <button onClick={() => setPanelOpen((s) => !s)}
            className="lg:hidden px-2 py-1 rounded font-medium"
            style={{ background: C.ink2, border: `1px solid ${C.line}`, color: C.paper }}>
            {panelOpen ? "بستن جزئیات" : "جزئیات"}
          </button>
          <button onClick={() => { setView(view === "swipe" ? "lists" : "swipe"); setFocusId(null); }}
            className="px-2 py-1 rounded font-medium"
            style={{ background: C.ink2, border: `1px solid ${C.line}`, color: C.paper }}>
            {view === "swipe" ? "لیست‌ها" : "برگرد به سوایپ"}
          </button>
        </div>

        {showKeyPanel && (
          <div className="mt-3 rounded p-3 text-[11px] leading-6"
            style={{ background: C.ink2, border: `1px solid ${C.line}` }}>
            <p style={{ color: C.dim }}>
              برای دسته‌بندی عنوان‌ها کلید لازم نیست. برای دریافت پوستر و اطلاعات، کلید TMDB خودت را وارد کن.
              کلیدی که اینجا ذخیره می‌کنی در مرورگر یا فضای ذخیره‌سازی میزبان می‌ماند. با فعال شدن جست‌وجو، عنوان‌ها به TMDB فرستاده می‌شوند.
            </p>
            <div className="flex gap-2 mt-2">
              <input type="password" value={keyDraft} placeholder="TMDB API key"
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveKey()}
                className="flex-1 rounded px-2 py-2 text-xs"
                style={{ background: C.ink, color: C.paper, border: `1px solid ${C.line}`, direction: "ltr" }} />
              <button onClick={saveKey} className="px-3 py-2 rounded font-bold"
                style={{ background: C.amber, color: C.ink }}>ذخیره</button>
            </div>
            <button onClick={prefetchAll}
              className="mt-2 w-full px-3 py-2 rounded font-bold text-xs"
              style={{ background: bulk ? C.rust : C.ink, color: bulk ? C.paper : C.amber,
                border: `1px solid ${bulk ? C.rust : C.line}` }}>
              {bulk ? `توقف — ${fa(bulk.done)} از ${fa(bulk.total)}` : "گرفتن اطلاعات همه‌ی عنوان‌ها"}
            </button>
            {posterErr && <p className="mt-2" style={{ color: C.rust }}>{posterErr}</p>}
          </div>
        )}
        {status === "offline" && (
          <p className="mt-2 text-[11px]" style={{ color: C.rust }}>
            ذخیره‌سازی کار نکرد — تغییرها فقط تا وقتی این صفحه باز است می‌مانند.
          </p>
        )}
      </header>

      {/* بدنه: پنل جزئیات (راست) + محتوا */}
      <div className="w-full max-w-5xl flex flex-col lg:flex-row gap-5 px-5 pb-8 z-10">
        <aside className={`${panelOpen ? "block" : "hidden"} lg:block order-2 lg:order-1 lg:w-[350px] shrink-0`}>
          <DetailPanel
            item={focus} meta={focus ? meta[focus.id] : null} draft={draft} setDraft={setDraft}
            onSave={saveDraft} onRefetch={() => saveDraft({ refetch: true })}
            busy={busy} showAlts={showAlts} setShowAlts={setShowAlts} pickAlt={pickAlt}
            statusOf={focus ? decisions[focus.id] : null}
            setStatus={(b) => focus && move(focus.id, b)}
            isFocused={!!focusId}
            clearFocus={() => setFocusId(null)}
          />
        </aside>

        <main className="flex-1 order-1 lg:order-2 min-w-0">
          {view === "swipe" ? (
            <div className="w-full max-w-md mx-auto flex flex-col items-center">
              <div className="relative w-full noscroll" style={{ height: 380, marginTop: 20 }}>
                {status === "loading" && (
                  <div className="absolute inset-0 grid place-items-center text-sm" style={{ color: C.dim }}>
                    در حال باز کردن لیست…
                  </div>
                )}

                {status !== "loading" && !current && (
                  <div className="absolute inset-0 grid place-items-center text-center px-6">
                    <div>
                      <p className="text-xl font-black">همه‌ی لیست بررسی شد</p>
                      <p className="mt-2 text-sm" style={{ color: C.dim }}>
                        {ORDER.map((b) => `${BUCKETS[b].fa} ${fa(counts[b])}`).join(" · ")}
                      </p>
                      <button onClick={() => setView("lists")}
                        className="mt-4 px-4 py-2 rounded text-sm font-bold"
                        style={{ background: C.amber, color: C.ink }}>
                        لیست‌ها را ببین
                      </button>
                    </div>
                  </div>
                )}

                {next && (
                  <Card item={next} meta={meta[next.id]} index={items.length - queue.length + 2}
                    total={items.length}
                    style={{ transform: "scale(.94) translateY(14px)", opacity: .55 }} />
                )}

                {current && (
                  <Card
                    item={current} meta={meta[current.id]}
                    index={items.length - queue.length + 1} total={items.length}
                    stamp={stamp} interactive
                    onPointerDown={onDown} onPointerMove={onMove}
                    onPointerUp={onUp} onPointerCancel={onUp}
                    style={{
                      transform: flyTransform
                        ? flyTransform
                        : `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 22}deg)`,
                      opacity: flying ? 0 : 1,
                      transition: drag.active && !flying ? "none" : "transform .22s ease, opacity .22s ease",
                      cursor: drag.active ? "grabbing" : "grab",
                    }}
                  />
                )}
              </div>

              <div className="w-full grid grid-cols-5 gap-1.5 mt-6">
                {ORDER.map((b) => (
                  <button key={b} onClick={() => commit(b)} disabled={!current}
                    className="anim py-3 px-1 rounded-lg text-[12px] font-bold flex flex-col items-center gap-1 leading-tight"
                    style={{ background: C.ink2, border: `1px solid ${BUCKETS[b].color}55`,
                      color: BUCKETS[b].color, opacity: current ? 1 : .35 }}>
                    {BUCKETS[b].fa}
                    <span className="text-[10px] font-normal" style={{ color: C.dim }}>
                      {BUCKETS[b].dir}
                    </span>
                  </button>
                ))}
              </div>

              <div className="w-full flex items-center justify-between mt-3 text-xs">
                <button onClick={undo} disabled={!history.length}
                  className="px-3 py-2 rounded"
                  style={{ background: C.ink2, border: `1px solid ${C.line}`,
                    color: history.length ? C.paper : C.dim, opacity: history.length ? 1 : .5 }}>
                  برگرد به قبلی
                </button>
                <span style={{ color: C.dim }}>راست=دیدم · بالا=می‌خوام · چپ=ندیدم · پایین=حذف</span>
              </div>
            </div>
          ) : (
            <ListsView
              tab={tab} setTab={setTab} counts={counts} undecided={undecided}
              listOf={listOf} move={move} copy={copy} decisions={decisions} meta={meta}
              focusId={focusId} setFocusId={(id) => { setFocusId(id); setPanelOpen(true); }}
              reset={() => {
                if (window.confirm("همه‌ی انتخاب‌ها پاک شود؟ (ویرایش‌های عنوان‌ها می‌ماند)")) {
                  touched.current.d = 1; setDecisions({}); setHistory([]);
                }
              }}
            />
          )}
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded text-xs font-medium z-20"
          style={{ background: C.paper, color: C.ink }}>
          {toast}
        </div>
      )}
    </div>
  );
}

/* --------------------------- پنل جزئیات --------------------------- */
function Row({ label, children }) {
  return (
    <div className="flex gap-2 py-2 text-[11px]" style={{ borderBottom: `1px solid ${C.line}` }}>
      <span className="w-20 shrink-0" style={{ color: C.dim }}>{label}</span>
      <span className="flex-1 min-w-0 break-words">{children}</span>
    </div>
  );
}

function DetailPanel({ item, meta, draft, setDraft, onSave, onRefetch, busy,
                       showAlts, setShowAlts, pickAlt, statusOf, setStatus, isFocused, clearFocus }) {
  if (!item || !draft) {
    return (
      <div className="rounded p-4 text-xs mt-5" style={{ background: C.ink2, border: `1px solid ${C.line}`, color: C.dim }}>
        رکوردی برای نمایش نیست.
      </div>
    );
  }
  const inp = {
    background: C.ink, color: C.paper, border: `1px solid ${C.line}`,
    borderRadius: 4, padding: "6px 8px", width: "100%", fontSize: 12,
    fontFamily: "inherit",
  };
  const btn = (bg, fg) => ({ background: bg, color: fg, borderRadius: 4, padding: "7px 10px",
    fontSize: 11, fontWeight: 700, border: `1px solid ${C.line}` });

  return (
    <div className="rounded mt-5 p-4 thin" style={{ background: C.ink2, border: `1px solid ${C.line}`,
      maxHeight: "calc(100vh - 160px)", overflowY: "auto" }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-black">اطلاعات رکورد</h2>
        {isFocused && (
          <button onClick={clearFocus} className="text-[10px]" style={{ color: C.dim }}>
            برگرد به کارت فعلی
          </button>
        )}
      </div>

      {meta?.p && (
        <img src={IMG_S + meta.p} alt="" className="rounded mb-3"
          style={{ width: 70, boxShadow: `0 6px 16px -6px #000` }} />
      )}

      {/* --- فیلدهای قابل ویرایش --- */}
      <label className="block text-[10px] mb-1" style={{ color: C.dim }}>عنوان</label>
      <input value={draft.t} onChange={(e) => setDraft({ ...draft, t: e.target.value })}
        style={{ ...inp, direction: /[\u0600-\u06FF]/.test(draft.t) ? "rtl" : "ltr" }} />

      <div className="flex gap-2 mt-2">
        <div className="flex-1">
          <label className="block text-[10px] mb-1" style={{ color: C.dim }}>نوع</label>
          <select value={draft.k} onChange={(e) => setDraft({ ...draft, k: e.target.value })} style={inp}>
            <option value="">—</option>
            {Object.entries(KIND_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-[10px] mb-1" style={{ color: C.dim }}>وضعیت</label>
          <select value={statusOf || ""} onChange={(e) => setStatus(e.target.value || null)} style={inp}>
            <option value="">بررسی‌نشده</option>
            {ORDER.map((b) => <option key={b} value={b}>{BUCKETS[b].fa}</option>)}
          </select>
        </div>
      </div>

      <label className="block text-[10px] mt-2 mb-1" style={{ color: C.dim }}>یادداشت</label>
      <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} style={inp} />

      <div className="flex gap-2 mt-3">
        <button onClick={() => onSave()} style={btn(C.amber, C.ink)}>ذخیره</button>
        <button onClick={onRefetch} disabled={busy} style={btn(C.ink, C.paper)}>
          {busy ? "…" : "جست‌وجوی دوباره"}
        </button>
        {meta?.alts?.length > 1 && (
          <button onClick={() => setShowAlts(!showAlts)} style={btn(C.ink, C.dim)}>
            نتایج دیگر
          </button>
        )}
      </div>

      {showAlts && (
        <div className="mt-3 space-y-1">
          {(meta.alts || []).map((a) => (
            <button key={`${a.mt}-${a.id}`} onClick={() => pickAlt(a)}
              className="w-full flex items-center gap-2 p-1 rounded text-right"
              style={{ background: C.ink, border: `1px solid ${C.line}` }}>
              {a.p
                ? <img src={IMG_S + a.p} alt="" style={{ width: 28, borderRadius: 2 }} />
                : <span style={{ width: 28 }} />}
              <span className="text-[11px] flex-1" style={{ direction: "ltr", textAlign: "left" }}>
                {a.t} {a.y ? `(${a.y})` : ""}
              </span>
              <span className="text-[10px]" style={{ color: C.dim }}>
                {a.mt === "tv" ? "سریال" : "فیلم"}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* --- اطلاعات TMDB --- */}
      <h3 className="text-[10px] font-black mt-4 mb-1" style={{ color: C.dim }}>TMDB</h3>
      {!meta && <p className="text-[11px]" style={{ color: C.dim }}>هنوز گرفته نشده.</p>}
      {meta?.none === 1 && (
        <p className="text-[11px]" style={{ color: C.rust }}>
          چیزی پیدا نشد — عنوان را اصلاح کن و «جست‌وجوی دوباره» بزن.
        </p>
      )}
      {meta && !meta.none && (
        <div>
          <Row label="عنوان">{meta.t || "—"}</Row>
          {meta.ot && meta.ot !== meta.t && <Row label="عنوان اصلی">{meta.ot}</Row>}
          <Row label="سال">{meta.y ? fa(meta.y) : "—"}</Row>
          <Row label="نوع">{meta.mt === "tv" ? "سریال" : "فیلم"}</Row>
          <Row label="امتیاز">
            {meta.v ? `★ ${fa(meta.v)}` : "—"}
            {meta.vc ? <span style={{ color: C.dim }}> ({fa(meta.vc)} رأی)</span> : null}
          </Row>
          <Row label="ژانر">{meta.g?.length ? meta.g.join("، ") : "—"}</Row>
          {meta.mt === "tv"
            ? <Row label="فصل‌ها">
                {meta.sn ? `${fa(meta.sn)} فصل` : "—"}
                {meta.ep ? ` · ${fa(meta.ep)} قسمت` : ""}
              </Row>
            : <Row label="مدت">{meta.rt ? `${fa(meta.rt)} دقیقه` : "—"}</Row>}
          <Row label="وضعیت">{meta.st || "—"}</Row>
          <Row label="زبان">{meta.lang ? meta.lang.toUpperCase() : "—"}</Row>
          <Row label="محبوبیت">{meta.pop ? fa(meta.pop) : "—"}</Row>
          {meta.ov && (
            <div className="py-2 text-[11px] leading-6">
              <span className="block mb-1" style={{ color: C.dim }}>خلاصه</span>
              <span style={{ direction: "ltr", display: "block", textAlign: "left" }}>{meta.ov}</span>
            </div>
          )}
          {meta.id && (
            <a href={`https://www.themoviedb.org/${meta.mt}/${meta.id}`} target="_blank" rel="noreferrer"
              className="text-[11px] underline" style={{ color: C.amber }}>
              صفحه‌ی TMDB
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- کارت ------------------------------- */
function Card({ item, meta, index, total, stamp, style, interactive, ...handlers }) {
  const isFa = /[\u0600-\u06FF]/.test(item.t);
  const [broken, setBroken] = useState(false);
  const art = meta?.p && !broken;

  return (
    <article
      {...(interactive ? handlers : {})}
      className="absolute inset-0 rounded-md select-none flex flex-col overflow-hidden"
      style={{
        background: art ? C.ink2 : C.paper,
        color: art ? C.paper : C.ink,
        boxShadow: `0 18px 40px -12px #000A, inset 0 0 0 1px ${art ? C.line : C.paperEdge}`,
        padding: art ? 0 : "22px 22px 18px",
        touchAction: "none", ...style,
      }}>

      {art && (
        <>
          <img src={IMG + meta.p} alt="" draggable="false" onError={() => setBroken(true)}
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: "cover", pointerEvents: "none" }} />
          <div className="absolute inset-0"
            style={{ background: `linear-gradient(to top, ${C.ink}F2 0%, ${C.ink}99 32%, transparent 62%)` }} />
        </>
      )}

      <div className={art ? "relative z-10 flex-1 flex flex-col p-5" : "flex-1 flex flex-col"}>
        <div className="flex items-center justify-between text-[11px]"
          style={{ color: art ? "#C9D0DE" : "#8B8474" }}>
          <span>{fa(index)} / {fa(total)}</span>
          <span>
            {item.k ? KIND_FA[item.k] : meta?.mt === "tv" ? "سریال" : meta?.mt ? "فیلم" : "—"}
            {meta?.y ? ` · ${fa(meta.y)}` : ""}
            {meta?.v ? ` · ★ ${fa(meta.v)}` : ""}
          </span>
        </div>
        {!art && <div className="h-px w-full mt-3" style={{ background: C.paperEdge }} />}

        <div className={art ? "flex-1 flex items-end" : "flex-1 flex items-center"}>
          <h2 className={isFa ? "font-black" : "lat"}
            style={{
              fontSize: item.t.length > 26 ? 32 : 42, lineHeight: 1.08,
              letterSpacing: isFa ? "-.02em" : "0",
              direction: isFa ? "rtl" : "ltr", textAlign: isFa ? "right" : "left",
              width: "100%", textShadow: art ? "0 2px 18px #000C" : "none",
            }}>
            {item.t}
          </h2>
        </div>

        {art && meta?.g?.length > 0 && (
          <p className="text-[11px] mb-1" style={{ color: "#C9D0DE", direction: "ltr", textAlign: "left" }}>
            {meta.g.join(" · ")}
          </p>
        )}

        {!art && <div className="h-px w-full mb-3" style={{ background: C.paperEdge }} />}
        <div className="flex items-start gap-2">
          {item.add === 1 && (
            <span className="text-[10px] px-2 py-1 rounded whitespace-nowrap font-bold"
              style={{ background: art ? "#00000066" : "#00000010",
                color: art ? C.rose : "#A2607A", border: `1px solid ${C.rose}66` }}>
              پیشنهاد من
            </span>
          )}
          <p className="text-[11px] leading-5" style={{ color: art ? "#C9D0DE" : "#8B8474" }}>
            {item.note || "دیدیش یا نه؟"}
          </p>
        </div>
      </div>

      {stamp && (
        <div className="absolute top-14 left-6 pointer-events-none z-20"
          style={{ opacity: stamp.o, transform: "rotate(-13deg)" }}>
          <span className="block px-4 py-2 text-2xl font-black rounded"
            style={{ color: BUCKETS[stamp.b].color,
              border: `4px solid ${BUCKETS[stamp.b].color}`, letterSpacing: ".08em" }}>
            {BUCKETS[stamp.b].fa}
          </span>
        </div>
      )}
    </article>
  );
}

/* ------------------------------ لیست‌ها ----------------------------- */
function ListsView({ tab, setTab, counts, undecided, listOf, move, copy, decisions, meta,
                     focusId, setFocusId, reset }) {
  const tabs = [...ORDER, "todo"];
  const rows = tab === "todo" ? undecided : listOf(tab);

  const asText = rows.map((r) => r.t).join("\n");
  const asJson = JSON.stringify(
    { generated: new Date().toISOString(),
      items: rows.map((r) => {
        const m = meta[r.id] || {};
        return {
          title: r.t, kind: r.k ?? null, note: r.note ?? null,
          suggested: r.add === 1, status: decisions[r.id] ?? "undecided",
          tmdb: m.id ? {
            id: m.id, type: m.mt, title: m.t, original_title: m.ot, year: m.y,
            rating: m.v, votes: m.vc, genres: m.g, runtime: m.rt,
            seasons: m.sn, episodes: m.ep, language: m.lang, overview: m.ov,
          } : null,
        };
      }) },
    null, 2
  );

  return (
    <div className="mt-5">
      <div className="flex gap-2 flex-wrap text-xs">
        {tabs.map((b) => (
          <button key={b} onClick={() => setTab(b)} className="px-3 py-2 rounded font-bold"
            style={{
              background: tab === b ? (b === "todo" ? C.paper : BUCKETS[b].color) : C.ink2,
              color: tab === b ? C.ink : C.dim, border: `1px solid ${C.line}`,
            }}>
            {b === "todo" ? `بررسی‌نشده ${fa(undecided.length)}` : `${BUCKETS[b].fa} ${fa(counts[b])}`}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mt-3 text-xs">
        <button onClick={() => copy(asText, "لیست")} disabled={!rows.length}
          className="px-3 py-2 rounded" style={{ background: C.ink2, border: `1px solid ${C.line}`, color: C.paper }}>
          کپی متن
        </button>
        <button onClick={() => copy(asJson, "JSON")} disabled={!rows.length}
          className="px-3 py-2 rounded" style={{ background: C.ink2, border: `1px solid ${C.line}`, color: C.paper }}>
          کپی JSON
        </button>
        <button onClick={reset} className="mr-auto px-3 py-2 rounded"
          style={{ background: "transparent", border: `1px solid ${C.rust}66`, color: C.rust }}>
          پاک کردن تصمیم‌ها
        </button>
      </div>

      {!rows.length && (
        <p className="mt-8 text-sm" style={{ color: C.dim }}>
          اینجا هنوز چیزی نیست. برگرد به سوایپ و چند کارت رد کن.
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {rows.map((r) => {
          const m = meta[r.id];
          return (
            <li key={r.id} className="rounded px-3 py-2 flex items-center gap-2"
              style={{ background: C.ink2,
                border: `1px solid ${focusId === r.id ? C.amber : C.line}` }}>
              {m?.p && <img src={IMG_S + m.p} alt="" style={{ width: 26, borderRadius: 2 }} />}
              <button onClick={() => setFocusId(r.id)} className="flex-1 text-right min-w-0">
                <span className="text-sm block truncate"
                  style={{ direction: /[\u0600-\u06FF]/.test(r.t) ? "rtl" : "ltr" }}>
                  {r.t}
                </span>
                <span className="block text-[10px] mt-0.5" style={{ color: C.dim }}>
                  {r.k ? KIND_FA[r.k] : ""}
                  {m?.y ? ` · ${fa(m.y)}` : ""}
                  {m?.v ? ` · ★ ${fa(m.v)}` : ""}
                  {r.add === 1 ? " · پیشنهاد" : ""}
                  {r.note ? ` · ${r.note}` : ""}
                </span>
              </button>
              <select value={decisions[r.id] ?? ""} onChange={(e) => move(r.id, e.target.value || null)}
                className="text-xs rounded px-2 py-1"
                style={{ background: C.ink, color: C.paper, border: `1px solid ${C.line}` }}>
                <option value="">بررسی‌نشده</option>
                {ORDER.map((b) => <option key={b} value={b}>{BUCKETS[b].fa}</option>)}
              </select>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
