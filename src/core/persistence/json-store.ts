const writeLocks = new Map<string, Promise<void>>();

export const withSerializedFileWrite = async <T>(
  fileKey: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const prior = writeLocks.get(fileKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prior.then(() => gate);
  writeLocks.set(fileKey, chained);

  await prior;
  try {
    return await operation();
  } finally {
    release();
    if (writeLocks.get(fileKey) === chained) {
      writeLocks.delete(fileKey);
    }
  }
};
