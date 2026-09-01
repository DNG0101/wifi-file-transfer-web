import {Room} from './room.js';
import {deviceRecords} from './storage.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function identity(){
 let id;try{
  const candidates=[];
  for(const key of ['wft-device-id','app_device_uuid']){const value=localStorage.getItem(key);if(UUID.test(value||''))candidates.push({id:value,version:Number(localStorage.getItem(key+'-version'))||0,updatedAt:Number(localStorage.getItem(key+'-updated'))||0});}
  try{const legacy=JSON.parse(localStorage.getItem('wft-identity-candidates')||'[]');if(Array.isArray(legacy))for(const row of legacy)if(UUID.test(row?.id||''))candidates.push({id:row.id,version:Number(row.version)||0,updatedAt:Number(row.updatedAt)||0});}catch{}
  candidates.sort((a,b)=>b.version-a.version||b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));id=candidates[0]?.id||crypto.randomUUID();
  const version=candidates[0]?.version||1,updatedAt=candidates[0]?.updatedAt||Date.now();
  localStorage.setItem('wft-device-id',id);localStorage.setItem('app_device_uuid',id);localStorage.setItem('wft-device-id-version',String(version));localStorage.setItem('wft-device-id-updated',String(updatedAt));localStorage.removeItem('wft-identity-candidates');
 }catch{id=crypto.randomUUID();}return id;
}
export function friendlyName(ua=navigator.userAgent){const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome|CriOS/.test(ua)?'Chrome':'Safari';const os=/iPhone/.test(ua)?'iPhone':/iPad/.test(ua)?'iPad':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Mac/.test(ua)?'Mac':'Linux';return `${browser} on ${os}`;}
export class TrustedDevices {
 constructor({id,name,mode,onChange,onTransfer,onError}){Object.assign(this,{id,name,mode,onChange,onTransfer,onError});this.rooms=new Map();this.contacts=[];this.timer=setInterval(()=>void this.refresh(),30000);}
 async load(){this.contacts=(await deviceRecords.list()).slice(0,8);await this.refresh();}
 async refresh(){
  for(const contact of this.contacts){
   const current=this.rooms.get(contact.id);if(current&&!['closed','disconnected'].includes(current.room.state))continue;
   current?.room.close();const entry={contact,members:[]};
   const room=new Room({onMembers:list=>{entry.members=list.filter(m=>m.deviceId===contact.id).map(m=>({...m,name:contact.name,trusted:true,room}));this.onChange?.();},onState:()=>this.onChange?.(),onTransfer:(conn,m)=>{if(m.deviceId===contact.id)this.onTransfer(conn,{...m,name:contact.name,trusted:true,room});else conn.close();}}, {deviceId:this.id,expectedDeviceId:contact.id,privateCode:true,inviteLifetime:Infinity});
   entry.room=room;this.rooms.set(contact.id,entry);
   void room.open(contact.secret,this.id<contact.id,this.name,this.mode).catch(()=>{room.close();entry.members=[];this.onChange?.();});
  }this.onChange?.();
 }
 members(){return [...this.rooms.values()].flatMap(e=>e.members);}
 setMode(mode){this.mode=mode;for(const {room} of this.rooms.values())room.setMode(mode);}
 async remember(member){if(member.deviceId===this.id)throw Error('These tabs share the same browser identity. Remember a different device or browser instead.');if(this.contacts.length>=8)throw Error('You can remember up to eight devices. Forget an old device in Settings first.');const secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');const answer=await member.room.message(member.id,{type:'remember',secret});if(answer?.accepted!==true)throw Error('The other device did not agree to be remembered.');await this.add(member,secret);}
 async add(member,secret){if(this.contacts.length>=8&&!this.contacts.some(c=>c.id===member.deviceId))throw Error('Eight devices are already remembered.');if(!/^[0-9a-f-]{36}$/.test(member.deviceId)||!/^[a-f0-9]{64}$/.test(secret))throw Error('Invalid device invitation.');await deviceRecords.put({id:member.deviceId,name:member.name.slice(0,48),secret,created:Date.now()});await this.load();}
 async forget(id){this.rooms.get(id)?.room.close();this.rooms.delete(id);await deviceRecords.remove(id);await this.load();}
 async rename(id,name){const record=await deviceRecords.get(id);if(!record)return;record.name=name.trim().slice(0,48)||record.name;await deviceRecords.put(record);this.rooms.get(id)?.room.close();await this.load();}
 close(){clearInterval(this.timer);for(const {room} of this.rooms.values())room.close();}
}
