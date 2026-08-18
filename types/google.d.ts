// Google Identity Services and the Picker, declared against what we actually call.
//
// Both arrive as scripts at runtime rather than as packages, so nothing describes them
// to the compiler. These are the surfaces src/lib/google-slides.ts touches and no more.

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
}

interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
  /** Raised for the dialog itself — closed, blocked, never opened. */
  error_callback?: (error: { type?: string }) => void;
}

interface GoogleTokenClient {
  requestAccessToken(): void;
}

interface GooglePickerDocument {
  id: string;
  name?: string;
}

interface GooglePickerResponse {
  action: string;
  docs?: GooglePickerDocument[];
}

interface GooglePickerView {
  setSelectFolderEnabled(enabled: boolean): GooglePickerView;
}

interface GooglePicker {
  setVisible(visible: boolean): void;
}

interface GooglePickerBuilder {
  addView(view: GooglePickerView): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setAppId(appId: string): GooglePickerBuilder;
  setCallback(callback: (data: GooglePickerResponse) => void): GooglePickerBuilder;
  build(): GooglePicker;
}

interface GooglePickerNamespace {
  DocsView: new (viewId: string) => GooglePickerView;
  PickerBuilder: new () => GooglePickerBuilder;
  ViewId: { PRESENTATIONS: string };
  Action: { PICKED: string; CANCEL: string };
}

declare global {
  interface Window {
    google?: {
      accounts?: { oauth2?: { initTokenClient(config: GoogleTokenClientConfig): GoogleTokenClient } };
      picker?: GooglePickerNamespace;
    };
    gapi?: { load(module: string, callback: () => void): void };
  }
}

export {};
