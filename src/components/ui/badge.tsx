import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary/15 text-primary hover:bg-primary/20",
        secondary: "border-border bg-muted text-muted-foreground hover:bg-muted/70",
        destructive: "border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/20",
        success: "border-success/30 bg-success/15 text-success hover:bg-success/20",
        warning: "border-warning/30 bg-warning/15 text-warning hover:bg-warning/20",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
