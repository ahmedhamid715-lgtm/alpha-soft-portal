import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : undefined;

  if (!token) {
    return (
      <Card className="w-full max-w-sm">
        <h1 className="sr-only">Reset password</h1>
        <CardHeader>
          <CardTitle className="text-xl" aria-hidden="true">Reset password</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>This link is missing a reset token.</AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <h1 className="sr-only">Choose a new password</h1>
      <CardHeader>
        <CardTitle className="text-xl" aria-hidden="true">Choose a new password</CardTitle>
        <CardDescription>Your reset link is valid for one hour and can only be used once.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm token={token} />
      </CardContent>
    </Card>
  );
}
