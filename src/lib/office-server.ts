// PowerPoint -> PDF, on the server.
//
// Server-only, and the one place in this codebase where a user's file leaves their
// machine. PDFs are converted in the browser and never uploaded; PPTX has no browser
// renderer, so it is handed to LibreOffice here and deleted the moment it is done.
//
// Every invocation gets its own LibreOffice profile directory. This is not a nicety:
// two `soffice` processes sharing one profile do not queue, they collide — the second
// exits immediately having produced nothing, and the failure is silent.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** How long one document may take before it is killed. */
export const CONVERT_TIMEOUT_MS = 60_000;

/** What LibreOffice is being asked to read. */
export type PresentationFormat = "pptx" | "ppt";

/**
 * Identify a presentation from the bytes themselves.
 *
 * A filename or a Content-Type is a claim; this decides what gets parsed, so it reads
 * the container's own signature instead. `.pptx` is a ZIP, and the pre-2007 `.ppt` is
 * an OLE2 compound file.
 */
export function sniffPresentation(bytes: Uint8Array): PresentationFormat | null {
  if (bytes.length < 8) return null;
  const is = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);

  if (is(0x50, 0x4b, 0x03, 0x04)) return "pptx";
  if (is(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return "ppt";
  return null;
}

export class OfficeError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "OfficeError";
    this.code = code;
  }
}

/**
 * Where LibreOffice lives.
 *
 * `SOFFICE_PATH` wins, so a container can point at whatever it installed. Otherwise we
 * try the name on PATH — which is what a Linux image gives us — and finally the two
 * standard Windows locations, for developing on a desktop.
 */
function sofficeCandidates(): string[] {
  const configured = process.env.SOFFICE_PATH?.trim();
  if (configured) return [configured];

  return [
    "soffice",
    "C:\Program Files\LibreOffice\program\soffice.exe",
    "C:\Program Files (x86)\LibreOffice\program\soffice.exe",
  ];
}

function run(bin: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // execFile, never exec: the arguments carry a filesystem path, and a shell here
    // would make that path executable syntax.
    execFile(bin, args, { timeout, killSignal: "SIGKILL", windowsHide: true }, (err) => {
      if (!err) return resolve();

      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return reject(new OfficeError(`${bin} not found`, "NOT_INSTALLED"));
      // execFile reports a timeout kill as a signalled exit, not as its own error code.
      if ((err as { killed?: boolean }).killed) {
        return reject(new OfficeError("Conversion timed out", "TIMEOUT"));
      }
      reject(new OfficeError(err.message, "FAILED"));
    });
  });
}

/**
 * Convert presentation bytes to PDF bytes.
 *
 * The source is written under a name we choose, never the one the user supplied: it
 * removes path traversal and quoting from the problem entirely. The whole working
 * directory is removed in `finally`, on every path out of here including a crash.
 */
export async function presentationToPdf(
  source: Uint8Array,
  extension: PresentationFormat,
): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "pdf2code-"));
  const profile = join(dir, "profile");
  const input = join(dir, `source.${extension}`);
  const output = join(dir, "source.pdf");

  try {
    await writeFile(input, source);

    const args = [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--invisible",
      "--nologo",
      "--nodefault",
      "--norestore",
      "--nolockcheck",
      "--convert-to", "pdf",
      "--outdir", dir,
      input,
    ];

    let lastError: unknown = null;
    for (const bin of sofficeCandidates()) {
      try {
        await run(bin, args, CONVERT_TIMEOUT_MS);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        // Only a missing binary is worth trying the next candidate for. A real
        // conversion failure means we found LibreOffice and it could not do the job.
        if (!(err instanceof OfficeError) || err.code !== "NOT_INSTALLED") break;
      }
    }
    if (lastError) throw lastError;

    // LibreOffice reports success on its exit code even when it has written nothing,
    // so the output file is the only trustworthy evidence that this worked.
    const pdf = await readFile(output).catch(() => null);
    if (!pdf?.length) {
      throw new OfficeError("LibreOffice produced no output", "EMPTY_OUTPUT");
    }
    return new Uint8Array(pdf);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
