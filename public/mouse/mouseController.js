document.body.innerHTML += `
  <svg id="cursor" xmlns="http://www.w3.org/2000/svg" viewBox="-10003 -10003 20010 20010">
  <path d="M 0 0 L 0 10000 Z M 0 0 L 0 -10000 M 0 0 L -10000 0 M 0 0 L 10000 0 M 25 0 A 1 1 0 0 0 -25 0 A 1 1 0 0 0 25 0" stroke="green" stroke-width="3" fill="none"/>
  </svg>`;

cursor = document.getElementById("cursor");
// Size via CSS to avoid forcing page scrollbars.

ActiveButtonBackgroundColor = "rgba(252, 242, 44, 0.3)";
InactiveButtonBackgroundColor = "rgba(100, 94, 94, 0.4)";

const FakeMouseHolderDiv = document.getElementById("FakeMouseHolder");
const holderHolder = document.getElementById("holderHolder");

const mouseObject = {
  leftMouseDown: false,
  rightMouseDown: false,
  absoluteX: 100,
  absoluteY: 100,
  deltaY: 0,
  shiftKey: false,
  pickListMode: true,
};

var lastTouchX = 0;
var lastTouchY = 0;

var speed = 0.6;

const pointerTarget = document.getElementById("pointerTarget");
const mouseDebug = true;
const iframeZoom = 1;
const PASS_THROUGH_CLASS = "touch-pass-through";
let passThroughTarget = null;
let twoFingerActive = false;
let lastPinchDistance = 0;
let lastMidX = 0;
let lastMidY = 0;

function sendNewEvent(eventType) {
  let obj = JSON.parse(JSON.stringify(mouseObject));
  const rect = pointerTarget.getBoundingClientRect();
  const localX = obj.absoluteX - rect.left;
  const localY = obj.absoluteY - rect.top;
  const mappedX = localX / iframeZoom;
  const mappedY = localY / iframeZoom;
  obj.rawX = obj.absoluteX;
  obj.rawY = obj.absoluteY;
  obj.absoluteX = mappedX;
  obj.absoluteY = mappedY;
  obj.eventType = eventType;
  //console.log("sending this", obj);
  if (mouseDebug)
    console.log("[mouseController] send", eventType, {
      rawX: obj.rawX,
      rawY: obj.rawY,
      mappedX: obj.absoluteX,
      mappedY: obj.absoluteY,
      rect,
    });
  return pointerTarget.contentWindow.postMessage(obj, "*");
}

function mapToIframeCoords(clientX, clientY) {
  const rect = pointerTarget.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  return {
    x: localX / iframeZoom,
    y: localY / iframeZoom,
  };
}

function isPassThroughTarget(el) {
  let cur = el;
  let depth = 0;
  while (cur && depth < 5) {
    const tag = (cur.tagName || "").toLowerCase();
    if (tag === "button" || tag === "a") return true;
    if (tag === "input") {
      const type = (cur.getAttribute("type") || "").toLowerCase();
      if (type === "button" || type === "submit") return true;
    }
    if (cur.getAttribute?.("role") === "button") return true;
    if (cur.classList?.contains(PASS_THROUGH_CLASS)) return true;
    cur = cur.parentElement;
    depth += 1;
  }
  return false;
}

function elementFromPointDeep(doc, x, y) {
  let el = doc.elementFromPoint(x, y);
  let depth = 0;
  while (el && el.shadowRoot && depth < 5) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
    depth += 1;
  }
  return el;
}

function tryPassThroughTap(clientX, clientY) {
  const doc = pointerTarget.contentDocument;
  if (!doc) return false;
  const { x, y } = mapToIframeCoords(clientX, clientY);
  const target = elementFromPointDeep(doc, x, y);
  if (!isPassThroughTarget(target)) return false;
  if (mouseDebug) console.log("[mouseController] passthrough tap", target, { x, y });
  target.click?.();
  holderHolder.style.display = "block";
  holderHolder.style.visibility = "visible";
  return true;
}

document.getElementById("touchpadArea").addEventListener("touchstart", function (event) {
  if (window.innerHeight !== screen.height) {
    document.body.requestFullscreen?.();
  }

  if (event.touches.length == 1){
    lastTouchX = event.touches[0].clientX;
    lastTouchY = event.touches[0].clientY;
    const doc = pointerTarget.contentDocument;
    if (doc) {
      const { x, y } = mapToIframeCoords(lastTouchX, lastTouchY);
      const target = doc.elementFromPoint(x, y);
      passThroughTarget = isPassThroughTarget(target) ? target : null;
      if (passThroughTarget && mouseDebug) {
        console.log("[mouseController] passthrough target armed", passThroughTarget, { x, y });
      }
    }
  }

  if (event.touches.length ==2){
    const t1 = event.touches[0];
    const t2 = event.touches[1];
    lastMidX = (t1.clientX + t2.clientX) / 2;
    lastMidY = (t1.clientY + t2.clientY) / 2;
    lastPinchDistance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    twoFingerActive = true;
    mouseObject.rightMouseDown = true;
    mouseObject.absoluteX = lastMidX;
    mouseObject.absoluteY = lastMidY;
    cursor.style.left = mouseObject.absoluteX + "px";
    cursor.style.top = mouseObject.absoluteY + "px";
    sendNewEvent("mousemove");
  }
});


document.getElementById("touchpadArea").addEventListener("touchend", function (event) {
  if (event.touches.length ==2){
    zooming = false;
    mouseObject.deltaY = 0;
    lastScrollY = 0;
  }
  if (event.touches.length < 2 && twoFingerActive) {
    twoFingerActive = false;
    mouseObject.rightMouseDown = false;
    mouseObject.deltaY = 0;
    sendNewEvent("mousemove");
  }
});

document.getElementById("touchpadArea").addEventListener("click", async function (event) {
  if (passThroughTarget) {
    event.preventDefault();
    event.stopPropagation();
    passThroughTarget.click?.();
    passThroughTarget = null;
    holderHolder.style.display = "block";
    holderHolder.style.visibility = "visible";
    return;
  }
  if (tryPassThroughTap(lastTouchX, lastTouchY)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  document.getElementById("leftMouseButton").click();
});

document.getElementById("touchpadArea").addEventListener("dblclick", function (event) {
  event.preventDefault();
  //document.getElementById("leftMouseButton").click();
  sendNewEvent("dblclick");
});

document.getElementById("touchpadArea").addEventListener("contextmenu", function (event) {
  event.preventDefault();
  document.getElementById("leftMouseButton").dispatchEvent(new CustomEvent("contextmenu"));
});

document.getElementById("touchpadArea").addEventListener("touchmove", function (event) {
  if (event.touches.length == 2) {
    event.preventDefault();
    const t1 = event.touches[0];
    const t2 = event.touches[1];
    const midX = (t1.clientX + t2.clientX) / 2;
    const midY = (t1.clientY + t2.clientY) / 2;
    const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

    const dx = midX - lastMidX;
    const dy = midY - lastMidY;
    lastMidX = midX;
    lastMidY = midY;

    mouseObject.absoluteX = mouseObject.absoluteX + dx * speed;
    mouseObject.absoluteY = mouseObject.absoluteY + dy * speed;
    cursor.style.left = mouseObject.absoluteX + "px";
    cursor.style.top = mouseObject.absoluteY + "px";
    sendNewEvent("mousemove");

    const pinchDelta = dist - lastPinchDistance;
    lastPinchDistance = dist;
    mouseObject.deltaY = -pinchDelta / 4;
    sendNewEvent("zoom");
    return;
  }
  event.preventDefault();
  if (event.touches.length == 1){
    let x = event.touches[0].clientX;
    let y = event.touches[0].clientY;
  
    let difrenceX = x - lastTouchX;
    let difrenceY = y - lastTouchY;
  
    lastTouchX = x;
    lastTouchY = y;
  
    mouseObject.absoluteX = mouseObject.absoluteX + difrenceX * speed;
    mouseObject.absoluteY = mouseObject.absoluteY + difrenceY * speed;
  
    mouseObject.absoluteX = mouseObject.absoluteX > 0 ? mouseObject.absoluteX : 1;
    mouseObject.absoluteY = mouseObject.absoluteY > 0 ? mouseObject.absoluteY : 1;
  
    cursor.style.left = mouseObject.absoluteX + "px";
    cursor.style.top = mouseObject.absoluteY + "px";
  
    sendNewEvent("mousemove");
  }

  if (event.touches.length == 2){
    //zoom zoom zoom
    console.log("zoom zoom zoom")

    let y = event.touches[0].clientY;
    let difrenceY = y - lastScrollY;
    lastScrollY = y;
    mouseObject.deltaY = difrenceY / 10000;
    sendNewEvent("zoom");
  }
});

document.getElementById("leftMouseButton").addEventListener("contextmenu", function (event) {
  event.preventDefault();
  if (event.target.innerHTML == "🔒") {
    event.target.innerHTML = "🔓";
    mouseObject.leftMouseDown = false;
    event.target.style.backgroundColor = InactiveButtonBackgroundColor;
    sendNewEvent("mousemove");
  } else {
    event.target.innerHTML = "🔒";
    mouseObject.leftMouseDown = true;
    event.target.style.backgroundColor = ActiveButtonBackgroundColor;
    sendNewEvent("mousemove");
  }
});

document.getElementById("rightMouseButton").addEventListener("contextmenu", function (event) {
  event.preventDefault();
  if (event.target.innerHTML == "🔒") {
    event.target.innerHTML = "🔓";
    mouseObject.rightMouseDown = false;
    event.target.style.backgroundColor = InactiveButtonBackgroundColor;
    sendNewEvent("mousemove");
  } else {
    event.target.innerHTML = "🔒";
    mouseObject.rightMouseDown = true;
    event.target.style.backgroundColor = ActiveButtonBackgroundColor;
    sendNewEvent("mousemove");
  }
});

document.getElementById("leftMouseButton").addEventListener("click", function (event) {
  event.preventDefault();
  if (event.target.innerHTML == "🔒") {
    event.target.innerHTML = "🔓";
    mouseObject.leftMouseDown = false;
    event.target.style.backgroundColor = InactiveButtonBackgroundColor;
    sendNewEvent("mousemove");
  }
  doLeftClick();
});

document.getElementById("rightMouseButton").addEventListener("click", function (event) {
  event.preventDefault();
  if (event.target.innerHTML == "🔒") {
    event.target.innerHTML = "🔓";
    mouseObject.rightMouseDown = false;
    event.target.style.backgroundColor = InactiveButtonBackgroundColor;
    sendNewEvent("mousemove");
  }else{
    doRightClick();
  }
});


document.getElementById("ShiftButton").addEventListener("click", function (event) {
  event.preventDefault();
  if (event.target.innerHTML == "shift") {
    event.target.innerHTML = "shift Down";
    event.target.style.backgroundColor = ActiveButtonBackgroundColor;
    mouseObject.shiftKey = true;
    sendNewEvent("shiftDown");
  } else {
    event.target.innerHTML = "shift";
    event.target.style.backgroundColor = InactiveButtonBackgroundColor;
    mouseObject.shiftKey = false;
    sendNewEvent("shiftUp");
  }
});

document.getElementById("EscButton").addEventListener("click", function (event) {
  event.preventDefault();
  sendNewEvent("EscButton");
});

function toggleMousepad(showHide) {
  const cursorEl = document.getElementById("cursor");
  if (showHide) {
    if (showHide == "show") {
      holderHolder.style.display = "block";
      if (cursorEl) cursorEl.style.display = "block";
    }
    if (showHide == "hide") {
      holderHolder.style.display = "none";
      if (cursorEl) cursorEl.style.display = "none";
    }
    return;
  }

  if (holderHolder.style.display == "none") {
    sendNewEvent("toolsHide");
    holderHolder.style.display = "block";
    if (cursorEl) cursorEl.style.display = "block";
  } else {
    holderHolder.style.display = "none";
    if (cursorEl) cursorEl.style.display = "none";
  }
}

function doLeftClick() {
  sendNewEvent("click");
}

function doRightClick() {
  sendNewEvent("rightclick");
}

var lastScrollY = 0;
var zooming = false;

window.addEventListener("message", function (event) {
  if (mouseDebug) console.log("[mouseController] message from child", event.data);
  if (event.data == "showTouchpad") toggleMousepad("show");
});



pointerTarget.onload = function () {
  const elem = document.createElement(`script`);
  elem.src = "/mouse/virtualMousePointer.js";
  elem.type = "module";

  pointerTarget.contentDocument.body.appendChild(elem);

  if (mouseDebug) console.log("[mouseController] iframe loaded", window.location);
};

document.body.onload = function () {
  try {
    document.getElementById("mouseSpeed").value = localStorage.mouseSpeed;
  } catch {}
  pointerTarget.src = "./" + window.location.search;
  //console.log("dats the window locations", window.location.search);
};

document.getElementById("saveSettings").onclick = function (event) {
  localStorage.mouseSpeed = document.getElementById("mouseSpeed").value;
  speed = localStorage.mouseSpeed;
  document.getElementById("settings").style.display = "none";
  //console.log("dats the window locations", window.location.search);
};

document.getElementById("toggleUItabs").onclick = function (event) {
  sendNewEvent("toggleUItabs");
};

document.getElementById("toggleUIoverlay").onclick = function (event) {
  sendNewEvent("toggleUIoverlay");
};

document.getElementById("toggleUItoolbar").onclick = function (event) {
  sendNewEvent("toggleUItoolbar");
};

document.getElementById("settingsButton").onclick = function (event) {
  document.getElementById("settings").style.display = "";
  //console.log("dats the window locations", window.location.search);
};
