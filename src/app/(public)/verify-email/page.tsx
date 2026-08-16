import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { verifyEmail, type VerifyEmailResult } from "@/server/services/email-verification-service";

export const metadata: Metadata = { title: "Verify email" };

const MESSAGES: Record<VerifyEmailResult, string> = {
  verified: "Your email address has been verified.",
  invalid: "This verification link is invalid.",
  expired: "This verification link has expired.",
  already_used: "This verification link has already been used.",
};

/**
 * Consumes the token on page load (a GET, not a form submission) —
 * unlike password reset, where the equivalent action stays behind a form
 * submit specifically to avoid an email client/link-scanner prefetch
 * silently invalidating the token before the user clicks it. That risk
 * is lower-stakes here (a burned verification link just means requesting
 * a new one, not a security-sensitive action happening without the
 * user's intent), and auto-consuming on load is the expected UX for an
 * email-verification link.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : undefined;

  const result: VerifyEmailResult = token ? await verifyEmail(token) : "invalid";

  return (
    <Card className="w-full max-w-sm">
      <h1 className="sr-only">Email verification</h1>
      <CardHeader>
        <CardTitle className="text-xl" aria-hidden="true">Email verification</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert variant={result === "verified" ? "default" : "destructive"}>
          {result === "verified" ? <CheckCircle2 /> : <AlertCircle />}
          <AlertDescription>{MESSAGES[result]}</AlertDescription>
        </Alert>
        <Button asChild>
          <Link href="/login">{result === "verified" ? "Continue to sign in" : "Back to sign in"}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
