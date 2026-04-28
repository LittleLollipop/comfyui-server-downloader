# ComfyUI Server Downloader

这是一个专门为 ComfyUI 服务器部署环境设计的插件，旨在解决“缺失模型”提示对话框中只能通过浏览器下载的问题。

## 功能

- **Hook 缺失模型对话框**：在“Missing Models/缺失模型”弹窗里为“Download/下载”按钮旁边添加 `Download to Server`。
- **服务器端下载**：点击按钮后，ComfyUI 后端将直接在服务器上执行下载任务，并将模型保存到对应的目录（如 `models/checkpoints`、`models/loras` 等）。
- **自动分类**：尝试根据模型名称和上下文自动识别模型类型，并存放到正确的文件夹。
- **进度显示**：按钮会实时显示百分比与下载速度（通过轮询后端下载状态）。

## 安装方法

1. 进入你的 ComfyUI `custom_nodes` 目录：
   ```bash
   cd ComfyUI/custom_nodes
   ```
2. 克隆或下载本项目：
   ```bash
   git clone https://github.com/your-repo/comfyui-server-downloader.git
   ```
3. 重启 ComfyUI。

## 关于 ComfyUI_frontend（独立新版前端）

- 本插件的前端代码位于 `web/js/server_downloader.js`，并在后端通过 `WEB_DIRECTORY = "./web/js"` 暴露。
- ComfyUI_frontend 会通过后端提供的扩展机制加载这些脚本，因此即使你用的是独立前端项目，也不需要把代码拷贝进 ComfyUI_frontend 仓库。
- 如果更新插件后按钮仍然不出现：
  - 重启后端 ComfyUI
  - 浏览器硬刷新（Ctrl+Shift+R / Cmd+Shift+R）
  - 在控制台确认出现 `[ServerDownloader] loaded`

## 使用说明

当你在加载工作流发现模型缺失时，ComfyUI 会弹出提示窗口。在本插件的作用下，你会看到除了原有的下载链接外，多出了一个“Download to Server”按钮。点击它，服务器就会开始静默下载。

本插件适配 **独立新版前端 ComfyUI_frontend**：前端扩展文件位于 `web/js/server_downloader.js`，通过 ComfyUI 的扩展加载机制注入到 ComfyUI_frontend。

## 注意事项

- 目前下载是在后台进行的，暂无进度条展示（可通过服务器控制台日志确认）。
- 如果某个条目没能自动解析到 URL，按钮会显示 `No URL`，这通常意味着该前端版本把链接藏在更深的组件里；此时需要再针对该弹窗结构做一次 URL 提取适配。
- 如果你更新了插件但界面没变化，请对浏览器做一次硬刷新（Ctrl+Shift+R / Cmd+Shift+R），并在浏览器控制台确认出现 `[ServerDownloader] loaded` 日志。
- 确保你的服务器网络能够访问 Civitai 或 HuggingFace。
