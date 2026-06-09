import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { toast } from "sonner"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toastError(error: unknown, fallback = "Failed") {
  toast.error(error instanceof Error ? error.message : fallback)
}
