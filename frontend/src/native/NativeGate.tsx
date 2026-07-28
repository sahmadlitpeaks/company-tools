import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { serverStore } from "../api/client";
import ServerSetup from "./ServerSetup";
import { isNative, startNativeShell } from "./shell";

/**
 * Wraps the app for the native shell.
 *
 * In a browser this renders its children and does nothing else. In the app it
 * first makes sure we know which deployment to talk to, then starts push and
 * deep-link handling.
 */
export default function NativeGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [configured, setConfigured] = useState(() => !isNative() || !!serverStore.get());

  useEffect(() => {
    if (!configured) return;
    void startNativeShell((link) => {
      // A pushed notification or deep link routes in-app rather than kicking
      // the user out to a browser.
      const hashAt = link.indexOf("#");
      if (hashAt >= 0) {
        navigate(
          { pathname: link.slice(0, hashAt), hash: link.slice(hashAt) },
          { replace: true },
        );
        return;
      }
      navigate(link);
    });
  }, [configured, navigate]);

  if (!configured) return <ServerSetup onDone={() => setConfigured(true)} />;
  return <>{children}</>;
}
