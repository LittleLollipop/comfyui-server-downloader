import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
  name: "ComfyUI.ServerDownloader",
  async setup() {
    console.log("[ServerDownloader] loaded");

    const tryProcess = (root) => {
      if (!(root instanceof HTMLElement)) return;
      const text = (root.innerText || "").toLowerCase();
      if (
        text.includes("missing models") ||
        text.includes("missing model") ||
        text.includes("缺失模型")
      ) {
        processMissingModelsContainer(root);
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => tryProcess(node));
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    tryProcess(document.body);
  },
});

function processMissingModelsContainer(container) {
  const candidates = container.querySelectorAll(
    "button, a, [role='button']"
  );

  candidates.forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.serverDownloaderHooked === "1") return;

    const label = (el.innerText || "").trim().toLowerCase();
    const isDownload =
      label === "download" ||
      label.includes("download") ||
      label === "下载" ||
      label.includes("下载");
    if (!isDownload) return;

    el.dataset.serverDownloaderHooked = "1";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerText = "Download to Server";
    btn.style.marginLeft = "8px";
    btn.style.padding = "2px 8px";
    btn.style.fontSize = "12px";
    btn.style.cursor = "pointer";

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      btn.disabled = true;
      const originalText = btn.innerText;
      btn.innerText = "Starting...";

      try {
        const { url, filename, type } = inferDownloadParams(el);
        const finalUrl = url || window.prompt("Model URL?") || "";
        if (!finalUrl) {
          btn.innerText = originalText;
          btn.disabled = false;
          return;
        }

        const finalFilename =
          sanitizeFilename(filename) ||
          sanitizeFilename(extractFilenameFromUrl(finalUrl)) ||
          sanitizeFilename(window.prompt("Save as filename?") || "") ||
          "model.safetensors";

        const response = await api.fetchApi("/server_downloader/download", {
          method: "POST",
          body: JSON.stringify({
            url: finalUrl,
            filename: finalFilename,
            type,
          }),
        });

        const result = await response.json();
        if (result.status === "success") {
          btn.innerText = "Queued";
          btn.title = result.dest || "";
        } else {
          btn.innerText = "Failed";
          btn.disabled = false;
          window.alert(result.message || "Download failed");
        }
      } catch (err) {
        console.error("[ServerDownloader] error", err);
        btn.innerText = "Error";
        btn.disabled = false;
      }
    });

    el.insertAdjacentElement("afterend", btn);
  });
}

function inferDownloadParams(downloadEl) {
  const url = inferUrl(downloadEl);
  const filename = inferFilename(downloadEl, url);
  const type = inferType(downloadEl);

  return { url, filename, type };
}

function inferUrl(downloadEl) {
  if (downloadEl instanceof HTMLAnchorElement && downloadEl.href) {
    return downloadEl.href;
  }

  const parent = downloadEl.closest("tr, li, div") || downloadEl.parentElement;
  const anchor = parent?.querySelector?.("a[href^='http']");
  if (anchor && anchor.href) return anchor.href;

  const onclickStr = downloadEl.getAttribute("onclick") || "";
  const match = onclickStr.match(/https?:\/\/[^\s'\"]+/i);
  if (match) return match[0];

  return "";
}

function inferFilename(downloadEl, url) {
  const parent = downloadEl.closest("tr, li, div") || downloadEl.parentElement;
  const parentText = (parent?.innerText || "").trim();

  const textCandidates = [
    parentText,
    (downloadEl.innerText || "").trim(),
    (downloadEl.getAttribute("data-filename") || "").trim(),
  ].filter(Boolean);

  for (const t of textCandidates) {
    const m = t.match(/[\w\-\.]+\.(safetensors|ckpt|pt|pth|bin|gguf)/i);
    if (m) return m[0];
  }

  if (url) return extractFilenameFromUrl(url);
  return "";
}

function inferType(downloadEl) {
  const parent = downloadEl.closest("tr, li, div") || downloadEl.parentElement;
  const t = (parent?.innerText || "").toLowerCase();

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

