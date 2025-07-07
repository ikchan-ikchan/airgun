// clustering-worker.js
let width=0, height=0, area=null, radius=10, fillRatio=50, prevFrame=null;

self.onmessage = function(e) {
  if (e.data.type === "init") {
    width = e.data.width;
    height = e.data.height;
    prevFrame = new Uint8ClampedArray(width*height*4);
    return;
  }
  if (e.data.type === "area") {
    area = e.data.area;
  }
  if (e.data.type === "param") {
    radius = e.data.radius;
    fillRatio = e.data.fillRatio;
  }
  if (e.data.type === "frame") {
    const currFrame = new Uint8ClampedArray(e.data.data);
    // 差分マスク
    const diffMask = new Uint8ClampedArray(width * height);
    for(let y=area.y; y<area.y+area.h; y++) {
      for(let x=area.x; x<area.x+area.w; x++) {
        const i = y*width + x, p = i*4;
        const dr = Math.abs(currFrame[p+0] - prevFrame[p+0]);
        const dg = Math.abs(currFrame[p+1] - prevFrame[p+1]);
        const db = Math.abs(currFrame[p+2] - prevFrame[p+2]);
        diffMask[i] = (dr+dg+db>50) ? 255 : 0;
      }
    }
    prevFrame.set(currFrame);

    // --- クラスタ検出 ---
    const painted = new Uint8Array(width*height);
    let circles = [];
    for (let y=area.y; y<area.y+area.h; y++) for (let x=area.x; x<area.x+area.w; x++) {
      const i = y*width+x;
      if (diffMask[i] && !painted[i]) {
        let nAll=0, nMask=0;
        for(let yy=y-radius; yy<=y+radius; yy++) {
          if(yy<area.y || yy>=area.y+area.h) continue;
          for(let xx=x-radius; xx<=x+radius; xx++) {
            if(xx<area.x || xx>=area.x+area.w) continue;
            const dist2 = (xx-x)*(xx-x) + (yy-y)*(yy-y);
            if(dist2<=radius*radius) {
              nAll++;
              const idx2=yy*width+xx;
              if(diffMask[idx2]) nMask++;
            }
          }
        }
        const ratio = (nMask/nAll)*100;
        if(ratio>=fillRatio) {
          circles.push({x:x+0.5,y:y+0.5,r:radius});
          for(let yy=y-radius; yy<=y+radius; yy++) {
            if(yy<area.y || yy>=area.y+area.h) continue;
            for(let xx=x-radius; xx<=x+radius; xx++) {
              if(xx<area.x || xx>=area.x+area.w) continue;
              const dist2 = (xx-x)*(xx-x)+(yy-y)*(yy-y);
              if(dist2<=radius*radius) {
                const idx2=yy*width+xx;
                if(diffMask[idx2]) painted[idx2]=1;
              }
            }
          }
        }
      }
    }
    // クラスタ分割
    let parent = Array(circles.length).fill(0).map((_,i)=>i);
    function find(i){return parent[i]===i?i:parent[i]=find(parent[i]);}
    function unite(i,j){parent[find(i)]=find(j);}
    for(let i=0;i<circles.length;i++) for(let j=i+1;j<circles.length;j++) {
      let c1=circles[i],c2=circles[j];
      let dist = Math.hypot(c1.x-c2.x, c1.y-c2.y);
      if(dist<=c1.r+c2.r) unite(i,j);
    }
    let clusters = {};
    for(let i=0;i<circles.length;i++) {
      let root=find(i);
      if(!clusters[root]) clusters[root]=[];
      clusters[root].push(i);
    }
    // 各クラスタのMSTと最長パス（直径）計算
    let paths = [];
    Object.values(clusters).forEach(indices=>{
      if(indices.length<2) return;
      let edges=[];
      for(let i=0;i<indices.length;i++) for(let j=i+1;j<indices.length;j++){
        let a=circles[indices[i]],b=circles[indices[j]];
        let dist=Math.hypot(a.x-b.x,a.y-b.y);
        edges.push({from:i,to:j,d:dist});
      }
      edges.sort((a,b)=>a.d-b.d);
      let uf=Array(indices.length).fill(0).map((_,i)=>i);
      function f(i){return uf[i]===i?i:uf[i]=f(uf[i]);}
      let tree = Array(indices.length).fill(0).map(()=>[]);
      let edgeCount=0;
      for(let ed of edges){
        let u=f(ed.from),v=f(ed.to);
        if(u!==v){
          tree[ed.from].push({to:ed.to,d:ed.d});
          tree[ed.to].push({to:ed.from,d:ed.d});
          uf[u]=v;
          edgeCount++;
          if(edgeCount===indices.length-1) break;
        }
      }
      function bfs(start){
        let visited=Array(indices.length).fill(false),dist=Array(indices.length).fill(0),prev=Array(indices.length).fill(-1);
        let q=[start]; visited[start]=true;
        while(q.length){
          let v=q.shift();
          for(let e of tree[v]){
            if(!visited[e.to]){
              visited[e.to]=true;
              dist[e.to]=dist[v]+e.d;
              prev[e.to]=v;
              q.push(e.to);
            }
          }
        }
        let maxIdx = dist.indexOf(Math.max(...dist));
        return {end:maxIdx,dist,prev};
      }
      let b1=bfs(0),b2=bfs(b1.end),path=[];
      for(let v=b2.end;v!=-1;v=b2.prev[v]) path.push(v);
      path.reverse();
      if(path.length>=2) {
        paths.push({
          points: path.map(idx=>circles[indices[idx]]),
        });
      }
    });
    // 結果返却
    self.postMessage({
      type:"result",
      diffMask:diffMask.buffer,
      circles,
      paths
    }, [diffMask.buffer]);
  }
};
