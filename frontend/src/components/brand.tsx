import { cn } from "@/lib/utils";

type OttoBotMarkProps = {
  className?: string;
  accentClassName?: string;
  title?: string;
};

export function OttoBotMark({
  className,
  accentClassName,
  title = "OttoBot",
}: OttoBotMarkProps) {
  return (
    <svg
      viewBox="72 147 368 224"
      fill="none"
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={title}
    >
      <path
        d="M175 177H222C267.287 177 304 213.713 304 259C304 304.287 267.287 341 222 341H175C129.713 341 93 304.287 93 259C93 213.713 129.713 177 175 177Z"
        stroke="currentColor"
        strokeWidth="34"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M290 177H337C382.287 177 419 213.713 419 259C419 304.287 382.287 341 337 341H290C244.713 341 208 304.287 208 259C208 213.713 244.713 177 290 177Z"
        stroke="currentColor"
        strokeWidth="34"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M258 219L298 259L258 299"
        className={cn("text-primary", accentClassName)}
        stroke="currentColor"
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
