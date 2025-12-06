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

    const text = String(prompt ?? "").replace(/\r\n?/g, "\n");

    try {
      // textarea/input は従来通り
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        el.value = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
        log("set textarea value");
        return { ok: true };
      }

      // contenteditable (ProseMirror) は「ユーザー入力に近い」経路を優先
      el.focus();

      // 既存内容を全選択→削除
      try {
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
      } catch {}

      // insertText を試す（改行保持の成功率が高い）
      try {
        const ok = document.execCommand("insertText", false, text);
        if (ok) {
          log("execCommand insertText ok");
          return { ok: true };
        }
      } catch {
        return { ok: false, error: "insert failed" };
      }
    } catch (e) {
      log("direct set failed", e);
      return { ok: false, error: (e && e.message) || String(e) };
    }
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
