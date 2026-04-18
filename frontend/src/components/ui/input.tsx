import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-lg border-0 border-b-2 border-white/20 bg-black/50 px-4 py-2 font-body text-sm text-foreground outline-none transition-all duration-200 selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-white/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-[#A855F7] focus-visible:shadow-[0_10px_20px_-10px_rgba(168,85,247,0.55)]",
        "aria-invalid:border-destructive aria-invalid:shadow-[0_10px_20px_-10px_rgba(239,68,68,0.35)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
