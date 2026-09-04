import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/shared/lib/utils"

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex items-center", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "relative inline-flex h-10 items-center gap-1 rounded-md bg-bg-secondary p-1",
        className
      )}
      {...props}
    />
  )
}

/** Sliding pill behind the active trigger — Base UI measures the active
 * tab's position/size and exposes it via custom properties
 * (--active-tab-*); just needs to come before the triggers in the DOM to
 * sit behind them without a manual z-index. Orientation-aware (used
 * vertically in LeftSidebar and SettingsModal; also supports horizontal,
 * just no current usage of that). */
function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        "absolute rounded-sm bg-bg-selected transition-all duration-200 ease-out",
        "left-(--active-tab-left) top-1 bottom-1 w-(--active-tab-width)",
        "data-[orientation=vertical]:left-1 data-[orientation=vertical]:right-1 data-[orientation=vertical]:top-(--active-tab-top) data-[orientation=vertical]:h-(--active-tab-height) data-[orientation=vertical]:w-auto data-[orientation=vertical]:bottom-auto",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-8 items-center justify-center gap-1.5 rounded-sm px-3 text-body font-medium text-text-muted outline-none transition-colors select-none data-active:text-text-primary hover:text-text-secondary disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsIndicator, TabsTrigger, TabsPanel }
