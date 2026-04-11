import type { JobRecord } from "../lib/types";

interface JobStatusCardProps {
  job: JobRecord | null;
}

export function JobStatusCard({ job }: JobStatusCardProps) {
  if (!job) {
    return (
      <section className="panel">
        <div className="panel-header">
          <p className="eyebrow">Status</p>
          <h2>No active job</h2>
        </div>
        <p className="muted">Upload an STL to create a local preview run.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <p className="eyebrow">Status</p>
        <h2>{job.status}</h2>
      </div>
      <dl className="stats-grid">
        <div>
          <dt>Job ID</dt>
          <dd>{job.id}</dd>
        </div>
        <div>
          <dt>Stage</dt>
          <dd>{job.stage}</dd>
        </div>
        <div>
          <dt>Input</dt>
          <dd>{job.fileName}</dd>
        </div>
        <div>
          <dt>Preset</dt>
          <dd>{job.qualityPreset}</dd>
        </div>
      </dl>
      <p className="muted">{job.stageMessage ?? "Waiting for updates from the worker."}</p>
      {job.error ? <p className="error-callout">{job.error}</p> : null}
      <div className="log-block">
        {job.logTail.length ? job.logTail.map((line, index) => <div key={`${line}-${index}`}>{line}</div>) : "No logs yet."}
      </div>
    </section>
  );
}
