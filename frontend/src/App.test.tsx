import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/contracts/presets") {
      return response({
        computeTargets: [{ id: "local", label: "Local", enabled: true, description: "" }],
        qualityPresets: [{ id: "preview", label: "Preview", enabled: true, description: "" }],
        resourceCaps: [{ id: "balanced", label: "Balanced", enabled: true, description: "", cores: 4, nice: 5 }]
      });
    }
    if (url === "/jobs" || url.endsWith("/jobs")) {
      return response({
        id: "job-1",
        fileName: "body.stl",
        status: "queued",
        stage: "queued",
        computeTarget: "local",
        qualityPreset: "preview",
        resourceCap: "balanced",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        error: null,
        stageMessage: null,
        summary: null,
        logTail: []
      });
    }
    return response({});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("submits a local preview job", async () => {
  const user = userEvent.setup();
  render(<App />);

  await waitFor(() => expect(screen.getByText("Local Preview Run")).toBeInTheDocument());
  const file = new File(["solid body"], "body.stl", { type: "model/stl" });
  await user.upload(screen.getByLabelText("STL geometry"), file);
  await user.click(screen.getByRole("button", { name: "Start Simulation" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/jobs", expect.objectContaining({ method: "POST" })));
});

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
