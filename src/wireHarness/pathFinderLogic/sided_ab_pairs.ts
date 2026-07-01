import {parseJsonAndPrintError, sidedAdPairsResolve} from "./demo.js"

async function doAnalyse() {
  const segments = parseJsonAndPrintError(document.querySelector("#segments").value, "error");
  const pairs = parseJsonAndPrintError(document.querySelector("#pairs").value, "error");
  const report = await sidedAdPairsResolve(segments, pairs, false, "error", "timing", null);
  document.querySelector("#results").value = report;
}

document.querySelector("#doAnalyse").onclick = doAnalyse;
