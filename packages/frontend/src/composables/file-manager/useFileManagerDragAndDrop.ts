import { ref, type Ref } from 'vue';
import type { FileListItem } from '../../types/sftp.types'; // 确保路径正确

// 定义 Composable 的输入参数类型
export interface UseFileManagerDragAndDropOptions {
  // 响应式引用
  isConnected: Ref<boolean>;
  currentPath: Ref<string>;
  fileListContainerRef: Ref<HTMLDivElement | null>; // 文件列表容器的引用
  selectedItems: Ref<Set<string>>; // 当前选中的项目集合
  fileList: Ref<Readonly<FileListItem[]>>; // 完整的文件列表 (用于查找选中项的对象)

  // 函数依赖
  joinPath: (base: string, target: string) => string; // 路径拼接函数
  onFileUpload: (file: File, relativePath?: string) => void; // 修改：触发文件上传的回调，增加相对路径
  onItemMove: (sourceItem: FileListItem, newFullPath: string) => void; // 触发文件/文件夹移动的回调
}

export function useFileManagerDragAndDrop(options: UseFileManagerDragAndDropOptions) {
  const {
    isConnected,
    currentPath,
    fileListContainerRef,
    joinPath,
    onFileUpload,
    onItemMove,
    selectedItems, // 获取传入的 selectedItems
    fileList, // 获取传入的 fileList
  } = options;

  // --- 拖放状态 Refs ---
  // const isDraggingOver = ref(false); // 不再使用，由 showExternalDropOverlay 替代外部拖拽状态
  const showExternalDropOverlay = ref(false); // 控制外部文件拖拽蒙版的显示
  const draggedItem = ref<FileListItem | null>(null); // 内部拖拽时，被拖拽的项
  const dragOverTarget = ref<string | null>(null); // 内部拖拽时，悬停的目标文件夹名称 (用于行高亮)
  const scrollIntervalId = ref<number | null>(null); // 自动滚动计时器 ID

  // --- 自动滚动常量 ---
  const SCROLL_ZONE_HEIGHT = 50; // px
  const SCROLL_SPEED = 10; // px per interval

  // --- 辅助函数：停止自动滚动 ---
  const stopAutoScroll = () => {
    if (scrollIntervalId.value !== null) {
      clearInterval(scrollIntervalId.value);
      scrollIntervalId.value = null;
    }
  };

  // --- 事件处理函数 ---
  const handleDragEnter = (event: DragEvent) => {
    // 检查是否是外部文件拖拽
    const isExternalFileDrag = event.dataTransfer?.types.includes('Files') ?? false;
    if (isConnected.value && isExternalFileDrag && !draggedItem.value) {
      // 确保不是内部拖拽触发
      // console.log("[DragDrop] External file drag entered container.");
      showExternalDropOverlay.value = true; // 显示蒙版
    } else if (draggedItem.value) {
      // console.log("[DragDrop] Internal item drag entered container area.");
      // 内部拖拽进入容器但不在行上，可能需要处理效果，但不显示蒙版
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'; // 默认在容器空白处无效
    }
  };

  const handleDragOver = (event: DragEvent) => {
    // 这个函数现在主要负责处理内部拖拽时的自动滚动
    // 外部文件拖拽的 dragover 由蒙版处理 (只阻止默认行为)
    const isExternalFileDrag = event.dataTransfer?.types.includes('Files') ?? false;
    const isInternalDrag = !!draggedItem.value;

    // 1. 如果是外部文件拖拽，确保蒙版是显示的，并设置效果
    if (isExternalFileDrag && isConnected.value && !isInternalDrag) {
      // 再次确认不是内部拖拽
      showExternalDropOverlay.value = true; // 确保蒙版显示
      event.preventDefault(); // 必须阻止默认行为以允许 drop
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; // 指示效果
      // 外部拖拽时，不处理容器的自动滚动，因为鼠标在蒙版上
      stopAutoScroll();
      return; // 外部拖拽不由容器 handleDragOver 处理滚动
    }

    // 2. 如果是内部拖拽
    if (isInternalDrag && isConnected.value) {
      // 内部拖拽时，dragover 主要由行处理 (handleDragOverRow)
      // 但如果鼠标在行之间或空白区域，容器的 dragover 会触发
      // 此时需要处理自动滚动，并阻止默认行为
      event.preventDefault(); // 阻止默认行为（如文本选择），允许滚动逻辑
      // 效果由 handleDragOverRow 设置，但在空白区域应为 none
      const targetElement = event.target as HTMLElement;
      const targetRow = targetElement.closest('tr.file-row');
      if (!targetRow && event.dataTransfer) {
        // 如果不在行上
        event.dataTransfer.dropEffect = 'none';
        dragOverTarget.value = null; // 清除行高亮
      } else if (event.dataTransfer) {
        // 如果在行上，效果由 handleDragOverRow 控制，这里假设为 move
        event.dataTransfer.dropEffect = 'move';
      }

      // --- 处理自动滚动 ---
      const container = fileListContainerRef.value;
      // 只有在内部拖拽且悬停目标有效(在行上)时才滚动
      if (container && dragOverTarget.value) {
        // 依赖 handleDragOverRow 设置的 dragOverTarget
        const rect = container.getBoundingClientRect();
        const mouseY = event.clientY - rect.top;

        if (mouseY < SCROLL_ZONE_HEIGHT) {
          if (scrollIntervalId.value === null) {
            scrollIntervalId.value = window.setInterval(() => {
              if (container.scrollTop > 0) {
                container.scrollTop -= SCROLL_SPEED;
              } else {
                stopAutoScroll();
              }
            }, 30);
          }
        } else if (mouseY > container.clientHeight - SCROLL_ZONE_HEIGHT) {
          if (scrollIntervalId.value === null) {
            scrollIntervalId.value = window.setInterval(() => {
              if (container.scrollTop < container.scrollHeight - container.clientHeight) {
                container.scrollTop += SCROLL_SPEED;
              } else {
                stopAutoScroll();
              }
            }, 30);
          }
        } else {
          stopAutoScroll(); // 在中间区域停止滚动
        }
      } else {
        stopAutoScroll(); // 如果不在滚动区域或目标无效，停止滚动
      }
      return; // 内部拖拽处理完毕
    }

    // 3. 其他情况 (非文件、非内部拖拽、未连接)
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    stopAutoScroll(); // 停止滚动
    // 不一定需要阻止默认行为 event.preventDefault();
  };

  const handleDragLeave = (event: DragEvent) => {
    const target = event.relatedTarget as Node | null;
    const container = event.currentTarget as HTMLElement;
    // 检查是否真的离开了容器边界
    if (!target || !container.contains(target)) {
      // console.log("[DragDrop] Drag left container boundary.");
      if (showExternalDropOverlay.value) {
        // console.log("[DragDrop] Hiding external drop overlay due to leaving container.");
        showExternalDropOverlay.value = false; // 隐藏蒙版
      }
      // isDraggingOver.value = false; // 不再使用
      dragOverTarget.value = null; // 清除行高亮
      stopAutoScroll(); // 停止滚动
    } else {
      // console.log("[DragDrop] Drag left fired but still inside container.");
      // 鼠标仍在容器内（可能移到了子元素上），不隐藏蒙版或清除状态
      // 但如果是内部拖拽移到了非行区域，需要清除行高亮
      if (draggedItem.value) {
        const relatedRow = target instanceof HTMLElement ? target.closest('tr.file-row') : null;
        if (!relatedRow) {
          dragOverTarget.value = null;
        }
      }
    }
  };

  // --- 递归遍历文件树的辅助函数 ---
  const traverseFileTree = (item: FileSystemEntry, basePath = '') => {
    const currentPath = basePath || '';
    if (item.isFile) {
      // 文件处理
      (item as FileSystemFileEntry).file(
        (file) => {
          // 调用上传函数，传递文件和相对路径
          console.log(`[DragDrop] Uploading file: ${currentPath}${file.name}`);
          onFileUpload(file, currentPath); // 传递相对路径
        },
        (err) => {
          console.error(
            `[DragDrop] Error getting file from entry: ${currentPath}${item.name}`,
            err
          );
        }
      );
    } else if (item.isDirectory) {
      // 目录处理
      const dirReader = (item as FileSystemDirectoryEntry).createReader();
      dirReader.readEntries(
        (entries) => {
          console.log(
            `[DragDrop] Traversing directory: ${currentPath}${item.name}, found ${entries.length} entries.`
          );
          // 递归遍历目录中的每个条目
          entries.forEach((entry) => {
            traverseFileTree(entry, `${currentPath + item.name}/`); // 更新相对路径
          });
        },
        (err) => {
          console.error(
            `[DragDrop] Error reading directory entries: ${currentPath}${item.name}`,
            err
          );
        }
      );
    }
  };

  // 处理蒙版上的 Drop 事件
  const handleOverlayDrop = (event: DragEvent) => {
    event.preventDefault(); // 必须阻止，以防浏览器打开文件
    showExternalDropOverlay.value = false; // 隐藏蒙版
    stopAutoScroll(); // 停止滚动

    const items = event.dataTransfer?.items;
    if (!items || items.length === 0 || !isConnected.value) {
      console.log('[DragDrop] Overlay drop ignored: No items or not connected.');
      return;
    }

    console.log(`[DragDrop] Processing ${items.length} items from overlay drop.`);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          traverseFileTree(entry); // 处理文件/文件夹
        } else {
          console.warn(`[DragDrop] Could not get entry for item ${i} from overlay.`);
        }
      }
    }
  };

  // 原有的 handleDrop (容器的 drop) 现在基本不需要了，
  // 因为外部 drop 由蒙版处理，内部 drop 由行处理并阻止冒泡。
  // 保留一个空的或只做清理的函数以防万一。
  const handleDrop = (event: DragEvent) => {
    // console.log("[DragDrop] Container drop event triggered (should be rare).");
    // 清理所有状态以防异常情况
    showExternalDropOverlay.value = false;
    draggedItem.value = null; // 清理内部拖拽状态
    dragOverTarget.value = null; // 清理行高亮
    stopAutoScroll(); // 停止滚动
    // 阻止默认行为以防万一
    event.preventDefault();
  };

  const handleDragStart = (item: FileListItem) => {
    if (item.filename === '..') return;
    // console.log(`[DragDrop] Drag Start: ${item.filename}`);
    draggedItem.value = item;
  };

  const handleDragEnd = () => {
    // console.log(`[DragDrop] Drag End`);
    draggedItem.value = null;
    dragOverTarget.value = null;
    stopAutoScroll();
    // 最好由 CSS :active 或其他状态处理，但作为后备
    document
      .querySelectorAll('.file-row.drop-target')
      .forEach((el) => el.classList.remove('drop-target'));
  };

  const handleDragOverRow = (targetItem: FileListItem, event: DragEvent) => {
    event.preventDefault(); // 允许 drop 在行上
    event.stopPropagation(); // 阻止事件冒泡到容器的 handleDragOver

    // 内部拖拽逻辑: 只能拖拽非 '..' 项，目标必须是文件夹或 '..'，且不能是自身
    if (
      !draggedItem.value ||
      draggedItem.value.filename === '..' ||
      (targetItem.filename !== '..' &&
        (!targetItem.attrs.isDirectory || draggedItem.value.filename === targetItem.filename))
    ) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      dragOverTarget.value = null; // 清除可能存在的旧目标
      return;
    }
    // 设置放置效果为 'move' 并记录目标
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverTarget.value = targetItem.filename; // 更新悬停目标
  };

  const handleDragLeaveRow = (targetItem: FileListItem) => {
    // 只有当鼠标离开当前高亮的目标行时才清除高亮状态
    if (dragOverTarget.value === targetItem.filename) {
      dragOverTarget.value = null;
    }
  };

  const handleDropOnRow = (targetItem: FileListItem, event: DragEvent) => {
    event.preventDefault(); // 确保阻止默认行为（例如导航）
    event.stopPropagation(); // 阻止事件冒泡到容器的 handleDrop

    // --- 处理内部文件移动的逻辑 ---
    const sourceItem = draggedItem.value;
    const currentDragOverTarget = dragOverTarget.value; // 保存当前目标，然后清除
    dragOverTarget.value = null; // 清除悬停状态

    // 验证内部拖放操作的有效性
    // 检查: 是否有拖拽项? 拖拽项不是 '..'? 目标项是文件夹或 '..'? 拖拽项不是目标项自身? 放置的目标确实是悬停的目标?
    if (
      !sourceItem ||
      sourceItem.filename === '..' ||
      (targetItem.filename !== '..' && !targetItem.attrs.isDirectory) ||
      sourceItem.filename === targetItem.filename ||
      targetItem.filename !== currentDragOverTarget
    ) {
      console.log(
        `[DragDrop] Internal drop on row ignored: Invalid conditions. Source: ${sourceItem?.filename}, Target: ${targetItem.filename}, Drop Target: ${currentDragOverTarget}`
      );
      if (sourceItem) draggedItem.value = null; // 清理拖拽状态
      return;
    }

    // --- 计算路径 ---
    const sourceFullPath = joinPath(currentPath.value, sourceItem.filename);
    let targetDirectoryFullPath: string;

    if (targetItem.filename === '..') {
      const current = currentPath.value;
      if (current === '/') {
        // 不能从根目录移动到父目录
        // console.warn(`[DragDrop] Cannot move item from root to its parent.`);
        draggedItem.value = null;
        return;
      }
      const lastSlashIndex = current.lastIndexOf('/');
      targetDirectoryFullPath = lastSlashIndex <= 0 ? '/' : current.substring(0, lastSlashIndex);
      if (!targetDirectoryFullPath) targetDirectoryFullPath = '/'; // 处理根目录下的文件/文件夹
    } else {
      // 移动到子目录
      targetDirectoryFullPath = joinPath(currentPath.value, targetItem.filename);
    }

    const newFullPath = joinPath(targetDirectoryFullPath, sourceItem.filename);

    // 检查源路径和计算出的目标路径是否相同
    if (sourceFullPath === newFullPath) {
      // console.warn(`[DragDrop] Source and destination paths are the same.`);
      draggedItem.value = null;
      return;
    }

    // --- 调用 SFTP 操作 (处理单选/多选) ---
    const itemsToMove: FileListItem[] = [];
    // 检查被拖拽的项是否在选区内
    if (selectedItems.value.has(sourceItem.filename)) {
      // 多选拖拽：移动所有选中的项
      console.log(
        `[DragDrop] Multi-item drop detected. Moving ${selectedItems.value.size} selected items.`
      );
      selectedItems.value.forEach((filename) => {
        // 从完整文件列表中查找对应的 FileListItem 对象
        const itemToMove = fileList.value.find((f) => f.filename === filename);
        if (itemToMove && itemToMove.filename !== '..') {
          // 确保找到且不是 '..'
          // 检查目标路径是否与源路径相同 (对于每个项目)
          const currentItemSourcePath = joinPath(currentPath.value, itemToMove.filename);
          const currentItemNewPath = joinPath(targetDirectoryFullPath, itemToMove.filename);
          if (currentItemSourcePath !== currentItemNewPath) {
            itemsToMove.push(itemToMove);
          } else {
            console.warn(
              `[DragDrop] Skipping move for ${itemToMove.filename}: Source and destination paths are the same.`
            );
          }
        }
      });
      // 清空选择是一个好习惯，可以在移动成功后进行，但这里为简化暂时不清空
      // clearSelection(); // 需要从 useFileManagerSelection 引入或作为参数传入
    } else {
      // 单选拖拽 (拖拽了一个未选中的项)
      console.log(
        `[DragDrop] Single unselected item drop detected. Moving ${sourceItem.filename}.`
      );
      // 检查目标路径是否与源路径相同
      if (sourceFullPath !== newFullPath) {
        itemsToMove.push(sourceItem);
      } else {
        console.warn(
          `[DragDrop] Skipping move for ${sourceItem.filename}: Source and destination paths are the same.`
        );
      }
    }

    // 统一执行移动操作
    if (itemsToMove.length > 0) {
      console.log(
        `[DragDrop] Executing move for ${itemsToMove.length} items to target directory: ${targetDirectoryFullPath}`
      );
      itemsToMove.forEach((item) => {
        const itemNewFullPath = joinPath(targetDirectoryFullPath, item.filename);
        console.log(`[DragDrop]   - Moving '${item.filename}' to '${itemNewFullPath}'`);
        onItemMove(item, itemNewFullPath); // 调用移动回调
      });
    } else {
      console.log('[DragDrop] No valid items to move.');
    }

    // 清理拖拽状态
    draggedItem.value = null;
  };

  // --- 返回状态和处理函数 ---
  return {
    showExternalDropOverlay,
    dragOverTarget,
    draggedItem, // 需要暴露以供 handleDragOverRow 等函数内部判断
    // --- 事件处理器 ---
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop, // 容器的 drop (主要用于清理)
    handleOverlayDrop,
    handleDragStart,
    handleDragEnd,
    handleDragOverRow,
    handleDragLeaveRow,
    handleDropOnRow,
  };
}
