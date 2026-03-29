/**
 * Headless snapshot page — renders the 3D viewer for a single clash.
 * Puppeteer loads this page, waits for window.__snapshotReady, then screenshots it.
 * Query params:
 *   ?w=1200&h=630   (optional dimensions hint, purely visual)
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import * as THREE from "three";
import type * as OBC from "@thatopen/components";
import type * as FRAGS from "@thatopen/fragments";
import type { Clash } from "@/lib/types";

async function fetchModelFilenames(): Promise<string[]> {
  const res = await fetch("/api/models");
  if (!res.ok) return [];
  const { models } = await res.json();
  return models.map((m: { filename: string }) => m.filename);
}

const COLOR_A = new THREE.Color(0xff3b30);
const COLOR_B = new THREE.Color(0x007aff);

declare global {
  interface Window {
    __snapshotReady?: boolean;
    __snapshotError?: string;
  }
}

export default function SnapshotPage() {
  const { guid } = useParams<{ guid: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("loading clashes…");

  useEffect(() => {
    if (!guid) return;
    let disposed = false;

    async function run() {
      // 1. Load clash data from API
      let clash: Clash | null = null;
      try {
        const res = await fetch("/api/clashes");
        const data = await res.json();
        clash = (data.clashes as Clash[]).find((c) => c.guid === guid) ?? null;
      } catch (e) {
        window.__snapshotError = String(e);
        return;
      }

      if (!clash) {
        window.__snapshotError = `Clash ${guid} not found`;
        return;
      }

      setStatus("loading IFC models…");

      // 2. Init ThatOpen scene
      const OBCRuntime = await import("@thatopen/components");
      if (disposed) return;

      const components = new OBCRuntime.Components();
      const worlds = components.get(OBCRuntime.Worlds);
      const world = worlds.create<
        OBC.SimpleScene,
        OBC.SimpleCamera,
        OBC.SimpleRenderer
      >();

      world.scene = new OBCRuntime.SimpleScene(components);
      world.renderer = new OBCRuntime.SimpleRenderer(
        components,
        containerRef.current!,
      );
      world.camera = new OBCRuntime.SimpleCamera(components);
      world.scene.setup();

      world.scene.three.background = new THREE.Color(0x0d0d10);
      world.scene.three.fog = new THREE.FogExp2(0x0d0d10, 0.006);
      const fill = new THREE.DirectionalLight(0x8080ff, 0.4);
      fill.position.set(-30, 20, -30);
      world.scene.three.add(fill);

      components.init();

      const fragments = components.get(OBCRuntime.FragmentsManager);
      const workerRes = await fetch("/wasm/worker.mjs");
      const workerBlob = new Blob([await workerRes.text()], {
        type: "text/javascript",
      });
      fragments.init(URL.createObjectURL(workerBlob));

      fragments.core.onModelLoaded.add((model: FRAGS.FragmentsModel) => {
        model.useCamera(world.camera.three);
        if (!world.scene.three.children.includes(model.object)) {
          world.scene.three.add(model.object);
        }
        fixZFighting(model.object);
      });

      // 3. Load IFC files
      const ifcLoader = components.get(OBCRuntime.IfcLoader);
      await ifcLoader.setup({
        autoSetWasm: false,
        wasm: { path: "/wasm/", absolute: true },
      });

      const ifcFiles = await fetchModelFilenames();
      for (const filename of ifcFiles) {
        if (disposed) return;
        try {
          const res = await fetch(`/api/models/${filename}`);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            await ifcLoader.load(new Uint8Array(buf), true, filename);
          }
        } catch {
          /* skip missing files */
        }
      }

      if (disposed) return;

      // 4. Highlight clashing models
      for (const model of fragments.core.models.list.values()) {
        const name = model.modelId;
        if (name === clash!.fileA) {
          tintModel(model.object, COLOR_A, 0.95);
        } else if (name === clash!.fileB) {
          tintModel(model.object, COLOR_B, 0.95);
        } else {
          ghostModel(model.object, 0.05);
        }
      }

      // 5. Clash marker
      const markerGroup = new THREE.Group();
      const [mx, my, mz] = clash!.midpoint;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 16),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.95,
        }),
      );
      sphere.position.set(mx, my, mz);
      markerGroup.add(sphere);
      world.scene.three.add(markerGroup);

      // 6. Set camera from BCF viewpoint
      const { cameraPosition: cp, target: tgt } = clash!.viewpoint;
      world.camera.controls.setLookAt(
        cp[0],
        cp[1],
        cp[2],
        tgt[0],
        tgt[1],
        tgt[2],
        false,
      );

      // 7. Force a render cycle so Three.js draws the frame
      setStatus("rendering…");
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          world.renderer?.three.render(world.scene.three, world.camera.three);
          resolve();
        }),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          world.renderer?.three.render(world.scene.three, world.camera.three);
          resolve();
        }),
      );

      setStatus("ready");
      window.__snapshotReady = true;
    }

    run().catch((err) => {
      console.error(err);
      window.__snapshotError = String(err);
    });

    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guid]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0d0d10",
        position: "relative",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          color: "rgba(255,255,255,0.4)",
          fontSize: 11,
          fontFamily: "monospace",
        }}
      >
        {status}
      </div>
    </div>
  );
}

function fixZFighting(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material)
      ? child.material
      : [child.material];
    mats.forEach((m) => {
      m.polygonOffset = true;
      m.polygonOffsetFactor = 1;
      m.polygonOffsetUnits = 1;
    });
  });
}

function ghostModel(obj: THREE.Object3D, opacity: number) {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material)
      ? child.material
      : [child.material];
    mats.forEach((m) => {
      m.transparent = true;
      m.opacity = opacity;
      m.needsUpdate = true;
    });
  });
}

function tintModel(obj: THREE.Object3D, color: THREE.Color, opacity: number) {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material)
      ? child.material
      : [child.material];
    mats.forEach((m) => {
      (m as THREE.MeshLambertMaterial).color = color.clone();
      m.transparent = true;
      m.opacity = opacity;
      m.needsUpdate = true;
    });
  });
}
