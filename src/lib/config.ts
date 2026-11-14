import "server-only";
export function dataMode(): "demo" | "supabase" {
  const mode =
    process.env.DATA_MODE ??
    (process.env.NODE_ENV === "production" ? "" : "demo");
  if (mode !== "demo" && mode !== "supabase")
    throw new Error("Set DATA_MODE explicitly to demo or supabase");
  return mode;
}
export function aiMode(): "template" | "openai" {
  const mode = process.env.AI_MODE ?? "template";
  if (mode !== "template" && mode !== "openai")
    throw new Error("Invalid AI_MODE");
  return mode;
}
