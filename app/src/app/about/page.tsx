import type { Metadata } from "next";
import { Ghost } from "lucide-react";
import { InochiWordmark } from "@/components/inochi-wordmark";
import { AboutRotator } from "./rotator";

export const metadata: Metadata = {
  title: "About · inochi",
};

const version = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
const buildDate =
  process.env.NEXT_PUBLIC_BUILD_DATE || new Date().toISOString().slice(0, 10);
const gitSha = process.env.NEXT_PUBLIC_GIT_SHA;

export default function AboutPage() {
  // 130px = nav spacer (56) + main py (26) + 48 of footer headroom. The 48 used
  // to be pb-12; folding it into the calc instead keeps the mt-auto footer in
  // the same place on tall viewports without leaving 48px of scrollable blank
  // under the footer on short ones.
  return (
    <article className="flex min-h-[calc(100dvh-130px)] flex-col items-center gap-12 pt-12 text-center">
      <header className="flex flex-col items-center gap-3">
        <span
          aria-hidden
          className="text-7xl leading-none text-primary/90"
          style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}
        >
          命
        </span>
        <InochiWordmark className="text-xl" />
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

      <footer className="mt-auto flex w-full flex-col items-center py-4 text-center">
        <Ghost
          aria-hidden
          className="mb-2.5 size-5 text-primary"
          strokeWidth={1.625}
        />

        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-foreground">
            <span className="font-medium">Yuurei Networks</span>
            <span className="ml-1 text-muted-foreground">presents</span>
          </p>

          <p className="text-xs text-muted-foreground/60 tabular-nums">
            {gitSha ? (
              <a
                href={`https://github.com/angr6908/inochi/commit/${gitSha}`}
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                v{version} ({gitSha.slice(0, 7)})
              </a>
            ) : (
              <>v{version}</>
            )}
            {" · "}
            {buildDate}
          </p>
        </div>
      </footer>
    </article>
  );
}
