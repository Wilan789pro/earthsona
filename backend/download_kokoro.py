"""Download the Kokoro-82M ONNX model and voices into backend/models (about 115 MB, done once).

    .venv\\Scripts\\python.exe download_kokoro.py

Source: https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0). Kokoro-82M is Apache-2.0.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ["kokoro-v1.0.int8.onnx", "voices-v1.0.bin"]
DEST = Path(__file__).resolve().parent / "models"


def main() -> int:
    DEST.mkdir(exist_ok=True)
    for name in FILES:
        target = DEST / name
        if target.exists() and target.stat().st_size > 1_000_000:
            print(f"already present: {name}")
            continue
        print(f"downloading {name} …")
        tmp = target.with_suffix(target.suffix + ".part")
        urllib.request.urlretrieve(BASE + name, tmp)
        tmp.replace(target)
        print(f"  done ({target.stat().st_size / 1e6:.0f} MB)")
    print("Kokoro model files ready in", DEST)
    return 0


if __name__ == "__main__":
    sys.exit(main())
