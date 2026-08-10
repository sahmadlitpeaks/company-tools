import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-none border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "border-blue-200 bg-blue-50 text-blue-700 [a]:hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300 dark:[a]:hover:bg-blue-900",
        secondary:
          "border-purple-200 bg-purple-50 text-purple-700 [a]:hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300 dark:[a]:hover:bg-purple-900",
        destructive:
          "border-red-200 bg-red-50 text-red-700 focus-visible:ring-red-600/20 dark:border-red-900 dark:bg-red-950 dark:text-red-300 dark:focus-visible:ring-red-400/30 [a]:hover:bg-red-100 dark:[a]:hover:bg-red-900",
        success:
          "border-green-200 bg-green-50 text-green-700 focus-visible:ring-green-600/20 dark:border-green-900 dark:bg-green-950 dark:text-green-300 dark:focus-visible:ring-green-400/30 [a]:hover:bg-green-100 dark:[a]:hover:bg-green-900",
        warning:
          "border-amber-200 bg-amber-50 text-amber-700 focus-visible:ring-amber-600/20 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 dark:focus-visible:ring-amber-400/30 [a]:hover:bg-amber-100 dark:[a]:hover:bg-amber-900",
        info:
          "border-sky-200 bg-sky-50 text-sky-700 focus-visible:ring-sky-600/20 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300 dark:focus-visible:ring-sky-400/30 [a]:hover:bg-sky-100 dark:[a]:hover:bg-sky-900",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
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
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
