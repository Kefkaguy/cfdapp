import type {
  JobRecord,
  JobResultManifest,
  PresetContracts,
  PressureSurfacePayload,
  ResourceCap,
} from "./types";

export async function fetchPresets(): Promise<PresetContracts> {
  return await getJson<PresetContracts>("/contracts/presets");
}

export async function createJob(file: File, resourceCap: ResourceCap): Promise<JobRecord> {
  const body = new FormData();
  body.set("file", file);
  body.set("computeTarget", "local");
  body.set("qualityPreset", "preview");
  body.set("resourceCap", resourceCap);
  return await requestJson<JobRecord>("/jobs", {
    method: "POST",
    body,
  });
}

export async function fetchJob(jobId: string): Promise<JobRecord> {
  return await getJson<JobRecord>(`/jobs/${jobId}`);
}

export async function fetchResults(jobId: string): Promise<JobResultManifest> {
  return await getJson<JobResultManifest>(`/jobs/${jobId}/results`);
}

export async function fetchPressureSurface(url: string): Promise<PressureSurfacePayload> {
  return await getJson<PressureSurfacePayload>(url);
}

async function getJson<T>(url: string): Promise<T> {
  return await requestJson<T>(url, { method: "GET" });
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}
