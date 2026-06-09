import type { Metadata } from "next";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
  title: "About · inochi",
};

export default function AboutPage() {
  return (
    <article className="flex flex-col items-center gap-12 py-12 text-center">
      <header className="flex flex-col items-center gap-3">
        <span
          aria-hidden
          className="text-7xl leading-none text-primary/90"
          style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}
        >
          命
        </span>
        <span
          className="text-xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          inochi
        </span>
      </header>

      <div className="flex max-w-md flex-col gap-5">
        <h1
          className="text-2xl font-semibold leading-snug tracking-tight text-balance"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          How to escape from a prison called{" "}
          <span className="text-primary">inochi</span>?
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground text-balance">
          It may be the last and greatest jailbreak for all humankind.
        </p>
      </div>

      <Separator className="w-12" />

      <div className="flex flex-col items-center gap-1.5">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Contact
        </span>
        <a
          href="mailto:renraku@vspo.me"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          renraku@vspo.me
        </a>
      </div>

      <footer className="text-sm text-muted-foreground">
        Built with <span className="text-primary">♡</span> and Claude Opus by{" "}
        <span className="font-medium text-foreground">Prisoner</span>
      </footer>
    </article>
  );
}
