// Pure rules for reports: what a report may contain and how one moves through
// its states. No DB here.

export const REPORT_CATEGORIES = ['spam', 'harassment', 'inappropriate', 'impersonation', 'illegal', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type ReportTargetType = 'user' | 'group' | 'message';

export const MAX_REPORT_DETAILS = 1000;
export const MAX_SNAPSHOT_TEXT = 2000;

export interface ReportInput { targetType: ReportTargetType; targetId: string; category: ReportCategory; details: string }

export function parseReportInput(body: Record<string, unknown>): ReportInput | null {
  const targetType = body.targetType;
  if (targetType !== 'user' && targetType !== 'group' && targetType !== 'message') return null;
  const targetId = String(body.targetId ?? '').trim();
  if (!targetId || targetId.length > 64) return null;
  const category = body.category;
  if (typeof category !== 'string' || !(REPORT_CATEGORIES as readonly string[]).includes(category)) return null;
  const details = String(body.details ?? '').replace(/\r\n/g, '\n').trim();
  if (details.length > MAX_REPORT_DETAILS) return null;
  return { targetType, targetId, category: category as ReportCategory, details };
}

/** The only evidence kept for a reported message: its text at the time of the
 * report, capped, plus just enough context to act on it. */
export function buildMessageSnapshot(input: { text: string; authorId: string | null; authorUsername: string | null; conversationId: string; conversationTitle: string; createdAt: Date }): Record<string, unknown> {
  return {
    text: input.text.slice(0, MAX_SNAPSHOT_TEXT),
    truncated: input.text.length > MAX_SNAPSHOT_TEXT,
    authorId: input.authorId,
    authorUsername: input.authorUsername,
    conversationId: input.conversationId,
    conversationTitle: input.conversationTitle,
    sentAt: input.createdAt.toISOString(),
  };
}

export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';
export type ReportAction = 'suspend_user' | 'suspend_group' | 'delete_message';
export type ReportResolution = 'no_action' | 'user_suspended' | 'group_suspended' | 'message_deleted';

const ACTIONS_BY_TARGET: Record<ReportTargetType, ReportAction[]> = {
  user: ['suspend_user'],
  group: ['suspend_group'],
  // a reported message can lead to removing it or to suspending whoever wrote it
  message: ['delete_message', 'suspend_user'],
};

export function isActionAllowedFor(targetType: ReportTargetType, action: ReportAction): boolean {
  return ACTIONS_BY_TARGET[targetType].includes(action);
}

export function resolutionFor(action: ReportAction | null): ReportResolution {
  switch (action) {
    case 'suspend_user': return 'user_suspended';
    case 'suspend_group': return 'group_suspended';
    case 'delete_message': return 'message_deleted';
    default: return 'no_action';
  }
}

export const isClosed = (status: string): boolean => status === 'resolved' || status === 'dismissed';
