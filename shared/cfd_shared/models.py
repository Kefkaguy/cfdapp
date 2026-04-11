from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class ComputeTarget(str, Enum):
    LOCAL = "local"
    CLOUD = "cloud"


class QualityPreset(str, Enum):
    PREVIEW = "preview"
    STANDARD = "standard"
    HIGH = "high"


class ResourceCap(str, Enum):
    LOW_IMPACT = "low-impact"
    BALANCED = "balanced"
    MAX_SPEED = "max-speed"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class JobStage(str, Enum):
    QUEUED = "queued"
    VALIDATING = "validating"
    BUILDING_CASE = "building-case"
    MESHING = "meshing"
    SOLVING = "solving"
    EXTRACTING = "extracting"
    PACKAGING = "packaging"
    COMPLETED = "completed"
    FAILED = "failed"


class JobPaths(BaseModel):
    jobDir: str
    inputFile: str
    caseDir: str
    logsDir: str
    resultDir: str


class JobSummary(BaseModel):
    dragCoefficient: float | None = None
    minPressure: float | None = None
    maxPressure: float | None = None
    meshCells: int | None = None


class ResultArtifact(BaseModel):
    kind: str
    path: str
    url: str
    contentType: str
    metadata: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class JobResultManifest(BaseModel):
    jobId: str
    generatedAt: datetime
    summary: JobSummary
    artifacts: list[ResultArtifact]


class JobRecord(BaseModel):
    id: str
    fileName: str
    status: JobStatus
    stage: JobStage
    computeTarget: ComputeTarget
    qualityPreset: QualityPreset
    resourceCap: ResourceCap
    createdAt: datetime
    updatedAt: datetime
    startedAt: datetime | None = None
    completedAt: datetime | None = None
    error: str | None = None
    stageMessage: str | None = None
    summary: JobSummary | None = None
    logTail: list[str] = Field(default_factory=list)
    paths: JobPaths
