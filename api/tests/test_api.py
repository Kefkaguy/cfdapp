from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from api.app.config import AppSettings
from api.app.main import create_app
from api.app.repository import JobRepository
from shared.cfd_shared.models import JobResultManifest, JobStage, JobStatus, JobSummary, ResultArtifact
from worker.cfd_worker.runner import JobRunner


class SynchronousMockRunner(JobRunner):
    def __init__(self, repository: JobRepository, settings: AppSettings) -> None:
        self.repository = repository
        self.settings = settings

    def submit(self, job_id: str) -> None:
        result_file = Path(self.repository.jobs_root / job_id / "results" / "pressure-surface.json")
        result_file.write_text(
            '{"positions":[0,0,0,1,0,0,0,1,0],"indices":[0,1,2],"pressure":[0.2,0.4,0.6],"pressureRange":[0.2,0.6]}',
            encoding="utf-8",
        )
        self.repository.update_job(
            job_id,
            status=JobStatus.SUCCEEDED,
            stage=JobStage.COMPLETED,
            startedAt=datetime.now(UTC),
            completedAt=datetime.now(UTC),
            summary=JobSummary(dragCoefficient=0.31, minPressure=0.2, maxPressure=0.6, meshCells=3),
        )
        self.repository.save_manifest(
            job_id,
            JobResultManifest(
                jobId=job_id,
                generatedAt=datetime.now(UTC),
                summary=JobSummary(dragCoefficient=0.31, minPressure=0.2, maxPressure=0.6, meshCells=3),
                artifacts=[
                    ResultArtifact(
                        kind="pressure-surface",
                        path="results/pressure-surface.json",
                        url=self.repository.artifact_url(job_id, "results/pressure-surface.json"),
                        contentType="application/json",
                    )
                ],
            ),
        )

    def shutdown(self) -> None:
        return None


def make_client(tmp_path: Path) -> TestClient:
    settings = AppSettings(storage_root=tmp_path / "storage")
    repository = JobRepository(settings)
    runner = SynchronousMockRunner(repository, settings)
    app = create_app(settings=settings, runner=runner)
    return TestClient(app)


def test_create_job_and_fetch_results(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    response = client.post(
        "/jobs",
        files={"file": ("body.stl", b"solid body\nendsolid body\n", "model/stl")},
        data={"computeTarget": "local", "qualityPreset": "preview", "resourceCap": "balanced"},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "queued"

    job_id = payload["id"]
    job_response = client.get(f"/jobs/{job_id}")
    assert job_response.status_code == 200
    assert job_response.json()["status"] == "succeeded"

    results_response = client.get(f"/jobs/{job_id}/results")
    assert results_response.status_code == 200
    results_payload = results_response.json()
    assert results_payload["artifacts"][0]["kind"] == "pressure-surface"


def test_rejects_non_stl_upload(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    response = client.post(
        "/jobs",
        files={"file": ("body.obj", b"o body", "text/plain")},
    )
    assert response.status_code == 422


def test_returns_404_for_unknown_job(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    response = client.get("/jobs/missing")
    assert response.status_code == 404
