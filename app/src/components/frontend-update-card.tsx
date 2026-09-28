"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getFrontendStatus, updateFrontend, type FrontendStatus } from "@/lib/api";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

const RUNNING = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
const BUILT = process.env.NEXT_PUBLIC_BUILD_DATE;
const RESTART_TIMEOUT_MS = 90_000;

type Phase = "checking" | "idle" | "updating" | "restarting";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong");

async function waitForVersion(version: string): Promise<boolean> {
  const deadline = Date.now() + RESTART_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch("/version.json", { cache: "no-store" }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    if (body?.version === version) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function Note({ tone = "muted", children }: { tone?: "muted" | "error"; children: ReactNode }) {
  return <p className={tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{children}</p>;
}

export function FrontendUpdateCard() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [status, setStatus] = useState<FrontendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      getFrontendStatus()
        .then(setStatus, (err) => setError(messageOf(err)))
        .finally(() => setPhase("idle")),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const check = () => {
    setPhase("checking");
    setError(null);
    load();
  };

  const update = async () => {
    setPhase("updating");
    setError(null);
    try {
      const { installed } = await updateFrontend();
      setPhase("restarting");
      if (await waitForVersion(installed)) {
        window.location.reload();
        return;
      }
      setError(`Installed ${installed}, but the web server did not come back within ${RESTART_TIMEOUT_MS / 1000} seconds. Check the container logs.`);
    } catch (err) {
      setError(messageOf(err));
    }
    setPhase("idle");
  };

  const latest = status?.latest;
  const pinned = status?.pinned;
  const available = !!latest && latest !== RUNNING && !pinned;

  let note: ReactNode = null;
  if (error) note = <Note tone="error">{error}</Note>;
  else if (phase === "updating") note = <Note>Downloading and installing {latest}…</Note>;
  else if (phase === "restarting") note = <Note>Restarting the web server. This page reloads when the new version is live.</Note>;
  else if (phase === "idle" && pinned) note = <Note>Pinned to {pinned} by FRONTEND_VERSION, so updates here are off.</Note>;
  else if (phase === "idle" && available) note = <Note>Version {latest} is available.</Note>;
  else if (phase === "idle" && status) note = <Note>You&rsquo;re on the latest version.</Note>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Frontend</CardTitle>
        <CardDescription>Updates the web app from GitLab without a new image.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={check} disabled={phase !== "idle"}>
            {phase === "checking" ? "Checking…" : "Check for updates"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent stack="sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Running</dt>
          <dd className="tabular-nums">
            {RUNNING}
            {BUILT && <span className="text-muted-foreground"> · built {BUILT}</span>}
          </dd>
          <dt className="text-muted-foreground">Latest</dt>
          <dd className="tabular-nums">{latest ?? (phase === "checking" ? "Checking…" : "Unknown")}</dd>
        </dl>
        {note}
        {available && (
          <div>
            <ConfirmDialog
              trigger={
                <AlertDialogTrigger render={<Button size="sm" disabled={phase !== "idle"} />}>
                  Update to {latest}
                </AlertDialogTrigger>
              }
              title={`Update to ${latest}?`}
              description="The web server restarts to load it, so the site is unavailable for a few seconds and anyone browsing may need to reload."
              confirmLabel="Update"
              onConfirm={update}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
