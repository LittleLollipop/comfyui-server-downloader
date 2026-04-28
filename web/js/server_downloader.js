import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

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
      const originalText = actionBtn.innerText;
      actionBtn.innerText = "Starting...";

      try {
        const url = inferUrl(btn) || (window.prompt("Model URL?") || "").trim();
        if (!url) {
          actionBtn.innerText = originalText;
          actionBtn.disabled = false;
          return;
        }

        const filename =
          sanitizeFilename(inferFilename(btn, url)) ||
          sanitizeFilename(extractFilenameFromUrl(url)) ||
          sanitizeFilename(window.prompt("Save as filename?") || "") ||
          "model.safetensors";

        const type = inferType(btn);

        const response = await api.fetchApi("/server_downloader/download", {
          method: "POST",
          body: JSON.stringify({ url, filename, type }),
        });

        const result = await response.json();
        if (result.status === "success") {
          actionBtn.innerText = "Queued";
          actionBtn.title = result.dest || "";
        } else {
          actionBtn.innerText = "Failed";
          actionBtn.disabled = false;
          window.alert(result.message || "Download failed");
        }
      } catch (err) {
        console.error("[ServerDownloader] error", err);
        actionBtn.innerText = "Error";
        actionBtn.disabled = false;
      }
    });

    btn.insertAdjacentElement("afterend", actionBtn);
  });
}

function inferUrl(downloadBtn) {
  const row = downloadBtn.closest("tr, li, div") || downloadBtn.parentElement;
  const a = row?.querySelector?.("a[href^='http']");
  if (a && a.href) return a.href;

  const onclickStr = downloadBtn.getAttribute("onclick") || "";
  const match = onclickStr.match(/https?:\/\/[^\s'\"]+/i);
  if (match) return match[0];

  return "";
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

