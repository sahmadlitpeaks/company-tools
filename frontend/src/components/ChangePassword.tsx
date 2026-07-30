import { useId, useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Modal, useToast } from "./ui";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type FieldErrors = {
  current?: string;
  next?: string;
  confirm?: string;
};

function ChangePasswordFields({
  current,
  next,
  confirm,
  errors,
  isPending,
  setCurrent,
  setNext,
  setConfirm,
}: {
  current: string;
  next: string;
  confirm: string;
  errors: FieldErrors;
  isPending: boolean;
  setCurrent: (v: string) => void;
  setNext: (v: string) => void;
  setConfirm: (v: string) => void;
}) {
  return (
    <FieldGroup>
      <Field data-invalid={errors.current ? true : undefined}>
        <FieldLabel htmlFor="change-password-current">Current password</FieldLabel>
        <Input
          id="change-password-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          minLength={1}
          disabled={isPending}
          aria-invalid={errors.current ? true : undefined}
          aria-describedby="change-password-current-error"
          aria-errormessage="change-password-current-error"
        />
        <FieldError id="change-password-current-error">{errors.current ?? ""}</FieldError>
      </Field>
      <Field data-invalid={errors.next ? true : undefined}>
        <FieldLabel htmlFor="change-password-next">New password</FieldLabel>
        <Input
          id="change-password-next"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          minLength={8}
          disabled={isPending}
          aria-invalid={errors.next ? true : undefined}
          aria-describedby="change-password-next-error"
          aria-errormessage="change-password-next-error"
        />
        <FieldDescription>At least 8 characters.</FieldDescription>
        <FieldError id="change-password-next-error">{errors.next ?? ""}</FieldError>
      </Field>
      <Field data-invalid={errors.confirm ? true : undefined}>
        <FieldLabel htmlFor="change-password-confirm">Confirm new password</FieldLabel>
        <Input
          id="change-password-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          disabled={isPending}
          aria-invalid={errors.confirm ? true : undefined}
          aria-describedby="change-password-confirm-error"
          aria-errormessage="change-password-confirm-error"
        />
        <FieldError id="change-password-confirm-error">{errors.confirm ?? ""}</FieldError>
      </Field>
    </FieldGroup>
  );
}

function useChangePasswordSubmit(onDone?: () => void) {
  const { changePassword } = useAuth();
  const { notify } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  function validate(): FieldErrors {
    const nextErrors: FieldErrors = {};
    if (!current.trim()) {
      nextErrors.current = "Enter your current password.";
    }
    if (next.length < 8) {
      nextErrors.next = "New password must be at least 8 characters.";
    }
    if (next !== confirm) {
      nextErrors.confirm = "New passwords don't match.";
    }
    return nextErrors;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (nextErrors.current || nextErrors.next || nextErrors.confirm) {
      if (nextErrors.next) notify(nextErrors.next, "error");
      else if (nextErrors.confirm) notify(nextErrors.confirm, "error");
      else if (nextErrors.current) notify(nextErrors.current, "error");
      return;
    }
    setIsPending(true);
    try {
      await changePassword(current, next);
      notify("Password updated.");
      onDone?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn't change password", "error");
    } finally {
      setIsPending(false);
    }
  }

  return {
    current,
    next,
    confirm,
    errors,
    setCurrent,
    setNext,
    setConfirm,
    isPending,
    submit,
  };
}

/** Modal for changing the password voluntarily (from the profile menu). */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const formId = useId();
  const state = useChangePasswordSubmit(onClose);
  const formState = { errors: state.errors };
  const errors = formState.errors;

  return (
    <Modal
      title="Change password"
      description="Choose a strong password you don't use elsewhere."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={state.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={state.isPending}>
            {state.isPending && <Spinner data-icon="inline-start" />}
            {state.isPending ? "Saving…" : "Update password"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={state.submit}
        aria-busy={state.isPending || undefined}
      >
        {(formState.errors.current || formState.errors.next || formState.errors.confirm) && (
          <p role="alert" className="sr-only">
            {[errors.current, errors.next, errors.confirm].filter(Boolean).join(" ")}
          </p>
        )}
        <ChangePasswordFields
          current={state.current}
          next={state.next}
          confirm={state.confirm}
          errors={errors}
          isPending={state.isPending}
          setCurrent={state.setCurrent}
          setNext={state.setNext}
          setConfirm={state.setConfirm}
        />
      </form>
    </Modal>
  );
}

/** Full-screen gate shown when the account must change its password first. */
export function ForcePasswordChange() {
  const { logout, user } = useAuth();
  const { notify } = useToast();
  const formId = useId();
  const state = useChangePasswordSubmit();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const formState = { errors: state.errors };
  const errors = formState.errors;

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn't sign out", "error");
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form id={formId} onSubmit={state.submit} aria-busy={state.isPending || undefined} className="w-full max-w-md">
      <Card>
        <CardHeader className="flex flex-row items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center bg-primary text-primary-foreground">
            <KeyRound />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>Set a new password</CardTitle>
            <CardDescription>
              For security, please change the password for {user?.email}.
            </CardDescription>
          </div>
        </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {(formState.errors.current || formState.errors.next || formState.errors.confirm) && (
              <p role="alert" className="sr-only">
                {[errors.current, errors.next, errors.confirm].filter(Boolean).join(" ")}
              </p>
            )}
            <ChangePasswordFields
              current={state.current}
              next={state.next}
              confirm={state.confirm}
              errors={errors}
              isPending={state.isPending}
              setCurrent={state.setCurrent}
              setNext={state.setNext}
              setConfirm={state.setConfirm}
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-2 sm:flex-col">
            <Button type="submit" className="w-full" disabled={state.isPending}>
              {state.isPending && <Spinner data-icon="inline-start" />}
              {state.isPending ? "Saving…" : "Update password"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <LogOut data-icon="inline-start" />
              )}
              {isLoggingOut ? "Signing out…" : "Sign out"}
            </Button>
          </CardFooter>
      </Card>
      </form>
    </div>
  );
}
