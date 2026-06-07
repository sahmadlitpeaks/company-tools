import { useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Modal, useToast } from "./ui";

function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const { changePassword } = useAuth();
  const { notify } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      notify("New password must be at least 8 characters.", "error");
      return;
    }
    if (next !== confirm) {
      notify("New passwords don't match.", "error");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      notify("Password updated.");
      onDone?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn't change password", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label>Current password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label>New password</label>
        <input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <p className="muted mt-1 text-xs">At least 8 characters.</p>
      </div>
      <div className="field">
        <label>Confirm new password</label>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}

/** Modal for changing the password voluntarily (from the profile menu). */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Change password" onClose={onClose}>
      <ChangePasswordForm onDone={onClose} />
    </Modal>
  );
}

/** Full-screen gate shown when the account must change its password first. */
export function ForcePasswordChange() {
  const { logout, user } = useAuth();
  return (
    <div className="center-screen">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
            <KeyRound size={18} />
          </span>
          <div>
            <h2 className="m-0">Set a new password</h2>
            <p className="muted m-0 text-sm">
              For security, please change the password for {user?.email}.
            </p>
          </div>
        </div>
        <ChangePasswordForm />
        <button
          className="btn mt-3 inline-flex w-full items-center justify-center gap-1.5"
          onClick={logout}
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}
