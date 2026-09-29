import { describe, expect, it } from 'vitest';
import {
  ROUTES, conversationIdFromPath, friendsSection, friendsView, isAwaitingOpen, isConversationsPath, isSettingsTab, parseFriendsView,
} from '@/shared/lib/routes';

describe('conversationIdFromPath', () => {
  it('extracts the id from /app/conversations/:id', () => {
    expect(conversationIdFromPath('/app/conversations/abc-123')).toBe('abc-123');
    expect(conversationIdFromPath('/app/conversations/abc-123/')).toBe('abc-123');
  });

  it('decodes the id (round-trip with ROUTES.conversation)', () => {
    expect(conversationIdFromPath(ROUTES.conversation('a b/c'))).toBe('a b/c');
  });

  it('is null for the route without an id and for any other page', () => {
    expect(conversationIdFromPath('/app/conversations')).toBeNull();
    expect(conversationIdFromPath('/app/friends')).toBeNull();
    expect(conversationIdFromPath('/app/conversations/a/extra')).toBeNull();
  });

  it('broken percent-encoding does not throw', () => {
    expect(conversationIdFromPath('/app/conversations/%E0%A4%A')).toBeNull();
  });
});

describe('isConversationsPath', () => {
  it('covers the list and the conversation, and nothing beyond that', () => {
    expect(isConversationsPath('/app/conversations')).toBe(true);
    expect(isConversationsPath('/app/conversations/x')).toBe(true);
    expect(isConversationsPath('/app/conversationsX')).toBe(false);
    expect(isConversationsPath('/app/friends')).toBe(false);
    expect(isConversationsPath('/app/settings/profile')).toBe(false);
  });
});

describe('isSettingsTab', () => {
  it('accepts only the known tabs', () => {
    expect(isSettingsTab('privacy')).toBe(true);
    expect(isSettingsTab('moderation')).toBe(true);
    expect(isSettingsTab('nope')).toBe(false);
    expect(isSettingsTab(undefined)).toBe(false);
  });
});

describe('isAwaitingOpen', () => {
  it('reads the flag from navigation state, without trusting any shape', () => {
    expect(isAwaitingOpen({ awaitingOpen: true })).toBe(true);
    expect(isAwaitingOpen({ awaitingOpen: 'yes' })).toBe(false);
    expect(isAwaitingOpen(null)).toBe(false);
    expect(isAwaitingOpen('x')).toBe(false);
  });
});

describe('Friends routes', () => {
  it('All is the route with no query; the other views use ?tab=', () => {
    expect(friendsView('all')).toBe('/app/friends');
    expect(friendsView('online')).toBe('/app/friends?tab=online');
    expect(friendsView('invitations')).toBe('/app/friends?tab=invitations');
    expect(friendsView('add')).toBe('/app/friends?tab=add');
  });

  it('the search term follows the view', () => {
    expect(friendsView('online', 'ana')).toBe('/app/friends?tab=online&q=ana');
    expect(friendsView('all', 'ana')).toBe('/app/friends?q=ana');
  });

  it('Pending sections use a hash', () => {
    expect(friendsSection('received')).toBe('/app/friends?tab=pending#received');
    expect(friendsSection('sent')).toBe('/app/friends?tab=pending#sent');
  });

  it('an unknown or missing value falls back to All', () => {
    expect(parseFriendsView(null)).toBe('all');
    expect(parseFriendsView('garbage')).toBe('all');
    expect(parseFriendsView('')).toBe('all');
    expect(parseFriendsView('pending')).toBe('pending');
    expect(parseFriendsView('add')).toBe('add');
  });
});
