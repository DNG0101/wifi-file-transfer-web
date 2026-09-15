from pathlib import Path

p=Path('src/block-transfer.js')
s=p.read_text()
old="""  pickLane(){
    let best={index:0,conn:this.conn,plan:this.transport||transportPlan(this.conn),score:Infinity};
    for(const [index,conn] of this.lanes){
      if(!conn?.open)continue;const plan=this.lanePlans.get(index)||transportPlan(conn),dc=conn.dataChannel;
      const score=(dc?.bufferedAmount||0)/Math.max(1,plan.high);
      if(score<best.score)best={index,conn,plan,score};
    }
    return best;
  }
"""
new="""  pickLane(){
    const ready=[];
    for(const [index,conn] of this.lanes){
      if(!conn?.open)continue;const plan=this.lanePlans.get(index)||transportPlan(conn),dc=conn.dataChannel;
      ready.push({index,conn,plan,score:(dc?.bufferedAmount||0)/Math.max(1,plan.high)});
    }
    if(!ready.length)return {index:0,conn:this.conn,plan:this.transport||transportPlan(this.conn),score:Infinity};
    const uncongested=ready.filter(item=>item.score<0.75);
    if(uncongested.length){const cursor=(this.laneCursor||0)%uncongested.length;this.laneCursor=(cursor+1)%1024;return uncongested[cursor];}
    return ready.reduce((best,item)=>item.score<best.score?item:best,ready[0]);
  }
"""
if s.count(old)!=1:
    raise SystemExit(f'pickLane replacement mismatch: {s.count(old)}')
p.write_text(s.replace(old,new,1))
print('balanced lane scheduler applied')
