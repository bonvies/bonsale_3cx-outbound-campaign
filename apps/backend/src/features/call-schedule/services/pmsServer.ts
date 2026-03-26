import { logWithTimestamp } from '@shared-local/util/timestamp';
import fiasHandler from '../components/fiasHandler';
import nortelPmsHandler from '../components/nortelPmsHandler';
import { createServer as createFiasServer } from '../util/fias';
import { createServer as createNortelPmsServer } from '../util/nortelPms';

// ─────────────────────────────────────────────
// PMS Protocol 切換點
//
// 根據 PMS_PROTOCOL 環境變數選擇要啟動的 TCP server：
//   FIAS      → FIAS 協定（STX/ETX framing）
//   NortelPMS → Nortel PMS 協定（純文字指令）
//
// 新增協定：
//   1. 在 util/ 新增 TCP server 解析實作
//   2. 在 components/ 新增 handler
//   3. 在此檔加入 case
// ─────────────────────────────────────────────

type PmsProtocol = 'FIAS' | 'NortelPMS';

function getProtocol(): PmsProtocol {
  const raw = process.env.PMS_PROTOCOL;
  if (!raw) throw new Error('[pmsServer] 環境變數 PMS_PROTOCOL 未設定（FIAS / NortelPMS）');
  if (raw !== 'FIAS' && raw !== 'NortelPMS') {
    throw new Error(`[pmsServer] PMS_PROTOCOL 值無效：「${raw}」，只接受 FIAS 或 NortelPMS`);
  }
  return raw;
}

export function startPmsServer(port: number): void {
  const protocol = getProtocol();

  let server: ReturnType<typeof createFiasServer>;

  switch (protocol) {
    case 'FIAS':
      server = createFiasServer(async (msg, conn) => {
        await fiasHandler(msg, conn);
      });
      break;

    case 'NortelPMS':
      server = createNortelPmsServer(async (msg, conn) => {
        await nortelPmsHandler(msg, conn);
      });
      break;
  }

  server.listen(port, () => {
    logWithTimestamp({ isForce: true }, `📡 PMS TCP server (${protocol}) is running on port ${port}`);
  });
}
