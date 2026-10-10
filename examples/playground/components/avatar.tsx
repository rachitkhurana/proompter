export function Avatar({ tone = "", testId }: { tone?: "" | "b" | "c"; testId?: string }) {
  return <div className={`h-av ${tone}`.trim()} data-testid={testId} />;
}
