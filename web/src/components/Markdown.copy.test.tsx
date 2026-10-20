// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {Markdown} from './Markdown';
it('copies a fenced code block without rendering raw HTML or unsafe links',async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const copy=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(<Markdown content={'```js\nconst a = 1;\n```\n<img src=x onerror=alert(1)> [bad](javascript:alert)'} copyCode/>));
 const button=host.querySelector('button');expect(button).not.toBeNull();
 await act(async()=>button!.click());expect(copy).toHaveBeenCalledExactlyOnceWith('const a = 1;');expect(host.querySelector('img')).toBeNull();expect(host.querySelector('a')).toBeNull();
 await act(async()=>root.unmount());host.remove();
});
