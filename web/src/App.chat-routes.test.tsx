// @vitest-environment jsdom
import {act,useEffect} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter,useNavigate} from 'react-router';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mounts=vi.hoisted(()=>({tui:0,gui:0}));
vi.mock('@/pages/TuiPage',()=>({default:({isActive}:{isActive:boolean})=>{useEffect(()=>{mounts.tui++;},[]);return <div data-tui data-active={isActive}/>;}}));
vi.mock('@/pages/GuiChatPage',()=>({default:({isActive}:{isActive:boolean})=>{useEffect(()=>{mounts.gui++;},[]);return <div data-gui data-active={isActive}/>;}}));
vi.mock('@/pages/SessionsPage',()=>({default:()=> <div data-sessions/>}));
vi.mock('@/contexts/useProfileScope',()=>({useProfileScope:()=>({profile:''})}));
vi.mock('@/hooks/useSidebarStatus',()=>({useSidebarStatus:()=>null}));
vi.mock('@/themes',()=>({useTheme:()=>({theme:{}})}));
vi.mock('@/plugins',()=>({usePlugins:()=>({manifests:[],loading:false}),PluginSlot:()=>null,PluginPage:()=>null}));
vi.mock('@/contexts/useSystemActions',()=>({useSystemActions:()=>({isBusy:false,isRunning:false,runAction:vi.fn()})}));
vi.mock('@/lib/api',()=>({api:{getConfig:async()=>({})}}));
vi.mock('@/components/SidebarFooter',()=>({SidebarFooter:()=>null}));
vi.mock('@/components/SidebarStatusStrip',()=>({SidebarStatusStrip:()=>null,gatewayLine:()=>({})}));
vi.mock('@/components/AuthWidget',()=>({AuthWidget:()=>null}));
vi.mock('@/components/ProfileSwitcher',()=>({ProfileSwitcher:()=>null}));
vi.mock('@/components/ProfileScopeBanner',()=>({ProfileScopeBanner:()=>null}));
vi.mock('@/components/MemoryPressureBanner',()=>({MemoryPressureBanner:()=>null}));
vi.mock('@/components/MultiplexStandaloneBanner',()=>({MultiplexStandaloneBanner:()=>null}));
vi.mock('@/components/SharedMetricsConsentBanner',()=>({SharedMetricsConsentBanner:()=>null}));
vi.mock('@/components/LanguageSwitcher',()=>({LanguageSwitcher:()=>null}));
vi.mock('@/components/ThemeSwitcher',()=>({ThemeSwitcher:()=>null}));
vi.mock('@nous-research/ui/ui/components/selection-switcher',()=>({SelectionSwitcher:()=>null}));
let host:HTMLDivElement,root:Root;let navigate:ReturnType<typeof useNavigate>;
function Controls(){navigate=useNavigate();return null;}
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);mounts.tui=0;mounts.gui=0;window.matchMedia=vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})) as unknown as typeof window.matchMedia;});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('keeps left shell navigation, defers terminal until /tui, and preserves both hosts across admin navigation',async()=>{
 const {default:App}=await import('./App');
 await act(async()=>root.render(<MemoryRouter initialEntries={['/chat']}><Controls/><App/></MemoryRouter>));
 expect(host.querySelector('[data-gui]')).not.toBeNull();expect(mounts.tui).toBe(0);
 expect(host.querySelector('#app-sidebar a[href="/chat"]')).not.toBeNull();expect(host.querySelector('#app-sidebar a[href="/tui"]')).not.toBeNull();
 await act(async()=>navigate('/tui?resume=saved'));expect(mounts.tui).toBe(1);expect(host.querySelector('[data-tui]')?.getAttribute('data-active')).toBe('true');
 await act(async()=>navigate('/sessions'));expect(host.querySelector('[data-tui]')).not.toBeNull();expect(host.querySelector('[data-gui]')).not.toBeNull();expect(mounts.tui).toBe(1);expect(mounts.gui).toBe(1);
});
