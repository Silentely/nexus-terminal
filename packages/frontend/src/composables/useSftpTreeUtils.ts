/**
 * SFTP 文件树操作工具模块
 * 职责：文件树节点的查找、创建占位符、移除、添加/更新
 */
import { reactive } from 'vue';
import type { FileAttributes } from '../types/sftp.types';
import type { FileTreeNode } from './useSftpActions';
import { log } from '@/utils/log';

// 文件排序比较函数
type SortableSftpEntry = Pick<{ filename: string; attrs: FileAttributes }, 'filename' | 'attrs'>;

export const sortFiles = (a: SortableSftpEntry, b: SortableSftpEntry): number => {
  if (a.attrs.isDirectory && !b.attrs.isDirectory) return -1;
  if (!a.attrs.isDirectory && b.attrs.isDirectory) return 1;
  return a.filename.localeCompare(b.filename);
};

/**
 * 在文件树中查找节点，可选创建占位符
 */
export const findNodeByPath = (
  root: FileTreeNode,
  path: string,
  instanceSessionId: string,
  createIfMissing: boolean = false,
): FileTreeNode | null => {
  if (path === '/') return root;
  const parts = path.split('/').filter((p) => p);
  let currentNode: FileTreeNode = root;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    let nextNode: FileTreeNode | undefined;

    if (currentNode.children) {
      nextNode = currentNode.children.find((child) => child.filename === part);
      if (!nextNode) {
        if (!currentNode.childrenLoaded && !createIfMissing) {
          log.info(
            `[SFTP ${instanceSessionId}] findNodeByPath: Node ${part} not found in partially loaded children of ${currentNode.filename}.`,
          );
          return null;
        }
        if (currentNode.childrenLoaded && !createIfMissing) {
          log.info(
            `[SFTP ${instanceSessionId}] findNodeByPath: Node ${part} not found in fully loaded children of ${currentNode.filename}.`,
          );
          return null;
        }
      }
    } else if (currentNode.children === null) {
      if (!createIfMissing) {
        log.info(
          `[SFTP ${instanceSessionId}] findNodeByPath: Children of ${currentNode.filename} are null, cannot find ${part}.`,
        );
        return null;
      }
      log.info(
        `[SFTP ${instanceSessionId}] findNodeByPath: Children of ${currentNode.filename} are null, will create placeholder for ${part}.`,
      );
      currentNode.children = [];
    } else if (!currentNode.attrs.isDirectory) {
      log.warn(
        `[SFTP ${instanceSessionId}] findNodeByPath: Attempted to find child '${part}' under a file node '${currentNode.filename}'.`,
      );
      return null;
    }

    if (!nextNode) {
      if (createIfMissing) {
        const placeholderAttrs: FileAttributes = {
          isDirectory: true,
          isFile: false,
          isSymbolicLink: false,
          size: 0,
          mtime: 0,
          atime: 0,
          uid: 0,
          gid: 0,
          mode: 0o755,
        };
        nextNode = reactive({
          filename: part,
          longname: part,
          attrs: placeholderAttrs,
          children: null,
          childrenLoaded: false,
        });
        if (!currentNode.children) {
          currentNode.children = [];
        }
        currentNode.children.push(nextNode);
        currentNode.children.sort(sortFiles);
        log.info(
          `[SFTP ${instanceSessionId}] findNodeByPath: Created placeholder node for ${part} under ${currentNode.filename}`,
        );
      } else {
        log.info(
          `[SFTP ${instanceSessionId}] findNodeByPath: Node ${part} not found under ${currentNode.filename} and createIfMissing is false.`,
        );
        return null;
      }
    }
    if (!nextNode) {
      log.error(
        `[SFTP ${instanceSessionId}] findNodeByPath: Logic error - nextNode is still undefined for part '${part}'.`,
      );
      return null;
    }
    currentNode = nextNode;
  }

  return currentNode;
};

/**
 * 从文件树中移除节点
 */
export const removeNodeFromTree = (
  fileTree: FileTreeNode,
  parentPath: string,
  filename: string,
  instanceSessionId: string,
): boolean => {
  const parentNode = findNodeByPath(fileTree, parentPath, instanceSessionId);
  if (parentNode && parentNode.children) {
    const index = parentNode.children.findIndex((node) => node.filename === filename);
    if (index !== -1) {
      parentNode.children.splice(index, 1);
      log.info(`[SFTP ${instanceSessionId}] 从文件树 ${parentPath} 中移除节点: ${filename}`);
      return true;
    }
  }
  log.warn(`[SFTP ${instanceSessionId}] 尝试从文件树 ${parentPath} 移除节点 ${filename} 失败`);
  return false;
};

/**
 * 向文件树添加或更新节点（允许创建父节点占位符）
 */
export const addOrUpdateNodeInTree = (
  fileTree: FileTreeNode,
  parentPath: string,
  item: { filename: string; longname: string; attrs: FileAttributes },
  instanceSessionId: string,
): boolean => {
  const parentNode = findNodeByPath(fileTree, parentPath, instanceSessionId, true);

  if (parentNode) {
    if (parentNode.children === null) {
      parentNode.children = [];
    }

    if (!Array.isArray(parentNode.children)) {
      log.error(
        `[SFTP ${instanceSessionId}] Logic error: parentNode.children is not an array after findNodeByPath in addOrUpdateNodeInTree for path ${parentPath}`,
      );
      return false;
    }

    const newNode: FileTreeNode = reactive({
      filename: item.filename,
      longname: item.longname,
      attrs: item.attrs,
      children: item.attrs.isDirectory ? null : [],
      childrenLoaded: !item.attrs.isDirectory,
    });

    const existingIndex = parentNode.children.findIndex((node) => node.filename === item.filename);
    if (existingIndex !== -1) {
      parentNode.children.splice(existingIndex, 1, newNode);
      log.info(`[SFTP ${instanceSessionId}] 更新文件树节点: ${parentPath}/${item.filename}`);
    } else {
      let insertIndex = 0;
      while (
        insertIndex < parentNode.children.length &&
        sortFiles(newNode, parentNode.children[insertIndex]) > 0
      ) {
        insertIndex++;
      }
      parentNode.children.splice(insertIndex, 0, newNode);
      log.info(`[SFTP ${instanceSessionId}] 添加文件树节点: ${parentPath}/${item.filename}`);
    }
    return true;
  }
  log.error(
    `[SFTP ${instanceSessionId}] Failed to find or create parent node ${parentPath} in addOrUpdateNodeInTree for item ${item.filename}.`,
  );
  return false;
};

/** 树操作依赖 */
export interface TreeUtilsDeps {
  fileTree: FileTreeNode;
  instanceSessionId: string;
}
