const state = {
  fetchApi: null,
  loadedAt: Date.now(),
};

init();

async function init() {
  let app = null;
  let api = null;

  try {
    ({ app } = await import("../../scripts/app.js"));
  } catch (e) {
    app = null;
  }

  try {
    ({ api } = await import("../../scripts/api.js"));
  } catch (e) {
    api = null;
  }

  state.fetchApi = api?.fetchApi
    ? api.fetchApi.bind(api)
    : async (path, options = {}) => {
        const headers = new Headers(options.headers || {});
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
        return fetch(path, { ...options, headers });
      };

  console.log("[ServerDownloader] loaded", {
    hasApp: !!app,
    hasApi: !!api,
    href: location.href,
  });

  mountBadge();
  startHooking(app);
}

function startHooking(app) {
  const install = () => {
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
    installGlobalClickCapture();
  };

  if (app?.registerExtension) {
    app.registerExtension({
      name: "ComfyUI.ServerDownloader",
      async setup() {
        install();
      },
    });
  } else {
    install();
  }
}

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
    el.dataset.serverDownloaderAutoIntercept = "1";

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

        const response = await state.fetchApi("/server_downloader/download", {
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

function mountBadge() {
  if (document.getElementById("server-downloader-badge")) return;

  const el = document.createElement("div");
  el.id = "server-downloader-badge";
  el.style.position = "fixed";
  el.style.right = "12px";
  el.style.bottom = "12px";
  el.style.zIndex = "2147483647";
  el.style.padding = "6px 10px";
  el.style.borderRadius = "8px";
  el.style.background = "rgba(0,0,0,0.65)";
  el.style.color = "#fff";
  el.style.fontSize = "12px";
  el.style.userSelect = "none";
  el.style.cursor = "pointer";
  el.textContent = "ServerDownloader: ON";

  el.addEventListener("click", async () => {
    const url = window.prompt("Model URL?") || "";
    if (!url) return;
    const filename =
      sanitizeFilename(window.prompt("Save as filename?") || "") ||
      sanitizeFilename(extractFilenameFromUrl(url)) ||
      "model.safetensors";
    const type = window.prompt("Model type? (checkpoints/loras/controlnet/vae)") || "checkpoints";

    try {
      const resp = await state.fetchApi("/server_downloader/download", {
        method: "POST",
        body: JSON.stringify({ url, filename, type }),
      });
      const result = await resp.json();
      window.alert(result.status === "success" ? "Queued" : result.message || "Failed");
    } catch (e) {
      window.alert("Request failed");
    }
  });

  document.body.appendChild(el);
}

function installGlobalClickCapture() {
  if (window.__serverDownloaderCaptureInstalled) return;
  window.__serverDownloaderCaptureInstalled = true;

  document.addEventListener(
    "click",
    (e) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!target) return;

      const clickable = target.closest("a, button, [role='button']");
      if (!(clickable instanceof HTMLElement)) return;

      const label = (clickable.innerText || "").trim().toLowerCase();
      const isDownloadish =
        label === "download" ||
        label.includes("download") ||
        label === "下载" ||
        label.includes("下载");
      if (!isDownloadish) return;

      const url = inferUrl(clickable);
      if (!url) return;

      if (clickable.dataset.serverDownloaderAutoIntercept !== "1") return;

      e.preventDefault();
      e.stopPropagation();

      const filename =
        sanitizeFilename(inferFilename(clickable, url)) ||
        sanitizeFilename(extractFilenameFromUrl(url)) ||
        "model.safetensors";
      const type = inferType(clickable);

      state
        .fetchApi("/server_downloader/download", {
          method: "POST",
          body: JSON.stringify({ url, filename, type }),
        })
        .then((r) => r.json())
        .then((result) => {
          console.log("[ServerDownloader] intercepted", result);
        })
        .catch((err) => console.error("[ServerDownloader] intercept error", err));
    },
    true
  );
}
