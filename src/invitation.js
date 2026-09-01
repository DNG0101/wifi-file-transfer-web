import {parseRoom} from './room.js';

const appPath = path => path.replace(/\/index\.html$/, '/').replace(/\/$/, '');
export function readInvitation(value, base, requireLink = false) {
  const text = String(value).trim();
  if (!/^https?:\/\//i.test(text)) {
    if (requireLink) throw Error('That QR is not an invitation for this app.');
    return {code:parseRoom(text),mode:null};
  }
  const url = new URL(text), current = new URL(base);
  if (url.origin !== current.origin || appPath(url.pathname) !== appPath(current.pathname))
    throw Error('That invitation belongs to a different website. Open the same app on both devices.');
  const params = new URLSearchParams(url.hash.slice(1));
  const mode = params.get('mode');
  return {code:parseRoom(text),mode:['send','receive'].includes(mode)?mode:null};
}

export function invitationUrl(base, code, mode) {
  const url = new URL(base);
  url.pathname = appPath(url.pathname) + '/';
  url.search = '';
  url.hash = new URLSearchParams({join:parseRoom(code),mode:mode==='send'?'receive':'send'}).toString();
  return url.href;
}
