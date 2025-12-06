const api = globalThis.browser ?? globalThis.chrome;
const $ = (s) => document.querySelector(s);
const out = $("#out");
const statusEl = $("#status");
const runBtn = $("#run");
const actionRow = document.getElementById("action-row");
const tidyBtn = $("#tidy");
const downloadBtn = $("#download");
const copyBtn = $("#copy");
const isFirefox = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);

const promisify =
  (fn) =>
  (...args) =>
    new Promise((resolve, reject) => {
      try {
        const maybe = fn(...args, (res) => {
          const err = api?.runtime?.lastError;
          if (err) return reject(new Error(err.message));
          resolve(res);
        });
        if (maybe && typeof maybe.then === "function") {
          maybe.then(resolve, (e) => reject(e instanceof Error ? e : new Error(String(e))));
        }
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });

const tabsQuery = promisify(api.tabs.query.bind(api.tabs));
const tabsCreate = promisify(api.tabs.create.bind(api.tabs));
const tabsSendMessage = promisify(api.tabs.sendMessage.bind(api.tabs));
const tabsUpdate = promisify(api.tabs.update.bind(api.tabs));
const tabsGet = promisify(api.tabs.get.bind(api.tabs));

async function getActiveTab() {
  const [tab] = await tabsQuery({ active: true, currentWindow: true });
  return tab;
}

// YouTubeドメイン以外ではrunボタンを非アクティブ化し、textareaも非表示
async function checkDomainAndSetRunBtn() {
  const tab = await getActiveTab();
  const isYoutube = !!(tab?.url && /^https:\/\/(www\.)?youtube\.com\//.test(tab.url));
  runBtn.disabled = !isYoutube;
  if (!isYoutube) {
    statusEl.textContent = "YouTubeページでのみ利用できます";
    out.hidden = true;
  } else {
    statusEl.textContent = "準備完了";
    out.hidden = false;
  }
}

// 初期状態でアクションボタン非表示
actionRow.hidden = true;

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text || "");
    return true;
  } catch {
    try {
      const prev = out.value;
      out.value = text || "";
      out.select();
      document.execCommand("copy");
      out.value = prev;
      return true;
    } catch {
      return false;
    }
  }
};

runBtn.addEventListener("click", async () => {
  statusEl.textContent = "抽出中…";
  const tab = await getActiveTab();
  if (!tab?.id) return (statusEl.textContent = "タブが見つかりません");

  tabsSendMessage(tab.id, { type: "YT_TX_EXTRACT" })
    .then((res) => {
      if (!res?.ok) {
        statusEl.textContent = "失敗: " + (res?.error || "未知のエラー");
        actionRow.hidden = true;
        return;
      }
      out.value = res.text;
      statusEl.textContent = `成功しました`;
      actionRow.hidden = false;
    })
    .catch(() => {
      statusEl.textContent = "コンテンツスクリプトに接続できません。YouTubeページか確認してください。";
      actionRow.hidden = true;
    });
});

copyBtn?.addEventListener("click", async () => {
  const ok = await copyText(out.value || "");
  statusEl.textContent = ok ? "クリップボードにコピーしました" : "コピーに失敗しました";
});

downloadBtn?.addEventListener("click", () => {
  const blob = new Blob([out.value || ""], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  a.download = `yt-transcript-${ts}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = ".txt を保存しました";
});

const buildTidyPrompt = (text) => `以下に示すテキストは、YouTube動画の字幕を抽出したものです。
句読点や改行が未整形で読みづらい状態のため、次のルールに準じた整形を行ってください。

▼整形ルール

1. 文の切れ目に「。」「、」などの句読点を補ってください。
2. 話のまとまりごとに、3〜4文程度の段落に分けてください。
3. 元の話し方の雰囲気はできるだけ残してください。
4. 明らかな誤変換や誤字があれば、文脈から自然な表現に修正してください。
5. 内容に変更は加えず、あくまで「読みやすく整形」することを優先してください。要約は極力行わないでください。

▼出力フォーマット

・整形済みの本文だけを出力してください。
・箇条書きや解説は不要です。

▼整形対象テキスト

${text}`;

const waitForTabComplete = (tabId, timeoutMs = 15000) =>
  new Promise((resolve, reject) => {
    let finished = false;
    const done = (tab) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      api.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };
    const listener = (id, info, tab) => {
      if (id === tabId && info.status === "complete") {
        done(tab);
      }
    };
    api.tabs.onUpdated.addListener(listener);
    tabsGet(tabId)
      .then((tab) => {
        if (tab?.status === "complete") done(tab);
      })
      .catch(() => {});
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      api.tabs.onUpdated.removeListener(listener);
      reject(new Error("timeout loading tab"));
    }, timeoutMs);
  });

const injectPromptToChatGPT = async (tabId, promptText) => {
  try {
    return await tabsSendMessage(tabId, { type: "YT_TX_INJECT_PROMPT", prompt: promptText });
  } catch (e) {
    console.error("[YT-TX tidy] sendMessage failed", e);
    return { ok: false, error: (e && e.message) || String(e) };
  }
};

tidyBtn?.addEventListener("click", async () => {
  const raw = out.value || "";
  if (!raw.trim()) {
    statusEl.textContent = "整形する字幕がありません";
    return;
  }

  const copied = await copyText(raw);
  statusEl.textContent = copied ? "字幕をコピーしました" : "コピーに失敗しました（続行）";

  const prompt = buildTidyPrompt(raw);
  let tab;
  try {
    // Chromeではタブをアクティブにするとポップアップが閉じてしまうため、
    // まずバックグラウンドで開き、整形プロンプト挿入後にアクティブ化する。
    // Firefoxではそのままアクティブで開いてもポップアップが生きるので active: true。
    tab = await tabsCreate({
      url: "https://chatgpt.com/?temporary-chat=true",
      active: isFirefox ? true : false,
    });
    statusEl.textContent = "ChatGPTを開いています…（整形プロンプトを準備中）";
  } catch (e) {
    statusEl.textContent = "ChatGPTタブを開けませんでした";
    return;
  }

  try {
    await waitForTabComplete(tab.id);
    const result = await injectPromptToChatGPT(tab.id, prompt);
    if (result?.ok) {
      statusEl.textContent = "ChatGPTにプロンプトを挿入しました";
      // アクティブ化を試みる（Chromeではポップアップが閉じる場合があります）
      try {
        await tabsUpdate(tab.id, { active: true });
        if (tab.windowId != null && api?.windows?.update) {
          await api.windows.update(tab.windowId, { focused: true });
        }
      } catch {
        // ignore
      }
    } else {
      statusEl.textContent = "プロンプト挿入に失敗しました。クリップボードから貼り付けてください。";
    }
  } catch (e) {
    statusEl.textContent = "プロンプト挿入に失敗しました。クリップボードから貼り付けてください。";
  }
});

// 初期化
checkDomainAndSetRunBtn();
