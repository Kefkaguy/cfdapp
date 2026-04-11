from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from shared.cfd_shared.models import (
    ComputeTarget,
    JobPaths,
    JobRecord,
    JobStage,
    JobStatus,
    QualityPreset,
    ResourceCap,
)

from .repository import JobRepository


class JobService:
    def __init__(self, repository: JobRepository) -> None:
        self.repository = repository

    async def create_job(
        self,
        upload: UploadFile,
        compute_target: ComputeTarget,
        quality_preset: QualityPreset,
        resource_cap: ResourceCap,
    ) -> JobRecord:
        file_name = Path(upload.filename or "geometry.stl").name
        if not file_name.lower().endswith(".stl"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Only STL uploads are supported for the MVP.",
            )

        paths = self.repository.create_job_paths(file_name)
        content = await upload.read()
        if not content:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="The uploaded STL was empty.",
            )
        self.repository.save_upload(paths["input_file"], content)

        now = datetime.now(UTC)
        job = JobRecord(
            id=str(paths["job_id"]),
            fileName=file_name,
            status=JobStatus.QUEUED,
            stage=JobStage.QUEUED,
            computeTarget=compute_target,
            qualityPreset=quality_preset,
            resourceCap=resource_cap,
            createdAt=now,
            updatedAt=now,
            paths=JobPaths(
                jobDir=str(paths["job_dir"]),
                inputFile=str(paths["input_file"]),
                caseDir=str(paths["case_dir"]),
                logsDir=str(paths["logs_dir"]),
                resultDir=str(paths["result_dir"]),
            ),
        )
        return self.repository.save_job(job)
