from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pyvista as pv
import trimesh

from api.app.config import AppSettings
from api.app.repository import JobRepository
from shared.cfd_shared.models import JobRecord, JobResultManifest, JobStage, JobStatus, JobSummary, ResultArtifact

from .openfoam_templates import build_case_files


class PipelineError(RuntimeError):
    pass


@dataclass(slots=True)
class ResourceProfile:
    cores: int
    nice: int


RESOURCE_PROFILES = {
    "low-impact": ResourceProfile(cores=2, nice=10),
    "balanced": ResourceProfile(cores=4, nice=5),
    "max-speed": ResourceProfile(cores=8, nice=0),
}


def run_job(job_id: str, repository: JobRepository, settings: AppSettings) -> None:
    job = repository.get_job(job_id)
    if job is None:
        raise FileNotFoundError(job_id)

    try:
        repository.update_job(
            job_id,
            status=JobStatus.RUNNING,
            stage=JobStage.VALIDATING,
            startedAt=datetime.now(UTC),
            stageMessage="Validating uploaded STL",
        )
        mesh = validate_stl(Path(job.paths.inputFile))

        repository.update_job(job_id, stage=JobStage.BUILDING_CASE, stageMessage="Creating OpenFOAM case")
        case_dir = build_case(job, settings)
        mesh.export(case_dir / "constant" / "triSurface" / "geometry.stl")

        repository.update_job(job_id, stage=JobStage.MESHING, stageMessage="Running mesh pipeline")
        run_openfoam(job, repository, settings)
        repository.update_job(job_id, stage=JobStage.EXTRACTING, stageMessage="Extracting pressure surface")
        summary = extract_results(job, repository)

        repository.update_job(job_id, stage=JobStage.PACKAGING, stageMessage="Writing result manifest")
        manifest = build_manifest(job_id, repository, summary)
        repository.save_manifest(job_id, manifest)
        repository.update_job(
            job_id,
            status=JobStatus.SUCCEEDED,
            stage=JobStage.COMPLETED,
            completedAt=datetime.now(UTC),
            stageMessage="Job completed",
            summary=summary,
        )
    except Exception as exc:  # noqa: BLE001
        repository.append_log(job_id, f"ERROR: {exc}")
        repository.update_job(
            job_id,
            status=JobStatus.FAILED,
            stage=JobStage.FAILED,
            completedAt=datetime.now(UTC),
            error=str(exc),
            stageMessage="Job failed",
        )


def validate_stl(stl_path: Path) -> trimesh.Trimesh:
    mesh = trimesh.load_mesh(stl_path, file_type="stl")
    if not isinstance(mesh, trimesh.Trimesh):
        raise PipelineError("The uploaded STL did not resolve to a single triangulated mesh.")
    if mesh.vertices.size == 0 or mesh.faces.size == 0:
        raise PipelineError("The STL did not contain any triangles.")
    return mesh


def build_case(job: JobRecord, settings: AppSettings) -> Path:
    case_dir = Path(job.paths.caseDir)
    for subdir in ("system", "constant", "constant/triSurface", "0"):
        (case_dir / subdir).mkdir(parents=True, exist_ok=True)
    profile = RESOURCE_PROFILES[job.resourceCap.value]
    for path, content in build_case_files(case_dir, "geometry", profile.cores).items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return case_dir


def run_openfoam(job: JobRecord, repository: JobRepository, settings: AppSettings) -> None:
    case_dir = Path(job.paths.caseDir)
    profile = RESOURCE_PROFILES[job.resourceCap.value]
    bashrc = settings.wsl_openfoam_bashrc or "/opt/openfoam10/etc/bashrc"
    case_path_wsl = windows_path_to_wsl(case_dir)
    preamble = [
        "set -o pipefail",
        "export ZSH_NAME=${ZSH_NAME:-}",
        f"source {bashrc}",
        "source_status=$?",
        "if ! command -v simpleFoam >/dev/null 2>&1; then",
        '  echo "OpenFOAM bootstrap failed; simpleFoam is unavailable after sourcing the environment."',
        "  exit ${source_status:-1}",
        "fi",
        "set -e",
        f"cd {case_path_wsl}",
    ]

    repository.update_job(job.id, stage=JobStage.MESHING, stageMessage="Generating mesh")
    mesh_lines = [
        "blockMesh",
        "surfaceFeatureExtract || true",
    ]
    if profile.cores > 1:
        mesh_lines.extend(
            [
                "decomposePar -force",
                f"mpirun --mca orte_base_help_aggregate 0 -np {profile.cores} snappyHexMesh -overwrite -parallel",
                "reconstructParMesh -constant -mergeTol 1e-6",
                "reconstructPar -constant",
                "decomposePar -force",
            ]
        )
    else:
        mesh_lines.extend(
            [
                "snappyHexMesh -overwrite",
            ]
        )

    mesh_script = "\n".join([*preamble, *mesh_lines]) + "\n"
    execute_wsl_script(mesh_script, repository, job.id, case_dir)

    repository.update_job(job.id, stage=JobStage.SOLVING, stageMessage="Running steady-state solver")
    try:
        solve_lines = []
        if profile.cores > 1:
            solve_lines.extend(
                [
                    f"mpirun --mca orte_base_help_aggregate 0 -np {profile.cores} foamRun -solver incompressibleFluid -parallel",
                    "reconstructPar -latestTime",
                ]
            )
        else:
            solve_lines.append("foamRun -solver incompressibleFluid")
        solve_lines.extend(
            [
                "foamToVTK -latestTime",
                "foamToVTK -latestTime -noInternal -excludePatches '( inlet outlet left right bottom top )' || true",
            ]
        )
        solve_script = "\n".join([*preamble, *solve_lines]) + "\n"
        execute_wsl_script(solve_script, repository, job.id, case_dir)
    except PipelineError:
        if profile.cores <= 1:
            raise
        repository.append_log(job.id, "Parallel solve failed; retrying with conservative serial settings.")
        repository.update_job(job.id, stage=JobStage.SOLVING, stageMessage="Retrying with conservative serial solver")
        write_conservative_solver_files(case_dir)
        fallback_lines = [
            "potentialFoam -writePhi || true",
            "foamRun -solver incompressibleFluid",
            "foamToVTK -latestTime",
            "foamToVTK -latestTime -noInternal -excludePatches '( inlet outlet left right bottom top )' || true",
        ]
        fallback_script = "\n".join([*preamble, *fallback_lines]) + "\n"
        execute_wsl_script(fallback_script, repository, job.id, case_dir)


def execute_wsl_script(script: str, repository: JobRepository, job_id: str, cwd: Path) -> None:
    local_script_path = cwd / "run-openfoam.sh"
    local_script_path.write_text(script, encoding="utf-8", newline="\n")
    script_path_wsl = windows_path_to_wsl(local_script_path)
    repository.append_log(job_id, f"Launching WSL script {script_path_wsl}")
    process = subprocess.Popen(
        ["wsl", "bash", script_path_wsl],
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert process.stdout is not None
    for line in process.stdout:
        repository.append_log(job_id, line.rstrip())
    code = process.wait()
    if code != 0:
        append_case_debug_logs(repository, job_id, cwd)
        if code == 3221225786:
            raise PipelineError(
                "WSL/OpenFOAM was interrupted before completion (exit code 3221225786 / 0xC000013A). "
                "Keep the API process running and avoid restarting the app during a solve."
            )
        raise PipelineError(f"WSL/OpenFOAM command failed with exit code {code}.")


def append_case_debug_logs(repository: JobRepository, job_id: str, case_dir: Path) -> None:
    for relative_path in (
        Path("constant/polyMesh/boundary"),
        Path("0/U"),
        Path("0/p"),
        Path("0/k"),
        Path("0/omega"),
        Path("0/nut"),
    ):
        target = case_dir / relative_path
        if not target.exists():
            continue
        repository.append_log(job_id, f"--- {relative_path.as_posix()} ---")
        for line in target.read_text(encoding="utf-8").splitlines()[:120]:
            repository.append_log(job_id, line)


def write_conservative_solver_files(case_dir: Path) -> None:
    (case_dir / "system" / "fvSolution").write_text(
        """FoamFile
{
    version 2.0;
    format ascii;
    class dictionary;
    object fvSolution;
}
solvers
{
    p
    {
        solver PCG;
        preconditioner DIC;
        tolerance 1e-6;
        relTol 0.05;
        maxIter 500;
    }
    pFinal
    {
        $p;
        relTol 0;
    }
    "(U|k|omega)"
    {
        solver smoothSolver;
        smoother symGaussSeidel;
        tolerance 1e-7;
        relTol 0.05;
        nSweeps 2;
    }
}
SIMPLE
{
    nNonOrthogonalCorrectors 2;
    consistent yes;
    residualControl
    {
        p 1e-2;
        U 1e-3;
        "(k|omega)" 1e-3;
    }
}
relaxationFactors
{
    fields
    {
        p 0.15;
    }
    equations
    {
        U 0.25;
        k 0.3;
        omega 0.3;
    }
}
""",
        encoding="utf-8",
    )
    (case_dir / "0" / "omega").write_text(
        """FoamFile
{
    version 2.0;
    format ascii;
    class volScalarField;
    object omega;
}
dimensions [0 0 -1 0 0 0 0];
internalField uniform 20;
boundaryField
{
    inlet { type fixedValue; value uniform 20; }
    outlet { type zeroGradient; }
    left { type symmetryPlane; }
    right { type symmetryPlane; }
    bottom { type symmetryPlane; }
    top { type symmetryPlane; }
    geometry { type omegaWallFunction; value uniform 20; }
}
""",
        encoding="utf-8",
    )


def extract_results(job: JobRecord, repository: JobRepository) -> JobSummary:
    vtk_dir = Path(job.paths.caseDir) / "VTK"
    vtk_files = list(vtk_dir.rglob("*.vtp")) + list(vtk_dir.rglob("*.vtk"))
    if not vtk_files:
        raise PipelineError("No VTK output was produced by the OpenFOAM run.")

    preferred = next(
        (
            path
            for path in vtk_files
            if "geometry" in path.as_posix().lower() and path.name.lower().endswith(".vtk")
        ),
        None,
    )
    if preferred is None:
        preferred = next((path for path in vtk_files if "geometry" in path.stem.lower()), None)
    if preferred is None:
        preferred = next((path for path in vtk_files if "case_" in path.name.lower()), vtk_files[0])

    dataset = pv.read(preferred)
    surface = dataset.extract_surface() if hasattr(dataset, "extract_surface") else dataset
    if hasattr(surface, "triangulate"):
        surface = surface.triangulate()
    if "p" not in surface.array_names:
        raise PipelineError("Pressure field 'p' was not found in the extracted dataset.")

    if surface.n_cells > 50000:
        surface = surface.decimate(0.75)

    pressure = np.asarray(surface["p"], dtype=float)
    payload = polydata_to_payload(surface, pressure)
    result_path = Path(job.paths.resultDir) / "pressure-surface.json"
    result_path.write_text(json.dumps(payload), encoding="utf-8")

    summary = JobSummary(
        dragCoefficient=read_drag_coefficient(Path(job.paths.caseDir)),
        minPressure=float(pressure.min()),
        maxPressure=float(pressure.max()),
        meshCells=int(surface.n_cells),
    )
    repository.append_log(job.id, f"Extracted pressure surface from {preferred.as_posix()} to {result_path.name}.")
    return summary


def build_manifest(job_id: str, repository: JobRepository, summary: JobSummary) -> JobResultManifest:
    return JobResultManifest(
        jobId=job_id,
        generatedAt=datetime.now(UTC),
        summary=summary,
        artifacts=[
            ResultArtifact(
                kind="pressure-surface",
                path="results/pressure-surface.json",
                url=repository.artifact_url(job_id, "results/pressure-surface.json"),
                contentType="application/json",
                metadata={"field": "p"},
            )
        ],
    )


def polydata_to_payload(surface: pv.DataSet, pressure: np.ndarray) -> dict[str, list[float] | list[int]]:
    points = np.asarray(surface.points, dtype=float)
    faces = surface.faces.reshape(-1, 4)[:, 1:] if hasattr(surface, "faces") and surface.faces.size else np.empty((0, 3), dtype=int)
    return {
        "positions": points.reshape(-1).tolist(),
        "indices": faces.reshape(-1).tolist(),
        "pressure": pressure.tolist(),
        "pressureRange": [float(pressure.min()), float(pressure.max())],
    }


def read_drag_coefficient(case_dir: Path) -> float | None:
    coeff_files = list((case_dir / "postProcessing").rglob("coefficient.dat"))
    if not coeff_files:
        return None
    lines = [line for line in coeff_files[0].read_text(encoding="utf-8").splitlines() if line and not line.startswith("#")]
    if not lines:
        return None
    parts = lines[-1].split()
    if len(parts) < 2:
        return None
    return float(parts[1])


def windows_path_to_wsl(path: Path) -> str:
    absolute = path.resolve()
    drive = absolute.drive.rstrip(":").lower()
    if not drive:
        raise PipelineError("Expected a Windows path for WSL translation.")
    remainder = absolute.as_posix().split(":/", 1)[1]
    return f"/mnt/{drive}/{remainder}"
