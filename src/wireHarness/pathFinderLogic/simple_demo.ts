    import {makeTestGridGraph, parseJsonAndPrintError, simpleResolve} from "./demo.js"

    function doSimple() {
      const startVertex = document.querySelector("#simpleStart").value;
      const endVertex = document.querySelector("#simpleEnd").value;
      const graphJson = parseJsonAndPrintError(document.querySelector("#graphJson").value, "simpleError");
//        let node = simpleObjectToGraphNode("0", new Array(["1", "2"]));
//        document.querySelector("#simpleResults").innerHTML = JSON.stringify(node);
//        let g = simpleObjectToDigraph(graphJson);
//        document.querySelector("#simpleResults").innerHTML = JSON.stringify(Array.from(g.nodeMap.entries()));
      const report = simpleResolve(graphJson, startVertex, endVertex, "simpleError");
      document.querySelector("#simpleResults").innerHTML = report;
    }

    function doGrid() {
      const startVertex = document.querySelector("#gridStart").value;
      const endVertex = document.querySelector("#gridEnd").value;
      const graphJson = makeTestGridGraph(
        document.querySelector("#gridWidth").value,
        document.querySelector("#gridHeight").value,
        document.querySelector("#straightWeight").value,
        document.querySelector("#diagonalWeight").value,
        document.querySelector("#includeDiagonals").checked);
      const report = simpleResolve(graphJson, startVertex, endVertex, "gridError");
      document.querySelector("#gridResults").innerHTML = report;
    }

    document.querySelector("#doSimple").onclick = doSimple;
    document.querySelector("#doGrid").onclick = doGrid;
