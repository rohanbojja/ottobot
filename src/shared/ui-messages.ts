import type { UIMessage } from "ai";

export function hasUIMessageParts(message: UIMessage): boolean {
  return Array.isArray(message.parts) && message.parts.length > 0;
}

export function sanitizeUIMessages(messages: UIMessage[]): UIMessage[] {
  return messages.filter(hasUIMessageParts);
}
