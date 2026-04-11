from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


REPO_ROOT = Path(__file__).resolve().parents[2]


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CFD_", env_file=".env", extra="ignore")

    storage_root: Path = Field(default=REPO_ROOT / "storage")
    jobs_subdir: str = "jobs"
    artifacts_mount_path: str = "/artifacts"
    artifact_url_prefix: str = "/artifacts"
    wsl_openfoam_bashrc: str | None = None
    max_worker_threads: int = 2

    @property
    def jobs_root(self) -> Path:
        return self.storage_root / self.jobs_subdir
