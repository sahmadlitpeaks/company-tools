import { useEffect, useId, useState } from "react";
import { Lightbulb, MessageSquare, Plus, ThumbsUp, UserRound } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../hooks/useApi";
import Attachments from "../components/Attachments";
import { Empty, Modal, PageHead, useToast } from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Idea = {
  id: string;
  title: string;
  description: string;
  kind: string;
  status: string;
  author_name: string;
  username?: string | null;
  anonymous: boolean;
  vote_count: number;
  comment_count: number;
  voted: boolean;
};

type Comment = {
  id: string;
  body: string;
  author_name: string;
  created_at: string;
};

function kindVariant(kind: string): "info" | "warning" {
  return kind === "issue" ? "warning" : "info";
}

function statusVariant(
  status: string
): "secondary" | "outline" | "success" | "default" {
  switch (status) {
    case "completed":
    case "accepted":
      return "success";
    case "planned":
    case "under_review":
      return "default";
    default:
      return "secondary";
  }
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

export default function IdeasPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const rows = useFetch<Idea[]>("/api/ideas");
  const [add, setAdd] = useState(false);
  const [open, setOpen] = useState<Idea | null>(null);
  const [params] = useSearchParams();
  const manager = user?.is_admin || user?.role === "manager";

  useEffect(() => {
    const id = params.get("open");
    const found = rows.data?.find((item) => item.id === id);
    if (found) setOpen(found);
  }, [params, rows.data]);

  async function vote(item: Idea) {
    try {
      await api(`/api/ideas/${item.id}/vote`, { method: "POST" });
      rows.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Vote could not be saved.", "error");
    }
  }

  async function status(item: Idea, nextStatus: string) {
    try {
      await api(`/api/ideas/${item.id}/status`, {
        method: "POST",
        body: { status: nextStatus },
      });
      rows.reload();
      setOpen(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Status could not be changed.", "error");
    }
  }

  const items = rows.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        title="Feedback & Ideas"
        subtitle="Share issues and ideas, discuss them, and vote on what matters."
        action={
          <Button type="button" onClick={() => setAdd(true)}>
            <Plus data-icon="inline-start" />
            Submit
          </Button>
        }
      />

      {items.length === 0 ? (
        <Empty
          icon={<Lightbulb />}
          message="No feedback yet"
          hint="Be the first to share an idea or report an issue."
          action={
            <Button type="button" onClick={() => setAdd(true)}>
              <Plus data-icon="inline-start" />
              Submit feedback
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card
              key={item.id}
              size="sm"
            >
              <CardHeader className="gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={kindVariant(item.kind)} className="capitalize">
                    {item.kind}
                  </Badge>
                  <Badge variant={statusVariant(item.status)} className="capitalize">
                    {formatStatus(item.status)}
                  </Badge>
                </div>
                <CardTitle>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto max-w-full justify-start whitespace-normal p-0 text-left text-base leading-snug"
                    aria-label={`Open feedback: ${item.title}`}
                    onClick={() => setOpen(item)}
                  >
                    <span className="line-clamp-2">{item.title}</span>
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <CardDescription className="line-clamp-3 text-sm leading-relaxed">
                  {item.description}
                </CardDescription>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <UserRound className="size-3.5 shrink-0" />
                  <span className="truncate">{item.author_name}</span>
                </div>
              </CardContent>
              <CardFooter className="gap-2 border-t pt-(--card-spacing)">
                <Button
                  type="button"
                  size="sm"
                  variant={item.voted ? "default" : "outline"}
                  onClick={(event) => {
                    event.stopPropagation();
                    void vote(item);
                  }}
                >
                  <ThumbsUp data-icon="inline-start" />
                  {item.vote_count}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(item);
                  }}
                >
                  <MessageSquare data-icon="inline-start" />
                  {item.comment_count}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {add && (
        <SubmitModal
          defaultUsername={user?.display_name || user?.email || ""}
          onClose={() => setAdd(false)}
          onSaved={() => {
            setAdd(false);
            rows.reload();
            notify("Submission shared.");
          }}
        />
      )}
      {open && (
        <IdeaModal
          idea={open}
          manager={!!manager}
          onStatus={(nextStatus) => void status(open, nextStatus)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function SubmitModal({
  defaultUsername,
  onClose,
  onSaved,
}: {
  defaultUsername: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("idea");
  const [username, setUsername] = useState(defaultUsername);
  const [anonymous, setAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!anonymous && !username.trim()) {
      setError("Enter a username or choose anonymous.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api("/api/ideas", {
        method: "POST",
        body: {
          title: title.trim(),
          description: description.trim(),
          kind,
          username: anonymous ? null : username.trim(),
          anonymous,
        },
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Submission could not be saved.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit =
    !!title.trim() && !!description.trim() && (anonymous || !!username.trim());

  return (
    <Modal
      title="Submit feedback"
      description="Share an idea or report an issue with the team."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isSubmitting || !canSubmit}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isSubmitting ? "Submitting…" : "Submit"}
          </Button>
        </>
      }
    >
      <form id={formId} className="flex flex-col gap-4" onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${formId}-type`}>Type</FieldLabel>
            <Select
              items={[{ value: "idea", label: "Idea" }, { value: "issue", label: "Issue" }]}
              value={kind}
              onValueChange={(value) => setKind(value ?? "")}
            >
              <SelectTrigger id={`${formId}-type`} aria-label="Type" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="idea">Idea</SelectItem><SelectItem value="issue">Issue</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-username`}>Username</FieldLabel>
            <Input
              id={`${formId}-username`}
              required={!anonymous}
              disabled={anonymous}
              maxLength={255}
              placeholder={
                anonymous ? "Hidden for anonymous submissions" : "Name shown with this submission"
              }
              value={anonymous ? "" : username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <div className="flex items-start gap-3 border border-border bg-muted/40 p-3">
            <Checkbox
              id={`${formId}-anon`}
              checked={anonymous}
              onCheckedChange={(checked) => setAnonymous(Boolean(checked))}
            />
            <div className="flex min-w-0 flex-col gap-1">
              <FieldLabel htmlFor={`${formId}-anon`} className="cursor-pointer">
                Submit anonymously
              </FieldLabel>
              <FieldDescription>
                Your username will not appear on this idea or issue.
              </FieldDescription>
            </div>
          </div>
          <Field>
            <FieldLabel htmlFor={`${formId}-title`}>Title</FieldLabel>
            <Input
              id={`${formId}-title`}
              required
              maxLength={255}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-description`}>Description</FieldLabel>
            <Textarea
              id={`${formId}-description`}
              required
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </FieldGroup>
      </form>
    </Modal>
  );
}

function IdeaModal({
  idea,
  manager,
  onStatus,
  onClose,
}: {
  idea: Idea;
  manager: boolean;
  onStatus: (status: string) => void;
  onClose: () => void;
}) {
  const comments = useFetch<Comment[]>(`/api/ideas/${idea.id}/comments`);
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function send() {
    if (!body.trim()) return;
    setIsSubmitting(true);
    try {
      await api(`/api/ideas/${idea.id}/comments`, {
        method: "POST",
        body: { body: body.trim() },
      });
      setBody("");
      comments.reload();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      title={idea.title}
      description={`${idea.kind} · ${formatStatus(idea.status)} · ${idea.author_name}`}
      onClose={onClose}
      maxWidth={680}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={kindVariant(idea.kind)} className="capitalize">
            {idea.kind}
          </Badge>
          <Badge variant={statusVariant(idea.status)} className="capitalize">
            {formatStatus(idea.status)}
          </Badge>
        </div>
        <p className="m-0 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
          {idea.description}
        </p>
        {manager ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-xs font-medium text-muted-foreground">Update status</p>
            <div className="flex flex-wrap gap-2">
              {["under_review", "planned", "accepted", "completed"].map((nextStatus) => (
                <Button
                  type="button"
                  size="sm"
                  variant={idea.status === nextStatus ? "default" : "outline"}
                  key={nextStatus}
                  className="capitalize"
                  onClick={() => onStatus(nextStatus)}
                >
                  {formatStatus(nextStatus)}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <Attachments entityType="idea" entityId={idea.id} />
        <Separator />
        <div className="flex flex-col gap-3">
          <h4 className="m-0 text-sm font-medium">Comments</h4>
          {(comments.data ?? []).length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">No comments yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0 p-0">
              {(comments.data ?? []).map((comment, index) => (
                <li key={comment.id} className="m-0 p-0">
                  {index > 0 ? <Separator /> : null}
                  <div className="flex flex-col gap-1 py-3">
                    <span className="text-sm font-medium">{comment.author_name}</span>
                    <p className="m-0 text-sm leading-relaxed text-muted-foreground">
                      {comment.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              aria-label="Add a comment"
              placeholder="Add a comment…"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <Button
              type="button"
              className={cn("shrink-0")}
              disabled={isSubmitting || !body.trim()}
              onClick={() => void send()}
            >
              {isSubmitting && <Spinner data-icon="inline-start" />}
              {isSubmitting ? "Posting…" : "Post"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
