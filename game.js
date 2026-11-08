(() => {
'use strict';
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d', { alpha: false });
const $ = id => document.getElementById(id);
const mapRows = [
  '###############',
  '#.....#.......#',
  '#.....#.......#',
  '#.....#..##...#',
  '#.............#',
  '###.###..###..#',
  '#...#.........#',
  '#...#..##.....#',
  '#......#......#',
  '#..##..#..###.#',
  '#.............#',
  '#.............#',
  '#......D......#',
  '#######.#######',
  '#######.#######',
  '###############'
];
const grid = mapRows.map(row => row.split('').map(c => c === '#' ? 1 : c === 'D' ? 2 : 0));
const MW = grid[0].length, MH = grid.length;
const state = { running:false, paused:false, ended:false, won:false, key:false, mapOpen:false, crouch:false, doorOpen:false, time:0, hintTimer:0, toastTimer:0, noise:0, enemyMode:'sleep', lastKnown:null, chaseTimer:0, pathTimer:0, audio:null, sound:true, stepTimer:0, bob:0, screen:'intro' };
const player = { x:2.5, y:2.5, angle:Math.PI/2, vx:0, vy:0 };
const granny = { x:12.5, y:2.5, angle:Math.PI, path:[], patrolIndex:0, wander:0, movePhase:0 };
const keyItem = { x:2.5, y:10.45, active:true };
const patrol = [{x:11.5,y:2.5},{x:12.5,y:6.5},{x:10.5,y:10.5},{x:5.5,y:10.5},{x:2.5,y:6.5}];
const FOV = Math.PI / 3.05;
let W = 520, H = 300, depth = new Float32Array(W), lastFrame = 0, pointerLook = false, lastPointerX = 0, joystick = {x:0,y:0}, toastTimeout, hintText = '', keys = Object.create(null);
const gameEl = $('game');
function resize(){
  const aspect = Math.max(.42, Math.min(2.4, innerWidth / innerHeight));
  W = Math.max(300, Math.min(700, Math.round(390 * Math.min(1.7, aspect))));
  H = Math.round(W / aspect);
  canvas.width = W; canvas.height = H; depth = new Float32Array(W);
}
addEventListener('resize', resize); resize();
function wallAt(x,y){ const gx=Math.floor(x),gy=Math.floor(y); return gx<0||gy<0||gx>=MW||gy>=MH?1:grid[gy][gx]; }
function canStand(x,y,r=.18){ return !wallAt(x-r,y-r)&&!wallAt(x+r,y-r)&&!wallAt(x-r,y+r)&&!wallAt(x+r,y+r); }
function moveCircle(obj,dx,dy,r=.18){
  if(canStand(obj.x+dx,obj.y,r)) obj.x+=dx;
  if(canStand(obj.x,obj.y+dy,r)) obj.y+=dy;
}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function showToast(text,duration=2100){ const el=$('toast'); el.textContent=text; el.classList.add('show'); clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>el.classList.remove('show'),duration); }
function setHint(text){ const el=$('hint'); if(text!==hintText){hintText=text;el.textContent=text;} el.classList.toggle('show',!!text); }
function updateHUD(){
  $('objective').textContent=state.key?'Reach the front door':'Find the exit key';
  $('inventoryText').textContent=state.key?'OLD BRASS KEY':'EMPTY HANDS';
  $('keySlot').classList.toggle('has-key',state.key);
  $('noiseFill').style.width=`${Math.round(state.noise*100)}%`;
  $('noiseFill').style.background=state.noise>.55?'#b84b3e':'#d3b878';
  $('nightLabel').textContent=`NIGHT 1 · ${formatTime(state.time)}`;
  $('mapBtn').style.color=state.mapOpen?'#e7c98e':'';
}
function formatTime(seconds){const m=Math.floor(seconds/60),s=Math.floor(seconds%60);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
function playTone(freq=180,duration=.08,volume=.04,type='sine'){
  if(!state.sound)return;
  try{if(!state.audio)state.audio=new (window.AudioContext||window.webkitAudioContext)();const a=state.audio;if(a.state==='suspended')a.resume();const o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(volume,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+duration);o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+duration);}catch(e){}
}
function resetGame(){
  player.x=2.5;player.y=2.5;player.angle=Math.PI/2;player.vx=player.vy=0;
  granny.x=12.5;granny.y=2.5;granny.angle=Math.PI;granny.path=[];granny.patrolIndex=0;granny.wander=0;
  keyItem.active=true;state.key=false;state.doorOpen=false;grid[12][7]=2;
  state.time=0;state.noise=0;state.enemyMode='sleep';state.lastKnown=null;state.chaseTimer=0;state.pathTimer=0;state.crouch=false;state.ended=false;state.won=false;state.running=true;state.paused=false;state.screen='';
  $('screen').classList.remove('visible');$('screen').innerHTML='';$('crouchBtn').classList.remove('active');$('flash').classList.remove('hit');
  setHint('');updateHUD();
}
function pauseGame(){if(!state.running||state.ended)return;state.paused=!state.paused;gameEl.classList.toggle('paused',state.paused);if(state.paused){showPanel('PAUSED','The house is still listening.','RESUME GAME',()=>{state.paused=false;gameEl.classList.remove('paused');$('screen').classList.remove('visible');});}}
function showPanel(title,copy,button,action,won=false){
  const screen=$('screen');screen.innerHTML=`<div class="intro-card"><div class="eyebrow">${won?'YOU MADE IT OUT':'THE OLD HOUSE'}</div><h1>${title}</h1><p>${copy}</p><button id="panelAction" class="start-btn">${button}<span>→</span></button><small class="touch-note">${won?'You survived the night.':'Take a breath, then try again.'}</small></div>`;screen.classList.add('visible');$('panelAction').onclick=action;
}
function endGame(won){state.ended=true;state.won=won;state.running=false;state.paused=false;gameEl.classList.remove('paused');if(won){playTone(540,.4,.07,'triangle');showPanel('ESCAPED','The front door swings open. Cold night air rushes in as you leave the old house behind.','PLAY AGAIN',resetGame,true);}else{playTone(70,.5,.1,'sawtooth');$('flash').classList.remove('hit');void $('flash').offsetWidth;$('flash').classList.add('hit');showPanel('SHE FOUND YOU','A floorboard creaks beneath you. The old woman turns—and the hallway goes dark.','TRY AGAIN',resetGame);}}
function interact(){
  if(!state.running||state.paused)return;
  if(keyItem.active&&dist(player,keyItem)<1.15){keyItem.active=false;state.key=true;state.noise=.8;state.enemyMode='alert';state.lastKnown={x:player.x,y:player.y};state.chaseTimer=9;showToast('You found the brass key. The front door is downstairs.',2600);playTone(720,.16,.06,'triangle');updateHUD();return;}
  const doorDist=dist(player,{x:7.5,y:12.5});
  if(doorDist<1.6){
    if(state.key){state.doorOpen=true;grid[12][7]=0;state.noise=.9;state.enemyMode='alert';state.lastKnown={x:player.x,y:player.y};showToast('The lock turns. Get outside!',1900);playTone(400,.25,.07,'triangle');}
    else{showToast('Locked. You need the old brass key.',1700);playTone(115,.08,.04,'square');}return;
  }
  showToast('Nothing to use here.',1000);
}
function toggleCrouch(){if(!state.running||state.paused)return;state.crouch=!state.crouch;$('crouchBtn').classList.toggle('active',state.crouch);playTone(state.crouch?125:190,.05,.025);}
function toggleMap(){state.mapOpen=!state.mapOpen;$('minimap').classList.toggle('open',state.mapOpen);}
function updateHint(){
  if(keyItem.active&&dist(player,keyItem)<1.35){setHint('E / USE  ·  PICK UP THE BRASS KEY');return;}
  if(dist(player,{x:7.5,y:12.5})<1.8){setHint(state.key?'E / USE  ·  UNLOCK THE FRONT DOOR':'THE FRONT DOOR IS LOCKED');return;}
  if(state.enemyMode==='chase'&&dist(player,granny)<4.2){setHint('SHE KNOWS WHERE YOU ARE — KEEP MOVING');return;}
  setHint('');
}
function color(r,g,b,a=255){return [r,g,b,a];}
function renderWorld(){
  const img=ctx.createImageData(W,H),pix=img.data,horizon=Math.floor(H*.51+Math.sin(state.bob)*1.5),planeX=-Math.sin(player.angle)*Math.tan(FOV/2),planeY=Math.cos(player.angle)*Math.tan(FOV/2);
  // Dusty ceiling and worn timber floor, rendered per pixel for true perspective.
  for(let y=0;y<H;y++){
    const ceiling=y<horizon;
    for(let x=0;x<W;x++){
      const p=(y*W+x)*4;
      if(ceiling){let t=y/horizon,grain=((x*17+y*23)%17)/17;pix[p]=Math.floor(24+grain*7+t*4);pix[p+1]=Math.floor(25+grain*6+t*3);pix[p+2]=Math.floor(22+grain*5+t*2);}
      else{let row=y-horizon+1, forward=(H*.54)/row, camX=2*x/W-1, rx=Math.cos(player.angle)+planeX*camX,ry=Math.sin(player.angle)+planeY*camX;let fx=player.x+rx*forward,fy=player.y+ry*forward;let plank=(Math.floor(fx*2)+Math.floor(fy*4))%2;let seam=(Math.abs((fy*4)%1)<.045||Math.abs((fx*2)%1)<.025);let shade=clamp(1-forward/13,.12,.95)*(seam?.48:1);let noise=((Math.floor(fx*16)+Math.floor(fy*20)*7)%9);pix[p]=Math.floor((53+plank*7+noise)*shade);pix[p+1]=Math.floor((43+plank*5+noise)*shade);pix[p+2]=Math.floor((31+plank*3+noise)*shade);}
      pix[p+3]=255;
    }
  }
  const pitch=state.crouch?H*.025:0;
  for(let x=0;x<W;x++){
    const camX=2*x/W-1,rayX=Math.cos(player.angle)+planeX*camX,rayY=Math.sin(player.angle)+planeY*camX;
    let mapX=Math.floor(player.x),mapY=Math.floor(player.y),deltaX=Math.abs(1/rayX),deltaY=Math.abs(1/rayY),stepX,stepY,sideX,sideY;
    if(rayX<0){stepX=-1;sideX=(player.x-mapX)*deltaX;}else{stepX=1;sideX=(mapX+1-player.x)*deltaX;}
    if(rayY<0){stepY=-1;sideY=(player.y-mapY)*deltaY;}else{stepY=1;sideY=(mapY+1-player.y)*deltaY;}
    let side=0,hit=0,loops=0;
    while(!hit&&loops++<32){if(sideX<sideY){sideX+=deltaX;mapX+=stepX;side=0;}else{sideY+=deltaY;mapY+=stepY;side=1;}hit=wallAt(mapX+.001,mapY+.001);}
    let d=side===0?sideX-deltaX:sideY-deltaY;d=Math.max(.08,d);depth[x]=d;
    const wallH=Math.floor(H*.93/d),top=Math.max(0,Math.floor(horizon-wallH/2+pitch)),bottom=Math.min(H,Math.floor(horizon+wallH/2+pitch));
    let wallX=side===0?player.y+d*rayY:player.x+d*rayX;wallX-=Math.floor(wallX);let texX=Math.floor(wallX*8);if((side===0&&rayX>0)||(side===1&&rayY<0))texX=7-texX;
    let shade=clamp(1-d/12,.15,1)*(side===1?.78:1);const door=hit===2;
    for(let y=top;y<bottom;y++){
      const ty=(y-top)/Math.max(1,bottom-top),brick=Math.floor(ty*7),mortar=(ty*7)%1<.035||((brick%2===0?texX%4===0:texX%4===2)&&ty>.025&&ty<.98),grain=((Math.floor((y+mapY*9)*.13)+texX*3+mapX*7)%11);
      let r,g,b;
      if(door){const plank=texX%2===0; r=plank?94:77;g=plank?49:38;b=plank?37:30;if(mortar){r=54;g=30;b=25;}if(y<top+wallH*.12||y>bottom-wallH*.1){r+=17;g+=14;b+=8;}}
      else {let base=brick%2===0?76:67;r=base+grain;g=base-7+grain;b=base-17+grain;if(mortar){r=38;g=38;b=34;}if(texX===0||texX===7){r-=10;g-=8;b-=5;} }
      if(d<1.4){let blood=clamp((1.4-d)/.8,0,.25);r=r*(1-blood)+86*blood;g=g*(1-blood)+27*blood;}
      let k=shade*(mortar?.8:1);let p=(y*W+x)*4;img.data[p]=Math.max(0,r*k);img.data[p+1]=Math.max(0,g*k);img.data[p+2]=Math.max(0,b*k);img.data[p+3]=255;
    }
  }
  ctx.putImageData(img,0,0);
  drawSprites(planeX,planeY,horizon+pitch);
  drawHands();
}
function makeGrannySprite(){
  const c=document.createElement('canvas');c.width=128;c.height=192;const g=c.getContext('2d');
  // soft floor shadow
  let grad=g.createRadialGradient(64,178,4,64,178,52);grad.addColorStop(0,'rgba(0,0,0,.7)');grad.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=grad;g.fillRect(8,150,112,40);
  // old dark hair silhouette
  g.fillStyle='#24201e';g.beginPath();g.ellipse(64,48,38,44,0,0,Math.PI*2);g.fill();
  // dress silhouette
  g.fillStyle='#62544b';g.beginPath();g.moveTo(44,79);g.quadraticCurveTo(25,92,27,135);g.lineTo(13,174);g.quadraticCurveTo(64,189,115,174);g.lineTo(100,135);g.quadraticCurveTo(103,92,84,79);g.closePath();g.fill();
  g.fillStyle='#77675b';g.beginPath();g.moveTo(47,93);g.lineTo(64,103);g.lineTo(82,91);g.lineTo(94,159);g.lineTo(35,159);g.closePath();g.fill();
  g.strokeStyle='#342c28';g.lineWidth=3;g.beginPath();g.moveTo(64,102);g.lineTo(62,157);g.stroke();
  // sleeves and pale hands
  g.fillStyle='#4b403a';g.beginPath();g.ellipse(30,120,13,35,-.3,0,Math.PI*2);g.ellipse(98,120,13,35,.3,0,Math.PI*2);g.fill();
  g.fillStyle='#b9a58c';g.beginPath();g.ellipse(22,151,7,13,-.25,0,Math.PI*2);g.ellipse(106,151,7,13,.25,0,Math.PI*2);g.fill();
  // face
  let face=g.createRadialGradient(55,43,4,64,53,36);face.addColorStop(0,'#ddc6a9');face.addColorStop(.8,'#a88d75');face.addColorStop(1,'#796455');g.fillStyle=face;g.beginPath();g.ellipse(64,53,26,34,0,0,Math.PI*2);g.fill();
  g.fillStyle='#292321';g.beginPath();g.ellipse(39,44,10,26,-.5,0,Math.PI*2);g.ellipse(88,43,9,25,.5,0,Math.PI*2);g.fill();
  // thin white hair streaks
  g.strokeStyle='#c2b9a8';g.lineWidth=2;for(let i=0;i<5;i++){g.beginPath();g.moveTo(43+i*7,30);g.quadraticCurveTo(53+i*4,7,67+i*4,24);g.stroke();}
  g.fillStyle='#322622';g.beginPath();g.ellipse(55,55,5,3,0,0,Math.PI*2);g.ellipse(73,55,5,3,0,0,Math.PI*2);g.fill();
  g.fillStyle='#d5b4a0';g.beginPath();g.ellipse(55,55,1.8,2,0,0,Math.PI*2);g.ellipse(73,55,1.8,2,0,0,Math.PI*2);g.fill();
  g.strokeStyle='#533d34';g.lineWidth=2;g.beginPath();g.moveTo(58,72);g.quadraticCurveTo(65,67,72,72);g.stroke();
  g.fillStyle='#ead4ba';g.fillRect(59,73,3,3);g.fillRect(65,73,3,3);
  // collar and buttons
  g.fillStyle='#d4c3a9';g.beginPath();g.moveTo(47,82);g.lineTo(64,100);g.lineTo(57,106);g.lineTo(42,88);g.fill();g.beginPath();g.moveTo(81,82);g.lineTo(64,100);g.lineTo(71,106);g.lineTo(86,88);g.fill();
  g.fillStyle='#d4bd96';for(let y=112;y<151;y+=12){g.beginPath();g.arc(64,y,2,0,Math.PI*2);g.fill();}
  return c;
}
function makeKeySprite(){const c=document.createElement('canvas');c.width=64;c.height=64;const g=c.getContext('2d');g.shadowColor='#e1bb64';g.shadowBlur=15;g.strokeStyle='#d9b866';g.lineWidth=8;g.beginPath();g.arc(21,23,12,0,Math.PI*2);g.moveTo(32,29);g.lineTo(54,50);g.lineTo(48,56);g.moveTo(45,47);g.lineTo(39,53);g.stroke();g.shadowBlur=0;return c;}
const grannySprite=makeGrannySprite(),keySprite=makeKeySprite();
function drawSprites(planeX,planeY,horizon){
  const focal=W/(2*Math.tan(FOV/2)),items=[];
  if(keyItem.active)items.push({x:keyItem.x,y:keyItem.y,img:keySprite,height:.42,type:'key'});
  items.push({x:granny.x,y:granny.y,img:grannySprite,height:1.75,type:'granny'});
  items.sort((a,b)=>{let da=(a.x-player.x)**2+(a.y-player.y)**2,db=(b.x-player.x)**2+(b.y-player.y)**2;return db-da;});
  for(const s of items){
    const dx=s.x-player.x,dy=s.y-player.y,forward=dx*Math.cos(player.angle)+dy*Math.sin(player.angle),lateral=-dx*Math.sin(player.angle)+dy*Math.cos(player.angle);
    if(forward<.15)continue;
    const sx=W/2+lateral*focal/forward;
    const sh=H*.93*s.height/forward,sw=s.type==='granny'?sh*.68:sh*.78;
    let top=horizon-sh*.5;if(s.type==='key')top=horizon-sh*.5+Math.sin(state.time*4)*sh*.09;
    const left=Math.floor(sx-sw/2),right=Math.ceil(sx+sw/2);
    if(right<0||left>=W)continue;
    for(let x=Math.max(0,left);x<Math.min(W,right);x++)if(forward<depth[x]+.04){const source=(x-left)/Math.max(1,sw)*s.img.width;ctx.drawImage(s.img,source,0,1,s.img.height,x,top,1,sh);}
    if(s.type==='granny'&&forward<5.5){const alpha=clamp((5.5-forward)/5,.08,.28);ctx.fillStyle=`rgba(190,25,18,${alpha})`;const eyeY=top+sh*.29;ctx.fillRect(sx-sw*.09,eyeY,Math.max(1,sw*.035),Math.max(1,sh*.018));ctx.fillRect(sx+sw*.055,eyeY,Math.max(1,sw*.035),Math.max(1,sh*.018));}
  }
}
function drawHands(){
  const scale=H/300,bob=Math.sin(state.bob*2)*4*scale;
  ctx.save();ctx.globalAlpha=.72;
  ctx.fillStyle='#292522';ctx.beginPath();ctx.moveTo(0,H);ctx.lineTo(0,H-38*scale+bob);ctx.quadraticCurveTo(30*scale,H-28*scale+bob,55*scale,H);ctx.fill();
  ctx.beginPath();ctx.moveTo(W,H);ctx.lineTo(W,H-38*scale-bob);ctx.quadraticCurveTo(W-30*scale,H-27*scale-bob,W-55*scale,H);ctx.fill();
  ctx.fillStyle='#a88e75';ctx.beginPath();ctx.ellipse(46*scale,H-26*scale+bob,9*scale,16*scale,-.25,0,Math.PI*2);ctx.ellipse(W-46*scale,H-27*scale-bob,9*scale,16*scale,.25,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawMap(){
  if(!state.mapOpen)return;const c=$('minimap'),g=c.getContext('2d'),cw=c.width/MW,ch=c.height/MH;g.clearRect(0,0,c.width,c.height);
  for(let y=0;y<MH;y++)for(let x=0;x<MW;x++){const cell=grid[y][x];g.fillStyle=cell===1?'#716c5e':cell===2?'#9b493c':'#24251f';g.fillRect(x*cw,y*ch,cw-1,ch-1);}
  if(keyItem.active){g.fillStyle='#e2bc6f';g.beginPath();g.arc(keyItem.x*cw,keyItem.y*ch,2.5,0,Math.PI*2);g.fill();}
  g.fillStyle='#b94b40';g.beginPath();g.arc(granny.x*cw,granny.y*ch,3.2,0,Math.PI*2);g.fill();
  g.fillStyle='#f0dfb9';g.beginPath();g.arc(player.x*cw,player.y*ch,3,0,Math.PI*2);g.fill();g.strokeStyle='#f0dfb9';g.beginPath();g.moveTo(player.x*cw,player.y*ch);g.lineTo((player.x+Math.cos(player.angle)*.8)*cw,(player.y+Math.sin(player.angle)*.8)*ch);g.stroke();
}
function findPath(sx,sy,tx,ty){
  sx=Math.floor(sx);sy=Math.floor(sy);tx=Math.floor(tx);ty=Math.floor(ty);
  if(tx<0||ty<0||tx>=MW||ty>=MH||wallAt(tx+.1,ty+.1))return [];
  const prev=new Int32Array(MW*MH).fill(-1),q=[ty*MW+tx];prev[q[0]]=q[0];
  for(let i=0;i<q.length;i++){const id=q[i],x=id%MW,y=(id/MW)|0;if(x===sx&&y===sy)break;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,n=ny*MW+nx;if(nx>=0&&ny>=0&&nx<MW&&ny<MH&&prev[n]===-1&&grid[ny][nx]===0){prev[n]=id;q.push(n);}}}
  let at=sy*MW+sx;if(prev[at]===-1)return [];const path=[];while(at!==prev[at]){at=prev[at];path.push({x:at%MW+.5,y:Math.floor(at/MW)+.5});if(path.length>MW*MH)break;}return path;
}
function hasLineOfSight(a,b){const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),steps=Math.ceil(len*8);for(let i=1;i<steps;i++)if(wallAt(a.x+dx*i/steps,a.y+dy*i/steps))return false;return true;}
function updateGranny(dt){
  const d=dist(player,granny),hearRadius=state.crouch?4.1:7.8;
  if((state.noise>.22&&d<hearRadius)||(d<3.6&&hasLineOfSight(granny,player))){state.enemyMode='chase';state.lastKnown={x:player.x,y:player.y};state.chaseTimer=state.noise>.4?7:4;}
  if(state.enemyMode==='alert'){state.chaseTimer-=dt;if(state.chaseTimer<=0)state.enemyMode='chase';}
  if(state.enemyMode==='chase'){
    state.chaseTimer-=dt;
    if(state.chaseTimer<=0&&d>7){state.enemyMode='search';state.chaseTimer=4;}
    if(state.pathTimer<=0){granny.path=findPath(granny.x,granny.y,player.x,player.y);state.pathTimer=.55;}
  }else if(state.enemyMode==='search'){
    state.chaseTimer-=dt;if(state.chaseTimer<=0){state.enemyMode='patrol';granny.path=[];}
    if(state.pathTimer<=0&&state.lastKnown){granny.path=findPath(granny.x,granny.y,state.lastKnown.x,state.lastKnown.y);state.pathTimer=.75;}
  }else{
    if(state.time>5)state.enemyMode='patrol';
    if(state.enemyMode==='patrol'&&(granny.path.length===0||granny.wander<=0)){const target=patrol[granny.patrolIndex++%patrol.length];granny.path=findPath(granny.x,granny.y,target.x,target.y);granny.wander=12;}
    granny.wander-=dt;
  }
  state.pathTimer-=dt;
  if(granny.path.length){const target=granny.path[0],dx=target.x-granny.x,dy=target.y-granny.y,len=Math.hypot(dx,dy);if(len<.12)granny.path.shift();else{const speed=state.enemyMode==='chase'?1.0:state.enemyMode==='search'?.78:.48;const step=Math.min(len,speed*dt);moveCircle(granny,dx/len*step,dy/len*step,.22);granny.angle=Math.atan2(dy,dx);granny.movePhase+=dt*7;}}
  if(d<.48&&state.running){endGame(false);}
}
function update(dt){
  if(!state.running||state.paused||state.ended)return;
  state.time+=dt;
  let forward=(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0)-joystick.y;
  let strafe=(keys.KeyD?1:0)-(keys.KeyA?1:0)+joystick.x;
  if(Math.abs(forward)>1||Math.abs(strafe)>1){const n=Math.hypot(forward,strafe);forward/=n;strafe/=n;}
  const moving=Math.abs(forward)+Math.abs(strafe)>.06,speed=state.crouch?1.12:2.08;
  const dx=(Math.cos(player.angle)*forward-Math.sin(player.angle)*strafe)*speed*dt;
  const dy=(Math.sin(player.angle)*forward+Math.cos(player.angle)*strafe)*speed*dt;
  if(moving){moveCircle(player,dx,dy);state.bob+=dt*(state.crouch?5:10);state.stepTimer-=dt;if(state.stepTimer<=0){if(!state.crouch)playTone(66+Math.random()*22,.045,.009,'triangle');state.stepTimer=state.crouch?.62:.39;}}
  const targetNoise=moving?(state.crouch?.08:.36):0;
  state.noise+=(targetNoise-state.noise)*Math.min(1,dt*3.2);
  updateGranny(dt);updateHint();updateHUD();
  if(state.doorOpen&&player.x>6.9&&player.x<8.1&&player.y>13.15)endGame(true);
}
function frame(now){const dt=Math.min(.05,(now-lastFrame)/1000||0);lastFrame=now;if(state.running&&!state.paused&&!state.ended){update(dt);renderWorld();drawMap();}else if(!state.running&&!state.ended){renderWorld();drawMap();}requestAnimationFrame(frame);}
requestAnimationFrame(frame);
function look(deltaX){player.angle+=deltaX*.0042;player.angle=(player.angle+Math.PI*4)%(Math.PI*2);}
addEventListener('keydown',e=>{
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  keys[e.code]=true;
  if(e.repeat)return;
  if(e.code==='KeyE'||e.code==='Enter')interact();
  if(e.code==='KeyM')toggleMap();
  if(e.code==='ShiftLeft'||e.code==='ShiftRight')toggleCrouch();
  if(e.code==='Escape')pauseGame();
});
addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='ShiftLeft'||e.code==='ShiftRight')toggleCrouch();});
canvas.addEventListener('pointerdown',e=>{if(!state.running||state.paused)return;pointerLook=true;lastPointerX=e.clientX;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(pointerLook&&e.buttons){const dx=e.clientX-lastPointerX;lastPointerX=e.clientX;look(dx);}});
canvas.addEventListener('pointerup',()=>{pointerLook=false;});
const stick=$('stick'),knob=$('stickKnob');let stickPointer=null;
stick.addEventListener('pointerdown',e=>{e.preventDefault();stickPointer=e.pointerId;stick.setPointerCapture(e.pointerId);updateStick(e);});
function updateStick(e){const r=stick.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=e.clientX-cx,dy=e.clientY-cy,max=32,n=Math.max(1,Math.hypot(dx,dy)/max);joystick.x=clamp(dx/n/max,-1,1);joystick.y=clamp(dy/n/max,-1,1);knob.style.transform=`translate(${joystick.x*32}px,${joystick.y*32}px)`;}
stick.addEventListener('pointermove',e=>{if(e.pointerId===stickPointer)updateStick(e);});
function releaseStick(e){if(e.pointerId!==stickPointer)return;stickPointer=null;joystick.x=joystick.y=0;knob.style.transform='translate(0,0)';}
stick.addEventListener('pointerup',releaseStick);stick.addEventListener('pointercancel',releaseStick);
$('useBtn').addEventListener('pointerdown',e=>{e.preventDefault();interact();});
$('crouchBtn').addEventListener('pointerdown',e=>{e.preventDefault();toggleCrouch();});
$('mapBtn').addEventListener('click',toggleMap);
$('soundBtn').addEventListener('click',()=>{state.sound=!state.sound;$('soundBtn').style.opacity=state.sound?'1':'.45';if(state.sound)playTone(360,.08,.04);});
$('pauseBtn').addEventListener('click',pauseGame);
$('startBtn').addEventListener('click',resetGame);
$('screen').addEventListener('click',e=>{if(e.target.id==='startBtn')resetGame();});
$('minimap').addEventListener('click',toggleMap);
// Keep the view fitted to the actual display; prevent browser gestures stealing the controls.
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.running&&!state.paused)pauseGame();});
})();
