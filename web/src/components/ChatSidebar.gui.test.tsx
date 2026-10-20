// @vitest-environment jsdom
import { act } from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router';
import {expect,it,vi} from 'vitest';
const calls=vi.hoisted(()=>({getConfig:vi.fn(),saveConfig:vi.fn(),connect:vi.fn()}));
vi.mock('@/lib/api',()=>({api:{getConfig:calls.getConfig,saveConfig:calls.saveConfig}}));
vi.mock('@/lib/gatewayClient',()=>({GatewayClient:class {connect=calls.connect}}));
import {ChatSidebar} from './ChatSidebar';
it('reuses the rail in GUI mode without creating a PTY sidecar or writing profile configuration',async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(<MemoryRouter><ChatSidebar session={{gateway:{} as never,sessionId:'live',model:'m',provider:'p',reasoningEffort:'medium',supportsReasoning:true,busy:false,connectionState:'open',setModel:async()=>{},setReasoning:async()=>{}}}/></MemoryRouter>));
 expect(host.textContent).toContain('m');expect(host.textContent).toContain('reasoning');expect(calls.connect).not.toHaveBeenCalled();expect(calls.getConfig).not.toHaveBeenCalled();expect(calls.saveConfig).not.toHaveBeenCalled();
 await act(async()=>root.unmount());host.remove();
});
