import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const cardVariants = cva(
  "group/card flex flex-col overflow-hidden rounded-xl border border-foreground/10 bg-card text-sm text-card-foreground has-[>img:first-child]:pt-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
  {
    variants: {
      size: {
        default: "gap-4 py-4 has-data-[slot=card-footer]:pb-0",
        sm: "gap-3 py-3 has-data-[slot=card-footer]:pb-0",
        // No padding of its own: the content slot owns the whole inset. For
        // cards that are a single flush panel rather than stacked sections.
        flush: "gap-0 py-0",
      },
      tone: {
        default: "",
        destructive: "border-destructive",
      },
      // Cards in a thread read as one surface: the shared edge loses its
      // rounding, and only the upper card draws the seam between them.
      join: {
        none: "",
        next: "rounded-b-none border-b-0",
        prev: "rounded-t-none",
        both: "rounded-none border-b-0",
      },
      // A single inset outline traces the card's own box, so corners stay
      // correct on squared join edges, with no layout shift and no bleed onto
      // neighbours.
      highlighted: {
        true: "outline outline-1 outline-primary outline-offset-[-1px]",
        false: "",
      },
      // Drop the top border when the card above already drew that seam.
      borderTop: {
        true: "",
        false: "border-t-0",
      },
    },
    compoundVariants: [
      // A highlighted card needs a complete box for the outline to trace, so it
      // keeps the bottom edge it would otherwise hand to the card below.
      { join: "next", highlighted: true, class: "border-b" },
      { join: "both", highlighted: true, class: "border-b" },
    ],
    defaultVariants: {
      size: "default",
      tone: "default",
      join: "none",
      highlighted: false,
      borderTop: true,
    },
  }
)

function Card({
  className,
  size = "default",
  tone = "default",
  join = "none",
  highlighted = false,
  borderTop = true,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        cardVariants({ size, tone, join, highlighted, borderTop, className })
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

const cardTitleVariants = cva(
  "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
  {
    variants: {
      tone: {
        default: "",
        destructive: "text-destructive",
      },
    },
    defaultVariants: { tone: "default" },
  }
)

function CardTitle({
  className,
  tone = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardTitleVariants>) {
  return (
    <div
      data-slot="card-title"
      className={cn(cardTitleVariants({ tone, className }))}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

const cardContentVariants = cva("", {
  variants: {
    padding: {
      default: "px-4 group-data-[size=sm]/card:px-3",
      // Inset on every side: for a flush card, where the content slot is the
      // only thing holding the card's padding.
      box: "p-4",
    },
    // Vertical rhythm for a content slot holding several blocks.
    stack: {
      none: "",
      sm: "flex flex-col gap-3",
      md: "flex flex-col gap-4",
    },
  },
  defaultVariants: { padding: "default", stack: "none" },
})

function CardContent({
  className,
  padding = "default",
  stack = "none",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardContentVariants>) {
  return (
    <div
      data-slot="card-content"
      className={cn(cardContentVariants({ padding, stack, className }))}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/card:p-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
