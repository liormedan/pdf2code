// Google Slides, brought in without a server.
//
// A Slides deck has no bytes on the user's machine — it lives in Drive. So instead of
// reading a file we ask Google to export one, and the export lands in this tab. Our
// server is not in that path: the deck goes from Google to the browser and into the
// same converter every other document uses.
//
// Two deliberate choices sit behind the scope:
//
//   drive.file, not drive.readonly. drive.readonly is a *restricted* scope — it grants
//   the app the user's whole Drive, and Google gates it behind app verification and an
//   annual security assessment. drive.file grants access to one file at a time, the one
//   the user picked in Google's own dialog, and needs neither.
//
//   PDF, not PPTX. Google renders the deck itself, so the export arrives with the
//   fidelity of the real thing rather than of our reconstruction of it.

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const GSI_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";

export interface SlidesConfig {
  clientId: string;
  /** Picker's developer key. */
  apiKey: string;
  /** The Cloud project number, which is what ties a picked file to this app. */
  appId: string;
}

export class SlidesError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SlidesError";
    this.code = code;
  }
}

/**
 * The Google configuration, or null when this deployment has none.
 *
 * Each variable is read as a literal member of process.env because that is what the
 * bundler substitutes at build time — a computed lookup would come back undefined in
 * the browser. A deployment without these simply does not offer the Slides button.
 */
export function slidesConfig(): SlidesConfig | null {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
  const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;
  if (!clientId || !apiKey || !appId) return null;
  return { clientId, apiKey, appId };
}

/** Load a third-party script once, resolving when it is ready to use. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new SlidesError("Google could not be reached.", "SCRIPT_FAILED")));
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => { script.dataset.loaded = "true"; resolve(); };
    script.onerror = () => reject(new SlidesError("Google could not be reached.", "SCRIPT_FAILED"));
    document.head.appendChild(script);
  });
}

/** Ask for an access token, showing Google's consent dialog when it is needed. */
function requestToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.access_token) return resolve(response.access_token);
        // The user closing the consent dialog is a decision, not a failure.
        reject(new SlidesError("Cancelled", response.error === "access_denied" ? "CANCELLED" : "AUTH_FAILED"));
      },
      error_callback: (err) => {
        const cancelled = err?.type === "popup_closed" || err?.type === "popup_failed_to_open";
        reject(new SlidesError("Cancelled", cancelled ? "CANCELLED" : "AUTH_FAILED"));
      },
    });

    if (!client) return reject(new SlidesError("Google sign-in is unavailable.", "AUTH_FAILED"));
    client.requestAccessToken();
  });
}

/** Show Google's own file picker, limited to presentations. */
function pickFile(config: SlidesConfig, token: string): Promise<{ id: string; name: string }> {
  return new Promise((resolve, reject) => {
    window.gapi?.load("picker", () => {
      const picker = window.google!.picker!;
      const view = new picker.DocsView(picker.ViewId.PRESENTATIONS).setSelectFolderEnabled(false);

      new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(config.apiKey)
        // Without the app id the picked file is never granted to this app, and the
        // export below comes back 404 despite the user having just chosen the file.
        .setAppId(config.appId)
        .setCallback((data) => {
          if (data.action === picker.Action.CANCEL) {
            return reject(new SlidesError("Cancelled", "CANCELLED"));
          }
          if (data.action !== picker.Action.PICKED) return;

          const doc = data.docs?.[0];
          if (!doc) return reject(new SlidesError("No presentation was selected.", "CANCELLED"));
          resolve({ id: doc.id, name: doc.name || "Presentation" });
        })
        .build()
        .setVisible(true);
    });
  });
}

/** Export the chosen deck as a PDF, straight into this tab. */
async function exportAsPdf(fileId: string, token: string): Promise<Uint8Array> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=application/pdf`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!response.ok) {
    // Drive refuses to export a Workspace file past a fixed size, and says so with a
    // reason worth repeating rather than a generic failure.
    const body = await response.text().catch(() => "");
    if (/exportSizeLimitExceeded/i.test(body)) {
      throw new SlidesError(
        "Google could not export this deck — it is past the size Drive will convert. Download it as a PDF and convert that instead.",
        "TOO_LARGE",
      );
    }
    throw new SlidesError("Google could not export this presentation.", `HTTP_${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

/** Sign in, pick a deck, and bring it back as PDF bytes. */
export async function pickPresentation(): Promise<{ name: string; bytes: Uint8Array }> {
  const config = slidesConfig();
  if (!config) throw new SlidesError("Google Slides is not configured on this deployment.", "NOT_CONFIGURED");

  await Promise.all([loadScript(GSI_SRC), loadScript(GAPI_SRC)]);

  const token = await requestToken(config.clientId);
  const picked = await pickFile(config, token);
  const bytes = await exportAsPdf(picked.id, token);

  if (!bytes.length) throw new SlidesError("The exported presentation was empty.", "EMPTY");
  return { name: `${picked.name}.pdf`, bytes };
}
