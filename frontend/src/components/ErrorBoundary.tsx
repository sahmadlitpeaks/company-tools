import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

interface Props {
  children: ReactNode;
  /** Optional callback after recovery resets the failed subtree. */
  onReset?: () => void;
  variant?: "app" | "route";
}

interface State {
  error: Error | null;
}

const CHUNK_ERROR = /chunk|dynamically imported module|importing a module script/i;

/** Recovery UI when the app or an isolated route subtree throws. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught", error, info.componentStack);
  }

  private reset = () => {
    if (this.state.error && CHUNK_ERROR.test(this.state.error.message)) {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          className={
            this.props.variant === "route"
              ? "grid min-h-[60vh] place-items-center p-6"
              : "grid min-h-screen place-items-center p-6"
          }
        >
          <Empty className="max-w-md border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AlertCircle />
              </EmptyMedia>
              <EmptyTitle>Something went wrong</EmptyTitle>
              <EmptyDescription>
                {this.state.error.message || "An unexpected error crashed this view."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex flex-wrap gap-2">
              <Button type="button" onClick={this.reset}>
                Try again
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  window.location.href = "/";
                }}
              >
                Go home
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
