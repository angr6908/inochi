"use client";

import { AuthProvider } from "@/lib/auth-context";
import { NavBar } from "@/components/nav-bar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children, initialAuthed }: { children: React.ReactNode; initialAuthed: boolean }) {
  return (
    <AuthProvider initialAuthed={initialAuthed}>
      <TooltipProvider>
        <NavBar />
        <main className="mx-auto max-w-[600px] px-4 py-4 sm:px-0">{children}</main>
        <Toaster />
      </TooltipProvider>
    </AuthProvider>
  );
}
