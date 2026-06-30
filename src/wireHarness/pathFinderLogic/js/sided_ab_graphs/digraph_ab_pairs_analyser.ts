import {DigraphABPointPair} from "./digraph_ab_elements.js"
import {DigraphABShortestPathFinder} from "./digraph_ab_shortest_path_finder.js"

type PointPairInput = {
  startPoint?: string;
  endPoint?: string;
  id?: string | null;
  wireInfo?: any;
};

export function simpleArrayToPointPairs(array: PointPairInput[]) {
  const result: DigraphABPointPair[] = [];
  for (const pair of array) {
    if (pair.startPoint == null)
      throw "No startPoint in element " + JSON.stringify(pair);
    if (pair.endPoint == null)
      throw "No endPoint in element " + JSON.stringify(pair);
    result.push(new DigraphABPointPair(pair.startPoint, pair.endPoint, pair.id, pair.wireInfo));
  }
  return result;
}

export function findShortestPathForAllPairs(digraph: any, pointPairsArray: DigraphABPointPair[]) {
  sortPointPairArray(pointPairsArray);
  const finder = new DigraphABShortestPathFinder(digraph);
  for (const pair of pointPairsArray) {
    finder.processPair(pair);
  }
  return pointPairsArray;
}

// Example:
//     function showProgressBar(part) {
//         // part is a number from 0.0 to 1.0
//         document.getElementById("progressBar").value = Math.round(part * 100)
//     }
// IMPORTANT: this function SHOULD be called with "await" operator
// (if you want to get correct pointPairsArray after its execution)
export async function findShortestPathForAllPairsAsync(
  digraph: any,
  pointPairsArray: DigraphABPointPair[],
  showProgressBar?: ((part: number) => void) | null,
) {
  let lastTime = performance.now();
  sortPointPairArray(pointPairsArray);
  const finder = new DigraphABShortestPathFinder(digraph);
  for (let i = 0, n = pointPairsArray.length; i < n; i++) {
    lastTime = await updateProgress(i, n, showProgressBar, lastTime);
    finder.processPair(pointPairsArray[i]);
  }
  return pointPairsArray;
}

export function sortPointPairArray(pairArray: DigraphABPointPair[]) {
  pairArray.sort(function (a, b) {
    if (a.startPoint > b.startPoint) {
      return 1;
    }
    if (a.startPoint < b.startPoint) {
      return -1;
    }
    return 0;
  });
}

// private
async function updateProgress(i: number, n: number, showProgressBar: ((part: number) => void) | null | undefined, lastTime: number) {
  if (n <= 1) {
    return lastTime;
  }
  if (i != n - 1) {
    // n-1 is shown always
    const t = performance.now();
//        console.log(lastTime +"; " + (t - lastTime));
    if (lastTime != null && t - lastTime < 200) {
      // less than 200 ms from last showing
      return lastTime;
    }
    lastTime = t;
  }
  if (showProgressBar != null) {
    showProgressBar(i / (n - 1));
  }
  if (i != n - 1) {
    await sleep(1);
  }
  return lastTime;
}

// private
async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

