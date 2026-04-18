import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium tracking-wider uppercase whitespace-nowrap transition-[color,box-shadow,border-color] duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "border-[#A855F7]/85 bg-[#A855F7]/34 text-[#F5E9FF] shadow-[0_0_20px_-10px_rgba(168,85,247,0.86)] [a&]:hover:border-[#C084FC]",
        secondary:
          "border-[#C084FC]/80 bg-[#C084FC]/30 text-[#F3E8FF] [a&]:hover:border-[#C084FC]",
        destructive:
          "border-red-500/60 bg-red-500/20 text-red-200 focus-visible:ring-destructive/30 [a&]:hover:border-red-400",
        outline:
          "border-white/20 bg-transparent text-foreground [a&]:hover:border-[#A855F7]/80 [a&]:hover:text-[#C084FC]",
        ghost: "border-transparent bg-transparent text-muted-foreground [a&]:hover:text-[#C084FC]",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
