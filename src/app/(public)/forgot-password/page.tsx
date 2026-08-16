import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <Card className="w-full max-w-sm">
      {/* See (public)/login/page.tsx's comment on why this is separate from CardTitle. */}
      <h1 className="sr-only">Forgot your password?</h1>
      <CardHeader>
        <CardTitle className="text-xl" aria-hidden="true">Forgot your password?</CardTitle>
        <CardDescription>Enter your email and we&apos;ll send you a link to reset it.</CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
      </CardContent>
      <CardFooter className="justify-center border-t pt-4">
        <Link href="/login" className="text-sm text-link underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
