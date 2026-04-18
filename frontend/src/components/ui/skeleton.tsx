import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-xl border border-white/5 bg-[#131922]", className)}
      {...props}
    />
  )
}

export { Skeleton }
