import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-body text-sm font-semibold whitespace-nowrap transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border border-[#A855F7]/85 bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-primary-foreground shadow-[0_0_20px_-5px_rgba(124,58,237,0.78)] hover:scale-105 hover:shadow-[0_0_34px_-4px_rgba(168,85,247,0.95)]",
        destructive:
          "border border-red-500/60 bg-gradient-to-r from-red-600 to-red-500 text-white shadow-[0_0_22px_-6px_rgba(239,68,68,0.6)] hover:scale-105 hover:shadow-[0_0_30px_-6px_rgba(239,68,68,0.7)]",
        outline:
          "border-2 border-[#A855F7]/70 bg-[#A855F7]/14 text-foreground hover:border-[#C084FC] hover:bg-[#A855F7]/24",
        secondary:
          "border border-white/15 bg-secondary/80 text-secondary-foreground shadow-[0_0_18px_-10px_rgba(168,85,247,0.72)] hover:border-[#A855F7]/80 hover:bg-secondary",
        ghost:
          "border border-transparent bg-transparent text-foreground hover:bg-[#A855F7]/18 hover:text-[#C084FC]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 min-h-[44px] px-5 py-2 tracking-wide has-[>svg]:px-4",
        xs: "h-7 min-h-[44px] gap-1 px-2.5 text-xs tracking-wide has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 min-h-[44px] gap-1.5 px-4 tracking-wide has-[>svg]:px-3",
        lg: "h-12 min-h-[44px] px-7 tracking-wider has-[>svg]:px-5",
        icon: "size-11 min-h-[44px] min-w-[44px]",
        "icon-xs": "size-8 min-h-[44px] min-w-[44px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-10 min-h-[44px] min-w-[44px]",
        "icon-lg": "size-12 min-h-[44px] min-w-[44px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
