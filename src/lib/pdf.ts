import "server-only";
import { jsPDF } from "jspdf";
import type { Proposal } from "./schema";
export function proposalPdf(p: Proposal) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 24;
  const clean = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E\n]/g, "?");
  function text(value: string, size = 10, bold = false) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(clean(value), 170) as string[];
    for (const line of lines) {
      if (y > 272) {
        doc.addPage();
        y = 24;
      }
      doc.text(line, 20, y);
      y += size * 0.47;
    }
    y += 3;
  }
  text("HEATSHIELD / COMMUNITY PLANTING PROPOSAL", 11, true);
  text(p.project_name, 21, true);
  text(
    `Created ${p.created_at.slice(0, 10)} | ${p.sites.length} candidate sites | ${p.data_mode.toUpperCase()}`,
  );
  text(
    "Planning suggestions, not planting approvals. Scores use proposed hackathon weights and do not predict survival or temperature reduction.",
  );
  if (p.sites.some((s) => s.data_quality === "synthetic"))
    text("SYNTHETIC DEMO DATA - not verified planting locations.", 12, true);
  text("Project rationale", 14, true);
  text(p.explanation.summary);
  text("Suggested next steps", 14, true);
  p.explanation.actions.forEach((a, i) => text(`${i + 1}. ${a}`));
  text("Verification checklist", 14, true);
  p.explanation.verification_checklist.forEach((a) => text(`[ ] ${a}`));
  text("Candidate site records", 14, true);
  for (const s of p.sites) {
    text(
      `${s.site_code} | ${s.name} | Score ${s.priority_score ?? "unranked"}`,
      12,
      true,
    );
    text(
      s.area_type === "screening_polygon"
        ? `Screening polygon: ${s.id}. Study area: ${s.study_area}. Status: ${s.verification_status}.`
        : `Coordinates: ${s.latitude}, ${s.longitude}. Status: ${s.verification_status}.`,
    );
    text(`Scoring method: ${s.scoring_version}.`);
    text(
      `Source: ${s.data_source}. Date: ${s.source_date ?? "not supplied"}. Quality: ${s.data_quality}.`,
    );
    text(s.warnings.join(" "));
  }
  text(
    `Generation: ${p.explanation.generation}${p.explanation.model ? ` / ${p.explanation.model}` : ""}. AI selects approved factors/actions; numerical claims come from the scoring engine.`,
  );
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`HeatShield | Needs site verification | ${i} / ${pages}`, 20, 287);
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
