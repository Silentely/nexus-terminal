export const calculateUploadProgress = (completedBytes: number, totalBytes: number): number => {
  if (totalBytes <= 0) return 100;
  if (completedBytes >= totalBytes) return 100;
  return Math.min(99, Math.max(0, Math.floor((completedBytes / totalBytes) * 100)));
};
