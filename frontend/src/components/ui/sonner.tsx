import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "border border-white/15 bg-[#0F1115]/95 text-white shadow-[0_0_30px_-10px_rgba(168,85,247,0.55)] backdrop-blur-lg",
          title: "font-heading text-sm font-semibold",
          description: "font-body text-xs text-muted-foreground",
          actionButton:
            "rounded-full border border-[#A855F7]/85 bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-white",
          cancelButton:
            "rounded-full border border-white/20 bg-transparent text-white hover:bg-white/10",
          success: "border-[#A855F7]/70",
          warning: "border-[#C084FC]/70",
          error: "border-red-500/50",
          info: "border-white/20",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "rgb(15 17 21 / 0.95)",
          "--normal-text": "var(--color-foreground)",
          "--normal-border": "rgb(255 255 255 / 0.15)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
