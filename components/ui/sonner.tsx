"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * Follow the theme the app actually applies.
 *
 * The shadcn original reads next-themes, but this app has no ThemeProvider — its theme
 * is a class on <html>, written before first paint by the inline script in
 * app/layout.tsx. Asking next-themes here always answered "system", which is how a dark
 * app on a light machine ended up with light toasts.
 */
function useAppTheme(): "light" | "dark" {
  // Dark to start, matching the default the inline script applies.
  const [dark, setDark] = useState(true)

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains("dark"))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return dark ? "dark" : "light"
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useAppTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
