# pdf2code

Convert a PDF into a standalone HTML page or a drop-in React component — **entirely in the browser**. The file is never uploaded anywhere.

---

## What it does

Each converted page is built from two layers:

1. **A raster layer** carrying vector art, images and rules — everything a text-only reconstruction would lose.
2. **A real text layer** of absolutely positioned markup using the document's original fonts, laid transparently over it.

The result looks identical to the PDF, and the text stays real text: selectable, searchable, translatable and editable. Turn the background off and you get clean markup instead — editable, but without the graphics.

Right-to-left scripts are handled properly. `<html lang>` and `dir` are derived from the document's own content, so a Hebrew or Arabic PDF exports as a correctly-declared right-to-left page rather than one mislabelled as English.

## Running it

```bash
npm install
cp .env.example .env.local   # then fill both values in
npm run dev
```

The app sits behind a shared access code. Set `ACCESS_CODE` and `SESSION_SECRET` in `.env.local`:

```bash
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"   # a SESSION_SECRET
```

In development a **Sign in as developer** button skips the code. It is gated on `NODE_ENV` inside the route handler, not merely hidden — the endpoint refuses the developer path in any production build, so it cannot be reached by calling the API directly either.

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
src/lib/         browser glue: pdf.js setup, job state, auth, pricing
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
- **Nothing is stored.** No files, no accounts, no history — conversion activity lives in the browser tab and disappears on refresh.

## Licence

Not yet chosen.
