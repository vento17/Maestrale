import https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { networkInterfaces } from 'os';
import type { NetStatePayload, NetInteractPayload } from '../../shared/types/ipc';

// ─── Self-signed certificate (generated once per IP, cached) ─────────────────

interface SelfsignedPems { private: string; public: string; cert: string }
let _certCache: { ip: string; key: string; cert: string } | null = null;

function getCert(ip: string): { key: string; cert: string } {
  if (_certCache?.ip === ip) return { key: _certCache.key, cert: _certCache.cert };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sf = require('selfsigned') as { generate: (attrs: object[], opts: object) => SelfsignedPems };
  const pems = sf.generate([{ name: 'commonName', value: ip }], {
    days: 3650,
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip }, { type: 2, value: 'localhost' }] }],
  });
  _certCache = { ip, key: pems.private, cert: pems.cert };
  return { key: pems.private, cert: pems.cert };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NetInputPayload { action: 'down' | 'move' | 'up'; x: number; y: number }

type BrowserMessage =
  | { type: 'interact'; payload: NetInteractPayload }
  | { type: 'input'; action: 'down' | 'move' | 'up'; x: number; y: number }
  | { type: 'switchPage'; pageId: string }
  | { type: 'ping' };

// ─── HTML client template ─────────────────────────────────────────────────────
// Self-contained browser client: receives JPEG frames from capturePage() and
// displays them full-screen. A transparent overlay captures pointer events and
// maps coordinates back to page widget space for interaction.

function buildClientHtml(port: number): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>LiveForge Remote</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
html,body{width:100%;height:100%;overflow:hidden;background:#000;touch-action:none;}
/* Tab bar is a small translucent pill top-left — the frame fills the whole screen behind it */
#tabbar{position:fixed;top:0;left:0;max-width:72%;height:30px;background:rgba(13,13,13,0.8);border-radius:0 0 6px 0;display:flex;align-items:center;overflow-x:auto;overflow-y:hidden;z-index:50;padding:0 4px;touch-action:manipulation;}
#tabbar::-webkit-scrollbar{display:none;}
.tab{flex-shrink:0;padding:0 12px;height:30px;display:flex;align-items:center;font-size:11px;color:#666;cursor:pointer;border-right:1px solid #1c1c1c;text-transform:uppercase;letter-spacing:1px;white-space:nowrap;-webkit-user-select:none;user-select:none;}
.tab.active{color:#ddd;background:#222;}
#status{position:fixed;top:10px;right:8px;width:6px;height:6px;border-radius:50%;background:#333;z-index:51;pointer-events:none;}
#status.ok{background:#3b8b91;}
#lf-frame{position:absolute;display:block;image-rendering:auto;}
#interact{position:fixed;top:0;left:0;right:0;bottom:0;touch-action:none;cursor:crosshair;}
#loading{position:fixed;top:0;left:0;right:0;bottom:0;background:#000;display:flex;align-items:center;justify-content:center;font-size:13px;color:#444;letter-spacing:2px;text-transform:uppercase;font-family:monospace;z-index:10;}
</style>
</head>
<body>
<div id="status"></div>
<div id="loading">LiveForge Remote</div>
<img id="lf-frame" alt="">
<div id="interact"></div>
<script>
(function(){
  var WS_PORT = ${port};
  var TB = 0; // frame fills the whole viewport; tab bar is a small overlay pill
  var host = location.hostname;
  var ws, state = null, frameW = 0, frameH = 0;
  var pageRectFrame = null; // {ox,oy,s} in frame-logical coords, sent with each frame
  var drags = {};
  var iLast = {}, iTimer = {};

  /* ── Connection ──────────────────────────────────────────────────────── */
  function connect(){
    ws = new WebSocket('wss://' + host + ':' + WS_PORT);
    ws.onopen  = function(){ setDot(true); };
    ws.onclose = function(){ setDot(false); setTimeout(connect, 2000); };
    ws.onerror = function(){};
    ws.onmessage = function(evt){
      try{
        var msg = JSON.parse(evt.data);
        if(msg.type === 'frame'){
          handleFrame(msg);
        } else if(msg.type === 'snapshot' || msg.type === 'stateChange'){
          state = msg.payload;
        } else if(msg.type === 'runtimeUpdate'){
          if(state) state.runtimeWidgets[msg.widgetId] = msg.cells;
        }
      }catch(e){}
    };
  }

  function send(obj){ if(ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function setDot(ok){ document.getElementById('status').className = ok ? 'ok' : ''; }

  /* ── Frame display ───────────────────────────────────────────────────── */
  // frameW/frameH = logical CSS pixels of the canvas area (global bar already cropped server-side)
  function handleFrame(msg){
    var img = document.getElementById('lf-frame');
    img.src = 'data:image/jpeg;base64,' + msg.jpeg;
    if(msg.pageRect) pageRectFrame = msg.pageRect;
    if(msg.width && (frameW !== msg.width || frameH !== msg.height)){
      frameW = msg.width; frameH = msg.height;
      layoutFrame();
    }
    document.getElementById('loading').style.display = 'none';
  }

  function layoutFrame(){
    if(!frameW || !frameH) return;
    var cw = window.innerWidth, ch = window.innerHeight - TB;
    var scale = Math.min(cw/frameW, ch/frameH);
    var dw = frameW*scale, dh = frameH*scale;
    var img = document.getElementById('lf-frame');
    img.style.width  = dw+'px';
    img.style.height = dh+'px';
    img.style.left   = Math.round((cw-dw)/2)+'px';
    img.style.top    = TB + Math.round((ch-dh)/2)+'px';
  }
  window.addEventListener('resize', layoutFrame);
  window.addEventListener('orientationchange', function(){ setTimeout(layoutFrame, 100); });

  /* ── Interact throttle ───────────────────────────────────────────────── */
  function interact(wid, ci, val, active){
    var key=wid+':'+ci, now=Date.now();
    clearTimeout(iTimer[key]);
    if(!iLast[key] || now-iLast[key] >= 16){
      iLast[key]=now;
      send({type:'interact',payload:{widgetId:wid,cellIndex:ci,value:val,active:active}});
    } else {
      iTimer[key]=setTimeout(function(){
        iLast[key]=Date.now();
        send({type:'interact',payload:{widgetId:wid,cellIndex:ci,value:val,active:active}});
      },16);
    }
  }

  /* ── Coordinate mapping ──────────────────────────────────────────────── */
  // frameW/frameH are logical CSS px of the canvas area (global bar excluded by server crop).
  // The img is positioned below the tab bar; getBoundingClientRect() gives the correct origin.
  function clientToPage(cx, cy){
    if(!state || !frameW) return null;
    var img = document.getElementById('lf-frame');
    var r = img.getBoundingClientRect();
    if(r.width < 1) return null;
    // Map browser CSS coords → logical canvas coords
    var sx = (cx-r.left)*(frameW/r.width);
    var sy = (cy-r.top)*(frameH/r.height);
    if(sx < 0 || sy < 0 || sx > frameW || sy > frameH) return null;
    // Find active page
    var page = null;
    for(var i=0;i<state.pages.length;i++){
      if(state.pages[i].id === state.activePageId){ page=state.pages[i]; break; }
    }
    if(!page) return null;
    var px, py;
    if(pageRectFrame && pageRectFrame.s > 0){
      // Exact transform reported by the host (accounts for sidebar + live-offset)
      px = (sx - pageRectFrame.ox) / pageRectFrame.s;
      py = (sy - pageRectFrame.oy) / pageRectFrame.s;
    } else {
      // Fallback: assume the page is letterboxed in the whole frame
      var ps=Math.min(frameW/page.width, frameH/page.height);
      var ox=Math.max(0,(frameW-page.width*ps)/2);
      var oy=Math.max(0,(frameH-page.height*ps)/2);
      px=(sx-ox)/ps; py=(sy-oy)/ps;
    }
    if(px < 0 || py < 0 || px > page.width || py > page.height) return null;
    return { px:px, py:py, page:page };
  }

  // Only check interactive widget types — non-interactive widgets (router, text…) must not block hits
  var INTERACTIVE = {sliderBank:1, buttonGrid:1, knobBank:1, xyPad:1, masterLevel:1, submasters:1};
  function findWidget(px, py, page){
    var best=null, bestZ=-1e9;
    for(var i=0;i<page.widgets.length;i++){
      var w=page.widgets[i];
      if(!INTERACTIVE[w.kind]) continue;
      if(px>=w.rect.x && px<=w.rect.x+w.rect.width && py>=w.rect.y && py<=w.rect.y+w.rect.height){
        var z=w.zIndex||0;
        if(z>=bestZ){ bestZ=z; best=w; }
      }
    }
    return best;
  }

  function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }

  /* ── Hit-test: find cell + interaction parameters ────────────────────── */
  function hitTest(w, px, py){
    var rx=clamp((px-w.rect.x)/w.rect.width, 0,0.9999);
    var ry=clamp((py-w.rect.y)/w.rect.height,0,0.9999);
    var cX=w.countX||1, cY=w.countY||1;

    if(w.kind === 'sliderBank'){
      var isV=!w.orientation||w.orientation==='vertical';
      var col=Math.floor(rx*cX), row=Math.floor(ry*cY);
      var ci=row*cX+col;
      if(isV){
        var top=w.rect.y+row*w.rect.height/cY, h=w.rect.height/cY;
        return {ci:ci, kind:'slider', isV:true, top:top, h:h};
      } else {
        var left=w.rect.x+col*w.rect.width/cX, ww=w.rect.width/cX;
        return {ci:ci, kind:'slider', isV:false, left:left, ww:ww};
      }
    }

    if(w.kind === 'knobBank'){
      var col2=Math.floor(rx*cX), row2=Math.floor(ry*cY);
      var ci2=row2*cX+col2;
      var rt=state&&state.runtimeWidgets&&state.runtimeWidgets[w.id];
      var sv=rt&&rt.cells&&rt.cells[ci2]?(rt.cells[ci2].value||0):0;
      return {ci:ci2, kind:'knob', sv:sv, left:w.rect.x+col2*w.rect.width/cX, ww:w.rect.width/cX};
    }

    if(w.kind === 'buttonGrid'){
      var col3=Math.floor(rx*cX), row3=Math.floor(ry*cY);
      var ci3=row3*cX+col3;
      var beh=(w.cells&&w.cells[ci3]&&w.cells[ci3].behavior)||'momentary';
      return {ci:ci3, kind:'button', beh:beh};
    }

    if(w.kind === 'xyPad'){
      return {ci:0, kind:'xy'};
    }

    if(w.kind === 'masterLevel'){
      var isVm = !w.orientation || w.orientation==='vertical';
      return {ci:0, kind:'master', isV:isVm};
    }

    if(w.kind === 'submasters'){
      // Columns fill the width minus the right REC/DEL column (48px). The fader
      // band excludes the ~28px top status + 28px bottom flash buttons.
      var recW=48, innerW=w.rect.width-recW;
      if(px > w.rect.x+innerW) return null;              // REC/DEL column → inject
      var cXs=w.countX||1;
      var coln=Math.floor((px-w.rect.x)/(innerW/cXs));
      if(coln<0||coln>=cXs) return null;
      var fTop=w.rect.y+28, fBot=w.rect.y+w.rect.height-28;
      if(py<fTop||py>fBot) return null;                 // top/bottom buttons → inject
      return {ci:coln, kind:'sub', top:fTop, h:fBot-fTop};
    }

    return null;
  }

  /* ── Frame-space mapping (for raw injection) ─────────────────────────── */
  function clientToFrame(cx, cy){
    if(!frameW) return null;
    var img=document.getElementById('lf-frame');
    var r=img.getBoundingClientRect();
    if(r.width < 1) return null;
    var sx=(cx-r.left)*(frameW/r.width);
    var sy=(cy-r.top)*(frameH/r.height);
    if(sx < 0 || sy < 0 || sx > frameW || sy > frameH) return null;
    return { x:sx, y:sy };
  }
  function sendInput(action, x, y){ send({type:'input', action:action, x:x, y:y}); }

  /* ── Pointer / touch handlers ────────────────────────────────────────── */
  // Core controllers (slider/button/knob/xy) use the precise data path (multi-touch);
  // EVERYTHING else — top bars, submasters, master, sequencer, LFO, cues… — is
  // driven by injecting the raw click into the real app window.
  var il = document.getElementById('interact');

  function startDrag(pid, cx, cy){
    var pos=clientToPage(cx,cy);
    var w = pos ? findWidget(pos.px,pos.py,pos.page) : null;
    var hit = w ? hitTest(w,pos.px,pos.py) : null;
    if(w && hit){
      drags[pid]={mode:'d', w:w, hit:hit, sx:pos.px};
      if(hit.kind==='button'){
        if(hit.beh==='toggle'){
          var rt=state&&state.runtimeWidgets&&state.runtimeWidgets[w.id];
          var ca=rt&&rt.cells&&rt.cells[hit.ci]?rt.cells[hit.ci].active:false;
          interact(w.id,hit.ci,ca?0:1,!ca);
        } else {
          interact(w.id,hit.ci,1,true);
        }
      } else if(hit.kind==='xy'){
        interact(w.id,0,clamp((pos.px-w.rect.x)/w.rect.width,0,1));
        interact(w.id,1,clamp(1-(pos.py-w.rect.y)/w.rect.height,0,1));
      } else if(hit.kind==='slider'){
        interact(w.id,hit.ci, hit.isV?clamp(1-(pos.py-hit.top)/hit.h,0,1):clamp((pos.px-hit.left)/hit.ww,0,1));
      } else if(hit.kind==='master'){
        interact(w.id,0, hit.isV?clamp(1-(pos.py-w.rect.y)/w.rect.height,0,1):clamp((pos.px-w.rect.x)/w.rect.width,0,1));
      } else if(hit.kind==='sub'){
        interact(w.id,hit.ci, clamp(1-(pos.py-hit.top)/hit.h,0,1));
      }
      return;
    }
    var f=clientToFrame(cx,cy);
    if(!f) return;
    drags[pid]={mode:'i', lx:f.x, ly:f.y};
    sendInput('down', f.x, f.y);
  }

  function moveDrag(pid, cx, cy){
    var d=drags[pid];
    if(!d) return;
    if(d.mode==='i'){
      var f=clientToFrame(cx,cy);
      if(f){ d.lx=f.x; d.ly=f.y; sendInput('move', f.x, f.y); }
      return;
    }
    var pos=clientToPage(cx,cy);
    if(!pos) return;
    var hit=d.hit, w=d.w;
    if(hit.kind==='button') return;
    if(hit.kind==='xy'){
      interact(w.id,0,clamp((pos.px-w.rect.x)/w.rect.width,0,1));
      interact(w.id,1,clamp(1-(pos.py-w.rect.y)/w.rect.height,0,1));
    } else if(hit.kind==='slider'){
      interact(w.id,hit.ci, hit.isV?clamp(1-(pos.py-hit.top)/hit.h,0,1):clamp((pos.px-hit.left)/hit.ww,0,1));
    } else if(hit.kind==='knob'){
      interact(w.id,hit.ci, clamp(hit.sv+(pos.px-d.sx)/hit.ww,0,1));
    } else if(hit.kind==='master'){
      interact(w.id,0, hit.isV?clamp(1-(pos.py-w.rect.y)/w.rect.height,0,1):clamp((pos.px-w.rect.x)/w.rect.width,0,1));
    } else if(hit.kind==='sub'){
      interact(w.id,hit.ci, clamp(1-(pos.py-hit.top)/hit.h,0,1));
    }
  }

  function endDrag(pid){
    var d=drags[pid];
    if(!d) return;
    if(d.mode==='i'){ sendInput('up', d.lx, d.ly); delete drags[pid]; return; }
    if(d.hit.kind==='button'&&d.hit.beh!=='toggle') interact(d.w.id,d.hit.ci,0,false);
    delete drags[pid];
  }

  // Pointer events (desktop + Android Chrome)
  il.addEventListener('pointerdown', function(e){
    if(e.pointerType==='touch') return; // handled by touch events below
    e.preventDefault();
    try{ il.setPointerCapture(e.pointerId); }catch(_){}
    startDrag(e.pointerId, e.clientX, e.clientY);
  });
  il.addEventListener('pointermove', function(e){
    if(e.pointerType==='touch') return;
    if(!drags[e.pointerId]) return;
    e.preventDefault();
    moveDrag(e.pointerId, e.clientX, e.clientY);
  });
  il.addEventListener('pointerup',     function(e){ if(e.pointerType!=='touch') endDrag(e.pointerId); });
  il.addEventListener('pointercancel', function(e){ if(e.pointerType!=='touch') endDrag(e.pointerId); });

  // Touch events (iOS Safari + Android fallback) — avoids 300ms pointer-event delay on mobile
  il.addEventListener('touchstart', function(e){
    e.preventDefault(); // prevent scroll/zoom; does NOT block our touch handlers
    for(var i=0;i<e.changedTouches.length;i++){
      var t=e.changedTouches[i];
      startDrag('t'+t.identifier, t.clientX, t.clientY);
    }
  }, {passive:false});
  il.addEventListener('touchmove', function(e){
    e.preventDefault();
    for(var i=0;i<e.changedTouches.length;i++){
      var t=e.changedTouches[i];
      moveDrag('t'+t.identifier, t.clientX, t.clientY);
    }
  }, {passive:false});
  il.addEventListener('touchend',    function(e){ for(var i=0;i<e.changedTouches.length;i++) endDrag('t'+e.changedTouches[i].identifier); });
  il.addEventListener('touchcancel', function(e){ for(var i=0;i<e.changedTouches.length;i++) endDrag('t'+e.changedTouches[i].identifier); });

  // Keepalive: prevent iOS from killing idle WebSocket connections
  setInterval(function(){ send({type:'ping'}); }, 20000);

  connect();
})();
</script>
</body>
</html>`;
}

// ─── NetworkServer class ──────────────────────────────────────────────────────

export class NetworkServer {
  private httpServer: https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private lastState: NetStatePayload | null = null;
  private port = 3456;

  // Called by IPC handler when renderer pushes a state change
  broadcastState(payload: NetStatePayload) {
    this.lastState = payload;
    const msg = JSON.stringify({ type: 'stateChange', payload });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }

  broadcastRuntimeUpdate(widgetId: string, cells: { value: number; active: boolean }[]) {
    const msg = JSON.stringify({ type: 'runtimeUpdate', widgetId, cells });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }

  onInteract?: (payload: NetInteractPayload) => void;
  onInput?: (payload: NetInputPayload) => void;
  onSwitchPage?: (pageId: string) => void;
  onClientConnect?: () => void;
  onClientDisconnect?: () => void;

  hasClients(): boolean {
    return this.clients.size > 0;
  }

  sendFrame(jpeg: string, width: number, height: number, pageRect?: { ox: number; oy: number; s: number }): void {
    const msg = JSON.stringify({ type: 'frame', jpeg, width, height, pageRect });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }

  start(port: number): Promise<{ ok: boolean; ip: string; port: number; error?: string }> {
    return new Promise((resolve) => {
      if (this.httpServer) {
        resolve({ ok: true, ip: this.getLocalIP(), port: this.port });
        return;
      }
      this.port = port;

      const clientHtml = buildClientHtml(port);
      const ip = this.getLocalIP();
      const { key, cert } = getCert(ip);

      this.httpServer = https.createServer({ key, cert }, (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(clientHtml);
      });

      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (client: WebSocket) => {
        this.clients.add(client);
        this.onClientConnect?.();
        // Send full snapshot to new client
        if (this.lastState) {
          client.send(JSON.stringify({ type: 'snapshot', payload: this.lastState }));
        }
        client.on('message', (raw) => {
          try {
            const msg: BrowserMessage = JSON.parse(raw.toString());
            if (msg.type === 'interact' && this.onInteract) {
              this.onInteract(msg.payload);
            } else if (msg.type === 'input' && this.onInput) {
              this.onInput({ action: msg.action, x: msg.x, y: msg.y });
            } else if (msg.type === 'switchPage' && this.onSwitchPage) {
              this.onSwitchPage(msg.pageId);
            }
          } catch {}
        });
        client.on('close', () => {
          this.clients.delete(client);
          this.onClientDisconnect?.();
        });
      });

      this.httpServer.listen(port, '0.0.0.0', () => {
        resolve({ ok: true, ip: this.getLocalIP(), port });
      });

      this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
        resolve({ ok: false, ip: '', port, error: err.message });
        this.httpServer = null;
        this.wss = null;
      });
    });
  }

  stop(): Promise<{ ok: boolean }> {
    return new Promise((resolve) => {
      if (!this.httpServer) { resolve({ ok: true }); return; }
      this.wss?.close();
      this.httpServer.close(() => {
        this.httpServer = null;
        this.wss = null;
        this.clients.clear();
        resolve({ ok: true });
      });
    });
  }

  getLocalIP(): string {
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      if (name.toLowerCase().includes('loopback')) continue;
      for (const iface of ifaces[name] ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
    return '127.0.0.1';
  }
}

export const networkServer = new NetworkServer();
