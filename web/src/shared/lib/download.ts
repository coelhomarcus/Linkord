/** Forces a browser download of a same-origin URL. `target="_blank"` is not
 * cosmetic: a same-tab navigation could unmount the app and drop an ongoing
 * call, even with the server forcing download via Content-Disposition (see
 * ChatAttachment.tsx). The anchor is never actually inserted visibly — it
 * only needs to exist in the DOM for `.click()` to work in every browser. */
export function downloadFile(url: string, name: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
