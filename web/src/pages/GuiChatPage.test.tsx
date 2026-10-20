// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router';
import {afterEach,expect,it,vi} from 'vitest';

const gatewayState = vi.hoisted(() => ({
  gateway:{connect:vi.fn()},sessionId:'live',storedSessionId:'saved',title:'My conversation',model:'model-x',provider:'p',reasoningEffort:'medium',supportsReasoning:true,
  messages:[{id:'1',role:'assistant',text:'**Hello**\n```js\nlet a = 1;\n```',reasoning:'Returned summary'}],tools:[{id:'tool',name:'terminal',status:'completed',args:{command:'pwd'},result:'repo'}],pendingRequests:[],busy:false,connectionState:'open',error:null,
  submit:vi.fn(async(_text:string)=>{}),stop:vi.fn(async()=>{}),reconnect:vi.fn(async()=>{}),setModel:vi.fn(async()=>{}),setReasoning:vi.fn(async()=>{}),respond:vi.fn(async()=>{}),upload:vi.fn(async()=>{})
}));

it('renders real markdown, collapsed tools/reasoning and the right shared rail without composer model controls',async()=>{
  const mockGuiChat = {gateway:{connect:()=>Promise.resolve({sessionId:'mock'})},sessionId:'mock',storedSessionId:null,title:'',model:'',provider:'',reasoningEffort:'',supportsReasoning:false,messages:[],tools:[],pendingRequests:[],busy:false,connectionState:'connected',error:null,submit:()=>Promise.resolve(),stop:()=>Promise.resolve(),reconnect:()=>Promise.resolve(),setModel:()=>Promise.resolve({}),setReasoning:()=>Promise.resolve(),respond:()=>Promise.resolve(),upload:()=>Promise.resolve()};
  vi.mock('@/features/gui-chat/useGuiChat',()=>({useGuiChat:()=>mockGuiChat}));
  const root=createRoot(document.createElement('div'));await act(async()=>root.render(<MemoryRouter initialEntries={['/chat']}>
    <Conversation gateway={mockGuiChat.gateway} sessionId={mockGuiChat.sessionId} storedSessionId={mockGuiChat.storedSessionId} title={mockGuiChat.title} model={mockGuiChat.model} provider={mockGuiChat.provider} reasoningEffort={mockGuiChat.reasoningEffort} supportsReasoning={mockGuiChat.supportsReasoning} messages={mockGuiChat.messages} tools={mockGuiChat.tools} pendingRequests={mockGuiChat.pendingRequests} busy={mockGuiChat.busy} connectionState={mockGuiChat.connectionState} error={mockGuiChat.error} submit={mockGuiChat.submit} stop={mockGuiChat.stop} reconnect={mockGuiChat.reconnect} setModel={mockGuiChat.setModel} setReasoning={mockGuiChat.setReasoning} respond={mockGuiChat.respond} upload={mockGuiChat.upload}/>
    <MockGuiChatRequests requests={[]} respond={() => {}} stop={() => {}}/>
  </MemoryRouter>));
  expect(document.querySelector('strong')?.textContent).toBe('Hello');expect(document.querySelector('code')?.textContent).toBe('let a = 1;');
});

function MockGuiChatRequests({requests}:{requests:any}) { return <div data-requests>{JSON.stringify(requests)}</div>; }

afterEach(async()=>{await act(async()=>(document.createElement('root'))?.remove());});
