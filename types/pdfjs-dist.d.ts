// pdfjs-dist ships declarations for its package root but not for the deep build
// entries. The browser build has to be imported by path — `pdfjs-dist/build/pdf.mjs` —
// so it is declared here and asserted against our own shapes at the call site.

declare module "pdfjs-dist/build/pdf.mjs" {
  const pdfjs: unknown;
  export = pdfjs;
}

declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  const pdfjs: unknown;
  export = pdfjs;
}
