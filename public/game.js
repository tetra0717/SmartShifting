// Start game rules here. Identification and camera code stay in Glint modules.
// objectId is zero-based; deviceId identifies this phone's browser connection.
export function connectGame(input, { animate }) {
  input.addEventListener('acquired', ({ detail }) => {
    animate(detail.objectId);
    document.dispatchEvent(new CustomEvent('glint:acquired', { detail }));
  });
  input.addEventListener('released', ({ detail }) => {
    document.dispatchEvent(new CustomEvent('glint:released', { detail }));
  });
}
