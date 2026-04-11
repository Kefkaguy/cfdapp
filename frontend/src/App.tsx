import { startTransition, useDeferredValue, useEffect, useState } from "react";

import { JobForm } from "./components/JobForm";
import { JobStatusCard } from "./components/JobStatusCard";
import { PressureViewer } from "./components/PressureViewer";
import { createJob, fetchJob, fetchPresets, fetchPressureSurface, fetchResults } from "./lib/api";
import type { JobRecord, JobResultManifest, PresetContracts, PressureSurfacePayload, ResourceCap } from "./lib/types";

export default function App() {
  const [contracts, setContracts] = useState<PresetContracts | null>(null);
  const [activeJob, setActiveJob] = useState<JobRecord | null>(null);
  const [resultManifest, setResultManifest] = useState<JobResultManifest | null>(null);
  const [pressureSurface, setPressureSurface] = useState<PressureSurfacePayload | null>(null);
  const [yawDegrees, setYawDegrees] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const deferredJob = useDeferredValue(activeJob);

  useEffect(() => {
    void fetchPresets()
      .then((payload) => setContracts(payload))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!activeJob || activeJob.status === "succeeded" || activeJob.status === "failed") {
      return;
    }
    const interval = window.setInterval(() => {
      void fetchJob(activeJob.id)
        .then((job) => {
          startTransition(() => {
            setActiveJob(job);
          });
        })
        .catch((reason: Error) => setError(reason.message));
    }, 2000);

    return () => window.clearInterval(interval);
  }, [activeJob]);

  useEffect(() => {
    if (!activeJob || activeJob.status !== "succeeded") {
      return;
    }
    void fetchResults(activeJob.id)
      .then((manifest) => {
        setResultManifest(manifest);
        const pressureArtifact = manifest.artifacts.find((artifact) => artifact.kind === "pressure-surface");
        if (!pressureArtifact) {
          throw new Error("Pressure surface artifact missing from manifest.");
        }
        return fetchPressureSurface(pressureArtifact.url);
      })
      .then((payload) => setPressureSurface(payload))
      .catch((reason: Error) => setError(reason.message));
  }, [activeJob]);

  async function handleSubmit(file: File, resourceCap: ResourceCap) {
    setError(null);
    setPressureSurface(null);
    setResultManifest(null);
    const job = await createJob(file, resourceCap);
    setActiveJob(job);
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">CFD Web App MVP</p>
          <h1>Local pressure-map preview for STL-based aero studies.</h1>
          <p className="hero-copy">
            Upload geometry, run the local worker through the stable jobs API, and inspect the extracted pressure
            surface in the browser.
          </p>
        </div>
        <div className="hero-chip">
          <span>Compute target</span>
          <strong>Local / WSL2</strong>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="layout-grid">
        <JobForm contracts={contracts} disabled={contracts == null} onSubmit={handleSubmit} />
        <JobStatusCard job={deferredJob} />
      </section>

      <PressureViewer
        payload={pressureSurface}
        summary={resultManifest?.summary ?? deferredJob?.summary ?? null}
        yawDegrees={yawDegrees}
        onYawChange={setYawDegrees}
      />
    </main>
  );
}
