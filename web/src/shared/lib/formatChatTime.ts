// Discord-style relative time for a chat message timestamp — shared by
// ChatMessageList (message rows/date dividers) and ChatSearchDialog (result
// rows), so both read a message's age the same way.

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Today: "00:55". Yesterday: "Ontem às 00:55". Anything older: full date,
 * "05/08/2026, 02:06" — same rule Discord uses, so a message's age is clear
 * even scrolled far past its day divider (see formatDateHeading). */
export function formatTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (isSameDay(date, now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return `Ontem às ${time}`;
  const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${dateStr}, ${time}`;
}

export function formatDateHeading(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}
