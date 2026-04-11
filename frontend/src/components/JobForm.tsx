import { useState } from "react";

import type { PresetContracts, ResourceCap } from "../lib/types";

interface JobFormProps {
  contracts: PresetContracts | null;
  disabled: boolean;
  onSubmit: (file: File, resourceCap: ResourceCap) => Promise<void>;
}

export function JobForm({ contracts, disabled, onSubmit }: JobFormProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resourceCap, setResourceCap] = useState<ResourceCap>("balanced");
  const [submitting, setSubmitting] = useState(false);
  const activeResourceCaps = contracts?.resourceCaps.filter((option) => option.enabled) ?? [];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(selectedFile, resourceCap);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel panel-form" onSubmit={handleSubmit}>
      <div className="panel-header">
        <p className="eyebrow">Phase 1</p>
        <h2>Local Preview Run</h2>
      </div>
      <label className="field">
        <span>STL geometry</span>
        <input
          type="file"
          accept=".stl"
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          disabled={disabled || submitting}
        />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>Compute target</span>
          <select disabled value="local">
            <option value="local">Local</option>
          </select>
        </label>
        <label className="field">
          <span>Quality preset</span>
          <select disabled value="preview">
            <option value="preview">Preview</option>
          </select>
        </label>
        <label className="field">
          <span>Resource cap</span>
          <select
            value={resourceCap}
            onChange={(event) => setResourceCap(event.target.value as ResourceCap)}
            disabled={disabled || submitting}
          >
            {activeResourceCaps.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="submit" className="primary-button" disabled={!selectedFile || disabled || submitting}>
        {submitting ? "Submitting..." : "Start Simulation"}
      </button>
    </form>
  );
}
