import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/shared/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-transparent bg-bg-textarea px-3 py-1 text-body transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-label file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-input-focus focus-visible:ring-3 focus-visible:ring-input-focus/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
