import { meetingDirections, type MeetingPoint } from '../../meeting-point';

export async function notifyInvite(invitation: {
  id: string; email: string; sender: string; title: string; sites: string[]; meeting: MeetingPoint | null;
}) {
  if (!invitation.email) return 'no-email';
  const { HEAT_SHIELD_RESEND_KEY: key, HEAT_SHIELD_EMAIL_FROM: from,
    HEAT_SHIELD_PUBLIC_URL: url, HEAT_SHIELD_TEST_MAIL_PORT: testPort } = process.env;
  const testMailbox = testPort && /^\d{1,5}$/.test(testPort);
  if (!testMailbox && (!key || !from || !url)) return 'unconfigured';
  let inbox: URL;
  try {
    inbox = new URL('/#live-photosynthesis', url || 'http://127.0.0.1:4186');
    if (!testMailbox && inbox.protocol !== 'https:') return 'unconfigured';
  } catch { return 'unconfigured'; }

  const lines = [
    `${invitation.sender} invited you to collaborate on “${invitation.title}” in HeatShield.`,
    'Candidate areas: ' + invitation.sites.join(', '),
    invitation.meeting ? `Meet at ${invitation.meeting.name}: ${meetingDirections(invitation.meeting)}` : '',
    `Sign in to view the proposal and respond: ${inbox.href}`,
  ].filter(Boolean);
  try {
    const response = await fetch(testMailbox ? `http://127.0.0.1:${testPort}/emails` : 'https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7000),
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `heatshield-invite-${invitation.id}`,
        ...(testMailbox ? {} : { Authorization: `Bearer ${key}` }) },
      body: JSON.stringify({ from: from || 'HeatShield Test <test@example.com>', to: [invitation.email],
        subject: 'You’re invited to a HeatShield planting proposal', text: lines.join('\n\n') }),
    });
    return response.ok ? 'accepted' : 'failed';
  } catch { return 'failed'; }
}
