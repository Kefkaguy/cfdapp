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

    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      metalness: 0.05,
      roughness: 0.22,
      clearcoat: 0.45,
      clearcoatRoughness: 0.18,
      transmission: 0.08,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    const wireframe = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 27),
      new THREE.LineBasicMaterial({
        color: "#c6fff0",
        transparent: true,
        opacity: 0.18
      }),
    );
    const carGroup = new THREE.Group();
    carGroup.add(mesh);
    carGroup.add(wireframe);
    scene.add(carGroup);
    carGroup.rotation.y = THREE.MathUtils.degToRad(yawDegrees);

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

    let animationFrame = 0;
    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const render = () => {
      carGroup.rotation.y = THREE.MathUtils.degToRad(yawDegrees);
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
  }, [payload, yawDegrees]);

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
  const [minPressure, maxPressure] = payload.pressureRange;
  const range = Math.max(maxPressure - minPressure, 1e-6);
  return payload.pressure.flatMap((value) => {
    const t = (value - minPressure) / range;
    const color = new THREE.Color().setHSL(0.33 * (1 - t), 0.95, 0.48);
    return [color.r, color.g, color.b];
  });
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
  const lineCount = 22;
  const lineLength = size.x * 5.9;
  const spacing = Math.max(size.z * 0.16, 0.1);
  const startX = center.x - lineLength * 0.56;
  const endX = center.x + lineLength * 0.44;
  const y = size.y * 0.22;

  for (let index = 0; index < lineCount; index += 1) {
    const z = center.z + (index - (lineCount - 1) / 2) * spacing;
    const points = [new THREE.Vector3(startX, y, z), new THREE.Vector3(endX, y, z)];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: "#66d8ff",
      transparent: true,
      opacity: 0.72
    });
    group.add(new THREE.Line(geometry, material));

    if (index % 5 === 0) {
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(size.x * 0.016, 10, 10),
        new THREE.MeshBasicMaterial({ color: "#9ae7ff", transparent: true, opacity: 0.95 }),
      );
      bead.position.set(THREE.MathUtils.lerp(startX, endX, 0.18 + (index % 3) * 0.22), y, z);
      group.add(bead);
    }
  }

  const arrowMaterial = new THREE.MeshBasicMaterial({ color: "#b7f1ff", transparent: true, opacity: 0.96 });
  const arrowGeometry = new THREE.ConeGeometry(size.x * 0.055, size.x * 0.14, 3);
  for (let index = 0; index < 3; index += 1) {
    const arrow = new THREE.Mesh(arrowGeometry.clone(), arrowMaterial.clone());
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.set(startX - size.x * 0.07, y - size.y * 0.1 - index * size.y * 0.16, center.z - size.z * 0.62);
    group.add(arrow);
  }

  return group;
}

function buildPressureSlab(size: THREE.Vector3, center: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  const texture = makePressureSlabTexture();
  const geometry = new THREE.PlaneGeometry(size.x * 1.7, size.z * 1.5, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.84,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const slab = new THREE.Mesh(geometry, material);
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(center.x * 0.08, -0.012, center.z * 0.04);
  group.add(slab);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: "#d8ff5d",
      transparent: true,
      opacity: 0.24
    }),
  );
  outline.rotation.x = -Math.PI / 2;
  outline.position.copy(slab.position);
  group.add(outline);

  return group;
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
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x * 0.05, -0.015, center.z * 0.02);
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
  baseGradient.addColorStop(0, "rgba(134, 248, 255, 0.95)");
  baseGradient.addColorStop(0.35, "rgba(105, 239, 180, 0.92)");
  baseGradient.addColorStop(0.78, "rgba(137, 224, 59, 0.88)");
  baseGradient.addColorStop(1, "rgba(209, 255, 67, 0.82)");
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
