import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SystemMap, Selection } from "./model";

/**
 * The three processes, as three islands you can turn around.
 *
 * **The picture is the enhancement, not the interface.** Everything this draws also exists
 * as real DOM in `map-screen.tsx` — a list of processes, parts and sprints that is
 * focusable, readable by a screen reader and translatable. This canvas is `aria-hidden`,
 * because a canvas cannot be any of those things and putting ARIA on one only claims it
 * can. Selection is shared state, so clicking a box here and pressing Enter on a row there
 * do the same thing.
 *
 * **No text in the scene.** Labels are DOM nodes positioned over the canvas from projected
 * world coordinates, which keeps them selectable, translatable, RTL-aware and legible at
 * any zoom — and avoids shipping a font atlas to draw six words. It is also the only way
 * the Hebrew comes out right.
 *
 * **Colour is never the only signal.** The islands are separated in space and named in the
 * DOM; colour repeats what position and text already say, for the same reason the rest of
 * this app does not lean on it.
 */
export default function Scene({
  map,
  selected,
  onSelect,
  still,
}: {
  map: SystemMap;
  selected: Selection | null;
  onSelect: (selection: Selection | null) => void;
  /** `prefers-reduced-motion`. Nothing moves on its own, and the flow beads hold still. */
  still: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  // The click handler is rebuilt on every render; the scene is not. Held in a ref so the
  // effect below can stay keyed on the map alone and not tear down on every selection.
  const select = useRef(onSelect);
  select.current = onSelect;

  const highlight = useRef<Selection | null>(selected);
  highlight.current = selected;

  useEffect(() => {
    const mount = host.current;
    const overlay = labels.current;
    if (!mount || !overlay) return;

    // Read the palette off the document rather than hard-coding it: this app has two
    // themes and both are contrast-checked, and a scene with its own colours would be a
    // third theme nobody validates.
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => new THREE.Color(styles.getPropertyValue(name).trim() || "#888");
    const palette = {
      done: token("--primary"),
      partly: token("--warning"),
      blocked: token("--destructive"),
      idle: token("--muted-foreground"),
      surface: token("--card"),
      line: token("--divider"),
    };

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    camera.position.set(9, 5.5, 11);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !still;
    controls.enablePan = false;
    controls.minDistance = 7;
    controls.maxDistance = 26;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(6, 12, 8);
    scene.add(key);

    /** Where each process sits. Stacked, because the stack is the actual relationship. */
    const LEVEL: Record<string, number> = { window: 4.2, shell: 0, engine: -4.2 };

    /** Every mesh a click can land on, with what it means. */
    const targets: { mesh: THREE.Mesh; selection: Selection }[] = [];
    /** Every label, with the world point it hangs from. */
    const pins: { node: HTMLElement; at: THREE.Vector3 }[] = [];

    const pin = (text: string, at: THREE.Vector3, kind: "island" | "link") => {
      const node = document.createElement("div");
      node.textContent = text;
      node.className =
        kind === "island"
          ? "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-card/90 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-card-foreground shadow-sm"
          : "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-muted-foreground";
      overlay.appendChild(node);
      pins.push({ node, at });
      return node;
    };

    for (const process of map.processes) {
      const y = LEVEL[process.id] ?? 0;

      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(8, 0.5, 5),
        new THREE.MeshStandardMaterial({
          color: palette.surface,
          roughness: 0.75,
          metalness: 0.05,
        }),
      );
      slab.position.set(0, y, 0);
      scene.add(slab);
      targets.push({ mesh: slab, selection: { kind: "process", id: process.id } });

      // A thin lit edge, so the three slabs are told apart by more than their labels when
      // the camera is low and they overlap.
      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(8.15, 0.08, 5.15),
        new THREE.MeshBasicMaterial({ color: palette.done }),
      );
      rim.position.set(0, y - 0.28, 0);
      scene.add(rim);

      pin(process.name, new THREE.Vector3(0, y + 1.5, 0), "island");

      // One block per part, in a row, height fixed: this is a map and not a chart, and a
      // bar whose height meant "lines of code" would invite a reading nobody intended.
      process.parts.forEach((part, index) => {
        const span = process.parts.length;
        const block = new THREE.Mesh(
          new THREE.BoxGeometry(1.05, 0.85, 1.05),
          new THREE.MeshStandardMaterial({ color: palette.done, roughness: 0.5 }),
        );
        block.position.set((index - (span - 1) / 2) * 1.45, y + 0.68, 0);
        scene.add(block);
        targets.push({
          mesh: block,
          selection: { kind: "part", id: process.id, part: part.name },
        });
      });
    }

    /** The two links, drawn as what they are: one pipe each, going one way and back. */
    const beads: { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; offset: number }[] = [];

    for (const [index, link] of map.links.entries()) {
      const from = new THREE.Vector3(index === 0 ? -2.6 : 2.6, LEVEL[link.from] ?? 0, 1.9);
      const to = new THREE.Vector3(index === 0 ? -2.6 : 2.6, LEVEL[link.to] ?? 0, 1.9);

      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, from.distanceTo(to), 8),
        new THREE.MeshBasicMaterial({ color: palette.line }),
      );
      pipe.position.copy(from.clone().add(to).multiplyScalar(0.5));
      scene.add(pipe);

      for (let n = 0; n < 4; n += 1) {
        const bead = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 12, 12),
          new THREE.MeshBasicMaterial({ color: palette.done }),
        );
        scene.add(bead);
        beads.push({ mesh: bead, from, to, offset: n / 4 });
      }

      pin(link.protocol, from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0, 0.9)), "link");
    }

    /**
     * The ring that is not a decoration: nothing crosses it.
     *
     * No port, no upload, no cloud. Drawn in the colour this app uses for a refusal, and
     * open on no side — the claim is that the boundary is complete, so a broken ring would
     * be the wrong picture.
     */
    const fence = new THREE.Mesh(
      new THREE.TorusGeometry(7.4, 0.035, 8, 96),
      new THREE.MeshBasicMaterial({ color: palette.blocked, transparent: true, opacity: 0.55 }),
    );
    fence.rotation.x = Math.PI / 2;
    scene.add(fence);

    // --- picking ---------------------------------------------------------------------
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = { x: 0, y: 0 };

    const onDown = (event: PointerEvent) => {
      downAt = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent) => {
      // A drag that rotated the camera is not a click on what happens to be under it.
      if (Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 4) return;

      const box = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
      pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1;
      ray.setFromCamera(pointer, camera);

      const hit = ray.intersectObjects(targets.map((target) => target.mesh))[0];
      const found = hit && targets.find((target) => target.mesh === hit.object);
      select.current(found ? found.selection : null);
    };

    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    // --- the loop --------------------------------------------------------------------
    const size = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(mount);

    const clock = new THREE.Clock();
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const time = still ? 0 : clock.getElapsedTime();

      // The beads are the only motion, and they carry meaning: this is the direction data
      // actually travels. With reduced motion they stand still and simply mark the pipe.
      for (const bead of beads) {
        const at = still ? bead.offset : (bead.offset + time * 0.28) % 1;
        bead.mesh.position.copy(bead.from.clone().lerp(bead.to, at));
      }

      for (const target of targets) {
        const chosen =
          highlight.current?.kind === target.selection.kind &&
          highlight.current.id === target.selection.id &&
          (highlight.current.kind !== "part" ||
            highlight.current.part === (target.selection as { part?: string }).part);
        const material = target.mesh.material as THREE.MeshStandardMaterial;
        material.emissive = chosen ? palette.done : new THREE.Color(0x000000);
        material.emissiveIntensity = chosen ? 0.45 : 0;
      }

      controls.update();
      renderer.render(scene, camera);

      // Labels follow the camera. Done here rather than in a React state update, because
      // a projection that ran through the reconciler sixty times a second would be sixty
      // renders of the whole screen for six pieces of text.
      const box = renderer.domElement.getBoundingClientRect();
      for (const label of pins) {
        const point = label.at.clone().project(camera);
        const visible = point.z < 1;
        label.node.style.display = visible ? "block" : "none";
        if (!visible) continue;
        label.node.style.left = `${((point.x + 1) / 2) * box.width}px`;
        label.node.style.top = `${((1 - point.y) / 2) * box.height}px`;
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      // Geometries and materials are not garbage collected on their own — a mode somebody
      // opens and closes ten times would leak ten scenes onto the GPU.
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) =>
            m.dispose(),
          );
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      overlay.replaceChildren();
    };
  }, [map, still]);

  return (
    <div className="relative min-h-64 flex-1 overflow-hidden rounded-lg border border-divider bg-muted/20">
      {/* Hidden from assistive technology on purpose: everything in it is also in the
          list beside it, where it can actually be read and reached. */}
      <div ref={host} aria-hidden="true" className="absolute inset-0" />
      <div ref={labels} aria-hidden="true" className="absolute inset-0" />
    </div>
  );
}
