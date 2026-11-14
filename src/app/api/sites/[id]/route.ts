import { handle, json } from "@/lib/http";
import { site } from "@/lib/store";
export const GET = (
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) => handle(async () => json({ data: await site((await params).id) }));
