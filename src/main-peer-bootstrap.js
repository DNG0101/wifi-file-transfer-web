import {MainPeerManager} from './main-peer.js';
import {identity,friendlyName} from './devices.js';
import {configureNetwork} from './network.js';

const uuid=identity();
let name=friendlyName();
try{name=localStorage.getItem('wft-device-name')||name;}catch{}

// Peer 1 is the application's always-available main peer. The Online toggle
// controls only Peer 2 (presence/discovery) in app.js.
const manager=new MainPeerManager({uuid,name,onState:()=>{}});
window.__wftMainPeerBootstrap=manager;

void configureNetwork().catch(()=>{}).then(()=>manager.start()).catch(()=>{});

window.addEventListener('pagehide',()=>void manager.stop(),{once:true});
