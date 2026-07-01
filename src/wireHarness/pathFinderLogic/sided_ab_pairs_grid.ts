import {makeTestGridAbGraph, makeTestGridAbPointPairs, sidedAdPairsResolve} from "./demo.js"
import {_setUseMinHeap} from "./js/digraphs/spt.js"

async function doGrid() {
  _setUseMinHeap(document.querySelector("#useMinHeap").checked);
  // - for debugging needs (measuring speed); normally should be true

  const width = document.querySelector("#gridWidth").value;
  const height = document.querySelector("#gridHeight").value;
  const straightWeight = document.querySelector("#straightWeight").value;
  const diagonalWeight = document.querySelector("#diagonalWeight").value;
  const includeDiagonals = document.querySelector("#includeDiagonals").checked;
  const brief = document.querySelector("#brief").checked;
  const numberOfPairs = parseInt(document.querySelector("#numberOfPairs").value);
  const randomSeed = parseInt(document.querySelector("#randomSeed").value);
  const t1 = performance.now();
  const segments = makeTestGridAbGraph(width, height, straightWeight, diagonalWeight, includeDiagonals);
  const pairs = makeTestGridAbPointPairs(width, height, numberOfPairs, randomSeed);
  document.querySelector("#segments").value = JSON.stringify(segments, null, 2);
  document.querySelector("#pairs").value = JSON.stringify(pairs, null, 2);
  const t2 = performance.now();
  document.querySelector("#preparingTiming").innerHTML = "Preparing: " + (t2 - t1) + " ms";

  document.querySelector("#doGrid").disabled = true;
  // - important to prevent starting new threads of calculations while processing is not finished
  const report = await sidedAdPairsResolve(segments, pairs, brief, "error", "timing", "progressBar");
  document.querySelector("#doGrid").disabled = false;

  document.querySelector("#results").value = report;
}

document.querySelector("#doGrid").onclick = doGrid;
