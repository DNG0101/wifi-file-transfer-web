import test from 'node:test';
import {readFile} from 'node:fs/promises';
export function checkDownloadLinks(receive){
  const nodes=new Map(),downloads=[],revoked=[];
  class Node{
    constructor(tag,text){this.tag=tag;this.textContent=text;this.children=[];this.hidden=true;this.clicks=0;}
    append(...nodes){for(const node of nodes){this.children.push(node);node.parent=this;}}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
    click(){this.clicks++;if(this.tag==='a'&&!this.parent)throw Error('Detached download link');}
  }
  const el=(tag,text)=>new Node(tag,text),$=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);};
  const URL={createObjectURL:()=> 'blob:test',revokeObjectURL:url=>revoked.push(url)};
  const receivedFile=receive({el,$,downloads,URL,fmt:n=>String(n)});
  receivedFile({name:'résumé-日本語.txt',size:7,blob:{size:7}});
  const line=$('downloads').children[0],actions=line.children[1],link=actions.children[0];
  if(link.download!=='résumé-日本語.txt'||link.clicks!==1||link.parent!==actions)throw Error('Automatic browser download and attached fallback required');
  if(revoked.length||downloads.length!==1)throw Error('Download must remain available');
  link.click();if(link.clicks!==2)throw Error('Manual fallback is not usable');
  actions.children[1].onclick();
  if(revoked[0]!=='blob:test'||downloads.length||$('downloads').children.length)throw Error('Hide must release the URL');
  return 'Automatic download, Unicode filename, retained manual fallback, and explicit URL cleanup passed';
}

test('received files use browser downloads and keep a fallback link',async()=>{
 const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const implementation=source.slice(source.indexOf('function receivedFile('),source.indexOf('function track('));
 checkDownloadLinks(deps=>new Function('deps',"const {el,$,downloads,URL,fmt}=deps;\n"+implementation+"\nreturn receivedFile;")(deps));
});
