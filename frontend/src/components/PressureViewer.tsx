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

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.01, 100);
    camera.position.set(2.8, 1.6, 3.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.2;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI * 0.58;

    scene.add(new THREE.AmbientLight("#dff6ff", 0.7));
    const keyLight = new THREE.DirectionalLight("#8bc5ff", 1.8);
    keyLight.position.set(3, 4, 2.5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight("#6effc6", 0.95);
    rimLight.position.set(-3, 2, -4);
    scene.add(rimLight);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(orientAndNormalizePositions(payload.positions), 3));
    geometry.setIndex(payload.indices);
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(buildVertexColors(payload), 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      metalness: 0.02,
      roughness: 0.32,
      clearcoat: 0.2,
      clearcoatRoughness: 0.35,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    const carGroup = new THREE.Group();
    carGroup.add(mesh);
    scene.add(carGroup);
    carGroup.rotation.y = THREE.MathUtils.degToRad(yawDegrees);

    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 1e-6);
    controls.target.set(0, 0, 0);
    camera.position.set(maxDimension * 2.15, maxDimension * 0.58, maxDimension * 1.35);
    camera.near = maxDimension / 100;
    camera.far = maxDimension * 20;
    camera.updateProjectionMatrix();

    const { group: freestreamGroup, particles } = buildFreestreamGroup(maxDimension, box);
    scene.add(freestreamGroup);

    let animationFrame = 0;
    const clock = new THREE.Clock();
    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const render = () => {
      const elapsed = clock.getElapsedTime();
      carGroup.rotation.y = THREE.MathUtils.degToRad(yawDegrees);
      for (const particle of particles) {
        const progress = (particle.offset + elapsed * particle.speed) % 1;
        particle.mesh.position.copy(particle.curve.getPoint(progress));
      }
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

  for (let index = 0; index < remapped.length; index += 3) {
    remapped[index] = (remapped[index] - center[0]) / maxAxis;
    remapped[index + 1] = (remapped[index + 1] - center[1]) / maxAxis;
    remapped[index + 2] = (remapped[index + 2] - center[2]) / maxAxis;
  }

  return remapped;
}

function buildFreestreamGroup(scale: number, box: THREE.Box3): {
  group: THREE.Group;
  particles: Array<{
    curve: THREE.CatmullRomCurve3;
    mesh: THREE.Mesh;
    speed: number;
    offset: number;
  }>;
} {
  const group = new THREE.Group();
  const particles: Array<{
    curve: THREE.CatmullRomCurve3;
    mesh: THREE.Mesh;
    speed: number;
    offset: number;
  }> = [];
  const lineCount = 18;
  const extentY = Math.max(box.max.y - box.min.y, 0.8);
  const extentZ = Math.max(box.max.z - box.min.z, 0.8);
  const particleGeometry = new THREE.SphereGeometry(scale * 0.008, 8, 8);

  for (let index = 0; index < lineCount; index += 1) {
    const normalized = index / (lineCount - 1);
    const z = THREE.MathUtils.lerp(-extentZ * 1.15, extentZ * 1.15, normalized);
    const yWave = Math.sin(normalized * Math.PI * 2) * extentY * 0.06;
    const yBase = THREE.MathUtils.lerp(extentY * 0.6, -extentY * 0.12, normalized);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-2.8 * scale, yBase + yWave, z),
      new THREE.Vector3(-1.4 * scale, yBase + yWave * 0.7, z),
      new THREE.Vector3(0.2 * scale, yBase + yWave * 0.35, z),
      new THREE.Vector3(2.6 * scale, yBase, z),
    ]);
    const points = curve.getPoints(80);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const hue = 0.5 + normalized * 0.08;
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color().setHSL(hue, 0.95, 0.56),
      transparent: true,
      opacity: 0.45
    });
    const line = new THREE.Line(geometry, material);
    group.add(line);

    const particle = new THREE.Mesh(
      particleGeometry.clone(),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(hue, 0.98, 0.65),
        transparent: true,
        opacity: 0.85
      }),
    );
    group.add(particle);
    particles.push({
      curve,
      mesh: particle,
      speed: 0.1 + normalized * 0.04,
      offset: normalized
    });
  }

  const arrowMaterial = new THREE.MeshBasicMaterial({ color: "#9cecff", transparent: true, opacity: 0.9 });
  const arrowGeometry = new THREE.ConeGeometry(scale * 0.035, scale * 0.11, 12);
  for (let index = 0; index < 3; index += 1) {
    const arrow = new THREE.Mesh(arrowGeometry.clone(), arrowMaterial.clone());
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.set(-2.95 * scale, extentY * (0.22 - index * 0.18), 0);
    group.add(arrow);
  }

  return { group, particles };
}
