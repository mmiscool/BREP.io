//Allways keep page at propper position,
// prevents page scrolling acidentally due to html elements going out of view.
let mouseDebugger = true;

window.setInterval(function () {
  window.scrollTo(0, 0);
}, 200);

var mouseOverList = [];

var lastMouseOverObject;
var lastThingToDo = {
  leftMouseDown: false,
  rightMouseDown: false,
};
var shiftKey = false;

let scaleFactor = 2;
let absoluteX = 0;
let absoluteY = 0;
let deltaY;
let eventType;

window.addEventListener(
  "message",
  (event) => {
    const thingToDo = event.data;
    if (typeof thingToDo !== "object") return;
    if (mouseDebugger) console.log("[virtualMousePointer] recv", thingToDo);

    // if (thingToDo == "whatUnderTouchLocation"){
    //   return "here is my message";
    // }

    absoluteX = thingToDo.absoluteX ? thingToDo.absoluteX : "";
    absoluteY = thingToDo.absoluteY ? thingToDo.absoluteY : "";

    if (mouseDebugger) console.log(absoluteX, absoluteY);

    deltaY = thingToDo.deltaY ? thingToDo.deltaY : "";
    eventType = thingToDo.eventType ? thingToDo.eventType : "";

    if (eventType == "shiftDown") {
      shiftKey = true;
      const itemsUnderMouse = document.elementsFromPoint(absoluteX, absoluteY);
      itemsUnderMouse.forEach((item, key) => {
        item.dispatchEvent(new KeyboardEvent("keydown", { shiftKey: true }));
        item.dispatchEvent(new KeyboardEvent("keypress", { shiftKey: true }));
      });
      return;
    }

    if (eventType == "shiftUp") {
      shiftKey = false;
      const itemsUnderMouse = document.elementsFromPoint(absoluteX, absoluteY);
      itemsUnderMouse.forEach((item, key) => {
        item.dispatchEvent(new KeyboardEvent("keyup", { shiftKey: false }));
      });
      return;
    }

    if (eventType == "EscButton") {
      const itemsUnderMouse = document.elementsFromPoint(absoluteX, absoluteY);
      if (mouseDebugger) console.log("clearing selection");
      itemsUnderMouse.forEach((item, key) => {
        item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        item.dispatchEvent(new KeyboardEvent("keypress", { key: "Escape" }));
        item.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));
      });
      return;
    }

    if (lastThingToDo.leftMouseDown !== thingToDo.leftMouseDown) {
      if (thingToDo.leftMouseDown == true) {
        eventType = "leftDragStart";
      } else {
        eventType = "leftDragEnd";
      }
    }

    if (lastThingToDo.rightMouseDown !== thingToDo.rightMouseDown) {
      if (thingToDo.rightMouseDown == true) {
        eventType = "rightDragStart";
      } else {
        eventType = "rightDragEnd";
      }
    }


    lastThingToDo = thingToDo;

    const itemsUnderMouse = document.elementsFromPoint(absoluteX, absoluteY);
    const topItem = itemsUnderMouse[0];
    if (!topItem) return;

    doTheProperEvents(topItem);

    let mouseOutObjects = [];

    let newMouseOverList = [];
    mouseOverList.forEach((item, key) => {
      if (!itemsUnderMouse.includes(item)) {
        mouseOutObjects.push(item);
      } else {
        newMouseOverList.push(item);
      }
    });

    mouseOverList = newMouseOverList;

    mouseOutObjects.forEach((item, key) => {
      exicuteEvents(item, [
        "mouseleave",
        "mouseout",
        "mouseexit",
        "pointerleave",
        "pointerout",
      ]);
    });
  },
  true
);

function doTheProperEvents(item) {
  if (eventType == "mousemove") {
    exicuteEvents(item, ["pointermove", "mousemove", "mouseover"]);

    if (!mouseOverList.includes(item)) {
      mouseOverList.push(item);
      exicuteEvents(item, ["mouseenter", "pointerenter"]);
    }
  }

  if (eventType == "leftDragStart") {
    exicuteEvents(item, ["click", "mousedown", "pointerdown"]);
  }

  if (eventType == "leftDragEnd") {
    exicuteEvents(item, ["mouseup", "pointerup"]);
  }

  if (eventType == "rightDragStart") {
    exicuteEvents(
      item,
      ["contextmenu", "auxclick", "mousedown", "pointerdown"],
      { button: 2 }
    );
  }

  if (eventType == "rightDragEnd") {
    exicuteEvents(item, ["mouseup", "pointerup"], { button: 2 });
  }

  if (eventType == "click") {
    exicuteEvents(item, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
    if (item.nodeName == "INPUT") item.focus();
  }
  if (eventType == "dblclick") {
    if (item.nodeName == "INPUT") item.focus();

    exicuteEvents(item, [
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
      "dblclick",
    ]);
  }
  if (eventType == "rightclick") {
    exicuteEvents(item, ["contextmenu", "auxclick"]);
    exicuteEvents(
      item,
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"],
      { button: 2 }
    );
  }
}

function exicuteEvent(TargetElement, eventToSend = {}) {
  eventToSend.clientX = absoluteX;
  eventToSend.clientY = absoluteY;
  eventToSend.x = absoluteX;
  eventToSend.y = absoluteY;
  eventToSend.pageX = absoluteX;
  eventToSend.pageY = absoluteY;
  eventToSend.view = window;
  eventToSend.bubbles = true;
  eventToSend.cancelable = true;
  eventToSend.shiftKey = shiftKey;

  const isPointerEvent = typeof eventToSend.type === "string" && eventToSend.type.startsWith("pointer");
  if (isPointerEvent) {
    eventToSend.pointerId = eventToSend.pointerId ?? 1;
    eventToSend.pointerType = eventToSend.pointerType ?? "mouse";
    eventToSend.isPrimary = eventToSend.isPrimary ?? true;
    eventToSend = new PointerEvent(eventToSend.type, eventToSend);
  } else {
    eventToSend = new MouseEvent(eventToSend.type, eventToSend);
  }
  try {
    testResult = TargetElement.dispatchEvent(eventToSend);
    if (mouseDebugger && !testResult) {
      const tag = TargetElement?.tagName || "unknown";
      const id = TargetElement?.id ? `#${TargetElement.id}` : "";
      const cls = TargetElement?.className
        ? `.${String(TargetElement.className).split(" ").join(".")}`
        : "";
      console.log("event canceled", eventToSend.type, `${tag}${id}${cls}`, eventToSend);
    }
    //if (TargetElement.dispatchEvent(eventToSend) == false) console.log("event trigger failed", TargetElement, eventToSend);
    return testResult;
  } catch {
    if (mouseDebugger)
      console.log("event trigger failed", TargetElement, eventToSend);
    return "failed";
  }
}

function exicuteEvents(TargetElement, eventTypes, eventToSend = {}) {
  const eventTemplate = JSON.parse(JSON.stringify(eventToSend));
  eventTypes.forEach((enenvtToFire, key) => {
    eventTemplate.type = enenvtToFire;
    if (mouseDebugger) console.log("[virtualMousePointer] fire", enenvtToFire, eventTemplate);
    exicuteEvent(TargetElement, eventTemplate);
  });
}
