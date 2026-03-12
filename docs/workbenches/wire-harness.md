# Wire Harness Workbench

The Wire Harness workbench is for building routed wire runs across assembly ports and spline-guided harness paths. It narrows the creation tools to the geometry and assembly setup needed for harness authoring, while exposing the harness connection list in the sidebar.

## Features
- [Datium](../features/datium.md)
- [Plane](../features/plane.md)
- [Assembly Component](../features/assembly-component.md)
- [Spline](../features/spline.md)
- Port

## Side Panels
- `Harness Connections`: create wires, set `From` and `To` endpoints, assign wire diameters, route the harness, inspect route status and length, hover rows to highlight the routed path, and insert the current connection list into a 2D sheet as an editable table.
- `Assembly Constraints`: stays available for positioning the components that own the ports.
- `PMI Views`: remains available in the same way it is in other modeling-oriented workbenches.

## Typical Workflow
1. Add the assembly components that contain the ports you want to connect.
2. Add ports and create spline features that define the allowed harness path through the model.
3. Attach spline points to ports and confirm the correct side selection (`A` or `B`) for each attachment.
4. Use the `Harness Connections` panel to add wires, set endpoint labels, and enter the wire diameter for each connection.
5. Click `Route` to rebuild the harness. The list reports route length and status for each wire.
6. Hover a row in the connection list to highlight the related ports and the routed tube geometry in the viewport.
7. Click `To Sheet` to insert the current connection list into a 2D sheet if you want the harness schedule on a drawing page.

## Routing Notes
- Routing operates on the spline network built from the current harness splines and attached ports.
- The router respects attached port side selection. If no valid sided path exists, the wire remains unrouted and the status column shows the failure.
- Shared spline segments render as a bundle. Segment diameter increases as more wires use that segment.
- The `Route` action also shows the exact JSON payload being passed into the routing logic, which is useful when debugging a harness setup.

## Related Docs
- [Assemblies Workbench](assemblies.md)
- [2D Sheets Mode](../modes/sheets.md)
- [Spline](../features/spline.md)
