import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SystemMap, Selection } from "./model";
import { viewById, type ViewId } from "./views";

/**
 * The picture: five processes' worth of shape, seen from wherever the current view stands.
 *
 * **The picture is the illustration, not the interface.** Everything drawn here also exists
 * as real DOM in `app.tsx` — a list of processes, parts, sprints and decisions that is
 * focusable, readable by a screen reader and translated. This canvas is `aria-hidden`,
 * because a canvas cannot be any of those and putting ARIA on one only claims it can.
 *
 * Three things changed after the first version was shown to somebody who had not built it:
 *
 * **The camera stopped being a control.** It used to start wherever and expect you to fly.
 * Now each view has a place it stands, and moving between them is an animation the person
 * watches rather than performs. Free orbit is still there for anybody who wants it — and
 * is switched off entirely when the window is too narrow for it to be anything but a way
 * to get lost.
 *
 * **Selecting something means something.** The chosen node lifts and the rest fade to a
 * fifth of their opacity, so "which one is that" is answered by looking rather than by
 * reading a highlight colour.
 *
 * **The labels stopped overlapping.** They are projected DOM, so they collide the moment
 * two nodes line up behind each other — which the default view did. They are now pushed
 * apart vertically after projection, hidden when their node is dimmed, and dropped
 * entirely on a narrow window where there is no room for them at all.
 */
export default function Scene({
  map,
  view,
  selected,
  onSelect,
  still,
  compact,
}: {
  map: SystemMap;
  view: ViewId;
  selected: Selection | null;
  onSelect: (selection: Selection | null) => void;
  /** `prefers-reduced-motion`. The camera jumps instead of flying and the beads hold. */
  still: boolean;
  /** A window too narrow to orbit in. Presets and the tour do the navigating instead. */
  compact: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);

  // Read through refs so the scene is built once and not town down on every click.
  const select = useRef(onSelect);
  select.current = onSelect;
  const current = useRef<{ view: ViewId; selected: Selection | null; still: boolean; compact: boolean }>({
    view,
    selected,
    still,
    compact,
  });
  current.current = { view, selected, still, compact };

  useEffect(() => {
    const mount = host.current;
    const overlay = labels.current;
    if (!mount || !overlay) return;

    // The palette comes off the document: this app has two themes, both contrast-checked,
    // and a scene with its own colours would be a third that nobody validates.
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => new THREE.Color(styles.getPropertyValue(name).trim() || "#888");
    const palette = {
      accent: token("--primary"),
      warn: token("--warning"),
      refuse: token("--destructive"),
      surface: token("--card"),
      line: token("--divider"),
    };

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.maxDistance = 30;

    scene.add(new THREE.AmbientLight(0xffffff, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(6, 12, 8);
    scene.add(key);

    /**
     * Where each node sits on the vertical run from the person to the file.
     *
     * The ends are at 6.9 and not 7.4: the overview camera sees 8.2 units above the
     * target, and a capsule whose top reached 8.35 had its head cropped. Measured against
     * the preset rather than nudged until it looked right, so a change to either number
     * has an arithmetic reason to check against.
     */
    const LEVEL: Record<string, number> = {
      you: 6.9,
      window: 4.2,
      shell: 0,
      engine: -4.2,
      output: -6.9,
    };

    interface Node {
      id: string;
      mesh: THREE.Mesh;
      selection: Selection;
      /** Which view layers this belongs to, so a view can fade it out. */
      layer: "slabs" | "parts" | "pipes" | "ends" | "fence";
      home: THREE.Vector3;
    }
    const nodes: Node[] = [];
    const pins: { node: HTMLElement; at: THREE.Vector3; owner: string; layer: Node["layer"] }[] = [];

    const pin = (text: string, at: THREE.Vector3, owner: string, layer: Node["layer"], strong = true) => {
      const element = document.createElement("div");
      element.textContent = text;
      element.className = strong
        ? "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-md border border-divider bg-card px-2 py-0.5 text-xs font-medium whitespace-nowrap text-card-foreground shadow-sm"
        : "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-muted-foreground";
      overlay.appendChild(element);
      pins.push({ node: element, at, owner, layer });
    };

    const material = (color: THREE.Color, basic = false) =>
      basic
        ? new THREE.MeshBasicMaterial({ color, transparent: true })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.7, transparent: true });

    // --- the three processes ----------------------------------------------------------
    for (const process of map.processes) {
      const y = LEVEL[process.id] ?? 0;

      const slab = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 5), material(palette.surface));
      slab.position.set(0, y, 0);
      scene.add(slab);
      nodes.push({
        id: process.id,
        mesh: slab,
        selection: { kind: "process", id: process.id },
        layer: "slabs",
        home: slab.position.clone(),
      });

      const rim = new THREE.Mesh(new THREE.BoxGeometry(8.15, 0.08, 5.15), material(palette.accent, true));
      rim.position.set(0, y - 0.28, 0);
      scene.add(rim);
      nodes.push({
        id: `${process.id}:rim`,
        mesh: rim,
        selection: { kind: "process", id: process.id },
        layer: "slabs",
        home: rim.position.clone(),
      });

      pin(process.name, new THREE.Vector3(0, y + 1.6, 0), process.id, "slabs");

      process.parts.forEach((part, index) => {
        const span = process.parts.length;
        const block = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.85, 1.05), material(palette.accent));
        block.position.set((index - (span - 1) / 2) * 1.45, y + 0.68, 0);
        scene.add(block);
        nodes.push({
          id: `${process.id}/${part.name}`,
          mesh: block,
          selection: { kind: "part", id: process.id, part: part.name },
          layer: "parts",
          home: block.position.clone(),
        });
      });
    }

    // --- the two ends -----------------------------------------------------------------
    //
    // A person at the top and a written file at the bottom. Without them the picture was
    // three slabs floating in nothing, and the first question anybody asked was "where do
    // I come into this" — which is a question a diagram of a program should answer first.
    for (const [id, shape] of [
      ["you", new THREE.CapsuleGeometry(0.5, 0.9, 6, 12)] as const,
      ["output", new THREE.BoxGeometry(1.5, 0.2, 1.9)] as const,
    ]) {
      const mesh = new THREE.Mesh(shape, material(palette.warn));
      mesh.position.set(0, LEVEL[id] ?? 0, 0);
      scene.add(mesh);
      nodes.push({
        id,
        mesh,
        selection: { kind: "end", id },
        layer: "ends",
        home: mesh.position.clone(),
      });
    }

    // --- the pipes, and what moves down them -------------------------------------------
    const beads: { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; offset: number }[] = [];

    /** Every hop the document makes, including the two the processes sit between. */
    const HOPS: [string, string, string | null][] = [
      ["you", "window", null],
      ["window", "shell", map.links[0]?.protocol ?? "invoke"],
      ["shell", "engine", map.links[1]?.protocol ?? "NDJSON"],
      ["engine", "output", null],
    ];

    for (const [from, to, protocol] of HOPS) {
      const a = new THREE.Vector3(0, LEVEL[from] ?? 0, 1.9);
      const b = new THREE.Vector3(0, LEVEL[to] ?? 0, 1.9);

      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, a.distanceTo(b), 8),
        material(palette.line, true),
      );
      pipe.position.copy(a.clone().add(b).multiplyScalar(0.5));
      scene.add(pipe);
      nodes.push({
        id: `pipe:${from}-${to}`,
        mesh: pipe,
        selection: { kind: "process", id: to },
        layer: "pipes",
        home: pipe.position.clone(),
      });

      for (let n = 0; n < 3; n += 1) {
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), material(palette.accent, true));
        scene.add(bead);
        beads.push({ mesh: bead, from: a, to: b, offset: n / 3 });
        nodes.push({
          id: `bead:${from}-${to}-${n}`,
          mesh: bead,
          selection: { kind: "process", id: to },
          layer: "pipes",
          home: bead.position.clone(),
        });
      }

      // Only the two real protocols get a label. The hops at either end are a person
      // clicking and a file being written, and naming those would be noise.
      if (protocol) {
        pin(protocol, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0, 1.1)), `pipe:${from}-${to}`, "pipes", false);
      }
    }

    /** The boundary nothing crosses: no port, no upload, no cloud. Closed on every side. */
    const fence = new THREE.Mesh(
      new THREE.TorusGeometry(7.4, 0.035, 8, 96),
      material(palette.refuse, true),
    );
    fence.rotation.x = Math.PI / 2;
    scene.add(fence);
    nodes.push({
      id: "fence",
      mesh: fence,
      selection: { kind: "fence", id: "fence" },
      layer: "fence",
      home: fence.position.clone(),
    });

    // --- picking ------------------------------------------------------------------------
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = { x: 0, y: 0 };

    const onDown = (event: PointerEvent) => {
      downAt = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 4) return;
      const box = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
      pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1;
      ray.setFromCamera(pointer, camera);

      // Only what the current view is actually showing can be clicked. Picking a faded
      // shape is how somebody ends up inspecting a thing they cannot see.
      const shown = viewById(current.current.view).shows;
      const live = nodes.filter((node) => shown[node.layer]);
      const hit = ray.intersectObjects(live.map((node) => node.mesh))[0];
      const found = hit && live.find((node) => node.mesh === hit.object);
      select.current(found ? found.selection : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    // --- where the camera is going -------------------------------------------------------
    const wanted = { position: new THREE.Vector3(), target: new THREE.Vector3() };

    /**
     * Push the camera back when the canvas is not wide enough for the preset.
     *
     * The presets are distances that frame the model in a landscape panel. Below `lg` the
     * canvas drops under the list and gets much shorter, and the field of view is vertical
     * — so the same distance that fitted a wide panel crops the top and bottom off a short
     * one, which here means cutting off the person and the file, the two nodes somebody
     * looks for first.
     *
     * Scaled by how far the aspect falls short of the shape the presets assume, and capped:
     * past a point the honest answer is a smaller model, not a camera in the next room.
     */
    const fit = (position: THREE.Vector3, target: THREE.Vector3) => {
      const shortfall = 1.9 / Math.max(camera.aspect, 0.4);
      if (shortfall <= 1) return position;
      return target.clone().add(position.clone().sub(target).multiplyScalar(Math.min(shortfall, 2.1)));
    };

    const applyView = (id: ViewId, focus: string | null, jump: boolean) => {
      const preset = viewById(id);
      const target = new THREE.Vector3(...preset.camera.target);
      let position = new THREE.Vector3(...preset.camera.position);

      if (focus) {
        // Framed from a little to the side rather than dead on, so the thing has depth
        // and its neighbours stay visible as context.
        const y = LEVEL[focus] ?? 0;
        target.set(0, y, 0);
        position = new THREE.Vector3(6.5, y + 2.4, 8.5);
      }

      wanted.target.copy(target);
      wanted.position.copy(fit(position, target));

      if (jump) {
        camera.position.copy(wanted.position);
        controls.target.copy(wanted.target);
      }
    };

    let lastView: ViewId | null = null;
    let lastFocus: string | null = null;

    // --- the loop ------------------------------------------------------------------------
    const size = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    size();
    const observer = new ResizeObserver(() => {
      size();
      // The preset distance depends on the aspect, so a resize is a reason to re-aim.
      // Without this, dragging the window narrow crops the model until the next click.
      applyView(current.current.view, lastFocus, true);
    });
    observer.observe(mount);

    const clock = new THREE.Clock();
    let frame = 0;
    const black = new THREE.Color(0x000000);

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const { view: viewNow, selected: chosen, still: quiet, compact: narrow } = current.current;
      const time = quiet ? 0 : clock.getElapsedTime();

      // Orbit is a nicety on a wide screen and a trap on a small one, where a drag is
      // usually somebody trying to scroll the page.
      controls.enableRotate = !narrow;
      controls.enableZoom = !narrow;
      controls.enableDamping = !quiet && !narrow;

      const focus =
        chosen?.kind === "process" || chosen?.kind === "end"
          ? chosen.id
          : chosen?.kind === "part"
            ? chosen.id
            : null;

      if (viewNow !== lastView || focus !== lastFocus) {
        applyView(viewNow, focus, quiet);
        lastView = viewNow;
        lastFocus = focus;
      }
      if (!quiet) {
        // Eased rather than snapped: the movement between two viewpoints is the thing
        // that tells you they are two viewpoints of one model.
        camera.position.lerp(wanted.position, 0.07);
        controls.target.lerp(wanted.target, 0.07);
      }

      for (const bead of beads) {
        const at = quiet ? bead.offset : (bead.offset + time * 0.24) % 1;
        bead.mesh.position.copy(bead.from.clone().lerp(bead.to, at));
      }

      const shown = viewById(viewNow).shows;
      const owners = new Set<string>();

      for (const node of nodes) {
        const inView = shown[node.layer];
        const isChosen =
          chosen !== null &&
          node.selection.kind === chosen.kind &&
          node.selection.id === chosen.id &&
          (chosen.kind !== "part" ||
            (node.selection as { part?: string }).part === chosen.part);
        const related = focus !== null && node.id.startsWith(focus);

        // Three states rather than two: in view, in view and chosen, or faded. A binary
        // highlight left everything else at full strength, so the chosen thing competed
        // with fourteen others for attention and lost.
        const opacity = !inView ? 0.06 : chosen === null ? 1 : isChosen || related ? 1 : 0.2;

        const skin = node.mesh.material as THREE.Material & {
          opacity: number;
          emissive?: THREE.Color;
          emissiveIntensity?: number;
        };
        skin.opacity += (opacity - skin.opacity) * (quiet ? 1 : 0.18);
        if (skin.emissive) {
          skin.emissive = isChosen ? palette.accent : black;
          skin.emissiveIntensity = isChosen ? 0.5 : 0;
        }

        // The chosen node lifts a little out of the plane. Position is the one signal
        // that survives being colour-blind, dimmed, or printed in black and white.
        const lift = isChosen ? 0.45 : 0;
        node.mesh.position.y += (node.home.y + lift - node.mesh.position.y) * (quiet ? 1 : 0.2);

        if (inView && opacity > 0.5) owners.add(node.id);
      }

      controls.update();
      renderer.render(scene, camera);

      // --- labels, after the render so they agree with what was drawn -------------------
      const box = renderer.domElement.getBoundingClientRect();
      const placed: { top: number; left: number; height: number }[] = [];

      for (const label of pins) {
        // A label on a hidden layer, a faded node, or a screen with no room for it.
        const wanted = !narrow && shown[label.layer] && owners.has(label.owner);
        if (!wanted) {
          label.node.style.display = "none";
          continue;
        }
        const point = label.at.clone().project(camera);
        if (point.z >= 1) {
          label.node.style.display = "none";
          continue;
        }

        let top = ((1 - point.y) / 2) * box.height;
        const left = ((point.x + 1) / 2) * box.width;
        const height = label.node.offsetHeight || 22;

        // Push down until it clears everything already placed. Two nodes lining up behind
        // each other is the normal case in a stacked diagram, not an edge case, and the
        // first version simply drew one label on top of another.
        for (const taken of placed) {
          if (Math.abs(taken.left - left) > 110) continue;
          if (Math.abs(taken.top - top) >= height + 4) continue;
          top = taken.top + height + 4;
        }
        placed.push({ top, left, height });

        label.node.style.display = "block";
        label.node.style.left = `${left}px`;
        label.node.style.top = `${top}px`;
      }
    };

    applyView(view, null, true);
    draw();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      // Geometries and materials are not collected on their own; a view somebody opens and
      // closes ten times would leave ten scenes on the GPU.
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
    // Built once. Everything that changes afterwards arrives through `current`.
  }, [map]);

  return (
    <div className="relative min-h-64 flex-1 overflow-hidden rounded-lg border border-divider bg-muted/20">
      {/* Hidden from assistive technology on purpose: everything in it is in the panel
          beside it, where it can actually be reached and read. */}
      <div ref={host} aria-hidden="true" className="absolute inset-0" />
      <div ref={labels} aria-hidden="true" className="absolute inset-0" />
    </div>
  );
}
