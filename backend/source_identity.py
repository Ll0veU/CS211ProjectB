"""Capture the complete modular Python implementation in new run identity snapshots."""
import hashlib
from pathlib import Path


def backend_hashes():
    root = Path(__file__).resolve().parent
    return {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.glob("*.py")) if not path.is_symlink()}
