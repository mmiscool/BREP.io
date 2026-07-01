# Wire Harness Workbench

The Wire Harness workbench is for routed wire runs across assembly ports and spline-guided harness paths. It narrows feature creation to harness authoring geometry and exposes the harness connection list in the sidebar.

## Features
- [Datium](../features/datium.md)
- [Plane](../features/plane.md)
- [Assembly Component](../features/assembly-component.md)
- [Spline](../features/spline.md)
- [Port](../features/port.md)

## Panels
- [Feature History](../panels/feature-history.md)
- [Assembly Constraints](../panels/assembly-constraints.md)
- [Wire Harness](../panels/wire-harness.md)
- [PMI Views](../panels/pmi-views.md)
- [2D Sheets](../panels/sheets-2d.md)
- [Plugins](../panels/plugins.md)

## Typical Workflow
1. Add the assembly components that contain the ports you want to connect.
2. Add ports and create spline features that define the allowed harness path through the model.
3. Attach spline points to ports and confirm the correct side selection (`A` or `B`) for each attachment.
4. Use the Wire Harness panel to add wires, set endpoint labels, and enter the wire diameter for each connection.
5. Click `Route` to rebuild the harness. The list reports route length and status for each wire.
6. Hover a row to highlight the related ports and routed tube geometry.
7. Click `To Sheet` to place the current connection list on a 2D sheet.

## Routing Notes
- Routing operates on the spline network built from the current harness splines and attached ports.
- The router respects attached port side selection. If no valid sided path exists, the wire remains unrouted and the status column shows the failure.
- Shared spline segments render as a bundle. Segment diameter increases as more wires use that segment.
- The `Route` action also shows the JSON payload passed into the routing logic, which is useful when debugging a harness setup.

## Related Docs
- [Assemblies Workbench](./assemblies.md)
- [2D Sheets Mode](../modes/sheets.md)
- [Spline](../features/spline.md)
