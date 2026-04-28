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
    actionBtn.innerText = "Download to Server";
    actionBtn.style.marginLeft = "8px";
    actionBtn.style.padding = "2px 8px";
    actionBtn.style.fontSize = "12px";
    actionBtn.style.cursor = "pointer";

    actionBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      actionBtn.disabled = true;
      actionBtn.innerText = "Starting...";

      try {
        const url = await inferUrlAsync(btn);
        if (!url) {
          actionBtn.innerText = "No URL";
          actionBtn.disabled = false;
          return;
        }

        const filename =
          sanitizeFilename(inferFilename(btn, url)) ||
          sanitizeFilename(extractFilenameFromUrl(url)) ||
          "model.safetensors";

        const type = inferType(btn);

        const response = await api.fetchApi("/server_downloader/download", {
          method: "POST",
          body: JSON.stringify({ url, filename, type }),
        });

        const result = await response.json();
        if (result.status !== "success" || !result.task_id) {
          actionBtn.innerText = "Failed";
          actionBtn.disabled = false;
          window.alert(result.message || "Download failed");
          return;
        }

        actionBtn.dataset.serverDownloaderTaskId = result.task_id;
        actionBtn.title = result.dest || "";
        actionBtn.innerText = "0%";
        pollStatus(actionBtn, result.task_id);
      } catch (err) {
        console.error("[ServerDownloader] error", err);
        actionBtn.innerText = "Error";
        actionBtn.disabled = false;
      }
    });

    btn.insertAdjacentElement("afterend", actionBtn);
  });
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
    } catch (e) {
    }

    await sleep(0);
    await sleep(50);

    if (captureState.lastClipboardAt > beforeAt) {
      const v = captureState.lastClipboardText;
      if (isHttpUrl(v)) return v;
    }

    try {
      const v = await navigator.clipboard.readText();
      if (isHttpUrl(v)) return v;
    } catch (e) {
    }
  }

  return "";
}

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
        buttonEl.innerText = "Status?";
        buttonEl.disabled = false;
        return;
      }

      const state = task.state;
      if (state === "completed") {
        buttonEl.innerText = "Done";
        buttonEl.disabled = true;
        return;
      }

      if (state === "error") {
        buttonEl.innerText = "Error";
        buttonEl.title = task.error || "";
        buttonEl.disabled = false;
        return;
      }

      if (state === "cancelled") {
        buttonEl.innerText = "Cancelled";
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
      buttonEl.innerText = "Offline";
      buttonEl.disabled = false;
      return;
    }
  }
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

function inferUrl(downloadBtn) {
  const row = downloadBtn.closest("tr, li, div") || downloadBtn.parentElement;
  const a = row?.querySelector?.("a[href^='http']");
  if (a && a.href) return a.href;

  const attrUrl = findAnyUrlInAttributes(row);
  if (attrUrl) return attrUrl;

  const urlFromCopy = findUrlNearCopyButton(row);
  if (urlFromCopy) return urlFromCopy;

  const onclickStr = downloadBtn.getAttribute("onclick") || "";
  const match = onclickStr.match(/https?:\/\/[^\s'\"]+/i);
  if (match) return match[0];

  const rowText = row ? row.innerText || "" : "";
  const textMatch = rowText.match(/https?:\/\/[^\s'\"]+/i);
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

    const attrs = [
      "data-clipboard-text",
      "data-url",
      "data-href",
      "data-link",
      "href",
    ];
    for (const k of attrs) {
      const v = el.getAttribute(k);
      if (v && /^https?:\/\//i.test(v)) return v;
    }

    const onclickStr = el.getAttribute("onclick") || "";
    const match = onclickStr.match(/https?:\/\/[^\s'\"]+/i);
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
          if (captureState.inCopyEvent && (f.includes("text") || f.includes("plain")) && isHttpUrl(d)) {
            captureState.lastClipboardText = d.trim();
            captureState.lastClipboardAt = Date.now();
          }
        } catch (e) {
        }
        return originalSetData.apply(this, arguments);
      };
    }
  } catch (e) {
  }

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
      } catch (e) {
      }
      return original(text);
    };
  } catch (e) {
  }
}

function isHttpUrl(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return /^https?:\/\//i.test(s);
}

function inferFilename(downloadBtn, url) {
  const row = downloadBtn.closest("tr, li, div") || downloadBtn.parentElement;
  const rowText = (row?.innerText || "").trim();

  const m = rowText.match(/[\w\-\.]+\.(safetensors|ckpt|pt|pth|bin|gguf)/i);
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
  if (!base) return "";
  if (base.includes("..")) return "";
  if (!/^[\w\-\.\s]+$/.test(base)) return "";

  return base;
}
