import type { Metadata } from "next";
import { AboutRotator } from "./rotator";

export const metadata: Metadata = {
  title: "About · inochi",
};

const version = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE || new Date().toISOString().slice(0, 10);

export default function AboutPage() {
  return (
    <article className="flex min-h-[calc(100dvh-82px)] flex-col items-center gap-12 py-12 text-center">
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

      <div className="flex max-w-md flex-col items-center">
        <AboutRotator />
      </div>

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

      <footer className="mt-auto flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <p>
          Built with <span className="text-primary">♡</span> and Claude Opus by{" "}
          <span className="font-medium text-foreground">Prisoner</span>
        </p>
        <p className="flex items-center gap-1.5 text-xs tracking-wide text-muted-foreground/60 tabular-nums">
          <span>v{version}</span>
          <span aria-hidden className="size-[2px] rounded-full bg-muted-foreground/40" />
          <span>{buildDate}</span>
        </p>
      </footer>
    </article>
  );
}
