import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/dm-sans";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./theme/ThemeContext";
import { ToastProvider } from "./components/ui";
import { TooltipProvider } from "./components/ui/tooltip";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            <AuthProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </AuthProvider>
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
