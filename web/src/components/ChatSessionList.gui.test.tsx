// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router';
import {expect,it,vi} from 'vitest';
vi.mock('@/i18n',()=>({useI18n:()=>({t:{common:{refresh:'Refresh',loading:'Loading',retry:'Retry'},sessions:{title:'Sessions',newChat:'New chat',untitledSession:'Untitled',noSessions:'None'}}})}));
vi.mock('@/lib/api',()=>({api:{getSessions:async()=>({sessions:[{id:'stored',title:'Existing conversation',last_active:0,message_count:2}]})}}));
import {ChatSessionList} from './ChatSessionList';
it('uses an explicit GUI resume adapter instead of silently navigating a busy conversation',async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const pick=vi.fn();
 await act(async()=>root.render(<MemoryRouter><ChatSessionList activeSessionId={null} onSelectSession={pick}/></MemoryRouter>));
 const row=Array.from(host.querySelectorAll('button')).find(el=>el.textContent?.includes('Existing conversation'))!;
 await act(async()=>row.click());expect(pick).toHaveBeenCalledExactlyOnceWith('stored');
 await act(async()=>root.unmount());host.remove();
});
