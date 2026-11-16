import { beforeEach, describe, expect, it, vi } from 'vitest';
const tokens=(suffix='1')=>({accessToken:`access-${suffix}`,refreshToken:`refresh-${suffix}`,tokenType:'Bearer',expiresInSeconds:900,refreshExpiresInSeconds:2592000});
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{vi.resetModules();const data=new Map<string,string>();vi.stubGlobal('sessionStorage',{getItem:(key:string)=>data.get(key)||null,setItem:(key:string,v:string)=>data.set(key,v),removeItem:(key:string)=>data.delete(key)});vi.stubGlobal('window',new EventTarget());});

describe('API integration and rotating sessions',()=>{
  it('shares a single refresh between concurrent protected requests',async()=>{
    const client=await import('../src/api/client');client.storeTokens({...tokens(),expiresInSeconds:0});
    const fetcher=vi.fn(async(input:string,init:RequestInit)=>{if(input.endsWith('/auth/refresh')){await new Promise(resolve=>setTimeout(resolve,10));expect(JSON.parse(String(init.body))).toEqual({refreshToken:'refresh-1'});return response(tokens('2'));}expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-2');return response({ok:true});});vi.stubGlobal('fetch',fetcher);
    await Promise.all([client.request('/users/me',{},true),client.request('/bookings',{},true)]);
    expect(fetcher.mock.calls.filter(([path])=>path.endsWith('/auth/refresh'))).toHaveLength(1);
  });
  it('refreshes a server-rejected access token once and retries with the new token',async()=>{
    const client=await import('../src/api/client');client.storeTokens(tokens());
    const fetcher=vi.fn(async(input:string,init:RequestInit)=>input.endsWith('/auth/refresh')?response(tokens('2')):new Headers(init.headers).get('Authorization')==='Bearer access-1'?response({detail:'Expired'},401):response({name:'Test'}));vi.stubGlobal('fetch',fetcher);
    expect(await client.request('/users/me',{},true)).toEqual({name:'Test'});expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not repeatedly refresh or replay a write when the second attempt is also 401',async()=>{
    const client=await import('../src/api/client');client.storeTokens(tokens());
    const fetcher=vi.fn(async(input:string)=>input.endsWith('/auth/refresh')?response(tokens('2')):response({detail:'No session'},401));vi.stubGlobal('fetch',fetcher);
    await expect(client.request('/bookings',{method:'POST',body:'{}'},true)).rejects.toMatchObject({status:401});expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not automatically replay a booking after a conflict',async()=>{
    const client=await import('../src/api/client');client.storeTokens(tokens());const fetcher=vi.fn(async()=>response({detail:'Selected time slot overlaps with an existing booking'},409));vi.stubGlobal('fetch',fetcher);
    await expect(client.request('/bookings',{method:'POST',body:'{}'},true)).rejects.toMatchObject({status:409});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('clears rejected refresh tokens but preserves the session on a network outage',async()=>{
    const client=await import('../src/api/client');client.storeTokens({...tokens(),expiresInSeconds:0});vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('offline');}));await expect(client.request('/users/me',{},true)).rejects.toMatchObject({status:0});expect(client.hasSession()).toBe(true);
    vi.stubGlobal('fetch',vi.fn(async()=>response({detail:'Revoked'},401)));await expect(client.request('/users/me',{},true)).rejects.toMatchObject({status:401});expect(client.hasSession()).toBe(false);
  });
  it('does not restore a session after logout while a refresh is in flight',async()=>{
    const client=await import('../src/api/client');client.storeTokens({...tokens(),expiresInSeconds:0});let release:(value:Response)=>void=()=>{};
    const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{release=resolve;}));vi.stubGlobal('fetch',fetcher);const pending=client.request('/users/me',{},true);const assertion=expect(pending).rejects.toMatchObject({status:401});client.clearSession();release(response(tokens('2')));
    // The request must not become an authenticated request after the user logs out.
    await assertion;expect(client.hasSession()).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects HTML fallback pages and handles empty 204 bodies',async()=>{
    const client=await import('../src/api/client');vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>app</html>',{headers:{'Content-Type':'text/html'}})));await expect(client.request('/workspaces')).rejects.toMatchObject({status:502});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:204})));await expect(client.request('/auth/verify-email',{method:'POST'})).resolves.toBeUndefined();
  });
  it('matches Java DTOs: registration name, array bookings, authenticated availability and numeric quote',async()=>{
    const client=await import('../src/api/client');client.storeTokens(tokens());const {api}=await import('../src/api');
    const calls:{url:string;body:unknown;auth:string|null}[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,body:init.body?JSON.parse(String(init.body)):null,auth:new Headers(init.headers).get('Authorization')});if(url.includes('calculate-price'))return response(300);if(url==='/api/bookings')return response([{id:4,totalPrice:300}]);return response([]);}));
    const data={workspaceId:3,bookingType:'HOURLY' as const,bookingDates:['2027-01-11'],startTime:'10:00',endTime:'12:00'};
    expect(await api.price(data)).toBe(300);expect(await api.book(data)).toEqual([{id:4,totalPrice:300}]);await api.availability('2027-01-11','10:00','12:00');
    expect(calls[0].body).toEqual(data);expect(calls[2].url).toBe('/api/bookings/availability?date=2027-01-11&startTime=10%3A00&endTime=12%3A00');expect(calls.every(c=>c.auth==='Bearer access-1')).toBe(true);
  });
});
