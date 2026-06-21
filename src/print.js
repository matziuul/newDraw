import { buildSvg } from './svg-export.js';

export function printDrawing(shapes, width, height) {
    const svg = buildSvg(shapes, width, height);
    const win = window.open('', '_blank');
    if (!win) { alert('Allow popups to print.'); return; }

    win.document.write(`<!DOCTYPE html><html><head><title>MacDraw</title>
<style>
* { margin: 0 }
body { background: white }
svg { max-width: 100%; height: auto; display: block }
@media print { @page { margin: 10mm; size: auto } }
</style>
</head><body>${svg}</body></html>`);
    win.document.close();
    win.addEventListener('afterprint', () => win.close());
    setTimeout(() => win.print(), 100);
}
