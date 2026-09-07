import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge class names, letting later Tailwind utilities win over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Whether a keydown landed on something that is already consuming keystrokes.
 *
 * Shared by every global keyboard shortcut in the app, because the failure mode is
 * always the same one: a search box or a settings field loses a character to a
 * shortcut that fired anyway. One function rather than one copy per component is what
 * keeps that guard from drifting as shortcuts are added.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}
