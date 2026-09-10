import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app";
import "./viewer.css";

/**
 * The viewer's entry point.
 *
 * Deliberately dull. There is no router, no provider tree and no store: one page, one
 * JSON file, and a language toggle that is a `useState`. A developer tool earns its keep
 * by starting in a second and being obvious to change.
 */
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
