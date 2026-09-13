import test from 'node:test';
import {createDatabaseConnection} from '../src/database-connection.js';
export async function checkDatabaseRecovery(createDatabaseConnection) {
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const error=name=>Object.assign(Error(name),{name});
  const connections=[];let opens=0,failOpen=false,alwaysClosed=false;
  const indexed={open(){
    opens++;const request={};
    Promise.resolve().then(()=>{
      if(failOpen){failOpen=false;request.error=error('UnknownError');request.onerror();return;}
      const connection={closed:alwaysClosed,transactions:0,close(){this.closed=true;},
        transaction(stores,mode){
          if(this.closed)throw error('InvalidStateError');
          if(stores==='missing')throw error('NotFoundError');
          this.transactions++;return {connection,stores,mode};
        }};
      connections.push(connection);request.result=connection;request.onsuccess();
    });return request;
  }};
  const manager=createDatabaseConnection(indexed,'test',1,()=>{});
  const initial=await Promise.all([manager.open(),manager.open(),manager.open()]);
  assert(opens===1&&initial.every(c=>c===initial[0]),'Concurrent opens must share one connection');
  initial[0].close();
  const recovered=await manager.transaction('transfers','readwrite');
  assert(opens===2&&recovered.connection!==initial[0],'Closed connection must reopen');
  recovered.connection.closed=true;recovered.connection.onclose();
  const afterClose=await manager.open();
  assert(opens===3&&afterClose!==recovered.connection,'Unexpected close must invalidate cache');
  recovered.connection.onclose();
  assert(await manager.open()===afterClose,'Late close must not discard a replacement');
  afterClose.onversionchange();
  assert(afterClose.closed,'Version change must close old connection');
  const afterVersion=await manager.open();
  assert(opens===4&&afterVersion!==afterClose,'Version change must permit reopening');
  let failure;
  try{await manager.transaction('missing');}catch(e){failure=e;}
  assert(failure?.name==='NotFoundError'&&opens===4,'Unrelated errors must not retry');
  afterVersion.close();
  const both=await Promise.all([manager.transaction('transfers'),manager.transaction('devices')]);
  assert(opens===5&&both[0].connection===both[1].connection,'Concurrent recovery must share one open');
  both[0].connection.close();alwaysClosed=true;failure=null;
  try{await manager.transaction('transfers');}catch(e){failure=e;}
  assert(failure?.name==='InvalidStateError'&&opens===6,'Recovery attempts must be bounded');
  alwaysClosed=false;failOpen=true;failure=null;
  try{await manager.open();}catch(e){failure=e;}
  assert(failure?.name==='UnknownError','Open failures must propagate');
  await manager.open();
  assert(opens===8,'Failed open must not poison future opens');
  return '8 database recovery checks passed';
}

test('database connection recovers from closing handles',async()=>{await checkDatabaseRecovery(createDatabaseConnection);});
