import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const textareaVariants = cva(
  "flex field-sizing-content min-h-16 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default: "",
        // A bare writing surface sitting directly on a card, rather than a
        // boxed field. `dark:bg-transparent` is load-bearing: the base
        // `dark:bg-input/30` is a different tailwind-merge group from
        // `bg-transparent`, so without it the dark fill still paints a lighter
        // panel behind the text. Body text size is held at every width, since
        // the surface is the document being written, not a form control.
        bare: "rounded-none border-0 bg-transparent px-0.5 py-0 text-base shadow-none focus-visible:ring-0 md:text-base dark:bg-transparent",
      },
      // Post bodies render in the content face, so the field you write them in
      // matches. Placeholders stay in the UI face - they are chrome, not prose.
      font: {
        default: "",
        content: "font-content leading-relaxed placeholder:font-sans",
      },
    },
    defaultVariants: {
      variant: "default",
      font: "default",
    },
  }
)

function Textarea({
  className,
  variant = "default",
  font = "default",
  ...props
}: React.ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(textareaVariants({ variant, font, className }))}
      {...props}
    />
  )
}

export { Textarea }
