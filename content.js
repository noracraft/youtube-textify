// content.js
(() => {
  const CONFIG = {
    preferredLangs: ["ja", "en"],
    copyToClipboard: true,
    timeoutMs: 12000,
    consoleChunkSize: 20000,
  };
  const TAG = "[YT-TX]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const getVideoId = () => {
    const u = new URL(location.href);
    return u.searchParams.get("v") || (location.pathname.match(/\/shorts\/([A-Za-z0-9_-]+)/)?.[1] ?? null);
  };
  const withTimeout = async (p, ms, label = "request") => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(`Timeout ${label}`), ms);
    try {
      const r = await p(ac.signal);
      clearTimeout(t);
      return r;
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  };
  const fetchPlayerResponseANDROID = async (videoId) => {
    const apiKey = document.documentElement.innerHTML.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
    if (!apiKey) throw new Error("INNERTUBE_API_KEY not found");
    const endpoint = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`;
    const body = {
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      videoId,
    };
    const doFetch = (signal) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
        signal,
      });
    const res = await withTimeout(doFetch, CONFIG.timeoutMs, "/player ANDROID");
    if (!res.ok) throw new Error(`/player ANDROID failed: ${res.status}`);
    return res.json();
  };
  const getCaptionTracks = (pr) => pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const selectBestTrack = (tracks) => {
    const score = (t) => {
      const lang = (t.languageCode || "").toLowerCase();
      const asr = t.kind === "asr";
      let langBase = 0;
      for (let i = 0; i < CONFIG.preferredLangs.length; i++) {
        const p = CONFIG.preferredLangs[i].toLowerCase();
        if (lang === p || lang.startsWith(p + "-")) {
          langBase = (CONFIG.preferredLangs.length - i) * 100;
          break;
        }
      }
      const humanBonus = asr ? 0 : 10;
      return langBase + humanBonus;
    };
    return [...tracks].sort((a, b) => score(b) - score(a))[0] || null;
  };
  const parseVTT = (txt) =>
    txt && txt.includes("WEBVTT")
      ? txt
          .split("\n")
          .filter((l) => l.trim() !== "" && !/^\d+$/.test(l) && !l.includes("-->") && !l.startsWith("WEBVTT"))
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim() || null
      : null;
  const parseJSON3 = (txt) => {
    try {
      const obj = JSON.parse(txt);
      const lines = [];
      for (const ev of obj.events || []) {
        if (!ev?.segs) continue;
        const s = ev.segs
          .map((x) => x.utf8 || "")
          .join("")
          .replace(/\n+/g, "\n")
          .trim();
        if (s) lines.push(s);
      }
      return (
        lines
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim() || null
      );
    } catch {
      return null;
    }
  };
  const parseTTML = (txt) => {
    try {
      const doc = new DOMParser().parseFromString(txt, "text/xml");
      const ps = [...doc.getElementsByTagName("p")];
      if (!ps.length) return null;
      const lines = ps.map((p) => (p.textContent || "").trim()).filter(Boolean);
      return (
        lines
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim() || null
      );
    } catch {
      return null;
    }
  };
  const tryParseAny = (txt) => {
    const v = parseVTT(txt);
    if (v) return { fmt: "vtt", text: v };
    const j = parseJSON3(txt);
    if (j) return { fmt: "json3", text: j };
    const t = parseTTML(txt);
    if (t) return { fmt: "ttml", text: t };
    return { fmt: "unknown", text: null };
  };
  const fetchText = async (url, note = "") => {
    const doFetch = (signal) => fetch(url, { credentials: "include", signal });
    const res = await withTimeout(doFetch, CONFIG.timeoutMs, note || url);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  };
  const buildTriesForTrack = (videoId, track) => {
    const tries = [];
    if (track.baseUrl) {
      tries.push({ note: "baseUrl(default)", url: track.baseUrl });
      const u = new URL(track.baseUrl);
      ["vtt", "json3", "ttml"].forEach((fmt) => {
        u.searchParams.set("fmt", fmt);
        tries.push({ note: `baseUrl(fmt=${fmt})`, url: u.toString() });
      });
    }
    if (track.languageCode) {
      const base = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(
        track.languageCode
      )}${track.kind ? `&kind=${encodeURIComponent(track.kind)}` : ""}`;
      ["vtt", "json3", "ttml"].forEach((fmt) => tries.push({ note: `lang(fmt=${fmt})`, url: `${base}&fmt=${fmt}` }));
    }
    return tries;
  };
  const fetchOneTrack = async (videoId, track) => {
    const tries = buildTriesForTrack(videoId, track);
    for (const t of tries) {
      try {
        const { ok, text } = await fetchText(t.url, t.note);
        if (!ok || !text || !text.trim()) continue;
        const parsed = tryParseAny(text);
        if (parsed.text) return { ok: true, format: parsed.fmt, text: parsed.text, tried: t };
      } catch {}
    }
    return { ok: false };
  };
  const openTranscriptPanelIfPossible = async () => {
    try {
      document.querySelector("ytd-menu-renderer yt-icon-button#button")?.click();
      await sleep(500);
      const items = [...document.querySelectorAll("ytd-menu-service-item-renderer, tp-yt-paper-item")];
      const target = items.find((n) => /transcript|文字起こし/.test((n.textContent || "").toLowerCase()));
      if (target) {
        target.click();
        await sleep(800);
      }
    } catch {}
  };
  const readFromTranscriptPanel = () => {
    const segments = [...document.querySelectorAll("ytd-transcript-segment-renderer #segment-text")];
    if (!segments.length) return null;
    return segments
      .map((e) => (e.textContent || "").trim())
      .filter(Boolean)
      .join("\n");
  };

  async function extractTranscript() {
    const videoId = getVideoId();
    if (!videoId) {
      return { ok: false, error: "watch/shorts ページで実行してください。" };
    }
    try {
      // 1) ANDROID /player
      const pr = await fetchPlayerResponseANDROID(videoId);
      const tracks = getCaptionTracks(pr);
      if (tracks.length) {
        const best = selectBestTrack(tracks);
        if (best) {
          const r = await fetchOneTrack(videoId, best);
          if (r.ok) {
            const out = r.text;
            if (CONFIG.copyToClipboard) {
              try {
                await navigator.clipboard.writeText(out);
              } catch {}
            }
            return { ok: true, source: `ANDROID/${r.format}`, text: out };
          }
        }
      }
      // 2) UIパネル fallback
      await openTranscriptPanelIfPossible();
      const panel = readFromTranscriptPanel();
      if (panel) return { ok: true, source: "UI Panel", text: panel };

      return { ok: false, error: "字幕が取得できません（なし / 制限 / プレミア公開 等）" };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  // ポップアップからの実行リクエストを受ける
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "YT_TX_EXTRACT") {
      extractTranscript().then(sendResponse);
      return true; // async response
    }
  });
})();
