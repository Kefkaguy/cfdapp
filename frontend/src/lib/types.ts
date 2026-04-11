export type ComputeTarget = "local" | "cloud";
export type QualityPreset = "preview" | "standard" | "high";
export type ResourceCap = "low-impact" | "balanced" | "max-speed";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobStage =
  | "queued"
  | "validating"
  | "building-case"
  | "meshing"
  | "solving"
  | "extracting"
  | "packaging"
  | "completed"
  | "failed";

export interface JobSummary {
  dragCoefficient: number | null;
  minPressure: number | null;
  maxPressure: number | null;
  meshCells: number | null;
}

export interface JobRecord {
  id: string;
  fileName: string;
  status: JobStatus;
  stage: JobStage;
  computeTarget: ComputeTarget;
  qualityPreset: QualityPreset;
  resourceCap: ResourceCap;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  stageMessage: string | null;
  summary: JobSummary | null;
  logTail: string[];
}

export interface ResultArtifact {
  kind: string;
  path: string;
  url: string;
  contentType: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface JobResultManifest {
  jobId: string;
  generatedAt: string;
  summary: JobSummary;
  artifacts: ResultArtifact[];
}

export interface PressureSurfacePayload {
  positions: number[];
  indices: number[];
  pressure: number[];
  pressureRange: [number, number];
}

export interface PresetOption {
  id: string;
  label: string;
  enabled: boolean;
  description: string;
}

export interface PresetContracts {
  computeTargets: PresetOption[];
  qualityPresets: PresetOption[];
  resourceCaps: Array<PresetOption & { cores: number; nice: number }>;
}
