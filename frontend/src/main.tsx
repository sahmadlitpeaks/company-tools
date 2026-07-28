import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { ToastProvider } from "./components/ui";
import PwaStatus from "./components/PwaStatus";
import NativeGate from "./native/NativeGate";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          {/* No-op in a browser; in the native shell this asks which server to
              talk to, then starts push and deep-link handling. */}
          <NativeGate>
            <AuthProvider>
              <App />
              <PwaStatus />
            </AuthProvider>
          </NativeGate>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
