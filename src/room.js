import * as PeerModule from 'peerjs';
// PeerJS's CJS wrapper exposes named exports differently in Node and bundlers.
const Peer = PeerModule.Peer || PeerModule.default.Peer || PeerModule.default;
const util = PeerModule.util || PeerModule.default.util;

export const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), n => 'abcdefghjkmnpqrstuvwxyz23456789'[n % 29]).join('');
export const normalizeCode = code => String(code).toLowerCase().replace(/[\s-]/g, '');
export function parseRoom(value) {
  const text = String(value).trim();
  let code = text;
  if (/^https?:\/\//i.test(text)) {
    try { const params=new URLSearchParams(new URL(text).hash.slice(1));code=params.get('join')||params.get('room')||''; }
    catch { code = ''; }
  }
  code = normalizeCode(code);
  if (!/^[a-z0-9]{12}$/.test(code)) throw Error('Enter the 12-character invitation code, or paste the invite link.');
  return code;
}

// PeerJS discontinued its free TURN service. Version 1.5.5 still embeds those
// retired endpoints, so retain STUN but use only explicitly configured TURN.
let additionalIce=[];
export function configureIce(servers){additionalIce=servers;}
export const peerOptions = () => {const config=structuredClone(util.defaultConfig);config.iceServers=config.iceServers.filter(s=>[s.urls].flat().every(url=>url.startsWith('stun:')));config.iceServers.push({urls:'stun:stun.cloudflare.com:3478'},...structuredClone(additionalIce));return {debug:0,config};};
const memberIsValid = m => m && typeof m.id === 'string' && typeof m.name === 'string' && ['send','receive'].includes(m.mode);

export class Room {
  constructor(callbacks, settings = {}) {
    this.cb = callbacks; this.settings = settings;
    this.members = new Map(); this.links = new Map(); this.timers = new Set();
    this.closed = false; this.state = 'idle'; this.retries = 0;
  }
  later(fn, ms) {
    const timer = setTimeout(() => { this.timers.delete(timer); if (!this.closed) fn(); }, ms);
    this.timers.add(timer); return timer;
  }
  setState(state, detail = '') {
    if (this.closed && state !== 'closed') return;
    this.state = state; this.cb.onState?.(state, detail);
  }
  report(detail) { if (!this.closed) this.cb.onError?.(detail); }
  publishMembers() { if (!this.closed) this.cb.onMembers?.([...this.members.values()].filter(m => m.id !== this.id)); }
  async open(code, host, name, mode) {
    this.code = this.settings.privateCode&&/^[a-f0-9]{64}$/.test(code)?code:parseRoom(code); this.host = host; this.name = name.slice(0,48); this.mode = mode;
    this.expires=Date.now()+(this.settings.inviteLifetime??600000);this.admitted=new Set();
    this.hostId = this.settings.privateCode?'wft3-private-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(this.code))),n=>n.toString(16).padStart(2,'0')).join(''):'wft2-' + this.code;
    this.setState('connecting', 'Contacting the pairing service…');
    const PeerClass = this.settings.PeerClass || Peer;
    this.peer = new PeerClass(host ? this.hostId : undefined, this.settings.peerOptions || peerOptions());
    this.peer.on('connection', conn => this.incoming(conn));
    this.peer.on('disconnected', () => {
      if (this.closed) return;
      this.setState('reconnecting', 'Reconnecting to the pairing service…');
      this.reconnectSignaling();
    });
    await new Promise((resolve, reject) => {
      let opened = false;
      this.rejectOpen = reject;
      const timeout = this.later(() => reject(Error('Pairing service did not respond. Check internet access, then Retry.')), this.settings.openTimeout || 20000);
      this.peer.on('open', () => {
        clearTimeout(timeout); this.timers.delete(timeout); this.retries = 0;
        if (!opened) { opened = true; this.rejectOpen = null; resolve(); }
        else if (!this.closed) { this.setState('connected'); if (!this.host && !this.control?.open) this.rejoin(); }
      });
      this.peer.on('error', e => {
        if (this.closed) return;
        const msg = e.type === 'unavailable-id' ? 'This room is already open. Choose Join room instead.'
          : e.type === 'peer-unavailable' ? 'That device or room is unavailable. Check the code and keep the creator’s page open.'
          : `Connection failed (${e.type || 'network'}). Check internet access and try again.`;
        if (!opened) { clearTimeout(timeout); this.timers.delete(timeout); reject(Error(msg)); }
        else {
          if(e.type==='peer-unavailable'&&this.rejectJoin){this.rejectJoin(Error(msg));this.rejectJoin=null;this.control?.close();}
          this.report(msg);
          if (!['peer-unavailable','webrtc'].includes(e.type)) this.setState('disconnected', msg);
        }
      });
    });
    if (this.closed) throw Error('Room connection cancelled.');
    this.id = this.peer.id;
    if (host) { this.members.set(this.id, this.self()); this.broadcast(); this.setState('connected'); }
    else await this.joinHost();
  }
  reconnectSignaling() {
    if (this.closed || this.reconnectTimer) return;
    if (this.retries >= 3) { this.setState('disconnected', 'Could not reconnect. Use Retry connection.'); return; }
    this.reconnectTimer = this.later(() => {
      this.reconnectTimer = null;
      if (!this.peer.disconnected) return;
      this.retries++;
      try { this.peer.reconnect(); } catch { this.reconnectSignaling(); }
      this.later(() => { if (this.peer.disconnected) this.reconnectSignaling(); }, 5000);
    }, [1000,3000,8000][this.retries]);
  }
  async joinHost() {
    if (this.closed) throw Error('Room closed.');
    this.control?.close();
    const conn = this.peer.connect(this.hostId, {reliable:true,serialization:'json',metadata:{kind:'room-v2'}});
    if (!conn) throw Error('Not connected to the pairing service. Retry connection.');
    this.control = conn;
    return new Promise((resolve, reject) => {
      let joined = false;
      const timeout = this.later(() => { reject(Error('Could not reach the room. Keep its creator online, check the code, or run Network check.')); conn.close(); }, this.settings.joinTimeout || 25000);
      this.rejectJoin = reject;
      conn.on('open', () => { if (!this.closed) conn.send({type:'join',code:this.code,member:this.self()}); });
      conn.on('data', m => {
        if (this.closed || this.control !== conn) return;
        if(m?.type==='rejected'){clearTimeout(timeout);this.timers.delete(timeout);this.rejectJoin=null;reject(Error(m.reason==='expired'?'This invitation has expired. Ask the other device to tap New invitation, then scan its new QR.':'The invitation was rejected. Ask for a new QR.'));conn.close();return;}
        if (m?.type === 'members' && Array.isArray(m.members) && m.members.some(x => x?.id === this.id)) {
          if(Number.isFinite(m.expires))this.expires=m.expires;
          clearTimeout(timeout); this.timers.delete(timeout); joined = true; this.rejectJoin = null;
          this.receiveMembers(m.members); this.setState('connected'); resolve();
        }
      });
      conn.on('close', () => {
        clearTimeout(timeout); this.timers.delete(timeout);
        if (this.closed || this.control !== conn) return;
        this.members.clear(); this.publishMembers();
        reject(Error('The room creator disconnected. Ask them to reopen the room.'));
        if (joined) { this.setState('disconnected', 'Room creator disconnected. Active file transfers may still finish.'); }
      });
      conn.on('error', e => { clearTimeout(timeout); this.timers.delete(timeout); reject(e); });
    });
  }
  rejoin() {
    if (this.closed || this.host || this.rejoining) return;
    this.rejoining = true;
    this.joinHost().catch(e => this.setState('disconnected', e.message)).finally(() => { this.rejoining = false; });
  }
  self() { return {id:this.id,name:this.name,mode:this.mode,deviceId:this.settings.deviceId||this.id}; }
  setMode(mode) {
    this.mode = mode;
    if (!this.id || this.closed) return;
    if (this.host) { this.members.set(this.id,this.self()); this.broadcast(); }
    else if (this.control?.open) this.control.send({type:'join',code:this.code,member:this.self()});
  }
  receiveMembers(members) {
    this.members = new Map(members.filter(memberIsValid).slice(0,32).map(m => [m.id,{id:m.id,name:m.name.slice(0,48),mode:m.mode,deviceId:typeof m.deviceId==='string'?m.deviceId.slice(0,64):m.id}]));
    this.publishMembers();
  }
  broadcast() {
    if (this.closed) return;
    const members = [...this.members.values()];
    // Only authenticated room members receive the roster, never pending joins.
    for (const [id, c] of this.links) if (c.open && this.members.has(id)) {
      try { c.send({type:'members',members,expires:this.expires}); } catch { c.close(); }
    }
    this.publishMembers();
  }
  incoming(conn) {
    if (this.closed) { conn.close(); return; }
    if (conn.metadata?.kind === 'room-v2' && this.host) {
      if (this.links.size >= 31 || this.links.has(conn.peer)) { conn.on('open', () => conn.close()); return; }
      const timer = this.later(() => { if (!this.members.has(conn.peer)) conn.close(); },10000);
      this.links.set(conn.peer,conn);
      conn.on('data', m => {
        if (this.closed) return;
        if (m?.type !== 'join' || m.code !== this.code || !memberIsValid({...m.member,id:conn.peer})) { conn.close(); return; }
        if(Date.now()>this.expires&&!this.members.has(conn.peer)&&!this.admitted.has(conn.peer)){conn.send({type:'rejected',reason:'expired'});this.later(()=>conn.close(),300);return;}
        if(this.settings.expectedDeviceId&&m.member.deviceId!==this.settings.expectedDeviceId){conn.close();return;}
        clearTimeout(timer); this.timers.delete(timer);
        this.admitted.add(conn.peer);
        this.members.set(conn.peer,{id:conn.peer,name:m.member.name.slice(0,48),mode:m.member.mode,deviceId:typeof m.member.deviceId==='string'?m.member.deviceId.slice(0,64):conn.peer}); this.broadcast();
      });
      conn.on('close', () => {
        clearTimeout(timer); this.timers.delete(timer);
        if (this.links.get(conn.peer) !== conn) return;
        this.links.delete(conn.peer); this.members.delete(conn.peer); this.broadcast();
      });
      conn.on('error', () => conn.close()); return;
    }
    const member = this.members.get(conn.peer);
    if(conn.metadata?.kind==='connection-probe'&&member){conn.on('open',()=>{conn.send('ready');this.cb.onTransfer?.(conn,member);});return;}
    if(conn.metadata?.kind==='contact-v3'&&member){let used=false;conn.on('data',message=>{if(used||JSON.stringify(message).length>4096){conn.close();return;}used=true;this.cb.onMessage?.(message,member,response=>{if(conn.open)conn.send(response);});});this.later(()=>conn.close(),90000);return;}
    if (['file-v2','file-v3'].includes(conn.metadata?.kind) && member) this.cb.onTransfer?.(conn,member);
    else conn.on('open', () => { conn.send(JSON.stringify({type:'decline',reason:'This transfer channel is not authorized for the connected device.'})); this.later(() => conn.close(),300); });
  }
  connect(id,transferId) {
    if (this.closed || this.state !== 'connected' || this.peer.disconnected) throw Error('Room disconnected. Use Retry connection first.');
    if (!this.members.has(id)) throw Error('Device left the room.');
    return this.peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:transferId?'file-v3':'file-v2',transferId}});
  }
  probe(id,timeout=20000){
    if(this.closed||this.state!=='connected'||this.peer.disconnected||!this.members.has(id))return Promise.reject(Error('Device is no longer connected.'));
    const conn=this.peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'connection-probe'}});
    return new Promise((resolve,reject)=>{let done=false;const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);if(error){conn.close();reject(error);}else resolve(conn);};const timer=setTimeout(()=>finish(Error('File connection timed out.')),timeout);conn.on('data',value=>value==='ready'&&finish());conn.on('error',()=>finish(Error('Could not open the file connection.')));conn.on('close',()=>finish(Error('The file connection closed early.')));});
  }
  message(id,message){return new Promise((resolve,reject)=>{if(!this.members.has(id)){reject(Error('Device disconnected.'));return;}const c=this.peer.connect(id,{serialization:'json',reliable:true,metadata:{kind:'contact-v3'}});const timer=setTimeout(()=>{c.close();reject(Error('The other device did not answer.'));},90000);c.on('open',()=>c.send(message));c.on('data',m=>{clearTimeout(timer);resolve(m);c.close();});c.on('error',e=>{clearTimeout(timer);reject(e);});c.on('close',()=>{clearTimeout(timer);reject(Error('Device disconnected.'));});});}
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.rejectOpen?.(Error('Room connection cancelled.')); this.rejectJoin?.(Error('Room connection cancelled.'));
    this.peer?.destroy(); this.members.clear(); this.links.clear(); this.setState('closed');
  }
}

export async function probeNetwork(timeout = 12000) {
  const counts = {host:0,srflx:0,relay:0};
  const pc = new RTCPeerConnection(peerOptions().config);
  let timer;
  try {
    pc.createDataChannel('network-check');
    const gathered = new Promise(resolve => {
      timer = setTimeout(resolve,timeout);
      pc.onicecandidate = e => { if (!e.candidate) resolve(); else if (e.candidate.type in counts) counts[e.candidate.type]++; };
    });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered; clearTimeout(timer);
    return {local:counts.host>0,stun:counts.srflx>0,relay:counts.relay>0};
  } finally { clearTimeout(timer);pc.close(); }
}
