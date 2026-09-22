import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/shared/lib/utils"

// The one X of the app: closing a modal or panel, dismissing a notice, removing
// an item. `overlay` is for sitting on top of an image or banner, where a bare
// icon can vanish into the picture.
const closeButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full outline-none transition-colors select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        ghost: "text-text-muted hover:bg-white/10 hover:text-text-primary",
        danger: "text-text-muted hover:bg-red/12 hover:text-red-text",
        overlay: "bg-black/60 text-white ring-1 ring-white/25 backdrop-blur-sm hover:bg-black/80",
      },
      size: {
        xs: "size-6",
        sm: "size-8",
        md: "size-10",
      },
    },
    defaultVariants: { variant: "ghost", size: "sm" },
  }
)

const ICON_SIZE = { xs: 13, sm: 16, md: 18 } as const

function CloseButton({
  className,
  variant = "ghost",
  size = "sm",
  label = "Fechar",
  ...props
}: Omit<ButtonPrimitive.Props, "children"> & VariantProps<typeof closeButtonVariants> & { label?: string }) {
  return (
    <ButtonPrimitive
      data-slot="close-button"
      aria-label={label}
      className={cn(closeButtonVariants({ variant, size }), className)}
      {...props}
    >
      <X size={ICON_SIZE[size ?? "sm"]} aria-hidden />
    </ButtonPrimitive>
  )
}

export { CloseButton }
