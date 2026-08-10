import { useState } from "react";
import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/auth/AuthContext";
import { useToast } from "@/components/ui";

function MicrosoftIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 21 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      data-icon="inline-start"
      {...props}
    >
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export interface AuthConfig {
  azure: boolean;
  password: boolean;
}

export function LoginForm({
  className,
  config,
  notice,
  ...props
}: React.ComponentProps<"div"> & {
  config: AuthConfig;
  notice?: string | null;
}) {
  const { login, passwordLogin } = useAuth();
  const { notify } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    if (mfaRequired && !code) return;
    setIsSubmitting(true);
    try {
      await passwordLogin(email, password, code || undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      if (/2fa|code required/i.test(msg) && !mfaRequired) {
        setMfaRequired(true);
        notify("Enter your authenticator code to continue.", "info");
      } else {
        notify(msg, "error");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const showPassword = config.password;
  const showAzure = config.azure;

  return (
    <div className={cn("relative flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center bg-primary text-sm font-bold text-primary-foreground">
            AG
          </div>
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>
            Sign in to AG Holding to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notice ? (
            <Alert className="mb-6">
              <TriangleAlert />
              <AlertTitle>Sign-in notice</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={handlePassword}>
            <FieldGroup>
              {showPassword ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="login-email">Email</FieldLabel>
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="username"
                      placeholder="you@agholding.net"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isSubmitting}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="login-password">Password</FieldLabel>
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                    placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={isSubmitting}
                    />
                  </Field>
                  {mfaRequired ? (
                    <Field>
                      <FieldLabel htmlFor="login-mfa">
                        Authenticator code
                      </FieldLabel>
                      <Input
                        id="login-mfa"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        autoFocus
                        required
                        disabled={isSubmitting}
                      />
                      <FieldDescription>
                        Enter the 6-digit code from your authenticator app.
                      </FieldDescription>
                    </Field>
                  ) : null}
                  <Field>
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <Spinner data-icon="inline-start" />
                          Signing in…
                        </>
                      ) : mfaRequired ? (
                        "Verify & sign in"
                      ) : (
                        "Sign in"
                      )}
                    </Button>
                  </Field>
                </>
              ) : null}

              {showPassword && showAzure ? (
                <FieldSeparator>Or continue with</FieldSeparator>
              ) : null}

              {showAzure ? (
                <Field>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full"
                    onClick={login}
                    disabled={isSubmitting}
                  >
                    <MicrosoftIcon className="size-4" />
                    Sign in with Microsoft
                  </Button>
                  <FieldDescription className="text-center">
                    {showPassword
                      ? "Use your company Microsoft account for SSO"
                      : "Secured by Azure Entra ID single sign-on"}
                  </FieldDescription>
                </Field>
              ) : null}

              {!showPassword && !showAzure ? (
                <FieldDescription className="text-center">
                  No sign-in methods are available. Contact your administrator.
                </FieldDescription>
              ) : null}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        Internal platform for AG Holding employees
      </FieldDescription>
    </div>
  );
}
