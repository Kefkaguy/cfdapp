import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { JobSummary, PressureSurfacePayload } from "../lib/types";

interface PressureViewerProps {
  payload: PressureSurfacePayload | null;
  summary: JobSummary | null;
  yawDegrees: number;
  onYawChange: (value: number) => void;
}

export function PressureViewer({ payload, summary, yawDegrees, onYawChange }: PressureViewerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const yawRef = useRef(yawDegrees);

  useEffect(() => {
    yawRef.current = yawDegrees;
  }, [yawDegrees]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !payload) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#02060d");
    scene.fog = new THREE.Fog("#02060d", 5, 14);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.01, 100);
    camera.position.set(3.2, 1.15, 2.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.2;
    controls.maxDistance = 8;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.18;
    controls.maxPolarAngle = Math.PI * 0.48;

    scene.add(new THREE.AmbientLight("#c8f7ff", 0.7));
    const keyLight = new THREE.DirectionalLight("#8bd8ff", 1.6);
    keyLight.position.set(4, 4, 2);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight("#89ffba", 1.05);
    rimLight.position.set(-3, 1.8, -3.5);
    scene.add(rimLight);
    const fillLight = new THREE.DirectionalLight("#2dc8ff", 0.45);
    fillLight.position.set(0, 3, 5);
    scene.add(fillLight);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(orientAndNormalizePositions(payload.positions), 3));
    geometry.setIndex(payload.indices);
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(buildVertexColors(payload), 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.02,
      roughness: 0.36,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 3;
    const wireframe = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 27),
      new THREE.LineBasicMaterial({
        color: "#c6fff0",
        transparent: true,
        opacity: 0.1,
        depthTest: true
      }),
    );
    wireframe.renderOrder = 4;
    const carGroup = new THREE.Group();
    carGroup.add(mesh);
    carGroup.add(wireframe);
    scene.add(carGroup);
    carGroup.rotation.y = THREE.MathUtils.degToRad(yawRef.current);

    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 1e-6);
    const center = box.getCenter(new THREE.Vector3());
    const slab = buildPressureSlab(size, center);
    scene.add(slab);
    const floor = buildFloorPlane(size, center);
    scene.add(floor);

    controls.target.set(center.x * 0.05, size.y * 0.18, center.z * 0.04);
    camera.position.set(maxDimension * 2.6, maxDimension * 0.82, maxDimension * 1.8);
    camera.near = maxDimension / 100;
    camera.far = maxDimension * 20;
    camera.updateProjectionMatrix();

    const freestreamGroup = buildFreestreamGroup(size, center);
    scene.add(freestreamGroup);

    const clock = new THREE.Clock();
    let animationFrame = 0;
    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const render = () => {
      const elapsed = clock.getElapsedTime();
      carGroup.rotation.y = THREE.MathUtils.degToRad(yawRef.current);
      animateFreestream(freestreamGroup, elapsed);
      animatePressureSlab(slab, elapsed);
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      freestreamGroup.traverse((child) => {
        if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      slab.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.material instanceof THREE.MeshBasicMaterial && child.material.map) {
            child.material.map.dispose();
          }
          child.geometry.dispose();
          disposeMaterial(child.material);
        } else if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          disposeMaterial(child.material);
        }
      });
      floor.geometry.dispose();
      disposeMaterial(floor.material);
      wireframe.geometry.dispose();
      disposeMaterial(wireframe.material);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [payload]);

  return (
    <section className="panel viewer-panel">
      <div className="panel-header">
        <p className="eyebrow">Results</p>
        <h2>Pressure Surface</h2>
      </div>
      <div className="viewer-shell">
        {payload ? <div className="viewer-canvas" ref={mountRef} /> : <div className="viewer-empty">Run a job to see the pressure map.</div>}
        <aside className="legend-panel">
          <div className="legend-bar" aria-hidden="true" />
          <label className="viewer-control">
            <span>Car yaw vs wind</span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={yawDegrees}
              onChange={(event) => onYawChange(Number(event.target.value))}
            />
            <strong>{`${yawDegrees}\u00B0`}</strong>
          </label>
          <p className="viewer-note">Freestream guides are illustrative. Surface color comes from the extracted solver output.</p>
          {summary ? (
            <dl className="summary-list">
              <div>
                <dt>Cd</dt>
                <dd>{formatNullable(summary.dragCoefficient)}</dd>
              </div>
              <div>
                <dt>P min</dt>
                <dd>{formatNullable(summary.minPressure)}</dd>
              </div>
              <div>
                <dt>P max</dt>
                <dd>{formatNullable(summary.maxPressure)}</dd>
              </div>
              <div>
                <dt>Cells</dt>
                <dd>{summary.meshCells ?? "n/a"}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Pressure and drag summary will appear after extraction completes.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function buildVertexColors(payload: PressureSurfacePayload): number[] {
  const pressure = mapPressureToVertices(payload);
  const [visualMin, visualMax] = getVisualPressureRange(pressure, payload.pressureRange);
  const range = Math.max(visualMax - visualMin, 1e-6);
  return pressure.flatMap((value) => {
    const normalized = THREE.MathUtils.clamp((value - visualMin) / range, 0, 1);
    const t = smoothContrast(normalized);
    const color = samplePressureColor(t);
    return [color.r, color.g, color.b];
  });
}

function getVisualPressureRange(pressure: number[], fallbackRange: [number, number]): [number, number] {
  const finite = pressure.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (finite.length < 8) {
    return fallbackRange;
  }

  const low = finite[Math.floor((finite.length - 1) * 0.03)];
  const high = finite[Math.ceil((finite.length - 1) * 0.97)];
  if (high - low > 1e-6) {
    return [low, high];
  }
  return fallbackRange;
}

function smoothContrast(t: number): number {
  const eased = t * t * (3 - 2 * t);
  return THREE.MathUtils.clamp((eased - 0.08) / 0.84, 0, 1);
}

function mapPressureToVertices(payload: PressureSurfacePayload): number[] {
  const vertexCount = payload.positions.length / 3;
  if (payload.pressure.length === vertexCount) {
    return payload.pressure;
  }

  const faceCount = payload.indices.length / 3;
  if (payload.pressure.length === faceCount) {
    const totals = Array.from({ length: vertexCount }, () => 0);
    const counts = Array.from({ length: vertexCount }, () => 0);
    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      const pressure = payload.pressure[faceIndex];
      for (let corner = 0; corner < 3; corner += 1) {
        const vertexIndex = payload.indices[faceIndex * 3 + corner];
        totals[vertexIndex] += pressure;
        counts[vertexIndex] += 1;
      }
    }
    return totals.map((total, index) => (counts[index] === 0 ? payload.pressure[0] : total / counts[index]));
  }

  const fallback = payload.pressure.length > 0 ? payload.pressure[0] : payload.pressureRange[0];
  return Array.from({ length: vertexCount }, () => fallback);
}

function samplePressureColor(t: number): THREE.Color {
  const stops: Array<[number, string]> = [
    [0, "#2457ff"],
    [0.25, "#14d9ff"],
    [0.48, "#16d05e"],
    [0.72, "#f3ef3d"],
    [1, "#ff3d24"]
  ];
  for (let index = 1; index < stops.length; index += 1) {
    const [stopT, stopColor] = stops[index];
    if (t <= stopT) {
      const [previousT, previousColor] = stops[index - 1];
      const localT = (t - previousT) / Math.max(stopT - previousT, 1e-6);
      return new THREE.Color(previousColor).lerp(new THREE.Color(stopColor), localT);
    }
  }
  return new THREE.Color(stops[stops.length - 1][1]);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      entry.dispose();
    }
    return;
  }
  material.dispose();
}

function formatNullable(value: number | null): string {
  return value == null ? "n/a" : value.toFixed(4);
}

function orientAndNormalizePositions(positions: number[]): number[] {
  const vectors: Array<[number, number, number]> = [];
  for (let index = 0; index < positions.length; index += 3) {
    vectors.push([positions[index], positions[index + 1], positions[index + 2]]);
  }

  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  for (const vector of vectors) {
    for (let axis = 0; axis < 3; axis += 1) {
      mins[axis] = Math.min(mins[axis], vector[axis]);
      maxs[axis] = Math.max(maxs[axis], vector[axis]);
    }
  }

  const extents = maxs.map((value, axis) => value - mins[axis]);
  const longestAxis = extents.indexOf(Math.max(...extents));
  const shortestAxis = extents.indexOf(Math.min(...extents));
  const middleAxis = [0, 1, 2].find((axis) => axis !== longestAxis && axis !== shortestAxis) ?? 2;
  const axisOrder = [longestAxis, shortestAxis, middleAxis];

  const remapped: number[] = [];
  const axisMins = [Infinity, Infinity, Infinity];
  const axisMaxs = [-Infinity, -Infinity, -Infinity];

  for (const vector of vectors) {
    const next = [vector[axisOrder[0]], vector[axisOrder[1]], vector[axisOrder[2]]];
    remapped.push(next[0], next[1], next[2]);
    for (let axis = 0; axis < 3; axis += 1) {
      axisMins[axis] = Math.min(axisMins[axis], next[axis]);
      axisMaxs[axis] = Math.max(axisMaxs[axis], next[axis]);
    }
  }

  const center = axisMins.map((minValue, axis) => (minValue + axisMaxs[axis]) / 2);
  const maxAxis = Math.max(axisMaxs[0] - axisMins[0], axisMaxs[1] - axisMins[1], axisMaxs[2] - axisMins[2], 1e-6);
  const floor = axisMins[1];

  for (let index = 0; index < remapped.length; index += 3) {
    remapped[index] = (remapped[index] - center[0]) / maxAxis;
    remapped[index + 1] = (remapped[index + 1] - floor) / maxAxis;
    remapped[index + 2] = (remapped[index + 2] - center[2]) / maxAxis;
  }

  return remapped;
}

function buildFreestreamGroup(size: THREE.Vector3, center: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  const lineCount = 18;
  const pointsPerLine = 72;
  const lineLength = size.x * 5.9;
  const spacing = Math.max(size.z * 0.2, 0.12);
  const startX = center.x - lineLength * 0.56;
  const endX = center.x + lineLength * 0.44;
  const y = size.y * 0.74;
  const waveAmplitude = Math.max(size.z * 0.035, 0.012);
  const streamZValues = buildStreamZValues(center.z, size.z, spacing, lineCount);

  for (let index = 0; index < streamZValues.length; index += 1) {
    const z = streamZValues[index];
    const points: THREE.Vector3[] = [];
    for (let pointIndex = 0; pointIndex < pointsPerLine; pointIndex += 1) {
      const t = pointIndex / (pointsPerLine - 1);
      points.push(new THREE.Vector3(THREE.MathUtils.lerp(startX, endX, t), y, z));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: "#66d8ff",
      transparent: true,
      opacity: 0.42,
      depthTest: true
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 1;
    line.userData.wave = {
      baseY: y,
      baseZ: z,
      phase: index * 0.42,
      amplitude: waveAmplitude,
      startX,
      endX,
      pointsPerLine
    };
    group.add(line);

    if (index % 4 === 0) {
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(size.x * 0.016, 10, 10),
        new THREE.MeshBasicMaterial({ color: "#9ae7ff", transparent: true, opacity: 0.82, depthTest: true }),
      );
      bead.renderOrder = 2;
      bead.userData.stream = {
        baseY: y,
        baseZ: z,
        phase: index * 0.37,
        amplitude: waveAmplitude,
        startX,
        endX
      };
      bead.position.set(THREE.MathUtils.lerp(startX, endX, 0.18 + (index % 3) * 0.22), y, z);
      group.add(bead);
    }
  }

  const arrowMaterial = new THREE.MeshBasicMaterial({ color: "#b7f1ff", transparent: true, opacity: 0.82, depthTest: true });
  const arrowGeometry = new THREE.ConeGeometry(size.x * 0.055, size.x * 0.14, 3);
  for (let index = 0; index < 3; index += 1) {
    const arrow = new THREE.Mesh(arrowGeometry.clone(), arrowMaterial.clone());
    arrow.renderOrder = 2;
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.set(startX - size.x * 0.07, y - index * size.y * 0.14, center.z - size.z * 0.82);
    group.add(arrow);
  }
  arrowGeometry.dispose();
  arrowMaterial.dispose();

  return group;
}

function buildStreamZValues(centerZ: number, sizeZ: number, spacing: number, lineCount: number): number[] {
  const values: number[] = [];
  const halfCount = Math.ceil(lineCount / 2);
  const centralGap = Math.max(sizeZ * 0.62, spacing * 1.4);
  for (let index = 0; index < halfCount; index += 1) {
    const offset = centralGap + index * spacing;
    values.push(centerZ - offset, centerZ + offset);
  }
  return values.slice(0, lineCount).sort((a, b) => a - b);
}

function animateFreestream(group: THREE.Group, elapsed: number): void {
  group.children.forEach((child) => {
    if (child instanceof THREE.Line && child.userData.wave) {
      const wave = child.userData.wave as {
        baseY: number;
        baseZ: number;
        phase: number;
        amplitude: number;
        startX: number;
        endX: number;
        pointsPerLine: number;
      };
      const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < wave.pointsPerLine; index += 1) {
        const t = index / (wave.pointsPerLine - 1);
        const x = THREE.MathUtils.lerp(wave.startX, wave.endX, t);
        const ripple = Math.sin(t * Math.PI * 5.5 - elapsed * 3.8 + wave.phase);
        positions.setXYZ(index, x, wave.baseY + ripple * wave.amplitude * 0.42, wave.baseZ + ripple * wave.amplitude);
      }
      positions.needsUpdate = true;
      return;
    }

    if (child instanceof THREE.Mesh && child.userData.stream) {
      const stream = child.userData.stream as {
        baseY: number;
        baseZ: number;
        phase: number;
        amplitude: number;
        startX: number;
        endX: number;
      };
      const progress = (elapsed * 0.22 + stream.phase) % 1;
      const ripple = Math.sin(progress * Math.PI * 5.5 - elapsed * 3.8 + stream.phase);
      child.position.set(
        THREE.MathUtils.lerp(stream.startX, stream.endX, progress),
        stream.baseY + ripple * stream.amplitude * 0.42,
        stream.baseZ + ripple * stream.amplitude
      );
    }
  });
}

function buildPressureSlab(size: THREE.Vector3, center: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  const texture = makePressureSlabTexture();
  const geometry = new THREE.PlaneGeometry(size.x * 1.62, size.z * 1.35, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true
  });
  const slab = new THREE.Mesh(geometry, material);
  slab.renderOrder = 0;
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(center.x * 0.08, -0.055, center.z * 0.04);
  group.add(slab);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: "#d8ff5d",
      transparent: true,
      opacity: 0.16,
      depthTest: true
    }),
  );
  outline.renderOrder = 1;
  outline.rotation.x = -Math.PI / 2;
  outline.position.copy(slab.position);
  group.add(outline);

  return group;
}

function animatePressureSlab(group: THREE.Group, elapsed: number): void {
  group.children.forEach((child, index) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
      child.material.opacity = 0.32 + Math.sin(elapsed * 1.8) * 0.04;
      child.position.y = -0.055 + Math.sin(elapsed * 1.45) * 0.0015;
      return;
    }
    if (child instanceof THREE.LineSegments && child.material instanceof THREE.LineBasicMaterial) {
      child.material.opacity = 0.18 + Math.sin(elapsed * 1.8 + index) * 0.06;
    }
  });
}

function buildFloorPlane(size: THREE.Vector3, center: THREE.Vector3): THREE.Mesh {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 6.4, size.z * 4.8, 1, 1),
    new THREE.MeshPhongMaterial({
      color: "#05090f",
      transparent: true,
      opacity: 0.9,
      shininess: 18,
      side: THREE.DoubleSide
    }),
  );
  floor.renderOrder = -1;
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x * 0.05, -0.068, center.z * 0.02);
  return floor;
}

function makePressureSlabTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.needsUpdate = true;
    return fallback;
  }

  const baseGradient = context.createLinearGradient(0, canvas.height, canvas.width, 0);
  baseGradient.addColorStop(0, "rgba(36, 87, 255, 0.88)");
  baseGradient.addColorStop(0.25, "rgba(20, 217, 255, 0.9)");
  baseGradient.addColorStop(0.5, "rgba(22, 208, 94, 0.92)");
  baseGradient.addColorStop(0.76, "rgba(243, 239, 61, 0.9)");
  baseGradient.addColorStop(1, "rgba(255, 61, 36, 0.82)");
  context.fillStyle = baseGradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const glow = context.createRadialGradient(canvas.width * 0.22, canvas.height * 0.7, 12, canvas.width * 0.22, canvas.height * 0.7, canvas.width * 0.45);
  glow.addColorStop(0, "rgba(255,255,255,0.48)");
  glow.addColorStop(0.2, "rgba(172,255,255,0.42)");
  glow.addColorStop(0.58, "rgba(112,255,197,0.16)");
  glow.addColorStop(1, "rgba(112,255,197,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 5; index += 1) {
    context.strokeStyle = "rgba(221,255,97,0.22)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(canvas.width * (0.08 + index * 0.18), canvas.height * 0.16);
    context.lineTo(canvas.width * (0.02 + index * 0.16), canvas.height * 0.94);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
