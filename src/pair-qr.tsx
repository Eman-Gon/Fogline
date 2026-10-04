import { useEffect, useRef, useState } from 'react';
import qrcode from './vendor/qrcode-generator.js';
import { codeFromScan } from './pair-link';

export function QrMark({ value }: { value: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const cells = [];
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) cells.push(`${col},${row}`);
  return <svg className="pair-qr" role="img" aria-label="Pairing QR code" viewBox={`0 0 ${count + 8} ${count + 8}`}>
    <rect width={count + 8} height={count + 8} fill="#fff" />
    {cells.map(cell => { const [col, row] = cell.split(',').map(Number); return <rect key={cell} x={col + 4} y={row + 4} width="1" height="1" fill="#142b34" />; })}
  </svg>;
}

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

export function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const saved = useRef(onCode);
  saved.current = onCode;
  const [note, setNote] = useState('');
  useEffect(() => {
    const DetectorCtor = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!DetectorCtor || !navigator.mediaDevices?.getUserMedia) {
      setNote('This browser cannot scan inside the page. Use the phone camera on the QR code instead.');
      return;
    }
    let stop = false;
    let stream: MediaStream | null = null;
    const detector = new DetectorCtor({ formats: ['qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async next => {
      stream = next;
      if (!video.current) return;
      video.current.srcObject = next;
      await video.current.play();
      const tick = async () => {
        if (stop || !video.current) return;
        try {
          const found = (await detector.detect(video.current)).map(item => codeFromScan(item.rawValue)).find(Boolean);
          if (found) { saved.current(found); return; }
        } catch { /* The camera frame is not ready yet. */ }
        if (!stop) window.setTimeout(() => void tick(), 250);
      };
      void tick();
    }).catch(() => setNote('Camera is off. Type the code, or scan the QR with the phone camera.'));
    return () => { stop = true; stream?.getTracks().forEach(track => track.stop()); };
  }, []);
  return <div>{note ? <p className="muted">{note}</p> : <video ref={video} className="scan-video" muted playsInline aria-label="Camera looking for a pairing QR code" />}</div>;
}
