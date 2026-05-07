import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// ---- 剪贴板捕获状态 ----
const captureState = {
  lastClipboardText: "",
  lastClipboardAt: 0,
  inCopyEvent: false,
};

// 模型类型配置（label → ComfyUI folder_paths key）
const MODEL_TYPES = [
  { value: "checkpoints",    label: "Checkpoint (checkpoints)" },
  { value: "loras",          label: "LoRA (loras)" },
  { value: "controlnet",     label: "ControlNet (controlnet)" },
  { value: "vae",            label: "VAE (vae)" },
  { value: "upscale_models", label: "Upscale (upscale_models)" },
  { value: "embeddings",     label: "Embedding (embeddings)" },
  { value: "clip",           label: "CLIP (clip)" },
  { value: "unet",           label: "UNet (unet)" },
  { value: "diffusion_models", label: "Diffusion Models (diffusion_models)" },
];

installClipboardCapture();

app.registerExtension({
  name: "ComfyUI.ServerDownloader",
  async setup() {
    console.log("[ServerDownloader] loaded");

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          maybePatchMissingModelsUI(node);
        });
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    maybePatchMissingModelsUI(document.body);
  },
});

// ---- 注入「服务端下载」按钮 ----
function maybePatchMissingModelsUI(root) {
  const text = (root.innerText || "").toLowerCase();
  if (
    !text.includes("missing model") &&
    !text.includes("missing models") &&
    !text.includes("缺失模型")
  ) {
    return;
  }

  const buttons = root.querySelectorAll("button, [role='button']");
  buttons.forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    if (btn.dataset.serverDownloaderHooked === "1") return;

    const label = (btn.innerText || "").trim().toLowerCase();
    const isDownload =
      label === "download" ||
      label.includes("download") ||
      label === "下载" ||
      label.includes("下载");

    if (!isDownload) return;
    btn.dataset.serverDownloaderHooked = "1";

    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.innerText = "⬇ 服务端下载";
    actionBtn.style.cssText = [
      "margin-left:8px",
      "padding:3px 10px",
      "font-size:12px",
      "cursor:pointer",
      "background:#1a73e8",
      "color:#fff",
      "border:none",
      "border-radius:4px",
      "transition:opacity 0.2s",
    ].join(";");

    actionBtn.addEventListener("mouseenter", () => {
      if (!actionBtn.disabled) actionBtn.style.opacity = "0.85";
    });
    actionBtn.addEventListener("mouseleave", () => {
      actionBtn.style.opacity = "1";
    });

    actionBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      actionBtn.disabled = true;
      actionBtn.innerText = "检测中…";

      try {
        // 尝试自动推断 URL、文件名、类型作为预填充值
        const autoUrl = await inferUrlAsync(btn);
        const autoFilename = autoUrl
          ? sanitizeFilename(inferFilename(btn, autoUrl)) ||
            sanitizeFilename(extractFilenameFromUrl(autoUrl)) ||
            ""
          : "";
        const autoType = inferTypeFromDOM(btn);

        // 读取剪贴板作为 URL 候选（若自动推断为空）
        let clipboardHint = autoUrl;
        if (!clipboardHint) {
          try {
            const cb = await navigator.clipboard.readText();
            if (isHttpUrl(cb)) clipboardHint = cb.trim();
          } catch (_) {}
        }

        // 弹出确认对话框（URL + 文件名 + 类型三合一）
        const result = await promptDownloadDialog({
          defaultUrl: clipboardHint || "",
          defaultFilename: autoFilename || "model.safetensors",
          defaultType: autoType || "checkpoints",
        });

        if (!result) {
          // 用户取消
          actionBtn.innerText = "⬇ 服务端下载";
          actionBtn.disabled = false;
          return;
        }

        actionBtn.innerText = "提交中…";

        const resp = await api.fetchApi("/server_downloader/download", {
          method: "POST",
          body: JSON.stringify({
            url: result.url,
            filename: result.filename,
            type: result.type,
          }),
        });

        const data = await resp.json();
        if (data.status !== "success" || !data.task_id) {
          actionBtn.innerText = "⬇ 服务端下载";
          actionBtn.disabled = false;
          window.alert("下载失败：" + (data.message || "未知错误"));
          return;
        }

        actionBtn.dataset.serverDownloaderTaskId = data.task_id;
        actionBtn.title = "保存到：" + (data.dest || "");
        actionBtn.innerText = "0%";
        pollStatus(actionBtn, data.task_id);
      } catch (err) {
        console.error("[ServerDownloader] error", err);
        actionBtn.innerText = "错误";
        actionBtn.disabled = false;
      }
    });

    btn.insertAdjacentElement("afterend", actionBtn);
  });
}

// ---- 下载确认对话框（URL + 文件名 + 类型三合一） ----
function promptDownloadDialog({ defaultUrl, defaultFilename, defaultType }) {
  return new Promise((resolve) => {
    const overlay = buildOverlay();

    const box = document.createElement("div");
    box.style.cssText = [
      "background:#2a2a2a",
      "border-radius:8px",
      "padding:24px",
      "width:500px",
      "max-width:94vw",
      "box-shadow:0 4px 28px rgba(0,0,0,0.6)",
      "font-family:sans-serif",
      "color:#eee",
    ].join(";");

    // 标题
    const title = document.createElement("div");
    title.innerText = "📥 服务端下载模型";
    title.style.cssText = "font-size:16px;font-weight:700;margin-bottom:18px;color:#fff;";

    // 通用 label + control 行
    function makeRow(labelText, control) {
      const row = document.createElement("div");
      row.style.cssText = "margin-bottom:14px;";
      const lbl = document.createElement("div");
      lbl.innerText = labelText;
      lbl.style.cssText = "font-size:12px;color:#aaa;margin-bottom:5px;";
      row.appendChild(lbl);
      row.appendChild(control);
      return row;
    }

    const inputStyle = [
      "width:100%",
      "box-sizing:border-box",
      "padding:8px 10px",
      "font-size:13px",
      "border-radius:4px",
      "border:1px solid #555",
      "background:#1a1a1a",
      "color:#eee",
      "outline:none",
    ].join(";");

    // URL 输入
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.value = defaultUrl || "";
    urlInput.placeholder = "https://huggingface.co/... 或 https://civitai.com/...";
    urlInput.style.cssText = inputStyle;

    // URL 变化时自动填充文件名
    urlInput.addEventListener("input", () => {
      const v = urlInput.value.trim();
      if (isHttpUrl(v)) {
        const fn = sanitizeFilename(extractFilenameFromUrl(v));
        if (fn) filenameInput.value = fn;
      }
    });

    // 文件名输入
    const filenameInput = document.createElement("input");
    filenameInput.type = "text";
    filenameInput.value = defaultFilename || "model.safetensors";
    filenameInput.placeholder = "model.safetensors";
    filenameInput.style.cssText = inputStyle;

    // 模型类型下拉
    const typeSelect = document.createElement("select");
    typeSelect.style.cssText = [
      inputStyle,
      "cursor:pointer",
    ].join(";");
    MODEL_TYPES.forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.text = label;
      if (value === defaultType) opt.selected = true;
      typeSelect.appendChild(opt);
    });

    // 错误提示
    const errMsg = document.createElement("div");
    errMsg.style.cssText =
      "color:#f44336;font-size:12px;min-height:18px;margin-bottom:6px;";

    // 按钮行
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:6px;";

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "取消";
    cancelBtn.style.cssText =
      "padding:7px 18px;font-size:13px;border-radius:4px;border:1px solid #555;background:transparent;color:#ccc;cursor:pointer;";

    const okBtn = document.createElement("button");
    okBtn.innerText = "开始下载";
    okBtn.style.cssText =
      "padding:7px 18px;font-size:13px;border-radius:4px;border:none;background:#1a73e8;color:#fff;cursor:pointer;font-weight:600;";

    function doConfirm() {
      const url = urlInput.value.trim();
      const filename = sanitizeFilename(filenameInput.value.trim());
      const type = typeSelect.value;

      if (!isHttpUrl(url)) {
        errMsg.innerText = "⚠ 请输入有效的 http/https 链接";
        urlInput.focus();
        return;
      }
      if (!filename) {
        errMsg.innerText = "⚠ 文件名不能为空";
        filenameInput.focus();
        return;
      }

      document.body.removeChild(overlay);
      resolve({ url, filename, type });
    }

    function doCancel() {
      document.body.removeChild(overlay);
      resolve(null);
    }

    okBtn.addEventListener("click", doConfirm);
    cancelBtn.addEventListener("click", doCancel);

    // 键盘快捷键
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target !== cancelBtn) doConfirm();
      if (e.key === "Escape") doCancel();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);

    box.appendChild(title);
    box.appendChild(makeRow("下载链接 *", urlInput));
    box.appendChild(makeRow("保存文件名 *", filenameInput));
    box.appendChild(makeRow("模型类型（决定保存目录）*", typeSelect));
    box.appendChild(errMsg);
    box.appendChild(btnRow);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    setTimeout(() => {
      if (urlInput.value) {
        filenameInput.focus();
        filenameInput.select();
      } else {
        urlInput.focus();
      }
    }, 50);
  });
}

// ---- 状态轮询 ----
async function pollStatus(buttonEl, taskId) {
  const startedAt = Date.now();
  while (true) {
    await sleep(600);
    if (!(buttonEl instanceof HTMLElement)) return;

    try {
      const resp = await api.fetchApi(`/server_downloader/status/${taskId}`, {
        method: "GET",
      });
      const data = await resp.json();
      const task = data?.task;
      if (data?.status !== "success" || !task) {
        buttonEl.innerText = "状态异常";
        buttonEl.disabled = false;
        return;
      }

      const state = task.state;
      if (state === "completed") {
        buttonEl.innerText = "✅ 完成";
        buttonEl.style.background = "#2e7d32";
        buttonEl.disabled = true;
        return;
      }

      if (state === "error") {
        buttonEl.innerText = "❌ 错误";
        buttonEl.style.background = "#c62828";
        buttonEl.title = "错误：" + (task.error || "未知");
        buttonEl.disabled = false;
        return;
      }

      if (state === "cancelled") {
        buttonEl.innerText = "已取消";
        buttonEl.disabled = false;
        return;
      }

      const pct =
        typeof task.progress === "number"
          ? Math.max(0, Math.min(1, task.progress))
          : null;
      const speed =
        typeof task.speed_bps === "number" && task.speed_bps > 0
          ? ` ${formatBytes(task.speed_bps)}/s`
          : "";

      buttonEl.innerText =
        pct !== null
          ? `${Math.round(pct * 100)}%${speed}`
          : `${formatBytes(task.downloaded_bytes || 0)}${speed}`;

      if (Date.now() - startedAt > 1000 * 60 * 60) return;
    } catch (e) {
      buttonEl.innerText = "离线";
      buttonEl.disabled = false;
      return;
    }
  }
}

// ---- 工具函数 ----

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "background:rgba(0,0,0,0.65)",
    "z-index:99999",
    "display:flex",
    "align-items:center",
    "justify-content:center",
  ].join(";");
  return overlay;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n}B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n;
  let i = -1;
  do {
    value /= 1024;
    i += 1;
  } while (value >= 1024 && i < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)}${units[i]}`;
}

async function inferUrlAsync(downloadBtn) {
  const direct = inferUrl(downloadBtn);
  if (direct) return direct;

  const row = downloadBtn.closest("tr, li, div") || downloadBtn.parentElement;
  const copyBtn = findCopyUrlButton(row);
  if (copyBtn) {
    const beforeAt = captureState.lastClipboardAt;
    try { copyBtn.click(); } catch (e) {}

    await sleep(0);
    await sleep(50);

    if (captureState.lastClipboardAt > beforeAt) {
      const v = captureState.lastClipboardText;
      if (isHttpUrl(v)) return v;
    }

    try {
      const v = await navigator.clipboard.readText();
      if (isHttpUrl(v)) return v;
    } catch (e) {}
  }

  return "";
}

function inferUrl(downloadBtn) {
  const row = downloadBtn.closest("tr, li, div") || downloadBtn.parentElement;
  const a = row?.querySelector?.("a[href^='http']");
  if (a && a.href) return a.href;

  const attrUrl = findAnyUrlInAttributes(row);
  if (attrUrl) return attrUrl;

  const urlFromCopy = findUrlNearCopyButton(row);
  if (urlFromCopy) return urlFromCopy;

  const onclickStr = downloadBtn.getAttribute("onclick") || "";
  const m1 = onclickStr.match(/https?:\/\/[^\s'"]+/i);
  if (m1) return m1[0];

  const rowText = row ? row.innerText || "" : "";
  const m2 = rowText.match(/https?:\/\/[^\s'"]+/i);
  if (m2) return m2[0];

  return "";
}

function findAnyUrlInAttributes(row) {
  if (!(row instanceof HTMLElement)) return "";
  const all = Array.from(row.querySelectorAll("*"));
  all.unshift(row);
  for (const el of all) {
    if (!(el instanceof HTMLElement)) continue;
    for (const attr of Array.from(el.attributes || [])) {
      const v = (attr?.value || "").trim();
      if (isHttpUrl(v)) return v;
    }
  }
  return "";
}

function findUrlNearCopyButton(row) {
  if (!row?.querySelectorAll) return "";
  const btns = Array.from(row.querySelectorAll("button, [role='button'], a"));
  for (const el of btns) {
    if (!(el instanceof HTMLElement)) continue;
    const label = getElementLabel(el);
    const isCopy =
      label.includes("copy url") || label.includes("copy") || label.includes("复制");
    if (!isCopy) continue;

    for (const k of ["data-clipboard-text", "data-url", "data-href", "data-link", "href"]) {
      const v = el.getAttribute(k);
      if (v && /^https?:\/\//i.test(v)) return v;
    }

    const m = (el.getAttribute("onclick") || "").match(/https?:\/\/[^\s'"]+/i);
    if (m) return m[0];
  }
  return "";
}

function findCopyUrlButton(row) {
  if (!row?.querySelectorAll) return null;
  const btns = Array.from(row.querySelectorAll("button, [role='button'], a"));
  for (const el of btns) {
    if (!(el instanceof HTMLElement)) continue;
    const label = getElementLabel(el);
    if (label.includes("copy url") || label.includes("copy") || label.includes("复制")) {
      return el;
    }
  }
  return null;
}

function getElementLabel(el) {
  const text = (el.innerText || "").trim();
  const aria = (el.getAttribute("aria-label") || "").trim();
  const title = (el.getAttribute("title") || "").trim();
  return (text || aria || title).toLowerCase();
}

function isHttpUrl(v) {
  if (typeof v !== "string") return false;
  return /^https?:\/\//i.test(v.trim());
}

function hasModelExtension(name) {
  return /\.(safetensors|ckpt|pt|pth|bin|gguf|pkl|model)$/i.test(name || "");
}

function inferFilename(downloadBtn, url) {
  const row = downloadBtn.closest("tr, li, div") || downloadBtn.parentElement;
  const rowText = (row?.innerText || "").trim();

  const m = rowText.match(/[\w\-\.]+\.(safetensors|ckpt|pt|pth|bin|gguf|pkl|model)/i);
  if (m) return m[0];

  if (url) return extractFilenameFromUrl(url);
  return "";
}

/**
 * 从 DOM 推断模型类型，仅作为默认值，用户可在对话框里修改。
 * 为避免从大容器取到混杂文本，先向上找最近的包含具体类型词的祖先节点。
 */
function inferTypeFromDOM(downloadBtn) {
  // 优先逐级向上查找，取能精确匹配类型关键词的最小容器
  let el = downloadBtn.parentElement;
  while (el && el !== document.body) {
    const t = (el.innerText || "").toLowerCase();
    // 判断范围：文字量小的容器优先（< 200字符），避免取到全局容器
    if (t.length < 200) {
      if (t.includes("lora")) return "loras";
      if (t.includes("controlnet")) return "controlnet";
      if (t.includes("vae") && !t.includes("checkpoint")) return "vae";
      if (t.includes("upscale") || t.includes("esrgan")) return "upscale_models";
      if (t.includes("embedding") || t.includes("textual")) return "embeddings";
      if (t.includes("unet")) return "unet";
      if (t.includes("clip")) return "clip";
      if (t.includes("diffusion")) return "diffusion_models";
      if (t.includes("checkpoint")) return "checkpoints";
    }
    el = el.parentElement;
  }
  return "checkpoints";
}

function extractFilenameFromUrl(url) {
  try {
    const u = new URL(url);
    const qName = u.searchParams.get("filename") || u.searchParams.get("name");
    if (qName) return decodeURIComponent(qName);
    const last = u.pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last);
  } catch {
    return "";
  }
}

function sanitizeFilename(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return "";
  const base = trimmed.split("/").pop()?.split("\\").pop() || "";
  if (!base || base.includes("..")) return "";
  // 黑名单过滤非法字符
  return base.replace(/[/\\:*?"<>|]/g, "_");
}

// ---- 剪贴板劫持（用于捕获 copy 事件里的 URL） ----
function installClipboardCapture() {
  if (window.__serverDownloaderClipboardCaptureInstalled) return;
  window.__serverDownloaderClipboardCaptureInstalled = true;

  document.addEventListener("copy", () => {
    captureState.inCopyEvent = true;
    setTimeout(() => { captureState.inCopyEvent = false; }, 0);
  }, true);

  try {
    const proto = DataTransfer?.prototype;
    const originalSetData = proto?.setData;
    if (proto && typeof originalSetData === "function") {
      proto.setData = function (format, data) {
        try {
          const f = String(format || "").toLowerCase();
          const d = typeof data === "string" ? data : String(data || "");
          if (captureState.inCopyEvent && (f.includes("text") || f.includes("plain")) && isHttpUrl(d)) {
            captureState.lastClipboardText = d.trim();
            captureState.lastClipboardAt = Date.now();
          }
        } catch (e) {}
        return originalSetData.apply(this, arguments);
      };
    }
  } catch (e) {}

  try {
    const originalExecCommand = document.execCommand?.bind(document);
    if (typeof originalExecCommand === "function") {
      document.execCommand = function (commandId) {
        try {
          if (String(commandId || "").toLowerCase() === "copy") {
            const ae = document.activeElement;
            const v = ae && typeof ae.value === "string" ? ae.value : "";
            if (isHttpUrl(v)) {
              captureState.lastClipboardText = v.trim();
              captureState.lastClipboardAt = Date.now();
            }
            try {
              const sel = window.getSelection?.();
              const s = sel ? String(sel.toString() || "").trim() : "";
              if (isHttpUrl(s)) {
                captureState.lastClipboardText = s;
                captureState.lastClipboardAt = Date.now();
              }
            } catch (e) {}
          }
        } catch (e) {}
        return originalExecCommand.apply(this, arguments);
      };
    }
  } catch (e) {}

  try {
    const taProto = HTMLTextAreaElement?.prototype;
    const inProto = HTMLInputElement?.prototype;
    const origTaSelect = taProto?.select;
    const origInSelect = inProto?.select;

    if (taProto && typeof origTaSelect === "function") {
      taProto.select = function () {
        try {
          const v = typeof this.value === "string" ? this.value : "";
          if (isHttpUrl(v)) {
            captureState.lastClipboardText = v.trim();
            captureState.lastClipboardAt = Date.now();
          }
        } catch (e) {}
        return origTaSelect.apply(this, arguments);
      };
    }

    if (inProto && typeof origInSelect === "function") {
      inProto.select = function () {
        try {
          const v = typeof this.value === "string" ? this.value : "";
          if (isHttpUrl(v)) {
            captureState.lastClipboardText = v.trim();
            captureState.lastClipboardAt = Date.now();
          }
        } catch (e) {}
        return origInSelect.apply(this, arguments);
      };
    }
  } catch (e) {}

  try {
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      const original = clipboard.writeText.bind(clipboard);
      clipboard.writeText = async (text) => {
        try {
          if (typeof text === "string" && isHttpUrl(text)) {
            captureState.lastClipboardText = text;
            captureState.lastClipboardAt = Date.now();
          }
        } catch (e) {}
        return original(text);
      };
    }
  } catch (e) {}
}
