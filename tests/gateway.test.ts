import { beforeEach,describe,expect,it,vi } from 'vitest';
// The handler's dependency on staticAssets is only evaluated on non-API paths.
// @ts-expect-error This is a plain ESM Worker source, not the generated bundle.
import worker from '../server/handler.mjs';
beforeEach(()=>vi.restoreAllMocks());
describe('frontend production gateway',()=>{
  it('returns 503 without a configured backend instead of a false success',async()=>{const result=await worker.fetch(new Request('https://frontend.test/api/workspaces'),{});expect(result.status).toBe(503);});
  it('forwards path, query, payload and bearer but never frontend cookies',async()=>{
    const fetcher=vi.fn(async(_input:URL,init:RequestInit)=>new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Set-Cookie':'unwanted=value'}}));vi.stubGlobal('fetch',fetcher);
    const result=await worker.fetch(new Request('https://frontend.test/api/bookings?x=1',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-token',Cookie:'private-frontend-cookie=1'},body:'{"workspaceId":2}'}),{API_PROXY_TARGET:'https://api.test'});
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.test/api/bookings?x=1');const init=fetcher.mock.calls[0][1];const headers=new Headers(init.headers);expect(headers.get('Authorization')).toBe('Bearer synthetic-token');expect(headers.get('Origin')).toBe('http://localhost:5173');expect(headers.has('Cookie')).toBe(false);expect(result.headers.has('Set-Cookie')).toBe(false);expect(result.headers.get('Cache-Control')).toBe('no-store');expect(await result.json()).toEqual({ok:true});
  });
  it('does not follow upstream redirects or send the bearer to a redirected host',async()=>{const fetcher=vi.fn(async()=>new Response(null,{status:302,headers:{Location:'https://other.test'}}));vi.stubGlobal('fetch',fetcher);const result=await worker.fetch(new Request('https://frontend.test/api/users/me'),{API_PROXY_TARGET:'https://api.test'});expect(result.status).toBe(502);expect(fetcher).toHaveBeenCalledTimes(1);});
});
