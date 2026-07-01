import {parseJsonAndPrintError, sidedAdResolve} from "./demo.js"

function doSimple() {
  const startVertex = document.querySelector("#simpleStart").value;
  const endVertex = document.querySelector("#simpleEnd").value;
  const segments = parseJsonAndPrintError(document.querySelector("#segments").value, "simpleError");
  const report = sidedAdResolve(segments, startVertex, endVertex, "simpleError");
  document.querySelector("#simpleResults").innerHTML = report;
}

/*
      function doGrid() {
        const startVertex = document.querySelector("#gridStart").value;
        const endVertex = document.querySelector("#gridEnd").value;
        const graphJson = makeTestGridGraph(
          document.querySelector("#gridWidth").value,
          document.querySelector("#gridHeight").value,
          document.querySelector("#straightWeight").value,
          document.querySelector("#diagonalWeight").value,
          document.querySelector("#includeDiagonals").checked);
        const report = sidedAdResolve(segments, startVertex, endVertex, "gridError");
        document.querySelector("#gridResults").innerHTML = report;
      }
*/
document.querySelector("#doSimple").onclick = doSimple;
