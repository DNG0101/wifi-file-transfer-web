import {peerOptions,probeNetwork} from './room.js';

export function relayConfigured(){return peerOptions().config.iceServers.some(server=>[server.urls].flat().some(url=>/^turns?:/i.test(url)));}
export async function connectionDiagnosis(timeout=7000){
 const base={online:navigator.onLine,secure:window.isSecureContext,webrtc:typeof RTCPeerConnection==='function',relayConfigured:relayConfigured()};
 if(!base.online)return {...base,local:false,stun:false,relay:false,summary:'Internet is offline. Pairing needs internet access.'};
 if(!base.secure||!base.webrtc)return {...base,local:false,stun:false,relay:false,summary:'This browser cannot start secure WebRTC connections here.'};
 try{
  const route=await probeNetwork(timeout),summary=route.relay?'Direct and relay routes are available.':route.stun?base.relayConfigured?'Direct setup works; the configured relay was not reachable in this check.':'Direct setup works. No TURN relay is configured, so restrictive networks may still block device connections.':'No internet-assisted WebRTC route was found. Check VPN, firewall, guest Wi-Fi, and mobile-data restrictions.';
  return {...base,...route,summary};
 }catch(e){return {...base,local:false,stun:false,relay:false,summary:'Connection route check failed: '+e.message};}
}
export function failedChannelMessage(name,diagnosis){
 const lead=`Could not open a file connection to ${name}.`;
 if(!diagnosis?.online)return lead+' Internet access was lost.';
 if(!diagnosis?.stun)return lead+' WebRTC setup is blocked. Disable VPN, leave guest Wi-Fi, and keep both devices awake.';
 if(!diagnosis.relayConfigured)return lead+' Signaling works, but this site has no TURN relay for networks that block direct WebRTC. Try the same private Wi-Fi without VPN or guest isolation.';
 return lead+' The direct and relay routes were unavailable. Run Connection check and retry.';
}
