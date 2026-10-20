import { useRef, useState } from 'react';
import type { GuiChatPendingRequest } from '@/features/gui-chat/types';

const choiceLabels: Record<string, string> = { once: 'Allow once', session: 'Allow for session', always: 'Always allow', deny: 'Deny' };

export function GuiChatRequests({ requests, respond }: { requests: GuiChatPendingRequest[]; respond: (id: string, result: unknown) => Promise<void> }) {
  return <section aria-label="Pending requests" className="space-y-3">{requests.map(request => <PendingRequestCard key={request.id} request={request} respond={respond} />)}</section>;
}

function PendingRequestCard({ request, respond }: { request: GuiChatPendingRequest; respond: (id: string, result: unknown) => Promise<void> }) {
  const [sent, setSent] = useState(false);

  async function reply(result: unknown) {
    try { await respond(request.id, result); } catch (e) { console.error('Response failed:', e); }
  }

  return (
    <article className="border border-border bg-card p-4 space-y-3" aria-busy={sent}>
      <h3>Approval required</h3>
      {typeof request.params.tool_name === 'string' && <p>{request.params.tool_name}</p>}
      {typeof request.params.description === 'string' && <p>{request.params.description}</p>}
      {typeof request.params.command === 'string' && <pre className="max-h-48 overflow-auto whitespace-pre-wrap">{request.params.command}</pre>}
      <div className="flex flex-wrap gap-2">
        {(request.params.choices as string[]).map(choice => (
          <button key={choice} onClick={() => void reply({ choice })}>{choiceLabels[choice] || choice}</button>
        ))}
      </div>
    </article>
  );
}
