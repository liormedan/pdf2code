// Zero-dependency static server for the Sprint 0 bake-off harness.
// Serves the project root so the harness can reach both /fixtures and /node_modules/pdfjs-dist.

import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(fileURLToPath(import.meta.url), "..", ".."));
const PORT = Number(process.env.PORT ?? 4321);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // Redirect rather than serve in place: the harness loads its modules relatively,
  // so the browser's base URL has to actually be /bakeoff/.
  if (pathname === "/" || pathname === "/bakeoff") {
    return send(res, 302, "", { Location: "/bakeoff/" });
  }
  if (pathname === "/bakeoff/") pathname = "/bakeoff/index.html";

  // List the fixture set, with size, so the harness can build its menu.
  if (pathname === "/api/fixtures") {
    try {
      const dir = join(ROOT, "fixtures");
      const names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".pdf")).sort();
      const items = await Promise.all(
        names.map(async (name) => ({ name, size: (await stat(join(dir, name))).size })),
      );
      return send(res, 200, JSON.stringify(items), { "Content-Type": MIME[".json"] });
    } catch {
      return send(res, 200, "[]", { "Content-Type": MIME[".json"] });
    }
  }

  // Resolve inside ROOT only — reject anything that escapes it.
  const filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT + sep)) return send(res, 403, "Forbidden");

  try {
    const body = await readFile(filePath);
    send(res, 200, body, { "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
  } catch {
    send(res, 404, `Not found: ${pathname}`);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Bake-off harness  ->  http://localhost:${PORT}\n`);
  console.log(`  serving ${ROOT}\n`);
});
