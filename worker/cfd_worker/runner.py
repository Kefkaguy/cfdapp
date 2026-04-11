from __future__ import annotations

from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor

from api.app.config import AppSettings
from api.app.repository import JobRepository

from .pipeline import run_job


class JobRunner(ABC):
    @abstractmethod
    def submit(self, job_id: str) -> None: ...

    @abstractmethod
    def shutdown(self) -> None: ...


class ThreadedLocalJobRunner(JobRunner):
    def __init__(self, repository: JobRepository, settings: AppSettings) -> None:
        self.repository = repository
        self.settings = settings
        self.executor = ThreadPoolExecutor(max_workers=settings.max_worker_threads, thread_name_prefix="cfd-job")

    def submit(self, job_id: str) -> None:
        self.executor.submit(run_job, job_id, self.repository, self.settings)

    def shutdown(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=False)
