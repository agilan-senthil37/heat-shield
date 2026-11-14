import { handle } from "@/lib/http";
import { loadProposal } from "@/lib/store";
import { authorize } from "@/lib/auth";
import { proposalPdf } from "@/lib/pdf";
export const runtime = "nodejs";
export const GET = (
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) =>
  handle(async () => {
    const u = await authorize(r);
    const p = await loadProposal((await params).id, u.owner, u.token);
    return new Response(Buffer.from(proposalPdf(p)), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="heatshield-${p.id}.pdf"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
