export function createSpaceMouseButton(viewer) {
  if (typeof navigator === 'undefined' || !navigator.hid) return null;
  const onClick = () => { try { viewer?.requestSpaceMouse?.(); } catch {} };
  return { label: '3D', title: 'Connect SpaceMouse (WebHID)', onClick };
}
