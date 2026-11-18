"""Local backend access-code persistence without altering existing credentials."""
import os
import re
import secrets


def access_token(root):
    override = os.environ.get("CS211_ACCESS_TOKEN")
    if override:
        return override
    root.mkdir(parents=True, exist_ok=True)
    path = root / ".access-token"
    try:
        with path.open("x", encoding="utf-8") as file:
            token = f"{secrets.randbelow(1_000_000):06d}"
            file.write(token + "\n")
    except FileExistsError:
        pass
    token = path.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[0-9]{6}", token):
        raise ValueError(f"Invalid saved access code in {path}. Set CS211_ACCESS_TOKEN or remove this file to generate a new code.")
    return token
