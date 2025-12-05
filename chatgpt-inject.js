// chatgpt-inject.js
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const TAG = "[YT-TX tidy-chatgpt]";
  let pageLoaded = document.readyState === "complete";
  window.addEventListener(
    "load",
    () => {
      pageLoaded = true;
    },
    { once: true }
  );
  const waitForLoaded = (timeoutMs = 8000) =>
    pageLoaded
      ? Promise.resolve(true)
      : new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), timeoutMs);
          window.addEventListener(
            "load",
            () => {
              clearTimeout(timer);
              resolve(true);
            },
            { once: true }
          );
        });
  const log = (...a) => {
    try {
      console.log(TAG, ...a);
    } catch {}
  };

  const findInput = () =>
    document.querySelector('#prompt-textarea.ProseMirror[contenteditable="true"]') ||
    document.querySelector('textarea[data-id="prompt-textarea"]') ||
    document.querySelector('textarea:not([aria-hidden="true"])') ||
    document.querySelector('[contenteditable="true"]');

  const trySend = () => {
    try {
      const active = document.activeElement || findInput();
      if (active) {
        const ev = new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          which: 13,
          keyCode: 13,
          bubbles: true,
        });
        const dispatched = active.dispatchEvent(ev);
        log("enter dispatched", dispatched);
        return dispatched;
      }
    } catch (e) {
      log("send failed", e);
    }
    return false;
  };

  const insertPromptOnce = (prompt) => {
    const el = findInput();
    if (!el) {
      log("input not found");
      return { ok: false, error: "input not found" };
    }

    const tryDirectSet = () => {
      try {
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
          // テキストエリア系ではそのまま改行を含んだテキストとして代入
          el.value = prompt;
        } else {
          // ProseMirror系の contenteditable には
          // HTML文字列ではなく、テキスト＋<br> を素直に詰める
          const root = el;

          // 中身クリア
          while (root.firstChild) {
            root.removeChild(root.firstChild);
          }

          const lines = String(prompt).split(/\n/g);
          lines.forEach((line, index) => {
            if (index > 0) {
              root.appendChild(document.createElement("br"));
            }
            root.appendChild(document.createTextNode(line));
          });
        }

        // キャレットを末尾に移動＋入力イベント発火
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
        log("direct set text");
        return true;
      } catch (e) {
        log("direct set failed", e);
        return false;
      }
    };

    const ok = tryDirectSet();
    return { ok };
  };

  const insertPromptWithRetry = async (prompt, retries = 10, interval = 500) => {
    for (let i = 0; i < retries; i++) {
      const res = insertPromptOnce(prompt);
      if (res.ok) return res;
      await new Promise((r) => setTimeout(r, interval));
    }
    return { ok: false, error: "input not found (timeout)" };
  };

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "YT_TX_INJECT_PROMPT") {
      log("message received", msg.prompt?.slice?.(0, 40) || "");
      insertPromptWithRetry(msg.prompt).then(async (res) => {
        if (res?.ok) {
          await waitForLoaded();
          const sent = trySend();
          sendResponse({ ...res, sent });
        } else {
          sendResponse(res);
        }
      });
      return true;
    }
  });
})();
