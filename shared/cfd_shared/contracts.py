from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACTS_DIR = REPO_ROOT / "shared" / "contracts"


@lru_cache(maxsize=1)
def load_presets() -> dict[str, Any]:
    return json.loads((CONTRACTS_DIR / "presets.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_job_schema() -> dict[str, Any]:
    return json.loads((CONTRACTS_DIR / "job-schema.json").read_text(encoding="utf-8"))
