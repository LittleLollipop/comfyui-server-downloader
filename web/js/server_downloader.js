import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const captureState = {
  lastClipboardText: "",
  lastClipboardAt: 0,
  inCopyEvent: false,
};

// ---- i18n Strings (English) ----
const i18n = {
  // Logs
  logFetchTypesFailed: "[ServerDownloader] Failed to fetch model types, using fallback list",

  // Button states
  btnDownload: "⬇ Server Download",
  btnDetecting: "Detecting...",
  btnSubmitting: "Submitting...",
  btnError: "Error",
  btnDone: "✅ Done",
  btnFailed: "❌ Failed",
  btnCancelled: "Cancelled",
  btnOffline: "Offline",
  btnStatusError: "Status Error",

  // Dialog
  dialogTitle: "📥 Download Model to Server",
  dialogUrlLabel: "Download URL *",
  dialogFilenameLabel: "Save Filename *",
  dialogTypeLabel: "Model Type (determines save directory) *",
  dialogTypeHint: "Select model type, corresponds to directory under ComfyUI/models/",
  dialogCustomTypeOption: "➕ Enter custom type...",
  dialogCustomTypePlaceholder: "Enter custom type name (directory name under models/)",
  dialogSaveLocation: "Save to: ",
  dialogCancel: "Cancel",
  dialogStartDownload: "Start Download",

  // Errors
  errorDownloadFailed: "Download failed: ",
  errorUnknown: "Unknown error",
  errorInvalidUrl: "⚠ Please enter a valid http/https download URL",
  errorEmptyFilename: "⚠ Filename cannot be empty",
  errorEmptyCustomType: "⚠ Please enter a custom type name",
  errorTaskError: "Error: ",

  // URL placeholder
  urlPlaceholder: "https://huggingface.co/... or https://civitai.com/...",
  filenamePlaceholder: "model.safetensors",

  // Auto-fill tooltip
  autoFillTooltip: "Re-extract filename from URL",
};

// ---- Model type cache (dynamically fetched from backend) ----
let _cachedTypes = null;
let _cachedModelsDir = "";

async function getModelTypes() {
  if (_cachedTypes) return _cachedTypes;
  try {
    const resp = await api.fetchApi("/server_downloader/list_types");
    const data = await resp.json();
    if (data.status === "success" && Array.isArray(data.types)) {
      _cachedTypes = data.types;
      _cachedModelsDir = data.models_dir || "";
    }
  } catch (e) {
    console.warn(i18n.logFetchTypesFailed, e);
  }
  if (!_cachedTypes) {
    // Fallback list
    _cachedTypes = [
      "checkpoints", "loras", "controlnet", "vae",
      "upscale_models", "embeddings", "clip", "unet", "diffusion_models",
    ];
  }
  return _cachedTypes;
}

installClipboardCapture();

app.registerExtension({
  name: "ComfyUI.ServerDownloader",
  async setup() {
    console.log("[ServerDownloader] loaded");
    // Pre-fetch type list so next dialog open doesn't have to wait
    getModelTypes().catch(() => {});

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

// ---- Inject "Server Download" button ----
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
    actionBtn.innerText = i18n.btnDownload;
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
      actionBtn.innerText = i18n.btnDetecting;

      try {
        const autoUrl = await inferUrlAsync(btn);
        const autoFilename = autoUrl
          ? sanitizeFilename(inferFilename(btn, autoUrl)) ||
            sanitizeFilename(extractFilenameFromUrl(autoUrl)) ||
            ""
          : "";
        const autoType = inferTypeFromDOM(btn);

        let clipboardHint = autoUrl;
        if (!clipboardHint) {
          try {
            const cb = await navigator.clipboard.readText();
            if (isHttpUrl(cb)) clipboardHint = cb.trim();
          } catch (_) {}
        }

        const result = await promptDownloadDialog({
          defaultUrl: clipboardHint || "",
          defaultFilename: autoFilename || i18n.filenamePlaceholder,
          defaultType: autoType || "checkpoints",
        });

        if (!result) {
          actionBtn.innerText = i18n.btnDownload;
          actionBtn.disabled = false;
          return;
        }

        actionBtn.innerText = i18n.btnSubmitting;

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
          actionBtn.innerText = i18n.btnDownload;
          actionBtn.disabled = false;
          window.alert(i18n.errorDownloadFailed + (data.message || i18n.errorUnknown));
          return;
        }

        actionBtn.dataset.serverDownloaderTaskId = data.task_id;
        actionBtn.title = i18n.dialogSaveLocation + (data.dest || "");
        actionBtn.innerText = "0%";
        pollStatus(actionBtn, data.task_id);
      } catch (err) {
        console.error("[ServerDownloader] error", err);
        actionBtn.innerText = i18n.btnError;
        actionBtn.disabled = false;
      }
    });

    btn.insertAdjacentElement("afterend", actionBtn);
  });
}

// ---- Download confirmation dialog (dynamic types + custom type) ----
async function promptDownloadDialog({ defaultUrl, defaultFilename, defaultType }) {
  // Fetch latest type list first (prefer cache)
  const typesList = await getModelTypes();

  return new Promise((resolve) => {
    const overlay = buildOverlay();

    const box = document.createElement("div");
    box.style.cssText = [
      "background:#2a2a2a",
      "border-radius:8px",
      "padding:24px",
      "width:520px",
      "max-width:94vw",
      "max-height:90vh",
      "overflow-y:auto",
      "box-shadow:0 4px 28px rgba(0,0,0,0.6)",
      "font-family:sans-serif",
      "color:#eee",
    ].join(";");

    const title = document.createElement("div");
    title.innerText = i18n.dialogTitle;
    title.style.cssText = "font-size:16px;font-weight:700;margin-bottom:18px;color:#fff;";

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

    // Error message
    const errMsg = document.createElement("div");
    errMsg.style.cssText = "color:#f44336;font-size:12px;min-height:18px;margin-bottom:6px;";

    // Button row
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:6px;";

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = i18n.dialogCancel;
    cancelBtn.style.cssText =
      "padding:7px 18px;font-size:13px;border-radius:4px;border:1px solid #555;background:transparent;color:#ccc;cursor:pointer;";

    const okBtn = document.createElement("button");
    okBtn.innerText = i18n.dialogStartDownload;
    okBtn.style.cssText =
      "padding:7px 18px;font-size:13px;border-radius:4px;border:none;background:#1a73e8;color:#fff;cursor:pointer;font-weight:600;";

    function doConfirm() {
      errMsg.innerText = "";

      const url = urlInput.value.trim();
      if (!isHttpUrl(url)) {
        errMsg.innerText = i18n.errorInvalidUrl;
        urlInput.focus();
        return;
      }

      const filename = sanitizeFilename(filenameInput.value.trim());
      if (!filename) {
        errMsg.innerText = i18n.errorEmptyFilename;
        filenameInput.focus();
        return;
      }

      let type = typeSelect.value;
      if (type === "__custom__") {
        const customVal = customInput.value.trim();
        if (!customVal) {
          errMsg.innerText = i18n.errorEmptyCustomType;
          customInput.focus();
          return;
        }
        type = customVal;
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
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target !== cancelBtn) doConfirm();
      if (e.key === "Escape") doCancel();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);

    // ---- Build input elements ----
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.value = defaultUrl || "";
    urlInput.placeholder = "https://...";
    urlInput.style.cssText = inputStyle;

    // Filename input with auto-fill button
    const filenameInput = document.createElement("input");
    filenameInput.type = "text";
    filenameInput.value = defaultFilename || "";
    filenameInput.placeholder = "model.safetensors";
    filenameInput.style.cssText = inputStyle;
    let filenameUserEdited = false;
    filenameInput.addEventListener("input", () => { filenameUserEdited = true; });

    const autoBtn = document.createElement("button");
    autoBtn.innerText = "✨ Auto";
    autoBtn.style.cssText = [
      "padding:4px 10px",
      "font-size:11px",
      "border-radius:4px",
      "border:1px solid #555",
      "background:#333",
      "color:#ccc",
      "cursor:pointer",
      "white-space:nowrap",
    ].join(";");
    autoBtn.title = i18n.autoFillTooltip || "Re-extract from URL";
    autoBtn.addEventListener("click", () => {
      const url = urlInput.value.trim();
      const name = extractFilenameFromUrl(url);
      const ext = inferExtensionFromUrl(url);
      filenameInput.value = name + (ext && !name.endsWith(ext) ? ext : "");
      filenameUserEdited = false;
    });

    const filenameRow = document.createElement("div");
    filenameRow.style.cssText = "display:flex;gap:6px;";
    filenameRow.appendChild(filenameInput);
    filenameRow.appendChild(autoBtn);

    // Type select
    const typeSelect = document.createElement("select");
    typeSelect.style.cssText = inputStyle;

    const customTypeVal = defaultType && !typesList.includes(defaultType)
      ? defaultType
      : null;

    typesList.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.text = t;
      if (t === defaultType) opt.selected = true;
      if (customTypeVal === t) opt.selected = true;
      typeSelect.appendChild(opt);
    });

    // Add custom option if needed
    if (customTypeVal) {
      const opt = document.createElement("option");
      opt.value = "__custom__";
      opt.text = `Custom: ${customTypeVal}`;
      opt.selected = true;
      typeSelect.appendChild(opt);
    } else {
      const opt = document.createElement("option");
      opt.value = "__custom__";
      opt.text = "➕ Custom...";
      typeSelect.appendChild(opt);
    }

    typeSelect.addEventListener("change", () => {
      customRow.style.display = typeSelect.value === "__custom__" ? "block" : "none";
    });

    const customInput = document.createElement("input");
    customInput.type = "text";
    customInput.placeholder = "my_custom_type";
    customInput.style.cssText = inputStyle;
    if (customTypeVal) customInput.value = customTypeVal;

    const customRow = document.createElement("div");
    customRow.style.cssText = "margin-top:6px;display:none;";
    customRow.appendChild(customInput);

    const typeRow = document.createElement("div");
    typeRow.style.cssText = "margin-bottom:14px;";
    const typeLbl = document.createElement("div");
    typeLbl.innerText = i18n.dialogTypeLabel;
    typeLbl.style.cssText = "font-size:12px;color:#aaa;margin-bottom:5px;";
    typeRow.appendChild(typeLbl);
    typeRow.appendChild(typeSelect);
    typeRow.appendChild(customRow);

    // Auto-fill filename when URL changes (if user hasn't manually edited)
    urlInput.addEventListener("input", () => {
      if (filenameUserEdited) return;
      const url = urlInput.value.trim();
      if (!url) return;
      // Auto-fill from URL inference
      const inferredType = inferTypeFromUrl(url);
      const name = extractFilenameFromUrl(url);
      const ext = inferExtensionFromUrl(url);

      // Update filename if empty or was auto-filled
      if (!filenameInput.value || !filenameUserEdited) {
        filenameInput.value = name + (ext && !name.endsWith(ext) ? ext : "");
      }

      // Auto-select type if user hasn't manually selected
      if (inferredType && typeSelect.value !== "__custom__") {
        for (const opt of typeSelect.options) {
          if (opt.value === inferredType) {
            typeSelect.value = inferredType;
            break;
          }
        }
      }
    });

    box.appendChild(title);
    box.appendChild(makeRow(i18n.dialogUrlLabel, urlInput));
    box.appendChild(makeRow(i18n.dialogFilenameLabel, filenameRow));
    box.appendChild(typeRow);
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

// ---- Status polling ----
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
        buttonEl.innerText = i18n.btnStatusError;
        buttonEl.disabled = false;
        return;
      }

      const state = task.state;
      if (state === "completed") {
        buttonEl.innerText = i18n.btnDone;
        buttonEl.style.background = "#2e7d32";
        buttonEl.disabled = true;
        return;
      }

      if (state === "error") {
        buttonEl.innerText = i18n.btnFailed;
        buttonEl.style.background = "#c62828";
        buttonEl.title = i18n.errorTaskError + (task.error || i18n.errorUnknown);
        buttonEl.disabled = false;
        return;
      }

      if (state === "cancelled") {
        buttonEl.innerText = i18n.btnCancelled;
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
      buttonEl.innerText = i18n.btnOffline;
      buttonEl.disabled = false;
      return;
    }
  }
}

// ---- Utility functions ----

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

function inferTypeFromDOM(downloadBtn) {
  let el = downloadBtn.parentElement;
  while (el && el !== document.body) {
    const t = (el.innerText || "").toLowerCase();
    if (t.length < 300) {
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

// ---- Infer model type from URL path ----
function inferTypeFromUrl(url) {
  if (!url) return "checkpoints";
  const lower = url.toLowerCase();
  // URL path patterns for common model types
  if (/\/lora[s]?[\/\?]/.test(lower) || lower.includes("/loras/") || lower.includes("/lora/")) return "loras";
  if (/\/controlnet[s]?[\/\?]/.test(lower) || lower.includes("/controlnet/")) return "controlnet";
  if (/\/vae[s]?[\/\?]/.test(lower) || lower.includes("/vae/")) return "vae";
  if (/\/(upscale|upscalers|esrgan|realesrgan)[\/\?]/.test(lower) || lower.includes("/upscale_model/")) return "upscale_models";
  if (/\/embedding[s]?[\/\?]/.test(lower) || lower.includes("/textual_inversion/") || lower.includes("/embeddings/")) return "embeddings";
  if (/\/unet[\/\?]/.test(lower)) return "unet";
  if (/\/clip[\/\?]/.test(lower)) return "clip";
  if (/\/diffusion[_model]?[\/\?]/.test(lower)) return "diffusion_models";
  // checkpoints last as most URLs don't have a type prefix
  if (/\/(checkpoints?|models?)[\/\?]/.test(lower) || lower.includes("/ckpt/") || lower.includes("/safetensors")) return "checkpoints";
  return "";
}

function extractFilenameFromUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    // Civitai: https://civitai.com/api/download/models/12345 -> no filename in URL
    // Civitai direct: https://civitai.com/api/download/models/xxx?filename=xxx.safetensors
    const qName = u.searchParams.get("filename") || u.searchParams.get("name");
    if (qName) return decodeURIComponent(qName);

    // HuggingFace: https://huggingface.co/username/model-name/resolve/main/model.safetensors
    // Extract "username/model-name" from path segments, skip "resolve", "main", "blob" etc.
    const segments = u.pathname.split("/").filter(Boolean);
    const skip = new Set(["resolve", "blob", "raw", "main", "master", "download", "files", "tree"]);
    const meaningful = segments.filter((s) => !skip.has(s) && !s.match(/^[a-f0-9]{40,}$/i));

    // If URL ends with a filename-like segment, use it
    const last = meaningful[meaningful.length - 1] || "";
    if (last && /\.\w+$/.test(last)) {
      return decodeURIComponent(last);
    }

    // Otherwise, try to build a name from the model path
    // e.g. ["username", "model-name"] -> "username__model-name.safetensors"
    if (meaningful.length >= 2) {
      const modelPart = meaningful.slice(-2).join("__");
      // Guess extension from URL host or content-type hint
      const ext = inferExtensionFromUrl(url);
      return `${modelPart}.${ext}`;
    }

    if (meaningful.length === 1) {
      const modelPart = meaningful[0];
      const ext = inferExtensionFromUrl(url);
      return `${modelPart}.${ext}`;
    }

    return "";
  } catch {
    return "";
  }
}

// Infer file extension from URL context (host, path hints)
function inferExtensionFromUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes("huggingface")) {
    if (lower.includes(".safetensors")) return "safetensors";
    if (lower.includes(".ckpt") || lower.includes(".pth")) return "ckpt";
    if (lower.includes(".bin")) return "bin";
    if (lower.includes(".gguf")) return "gguf";
    return "safetensors"; // HF default
  }
  if (lower.includes("civitai")) {
    if (lower.includes(".safetensors")) return "safetensors";
    if (lower.includes(".ckpt")) return "ckpt";
    return "safetensors"; // Civitai default
  }
  if (lower.includes(".safetensors")) return "safetensors";
  if (lower.includes(".ckpt") || lower.includes(".pt") || lower.includes(".pth")) return "ckpt";
  if (lower.includes(".gguf")) return "gguf";
  if (lower.includes(".bin")) return "bin";
  return "safetensors"; // Safe default
}

function sanitizeFilename(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return "";
  const base = trimmed.split("/").pop()?.split("\\").pop() || "";
  if (!base || base.includes("..")) return "";
  return base.replace(/[\/\\:*?"<>|]/g, "_");
}

// ---- Clipboard capture ----

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
