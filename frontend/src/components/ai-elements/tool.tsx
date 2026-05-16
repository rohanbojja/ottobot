"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      "group not-prose mb-2.5 w-full overflow-hidden rounded-md border border-border/60 bg-background/15 shadow-none",
      className
    )}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Approval",
  "approval-responded": "Approved",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Done",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

const statusToneClasses: Record<ToolPart["state"], string> = {
  "approval-requested": "border-amber-400/30 bg-amber-400/10 text-amber-100",
  "approval-responded": "border-sky-400/30 bg-sky-400/10 text-sky-100",
  "input-available": "border-primary/30 bg-primary/10 text-primary",
  "input-streaming": "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  "output-available": "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  "output-denied": "border-orange-400/30 bg-orange-400/10 text-orange-100",
  "output-error": "border-rose-400/30 bg-rose-400/10 text-rose-100",
};

function formatToolName(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export const getStatusBadge = (status: ToolPart["state"]) => (
  <Badge
    className={cn("gap-1 rounded-full border px-2 py-0.5 text-[0.6rem] font-medium tracking-wide", statusToneClasses[status])}
    variant="outline"
  >
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");
  const displayName = title ?? formatToolName(derivedName);

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-3 border-b border-border/60 bg-background/20 px-3 py-2 text-left transition-colors hover:bg-background/30",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="grid size-6 shrink-0 place-items-center rounded-sm border border-border/70 bg-background/70 text-muted-foreground">
          <WrenchIcon className="size-4" />
        </div>
        <div className="truncate font-mono text-[0.92rem] leading-5 text-foreground">{displayName}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {getStatusBadge(state)}
        <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </div>
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "space-y-2 px-3 py-3 text-[0.78rem] text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

const stringifyToolValue = (value: unknown): string => {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2) ?? "";
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
  const inputCode = stringifyToolValue(input);

  if (!inputCode) {
    return null;
  }

  return (
    <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
      <h4 className="font-medium text-[0.6rem] uppercase tracking-[0.22em] text-muted-foreground">
        Input
      </h4>
      <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/50">
        <CodeBlock code={inputCode} language="json" />
      </div>
    </div>
  );
};

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = <CodeBlock code={stringifyToolValue(output)} language="json" />;
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-[0.6rem] uppercase tracking-[0.22em] text-muted-foreground">
        {errorText ? "Error" : "Output"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-lg border text-xs [&_table]:w-full",
          errorText
            ? "border-destructive/20 bg-destructive/10 text-destructive"
            : "border-border/60 bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
