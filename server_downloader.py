import os
import aiohttp
import json
import asyncio
from aiohttp import web
from server import PromptServer
import folder_paths

# Define the web directory for JS extensions
WEB_DIRECTORY = "./js"

class ServerDownloader:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {}}
    
    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "ServerDownloader"

    def noop(self):
        return ()

NODE_CLASS_MAPPINGS = {
    "ServerDownloader": ServerDownloader
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ServerDownloader": "Server Downloader Helper"
}

# --- API Endpoints ---

@PromptServer.instance.routes.post("/server_downloader/download")
async def handle_download(request):
    try:
        data = await request.json()
        url = data.get("url")
        filename = data.get("filename")
        model_type = data.get("type", "checkpoints") # Default to checkpoints

        if not url:
            return web.json_response({"status": "error", "message": "No URL provided"}, status=400)

        # Determine target directory
        # model_type should correspond to ComfyUI's folder names (checkpoints, loras, etc.)
        try:
            target_dir = folder_paths.get_output_directory() # Fallback
            # Try to get the actual model path
            possible_paths = folder_paths.get_folder_paths(model_type)
            if possible_paths:
                target_dir = possible_paths[0]
            else:
                # If folder_paths doesn't know it, use a generic models path or checkpoints
                target_dir = os.path.join(folder_paths.models_dir, model_type)
        except Exception:
            target_dir = os.path.join(folder_paths.models_dir, "checkpoints")

        if not os.path.exists(target_dir):
            os.makedirs(target_dir, exist_ok=True)

        dest_path = os.path.join(target_dir, filename)

        # Start download in background or wait? 
        # For simplicity in this version, we'll wait for the download to start and return a task ID or success
        # But a real implementation should probably use a background task manager.
        
        async def download_task():
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as response:
                    if response.status == 200:
                        with open(dest_path, 'wb') as f:
                            while True:
                                chunk = await response.content.read(1024*1024) # 1MB chunks
                                if not chunk:
                                    break
                                f.write(chunk)
                        print(f"[ServerDownloader] Finished downloading {filename} to {dest_path}")
                    else:
                        print(f"[ServerDownloader] Failed to download {url}, status: {response.status}")

        # Fire and forget for now, or we could track it.
        asyncio.create_task(download_task())

        return web.json_response({
            "status": "success", 
            "message": f"Download started for {filename}",
            "dest": dest_path
        })

    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@PromptServer.instance.routes.get("/server_downloader/check_path")
async def check_path(request):
    # Helper to see where files will go
    model_type = request.query.get("type", "checkpoints")
    try:
        paths = folder_paths.get_folder_paths(model_type)
        return web.json_response({"paths": paths})
    except:
        return web.json_response({"paths": []})
