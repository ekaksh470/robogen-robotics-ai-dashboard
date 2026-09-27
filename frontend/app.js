const API = "/api";
const mainView = document.querySelector("#mainView");
const toastNode = document.querySelector("#toast");
const sidebar = document.querySelector(".sidebar");

let activeView = "navigation-training";
let trainingData = null;
let navigationData = null;
let handData = null;
let pickupData = null;
let selectedObstacle = -1;
let editMode = "select";
let dragState = null;
let navSpeed = 1;
let toastTimer = 0;
let pollTimer = 0;
let pollBusy = false;

const viewLabels = {
  "navigation-training": ["SIMULATIONS", "NAVIGATION"],
  "navigation-playground": ["SIMULATIONS", "PLAYGROUND"],
  "hand-training": ["SIMULATIONS", "ROBOTIC HAND · ALIGNMENT"],
  "pickup-storage": ["SIMULATIONS", "ROBOTIC HAND · PICKUP & STORAGE"],
};

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  return response.json();
}

async function post(path, body) {
  return api(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

function showToast(message) {
  toastNode.textContent = message;
  toastNode.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastNode.classList.remove("visible"), 2600);
}

function setHeaderState() {
  const crumbs = viewLabels[activeView] || viewLabels["navigation-training"];
  document.querySelector("#breadcrumb").innerHTML = `${crumbs[0]} <span>/</span> ${crumbs[1]}`;
  document.querySelector("#trainingStateLabel").textContent = trainingData?.running ? "TRAINING ACTIVE" : "TRAINING PAUSED";
  document.querySelector("#modelReadyText").textContent = trainingData?.state === "complete" ? "Training complete" : "Ready for inference";
  document.querySelector("#modelQualityBar").style.width = `${Math.max(18, trainingData?.success_rate || 86)}%`;
}

function pageHeading(eyebrow, title, description, actions = "") {
  return `<section class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="page-description">${description}</p></div><div class="heading-actions">${actions}</div></section>`;
}

function metricCard(label, id, value, change, note, color = "cyan") {
  const tones = { cyan: "var(--cyan)", green: "var(--green)", blue: "var(--blue)", amber: "var(--amber)" };
  return `<article class="metric-card"><div class="metric-top"><i class="metric-accent" style="background:${tones[color]}"></i><span class="metric-label">${label}</span></div><div class="metric-main"><strong class="metric-value" id="${id}">${value}</strong><span class="metric-change" id="${id}Change" style="color:${tones[color]}">${change}</span></div><div class="metric-note" id="${id}Note">${note}</div></article>`;
}

function mapLegend(meta = "") {
  return `<div class="map-footer"><span class="map-legend"><i class="legend-dot"></i>ROBOT</span><span class="map-legend"><i class="legend-dot target"></i>TARGET</span><span class="map-legend"><i class="legend-obstacle"></i>OBSTACLE</span><span class="map-meta" id="mapMeta">${meta}</span></div>`;
}

function renderTrainingPage() {
  mainView.innerHTML = `
    ${pageHeading("TRAINING ENVIRONMENT  /  01", "AI Navigation Training", "Watch the policy learn collision-free routes through a changing world.", `<button class="button icon-only" id="resetTraining" title="Reset training" aria-label="Reset training">↺</button><button class="button primary" id="trainingToggle">Ⅱ &nbsp; Pause training</button>`)}
    <section class="metrics-grid">
      ${metricCard("EPISODE", "metricEpisode", "—", "+ live session", "Training episodes", "cyan")}
      ${metricCard("AVERAGE REWARD", "metricReward", "—", "↗ learning", "Latest episode return", "green")}
      ${metricCard("SUCCESS RATE", "metricSuccess", "—", "Rolling 100", "Goal reached without collision", "blue")}
      ${metricCard("POLICY LOSS", "metricLoss", "—", "TD error", "Mean squared update error", "amber")}
    </section>
    <section class="workspace-grid">
      <article class="panel map-panel">
        <header class="panel-heading"><div><h2>Live route learning</h2><p id="trainingMapSubtitle">Loading policy and environment…</p></div><span class="live-pill" id="trainingLivePill"><i class="status-dot"></i>LIVE EPISODE</span></header>
        <canvas class="world-canvas" id="trainingCanvas" height="300" aria-label="Robot learning a route through obstacles" title="The path is computed from the current navigation policy."></canvas>
        ${mapLegend("16 × 9 GRID · 5 OBSTACLES")}
      </article>
      <aside class="panel controls-panel">
        <header class="panel-heading"><div><h2>Training controls</h2><p>Adjust the learning run</p></div><span class="neutral-pill">DQN</span></header>
        <div class="control-group"><label class="control-label-row" for="epsilonRange"><span>Exploration rate</span><strong class="control-value" id="epsilonValue">0.72</strong></label><input id="epsilonRange" type="range" min="0.05" max="0.9" step="0.01" value="0.72" title="A higher rate tries more random actions; a lower rate follows what the policy has learned."><div class="range-notes"><span>Exploit</span><span>Explore</span></div></div>
        <div class="control-group"><label class="control-label-row" for="episodeRange"><span>Training episodes</span><strong class="control-value" id="episodeTargetValue">3,000</strong></label><input id="episodeRange" type="range" min="500" max="10000" step="500" value="3000"></div>
        <div class="training-progress"><span id="trainingProgressBar" style="width:0"></span></div><div class="progress-row"><span>TRAINING PROGRESS</span><strong id="trainingProgressValue">0%</strong></div>
        <button class="button primary control-action" id="trainingPanelToggle">Ⅱ &nbsp; Pause training</button>
        <p class="control-hint">The agent explores the grid, receives a reward for reaching the goal, and improves its policy over time.</p>
      </aside>
    </section>
    <section class="bottom-grid">
      <article class="panel"><header class="panel-heading"><div><h2>Reward signal</h2><p>Return per episode · recent training history</p></div><strong class="chart-header-value" id="rewardChartValue">—</strong></header><canvas class="chart-canvas" id="rewardChart" height="146" aria-label="Training reward chart"></canvas></article>
      <article class="panel"><header class="panel-heading"><div><h2>Recent navigation decisions</h2><p>What the policy is doing right now</p></div><span class="neutral-pill">POLICY LOG</span></header><div class="decision-list" id="trainingDecisionList"></div></article>
    </section>`;
  document.querySelector("#trainingToggle").addEventListener("click", toggleTraining);
  document.querySelector("#trainingPanelToggle").addEventListener("click", toggleTraining);
  document.querySelector("#resetTraining").addEventListener("click", async () => {
    trainingData = await post("/training/reset");
    trainingData = await post("/training/start");
    updateTrainingUI();
    showToast("Navigation training restarted");
  });
  const epsilon = document.querySelector("#epsilonRange");
  epsilon.addEventListener("input", () => document.querySelector("#epsilonValue").textContent = Number(epsilon.value).toFixed(2));
  epsilon.addEventListener("change", async () => { trainingData = await post("/training/config", { epsilon: Number(epsilon.value) }); });
  const episodes = document.querySelector("#episodeRange");
  episodes.addEventListener("input", () => document.querySelector("#episodeTargetValue").textContent = Number(episodes.value).toLocaleString());
  episodes.addEventListener("change", async () => { trainingData = await post("/training/config", { total_episodes: Number(episodes.value) }); updateTrainingUI(); });
  updateTrainingUI();
}

async function toggleTraining() {
  trainingData = await post(trainingData?.running ? "/training/pause" : "/training/start");
  updateTrainingUI();
}

function updateTrainingUI() {
  if (!trainingData || activeView !== "navigation-training") return;
  document.querySelector("#metricEpisode").textContent = Number(trainingData.episode).toLocaleString();
  document.querySelector("#metricEpisodeNote").textContent = `of ${Number(trainingData.total_episodes).toLocaleString()} episodes`;
  document.querySelector("#metricReward").textContent = signed(trainingData.average_reward, 1);
  document.querySelector("#metricSuccess").textContent = `${Number(trainingData.success_rate).toFixed(1)}%`;
  document.querySelector("#metricLoss").textContent = Number(trainingData.loss).toFixed(4);
  document.querySelector("#epsilonValue").textContent = Number(trainingData.epsilon).toFixed(2);
  document.querySelector("#epsilonRange").value = trainingData.epsilon;
  document.querySelector("#episodeTargetValue").textContent = Number(trainingData.total_episodes).toLocaleString();
  document.querySelector("#episodeRange").value = trainingData.total_episodes;
  document.querySelector("#trainingProgressBar").style.width = `${trainingData.progress}%`;
  document.querySelector("#trainingProgressValue").textContent = `${Number(trainingData.progress).toFixed(1)}%`;
  document.querySelector("#trainingMapSubtitle").textContent = `Episode ${Number(trainingData.episode).toLocaleString()} · Policy confidence ${Math.max(0, Math.min(99, trainingData.success_rate)).toFixed(0)}%`;
  const toggleText = trainingData.running ? "Ⅱ  Pause training" : "▶  Resume training";
  document.querySelector("#trainingToggle").innerHTML = toggleText;
  document.querySelector("#trainingPanelToggle").innerHTML = toggleText;
  document.querySelector("#trainingLivePill").innerHTML = `<i class="status-dot ${trainingData.running ? "" : "cyan-dot"}"></i>${trainingData.running ? "LIVE EPISODE" : trainingData.state.toUpperCase()}`;
  document.querySelector("#rewardChartValue").textContent = signed(trainingData.reward, 1);
  drawTrainingCanvas();
  drawRewardChart();
  drawTrainingDecisions();
  setHeaderState();
}

function drawTrainingCanvas() {
  const canvas = document.querySelector("#trainingCanvas");
  if (!canvas || !trainingData?.map) return;
  if (canvas._raf) cancelAnimationFrame(canvas._raf);
  const ctx = canvasContext(canvas);
  const { cols, rows, obstacles, path, start, goal } = trainingData.map;
  const cw = canvas.clientWidth / cols, ch = canvas.clientHeight / rows;
  drawGridBase(ctx, canvas.clientWidth, canvas.clientHeight, cols, rows);
  if (path?.length > 1) {
    ctx.beginPath();
    path.forEach((point, i) => { const px=(point.x+.5)*cw, py=(point.y+.5)*ch; if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py); });
    ctx.strokeStyle = "rgba(80,215,234,.76)"; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();
  }
  drawObstacles(ctx, obstacles, cw, ch);
  drawGoal(ctx, (goal.x+.5)*cw, (goal.y+.5)*ch, Math.min(cw,ch)*.2);
  const routeIndex = path?.length ? Math.floor(Date.now()/540)%path.length : 0;
  const pos = path?.[routeIndex] || start;
  drawRobot(ctx, (pos.x+.5)*cw, (pos.y+.5)*ch, Math.min(cw,ch)*.2);
  canvas._raf = requestAnimationFrame(() => { if (activeView === "navigation-training") drawTrainingCanvas(); });
}

function drawRewardChart() {
  const canvas = document.querySelector("#rewardChart");
  if (!canvas || !trainingData) return;
  const ctx = canvasContext(canvas), w=canvas.clientWidth, h=canvas.clientHeight;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle = "#172a3b"; ctx.lineWidth=1;
  for(let y=14;y<h-5;y+=26){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const values=(trainingData.history||[]).map(item=>Number(item.reward));
  if (!values.length) return;
  const min=Math.min(-5,...values), max=Math.max(5,...values), span=Math.max(1,max-min);
  const step=w/Math.max(values.length,1), base=h-8;
  values.forEach((value,i)=>{
    const barH=Math.max(3,((value-min)/span)*(h-25));
    ctx.fillStyle=i>values.length*.78?"rgba(80,215,234,.92)":"rgba(39,122,145,.62)";
    roundRect(ctx,i*step+1,base-barH,Math.max(2,step-4),barH,4);ctx.fill();
  });
}

function drawTrainingDecisions() {
  const node=document.querySelector("#trainingDecisionList");
  if(!node)return;
  const decisions=[
    [clockNow(),"Route updated",`${trainingData.map?.path?.length||0} planned cells`,""],
    [clockNow(),"Reward received",`${signed(trainingData.reward,1)} · goal proximity`,"green"],
    [clockNow(),"Policy update",`ε ${Number(trainingData.epsilon).toFixed(2)} · loss ${Number(trainingData.loss).toFixed(3)}`,"blue"],
  ];
  node.innerHTML=decisions.map(row=>`<div class="decision-row"><i class="decision-dot ${row[3]}"></i><time class="decision-time">${row[0]}</time><strong class="decision-action">${row[1]}</strong><span class="decision-detail">${row[2]}</span></div>`).join("");
}

function renderNavigationPage() {
  mainView.innerHTML = `
    ${pageHeading("INTERACTIVE SIMULATION  /  02", "Robot Navigation Playground", "Edit the environment, then watch the robot plan and follow a safe route.", `<button class="button" id="navReset">↺ &nbsp; Reset</button><button class="button primary" id="navRunToggle">▶ &nbsp; Start simulation</button>`)}
    <section class="editor-layout">
      <article class="panel editor-panel">
        <header class="panel-heading"><div><h2>2D environment</h2><p id="navMapSummary">Click to edit the environment</p></div><div class="toolbar"><button class="tool-button active" id="toolSelect">↖ &nbsp; Select</button><button class="tool-button" id="toolObstacle">＋ &nbsp; Add obstacle</button><button class="tool-button" id="removeObstacle">⌫ &nbsp; Remove</button></div></header>
        <canvas class="world-canvas" id="navigationCanvas" height="430" aria-label="Editable robot navigation grid" title="Drag the robot, goal, or an obstacle. Drag an obstacle corner to resize it."></canvas>
        ${mapLegend("Drag robot, goal, or blocks · drag block corner to resize")}
      </article>
      <aside class="editor-side">
        <section class="control-card"><h3>Environment presets</h3><p>Load a ready-made challenge to explore path planning.</p><div class="preset-grid"><button class="preset-choice" data-preset="training-arena">▦ &nbsp; Training arena</button><button class="preset-choice" data-preset="corridor">↔ &nbsp; Narrow corridors</button><button class="preset-choice" data-preset="open-lab">⌂ &nbsp; Open lab</button></div></section>
        <section class="control-card"><h3>Map size &amp; speed</h3><p>Change the grid dimensions or simulation tempo.</p><div class="control-pair"><label class="size-control">Columns <strong id="colsValue">16</strong><input id="colsRange" type="range" min="8" max="24" value="16"></label><label class="size-control">Rows <strong id="rowsValue">9</strong><input id="rowsRange" type="range" min="7" max="16" value="9"></label></div><label class="size-control" style="margin-top:14px">Simulation speed <strong id="navSpeedValue">1.0×</strong><input id="navSpeedRange" type="range" min="0.25" max="2.5" step="0.25" value="1"></label></section>
        <section class="control-card"><h3>Navigation status</h3><div class="pill-row"><span class="neutral-pill" id="collisionStatus">ROUTE CLEAR</span><span class="neutral-pill"><span id="navDistance">—</span> CELLS</span></div><p id="navStatusText" style="margin:12px 0 0">Ready to navigate</p><div class="decision-log" id="navDecisionLog"></div></section>
        <p class="editor-help">Tip: select an obstacle and drag its lower-right corner to resize it. Press Delete to remove a selected block.</p>
      </aside>
    </section>`;
  bindNavigationControls();
  updateNavigationUI();
}

function bindNavigationControls() {
  document.querySelector("#navRunToggle").addEventListener("click", async () => {
    navigationData=await post(navigationData?.running?"/navigation/pause":"/navigation/start"); updateNavigationUI();
  });
  document.querySelector("#navReset").addEventListener("click", async () => { navigationData=await post("/navigation/reset"); selectedObstacle=-1; updateNavigationUI(); showToast("Environment reset"); });
  document.querySelectorAll("[data-preset]").forEach(button=>button.addEventListener("click",async()=>{navigationData=await post(`/navigation/preset/${button.dataset.preset}`);selectedObstacle=-1;editMode="select";updateNavigationUI();showToast(`${button.textContent.trim()} loaded`);}));
  document.querySelector("#toolSelect").addEventListener("click",()=>setEditMode("select"));
  document.querySelector("#toolObstacle").addEventListener("click",()=>setEditMode("obstacle"));
  document.querySelector("#removeObstacle").addEventListener("click",removeSelectedObstacle);
  const cols=document.querySelector("#colsRange"), rows=document.querySelector("#rowsRange");
  cols.value=navigationData?.cols||16; rows.value=navigationData?.rows||9;
  cols.addEventListener("input",()=>document.querySelector("#colsValue").textContent=cols.value);
  rows.addEventListener("input",()=>document.querySelector("#rowsValue").textContent=rows.value);
  const updateSize=async()=>{
    if(!navigationData)return;
    const oldCols=navigationData.cols,oldRows=navigationData.rows;
    const nextCols=Number(cols.value),nextRows=Number(rows.value);
    navigationData.cols=nextCols;navigationData.rows=nextRows;
    navigationData.obstacles=navigationData.obstacles.map(item=>({...item,x:Math.min(item.x,nextCols-1),y:Math.min(item.y,nextRows-1),w:Math.min(item.w,nextCols-Math.min(item.x,nextCols-1)),h:Math.min(item.h,nextRows-Math.min(item.y,nextRows-1))}));
    navigationData.robot={x:Math.min(navigationData.robot.x,nextCols-1),y:Math.min(navigationData.robot.y,nextRows-1)};
    navigationData.goal={x:Math.min(navigationData.goal.x,nextCols-1),y:Math.min(navigationData.goal.y,nextRows-1)};
    void oldCols;void oldRows;await saveNavigation();
  };
  cols.addEventListener("change",updateSize);rows.addEventListener("change",updateSize);
  const speed=document.querySelector("#navSpeedRange");speed.value=navSpeed;document.querySelector("#navSpeedValue").textContent=`${navSpeed.toFixed(1)}×`;speed.addEventListener("input",()=>{navSpeed=Number(speed.value);document.querySelector("#navSpeedValue").textContent=`${navSpeed.toFixed(1)}×`;resetPollTimer();});
  bindNavigationCanvas();
}

function setEditMode(mode) {
  editMode=mode;
  document.querySelector("#toolSelect").classList.toggle("active",mode==="select");
  document.querySelector("#toolObstacle").classList.toggle("active",mode==="obstacle");
  const canvas=document.querySelector("#navigationCanvas");if(canvas)canvas.style.cursor=mode==="obstacle"?"crosshair":"grab";
}

function bindNavigationCanvas() {
  const canvas=document.querySelector("#navigationCanvas");if(!canvas)return;
  canvas.style.cursor=editMode==="obstacle"?"crosshair":"grab";
  canvas.addEventListener("pointerdown",event=>{
    if(!navigationData)return;
    const pos=canvasCell(canvas,event,navigationData);
    if(editMode==="obstacle"){
      if(pos.x===navigationData.robot.x&&pos.y===navigationData.robot.y||pos.x===navigationData.goal.x&&pos.y===navigationData.goal.y)return;
      const occupied=navigationData.obstacles.some(item=>pos.x>=item.x&&pos.x<item.x+item.w&&pos.y>=item.y&&pos.y<item.y+item.h);
      if(!occupied){navigationData.obstacles.push({x:pos.x,y:pos.y,w:1,h:1});selectedObstacle=navigationData.obstacles.length-1;void saveNavigation();showToast("Obstacle added");}
      return;
    }
    const hit=hitNavigationItem(canvas,event,navigationData);
    if(!hit){selectedObstacle=-1;drawNavigationCanvas();return;}
    if(hit.type==="obstacle")selectedObstacle=hit.index;
    const item=hit.type==="obstacle"?navigationData.obstacles[hit.index]:navigationData[hit.type];
    const cell=canvasCell(canvas,event,navigationData);
    const rect=canvas.getBoundingClientRect(),cw=rect.width/navigationData.cols,ch=rect.height/navigationData.rows;
    const resize=hit.type==="obstacle"&&event.offsetX>=(item.x+item.w)*cw-11&&event.offsetY>=(item.y+item.h)*ch-11;
    dragState={type:hit.type,index:hit.index,resize,anchor:cell,origin:{...item},offset:{x:cell.x-item.x,y:cell.y-item.y}};
    canvas.setPointerCapture(event.pointerId);canvas.style.cursor=resize?"nwse-resize":"grabbing";
  });
  canvas.addEventListener("pointermove",event=>{
    if(!dragState||!navigationData)return;
    const cell=canvasCell(canvas,event,navigationData),d=dragState;
    if(d.type==="obstacle"){
      const item=navigationData.obstacles[d.index];if(!item)return;
      if(d.resize){item.w=Math.max(1,Math.min(navigationData.cols-d.origin.x,d.origin.w+cell.x-d.anchor.x));item.h=Math.max(1,Math.min(navigationData.rows-d.origin.y,d.origin.h+cell.y-d.anchor.y));}
      else{item.x=Math.max(0,Math.min(navigationData.cols-item.w,cell.x-d.offset.x));item.y=Math.max(0,Math.min(navigationData.rows-item.h,cell.y-d.offset.y));}
    }else{navigationData[d.type]={x:cell.x,y:cell.y};}
    drawNavigationCanvas();
  });
  const endDrag=async()=>{if(!dragState)return;dragState=null;canvas.style.cursor="grab";await saveNavigation();};
  canvas.addEventListener("pointerup",endDrag);canvas.addEventListener("pointercancel",endDrag);
}

function hitNavigationItem(canvas,event,data) {
  const cell=canvasCell(canvas,event,data);
  for(let i=data.obstacles.length-1;i>=0;i--){const item=data.obstacles[i];if(cell.x>=item.x&&cell.x<item.x+item.w&&cell.y>=item.y&&cell.y<item.y+item.h)return {type:"obstacle",index:i};}
  if(cell.x===data.robot.x&&cell.y===data.robot.y)return {type:"robot"};
  if(cell.x===data.goal.x&&cell.y===data.goal.y)return {type:"goal"};
  return null;
}

function canvasCell(canvas,event,data) {
  const r=canvas.getBoundingClientRect();
  return {x:clamp(Math.floor((event.clientX-r.left)/r.width*data.cols),0,data.cols-1),y:clamp(Math.floor((event.clientY-r.top)/r.height*data.rows),0,data.rows-1)};
}

async function removeSelectedObstacle() {
  if(selectedObstacle<0||!navigationData?.obstacles[selectedObstacle]){showToast("Select an obstacle first");return;}
  navigationData.obstacles.splice(selectedObstacle,1);selectedObstacle=-1;await saveNavigation();showToast("Obstacle removed");
}

async function saveNavigation() {
  if(!navigationData)return;
  navigationData=await post("/navigation/config",{cols:navigationData.cols,rows:navigationData.rows,robot:navigationData.robot,goal:navigationData.goal,obstacles:navigationData.obstacles,preset:"custom"});
  updateNavigationUI();
}

function updateNavigationUI() {
  if(!navigationData||activeView!=="navigation-playground")return;
  const cols=document.querySelector("#colsRange"),rows=document.querySelector("#rowsRange");if(cols){cols.value=navigationData.cols;document.querySelector("#colsValue").textContent=navigationData.cols;}if(rows){rows.value=navigationData.rows;document.querySelector("#rowsValue").textContent=navigationData.rows;}
  document.querySelector("#navMapSummary").textContent=`${navigationData.cols} × ${navigationData.rows} grid · ${navigationData.obstacles.length} obstacles · ${navigationData.path.length?navigationData.path.length-1:"No route"} steps`;
  document.querySelector("#navRunToggle").innerHTML=navigationData.running?"Ⅱ &nbsp; Pause simulation":"▶ &nbsp; Start simulation";
  document.querySelector("#collisionStatus").textContent=navigationData.collision?"COLLISION RISK":navigationData.path.length?"ROUTE CLEAR":"NO PATH";
  document.querySelector("#collisionStatus").className=navigationData.collision||!navigationData.path.length?"warning-pill":"live-pill";
  document.querySelector("#navDistance").textContent=navigationData.path.length?navigationData.path.length-1:"—";
  document.querySelector("#navStatusText").textContent=navigationData.at_goal?"Destination reached · episode complete":navigationData.running?`Moving ${directionFromPath(navigationData.path)} toward the goal`:navigationData.collision?"Robot is blocked by an obstacle":"Ready to navigate";
  document.querySelector("#navDecisionLog").innerHTML=(navigationData.decisions||[]).slice(0,3).map(message=>`<div class="decision-log-item"><i class="decision-dot"></i><span>${message}</span></div>`).join("");
  document.querySelector("#mapMeta").textContent=`${navigationData.cols} × ${navigationData.rows} GRID · ${navigationData.obstacles.length} BLOCKS`;
  drawNavigationCanvas();
}

function directionFromPath(path) {
  if(!path||path.length<2)return "";
  const a=path[0],b=path[1];return b.x>a.x?"east":b.x<a.x?"west":b.y>a.y?"south":"north";
}

function drawNavigationCanvas() {
  const canvas=document.querySelector("#navigationCanvas");if(!canvas||!navigationData)return;
  const ctx=canvasContext(canvas),w=canvas.clientWidth,h=canvas.clientHeight,cw=w/navigationData.cols,ch=h/navigationData.rows;
  drawGridBase(ctx,w,h,navigationData.cols,navigationData.rows);
  if(navigationData.path?.length>1){ctx.beginPath();navigationData.path.forEach((p,i)=>{const x=(p.x+.5)*cw,y=(p.y+.5)*ch;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.strokeStyle="rgba(80,215,234,.75)";ctx.lineWidth=2.5;ctx.lineJoin="round";ctx.setLineDash([7,5]);ctx.stroke();ctx.setLineDash([]);}
  drawObstacles(ctx,navigationData.obstacles,cw,ch);
  navigationData.obstacles.forEach((item,index)=>{if(index===selectedObstacle){const x=item.x*cw+2,y=item.y*ch+2,ww=item.w*cw-4,hh=item.h*ch-4;ctx.strokeStyle="#50d7ea";ctx.lineWidth=1.5;ctx.strokeRect(x,y,ww,hh);ctx.fillStyle="#50d7ea";ctx.fillRect(x+ww-7,y+hh-7,8,8);}});
  drawGoal(ctx,(navigationData.goal.x+.5)*cw,(navigationData.goal.y+.5)*ch,Math.min(cw,ch)*.23);
  drawRobot(ctx,(navigationData.robot.x+.5)*cw,(navigationData.robot.y+.5)*ch,Math.min(cw,ch)*.23);
}

function renderHandTrainingPage() {
  mainView.innerHTML=`
    ${pageHeading("MANIPULATION TRAINING  /  03","Robotic Hand · Vertical Training","Train the hand to line up with an object before it attempts a grasp.",`<button class="button" id="handReset">↺ &nbsp; Reset</button><button class="button primary" id="handToggle">▶ &nbsp; Start training</button>`)}
    <section class="hand-stats">${miniStat("SUCCESSFUL ALIGNMENTS","handAlignments","0","var(--green)")}${miniStat("LATEST REWARD","handReward","0.00","var(--cyan)")}${miniStat("TRAINING EPISODES","handEpisodes","0","var(--blue)")}</section>
    <section class="hand-layout">
      <article class="panel hand-stage"><header class="panel-heading"><div><h2>Vertical alignment environment</h2><p id="handStageSubtitle">Hand is waiting below the object</p></div><span class="live-pill" id="handLivePill"><i class="status-dot"></i>ALIGNMENT READY</span></header><canvas id="handCanvas" class="world-canvas" height="370" aria-label="Robotic hand aligned vertically with a target object"></canvas>${mapLegend("Y-AXIS MOVEMENT · RANGE 0.0–1.0")}</article>
      <aside class="panel controls-panel"><header class="panel-heading"><div><h2>Training setup</h2><p>Shape the alignment task</p></div></header>
        <div class="control-group"><label class="control-label-row" for="objectHeight"><span>Object height</span><strong class="control-value" id="objectHeightValue">0.68</strong></label><input id="objectHeight" type="range" min="0.12" max="0.9" step="0.01" value="0.68"><div class="range-notes"><span>Low</span><span>High</span></div></div>
        <div class="control-group"><label class="control-label-row" for="handSpeed"><span>Hand speed</span><strong class="control-value" id="handSpeedValue">0.055</strong></label><input id="handSpeed" type="range" min="0.015" max="0.16" step="0.005" value="0.055"></div>
        <div class="control-group"><label class="control-label-row" for="handDifficulty"><span>Training difficulty</span></label><select class="control-select" id="handDifficulty"><option value="easy">Easy · stable target</option><option value="standard" selected>Standard · slight drift</option><option value="hard">Hard · moving target</option></select></div>
        <div class="control-pair"><span class="neutral-pill">REWARD SHAPING</span><span class="neutral-pill">POSITION ERROR</span></div>
        <button class="button primary control-action" id="handPanelToggle">▶ &nbsp; Start training</button><p class="control-hint">The hand earns a positive reward as it closes the vertical gap. Hard mode adds small target drift.</p>
      </aside>
    </section>
    <section class="bottom-grid"><article class="panel"><header class="panel-heading"><div><h2>Training performance</h2><p>Alignment reward over recent movements</p></div><strong class="chart-header-value" id="handAverageReward">—</strong></header><canvas id="handRewardChart" class="chart-canvas" height="146" aria-label="Hand alignment reward chart"></canvas></article><article class="panel"><header class="panel-heading"><div><h2>How alignment reward works</h2></div><span class="neutral-pill">BEGINNER GUIDE</span></header><div class="decision-list"><div class="decision-row"><i class="decision-dot"></i><span class="decision-time">01</span><strong class="decision-action">Observe</strong><span class="decision-detail">Estimate the object height on the Y axis.</span></div><div class="decision-row"><i class="decision-dot blue"></i><span class="decision-time">02</span><strong class="decision-action">Move</strong><span class="decision-detail">Adjust the hand position by its learned speed.</span></div><div class="decision-row"><i class="decision-dot green"></i><span class="decision-time">03</span><strong class="decision-action">Align</strong><span class="decision-detail">Earn reward when the hand reaches the target zone.</span></div></div></article></section>`;
  document.querySelector("#handToggle").addEventListener("click",toggleHandTraining);document.querySelector("#handPanelToggle").addEventListener("click",toggleHandTraining);
  document.querySelector("#handReset").addEventListener("click",async()=>{handData=await post("/hand/training/reset");updateHandUI();showToast("Hand training reset");});
  const height=document.querySelector("#objectHeight"),speed=document.querySelector("#handSpeed"),difficulty=document.querySelector("#handDifficulty");
  height.value=handData?.object_height??.68;speed.value=handData?.speed??.055;difficulty.value=handData?.difficulty??"standard";
  height.addEventListener("input",()=>{document.querySelector("#objectHeightValue").textContent=Number(height.value).toFixed(2);if(handData){handData.object_height=Number(height.value);drawHandCanvas();}});
  speed.addEventListener("input",()=>document.querySelector("#handSpeedValue").textContent=Number(speed.value).toFixed(3));
  const saveHandConfig=async()=>{handData=await post("/hand/training/config",{object_height:Number(height.value),speed:Number(speed.value),difficulty:difficulty.value});updateHandUI();};
  height.addEventListener("change",saveHandConfig);speed.addEventListener("change",saveHandConfig);difficulty.addEventListener("change",saveHandConfig);
  updateHandUI();
}

function miniStat(label,id,value,color){return `<article class="mini-stat"><span>${label}</span><strong id="${id}" style="color:${color}">${value}</strong></article>`;}

async function toggleHandTraining(){handData=await post(handData?.running?"/hand/training/pause":"/hand/training/start");updateHandUI();}

function updateHandUI(){
  if(!handData||activeView!=="hand-training")return;
  document.querySelector("#handAlignments").textContent=Number(handData.alignments).toLocaleString();document.querySelector("#handReward").textContent=Number(handData.reward).toFixed(2);document.querySelector("#handEpisodes").textContent=Number(handData.episodes).toLocaleString();
  document.querySelector("#objectHeight").value=handData.object_height;document.querySelector("#objectHeightValue").textContent=Number(handData.object_height).toFixed(2);document.querySelector("#handSpeed").value=handData.speed;document.querySelector("#handSpeedValue").textContent=Number(handData.speed).toFixed(3);document.querySelector("#handDifficulty").value=handData.difficulty;
  const label=handData.running?"Ⅱ  Pause training":"▶  Start training";document.querySelector("#handToggle").innerHTML=label;document.querySelector("#handPanelToggle").innerHTML=label;
  document.querySelector("#handStageSubtitle").textContent=handData.alignments?`${handData.alignments} successful alignments · object at Y ${Number(handData.object_height).toFixed(2)}`:"Hand is moving toward the object height";
  document.querySelector("#handLivePill").innerHTML=`<i class="status-dot ${handData.running?"":"cyan-dot"}"></i>${handData.running?"TRAINING LIVE":"ALIGNMENT READY"}`;document.querySelector("#handAverageReward").textContent=Number(handData.average_reward).toFixed(2);
  drawHandCanvas();drawSparkline(document.querySelector("#handRewardChart"),handData.history,"#50d7ea");setHeaderState();
}

function drawHandCanvas(){
  const canvas=document.querySelector("#handCanvas");if(!canvas||!handData)return;
  const ctx=canvasContext(canvas),w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);drawGridBase(ctx,w,h,12,8);
  const axisX=w*.5,top=28,bottom=h-28,scale=bottom-top;
  ctx.strokeStyle="#456075";ctx.lineWidth=5;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(axisX,top);ctx.lineTo(axisX,bottom);ctx.stroke();
  ctx.fillStyle="#23384a";ctx.fillRect(axisX-34,top-7,68,14);ctx.fillRect(axisX-34,bottom-7,68,14);
  const objectY=bottom-handData.object_height*scale,handY=bottom-handData.hand_y*scale;
  ctx.setLineDash([4,5]);ctx.strokeStyle="rgba(92,224,160,.5)";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(axisX-100,objectY);ctx.lineTo(axisX+100,objectY);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle="#5ce0a0";ctx.beginPath();ctx.arc(axisX,objectY,10,0,Math.PI*2);ctx.fill();ctx.fillStyle="#c6ffdc";ctx.beginPath();ctx.arc(axisX,objectY,4,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#50d7ea";ctx.strokeStyle="#15465a";ctx.lineWidth=2;roundRect(ctx,axisX-30,handY-9,60,19,6);ctx.fill();ctx.stroke();
  ctx.fillStyle="#85e9f5";ctx.fillRect(axisX-23,handY+8,7,19);ctx.fillRect(axisX-3,handY+8,7,23);ctx.fillRect(axisX+17,handY+8,7,19);
  ctx.fillStyle="#8295a8";ctx.font="10px Inter, Segoe UI, sans-serif";ctx.textAlign="left";ctx.fillText("Y 1.0",14,top+3);ctx.fillText("Y 0.0",14,bottom+4);
  ctx.textAlign="right";ctx.fillStyle="#5ce0a0";ctx.fillText(`OBJECT  ${Number(handData.object_height).toFixed(2)}`,w-14,objectY-10);ctx.fillStyle="#50d7ea";ctx.fillText(`HAND  ${Number(handData.hand_y).toFixed(2)}`,w-14,handY-13);
}

function renderPickupPage(){
  mainView.innerHTML=`
    ${pageHeading("AUTONOMOUS MANIPULATION  /  04","Robotic Hand · Pickup & Storage","Follow the hand as it detects, grasps, and sorts objects into storage.",`<button class="button" id="pickupReset">↺ &nbsp; Reset</button><button class="button primary" id="pickupToggle">▶ &nbsp; Start simulation</button>`)}
    <section class="metrics-grid">${metricCard("SUCCESSFUL PICKUPS","pickupSuccess","0","Completed","Grasps stored successfully","green")}${metricCard("FAILED ATTEMPTS","pickupFailed","0","Recovery enabled","Grip retries logged","amber")}${metricCard("AVG. COMPLETION TIME","pickupAverage","—","Per object","Detection to storage","blue")}${metricCard("OBJECTS STORED","pickupStored","0 / 6","Storage bins","Objects placed safely","cyan")}</section>
    <section class="object-layout">
      <article class="panel object-stage"><header class="panel-heading"><div><h2>Pickup and storage workspace</h2><p id="pickupSubtitle">Six objects with different sizes and weights</p></div><span class="live-pill" id="pickupPill"><i class="status-dot"></i>READY</span></header><canvas id="pickupCanvas" class="world-canvas" height="365" aria-label="Robotic hand sorting objects into storage bins"></canvas><div class="map-footer object-key"><span><i style="background:#50d7ea"></i>LIGHT</span><span><i style="background:#a77cff"></i>MEDIUM</span><span><i style="background:#ffc56a"></i>HEAVY</span><span class="map-meta">DETECT → ALIGN → PICK → STORE</span></div></article>
      <aside class="panel log-panel"><header class="panel-heading"><div><h2>Live action log</h2><p>Every decision is captured as it happens.</p></div><span class="neutral-pill">EVENT STREAM</span></header><div class="log-feed" id="pickupLog"></div></aside>
    </section>
    <section class="bottom-grid"><article class="panel"><header class="panel-heading"><div><h2>Object queue</h2><p>Dimensions and estimated mass for each item.</p></div><span class="neutral-pill" id="queueCount">6 OBJECTS</span></header><div id="objectQueue" class="decision-list"></div></article><article class="panel"><header class="panel-heading"><div><h2>Grasp sequence</h2><p>Four simple stages, with recovery on a missed grasp.</p></div></header><div class="decision-list"><div class="decision-row"><i class="decision-dot"></i><span class="decision-time">01</span><strong class="decision-action">Detect</strong><span class="decision-detail">Locate the next object and estimate its size.</span></div><div class="decision-row"><i class="decision-dot blue"></i><span class="decision-time">02</span><strong class="decision-action">Align</strong><span class="decision-detail">Move the hand to the grasp pose.</span></div><div class="decision-row"><i class="decision-dot green"></i><span class="decision-time">03</span><strong class="decision-action">Pick</strong><span class="decision-detail">Adjust grip force to the object weight.</span></div><div class="decision-row"><i class="decision-dot green"></i><span class="decision-time">04</span><strong class="decision-action">Store</strong><span class="decision-detail">Place the object in the next open bin.</span></div></div></article></section>`;
  document.querySelector("#pickupToggle").addEventListener("click",togglePickup);document.querySelector("#pickupReset").addEventListener("click",async()=>{pickupData=await post("/pickup/reset");updatePickupUI();showToast("Pickup simulation reset");});updatePickupUI();
}

async function togglePickup(){pickupData=await post(pickupData?.running?"/pickup/pause":"/pickup/start");updatePickupUI();}

function updatePickupUI(){
  if(!pickupData||activeView!=="pickup-storage")return;
  document.querySelector("#pickupSuccess").textContent=pickupData.successful_pickups;document.querySelector("#pickupFailed").textContent=pickupData.failed_attempts;document.querySelector("#pickupAverage").textContent=pickupData.average_completion_time?`${pickupData.average_completion_time.toFixed(1)}s`:"—";document.querySelector("#pickupStored").textContent=`${pickupData.objects_stored} / ${pickupData.objects.length}`;
  document.querySelector("#pickupToggle").innerHTML=pickupData.running?"Ⅱ &nbsp; Pause simulation":"▶ &nbsp; Start simulation";document.querySelector("#pickupPill").innerHTML=`<i class="status-dot ${pickupData.running?"":"cyan-dot"}"></i>${pickupData.running?"AUTONOMY ACTIVE":"READY"}`;document.querySelector("#pickupSubtitle").textContent=`Target ${pickupData.current_id} · detect, align, pick, then store`;
  document.querySelector("#pickupLog").innerHTML=(pickupData.log||[]).map(item=>`<div class="log-item"><time>${item.time}</time><span class="${item.kind}">${item.message}</span></div>`).join("");
  document.querySelector("#queueCount").textContent=`${pickupData.objects.filter(item=>!item.stored).length} IN QUEUE`;
  document.querySelector("#objectQueue").innerHTML=pickupData.objects.map(item=>`<div class="decision-row"><i class="decision-dot ${item.stored?"green":""}" style="background:${item.stored?"var(--green)":objectColor(item.color)}"></i><span class="decision-time">${item.id}</span><strong class="decision-action">${item.label}</strong><span class="decision-detail">Size ${item.size} · ${item.weight.toFixed(2)} kg · ${item.stored?"stored":"waiting"}</span></div>`).join("");
  drawPickupCanvas();setHeaderState();
}

function drawPickupCanvas(){
  const canvas=document.querySelector("#pickupCanvas");if(!canvas||!pickupData)return;
  const ctx=canvasContext(canvas),w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);drawGridBase(ctx,w,h,12,8);
  const floor=h*.79;ctx.fillStyle="#152639";ctx.fillRect(0,floor,w,h-floor);ctx.strokeStyle="#355066";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,floor);ctx.lineTo(w,floor);ctx.stroke();
  const binW=Math.min(58,w*.105),binGap=8,startX=w-binW*4-binGap*3-15,binY=h*.36,binH=h*.38;
  for(let i=0;i<4;i++){const x=startX+i*(binW+binGap);ctx.fillStyle="#132638";ctx.strokeStyle="#416075";ctx.lineWidth=1.4;ctx.fillRect(x,binY,binW,binH);ctx.strokeRect(x,binY,binW,binH);ctx.fillStyle="#8295a8";ctx.font="9px Inter, Segoe UI, sans-serif";ctx.textAlign="center";ctx.fillText(`BIN ${i+1}`,x+binW/2,binY+binH+15);}
  pickupData.objects.filter(item=>item.stored).forEach((item,index)=>{const bin=index%4,stack=Math.floor(index/4),x=startX+bin*(binW+binGap)+binW/2,y=binY+binH-14-stack*18;ctx.fillStyle=objectColor(item.color);roundRect(ctx,x-8,y-8,16,16,4);ctx.fill();});
  const target=pickupData.objects.find(item=>item.id===pickupData.current_id);
  pickupData.objects.forEach(item=>{
    if(item.stored)return;
    const x=item.x*w,y=floor-(item.y*.37*h),size=item.size==="S"?13:item.size==="M"?20:27;
    if(item.id===pickupData.current_id){ctx.strokeStyle="rgba(80,215,234,.7)";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,size+10,0,Math.PI*2);ctx.stroke();}
    ctx.fillStyle=objectColor(item.color);roundRect(ctx,x-size/2,y-size/2,size,size,Math.min(6,size/4));ctx.fill();ctx.fillStyle="#d9e7ef";ctx.font="9px Inter, Segoe UI, sans-serif";ctx.textAlign="center";ctx.fillText(item.id.slice(-2),x,y+size/2+13);
  });
  const current=target||pickupData.objects[0];const armX=current?current.x*w:w*.27,handY=pickupData.phase>=2?floor-28:Math.max(36,floor-(current?.y||.35)*.37*h-70);
  ctx.strokeStyle="#294358";ctx.lineWidth=8;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(armX,10);ctx.lineTo(armX,handY);ctx.stroke();ctx.fillStyle="#50d7ea";ctx.beginPath();ctx.arc(armX,handY,10,0,Math.PI*2);ctx.fill();ctx.fillStyle="#081521";ctx.fillRect(armX-10,handY+7,4,14);ctx.fillRect(armX+6,handY+7,4,14);
  ctx.textAlign="left";ctx.font="10px Inter, Segoe UI, sans-serif";ctx.fillStyle="#8295a8";ctx.fillText(pickupData.running?`ACTION ${["DETECT","ALIGN","PICK","STORE"][pickupData.phase]}`:"AUTONOMY STANDBY",14,20);
}

function objectColor(name){return ({cyan:"#50d7ea",violet:"#a77cff",amber:"#ffc56a",green:"#5ce0a0",rose:"#ff7b91",blue:"#539bff"})[name]||"#50d7ea";}

function canvasContext(canvas){
  const dpr=window.devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);return ctx;
}

function drawGridBase(ctx,w,h,cols,rows){
  ctx.clearRect(0,0,w,h);ctx.fillStyle="#081521";ctx.fillRect(0,0,w,h);ctx.strokeStyle="#172a3b";ctx.lineWidth=1;
  for(let c=1;c<cols;c++){const x=c*w/cols;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for(let r=1;r<rows;r++){const y=r*h/rows;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
}

function drawObstacles(ctx,obstacles,cw,ch){
  (obstacles||[]).forEach(item=>{const x=item.x*cw+3,y=item.y*ch+3,w=Math.max(4,item.w*cw-6),h=Math.max(4,item.h*ch-6);ctx.fillStyle="#33475a";ctx.strokeStyle="#53697c";ctx.lineWidth=1;roundRect(ctx,x,y,w,h,6);ctx.fill();ctx.stroke();});
}

function drawRobot(ctx,x,y,r){ctx.fillStyle="rgba(23,59,75,.95)";ctx.beginPath();ctx.arc(x,y,r*1.9,0,Math.PI*2);ctx.fill();ctx.fillStyle="#50d7ea";ctx.beginPath();ctx.arc(x,y,r*.85,0,Math.PI*2);ctx.fill();ctx.fillStyle="#07111b";ctx.beginPath();ctx.arc(x+r*.22,y-r*.1,r*.2,0,Math.PI*2);ctx.fill();}
function drawGoal(ctx,x,y,r){ctx.fillStyle="rgba(24,58,49,.9)";ctx.beginPath();ctx.arc(x,y,r*1.7,0,Math.PI*2);ctx.fill();ctx.fillStyle="#5ce0a0";ctx.beginPath();ctx.arc(x,y,r*.7,0,Math.PI*2);ctx.fill();}
function roundRect(ctx,x,y,w,h,r){const radius=Math.max(0,Math.min(r,w/2,h/2));ctx.beginPath();ctx.moveTo(x+radius,y);ctx.arcTo(x+w,y,x+w,y+h,radius);ctx.arcTo(x+w,y+h,x,y+h,radius);ctx.arcTo(x,y+h,x,y,radius);ctx.arcTo(x,y,x+w,y,radius);ctx.closePath();}

function drawSparkline(canvas,values,color){
  if(!canvas)return;const ctx=canvasContext(canvas),w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);ctx.strokeStyle="#172a3b";ctx.lineWidth=1;for(let y=15;y<h;y+=26){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const data=(values||[]).slice(-42);if(data.length<2)return;const min=Math.min(...data),max=Math.max(...data),span=Math.max(.1,max-min);ctx.beginPath();data.forEach((v,i)=>{const x=i/(data.length-1)*w,y=h-8-(v-min)/span*(h-22);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.strokeStyle=color;ctx.lineWidth=2.4;ctx.lineJoin="round";ctx.stroke();
}

function signed(value,digits=1){const n=Number(value)||0;return `${n>0?"+":""}${n.toFixed(digits)}`;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function clockNow(){return new Date().toLocaleTimeString("en-GB",{hour12:false});}

async function switchView(name){
  activeView=name;sidebar.classList.remove("open");document.querySelectorAll(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view===name));
  if(name==="navigation-training")renderTrainingPage();
  if(name==="navigation-playground"){navigationData=await api("/navigation");renderNavigationPage();}
  if(name==="hand-training"){handData=await api("/hand/training");renderHandTrainingPage();}
  if(name==="pickup-storage"){pickupData=await api("/pickup");renderPickupPage();}
  setHeaderState();mainView.focus({preventScroll:true});resetPollTimer();
}

document.querySelectorAll(".nav-item").forEach(button=>button.addEventListener("click",()=>switchView(button.dataset.view)));
document.querySelector("#mobileMenu").addEventListener("click",()=>sidebar.classList.toggle("open"));
document.addEventListener("keydown",event=>{if(event.key==="Delete"||event.key==="Backspace"){if(activeView==="navigation-playground"&&document.activeElement?.tagName!=="INPUT")void removeSelectedObstacle();}if(event.key==="Escape")sidebar.classList.remove("open");});

async function pollActiveSimulation(){
  if(pollBusy)return;
  pollBusy=true;
  const viewAtStart=activeView;
  try{
    if(activeView==="navigation-training"){trainingData=await api("/training/status");updateTrainingUI();}
    else if(activeView==="navigation-playground"&&!dragState){navigationData=navigationData?.running?await post("/navigation/step"):await api("/navigation");updateNavigationUI();}
    else if(activeView==="hand-training"){handData=handData?.running?await post("/hand/training/step"):await api("/hand/training");updateHandUI();}
    else if(activeView==="pickup-storage"){pickupData=pickupData?.running?await post("/pickup/step"):await api("/pickup");updatePickupUI();}
  }catch(error){showToast(`Dashboard connection issue: ${error.message}`);}finally{pollBusy=false;if(viewAtStart!==activeView)resetPollTimer();}
}

function resetPollTimer(){
  window.clearInterval(pollTimer);
  const delay=activeView==="navigation-playground"?850/navSpeed:850;
  pollTimer=window.setInterval(pollActiveSimulation,delay);
}

async function boot(){
  try{
    const [health,training]=await Promise.all([api("/health"),api("/training/status")]);
    trainingData=training;document.querySelector("#healthValue").textContent="98%";
    renderTrainingPage();setHeaderState();
  }catch(error){
    mainView.innerHTML=`<section class="empty-state"><h1>RoboLab could not connect</h1><p>${error.message}. Start the FastAPI server from the project root to load the simulation dashboard.</p></section>`;
    showToast("Start the backend with python -m uvicorn backend.app:app --reload");
  }
}

window.addEventListener("resize",()=>{
  if(activeView==="navigation-training"){drawTrainingCanvas();drawRewardChart();}
  if(activeView==="navigation-playground")drawNavigationCanvas();
  if(activeView==="hand-training"){drawHandCanvas();drawSparkline(document.querySelector("#handRewardChart"),handData?.history,"#50d7ea");}
  if(activeView==="pickup-storage")drawPickupCanvas();
});

resetPollTimer();
void boot();
