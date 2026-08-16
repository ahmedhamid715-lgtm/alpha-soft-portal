import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";
import { appConfig } from "@/config/app";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const callbackUrl = typeof params.callbackUrl === "string" ? params.callbackUrl : undefined;

  return (
    <Card className="w-full max-w-sm">
      {/* `CardTitle` is a styled `<div>` (a Card can appear anywhere in a
          page, so it can't presume to own a heading level) — this page has
          no `PageHeader` (Module 02) to supply the actual `<h1>`, so it's
          added directly, visually hidden since `CardTitle` already shows
          the same text sighted users see. Found via axe-core
          (`page-has-heading-one`) against the real rendered page. */}
      <h1 className="sr-only">Sign in</h1>
      <CardHeader>
        <CardTitle className="text-xl" aria-hidden="true">Sign in</CardTitle>
        <CardDescription>Sign in to your {appConfig.name} account.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm callbackUrl={callbackUrl} />
      </CardContent>
    </Card>
  );
}
