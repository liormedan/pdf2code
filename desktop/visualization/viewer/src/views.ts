/**
 * Five ways to look at the same model, and where the camera stands for each.
 *
 * **This is the fix for the real problem.** The first version had one scene and a free
 * camera, which meant a newcomer arrived at a picture with no question attached and had to
 * fly around to find one. Nobody learns a system that way. Each view here asks something
 * — *what is this made of · what happens to a document · what is refused · what can it do
 * · where does it stand* — and shows only what answers it.
 *
 * The camera is a consequence of the question rather than a thing to operate. Free orbit
 * still works for anybody who wants it, and on a narrow window it is switched off entirely
 * in favour of these, because a two-finger orbit on a small screen is not navigation.
 */

export type ViewId = "overview" | "flow" | "boundaries" | "capabilities" | "status";

export interface View {
  id: ViewId;
  /** Where the camera sits and what it looks at, in world units. */
  camera: { position: [number, number, number]; target: [number, number, number] };
  /** Which layers of the scene this view turns on. Everything else is dimmed away. */
  shows: {
    slabs: boolean;
    parts: boolean;
    pipes: boolean;
    /** The person and the written output — the two ends the processes sit between. */
    ends: boolean;
    fence: boolean;
  };
  /** Which panel the list beside the canvas opens on. */
  panel: "processes" | "flow" | "forbidden" | "capabilities" | "sprints";
}

export const VIEWS: View[] = [
  {
    id: "overview",
    // Far enough back that all three slabs and both ends are in frame at once. This is the
    // first thing anybody sees, so it has to be the whole shape and not a detail of it —
    // and the first attempt at these numbers cut the person off the top and the file off
    // the bottom, which is precisely the two things a newcomer looks for.
    //
    // The run is about sixteen units tall and the vertical field of view is 42°, so the
    // camera has to stand at least 16 / (2·tan 21°) ≈ 21 away. `fit()` in scene.tsx pushes
    // it further on a window too tall and narrow for that to be enough.
    camera: { position: [12, 5, 17], target: [0, 0, 0] },
    shows: { slabs: true, parts: true, pipes: true, ends: true, fence: true },
    panel: "processes",
  },
  {
    id: "flow",
    // Square on, from the side the pipes are drawn on: this view is about one thing
    // travelling down, and an angle that hides the pipes hides the answer.
    camera: { position: [2, 1, 21], target: [0, 0, 0] },
    shows: { slabs: true, parts: false, pipes: true, ends: true, fence: false },
    panel: "flow",
  },
  {
    id: "boundaries",
    // High and back, because the ring is the subject and it is only legible from above.
    camera: { position: [0.5, 17, 11], target: [0, 0, 0] },
    shows: { slabs: true, parts: false, pipes: true, ends: false, fence: true },
    panel: "forbidden",
  },
  {
    id: "capabilities",
    camera: { position: [13, 4, 10], target: [0, 0, 0] },
    shows: { slabs: true, parts: true, pipes: false, ends: false, fence: false },
    panel: "capabilities",
  },
  {
    id: "status",
    // Nothing in the scene carries sprint status, and pretending otherwise would be the
    // map's first lie. The camera pulls back, the picture goes quiet, and the panel does
    // the work — which is the honest arrangement when the answer is not spatial.
    camera: { position: [9, 7, 16], target: [0, 0, 0] },
    shows: { slabs: true, parts: false, pipes: false, ends: false, fence: false },
    panel: "sprints",
  },
];

export const viewById = (id: ViewId) => VIEWS.find((view) => view.id === id) as View;

/**
 * The guided walk: five steps from the person to the file on disk.
 *
 * A tour rather than a legend, because the thing worth understanding here is an order —
 * who asks, who decides, who does the work — and an order is a sequence. Each step parks
 * the camera on one node and says what it is for in a sentence; the panel beside it still
 * holds everything, so nobody is trapped in the walk.
 */
export interface Step {
  /** A node id the scene can focus, or null for the wide shot. */
  focus: string | null;
  /** Which view's layers to show while this step is on screen. */
  view: ViewId;
}

export const TOUR: Step[] = [
  { focus: "you", view: "flow" },
  { focus: "window", view: "flow" },
  { focus: "shell", view: "flow" },
  { focus: "engine", view: "flow" },
  { focus: "output", view: "boundaries" },
];
