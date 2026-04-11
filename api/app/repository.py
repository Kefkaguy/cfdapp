from __future__ import annotations

import json
import os
import shutil
import time
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

from pydantic import ValidationError

from shared.cfd_shared.models import JobRecord, JobResultManifest

from .config import AppSettings


class JobRepository:
    def __init__(self, settings: AppSettings) -> None:
        self.settings = settings
        self.jobs_root = settings.jobs_root
        self.jobs_root.mkdir(parents=True, exist_ok=True)
        self._file_locks: dict[str, Lock] = defaultdict(Lock)

    def create_job_paths(self, file_name: str) -> dict[str, Path | str]:
        job_id = uuid4().hex
        job_dir = self.jobs_root / job_id
        input_dir = job_dir / "input"
        case_dir = job_dir / "case"
        logs_dir = job_dir / "logs"
        result_dir = job_dir / "results"
        for path in (input_dir, case_dir, logs_dir, result_dir):
            path.mkdir(parents=True, exist_ok=True)
        input_file = input_dir / file_name
        return {
            "job_id": job_id,
            "job_dir": job_dir,
            "input_file": input_file,
            "case_dir": case_dir,
            "logs_dir": logs_dir,
            "result_dir": result_dir,
        }

    def save_upload(self, destination: Path, content: bytes) -> None:
        destination.write_bytes(content)

    def save_job(self, job: JobRecord) -> JobRecord:
        self._write_json(self._job_file(job.id), job.model_dump(mode="json"))
        return job

    def get_job(self, job_id: str) -> JobRecord | None:
        path = self._job_file(job_id)
        if not path.exists():
            return None
        return self._read_json_model(path, JobRecord, self._lock_for(path))

    def update_job(self, job_id: str, **changes: Any) -> JobRecord:
        job = self.get_job(job_id)
        if job is None:
            raise FileNotFoundError(job_id)
        merged = job.model_copy(
            update={
                **changes,
                "updatedAt": datetime.now(UTC),
            }
        )
        return self.save_job(merged)

    def append_log(self, job_id: str, message: str, max_lines: int = 400) -> JobRecord:
        job = self.get_job(job_id)
        if job is None:
            raise FileNotFoundError(job_id)
        log_tail = [*job.logTail, message][-max_lines:]
        updated = job.model_copy(
            update={
                "logTail": log_tail,
                "updatedAt": datetime.now(UTC),
            }
        )
        return self.save_job(updated)

    def save_manifest(self, job_id: str, manifest: JobResultManifest) -> JobResultManifest:
        path = self._manifest_file(job_id)
        self._write_json(path, manifest.model_dump(mode="json"))
        return manifest

    def get_manifest(self, job_id: str) -> JobResultManifest | None:
        path = self._manifest_file(job_id)
        if not path.exists():
            return None
        return self._read_json_model(path, JobResultManifest, self._lock_for(path))

    def artifact_url(self, job_id: str, relative_path: str) -> str:
        safe_path = relative_path.replace("\\", "/")
        return f"{self.settings.artifact_url_prefix}/jobs/{job_id}/{safe_path}"

    def reset_job(self, job_id: str) -> None:
        shutil.rmtree(self.jobs_root / job_id, ignore_errors=True)

    def _job_file(self, job_id: str) -> Path:
        return self.jobs_root / job_id / "job.json"

    def _manifest_file(self, job_id: str) -> Path:
        return self.jobs_root / job_id / "results" / "manifest.json"

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
        lock = self._lock_for(path)
        with lock:
            temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            last_error: PermissionError | None = None
            for _ in range(10):
                try:
                    os.replace(temp_path, path)
                    return
                except PermissionError as exc:
                    last_error = exc
                    time.sleep(0.05)
            if temp_path.exists():
                temp_path.unlink(missing_ok=True)
            if last_error is not None:
                raise last_error

    @staticmethod
    def _read_json_model(
        path: Path,
        model_cls: type[JobRecord] | type[JobResultManifest],
        lock: Lock,
    ) -> JobRecord | JobResultManifest:
        last_error: ValidationError | None = None
        for _ in range(3):
            try:
                with lock:
                    return model_cls.model_validate_json(path.read_text(encoding="utf-8"))
            except ValidationError as exc:
                last_error = exc
                time.sleep(0.02)
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"Failed to read JSON model from {path}.")

    def _lock_for(self, path: Path) -> Lock:
        return self._file_locks[str(path.resolve())]
