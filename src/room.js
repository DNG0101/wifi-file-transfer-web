import Peer from 'peerjs';
export const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), n=>'abcdefghjkmnpqrstuvwxyz23456789'[n%29]).join('');
export const normalizeCode = code => code.toLowerCase().replace(/[\s-]/g,'');
const options = {debug:0,config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}]}};
export class Room {
  constructor(callbacks) {this.cb=callbacks;this.members=new Map();this.links=new Map();this.closed=false;}
  async open(code,host,name,mode) {
    this.code=normalizeCode(code);this.host=host;this.name=name.slice(0,48);this.mode=mode;
    if(!/^[a-z0-9]{12}$/.test(this.code)) throw Error('Enter the 12-character room code from the other device.');
    this.hostId='wft2-'+this.code;
    this.peer=new Peer(host?this.hostId:undefined,options);
    this.peer.on('connection',conn=>this.incoming(conn));
    this.peer.on('disconnected',()=>this.cb.onError('Connection service disconnected. Leave and rejoin the room to discover devices again.'));
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.peer.destroy();reject(Error('Pairing service did not respond. Check your internet connection.'));},20000);
      this.peer.on('open',()=>{clearTimeout(timeout);resolve();});
      this.peer.on('error',e=>{clearTimeout(timeout);const msg=e.type==='unavailable-id'?'This room already exists. Choose Join room.':e.type==='peer-unavailable'?'Room not found. Keep the room creator’s page open.':`Could not connect (${e.type}). Check internet access and try again.`;reject(Error(msg));this.cb.onError(msg);});
    });
    if(this.closed) return;
    this.id=this.peer.id;
    if(host) {this.members.set(this.id,this.self());this.broadcast();}
    else {
      const conn=this.peer.connect(this.hostId,{reliable:true,serialization:'json',metadata:{kind:'room-v2'}});
      this.control=conn;
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{conn.close();reject(Error('Cannot reach the room. Try a normal Wi-Fi network without guest isolation or VPN.'));},25000);
        conn.on('open',()=>conn.send({type:'join',code:this.code,member:this.self()}));
        conn.on('data',m=>{if(m?.type==='members' && Array.isArray(m.members)) {clearTimeout(timeout);this.receiveMembers(m.members);resolve();}});
        conn.on('close',()=>{clearTimeout(timeout);reject(Error('Room closed.'));if(!this.closed){this.members.clear();this.cb.onMembers([]);this.cb.onError('Room creator left. Create or join a new room. Active transfers can finish.');}});
        conn.on('error',e=>{clearTimeout(timeout);reject(e);});
      });
    }
  }
  self() {return {id:this.id,name:this.name,mode:this.mode};}
  setMode(mode) {this.mode=mode;if(!this.id)return;if(this.host){this.members.set(this.id,this.self());this.broadcast();}else if(this.control?.open)this.control.send({type:'join',code:this.code,member:this.self()});}
  receiveMembers(members) {
    this.members=new Map(members.filter(m=>m && typeof m.id==='string' && typeof m.name==='string' && ['send','receive'].includes(m.mode)).slice(0,32).map(m=>[m.id,{id:m.id,name:m.name.slice(0,48),mode:m.mode}]));
    this.cb.onMembers([...this.members.values()].filter(m=>m.id!==this.id));
  }
  broadcast() {const members=[...this.members.values()];for(const c of this.links.values())if(c.open)c.send({type:'members',members});this.cb.onMembers(members.filter(m=>m.id!==this.id));}
  incoming(conn) {
    if(conn.metadata?.kind==='room-v2' && this.host) {
      if(this.links.size>=31){conn.close();return;}
      const timer=setTimeout(()=>{if(!this.members.has(conn.peer))conn.close();},10000);
      this.links.set(conn.peer,conn);
      conn.on('data',m=>{
        if(m?.type!=='join'||m.code!==this.code||typeof m.member?.name!=='string'||!['send','receive'].includes(m.member.mode)){conn.close();return;}
        clearTimeout(timer);this.members.set(conn.peer,{id:conn.peer,name:m.member.name.slice(0,48),mode:m.member.mode});this.broadcast();
      });
      conn.on('close',()=>{clearTimeout(timer);this.links.delete(conn.peer);this.members.delete(conn.peer);this.broadcast();});
      conn.on('error',()=>conn.close()); return;
    }
    const member=this.members.get(conn.peer);
    if(conn.metadata?.kind==='file-v2' && member && this.mode==='receive') this.cb.onTransfer(conn,member);
    else conn.on('open',()=>{conn.send(JSON.stringify({type:'decline'}));setTimeout(()=>conn.close(),100);});
  }
  connect(id) {if(!this.members.has(id))throw Error('Device left the room.');return this.peer.connect(id,{reliable:true,serialization:'raw',metadata:{kind:'file-v2'}});}
  close() {this.closed=true;this.peer?.destroy();this.members.clear();}
}
