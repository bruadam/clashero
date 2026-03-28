"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import type { Clash } from "@/lib/types";

interface IfcViewerProps {
  selectedClash: Clash | null;
  clashes: Clash[];
}

// Colors matching spec
const COLOR_SIDE_A = new THREE.Color(0xff3b30);   // red
const COLOR_SIDE_B = new THREE.Color(0x007aff);   // blue
const COLOR_CONTEXT = new THREE.Color(0x8e8e93);  // gray

const PRIORITY_COLORS: Record<string, number> = {
  urgent: 0xe24b4a,
  high:   0xf09595,
  medium: 0xba7517,
  low:    0x639922,
  none:   0x6b7280,
};

export function IfcViewer({ selectedClash, clashes }: IfcViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const bubblesRef = useRef<THREE.Mesh[]>([]);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const highlightGroupRef = useRef<THREE.Group | null>(null);
  const rafRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const mouseRef = useRef({ x: 0, y: 0 });
  const orbitRef = useRef({ theta: Math.PI / 4, phi: Math.PI / 3, radius: 30 });

  // Init Three.js scene (no ThatOpen IFC loading yet — model placeholder until BCF+IFC ready)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111113);
    scene.fog = new THREE.FogExp2(0x111113, 0.015);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      500
    );
    camera.position.set(25, 20, 25);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(20, 40, 20);
    dirLight.castShadow = true;
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x8080ff, 0.3);
    fillLight.position.set(-20, 10, -20);
    scene.add(fillLight);

    // Grid
    const grid = new THREE.GridHelper(60, 30, 0x222226, 0x1a1a1e);
    scene.add(grid);

    // Placeholder building geometry (ghosted boxes representing the building mass)
    const modelGroup = new THREE.Group();
    const ghostMat = new THREE.MeshLambertMaterial({
      color: COLOR_CONTEXT,
      transparent: true,
      opacity: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const ghostEdgeMat = new THREE.LineBasicMaterial({ color: 0x444450, transparent: true, opacity: 0.3 });

    // Building floors (placeholder for IFC geometry)
    const buildingData = [
      { w: 20, h: 3, d: 15, x: 0, y: 1.5, z: 0 },
      { w: 20, h: 3, d: 15, x: 0, y: 4.5, z: 0 },
      { w: 20, h: 3, d: 15, x: 0, y: 7.5, z: 0 },
      { w: 20, h: 3, d: 15, x: 0, y: 10.5, z: 0 },
      { w: 16, h: 3, d: 12, x: 0, y: 13.5, z: 0 },
      { w: 12, h: 3, d: 10, x: 0, y: 16.5, z: 0 },
    ];

    buildingData.forEach(({ w, h, d, x, y, z }) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, ghostMat);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      modelGroup.add(mesh);

      const edges = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(edges, ghostEdgeMat);
      line.position.set(x, y, z);
      modelGroup.add(line);
    });

    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    // Highlight group (for selected clash elements)
    const highlightGroup = new THREE.Group();
    scene.add(highlightGroup);
    highlightGroupRef.current = highlightGroup;

    // Clash bubbles
    const bubbleGeo = new THREE.SphereGeometry(0.35, 16, 16);
    const bubbles: THREE.Mesh[] = [];
    clashes.forEach((clash) => {
      const color = PRIORITY_COLORS[clash.priority] ?? 0x6b7280;
      const mat = new THREE.MeshBasicMaterial({ color });
      const bubble = new THREE.Mesh(bubbleGeo, mat);
      bubble.position.set(...clash.midpoint);
      bubble.userData = { clashGuid: clash.guid };
      scene.add(bubble);
      bubbles.push(bubble);
    });
    bubblesRef.current = bubbles;

    // Orbit controls (manual implementation — no import needed)
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - mouseRef.current.x;
      const dy = e.clientY - mouseRef.current.y;
      mouseRef.current = { x: e.clientX, y: e.clientY };
      orbitRef.current.theta -= dx * 0.005;
      orbitRef.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, orbitRef.current.phi - dy * 0.005));
      updateCamera();
    };
    const onMouseUp = () => { isDraggingRef.current = false; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbitRef.current.radius = Math.max(5, Math.min(100, orbitRef.current.radius + e.deltaY * 0.05));
      updateCamera();
    };

    const updateCamera = () => {
      const { theta, phi, radius } = orbitRef.current;
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(0, 3, 0);
    };
    updateCamera();

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("wheel", onWheel, { passive: false });

    // Render loop
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      // Pulse selected bubble
      const t = Date.now() * 0.003;
      bubblesRef.current.forEach((b) => {
        const isSelected = b.userData.clashGuid === selectedClash?.guid;
        const scale = isSelected ? 1 + 0.25 * Math.sin(t * 2) : 1;
        b.scale.setScalar(scale);
      });
      renderer.render(scene, camera);
    };
    animate();

    // Resize
    const ro = new ResizeObserver(() => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(rafRef.current);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("wheel", onWheel);
      ro.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // init once

  // React to selected clash changes
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const highlightGroup = highlightGroupRef.current;
    if (!scene || !camera || !highlightGroup) return;

    // Clear previous highlights
    highlightGroup.clear();

    if (!selectedClash) {
      // Reset bubble scales
      bubblesRef.current.forEach((b) => b.scale.setScalar(1));
      return;
    }

    // Highlight boxes for side A and side B at the clash midpoint
    const [mx, my, mz] = selectedClash.midpoint;

    const matA = new THREE.MeshLambertMaterial({
      color: COLOR_SIDE_A,
      transparent: true,
      opacity: 0.88,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const matB = new THREE.MeshLambertMaterial({
      color: COLOR_SIDE_B,
      transparent: true,
      opacity: 0.88,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    // Side A — duct / pipe element (elongated box along X)
    const geoA = new THREE.BoxGeometry(3.5, 0.6, 0.6);
    const meshA = new THREE.Mesh(geoA, matA);
    meshA.position.set(mx, my, mz);
    highlightGroup.add(meshA);

    // Side B — crossing element (elongated box along Z)
    const geoB = new THREE.BoxGeometry(0.4, 0.4, 3.5);
    const meshB = new THREE.Mesh(geoB, matB);
    meshB.position.set(mx, my + 0.1, mz);
    highlightGroup.add(meshB);

    // Wireframe outlines
    const wfMatA = new THREE.LineBasicMaterial({ color: COLOR_SIDE_A });
    const wfMatB = new THREE.LineBasicMaterial({ color: COLOR_SIDE_B });
    highlightGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geoA), wfMatA));
    highlightGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geoB), wfMatB));

    // Fly camera to viewpoint
    const vp = selectedClash.viewpoint;
    const targetOrbit = new THREE.Vector3(...vp.cameraPosition);
    const lookTarget = new THREE.Vector3(...vp.target);

    // Compute spherical coords from the viewpoint relative to the target
    const rel = targetOrbit.clone().sub(lookTarget);
    const radius = rel.length();
    const phi = Math.acos(rel.y / radius);
    const theta = Math.atan2(rel.x, rel.z);

    // Animate camera
    const startTheta = orbitRef.current.theta;
    const startPhi = orbitRef.current.phi;
    const startRadius = orbitRef.current.radius;
    const duration = 600;
    const startTime = Date.now();

    const animateCamera = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease in-out quad

      orbitRef.current.theta = startTheta + (theta - startTheta) * ease;
      orbitRef.current.phi = startPhi + (phi - startPhi) * ease;
      orbitRef.current.radius = startRadius + (radius - startRadius) * ease;

      const { theta: th, phi: ph, radius: r } = orbitRef.current;
      camera.position.set(
        lookTarget.x + r * Math.sin(ph) * Math.sin(th),
        lookTarget.y + r * Math.cos(ph),
        lookTarget.z + r * Math.sin(ph) * Math.cos(th)
      );
      camera.lookAt(lookTarget);

      if (t < 1) requestAnimationFrame(animateCamera);
    };
    animateCamera();
  }, [selectedClash]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Color legend */}
      <div className="absolute bottom-3 left-3 flex items-center gap-3 text-[11px] text-white/70 bg-black/40 backdrop-blur-sm rounded px-3 py-1.5">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff3b30]" /> Side A
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-[#007aff]" /> Side B
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-[#e24b4a] opacity-70" /> Urgent
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ba7517] opacity-70" /> Medium
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-[#639922] opacity-70" /> Low
        </span>
      </div>

      {/* Drag hint */}
      {!selectedClash && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 text-[11px] text-white/40 pointer-events-none">
          Drag to orbit · Scroll to zoom · Click a clash to inspect
        </div>
      )}
    </div>
  );
}
