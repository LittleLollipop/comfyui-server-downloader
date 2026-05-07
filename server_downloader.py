import os
import aiohttp
import asyncio
import time
import uuid
from aiohttp import web
from server import PromptServer
import folder_paths

# Define the web directory for JS extensions
WEB_DIRECTORY = "./web/js"

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

_tasks_lock = asyncio.Lock()
_tasks = {}


def _now() -> float:
    return time.time()


def _format_error(e: Exception) -> str:
    return f"{type(e).__name__}: {e}"


async def _get_task(task_id: str):
    async with _tasks_lock:
        return _tasks.get(task_id)


async def _set_task(task_id: str, value):
    async with _tasks_lock:
        _tasks[task_id] = value


async def _update_task(task_id: str, patch: dict):
    async with _tasks_lock:
        existing = _tasks.get(task_id)
        if not existing:
            return
        existing.update(patch)


async def _delete_task(task_id: str):
    async with _tasks_lock:
        _tasks.pop(task_id, None)


@PromptServer.instance.routes.get("/server_downloader/list_types")
async def list_types(request):
    """返回 ComfyUI 所有已注册的模型类型目录，供前端动态生成下拉列表。"""
    try:
        # folder_names_and_paths 是 dict: {类型名: ([路径列表], [扩展名列表])}
        all_types = sorted(folder_paths.folder_names_and_paths.keys())
        # 同时返回 models 根目录路径，供前端参考
        return web.json_response({
            "status": "success",
            "types": all_types,
            "models_dir": folder_paths.models_dir,
        })
    except Exception as e:
        return web.json_response({
            "status": "error",
            "message": str(e),
            "types": ["checkpoints"],
        }, status=500)


async def _download_worker(task_id: str):
    task = await _get_task(task_id)
    if not task:
        return

    url = task["url"]
    dest_path = task["dest_path"]
    tmp_path = dest_path + ".part"

    await _update_task(task_id, {"status": "downloading", "started_at": _now()})

    try:
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=60)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as response:
                if response.status != 200:
                    await _update_task(task_id, {"status": "error", "error": f"HTTP {response.status}"})
                    return

                total = response.headers.get("Content-Length")
                total_bytes = int(total) if total and total.isdigit() else None
                await _update_task(task_id, {"total_bytes": total_bytes})

                downloaded = 0
                with open(tmp_path, "wb") as f:
                    async for chunk in response.content.iter_chunked(1024 * 1024):
                        if not chunk:
                            continue
                        f.write(chunk)
                        downloaded += len(chunk)
                        await _update_task(task_id, {"downloaded_bytes": downloaded, "updated_at": _now()})

        os.replace(tmp_path, dest_path)
        await _update_task(task_id, {"status": "completed", "completed_at": _now()})
    except asyncio.CancelledError:
        await _update_task(task_id, {"status": "cancelled", "completed_at": _now()})
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
        raise
    except Exception as e:
        await _update_task(task_id, {"status": "error", "error": _format_error(e), "completed_at": _now()})
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


@PromptServer.instance.routes.post("/server_downloader/download")
async def handle_download(request):
    try:
        data = await request.json()
        url = data.get("url")
        filename = data.get("filename")
        model_type = data.get("type", "checkpoints")

        if not url:
            return web.json_response({"status": "error", "message": "No URL provided"}, status=400)

        if not isinstance(filename, str) or not filename.strip():
            return web.json_response({"status": "error", "message": "No filename provided"}, status=400)

        safe_name = os.path.basename(filename.strip())
        if safe_name != filename.strip() or ".." in safe_name:
            return web.json_response({"status": "error", "message": "Invalid filename"}, status=400)

        try:
            possible_paths = folder_paths.get_folder_paths(model_type)
            target_dir = possible_paths[0] if possible_paths else os.path.join(folder_paths.models_dir, model_type)
        except Exception:
            target_dir = os.path.join(folder_paths.models_dir, "checkpoints")

        if not os.path.exists(target_dir):
            os.makedirs(target_dir, exist_ok=True)

        dest_path = os.path.join(target_dir, safe_name)

        task_id = uuid.uuid4().hex
        created_at = _now()

        task_record = {
            "id": task_id,
            "status": "queued",
            "url": url,
            "filename": safe_name,
            "type": model_type,
            "dest_path": dest_path,
            "created_at": created_at,
            "started_at": None,
            "updated_at": created_at,
            "completed_at": None,
            "downloaded_bytes": 0,
            "total_bytes": None,
            "error": None,
            "asyncio_task": None,
        }

        await _set_task(task_id, task_record)
        aio_task = asyncio.create_task(_download_worker(task_id))
        await _update_task(task_id, {"asyncio_task": aio_task})

        return web.json_response({
            "status": "success",
            "task_id": task_id,
            "dest": dest_path,
        })

    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@PromptServer.instance.routes.get("/server_downloader/status/{task_id}")
async def get_status(request):
    task_id = request.match_info.get("task_id")
    task = await _get_task(task_id)
    if not task:
        return web.json_response({"status": "error", "message": "Task not found"}, status=404)

    started_at = task.get("started_at")
    now = _now()
    downloaded = int(task.get("downloaded_bytes") or 0)
    total = task.get("total_bytes")

    elapsed = max(0.001, (now - started_at)) if started_at else None
    speed_bps = (downloaded / elapsed) if elapsed else None
    progress = (downloaded / total) if total and total > 0 else None

    return web.json_response({
        "status": "success",
        "task": {
            "id": task.get("id"),
            "state": task.get("status"),
            "filename": task.get("filename"),
            "type": task.get("type"),
            "dest": task.get("dest_path"),
            "downloaded_bytes": downloaded,
            "total_bytes": total,
            "progress": progress,
            "speed_bps": speed_bps,
            "error": task.get("error"),
        },
    })


@PromptServer.instance.routes.post("/server_downloader/cancel/{task_id}")
async def cancel_task(request):
    task_id = request.match_info.get("task_id")
    task = await _get_task(task_id)
    if not task:
        return web.json_response({"status": "error", "message": "Task not found"}, status=404)

    aio_task = task.get("asyncio_task")
    if aio_task and not aio_task.done():
        aio_task.cancel()
        return web.json_response({"status": "success", "message": "Cancel requested"})

    return web.json_response({"status": "success", "message": "Task already finished"})


@PromptServer.instance.routes.get("/server_downloader/check_path")
async def check_path(request):
    model_type = request.query.get("type", "checkpoints")
    try:
        paths = folder_paths.get_folder_paths(model_type)
        return web.json_response({"paths": paths})
    except:
        return web.json_response({"paths": []})
