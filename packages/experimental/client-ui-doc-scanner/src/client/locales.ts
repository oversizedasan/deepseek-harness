/** Locale-owned copy for the document-scanner composer chip, menu, and preview pane. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace for scanner controls. */
export const NS = 'doc-scanner'

/** Chinese dictionary and key source. */
export const zh = {
  connect: '连接并预览',
  capture: '拍一张',
  close: '断开高拍仪',
  clearBatch: '清空本批',
  batchCount: '本批 {count} 张',
  batchEmpty: '本批还没有照片',
  removeCapture: '从本批删除',
  openCapture: '查看本批大图',
  openBatchInFiles: '在文件中查看',
  lightboxDialog: '本批照片预览',
  lightboxClose: '关闭预览',
  czurHint: '支持用高拍仪按键连续采集；不满意的照片可在本批中删除',
  statusDisconnected: '高拍仪未连接',
  statusConnecting: '正在连接高拍仪…',
  statusDeviceMissing: '未检测到高拍仪',
  statusOpening: '正在打开高拍仪…',
  statusReady: '高拍仪已连接',
  statusCapturing: '高拍仪正在拍照…',
  statusError: '高拍仪连接出错',
  transportError: '无法连接高拍仪服务',
  previewAlt: '本批缩略图',
  previewLiveAlt: '高拍仪实时预览',
  previewWaiting: '等待预览…',
  previewNotReady: '连接高拍仪后显示实时预览',
  previewStarting: '正在启动预览…',
  tabTitle: '文档相机',
  draftMissingSession: '请先打开一个会话',
  draftFailed: '无法附上本批',
  draftOverLimit: '本批 {count} 张超过单次上限 {max} 张，请删减或分批附上',
  draftFolderRefSkipped: '图片已附上；归档目录引用未能插入',
  draftEmptyBatch: '请先拍几张再提问',
  batchAtLimit: '本批已达单次上限 {max} 张，请附上或删减后再拍',
  openBatchMissingPath: '本批还没有可打开的归档路径',
  openBatchMissingSession: '请先打开一个会话',
  archiveOpenFailed: '打不开本批归档，请确认工作区中仍有 {path}',
  archiveRehydrateEmpty: '草稿里的本批归档目录是空的或已不存在：{path}',
  archiveRehydrateFailed: '无法从归档恢复本批图片预览：{path}',
  busy: '处理中…',
  menuLabel: '文档相机',
  menuDescription: '连接高拍仪并打开文档相机预览',
  chipOpen: '打开文档相机',
  chipOpenWhileBatch: '打开文档相机',
  chipBatch: '附上本批 · {count}',
  folderChipLabel: '本批扫描 · {when}（{count} 张）',
  folderChipWhenToday: '今天 {time}',
  folderChipWhenOther: '{month}月{day}日 {time}',
} as const

/** Keys owned by this dictionary namespace. */
export type DocScannerKey = keyof typeof zh

/** English dictionary. */
export const en: { [K in DocScannerKey]: string } = {
  connect: 'Connect and preview',
  capture: 'Take a photo',
  close: 'Disconnect camera',
  clearBatch: 'Clear batch',
  batchCount: 'Batch · {count}',
  batchEmpty: 'No photos in this batch yet',
  removeCapture: 'Remove from batch',
  openCapture: 'View batch photo',
  openBatchInFiles: 'Show in files',
  lightboxDialog: 'Batch photo preview',
  lightboxClose: 'Close preview',
  czurHint: 'Use the scanner button for continuous capture; remove unclear photos from this batch',
  statusDisconnected: 'Document camera disconnected',
  statusConnecting: 'Connecting document camera…',
  statusDeviceMissing: 'No document camera detected',
  statusOpening: 'Opening document camera…',
  statusReady: 'Document camera connected',
  statusCapturing: 'Document camera capturing…',
  statusError: 'Document camera connection error',
  transportError: 'Document camera service unavailable',
  previewAlt: 'Batch thumbnail',
  previewLiveAlt: 'Document camera live preview',
  previewWaiting: 'Waiting for preview…',
  previewNotReady: 'Connect a document camera to show the live preview',
  previewStarting: 'Starting preview…',
  tabTitle: 'Document camera',
  draftMissingSession: 'Open a session first',
  draftFailed: 'Could not attach this batch',
  draftOverLimit: 'This batch has {count} images but the limit is {max} — remove some or attach in parts',
  draftFolderRefSkipped: 'Images attached; archive folder reference could not be inserted',
  draftEmptyBatch: 'Capture some photos before asking',
  batchAtLimit: 'Batch already has the maximum of {max} images — attach or remove some before capturing more',
  openBatchMissingPath: 'No archived path is available for this batch yet',
  openBatchMissingSession: 'Open a session first',
  archiveOpenFailed: 'Could not open this batch archive; check that {path} still exists in the workspace',
  archiveRehydrateEmpty: 'The draft batch archive is empty or missing: {path}',
  archiveRehydrateFailed: 'Could not restore batch image previews from the archive: {path}',
  busy: 'Working…',
  menuLabel: 'Document camera',
  menuDescription: 'Connect a document scanner and open the live preview',
  chipOpen: 'Open document camera',
  chipOpenWhileBatch: 'Open document camera',
  chipBatch: 'Attach batch · {count}',
  folderChipLabel: 'Batch scan · {when} ({count})',
  folderChipWhenToday: 'Today {time}',
  folderChipWhenOther: '{month}/{day} {time}',
}

/** Japanese dictionary; currently the English copy. */
export const ja = { ...en }
/** Spanish dictionary; currently the English copy. */
export const es = { ...en }
/** French dictionary; currently the English copy. */
export const fr = { ...en }
/** German dictionary; currently the English copy. */
export const de = { ...en }
/** Russian dictionary; currently the English copy. */
export const ru = { ...en }
/** Portuguese dictionary; currently the English copy. */
export const pt = { ...en }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Experimental document-scanner composer and preview controls. */
    'doc-scanner': DocScannerKey
  }
}
