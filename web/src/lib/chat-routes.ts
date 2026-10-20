export function isConversationRoute(pathname: string): boolean {
  return ['/chat', '/tui'].includes(pathname.replace(/\/$/, ''));
}

/** Only intentionally supported scope parameters cross between surfaces. */
export function conversationHref(surface: '/chat' | '/tui', scope: {profile?: string | null; resume?: string | null}): string {
  const query = new URLSearchParams();
  if (scope.profile) query.set('profile', scope.profile);
  if (scope.resume) query.set('resume', scope.resume);
  return `${surface}${query.size ? `?${query}` : ''}`;
}
