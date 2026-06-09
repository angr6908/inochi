"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/utils";

const config = {
  signin: {
    title: "Sign in to inochi",
    submit: "Sign in",
    pending: "Signing in...",
    prompt: "Don't have an account?",
    linkHref: "/auth/signup",
    linkLabel: "Sign up",
    minLength: undefined as number | undefined,
  },
  signup: {
    title: "Create an account",
    submit: "Sign up",
    pending: "Creating...",
    prompt: "Already have an account?",
    linkHref: "/auth/signin",
    linkLabel: "Sign in",
    minLength: 4 as number | undefined,
  },
};

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const { signIn, signUp } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const c = config[mode];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await (mode === "signin" ? signIn : signUp)(username, password);
      router.push("/");
    } catch (err) {
      toastError(err, `${c.submit} failed`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{c.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={c.minLength} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? c.pending : c.submit}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {c.prompt}{" "}
            <Link href={c.linkHref} className="text-primary hover:underline">{c.linkLabel}</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
