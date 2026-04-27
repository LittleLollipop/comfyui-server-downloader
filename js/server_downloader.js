import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

/**
 * Server Downloader Extension
 * Hooks into ComfyUI's Missing Models dialog and adds "Download to Server" capability.
 */
app.registerExtension({
    name: "Comfy.ServerDownloader",
    async setup() {
        console.log("[ServerDownloader] Extension Loaded");

        // Hook into the DOM to watch for the Missing Models dialog
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        if (node.classList && node.classList.contains("comfy-modal")) {
                            // Check if it's the Missing Models modal
                            const title = node.querySelector(".comfy-modal-content h2, .comfy-modal-content h1");
                            if (title && (title.innerText.includes("Missing Models") || title.innerText.includes("Missing nodes"))) {
                                processMissingModelsModal(node);
                            }
                        }
                    });
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }
});

/**
 * Process the Missing Models modal to add server-side download buttons
 * @param {HTMLElement} modal 
 */
function processMissingModelsModal(modal) {
    // Find all links that look like download links (Civitai, HF, etc.)
    const links = modal.querySelectorAll("a[href*='civitai.com'], a[href*='huggingface.co']");
    
    links.forEach(link => {
        if (link.dataset.serverDownloaderHooked) return;
        link.dataset.serverDownloaderHooked = "true";

        const url = link.href;
        const filename = link.innerText || "model.safetensors";
        
        // Create a "Download to Server" button next to the link
        const btn = document.createElement("button");
        btn.innerText = "☁️ Download to Server";
        btn.style.marginLeft = "10px";
        btn.style.padding = "2px 8px";
        btn.style.fontSize = "12px";
        btn.style.cursor = "pointer";
        btn.style.backgroundColor = "#444";
        btn.style.color = "#fff";
        btn.style.border = "1px solid #666";
        btn.style.borderRadius = "4px";

        btn.onclick = async (e) => {
            e.preventDefault();
            btn.disabled = true;
            btn.innerText = "⏳ Starting...";

            try {
                // Determine model type based on context (if possible) or default
                // The modal usually lists models under categories. We'll try to guess.
                let type = "checkpoints";
                const row = link.closest("tr") || link.parentElement;
                const text = row ? row.innerText.toLowerCase() : "";
                
                if (text.includes("lora")) type = "loras";
                else if (text.includes("controlnet")) type = "controlnet";
                else if (text.includes("vae")) type = "vae";
                else if (text.includes("upscale")) type = "upscale_models";

                const response = await api.fetchApi("/server_downloader/download", {
                    method: "POST",
                    body: JSON.stringify({
                        url: url,
                        filename: filename,
                        type: type
                    })
                });

                const result = await response.json();
                if (result.status === "success") {
                    btn.innerText = "✅ Started";
                    btn.title = result.message;
                } else {
                    btn.innerText = "❌ Error";
                    alert("Download failed: " + result.message);
                }
            } catch (err) {
                console.error("[ServerDownloader] Error:", err);
                btn.innerText = "❌ Error";
                btn.disabled = false;
            }
        };

        link.parentNode.insertBefore(btn, link.nextSibling);
    });
}
