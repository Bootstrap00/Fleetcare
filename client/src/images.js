// Shrink a photo in the browser before uploading: longest side max 1280px, JPEG, under ~330 KB.
export async function resizeImage(file, max = 1280) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  if (file.size > 25e6) throw new Error('Choose an image under 25 MB');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('Could not read that image. Try a JPG or PNG.'); }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.85, out = c.toDataURL('image/jpeg', q);
  while (out.length > 440000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
  return out;
}
