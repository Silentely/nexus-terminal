// packages/frontend/src/stores/session/actions/modalActions.ts

import { isRdpModalOpen, rdpConnectionInfo, isVncModalOpen, vncConnectionInfo } from '../state';
import type { ConnectionInfo } from '../../connections.store'; // 路径: packages/frontend/src/stores/connections.store.ts

// --- RDP Modal Actions ---
export const openRdpModal = (connection: ConnectionInfo) => {
  // console.log(`[ModalActions] Opening RDP modal for connection: ${connection.name} (ID: ${connection.id})`);
  rdpConnectionInfo.value = connection;
  isRdpModalOpen.value = true;
};

export const closeRdpModal = () => {
  // console.log('[ModalActions] Closing RDP modal.');
  isRdpModalOpen.value = false;
  rdpConnectionInfo.value = null; // 清除连接信息
};

// --- VNC Modal Actions ---
export const openVncModal = (connection: ConnectionInfo) => {
  // console.log(`[ModalActions] Opening VNC modal for connection: ${connection.name} (ID: ${connection.id})`);
  vncConnectionInfo.value = connection;
  isVncModalOpen.value = true;
};

export const closeVncModal = () => {
  // console.log('[ModalActions] Closing VNC modal.');
  isVncModalOpen.value = false;
  vncConnectionInfo.value = null; // 清除连接信息
};
