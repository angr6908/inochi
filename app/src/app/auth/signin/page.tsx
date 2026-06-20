import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = {
  title: "Sign in · inochi",
};

export default function SignInPage() {
  return <AuthForm mode="signin" />;
}
