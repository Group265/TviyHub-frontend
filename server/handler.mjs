// Frontend gateway only: the uploaded Java backend is never rewritten or embedded.
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname.startsWith('/api/')) {
      if (!env.API_PROXY_TARGET) return Response.json({detail:'Сервіс бронювання не підключено.'},{status:503,headers:{'Cache-Control':'no-store'}});
      let target;
      try {
        target = new URL(env.API_PROXY_TARGET);
        if (!['http:','https:'].includes(target.protocol)) throw new Error();
      } catch { return Response.json({detail:'Сервіс бронювання налаштовано неправильно.'},{status:503}); }
      target.pathname = incoming.pathname;
      target.search = incoming.search;
      const headers = new Headers();
      for (const name of ['Accept','Accept-Language','Content-Type','Authorization']) {
        const value = request.headers.get(name); if(value) headers.set(name,value);
      }
      // The browser calls its own origin. This separate upstream request must
      // match the unchanged Spring Security CORS allowlist.
      headers.set('Origin','http://localhost:5173');
      try {
        const response = await fetch(target, {method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual',signal:AbortSignal.timeout(14000)});
        if(response.status>=300&&response.status<400)return Response.json({detail:'Сервіс несподівано перенаправив запит.'},{status:502,headers:{'Cache-Control':'no-store'}});
        const output = new Headers();
        for(const name of ['Content-Type','Retry-After','Content-Disposition']) { const value=response.headers.get(name);if(value)output.set(name,value); }
        output.set('Cache-Control','no-store');
        return new Response(response.body,{status:response.status,headers:output});
      } catch { return Response.json({detail:'Сервіс бронювання тимчасово недоступний.'},{status:502,headers:{'Cache-Control':'no-store'}}); }
    }
    if (!['GET','HEAD'].includes(request.method)) return new Response('Спосіб запиту не підтримується.',{status:405});
    const path = incoming.pathname === '/' ? '/index.html' : incoming.pathname;
    const asset = staticAssets[path] || (request.headers.get('Accept')?.includes('text/html') ? staticAssets['/index.html'] : null);
    if(!asset)return new Response('Сторінку не знайдено.',{status:404});
    const bytes = Uint8Array.from(atob(asset.body),char=>char.charCodeAt(0));
    return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':asset.type,'Cache-Control':asset.type.startsWith('text/html')?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src https://www.google.com; base-uri 'self'; form-action 'self'"}});
  },
};
