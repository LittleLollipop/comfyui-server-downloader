import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const captureState = {
  lastClipboardText: "",
  lastClipboardAt: 0,
  inCopyEvent: false,
};

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
      "margin-left: 8px",
      "padding: 3px 10px",
      "font-size: 12px",
      "cursor: pointer",
      "background: #1a73e8",
      "color: #fff",
      "border: none",
      "border-radius: 4px",
      "transition: opacity 0.2s",
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
        // 第一步：尝试自动推断 URL
        let url = await inferUrlAsync(btn);

        // 第二步：自动推断失败 → 弹出输入框让用户手动粘贴
        if (!url) {
          // 先尝试从剪贴板读取
          let clipboardHint = "";
          try {
            const cb = await navigator.clipboard.readText();
            if (isHttpUrl(cb)) clipboardHint = cb.trim();
          } catch (_) {}

          url = await promptForUrl(clipboardHint);
        }

        if (!url) {
          actionBtn.innerText = "⬇ 服务端下载";
          actionBtn.disabled = false;
          return;
        }

        const filename =
          sanitizeFilename(inferFilename(btn, url)) ||
          sanitizeFilename(extractFilenameFromUrl(url)) ||
          "model.safetensors";

        const type = inferType(btn);

        // 若文件名不含扩展名，也提示用户确认
        let finalFilename = filename;
        if (!hasModelExtension(finalFilename)) {
          const confirmed = await promptForFilename(finalFilename, url);
          if (!confirmed) {
            actionBtn.innerText = "⬇ 服务端下载";
            actionBtn.disabled = false;
            return;
          }
          finalFilename = confirmed;
        }

        actionBtn.innerText = "提交中…";

        const response = await api.fetchApi("/server_downloader/download", {
          method: "POST",
          body: JSON.stringify({ url, filename: finalFilename, type }),
        });

        const result = await response.json();
        if (result.status !== "success" || !result.task_id) {
          actionBtn.innerText = "⬇ 服务端下载";
          actionBtn.disabled = false;
          window.alert("下载失败：" + (result.message || "未知错误"));
          return;
        }

        actionBtn.dataset.serverDownloaderTaskId = result.task_id;
        actionBtn.title = result.dest || "";
        actionBtn.innerText = "0%";
        pollStatus(actionBtn, result.task_id);
      } catch (err) {
        console.error("[ServerDownloader] error", err);
        actionBtn.innerText = "错误";
        actionBtn.disabled = false;
      }
    });

    btn.insertAdjacentElement("afterend", actionBtn);
  });
}

// ---- URL 输入对话框 ----
function promptForUrl(defaultValue) {
  return new Promise((resolve) => {
    const overlay = buildOverlay();
    const box = document.createElement("div");
    box.style.cssText = [
      "background:#2a2a2a",
      "border-radius:8px",
      "padding:24px",
      "width:480px",
      "max-width:90vw",
      "box-shadow:0 4px 24px rgba(0,0,0,0.5)",
      "font-family:sans-serif",
    ].join(";");

    const title = document.createElement("div");
    title.innerText = "📥 输入模型下载链接";
    title.style.cssText = "color:#fff;font-size:15px;font-weight:600;margin-bottom:12px;";

    const hint = document.createElement("div");
    hint.innerText = "无法自动获取下载链接，请手动粘贴 URL（支持 Civitai、HuggingFace 等直链）：";
    hint.style.cssText = "color:#aaa;font-size:12px;margin-bottom:10px;line-height:1.5;";

    const input = document.createElement("input");
    input.type = "text";
    input.value = defaultValue || "";
    input.placeholder = "https://...";
    input.style.cssText = [
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

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:14px;";

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "取消";
    cancelBtn.style.cssText =
      "padding:6px 16px;font-size:13px;border-radius:4px;border:1px solid #555;background:transparent;color:#ccc;cursor:pointer;";

    const okBtn = document.createElement("button");
    okBtn.innerText = "开始下载";
    okBtn.style.cssText =
      "padding:6px 16px;font-size:13px;border-radius:4px;border:none;background:#1a73e8;color:#fff;cursor:pointer;";

    function confirm() {
      const v = input.value.trim();
      document.body.removeChild(overlay);
      resolve(isHttpUrl(v) ? v : "");
    }

    function cancel() {
      document.body.removeChild(overlay);
      resolve("");
    }

    okBtn.addEventListener("click", confirm);
    cancelBtn.addEventListener("click", cancel);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirm();
      if (e.key === "Escape") cancel();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    box.appendChild(title);
    box.appendChild(hint);
    box.appendChild(input);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // 自动聚焦并全选
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  });
}

// ---- 文件名确认对话框 ----
function promptForFilename(defaultName, url) {
  return new Promise((resolve) => {
    const overlay = buildOverlay();
    const box = document.createElement("div");
    box.style.cssText = [
      "background:#2a2a2a",
      "border-radius:8px",
      "padding:24px",
      "width:440px",
      "max-width:90vw",
      "box-shadow:0 4px 24px rgba(0,0,0,0.5)",
      "font-family:sans-serif",
    ].join(";");

    const title = document.createElement("div");
    title.innerText = "📄 确认保存文件名";
    title.style.cssText = "color:#fff;font-size:15px;font-weight:600;margin-bottom:12px;";

    const hint = document.createElement("div");
    hint.innerText = "请确认或修改文件名（需包含 .safetensors / .ckpt / .pt / .bin / .gguf 等扩展名）：";
    hint.style.cssText = "color:#aaa;font-size:12px;margin-bottom:10px;line-height:1.5;";

    const input = document.createElement("input");
    input.type = "text";
    input.value = defaultName || "model.safetensors";
    input.placeholder = "model.safetensors";
    input.style.cssText = [
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

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:14px;";

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "取消";
    cancelBtn.style.cssText =
      "padding:6px 16px;font-size:13px;border-radius:4px;border:1px solid #555;background:transparent;color:#ccc;cursor:pointer;";

    const okBtn = document.createElement("button");
    okBtn.innerText = "确认";
    okBtn.style.cssText =
      "padding:6px 16px;font-size:13px;border-radius:4px;border:none;background:#1a73e8;color:#fff;cursor:pointer;";

    function confirm() {
      const v = sanitizeFilename(input.value.trim());
      document.body.removeChild(overlay);
      resolve(v || "");
    }

    function cancel() {
      document.body.removeChild(overlay);
      resolve("");
    }

    okBtn.addEventListener("click", confirm);
    cancelBtn.addEventListener("click", cancel);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirm();
      if (e.key === "Escape") cancel();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    box.appendChild(title);
    box.appendChild(hint);
    box.appendChild(input);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  });
}

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "background:rgba(0,0,0,0.6)",
    "z-index:99999",
    "display:flex",
    "align-items:center",
    "justify-content:center",
  ].join(";");
  return overlay;
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
        buttonEl.title = task.error || "";
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
          ? `${formatBytes(task.speed_bps)}/s`
          : "";

      if (pct !== null) {
        buttonEl.innerText = `${Math.round(pct * 100)}%${speed ? " " + speed : ""}`;
      } else {
        buttonEl.innerText = `${formatBytes(task.downloaded_bytes || 0)}${speed ? " " + speed : ""}`;
      }

      if (Date.now() - startedAt > 1000 * 60 * 60) {
        return;
      }
    } catch (e) {
      buttonEl.innerText = "离线";
      buttonEl.disabled = false;
      return;
    }
  }
}

// ---- 工具函数 ----

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
    try {
      copyBtn.click();
    } catch (e) {}

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
  const match = onclickStr.match(/https?:\/\/[^\s'"]+/i);
  if (match) return match[0];

  const rowText = row ? row.innerText || "" : "";
  const textMatch = rowText.match(/https?:\/\/[^\s'"]+/i);
  if (textMatch) return textMatch[0];

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
      label === "copy url" ||
      label.includes("copy url") ||
      label === "copy" ||
      label.includes("copy") ||
      label.includes("复制");
    if (!isCopy) continue;

    const attrs = ["data-clipboard-text", "data-url", "data-href", "data-link", "href"];
    for (const k of attrs) {
      const v = el.getAttribute(k);
      if (v && /^https?:\/\//i.test(v)) return v;
    }

    const onclickStr = el.getAttribute("onclick") || "";
    const match = onclickStr.match(/https?:\/\/[^\s'"]+/i);
    if (match) return match[0];
  }
  return "";
}

function findCopyUrlButton(row) {
  if (!row?.querySelectorAll) return null;
  const btns = Array.from(row.querySelectorAll("button, [role='button'], a"));
  for (const el of btns) {
    if (!(el instanceof HTMLElement)) continue;
    const label = getElementLabel(el);
    const isCopy =
      label === "copy url" ||
      label.includes("copy url") ||
      label === "copy" ||
      label.includes("copy") ||
      label.includes("复制");
    if (isCopy) return el;
  }
  return null;
}

function getElementLabel(el) {
  const text = (el.innerText || "").trim();
  const aria = (el.getAttribute("aria-label") || "").trim();
  const title = (el.getAttribute("title") || "").trim();
  return (text || aria || title).toLowerCase();
}

function installClipboardCapture() {
  if (window.__serverDownloaderClipboardCaptureInstalled) return;
  window.__serverDownloaderClipboardCaptureInstalled = true;

  document.addEventListener(
    "copy",
    () => {
      captureState.inCopyEvent = true;
      setTimeout(() => {
        captureState.inCopyEvent = false;
      }, 0);
    },
    true
  );

  try {
    const proto = DataTransfer?.prototype;
    const originalSetData = proto?.setData;
    if (proto && typeof originalSetData === "function") {
      proto.setData = function (format, data) {
        try {
          const f = String(format || "").toLowerCase();
          const d = typeof data === "string" ? data : String(data || "");
          if (
            captureState.inCopyEvent &&
            (f.includes("text") || f.includes("plain")) &&
            isHttpUrl(d)
          ) {
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
          const cmd = String(commandId || "").toLowerCase();
          if (cmd === "copy") {
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
    const originalTaSelect = taProto?.select;
    const originalInSelect = inProto?.select;

    if (taProto && typeof originalTaSelect === "function") {
      taProto.select = function () {
        try {
          const v = typeof this.value === "string" ? this.value : "";
          if (isHttpUrl(v)) {
            captureState.lastClipboardText = v.trim();
            captureState.lastClipboardAt = Date.now();
          }
        } catch (e) {}
        return originalTaSelect.apply(this, arguments);
      };
    }

    if (inProto && typeof originalInSelect === "function") {
      inProto.select = function () {
        try {
          const v = typeof this.value === "string" ? this.value : "";
          if (isHttpUrl(v)) {
            captureState.lastClipboardText = v.trim();
            captureState.lastClipboardAt = Date.now();
          }
        } catch (e) {}
        return originalInSelect.apply(this, arguments);
      };
    }
  } catch (e) {}

  try {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return;
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
  } catch (e) {}
}

function isHttpUrl(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return /^https?:\/\//i.test(s);
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

function inferType(downloadBtn) {
  const row = downloadBtn.closest("tr, li, div") || downloadBtn.parentElement;
  const t = (row?.innerText || "").toLowerCase();

  if (t.includes("lora") || t.includes("洛拉")) return "loras";
  if (t.includes("controlnet") || t.includes("控制网")) return "controlnet";
  if (t.includes("vae")) return "vae";
  if (t.includes("upscale") || t.includes("esrgan") || t.includes("放大")) {
    return "upscale_models";
  }

  return "checkpoints";
}

function extractFilenameFromUrl(url) {
  try {
    const u = new URL(url);
    // 先尝试从 query 参数里取文件名（如 HuggingFace 的 ?download=true 类接口）
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

  // 取最后一段路径
  const base = trimmed.split("/").pop()?.split("\\").pop() || "";
  if (!base) return "";
  if (base.includes("..")) return "";

  // 放宽正则：允许中文、字母、数字、连字符、点、空格、括号、下划线
  // 同时过滤掉绝对不能出现在文件名里的字符
  const cleaned = base.replace(/[/\\:*?"<>|]/g, "_");
  if (!cleaned) return "";

  return cleaned;
}
