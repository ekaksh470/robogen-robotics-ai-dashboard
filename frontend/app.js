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
let pickupEditMode = "select";
let pickupDragState = null;
let selectedPickupObjectId = null;
let navSpeed = 1;
let pickupSpeed = 1;
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
    ctx.strokeStyle = "rgba(185,140,255,.76)"; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();
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
  ctx.strokeStyle = "#251c32"; ctx.lineWidth=1;
  for(let y=14;y<h-5;y+=26){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const values=(trainingData.history||[]).map(item=>Number(item.reward));
  if (!values.length) return;
  const min=Math.min(-5,...values), max=Math.max(5,...values), span=Math.max(1,max-min);
  const step=w/Math.max(values.length,1), base=h-8;
  values.forEach((value,i)=>{
    const barH=Math.max(3,((value-min)/span)*(h-25));
    ctx.fillStyle=i>values.length*.78?"rgba(185,140,255,.92)":"rgba(104,76,144,.62)";
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
  if(navigationData.path?.length>1){ctx.beginPath();navigationData.path.forEach((p,i)=>{const x=(p.x+.5)*cw,y=(p.y+.5)*ch;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.strokeStyle="rgba(185,140,255,.75)";ctx.lineWidth=2.5;ctx.lineJoin="round";ctx.setLineDash([7,5]);ctx.stroke();ctx.setLineDash([]);}
  drawObstacles(ctx,navigationData.obstacles,cw,ch);
  navigationData.obstacles.forEach((item,index)=>{if(index===selectedObstacle){const x=item.x*cw+2,y=item.y*ch+2,ww=item.w*cw-4,hh=item.h*ch-4;ctx.strokeStyle="#b98cff";ctx.lineWidth=1.5;ctx.strokeRect(x,y,ww,hh);ctx.fillStyle="#b98cff";ctx.fillRect(x+ww-7,y+hh-7,8,8);}});
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
  drawHandCanvas();drawSparkline(document.querySelector("#handRewardChart"),handData.history,"#b98cff");setHeaderState();
}

function drawHandCanvas(){
  const canvas=document.querySelector("#handCanvas");if(!canvas||!handData)return;
  const ctx=canvasContext(canvas),w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);drawGridBase(ctx,w,h,12,8);
  const axisX=w*.5,top=28,bottom=h-28,scale=bottom-top;
  ctx.strokeStyle="#51465e";ctx.lineWidth=5;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(axisX,top);ctx.lineTo(axisX,bottom);ctx.stroke();
  ctx.fillStyle="#21192d";ctx.fillRect(axisX-34,top-7,68,14);ctx.fillRect(axisX-34,bottom-7,68,14);
  const objectY=bottom-handData.object_height*scale,handY=bottom-handData.hand_y*scale;
  ctx.setLineDash([4,5]);ctx.strokeStyle="rgba(112,224,170,.5)";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(axisX-110,objectY);ctx.lineTo(axisX+110,objectY);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle="#70e0aa";roundRect(ctx,axisX-10,objectY-10,20,20,5);ctx.fill();ctx.strokeStyle="#d0ffe6";ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle="#17111f";ctx.font="bold 8px Inter, Segoe UI, sans-serif";ctx.textAlign="center";ctx.fillText("TARGET",axisX,objectY+3);
  const robotScale=clamp(w/780,.72,1.05);drawArticulatedHand(ctx,axisX,handY-scale*.12,robotScale,handData.reward>.82);
  ctx.fillStyle="#aa9db8";ctx.font="10px Inter, Segoe UI, sans-serif";ctx.textAlign="left";ctx.fillText("Y 1.0",14,top+3);ctx.fillText("Y 0.0",14,bottom+4);
  ctx.textAlign="right";ctx.fillStyle="#70e0aa";ctx.fillText(`OBJECT  ${Number(handData.object_height).toFixed(2)}`,w-14,objectY-14);ctx.fillStyle="#b98cff";ctx.fillText(`HAND  ${Number(handData.hand_y).toFixed(2)}`,w-14,Math.min(h-12,handY+89*robotScale));
}

function renderPickupPage(){
  mainView.innerHTML=`
    ${pageHeading("AUTONOMOUS MANIPULATION  /  04","Robotic Hand · Pickup & Storage","Edit the parts and hand position, then run the robot through a live pick-and-place cycle.",`<button class="button" id="pickupReset">↺ &nbsp; Reset scene</button><button class="button primary" id="pickupToggle">▶ &nbsp; Start simulation</button>`)}
    <section class="metrics-grid">${metricCard("SUCCESSFUL PICKUPS","pickupSuccess","0","Completed","Grasps stored successfully","green")}${metricCard("FAILED ATTEMPTS","pickupFailed","0","Recovery enabled","Grip retries logged","amber")}${metricCard("AVG. COMPLETION TIME","pickupAverage","—","Per object","Detection to storage","blue")}${metricCard("OBJECTS STORED","pickupStored","0 / 6","Storage bins","Objects placed safely","cyan")}</section>
    <section class="object-layout">
      <article class="panel object-stage"><header class="panel-heading"><div><h2>Editable pickup workspace</h2><p id="pickupSubtitle">Pause to move, resize, or add parts.</p></div><span class="live-pill" id="pickupPill"><i class="status-dot"></i>READY</span></header>
        <div class="toolbar pickup-toolbar"><button class="tool-button active" id="pickupToolSelect">↖ &nbsp; Select / move</button><button class="tool-button" id="pickupToolAdd">＋ &nbsp; Add part</button><button class="tool-button" id="pickupRemove">⌫ &nbsp; Remove selected</button><span class="pickup-edit-hint" id="pickupEditHint">Drag parts to move · drag the corner to resize · drag the hand to reposition</span></div>
        <canvas id="pickupCanvas" class="world-canvas" height="410" aria-label="Interactive robotic hand pickup workspace" title="Pause the simulation, then drag parts or the hand. Drag a selected part’s corner to resize it."></canvas>
        <div class="map-footer object-key"><span><i class="pickup-key-part"></i>PART</span><span><i class="pickup-key-hand"></i>ROBOT HAND</span><span><i class="pickup-key-bin"></i>STORAGE BIN</span><span class="map-meta">DETECT → ALIGN → PICK → STORE</span></div>
      </article>
    </section>
    <section class="pickup-lower"><article class="panel"><header class="panel-heading"><div><h2>Object queue</h2><p>Select an item to focus it in the workspace.</p></div><span class="neutral-pill" id="queueCount">6 OBJECTS</span></header><div id="objectQueue" class="decision-list"></div></article>
      <article class="panel pickup-sequence"><header class="panel-heading"><div><h2>Simulation tempo</h2><p>Control how quickly the detect · align · pick · store cycle advances.</p></div><span class="neutral-pill" id="pickupPhaseLabel">DETECT</span></header><label class="control-label-row" for="pickupSpeedRange"><span>Simulation speed</span><strong class="control-value" id="pickupSpeedValue">1.0×</strong></label><input id="pickupSpeedRange" type="range" min="0.5" max="2.5" step="0.25" value="1"><div class="decision-list pickup-steps"><div class="decision-row"><i class="decision-dot"></i><span class="decision-time">01</span><strong class="decision-action">Detect</strong><span class="decision-detail">Locate and identify the selected part.</span></div><div class="decision-row"><i class="decision-dot blue"></i><span class="decision-time">02</span><strong class="decision-action">Align</strong><span class="decision-detail">Move the hand over the part.</span></div><div class="decision-row"><i class="decision-dot green"></i><span class="decision-time">03</span><strong class="decision-action">Pick</strong><span class="decision-detail">Close the articulated fingers.</span></div><div class="decision-row"><i class="decision-dot green"></i><span class="decision-time">04</span><strong class="decision-action">Store</strong><span class="decision-detail">Carry the part to the next open bin.</span></div></div></article>
      <article class="panel log-panel"><header class="panel-heading"><div><h2>Live action log</h2><p>Follow each detection, alignment, grasp, and storage event.</p></div><span class="neutral-pill">RECENT ACTIONS</span></header><div id="pickupLog" class="log-feed" aria-live="polite"></div></article>
    </section>`;
  pickupEditMode="select";selectedPickupObjectId=pickupData?.current_id||pickupData?.objects?.[0]?.id||null;
  document.querySelector("#pickupToggle").addEventListener("click",togglePickup);
  document.querySelector("#pickupReset").addEventListener("click",async()=>{pickupData=await post("/pickup/reset");selectedPickupObjectId=pickupData.objects[0]?.id||null;updatePickupUI();showToast("Pickup workspace reset");});
  document.querySelector("#pickupToolSelect").addEventListener("click",()=>setPickupEditMode("select"));
  document.querySelector("#pickupToolAdd").addEventListener("click",()=>setPickupEditMode("add"));
  document.querySelector("#pickupRemove").addEventListener("click",removeSelectedPickupObject);
  const speed=document.querySelector("#pickupSpeedRange");speed.value=pickupSpeed;document.querySelector("#pickupSpeedValue").textContent=`${pickupSpeed.toFixed(1)}×`;
  speed.addEventListener("input",()=>{pickupSpeed=Number(speed.value);document.querySelector("#pickupSpeedValue").textContent=`${pickupSpeed.toFixed(1)}×`;resetPollTimer();});
  bindPickupCanvas();updatePickupUI();
}

async function togglePickup(){pickupData=await post(pickupData?.running?"/pickup/pause":"/pickup/start");updatePickupUI();resetPollTimer();}

function setPickupEditMode(mode){
  pickupEditMode=mode;
  document.querySelector("#pickupToolSelect")?.classList.toggle("active",mode==="select");
  document.querySelector("#pickupToolAdd")?.classList.toggle("active",mode==="add");
  const canvas=document.querySelector("#pickupCanvas");if(canvas)canvas.style.cursor=mode==="add"?"crosshair":"grab";
  const hint=document.querySelector("#pickupEditHint");if(hint)hint.textContent=mode==="add"?"Click an open floor position to add a part.":"Drag parts to move · drag the corner to resize · drag the hand to reposition";
}

function bindPickupCanvas(){
  const canvas=document.querySelector("#pickupCanvas");if(!canvas)return;
  canvas.style.cursor="grab";
  canvas.addEventListener("pointerdown",event=>{
    if(!pickupData)return;
    if(pickupData.running){showToast("Pause the simulation to edit the workspace");return;}
    const point=pickupCanvasPoint(canvas,event),w=canvas.clientWidth,h=canvas.clientHeight,floor=h*.82;
    if(pickupEditMode==="add"){
      if(pickupData.objects.length>=16){showToast("The workspace supports up to 16 parts");return;}
      if(point.x>w*.69||point.y>floor){showToast("Place new parts on the open work surface");return;}
      const serial=Math.max(0,...pickupData.objects.map(item=>Number(item.id.match(/\d+/)?.[0]||0)))+1;
      const palette=["violet","cyan","amber","green","rose","blue"];
      pickupData.objects.push({id:`OBJ-${String(serial).padStart(2,"0")}`,label:"Part",color:palette[(serial-1)%palette.length],size:"M",weight:.35,scale:1,x:clamp(point.x/w,.05,.67),y:clamp((floor-point.y)/(h*.55),.12,.78),detected:false,picked:false,stored:false});
      selectedPickupObjectId=`OBJ-${String(serial).padStart(2,"0")}`;void savePickupEnvironment();showToast("Part added to the workspace");setPickupEditMode("select");return;
    }
    const hit=pickupData.objects.slice().reverse().find(item=>!item.stored&&pickupObjectHit(item,point,w,h));
    if(hit){
      selectedPickupObjectId=hit.id;
      const pos=pickupObjectPosition(hit,w,h),size=pickupObjectSize(hit),resize=point.x>pos.x+size*.18&&point.y>pos.y+size*.18;
      pickupDragState={type:"object",id:hit.id,resize,start:point,origin:{x:hit.x,y:hit.y,scale:hit.scale||1}};
      canvas.setPointerCapture(event.pointerId);canvas.style.cursor=resize?"nwse-resize":"grabbing";drawPickupCanvas();return;
    }
    const armX=pickupData.arm_x*w;
    if(Math.abs(point.x-armX)<38&&point.y>16&&point.y<floor){
      pickupDragState={type:"arm"};canvas.setPointerCapture(event.pointerId);canvas.style.cursor="ew-resize";return;
    }
    selectedPickupObjectId=null;drawPickupCanvas();
  });
  canvas.addEventListener("pointermove",event=>{
    if(!pickupDragState||!pickupData)return;
    const point=pickupCanvasPoint(canvas,event),w=canvas.clientWidth,h=canvas.clientHeight;
    if(pickupDragState.type==="arm")pickupData.arm_x=clamp(point.x/w,.04,.98);
    else{
      const item=pickupData.objects.find(entry=>entry.id===pickupDragState.id);if(!item)return;
      if(pickupDragState.resize)item.scale=clamp(pickupDragState.origin.scale+(point.x-pickupDragState.start.x)/95,.65,1.55);
      else{item.x=clamp(point.x/w,.05,.67);item.y=clamp((h*.82-point.y)/(h*.55),.12,.78);}
    }
    drawPickupCanvas();
  });
  const endDrag=async()=>{if(!pickupDragState)return;pickupDragState=null;canvas.style.cursor="grab";await savePickupEnvironment();};
  canvas.addEventListener("pointerup",endDrag);canvas.addEventListener("pointercancel",endDrag);
}

function pickupCanvasPoint(canvas,event){const r=canvas.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};}
function pickupObjectPosition(item,w,h){return{x:item.x*w,y:h*.82-item.y*h*.55};}
function pickupObjectSize(item){return(item.size==="S"?20:item.size==="M"?29:39)*(item.scale||1);}
function pickupObjectHit(item,point,w,h){const pos=pickupObjectPosition(item,w,h),r=pickupObjectSize(item)*.72;return Math.abs(point.x-pos.x)<=r&&Math.abs(point.y-pos.y)<=r;}

async function savePickupEnvironment(){
  if(!pickupData)return;
  try{pickupData=await post("/pickup/config",{arm_x:pickupData.arm_x,objects:pickupData.objects});updatePickupUI();}
  catch(error){showToast(error.message);pickupData=await api("/pickup");updatePickupUI();}
}

async function removeSelectedPickupObject(){
  const item=pickupData?.objects.find(entry=>entry.id===selectedPickupObjectId);
  if(!item){showToast("Select a part in the workspace first");return;}
  if(item.stored){showToast("Stored parts are part of the completed run");return;}
  if(pickupData.objects.length<=1){showToast("Keep at least one part in the workspace");return;}
  pickupData.objects=pickupData.objects.filter(entry=>entry.id!==item.id);
  selectedPickupObjectId=pickupData.objects.find(entry=>!entry.stored)?.id||pickupData.objects[0]?.id||null;
  await savePickupEnvironment();showToast(`${item.id} removed`);
}

function updatePickupUI(){
  if(!pickupData||activeView!=="pickup-storage")return;
  document.querySelector("#pickupSuccess").textContent=pickupData.successful_pickups;document.querySelector("#pickupFailed").textContent=pickupData.failed_attempts;document.querySelector("#pickupAverage").textContent=pickupData.average_completion_time?`${pickupData.average_completion_time.toFixed(1)}s`:"—";document.querySelector("#pickupStored").textContent=`${pickupData.objects_stored} / ${pickupData.objects.length}`;
  const phaseNames=["DETECT","ALIGN","PICK","STORE"],phase=phaseNames[pickupData.phase]||"DETECT";
  document.querySelector("#pickupToggle").innerHTML=pickupData.running?"Ⅱ &nbsp; Pause simulation":"▶ &nbsp; Start simulation";document.querySelector("#pickupPill").innerHTML=`<i class="status-dot ${pickupData.running?"":"cyan-dot"}"></i>${pickupData.running?`ACTION · ${phase}`:"EDITABLE SCENE"}`;document.querySelector("#pickupSubtitle").textContent=pickupData.running?`${phase} · ${pickupData.current_id} · hand X ${Number(pickupData.arm_x).toFixed(2)}`:`${pickupData.objects.length} parts · drag to reposition or select Add part`;
  document.querySelector("#pickupPhaseLabel").textContent=pickupData.running?phase:"READY";
  document.querySelector("#pickupToolSelect").disabled=pickupData.running;document.querySelector("#pickupToolAdd").disabled=pickupData.running;document.querySelector("#pickupRemove").disabled=pickupData.running;
  document.querySelector("#pickupLog").innerHTML=(pickupData.log||[]).map(item=>`<div class="log-item"><time>${item.time}</time><span class="${item.kind}">${item.message}</span></div>`).join("");
  document.querySelector("#queueCount").textContent=`${pickupData.objects.filter(item=>!item.stored).length} IN QUEUE`;
  document.querySelector("#objectQueue").innerHTML=pickupData.objects.map(item=>`<button class="queue-select-row ${item.id===selectedPickupObjectId?"selected":""}" data-pick-object="${item.id}" ${item.stored?"disabled":""}><i class="decision-dot ${item.stored?"green":""}" style="background:${item.stored?"var(--green)":objectColor(item.color)}"></i><span class="decision-time">${item.id}</span><strong class="decision-action">${item.label}</strong><span class="decision-detail">${item.size} · ${Number(item.scale||1).toFixed(1)}× · ${item.weight.toFixed(2)} kg · ${item.stored?"stored":"waiting"}</span></button>`).join("");
  document.querySelectorAll("[data-pick-object]").forEach(button=>button.addEventListener("click",()=>{selectedPickupObjectId=button.dataset.pickObject;updatePickupUI();}));
  drawPickupCanvas();setHeaderState();
}

function drawPickupCanvas(){
  const canvas=document.querySelector("#pickupCanvas");if(!canvas||!pickupData)return;
  const ctx=canvasContext(canvas),w=canvas.clientWidth,h=canvas.clientHeight;drawGridBase(ctx,w,h,16,10);
  const floor=h*.82;ctx.fillStyle="#181220";ctx.fillRect(0,floor,w,h-floor);ctx.strokeStyle="#4c3d5e";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,floor);ctx.lineTo(w,floor);ctx.stroke();
  const binW=w*.057,binGap=w*.012,startX=w*.72,binY=h*.34,binH=h*.4;
  for(let i=0;i<4;i++){const x=startX+i*(binW+binGap);ctx.fillStyle="#17111f";ctx.strokeStyle="#655779";ctx.lineWidth=1.4;roundRect(ctx,x,binY,binW,binH,6);ctx.fill();ctx.stroke();ctx.fillStyle="#aa9db8";ctx.font="9px Inter, Segoe UI, sans-serif";ctx.textAlign="center";ctx.fillText(`BIN ${i+1}`,x+binW/2,binY+binH+15);}
  pickupData.objects.filter(item=>item.stored).forEach((item,index)=>{const bin=index%4,stack=Math.floor(index/4),x=startX+bin*(binW+binGap)+binW/2,y=binY+binH-14-stack*18;ctx.fillStyle=objectColor(item.color);roundRect(ctx,x-8,y-8,16,16,4);ctx.fill();});
  const target=pickupData.objects.find(item=>item.id===pickupData.current_id);
  pickupData.objects.forEach(item=>{
    if(item.stored)return;
    if(item.picked)return;
    const pos=pickupObjectPosition(item,w,h),size=pickupObjectSize(item);
    if(item.id===pickupData.current_id){ctx.strokeStyle="rgba(185,140,255,.72)";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(pos.x,pos.y,size*.8,0,Math.PI*2);ctx.stroke();}
    ctx.fillStyle=objectColor(item.color);roundRect(ctx,pos.x-size/2,pos.y-size/2,size,size,Math.min(8,size/4));ctx.fill();ctx.strokeStyle="#e5def0";ctx.lineWidth=1;ctx.stroke();ctx.fillStyle="#17111f";ctx.font="bold 9px Inter, Segoe UI, sans-serif";ctx.textAlign="center";ctx.fillText(item.id.slice(-2),pos.x,pos.y+3);
    if(item.id===selectedPickupObjectId&&!pickupData.running){ctx.strokeStyle="#c9a9ff";ctx.setLineDash([4,3]);ctx.beginPath();ctx.arc(pos.x,pos.y,size*.95,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#c9a9ff";ctx.fillRect(pos.x+size*.32-4,pos.y+size*.32-4,8,8);}
  });
  const current=target||pickupData.objects[0],armX=Number(pickupData.arm_x||.12)*w;
  const targetPos=current?pickupObjectPosition(current,w,h):{y:floor-h*.18};
  const pinchY=pickupData.phase>=3?floor-h*.18:Math.min(floor-72,targetPos.y+8);
  ctx.fillStyle="#171220";roundRect(ctx,armX-27,12,54,12,5);ctx.fill();ctx.strokeStyle="#665779";ctx.stroke();ctx.fillStyle="#423653";ctx.fillRect(armX-3,24,6,Math.max(16,pinchY-28));
  ctx.fillStyle="#d8d4df";roundRect(ctx,armX-28,pinchY+17,56,68,10);ctx.fill();ctx.strokeStyle="#6d6678";ctx.lineWidth=1.5;ctx.stroke();
  if(current?.picked){const heldY=pinchY-17,size=pickupObjectSize(current)*.72;ctx.fillStyle=objectColor(current.color);roundRect(ctx,armX-size/2,heldY-size/2,size,size,5);ctx.fill();ctx.strokeStyle="#f0e8fb";ctx.stroke();}
  drawArticulatedHand(ctx,armX,pinchY,.78,pickupData.phase===2||pickupData.phase===3);
  ctx.textAlign="left";ctx.font="10px Inter, Segoe UI, sans-serif";ctx.fillStyle="#aa9db8";ctx.fillText(pickupData.running?`ACTION ${["DETECT","ALIGN","PICK","STORE"][pickupData.phase]}`:"PAUSED · EDITABLE WORKSPACE",14,20);
}

function objectColor(name){return ({cyan:"#68c7d6",violet:"#b98cff",amber:"#ffc56a",green:"#5ce0a0",rose:"#ff7b91",blue:"#8f74f5"})[name]||"#b98cff";}

function canvasContext(canvas){
  const dpr=window.devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);return ctx;
}

function drawGridBase(ctx,w,h,cols,rows){
  ctx.clearRect(0,0,w,h);ctx.fillStyle="#0a0811";ctx.fillRect(0,0,w,h);ctx.strokeStyle="#251c32";ctx.lineWidth=1;
  for(let c=1;c<cols;c++){const x=c*w/cols;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for(let r=1;r<rows;r++){const y=r*h/rows;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
}

function drawObstacles(ctx,obstacles,cw,ch){
  (obstacles||[]).forEach(item=>{const x=item.x*cw+3,y=item.y*ch+3,w=Math.max(4,item.w*cw-6),h=Math.max(4,item.h*ch-6);ctx.fillStyle="#373044";ctx.strokeStyle="#7a7185";ctx.lineWidth=1;roundRect(ctx,x,y,w,h,6);ctx.fill();ctx.stroke();});
}

function drawRobot(ctx,x,y,r){
  const size=Math.max(16,r*3.1),w=size*1.18,h=size*.92;ctx.save();
  ctx.fillStyle="rgba(185,140,255,.14)";ctx.beginPath();ctx.arc(x,y,size*1.25,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#17111f";roundRect(ctx,x-w*.62,y-h*.43,w*.26,h*.86,2);ctx.fill();roundRect(ctx,x+w*.36,y-h*.43,w*.26,h*.86,2);ctx.fill();
  ctx.fillStyle="#b98cff";ctx.strokeStyle="#eadbff";ctx.lineWidth=1.2;roundRect(ctx,x-w*.42,y-h*.5,w*.84,h,4);ctx.fill();ctx.stroke();
  ctx.fillStyle="#281d3a";roundRect(ctx,x-w*.27,y-h*.25,w*.54,h*.37,3);ctx.fill();
  ctx.fillStyle="#f5ecff";ctx.beginPath();ctx.arc(x-w*.11,y-h*.08,Math.max(1.3,size*.065),0,Math.PI*2);ctx.arc(x+w*.11,y-h*.08,Math.max(1.3,size*.065),0,Math.PI*2);ctx.fill();
  ctx.strokeStyle="#f5ecff";ctx.lineWidth=1.7;ctx.beginPath();ctx.moveTo(x,y-h*.5);ctx.lineTo(x,y-h*.69);ctx.stroke();ctx.fillStyle="#70e0aa";ctx.beginPath();ctx.arc(x,y-h*.72,Math.max(1.5,size*.06),0,Math.PI*2);ctx.fill();ctx.restore();
}

function drawArticulatedHand(ctx,x,pinchY,scale=1,closing=false){
  const s=scale,spread=closing?1:.0;
  const drawLink=(x1,y1,x2,y2)=>{ctx.lineCap="round";ctx.strokeStyle="#5e5867";ctx.lineWidth=12*s;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.strokeStyle="#dedbe3";ctx.lineWidth=7*s;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.strokeStyle="#faf8fc";ctx.lineWidth=1.4*s;ctx.beginPath();ctx.moveTo(x1-1*s,y1-1*s);ctx.lineTo(x2-1*s,y2-1*s);ctx.stroke();};
  const joint=(jx,jy)=>{ctx.fillStyle="#4d4658";ctx.beginPath();ctx.arc(jx,jy,6*s,0,Math.PI*2);ctx.fill();ctx.fillStyle="#b98cff";ctx.beginPath();ctx.arc(jx,jy,2.5*s,0,Math.PI*2);ctx.fill();};
  ctx.save();
  const outer=42*s*(1-spread*.22),inner=24*s*(1-spread*.24);
  [[-1,outer],[-1,inner],[1,inner],[1,outer]].forEach(([side,reach],index)=>{
    const rootX=x+side*(index===0||index===3?19:13)*s,rootY=pinchY+25*s;
    const elbowX=x+side*reach*.68,elbowY=pinchY+4*s;
    const wristX=x+side*reach, wristY=pinchY-23*s;
    const tipX=x+side*reach*(1-spread*.08),tipY=pinchY-38*s;
    drawLink(rootX,rootY,elbowX,elbowY);drawLink(elbowX,elbowY,wristX,wristY);drawLink(wristX,wristY,tipX,tipY);
    joint(elbowX,elbowY);joint(wristX,wristY);
    ctx.fillStyle="#dedbe3";roundRect(ctx,tipX-4*s,tipY-8*s,8*s,15*s,2*s);ctx.fill();ctx.strokeStyle="#5e5867";ctx.lineWidth=1*s;ctx.stroke();
  });
  const bodyY=pinchY+16*s,bodyW=48*s,bodyH=72*s;
  const metal=ctx.createLinearGradient(x-bodyW/2,bodyY,x+bodyW/2,bodyY+bodyH);metal.addColorStop(0,"#efedf2");metal.addColorStop(.48,"#bdb9c4");metal.addColorStop(1,"#8d8795");
  ctx.fillStyle=metal;ctx.strokeStyle="#625b6b";ctx.lineWidth=1.5*s;roundRect(ctx,x-bodyW/2,bodyY,bodyW,bodyH,8*s);ctx.fill();ctx.stroke();
  ctx.fillStyle="#a79eaf";roundRect(ctx,x-15*s,bodyY+10*s,30*s,bodyH-20*s,5*s);ctx.fill();
  ctx.fillStyle="#34273f";roundRect(ctx,x-5*s,bodyY+17*s,10*s,26*s,3*s);ctx.fill();
  [[-17,bodyY+9],[17,bodyY+9],[-17,bodyY+bodyH-9],[17,bodyY+bodyH-9]].forEach(([dx,dy])=>{ctx.fillStyle="#696272";ctx.beginPath();ctx.arc(x+dx*s,dy,2.1*s,0,Math.PI*2);ctx.fill();});
  ctx.fillStyle="#8d8696";roundRect(ctx,x-13*s,bodyY+bodyH-2*s,26*s,8*s,3*s);ctx.fill();
  ctx.restore();
}
function drawGoal(ctx,x,y,r){ctx.fillStyle="rgba(24,58,49,.9)";ctx.beginPath();ctx.arc(x,y,r*1.7,0,Math.PI*2);ctx.fill();ctx.fillStyle="#5ce0a0";ctx.beginPath();ctx.arc(x,y,r*.7,0,Math.PI*2);ctx.fill();}
function roundRect(ctx,x,y,w,h,r){const radius=Math.max(0,Math.min(r,w/2,h/2));ctx.beginPath();ctx.moveTo(x+radius,y);ctx.arcTo(x+w,y,x+w,y+h,radius);ctx.arcTo(x+w,y+h,x,y+h,radius);ctx.arcTo(x,y+h,x,y,radius);ctx.arcTo(x,y,x+w,y,radius);ctx.closePath();}

function drawSparkline(canvas,values,color){
  if(!canvas)return;const ctx=canvasContext(canvas),w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);ctx.strokeStyle="#251c32";ctx.lineWidth=1;for(let y=15;y<h;y+=26){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
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
document.addEventListener("keydown",event=>{if(event.key==="Delete"||event.key==="Backspace"){if(document.activeElement?.matches("input,select,textarea,button"))return;if(activeView==="navigation-playground")void removeSelectedObstacle();if(activeView==="pickup-storage")void removeSelectedPickupObject();}if(event.key==="Escape")sidebar.classList.remove("open");});

async function pollActiveSimulation(){
  if(pollBusy)return;
  pollBusy=true;
  const viewAtStart=activeView;
  try{
    if(activeView==="navigation-training"){trainingData=await api("/training/status");updateTrainingUI();}
    else if(activeView==="navigation-playground"&&!dragState){navigationData=navigationData?.running?await post("/navigation/step"):await api("/navigation");updateNavigationUI();}
    else if(activeView==="hand-training"){handData=handData?.running?await post("/hand/training/step"):await api("/hand/training");updateHandUI();}
    else if(activeView==="pickup-storage"&&!pickupDragState){pickupData=pickupData?.running?await post("/pickup/step"):await api("/pickup");updatePickupUI();}
  }catch(error){showToast(`Dashboard connection issue: ${error.message}`);}finally{pollBusy=false;if(viewAtStart!==activeView)resetPollTimer();}
}

function resetPollTimer(){
  window.clearInterval(pollTimer);
  const delay=activeView==="navigation-playground"?850/navSpeed:activeView==="pickup-storage"?850/pickupSpeed:850;
  pollTimer=window.setInterval(pollActiveSimulation,delay);
}

async function boot(){
  try{
    const [health,training]=await Promise.all([api("/health"),api("/training/status")]);
    trainingData=training;document.querySelector("#healthValue").textContent="98%";
    renderTrainingPage();setHeaderState();
  }catch(error){
    mainView.innerHTML=`<section class="empty-state"><h1>ROOBGEN could not connect</h1><p>${error.message}. Start the FastAPI server from the project root to load the simulation dashboard.</p></section>`;
    showToast("Start the backend with python -m uvicorn backend.app:app --reload");
  }
}

window.addEventListener("resize",()=>{
  if(activeView==="navigation-training"){drawTrainingCanvas();drawRewardChart();}
  if(activeView==="navigation-playground")drawNavigationCanvas();
  if(activeView==="hand-training"){drawHandCanvas();drawSparkline(document.querySelector("#handRewardChart"),handData?.history,"#b98cff");}
  if(activeView==="pickup-storage")drawPickupCanvas();
});

resetPollTimer();
void boot();
