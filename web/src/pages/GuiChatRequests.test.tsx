// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {GuiChatRequests} from './GuiChatRequests';

it('renders only offered approval choices and responds once with the wire choice', async () => {
  (globalThis as unknown as Window & typeof globalThis).localStorage = new Proxy({}, {get(t,p){return t[p]||null}, set(t,p,v){t[p]=v;return true}, deleteProperty(t,p){delete t[p];return true}});
  const respond=vi.fn(async()=>{});
  const requests=[{id:'rpc-1',method:'approval',params:{choices:['once']}}];
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  await act(async()=>root.render(<GuiChatRequests requests={requests} respond={respond} stop={async()=>{}}/>));
  expect(host.querySelector('input')).not.toBeNull();expect(host.querySelector('button[type=submit]'))!.textContent==='Approve once';
  const choices=host.querySelectorAll<HTMLInputElement>('input[type=checkbox]');await act(async()=>choices[0].click());
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(respond).toHaveBeenCalledExactlyOnceWith('rpc-1', {choice:'once'});
});
it('encodes multi-select answers as JSON strings using question ids and keeps replayed locks', async () => {
  (globalThis as unknown as Window & typeof globalThis).localStorage = new Proxy({}, {get(t,p){return t[p]||null}, set(t,p,v){t[p]=v;return true}, deleteProperty(t,p){delete t[p];return true}});
  const respond=vi.fn(async()=>{});
  await act(async()=>root.render(<GuiChatRequests requests={[{id:'clarify-1',method:'clarify',params:{questions:[{qid:'locked',question:'Locked?',choices:['kept']},{qid:'targets',question:'Where?',choices:['east, coast','west'],multi_select:true}],answers:{locked:'kept'}}}]} respond={respond} stop={async()=>{}}/>));
  const choices=host.querySelectorAll<HTMLInputElement>('input[type=checkbox]');await act(async()=>{choices[0].click();choices[1].click();});
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(respond).toHaveBeenCalledExactlyOnceWith('clarify-1',{answers:{locked:'kept',targets:'["east, coast","west"]'},outcome:'submitted'});
});
it('fails closed for secrets and malformed approval choices without leaking request parameters',async()=>{
  (globalThis as unknown as Window & typeof globalThis).localStorage = new Proxy({}, {get(t,p){return t[p]||null}, set(t,p,v){t[p]=v;return true}, deleteProperty(t,p){delete t[p];return true}});
  const respond=vi.fn(async()=>{}),stop=vi.fn(async()=>{});
  await act(async()=>root.render(<GuiChatRequests requests={[{id:'secret',method:'secret',params:{prompt:'private-secret-value'}},{id:'bad',method:'approval',params:{choices:['surprise'],command:'should-not-display'}}]} respond={respond} stop={stop}/>));
  expect(host.textContent).not.toContain('private-secret-value');expect(host.textContent).not.toContain('should-not-display');expect(host.querySelector('input')).toBeNull();
  await act(async()=>host.querySelector('button')!.click());expect(stop).toHaveBeenCalledOnce();expect(respond).not.toHaveBeenCalled();
});
