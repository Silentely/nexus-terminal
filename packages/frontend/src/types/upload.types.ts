// 类型定义：用于文件上传任务
export interface UploadItem {
  id: string; // 上传任务的唯一标识符
  file: File; // 要上传的文件对象
  filename: string; // 文件名
  progress: number; // 上传进度 (0-100)
  error?: string; // 错误信息
  status: 'pending' | 'uploading' | 'paused' | 'success' | 'error' | 'cancelled'; // 上传状态
}

// 可以根据需要添加其他与上传相关的类型
