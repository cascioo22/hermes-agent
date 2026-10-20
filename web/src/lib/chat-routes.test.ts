import { describe, expect, it } from 'vitest';
import { conversationHref, isConversationRoute } from './chat-routes';
describe('conversation routes', () => {
 it('preserves only deliberate profile and resume scopes', () => {
  expect(conversationHref('/tui', {profile:'research team', resume:'a/b'})).toBe('/tui?profile=research+team&resume=a%2Fb');
  expect(conversationHref('/chat', {})).toBe('/chat');
 });
 it('gives both conversation surfaces the full-height shell', () => {
  expect(isConversationRoute('/chat/')).toBe(true);
  expect(isConversationRoute('/tui')).toBe(true);
  expect(isConversationRoute('/sessions')).toBe(false);
 });
});
