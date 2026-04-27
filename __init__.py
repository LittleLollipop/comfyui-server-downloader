import os
import sys

# Add current directory to path so we can import our local modules
sys.path.append(os.path.dirname(__file__))

from .server_downloader import WEB_DIRECTORY, NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
