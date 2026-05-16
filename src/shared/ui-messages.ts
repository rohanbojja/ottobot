import type { UIMessage } from "ai";

export function hasUIMessageParts(message: UIMessage): boolean {
  return Array.isArray(message.parts) && message.parts.length > 0;
}

type UnknownRecord = Record<string, unknown>;

const TOOL_STATES = new Set([
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
  "output-available",
  "output-error",
  "output-denied",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalRecord(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isDoneState(value: unknown): value is "streaming" | "done" | undefined {
  return value === undefined || value === "streaming" || value === "done";
}

function isProviderFailedOutput(output: unknown): boolean {
  return isRecord(output) && output["status"] === "failed";
}

function toolErrorText(part: UnknownRecord): string {
  const explicitErrorText = optionalString(part["errorText"]);
  if (explicitErrorText) return explicitErrorText;

  const output = part["output"];
  if (isRecord(output)) {
    const error = output["error"];
    if (isRecord(error)) {
      const message = optionalString(error["message"]);
      if (message) return message;
    }

    const message = optionalString(output["message"]);
    if (message) return message;
  }

  return "Tool call failed.";
}

function baseToolPart(part: UnknownRecord, type: string): UnknownRecord | null {
  const toolCallId = optionalString(part["toolCallId"]);
  if (!toolCallId) return null;

  const next: UnknownRecord = {
    type,
    toolCallId,
  };

  if (type === "dynamic-tool") {
    const toolName = optionalString(part["toolName"]);
    if (!toolName) return null;
    next["toolName"] = toolName;
  }

  for (const key of [
    "title",
    "toolMetadata",
    "providerExecuted",
    "callProviderMetadata",
    "resultProviderMetadata",
    "preliminary",
    "approval",
  ]) {
    if (hasOwn(part, key)) next[key] = part[key];
  }

  return next;
}

function sanitizeToolPart(part: UnknownRecord, type: string): UIMessage["parts"][number] | null {
  const base = baseToolPart(part, type);
  if (!base) return null;

  const rawState = part["state"];
  const state = typeof rawState === "string" && TOOL_STATES.has(rawState)
    ? rawState
    : hasOwn(part, "output")
      ? "output-available"
      : "input-available";

  if (state === "output-error" || isProviderFailedOutput(part["output"])) {
    return {
      ...base,
      state: "output-error",
      ...(hasOwn(part, "input") ? { input: part["input"] } : {}),
      errorText: toolErrorText(part),
    } as UIMessage["parts"][number];
  }

  if (state === "output-available") {
    if (!hasOwn(part, "output")) return null;
    return {
      ...base,
      state,
      input: part["input"],
      output: part["output"],
    } as UIMessage["parts"][number];
  }

  if (state === "output-denied") {
    if (!hasOwn(part, "input") || !isRecord(part["approval"])) return null;
    return {
      ...base,
      state,
      input: part["input"],
      approval: part["approval"],
    } as UIMessage["parts"][number];
  }

  if (state === "approval-requested" || state === "approval-responded") {
    if (!hasOwn(part, "input") || !isRecord(part["approval"])) return null;
    return {
      ...base,
      state,
      input: part["input"],
      approval: part["approval"],
    } as UIMessage["parts"][number];
  }

  if (state === "input-streaming") {
    return {
      ...base,
      state,
      input: part["input"],
    } as UIMessage["parts"][number];
  }

  if (!hasOwn(part, "input")) return null;
  return {
    ...base,
    state: "input-available",
    input: part["input"],
  } as UIMessage["parts"][number];
}

function sanitizePart(part: unknown): UIMessage["parts"][number] | null {
  if (!isRecord(part)) return null;

  const type = optionalString(part["type"]);
  if (!type) return null;

  if (type === "text") {
    const text = optionalString(part["text"]);
    if (text === undefined || !isDoneState(part["state"])) return null;
    return {
      type,
      text,
      ...(part["state"] ? { state: part["state"] as "streaming" | "done" } : {}),
      ...(optionalRecord(part["providerMetadata"]) ? { providerMetadata: part["providerMetadata"] } : {}),
    } as UIMessage["parts"][number];
  }

  if (type === "reasoning") {
    const text = optionalString(part["text"]);
    if (text === undefined || !isDoneState(part["state"])) return null;
    return {
      type,
      text,
      ...(part["state"] ? { state: part["state"] as "streaming" | "done" } : {}),
      ...(optionalRecord(part["providerMetadata"]) ? { providerMetadata: part["providerMetadata"] } : {}),
    } as UIMessage["parts"][number];
  }

  if (type === "step-start") {
    return { type };
  }

  if (type === "file") {
    const mediaType = optionalString(part["mediaType"]);
    const url = optionalString(part["url"]);
    if (!mediaType || !url) return null;
    return {
      type,
      mediaType,
      url,
      ...(optionalString(part["filename"]) ? { filename: optionalString(part["filename"]) } : {}),
      ...(optionalRecord(part["providerMetadata"]) ? { providerMetadata: part["providerMetadata"] } : {}),
    } as UIMessage["parts"][number];
  }

  if (type === "source-url") {
    const sourceId = optionalString(part["sourceId"]);
    const url = optionalString(part["url"]);
    if (!sourceId || !url) return null;
    return {
      type,
      sourceId,
      url,
      ...(optionalString(part["title"]) ? { title: optionalString(part["title"]) } : {}),
      ...(optionalRecord(part["providerMetadata"]) ? { providerMetadata: part["providerMetadata"] } : {}),
    } as UIMessage["parts"][number];
  }

  if (type === "source-document") {
    const sourceId = optionalString(part["sourceId"]);
    const mediaType = optionalString(part["mediaType"]);
    const title = optionalString(part["title"]);
    if (!sourceId || !mediaType || !title) return null;
    return {
      type,
      sourceId,
      mediaType,
      title,
      ...(optionalString(part["filename"]) ? { filename: optionalString(part["filename"]) } : {}),
      ...(optionalRecord(part["providerMetadata"]) ? { providerMetadata: part["providerMetadata"] } : {}),
    } as UIMessage["parts"][number];
  }

  if (type.startsWith("data-")) {
    if (!hasOwn(part, "data")) return null;
    return {
      type,
      ...(optionalString(part["id"]) ? { id: optionalString(part["id"]) } : {}),
      data: part["data"],
    } as UIMessage["parts"][number];
  }

  if (type === "dynamic-tool" || type.startsWith("tool-")) {
    return sanitizeToolPart(part, type);
  }

  return null;
}

function sanitizeMessage(message: unknown): UIMessage | null {
  if (!isRecord(message)) return null;

  const id = optionalString(message["id"]);
  const role = message["role"];
  const rawParts = message["parts"];
  if (
    !id ||
    (role !== "system" && role !== "user" && role !== "assistant") ||
    !Array.isArray(rawParts)
  ) {
    return null;
  }

  const parts = rawParts
    .map(sanitizePart)
    .filter((part): part is UIMessage["parts"][number] => part !== null);

  if (parts.length === 0) return null;

  return {
    id,
    role,
    parts,
    ...(hasOwn(message, "metadata") ? { metadata: message["metadata"] } : {}),
  } as UIMessage;
}

export function sanitizeUIMessages(messages: UIMessage[] | unknown[]): UIMessage[] {
  return messages
    .map(sanitizeMessage)
    .filter((message): message is UIMessage => message !== null);
}
