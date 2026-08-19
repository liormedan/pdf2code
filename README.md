# PDF to Code

Turn a PDF or a presentation into a standalone HTML page or a drop-in React component.

---

## What it takes in

Three sources, one engine. Everything becomes a PDF first, so the conversion below is the same work in all three cases — but how each one gets here differs, and the difference is a privacy one:

| Source | How it arrives | Leaves your machine? |
| --- | --- | --- |
| **PDF** | read locally | **No.** Never uploaded, never sent anywhere. |
| **Google Slides** | exported by Google straight to the browser tab | **No.** It goes from Google to your browser; this app's server is not in that path. |
| **PowerPoint** (`.pptx`, `.ppt`) | converted to PDF by LibreOffice on the server | **Yes** — and only this one. Off unless `NEXT_PUBLIC_ENABLE_PPTX=true`. |

PowerPoint is the exception because browsers have no way to render it: there is no `pptx.js` doing what pdf.js does. Rebuilding DrawingML by hand in the browser was the alternative, and it cannot reach the fidelity this product promises. So a `.pptx` is sent over, converted, and deleted before the response is written — nothing is stored, queued or logged. The interface says so on screen when it happens, rather than leaving it to be assumed.

## What it does

Each converted page is built from two layers:

1. **A raster layer** carrying vector art, images and rules — everything a text-only reconstruction would lose.
2. **A real text layer** of absolutely positioned markup using the document's original fonts, laid transparently over it.

The result looks identical to the PDF, and the text stays real text: selectable, searchable, translatable and editable. Turn the background off and you get clean markup instead — editable, but without the graphics.

Right-to-left scripts are handled properly. `<html lang>` and `dir` are derived from the document's own content, so a Hebrew or Arabic PDF exports as a correctly-declared right-to-left page rather than one mislabelled as English.

## Running it

```bash
npm install
cp .env.example .env.local   # then fill in SESSION_SECRET
npm run dev
```

PDF conversion needs nothing else. The other two sources are optional and each is off until configured — see `.env.example`:

- **PowerPoint** needs `NEXT_PUBLIC_ENABLE_PPTX=true` and LibreOffice reachable as `soffice`, or `SOFFICE_PATH` pointing at it. It is off by default because it cannot run on serverless hosting at all — see `docs/deploy-vercel.md`. In production it means a container image with LibreOffice installed, given no network of its own and a memory and time limit, because it parses files this app did not write. With the flag off, `.pptx` is refused with a way forward and everything else works.
- **Google Slides** needs a Google Cloud project with the Drive and Picker APIs enabled, and the three `NEXT_PUBLIC_GOOGLE_*` values. The button does not render without them.
- **Accounts** need a Firebase project with Email/Password and Google sign-in enabled, the four `NEXT_PUBLIC_FIREBASE_*` values, and a service account in `FIREBASE_SERVICE_ACCOUNT`. Required in production; see below for how development gets by without one.

## Getting in

An account is the only thing that proves anything. Set `SESSION_SECRET`, which signs the cookie that carries it:

```bash
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
```

Firebase verifies the account once, at sign-in, in a Node route handler — `firebase-admin` cannot run on the Edge. What middleware checks on every request after that is an HMAC-signed cookie carrying the uid, which Web Crypto verifies in either runtime with no network call.

A shared beta code used to stand in front of this, and it is gone. Anyone who reaches the app can now create an account, so **who may sign in is Firebase Authentication's decision** — restrict it there, not in this codebase.

In development the sign-in screen also offers a developer button, which mints a session outright so the app runs with no Firebase project at all. Its route answers 404 whenever `NODE_ENV` is production, so it cannot be reached on a deployment.

In development a **Sign in as developer** button skips both, so a machine with no Firebase project can still run the app. It is gated on `NODE_ENV` inside the route handler, not merely hidden — the endpoint refuses the developer path in any production build, so it cannot be reached by calling the API directly either.

## Scripts

| command | what it does |
| --- | --- |
| `npm run dev` | development server |
| `npm run build` | production build (writes to `.next-build`, so it never collides with a running dev server) |
| `npm test` | converter unit checks over the fixture set |
| `npm run qa` | injection, scale, cancellation, pricing, language and React-render checks |
| `npm run validate` | HTML5 validation and JSX compilation of the generated output |
| `npm run contrast` | WCAG contrast audit computed from the design tokens |
| `npm run fixtures` | download the public-domain test PDFs |
| `npm run analyze` | measure text-vs-graphics composition of the fixtures |
| `npm run bakeoff` | side-by-side conversion-engine comparison harness |

## Layout

```
src/converter/   the conversion engine — pure, isomorphic, no DOM
src/lib/         intake (the three sources), pdf.js setup, job state, auth, pricing
src/lib/firebase/  accounts — the client SDK, and the admin SDK that verifies sign-ins
src/i18n/        locale registry; direction is derived, never configured
app/             Next.js App Router — login gate and dashboard
components/      shadcn/ui primitives and app chrome
scripts/         test, QA, validation and fixture tooling
messages/        one JSON file per language
```

`src/converter/` has no dependency on React, Next or the DOM, which is why the same code runs in Node for the test suites and in the browser for the product.

## Adding a language

One line in `src/i18n/config.mjs` and one file in `messages/`. Direction comes from the language subtag, so nothing else needs touching.

## Notes and limits

- **Scanned PDFs** have no text layer. The output keeps the page images, but the text is not selectable or searchable without OCR, which this does not do.
- **Pages are fixed-size.** They match the original layout rather than reflowing, so narrow screens scale rather than rewrap.
- **Fonts** are referenced by the names embedded in the PDF with generic fallbacks. Install the real families for an exact match.
- **Nothing is stored.** No files, no accounts, no history — conversion activity lives in the browser tab and disappears on refresh. A PowerPoint file passes through the server to be converted and is deleted in the same request; nothing about it is written down.
- **PowerPoint fidelity is LibreOffice's**, since it does the rendering. Decks using fonts the server does not have will substitute them, so install the fonts you care about in the image.
- **Google's export has a size limit.** Drive refuses to export a deck past a fixed size; when that happens the app says so and suggests downloading it as a PDF instead.

## Licence

Not yet chosen.
