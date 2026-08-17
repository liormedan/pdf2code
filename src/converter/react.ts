// Page model -> React component.
//
// Not an HTML-to-JSX string rewrite. Generating straight from the model avoids the
// whole class of bugs that transform approach has — unclosed tags, class/className,
// style strings, entity handling — and lets the output be shaped like code a developer
// would actually keep: one component per page, a shared stylesheet, real props.

import { PAGE_CSS } from "./html.ts";
import type { Direction, FontDescription, PageModel, TextRun } from "./types.ts";

const jsString = (s: unknown): string => JSON.stringify(String(s));

/** Style object literal, so React gets real props rather than a parsed string. */
function styleLiteral(run: TextRun, font: FontDescription | undefined): string {
  const parts = [
    `left: ${run.x}`,
    `top: ${run.y}`,
    `fontSize: ${run.size}`,
  ];
  if (font?.family) parts.push(`fontFamily: ${jsString(font.family)}`);
  if (font?.weight && font.weight !== 400) parts.push(`fontWeight: ${font.weight}`);
  if (font?.style === "italic") parts.push(`fontStyle: "italic"`);
  if (run.angle) parts.push(`transform: ${jsString(`rotate(${run.angle}rad)`)}`);
  return `{ ${parts.join(", ")} }`;
}

function pageComponent(page: PageModel, background: string | null, indent = "  "): string {
  const pad = indent.repeat(3);
  const lines = [];

  lines.push(`${indent}<section`);
  lines.push(`${indent}  className="pdf-page"`);
  lines.push(`${indent}  data-page={${page.number}}`);
  lines.push(`${indent}  style={{ width: ${page.width}, height: ${page.height} }}`);
  lines.push(`${indent}>`);

  if (background) {
    lines.push(`${indent}  <img className="pdf-bg" src={${jsString(background)}} alt="" width={${page.width}} height={${page.height}} />`);
  }

  for (const run of page.runs) {
    const font = page.fonts[run.font];
    const dir = run.rtl ? ` dir="rtl"` : "";
    // Text goes in an expression container so no character needs JSX escaping.
    lines.push(`${pad}<span style={${styleLiteral(run, font)}}${dir}>{${jsString(run.text)}}</span>`);
  }

  lines.push(`${indent}</section>`);
  return lines.join("\n");
}

/**
 * @returns {Record<string,string>} filename -> contents
 */
export interface ReactOptions {
  backgrounds?: (string | null)[];
  componentName?: string;
  lang?: string;
  dir?: Direction;
}

export function toReact(pages: PageModel[], {
  backgrounds = [],
  componentName = "PdfDocument",
  lang = "en",
  dir = "ltr",
}: ReactOptions = {}): Record<string, string> {
  const safeName = /^[A-Z][A-Za-z0-9]*$/.test(componentName) ? componentName : "PdfDocument";
  const hasBg = backgrounds.some(Boolean);

  // Each page is its own component so consumers can render, lazy-load or reorder pages
  // individually instead of being handed one unmanageable blob.
  const pageComponents = pages.map((p, i) => `
function Page${p.number}() {
  return (
${pageComponent(p, backgrounds[i] ?? null)}
  );
}`).join("\n");

  const component = `// Generated from a PDF. Layout is absolutely positioned to match the original,
// so page dimensions are fixed rather than fluid.
import "./${safeName}.css";
${pageComponents}

const PAGES = [${pages.map((p) => `Page${p.number}`).join(", ")}];

/**
 * @param {object} props
 * @param {number} [props.scale]  1 = original size
 * @param {string} [props.className]
 */
export default function ${safeName}({ scale = 1, className = "" }) {
  return (
    <main
      className={\`pdf-doc \${className}\`}
      data-background={${hasBg}}
      lang="${lang}"
      dir="${dir}"
      style={scale === 1 ? undefined : { transform: \`scale(\${scale})\`, transformOrigin: "0 0" }}
    >
      {PAGES.map((Page, i) => (
        <Page key={i} />
      ))}
    </main>
  );
}
`;

  const readme = `# ${safeName}

Generated from a PDF.

## Use

\`\`\`jsx
import ${safeName} from "./${safeName}";

export default function App() {
  return <${safeName} scale={1} />;
}
\`\`\`

## How it is built

Every page is a separate component with absolutely positioned text runs, matching the
original layout exactly. ${hasBg
  ? "Non-text content (vector art, images, rules) is baked into a background image per page, with the real text placed transparently on top — so the page looks identical to the PDF while the text stays selectable, searchable and translatable."
  : "Output is text-only: no background images, so the markup is clean and easy to restyle, but any vector art or images from the original are not present."}

## Props

| prop | type | default | meaning |
| --- | --- | --- | --- |
| \`scale\` | number | \`1\` | \`1\` is the PDF's original size |
| \`className\` | string | \`""\` | appended to the root element |

## Notes

- Pages are fixed-size; they do not reflow. To fit a narrow viewport, pass \`scale\`.
- Fonts are referenced by the names embedded in the PDF, with generic fallbacks. Install
  or \`@font-face\` the real families for an exact match.
`;

  return {
    [`${safeName}.jsx`]: component,
    [`${safeName}.css`]: PAGE_CSS + "\n",
    "README.md": readme,
  };
}
