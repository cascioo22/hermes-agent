import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { Button } from '@nous-research/ui/ui/components/button';
import { PanelRight, X } from 'lucide-react';
import { ChatSidebar } from '@/components/ChatSidebar';
import { ChatSessionList } from '@/components/ChatSessionList';
import { Markdown } from '@/components/Markdown';
import { useProfileScope } from '@/contexts/useProfileScope';
import { usePageHeader } from '@/contexts/usePageHeader';
import { useGuiChat } from '@/features/gui-chat/useGuiChat';
import { readStoredWorkspace, writeStoredWorkspace } from '@/lib/chat-workspaces';
import { readChatPanelCollapsed, toggleChatPanelCollapsed } from '@/lib/chat-panel-collapsed';
import { GuiChatRequests } from './GuiChatRequests';
import './gui-chat.css';

export default function GuiChatPage({isActive = true}: {isActive?: boolean}) {
 const {profile} = useProfileScope();
 return <Conversation key={profile || '__own__'} profile={profile} isActive={isActive} />;
}
function Conversation({profile,isActive}: {profile?:string;isActive:boolean}) {
 const [search,setSearch] = useSearchParams();
 // Persistent hosts must not follow query strings belonging to admin/TUI routes.
 const requestedResume = search.get('resume');
 const [lastResume,setLastResume] = useState(requestedResume);
 if (isActive && lastResume !== requestedResume) setLastResume(requestedResume);
 const resumeId = isActive ? requestedResume : lastResume;
 const [resetKey,setResetKey] = useState(0);
 const [workspace,setWorkspace] = useState(() => readStoredWorkspace(profile));
 const chat = useGuiChat({profile,resumeId,workspaceCwd:workspace,resetKey,isActive});
 const draftKey = `${resumeId || 'new'}:${resetKey}`;
 const [drafts,setDrafts] = useState<Record<string,string>>({});
 const draft = drafts[draftKey] || '';
 const [sending,setSending] = useState(false);
 const submitting = useRef(false);
 const [actionError,setActionError] = useState<string|null>(null);
 const [sendState,setSendState] = useState('');
 const [uploading,setUploading] = useState(false);
 const [collapsed,setCollapsed] = useState(readChatPanelCollapsed);
 const [mobileOpen,setMobileOpen] = useState(false);
 const [narrow,setNarrow] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
 const sheetRef = useRef<HTMLDivElement>(null);
 const transcriptRef = useRef<HTMLDivElement>(null);
 const following = useRef(true);
 const scrollPositions = useRef<Record<string,number>>({});
 const [away,setAway] = useState(false);
 const {setTitle,setEnd} = usePageHeader();
 const togglePanel = () => narrow ? setMobileOpen(true) : setCollapsed(toggleChatPanelCollapsed);
 useEffect(() => {
  const mql=window.matchMedia('(max-width: 1023px)');
  const changed=()=>setNarrow(mql.matches);mql.addEventListener('change',changed);
  return ()=>mql.removeEventListener('change',changed);
 },[]);
 useEffect(() => {
  if (!isActive) return;
  setTitle(chat.title || 'Chat');
  setEnd(<Button ghost size="sm" aria-label="Show chat side panel" aria-expanded={narrow ? mobileOpen : !collapsed} onClick={togglePanel}><PanelRight className="h-4 w-4" /><span>Panel</span></Button>);
  return () => {setTitle(null);setEnd(null);};
 // Header slots are owned by the existing App shell, not a second toolbar.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[isActive,chat.title,narrow,mobileOpen,collapsed,setTitle,setEnd]);
 const showSheet = narrow && mobileOpen && isActive;
 useEffect(() => {
  if (!showSheet) return;
  const previous=document.activeElement as HTMLElement|null;
  const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
  const focusable=()=>Array.from(sheetRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []);
  focusable()[0]?.focus();
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMobileOpen(false);return;}if(e.key==='Tab'){const els=focusable();const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  document.addEventListener('keydown',key);
  return ()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);previous?.focus();};
 },[showSheet]);
 useLayoutEffect(()=>{
  const element=transcriptRef.current;
  const positions=scrollPositions.current;
  if(element){element.scrollTop=scrollPositions.current[draftKey] ?? element.scrollHeight;following.current=element.scrollHeight-element.scrollTop-element.clientHeight<100;}
  return ()=>{if(element)positions[draftKey]=element.scrollTop;};
 },[draftKey]);
 useLayoutEffect(()=>{if(isActive&&following.current&&transcriptRef.current)transcriptRef.current.scrollTop=transcriptRef.current.scrollHeight;},[chat.messages,chat.tools,chat.pendingRequests,isActive]);
 const perform = async (action:()=>Promise<unknown>) => {setActionError(null);try{await action();}catch(e){setActionError(e instanceof Error?e.message:'Action failed');}};
 const send = async () => {
  if(!draft.trim() || chat.busy || submitting.current || chat.pendingRequests.length || chat.connectionState !== 'open')return;
  submitting.current=true;setSending(true);setActionError(null);setSendState('Pending acknowledgement…');
  const text=draft;
  try{await chat.submit(text);setDrafts(prev=>({...prev,[draftKey]:prev[draftKey]===text?'':prev[draftKey]}));setSendState('Sent');}
  catch(e){setActionError(e instanceof Error?e.message:'Send failed');setSendState('Failed or unconfirmed — draft retained. Reconnect to reconcile before retrying.');}
  finally{submitting.current=false;setSending(false);}
 };
 const newChat = () => {
  if(chat.busy || chat.pendingRequests.length){setActionError('Stop the active turn before opening a new conversation.');return;}
  setSearch(prev=>{const next=new URLSearchParams(prev);next.delete('resume');return next;});setResetKey(k=>k+1);setActionError(null);setSendState('');
 };
 const rail = <><div className="flex justify-end"><Button ghost size="icon" aria-label={narrow?'Close chat side panel':'Collapse chat side panel'} onClick={()=>narrow?setMobileOpen(false):setCollapsed(toggleChatPanelCollapsed)}><X /></Button></div>
  <ChatSidebar session={chat} />
  <ChatSessionList className="h-auto min-h-0 flex-1 shrink" profile={profile} isActive={isActive} activeSessionId={chat.storedSessionId || resumeId} onPicked={()=>setMobileOpen(false)} onNewChat={newChat} onSelectSession={id=>{
   if(chat.busy || chat.pendingRequests.length){setActionError('Stop the active turn before switching conversations.');return;}
   setSearch(prev=>{const next=new URLSearchParams(prev);next.set('resume',id);return next;});
  }} workspaceCwd={workspace} onWorkspaceChange={cwd=>{writeStoredWorkspace(profile,cwd);setWorkspace(cwd);}} />
 </>;
 return <div className="gui-chat flex min-h-0 min-w-0 flex-1 gap-4 py-3">
  <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Conversation">
   <div className="shrink-0 text-xs text-text-tertiary px-2 pb-2">Profile: {profile || 'default'} · {resumeId?'Resumed conversation keeps its workspace':`Workspace for new chat: ${workspace || 'server default'}`}</div>
   {(chat.error || actionError || chat.connectionState !== 'open') && <div className="shrink-0 border border-warning/40 p-3 mb-2 text-sm" role="alert"><p>{actionError || chat.error || `Connection: ${chat.connectionState}`}</p><Button outlined size="sm" onClick={()=>void perform(chat.reconnect)}>Reconnect and reconcile</Button></div>}
   <div ref={transcriptRef} className="gui-chat-transcript min-h-0 flex-1 overflow-auto" role="log" aria-label="Messages" onScroll={e=>{const el=e.currentTarget;following.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;setAway(!following.current);scrollPositions.current[draftKey]=el.scrollTop;}}>
    <div className="gui-chat-reading space-y-6">
     {!chat.messages.length && <p className="text-text-secondary py-8">Start a conversation with Hermes.</p>}
     {chat.messages.map((message,index)=><article key={message.id} className={`gui-chat-message gui-chat-${message.role}`} aria-label={message.role}>
      <div className="text-xs text-text-tertiary mb-2">{message.role === 'assistant'?'Hermes':message.role}</div>
      {message.reasoning && <details><summary>Returned reasoning</summary><Markdown content={message.reasoning} /></details>}
      <Markdown copyCode content={message.text} streaming={chat.busy && message.role==='assistant' && index===chat.messages.length-1} />
      {message.role==='assistant' && <Button ghost size="sm" onClick={()=>void perform(()=>navigator.clipboard.writeText(message.text))}>Copy answer</Button>}
     </article>)}
     {chat.tools.map(tool=><details key={tool.id} className="border border-border p-3"><summary>{tool.name} · {tool.status}</summary>{tool.args!==undefined && <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(tool.args,null,2)}</pre>}{tool.result!==undefined && <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{typeof tool.result==='string'?tool.result:JSON.stringify(tool.result,null,2)}</pre>}</details>)}
     <GuiChatRequests requests={chat.pendingRequests} respond={chat.respond} stop={chat.stop} />
     {chat.busy && <p role="status">Hermes is working…</p>}
    </div>
   </div>
   {away && <Button ghost size="sm" onClick={()=>{following.current=true;setAway(false);if(transcriptRef.current)transcriptRef.current.scrollTop=transcriptRef.current.scrollHeight;}}>Jump to latest</Button>}
   <form className="gui-chat-composer shrink-0 space-y-2 border-t border-border pt-3" onSubmit={e=>{e.preventDefault();void send();}}>
    <textarea aria-label="Message Hermes" placeholder={chat.pendingRequests.length?'Resolve the pending request above; never enter secrets here':'Message Hermes…'} value={draft} rows={3} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();void send();}}} />
    <div className="flex flex-wrap items-center gap-3"><label className="text-xs">Attach file<input className="block max-w-52 text-xs" aria-label="Attach file" type="file" disabled={chat.busy||uploading||sending||!!chat.pendingRequests.length} onChange={e=>{const file=e.target.files?.[0];if(!file)return;setUploading(true);void perform(()=>chat.upload(file)).finally(()=>setUploading(false));e.target.value='';}} /></label>
     <span className="text-xs text-text-tertiary flex-1">{uploading?'Uploading…':'Enter to send · Shift+Enter for newline'}</span>
     {chat.busy?<Button type="button" onClick={()=>void perform(chat.stop)}>Stop</Button>:<Button type="submit" disabled={!draft.trim()||sending||uploading||!!chat.pendingRequests.length||chat.connectionState!=='open'}>{sending?'Sending…':'Send'}</Button>}
    </div><p role="status" className="text-xs text-text-tertiary">{sendState}</p>
   </form>
  </section>
  {!narrow&&!collapsed&&<aside aria-label="Model, workspace and conversations" className="flex min-h-0 w-60 shrink-0 flex-col gap-3 overflow-auto">{rail}</aside>}
  {showSheet&&createPortal(<div className="fixed inset-0 z-[90] bg-black/60" onClick={e=>{if(e.target===e.currentTarget)setMobileOpen(false);}}><div ref={sheetRef} role="dialog" aria-modal="true" aria-label="Model, workspace and conversations" className="absolute inset-y-0 right-0 flex w-[min(22rem,90vw)] flex-col gap-3 overflow-auto border-l border-border bg-background-base p-4">{rail}</div></div>,document.body)}
 </div>;
}
