from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from shared.cfd_shared.contracts import load_job_schema, load_presets
from shared.cfd_shared.models import ComputeTarget, QualityPreset, ResourceCap
from worker.cfd_worker.runner import JobRunner, ThreadedLocalJobRunner

from .config import AppSettings
from .repository import JobRepository
from .services import JobService


def create_app(settings: AppSettings | None = None, runner: JobRunner | None = None) -> FastAPI:
    resolved_settings = settings or AppSettings()
    repository = JobRepository(resolved_settings)
    job_service = JobService(repository)
    resolved_runner = runner or ThreadedLocalJobRunner(repository, resolved_settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        resolved_runner.shutdown()

    app = FastAPI(
        title="CFD App API",
        version="0.1.0",
        lifespan=lifespan,
        openapi_tags=[
            {"name": "jobs", "description": "Create and monitor simulation jobs."},
            {"name": "contracts", "description": "Shared schemas and preset metadata."},
        ],
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.mount(
        resolved_settings.artifacts_mount_path,
        StaticFiles(directory=resolved_settings.storage_root),
        name="artifacts",
    )

    app.state.settings = resolved_settings
    app.state.repository = repository
    app.state.job_service = job_service
    app.state.runner = resolved_runner

    @app.get("/health")
    async def healthcheck() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/contracts/presets", tags=["contracts"])
    async def presets() -> dict:
        return load_presets()

    @app.get("/contracts/job-schema", tags=["contracts"])
    async def job_schema() -> dict:
        return load_job_schema()

    @app.post("/jobs", tags=["jobs"], status_code=status.HTTP_201_CREATED)
    async def create_job(
        file: UploadFile = File(...),
        computeTarget: ComputeTarget = Form(ComputeTarget.LOCAL),
        qualityPreset: QualityPreset = Form(QualityPreset.PREVIEW),
        resourceCap: ResourceCap = Form(ResourceCap.BALANCED),
    ):
        if computeTarget != ComputeTarget.LOCAL:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Cloud compute is reserved for a later phase.",
            )
        if qualityPreset != QualityPreset.PREVIEW:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Only the Preview quality preset is enabled in the MVP.",
            )

        job = await app.state.job_service.create_job(file, computeTarget, qualityPreset, resourceCap)
        app.state.runner.submit(job.id)
        return job

    @app.get("/jobs/{job_id}", tags=["jobs"])
    async def get_job(job_id: str):
        job = app.state.repository.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
        return job

    @app.get("/jobs/{job_id}/results", tags=["jobs"])
    async def get_results(job_id: str):
        job = app.state.repository.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
        if job.status != "succeeded":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Results are only available after the job completes successfully.",
            )
        manifest = app.state.repository.get_manifest(job_id)
        if manifest is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Result manifest was not found.",
            )
        return manifest

    return app


app = create_app()
