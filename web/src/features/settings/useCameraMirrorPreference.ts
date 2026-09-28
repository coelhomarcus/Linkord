const KEY = 'ss-mirror-camera-preview';

// Mirrored by default, matching every other video call product's self-view
// — it reads as "looking in a mirror", which is what people expect to see
// of themselves. Presentation only: never flips the track that's sent.
export function loadMirrorCameraPreview(): boolean {
  return localStorage.getItem(KEY) !== '0';
}

export function saveMirrorCameraPreview(value: boolean): void {
  localStorage.setItem(KEY, value ? '1' : '0');
}
