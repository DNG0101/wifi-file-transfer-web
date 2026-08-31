import {configureIce} from './room.js';
// Optional operator service: return short-lived TURN credentials, never embed a
// private long-term credential in the static site. Default pairing remains usable.
export async function configureNetwork(){
 const response=await fetch(new URL('../connection-config.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!response.ok)return;const config=await response.json();if(!config.turnCredentialsUrl)return;
 const url=new URL(config.turnCredentialsUrl);if(url.protocol!=='https:')throw Error('The optional relay credential service must use HTTPS.');
 const credentials=await fetch(url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)});if(!credentials.ok)throw Error('Optional relay service unavailable; using default connection routes.');
 const result=await credentials.json();
 if(!Array.isArray(result.iceServers)||result.iceServers.length>8||!Number.isFinite(result.expiresAt)||result.expiresAt<Date.now()+60000||result.expiresAt>Date.now()+86400000)throw Error('Relay credentials are invalid or expired.');
 const servers=result.iceServers.map(s=>{const urls=Array.isArray(s.urls)?s.urls:[s.urls];if(!urls.length||urls.some(u=>typeof u!=='string'||!/^turns?:[^\s]+$/.test(u))||typeof s.username!=='string'||typeof s.credential!=='string')throw Error('Invalid relay configuration.');return {urls,username:s.username,credential:s.credential};});
 configureIce(servers);
}
