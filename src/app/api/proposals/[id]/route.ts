import { handle, json } from "@/lib/http";
import { loadProposal } from "@/lib/store";
import { authorize } from "@/lib/auth";
export const GET = (
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) =>
  handle(async () => {
    const u = await authorize(r);
    return json({
      data: await loadProposal((await params).id, u.owner, u.token),
    });
  });
