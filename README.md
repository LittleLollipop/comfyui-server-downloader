# ComfyUI Server Downloader

这是一个专门为 ComfyUI 服务器部署环境设计的插件，旨在解决“缺失模型”提示对话框中只能通过浏览器下载的问题。

## 功能

- **Hook 缺失模型对话框**：自动在 ComfyUI 原生的“缺失模型”弹窗中为每个下载链接添加一个“☁️ Download to Server”按钮。
- **服务器端下载**：点击按钮后，ComfyUI 后端将直接在服务器上执行下载任务，并将模型保存到对应的目录（如 `models/checkpoints`、`models/loras` 等）。
- **自动分类**：尝试根据模型名称和上下文自动识别模型类型，并存放到正确的文件夹。

## 安装方法

1. 进入你的 ComfyUI `custom_nodes` 目录：
   ```bash
   cd ComfyUI/custom_nodes
   ```
2. 克隆或下载本项目：
   ```bash
   git clone https://github.com/your-repo/comfyui-server-downloader.git
   ```
3. 安装依赖（可选，ComfyUI 通常已内置 aiohttp）：
   ```bash
   pip install -r requirements.txt
   ```
4. 重启 ComfyUI。

## 使用说明

当你在加载工作流发现模型缺失时，ComfyUI 会弹出提示窗口。在本插件的作用下，你会看到除了原有的下载链接外，多出了一个“Download to Server”按钮。点击它，服务器就会开始静默下载。

## 注意事项

- 目前下载是在后台进行的，暂无进度条展示（可以通过查看服务器控制台日志确认进度）。
- 确保你的服务器网络能够访问 Civitai 或 HuggingFace。
