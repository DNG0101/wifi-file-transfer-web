// Reopen stale connections without replaying transactions that have already started.
export function createDatabaseConnection(indexed,name,version,upgrade) {
  let database=null,opening=null;
  function forget(connection) {
    if(database===connection)database=null;
  }
  async function open() {
    if(database)return database;
    if(!opening) {
      opening=new Promise((resolve,reject)=>{
        const request=indexed.open(name,version);
        request.onupgradeneeded=()=>upgrade(request.result);
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{
          const connection=request.result;
          connection.onclose=()=>forget(connection);
          connection.onversionchange=()=>{
            forget(connection);
            connection.close();
          };
          database=connection;
          resolve(connection);
        };
      });
    }
    const pending=opening;
    try{return await pending;}
    finally{if(opening===pending)opening=null;}
  }
  async function transaction(stores,mode='readonly') {
    for(let attempt=0;attempt<2;attempt++) {
      const connection=await open();
      try{return connection.transaction(stores,mode);}
      catch(error) {
        // InvalidStateError here means no transaction was created, so retry is safe.
        if(error?.name!=='InvalidStateError')throw error;
        forget(connection);
        connection.close();
        if(attempt===1)throw error;
      }
    }
  }
  return {open,transaction};
}
