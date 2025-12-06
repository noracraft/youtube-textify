const api = globalThis.browser ?? globalThis.chrome;

const DEFAULT_TEMPLATE = `以下に示すテキストは、YouTube動画の字幕を抽出したものです。
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

{{text}}`;

const $ = (s) => document.querySelector(s);
const ta = $("#promptTemplate");
const statusEl = $("#status");
const saveBtn = $("#save");
const resetBtn = $("#reset");

// sync があれば sync、なければ local を使う（Firefox/Chrome両対応）
const storage = api.storage?.sync ?? api.storage?.local;

const get = (defaults) => new Promise((resolve) => storage.get(defaults, (v) => resolve(v)));

const set = (obj) =>
  new Promise((resolve, reject) =>
    storage.set(obj, () => {
      const err = api.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve(true);
    })
  );

async function load() {
  const { promptTemplate } = await get({ promptTemplate: DEFAULT_TEMPLATE });
  ta.value = promptTemplate || DEFAULT_TEMPLATE;
}

function flash(msg) {
  statusEl.textContent = msg;
  setTimeout(() => (statusEl.textContent = ""), 1200);
}

saveBtn.addEventListener("click", async () => {
  const v = ta.value || "";
  await set({ promptTemplate: v });
  flash("保存しました");
});

resetBtn.addEventListener("click", async () => {
  ta.value = DEFAULT_TEMPLATE;
  await set({ promptTemplate: DEFAULT_TEMPLATE });
  flash("デフォルトに戻しました");
});

load();
